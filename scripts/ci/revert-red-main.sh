#!/usr/bin/env bash
# Revert the commit that turned the default branch red (no LLM, no secrets needed).
# Called by the revert-red-main job of .github/workflows/ci.yml when CI fails on main: GitHub doesn't
# fire workflow_run for runs Autopilot dispatches with GITHUB_TOKEN, so this can't live in a
# separate workflow. Reverts only a commit whose parent was green or untested, never a
# revert, never twice. Opens and squash-merges claude/revert-<sha>, re-runs CI on main and
# comments on the original PR. GITHUB_TOKEN can never push a change to .github/workflows/ (it has
# no 'workflows' permission), so the revert keeps those files as main has them and names them in
# the PR and the issue; a commit that changed nothing else is left to a person (src/ci-revert.test.ts).
#
# env: GH_TOKEN, GH_REPO, BASE (default branch), SHA (the red commit), RUN_URL,
#      GITHUB_OUTPUT (optional; gets reverted=true|false)
set -euo pipefail
GITHUB_OUTPUT=${GITHUB_OUTPUT:-/dev/null}
echo "reverted=false" >> "$GITHUB_OUTPUT"
short=${SHA:0:7}
branch="claude/revert-$short"
subject=$(git log -1 --format=%s "$SHA")
if [[ "$subject" == Revert* ]]; then
  echo "::warning::$short is itself a revert; not reverting it (left to Claude or a human)."; exit 0
fi
if git log --format=%B "$SHA..HEAD" | grep -q "This reverts commit $SHA"; then
  echo "$short is already reverted on $BASE."; exit 0
fi
if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  echo "$branch already exists."; exit 0
fi
# Only revert the commit that turned main red: if the parent's CI already failed,
# this commit didn't break it, and reverting it would be a guess.
parent=$(git rev-parse "$SHA^")
before=$(gh api "repos/$GH_REPO/actions/workflows/ci.yml/runs?head_sha=$parent&status=completed" \
  --jq '[.workflow_runs[].conclusion] | if index("success") then "success" elif index("failure") then "failure" else "none" end' || echo none)
if [ "$before" = "failure" ]; then
  echo "::warning::$BASE was already red before $short; not reverting."; exit 0
fi

# An issue for what's left: Claude (claude.yml / the maintenance sweep) picks up issues labeled claude.
track() { # title, body
  gh label create claude --color 5319e7 --description "Work for Claude" 2>/dev/null || true
  gh issue create --label claude --title "$1" --body "$2" || true
}

pr=$(gh api "repos/$GH_REPO/commits/$SHA/pulls" --jq '.[0].number // empty' 2>/dev/null || true)
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$branch"
if ! git revert --no-edit "$SHA"; then
  echo "::error::git revert $short conflicts with later commits; needs a fix forward."; exit 1
fi
# GitHub refuses a push that changes .github/workflows/ from a token without the 'workflows'
# permission, which GITHUB_TOKEN never has: keep those files as $BASE has them (the revert's
# parent) and revert the rest.
mapfile -t workflows < <(git diff --name-only --no-renames HEAD~ HEAD -- .github/workflows/)
kept=
if [ ${#workflows[@]} -gt 0 ]; then
  list=$(printf "\`%s\`, " "${workflows[@]}")
  list=${list%, }
  git restore --source=HEAD~ --staged --worktree -- "${workflows[@]}"
  if git diff --cached --quiet HEAD~; then
    echo "::warning::$short changes only .github/workflows/, which CI's token cannot push; not reverting (left to a person)."
    track "Revert \"$subject\" by hand: CI's token cannot push workflow changes" "$(printf '%s\n\n%s\n%s' \
      "\`$short\`${pr:+ (#$pr)} turned \`$BASE\` red and was not reverted: it changes only \`.github/workflows/\` ($list), which CI's token cannot push (it has no \`workflows\` permission)." \
      "Failed run: $RUN_URL" \
      "A person, or a token with the \`workflows\` permission, must revert it (\`git revert $SHA\`) or fix it forward.")"
    exit 0
  fi
  kept="The changes to \`.github/workflows/\` ($list) were left in place: CI's token cannot push them; re-check them in the fix-forward."
  git commit -q --amend -m "$(git log -1 --format=%B)" -m "$kept"
fi
git push origin "$branch"
{
  echo "CI failed on \`$BASE\` at $SHA: $RUN_URL"
  echo
  echo "This reverts ${pr:+#$pr / }$short so \`$BASE\` is green again. An issue labeled"
  echo "\`claude\` tracks re-landing the change with a fix."
  echo
  if [ -n "$kept" ]; then echo "$kept"; echo; fi
  echo "This reverts commit $SHA."
} > revert-body.md
url=$(gh pr create --base "$BASE" --head "$branch" --title "Revert \"$subject\"" --body-file revert-body.md)
gh pr merge "$url" --squash --delete-branch
echo "reverted=true" >> "$GITHUB_OUTPUT"
gh workflow run ci.yml --ref "$BASE"
if [ -n "$pr" ]; then
  gh pr comment "$pr" --body "CI failed on \`$BASE\` after this merged ($RUN_URL), so it was reverted in $url." || true
fi
body=$(printf '%s\n\n%s\n%s' \
  "\`$short\`${pr:+ (#$pr)} turned \`$BASE\` red and was reverted in $url." \
  "Failed run: $RUN_URL" \
  "Re-apply the change on a fresh \`claude/\` branch from \`$BASE\`, fix what failed, and verify with \`scripts/check.sh\` and \`npm run test:e2e\`.")
if [ -n "$kept" ]; then body+=$'\n\n'"$kept"; fi
track "Re-land \"$subject\" with a fix" "$body"
