#!/usr/bin/env bash
# Revert the commit that turned the default branch red (no LLM; no secret needed, one optional).
# Called by the revert-red-main job of .github/workflows/ci.yml when CI fails on main: GitHub doesn't
# fire workflow_run for runs Autopilot dispatches with GITHUB_TOKEN, so this can't live in a
# separate workflow. Reverts only a commit whose parent was green or untested, never a
# revert, never twice. Opens and squash-merges claude/revert-<sha>, re-runs CI on main and
# comments on the original PR. GITHUB_TOKEN can never push a change to .github/workflows/ (it has
# no 'workflows' permission), so the revert keeps those files as main has them (a conflict in them
# alone takes main's side) and names them in the PR and the issue; a commit that changed nothing
# else is left to a person (src/ci-revert.test.ts).
# With the optional REVERT_TOKEN secret (FULL_REVERT=true; GH_TOKEN and the checkout's push
# credential are then that token, which has the 'workflows' permission) workflow changes revert
# like any other (a conflict only in them still takes main's side, and is named). That token only
# pushes the branch and merges it (the two steps GitHub checks the permission on); its merge pushes
# to main, which starts CI there by itself, so the script dispatches none, and it cancels the CI
# run its push started on the branch. Everything else (the Actions API, the PR, the comment, the
# issue) uses the job's own token, JOB_TOKEN, as before: it fires no workflows, and REVERT_TOKEN
# needs no Actions or Issues permission.
#
# env: GH_TOKEN, GH_REPO, BASE (default branch), SHA (the red commit), RUN_URL,
#      FULL_REVERT (optional; 'true' when GH_TOKEN and git push may change .github/workflows/),
#      JOB_TOKEN (optional; the job's GITHUB_TOKEN, else GH_TOKEN for everything),
#      GITHUB_OUTPUT (optional; gets reverted=true|false)
set -euo pipefail
GITHUB_OUTPUT=${GITHUB_OUTPUT:-/dev/null}
FULL_REVERT=${FULL_REVERT:-false}
job_gh() { # gh with the job's own token when the job passed it; plain gh only merges
  if [ -n "${JOB_TOKEN:-}" ]; then GH_TOKEN=$JOB_TOKEN gh "$@"; else gh "$@"; fi
}
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
before=$(job_gh api "repos/$GH_REPO/actions/workflows/ci.yml/runs?head_sha=$parent&status=completed" \
  --jq '[.workflow_runs[].conclusion] | if index("success") then "success" elif index("failure") then "failure" else "none" end' || echo none)
if [ "$before" = "failure" ]; then
  echo "::warning::$BASE was already red before $short; not reverting."; exit 0
fi

# An issue for what's left: Claude (claude.yml / the maintenance sweep) picks up issues labeled claude.
track() { # title, body
  job_gh label create claude --color 5319e7 --description "Work for Claude" 2>/dev/null || true
  job_gh issue create --label claude --title "$1" --body "$2" || true
}

