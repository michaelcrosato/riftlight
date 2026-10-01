#!/usr/bin/env bash
# One-time GitHub repo configuration for the autopilot setup. Run locally with an
# authenticated gh CLI (repo admin):  scripts/configure-github.sh [owner/repo]
#
# - ensures a `main` branch exists and is the default
# - enables auto-merge, squash-only merges, delete-branch-on-merge
# - lets Actions open PRs (Autopilot fallback when AUTOMATION_TOKEN is unset, auto-revert)
# - ruleset on the default branch: changes go through PRs, no force-push/deletion.
#   Deliberately NO required status checks: PRs merge at once, CI runs on main after the
#   merge, and a red main is reverted automatically (.github/workflows/claude-ci-autofix.yml).
#   Re-running this script removes a required check an older version added.
# - creates the `claude` and `hold` labels
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
echo "Configuring $repo"

default=$(gh api "repos/$repo" --jq .default_branch)
if [[ "$default" != "main" ]]; then
  if ! gh api "repos/$repo/branches/main" >/dev/null 2>&1; then
    sha=$(gh api "repos/$repo/git/ref/heads/$default" --jq .object.sha)
    gh api -X POST "repos/$repo/git/refs" -f ref=refs/heads/main -f sha="$sha" >/dev/null
    echo "Created main from $default"
  fi
  gh api -X PATCH "repos/$repo" -f default_branch=main >/dev/null
  echo "Default branch: main"
fi

gh api -X PATCH "repos/$repo" \
  -F allow_auto_merge=true \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_update_branch=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY >/dev/null
echo "Merge settings: squash-only, auto-merge on, delete branch on merge"

gh api -X PUT "repos/$repo/actions/permissions/workflow" \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=true >/dev/null
echo "Actions may open PRs"

existing=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name=="autopilot") | .id')
ruleset=$(cat <<'JSON'
{
  "name": "autopilot",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"] } }
  ]
}
JSON
)
if [[ -n "$existing" ]]; then
  gh api -X PUT "repos/$repo/rulesets/$existing" --input - <<<"$ruleset" >/dev/null
else
  gh api -X POST "repos/$repo/rulesets" --input - <<<"$ruleset" >/dev/null
fi
echo "Ruleset 'autopilot': PRs required on the default branch, no required status checks"

gh label create claude --repo "$repo" --color D97757 --description "Claude implements this" --force >/dev/null
gh label create hold --repo "$repo" --color B60205 --description "Stop auto-merge" --force >/dev/null
echo "Labels: claude, hold"

missing=()
secrets=$(gh secret list --repo "$repo" --json name --jq '.[].name' 2>/dev/null || true)
grep -qx CLAUDE_CODE_OAUTH_TOKEN <<<"$secrets" || grep -qx ANTHROPIC_API_KEY <<<"$secrets" \
  || missing+=("CLAUDE_CODE_OAUTH_TOKEN (run 'claude setup-token') or ANTHROPIC_API_KEY")
grep -qx AUTOMATION_TOKEN <<<"$secrets" || missing+=("AUTOMATION_TOKEN (optional, recommended: fine-grained PAT with contents+pull-requests write)")
if (( ${#missing[@]} )); then
  echo; echo "Secrets still to add (gh secret set NAME --repo $repo):"
  printf '  - %s\n' "${missing[@]}"
fi
echo; echo "Done. Also install the Claude GitHub App: https://github.com/apps/claude"
