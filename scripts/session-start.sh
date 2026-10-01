#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json): install project dependencies in cloud sessions
# and print a one-line orientation that lands in Claude's context. Idempotent: it installs
# only when node_modules is missing or the lockfile changed since the last install.
# Must stay fast and never fail.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

# Fingerprint of the lockfile node_modules was installed from (kept inside node_modules,
# so deleting node_modules resets it).
stamp=node_modules/.session-start-lock.sha256
node_lock() {
  local f
  for f in pnpm-lock.yaml yarn.lock package-lock.json package.json; do
    [[ -f $f ]] && { sha256sum "$f" | cut -d' ' -f1; return; }
  done
}

if [[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]]; then
  ok=1
  {
    if [[ -f package.json ]] && { [[ ! -d node_modules ]] || [[ "$(cat "$stamp" 2>/dev/null)" != "$(node_lock)" ]]; }; then
      if [[ -f pnpm-lock.yaml ]]; then pnpm install --frozen-lockfile
      elif [[ -f yarn.lock ]]; then yarn install --frozen-lockfile
      elif [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund
      else npm install --no-audit --no-fund; fi && mkdir -p node_modules && node_lock >"$stamp" || ok=0
    fi
    if [[ -f pyproject.toml ]] && command -v uv >/dev/null && [[ ! -d .venv ]]; then
      uv sync || ok=0
    elif [[ -f requirements.txt ]] && [[ ! -d .venv ]]; then
      { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; } || ok=0
    fi
    if [[ -f go.mod ]]; then go mod download || ok=0; fi
    if [[ -f Cargo.toml ]]; then cargo fetch || ok=0; fi
  } >/tmp/session-start-install.log 2>&1
  (( ok )) || echo "Dependency install failed; see /tmp/session-start-install.log"
fi

branch=$(git branch --show-current 2>/dev/null)
echo "Branch: ${branch:-detached}. Follow AGENTS.md: branch claude/*, run scripts/check.sh, push; Autopilot merges the PR and CI on main reverts it if red."
exit 0
