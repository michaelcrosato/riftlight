#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: format the touched file if a formatter for it
# is installed. Best-effort and silent; never blocks.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')
[[ -z "$file" || ! -f "$file" ]] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.css|*.scss|*.html|*.vue|*.svelte|*.md|*.yml|*.yaml|*.json)
    if [[ -x node_modules/.bin/biome ]]; then
      node_modules/.bin/biome format --write "$file"
    elif [[ -x node_modules/.bin/prettier ]]; then
      node_modules/.bin/prettier --write --log-level silent "$file"
    fi ;;
  *.py)
    if command -v uvx >/dev/null; then uvx ruff format -q "$file"
    elif command -v ruff >/dev/null; then ruff format -q "$file"; fi ;;
  *.go) command -v gofmt >/dev/null && gofmt -w "$file" ;;
  *.rs) command -v rustfmt >/dev/null && rustfmt --edition 2021 "$file" ;;
  *.sh) command -v shfmt >/dev/null && shfmt -w -i 2 "$file" ;;
esac >/dev/null 2>&1
exit 0