only_workflows() { # paths: at least one, and each under .github/workflows/
  [ $# -gt 0 ] || return 1
  local f
  for f; do [[ "$f" == .github/workflows/* ]] || return 1; done
}

pr=$(job_gh api "repos/$GH_REPO/commits/$SHA/pulls" --jq '.[0].number // empty' 2>/dev/null || true)
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$branch"
# GitHub refuses a push that changes .github/workflows/ from a token without the 'workflows'
# permission, which GITHUB_TOKEN never has: keep those files as $BASE has them and revert the rest.
# REVERT_TOKEN has it: then they revert like any other file, except that a conflict only in them
# still takes $BASE's side, so the token never leaves more undone than GITHUB_TOKEN would.
# Paths are read NUL-separated: git quotes a name with non-ASCII bytes in a plain list.
conflicts=()
if ! git revert --no-edit "$SHA"; then
  mapfile -d '' -t conflicts < <(git diff -z --name-only --diff-filter=U)
  if ! only_workflows "${conflicts[@]}"; then
    echo "::error::git revert $short conflicts with later commits; needs a fix forward."; exit 1
  fi
  # Conflicts only in workflow files, which $BASE has changed since (and which, with GITHUB_TOKEN,
  # stay as $BASE has them anyway): take $BASE's side ($BASE may have deleted one) and finish the
  # revert. strip drops git's "# Conflicts:" lines.
  echo "The revert conflicts only in .github/workflows/: keeping $BASE's side of ${conflicts[*]}."
  for f in "${conflicts[@]}"; do
    if git cat-file -e "HEAD:$f" 2>/dev/null; then git checkout HEAD -- "$f"; else git rm -q -- "$f"; fi
  done
  git commit -q --allow-empty --no-edit --cleanup=strip
fi
workflows=()
if [ "$FULL_REVERT" != true ]; then
  mapfile -d '' -t workflows < <(git diff -z --name-only --no-renames HEAD~ HEAD -- .github/workflows/)
fi
kept=
if [ $((${#workflows[@]} + ${#conflicts[@]})) -gt 0 ]; then
  list=$(printf "\`%s\`, " "${workflows[@]}" "${conflicts[@]}")
  list=${list%, }
  if [ ${#workflows[@]} -gt 0 ]; then git restore --source=HEAD~ --staged --worktree -- "${workflows[@]}"; fi
  if git diff --cached --quiet HEAD~; then
    if [ "$FULL_REVERT" = true ]; then
      echo "::warning::$short changes only .github/workflows/, and $BASE has changed the same lines since; not reverting (left to a person)."
      track "Revert \"$subject\" by hand: it conflicts with later workflow changes" "$(printf '%s\n\n%s\n%s' \
        "\`$short\`${pr:+ (#$pr)} turned \`$BASE\` red and was not reverted: it changes only \`.github/workflows/\` ($list), and \`$BASE\` has changed the same lines since." \
        "Failed run: $RUN_URL" \
        "A person must revert it (\`git revert $SHA\`, resolving the conflicts) or fix it forward.")"
    else
      echo "::warning::$short changes only .github/workflows/, which CI's token cannot push; not reverting (left to a person)."
      track "Revert \"$subject\" by hand: CI's token cannot push workflow changes" "$(printf '%s\n\n%s\n%s' \
        "\`$short\`${pr:+ (#$pr)} turned \`$BASE\` red and was not reverted: it changes only \`.github/workflows/\` ($list), which CI's token cannot push (it has no \`workflows\` permission)." \
        "Failed run: $RUN_URL" \
        "A person, or a token with the \`workflows\` permission, must revert it (\`git revert $SHA\`) or fix it forward.")"
    fi
    exit 0
  fi
  if [ "$FULL_REVERT" = true ]; then
    kept="The changes to \`.github/workflows/\` ($list) were left as \`$BASE\` has them: \`$BASE\` has changed the same lines since; re-check them in the fix-forward."
  else
    kept="The changes to \`.github/workflows/\` ($list) were left in place: CI's token cannot push them; re-check them in the fix-forward."
  fi
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
url=$(job_gh pr create --base "$BASE" --head "$branch" --title "Revert \"$subject\"" --body-file revert-body.md)
# GH_TOKEN merges: a merge that changes .github/workflows/ needs the 'workflows' permission too.
gh pr merge "$url" --squash --delete-branch
echo "reverted=true" >> "$GITHUB_OUTPUT"
if [ "$FULL_REVERT" != true ]; then
  # A merge made with GITHUB_TOKEN fires no push event on $BASE: run CI there ourselves.
  job_gh workflow run ci.yml --ref "$BASE"
else
  # REVERT_TOKEN's merge starts CI on $BASE, and its push of $branch started CI there, which
  # tests the same change: stop that one, as Autopilot does for the branches it merges.
  job_gh run list --workflow ci.yml --branch "$branch" --json databaseId,status \
    --jq '.[] | select(.status != "completed") | .databaseId' |
    while read -r run; do job_gh run cancel "$run" || true; done || true
fi
if [ -n "$pr" ]; then
  job_gh pr comment "$pr" --body "CI failed on \`$BASE\` after this merged ($RUN_URL), so it was reverted in $url." || true
fi
body=$(printf '%s\n\n%s\n%s' \
  "\`$short\`${pr:+ (#$pr)} turned \`$BASE\` red and was reverted in $url." \
  "Failed run: $RUN_URL" \
  "Re-apply the change on a fresh \`claude/\` branch from \`$BASE\`, fix what failed, and verify with \`scripts/check.sh\` and \`npm run test:e2e\`.")
if [ -n "$kept" ]; then body+=$'\n\n'"$kept"; fi
track "Re-land \"$subject\" with a fix" "$body"
