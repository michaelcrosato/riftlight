#!/usr/bin/env bash
# SessionStart hook: install project dependencies in cloud sessions and print a
# short orientation that lands in Claude's context. Must stay fast and never fail.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

if [[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]]; then
  {
    if [[ -f package.json && ! -d node_modules ]]; then
      if [[ -f pnpm-lock.yaml ]]; then pnpm install --frozen-lockfile
      elif [[ -f yarn.lock ]]; then yarn install --frozen-lockfile
      elif [[ -f package-lock.json ]]; then npm ci
      else npm install; fi
    fi
    if [[ -f pyproject.toml ]] && command -v uv >/dev/null && [[ ! -d .venv ]]; then
      uv sync
    elif [[ -f requirements.txt ]] && [[ ! -d .venv ]]; then
      python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
    fi
    if [[ -f go.mod ]]; then go mod download; fi
    if [[ -f Cargo.toml ]]; then cargo fetch; fi
  } >/tmp/session-start-install.log 2>&1 || echo "Dependency install failed; see /tmp/session-start-install.log"
fi

branch=$(git branch --show-current 2>/dev/null)
echo "Branch: ${branch:-detached}. Follow AGENTS.md: branch claude/*, run scripts/check.sh, push, PR auto-merges on green."
exit 0
