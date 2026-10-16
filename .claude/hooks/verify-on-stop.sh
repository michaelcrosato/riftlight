#!/usr/bin/env bash
# Stop hook (.claude/settings.json): before Claude ends a turn with unshipped work, run
# the fast checks (scripts/check.sh --fast, ~90-110 s on 4 cores). Silent when they pass. On
# failure, block the stop and hand back the failing step and the end of its output: every check
# prints its problems last (`✘ <id>: <problem>`), so the tail holds them.
# Caps itself at 3 blocks per session so it can never loop forever.
set -uo pipefail

input=$(cat)
session_id=$(jq -r '.session_id // "unknown"' <<<"$input")
[[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == "true" ]] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

# Nothing to verify if the tree is clean and nothing is ahead of upstream (or, for a
# branch never pushed, of the remote default branch).
dirty=$(git status --porcelain 2>/dev/null)
ahead=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || git rev-list --count 'origin/HEAD..HEAD' 2>/dev/null || git rev-list --count 'origin/main..HEAD' 2>/dev/null || echo 0)
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
failing=$(grep '^▶' <<<"$output" | tail -n 1)
failing=${failing#▶ }
jq -n --arg step "${failing:-its repo checks}" --arg out "$(awk '/^▶/ { step = "" } { step = step $0 "\n" } END { printf "%s", step }' <<<"$output" | tail -n 40)" '{
  decision: "block",
  reason: ("scripts/check.sh --fast is failing on your changes, at `" + $step + "`. Fix it before finishing (or, if the failure is unrelated to this task, say so explicitly).\n\n" + $out)
}'
