#!/usr/bin/env bash
# Revert the commit that turned the default branch red (no LLM, no secrets needed).
# Called by the last job of .github/workflows/ci.yml when CI fails on main: GitHub doesn't
# fire workflow_run for runs Autopilot dispatches with GITHUB_TOKEN, so this can't live in a
# separate workflow. Reverts only a commit whose parent was green or untested, never a
# revert, never twice. Opens and squash-merges claude/revert-<sha>, re-runs CI on main and
# comments on the original PR.
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

pr=$(gh api "repos/$GH_REPO/commits/$SHA/pulls" --jq '.[0].number // empty' 2>/dev/null || true)
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$branch"
if ! git revert --no-edit "$SHA"; then
  echo "::error::git revert $short conflicts with later commits; needs a fix forward."; exit 1
fi
git push origin "$branch"
{
  echo "CI failed on \`$BASE\` at $SHA: $RUN_URL"
  echo
  echo "This reverts ${pr:+#$pr / }$short so \`$BASE\` is green again. An issue labeled"
  echo "\`claude\` tracks re-landing the change with a fix."
  echo
  echo "This reverts commit $SHA."
} > revert-body.md
url=$(gh pr create --base "$BASE" --head "$branch" --title "Revert \"$subject\"" --body-file revert-body.md)
gh pr merge "$url" --squash --delete-branch
echo "reverted=true" >> "$GITHUB_OUTPUT"
gh workflow run ci.yml --ref "$BASE"
if [ -n "$pr" ]; then
  gh pr comment "$pr" --body "CI failed on \`$BASE\` after this merged ($RUN_URL), so it was reverted in $url." || true
fi
# Track the fix-forward: Claude (claude.yml / the maintenance sweep) picks up issues labeled claude.
gh label create claude --color 5319e7 --description "Work for Claude" 2>/dev/null || true
gh issue create --label claude --title "Re-land \"$subject\" with a fix" --body "$(printf '%s\n\n%s\n%s' \
  "\`$short\`${pr:+ (#$pr)} turned \`$BASE\` red and was reverted in $url." \
  "Failed run: $RUN_URL" \
  "Re-apply the change on a fresh \`claude/\` branch from \`$BASE\`, fix what failed, and verify with \`scripts/check.sh\` and \`npm run test:e2e\`.")" || true
