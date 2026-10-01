#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: apply ESLint's autofixes (prefer-const and friends) to
# the touched JS/TS file. The repo has no formatter; lint is the style gate. About 1 s,
# silent, never blocks: whatever it can't fix, the Stop hook's fast checks report.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')
[[ -z "$file" || ! -f "$file" ]] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

case "$file" in
  *.ts|*.mjs|*.js)
    [[ -x node_modules/.bin/eslint ]] && node_modules/.bin/eslint --fix --no-warn-ignored "$file" ;;
esac >/dev/null 2>&1
exit 0
