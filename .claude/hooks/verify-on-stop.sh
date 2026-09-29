#!/usr/bin/env bash
# Stop hook: before Claude ends a turn with unshipped work, run the fast checks.
# On failure, block the stop and hand the failure back so Claude keeps going.
# Caps itself at 3 blocks per session so it can never loop forever.
set -uo pipefail

input=$(cat)
session_id=$(jq -r '.session_id // "unknown"' <<<"$input")
[[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == "true" ]] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

# Nothing to verify if the tree is clean and nothing is ahead of upstream.
dirty=$(git status --porcelain 2>/dev/null)
ahead=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)
if [[ -z "$dirty" && "$ahead" == "0" ]]; then
  exit 0
fi

counter="${TMPDIR:-/tmp}/claude-stop-hook-${session_id}"
count=$(cat "$counter" 2>/dev/null || echo 0)
if (( count >= 3 )); then
  exit 0
fi

if output=$(scripts/check.sh --fast 2>&1); then
  rm -f "$counter"
  exit 0
fi

echo $((count + 1)) >"$counter"
jq -n --arg out "$(tail -n 60 <<<"$output")" '{
  decision: "block",
  reason: ("scripts/check.sh --fast is failing on your changes. Fix it before finishing (or, if the failure is unrelated to this task, say so explicitly).\n\n" + $out)
}'
