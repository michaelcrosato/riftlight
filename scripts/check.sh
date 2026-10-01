#!/usr/bin/env bash
# Single entry point for every quality gate: agents, the Stop hook, and CI all run this.
# Auto-detects the stack and runs whatever lint/typecheck/test/build steps exist.
#
#   scripts/check.sh          full run (CI)
#   scripts/check.sh --fast   skip build and slow steps (Stop hook)
set -euo pipefail

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"

ran=0
step() {
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::group::$*"; else echo "▶ $*"; fi
  "$@"
  [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::endgroup::"
  ran=$((ran + 1))
}

# ---------- Repo hygiene ----------
for f in $(git ls-files '*.json' 2>/dev/null); do
  jq empty "$f" >/dev/null || { echo "Invalid JSON: $f"; exit 1; }
done
if command -v shellcheck >/dev/null; then
  mapfile -t sh_files < <(git ls-files '*.sh')
  [[ ${#sh_files[@]} -gt 0 ]] && step shellcheck "${sh_files[@]}"
fi
if command -v actionlint >/dev/null && [[ -d .github/workflows ]]; then
  step actionlint
fi

# ---------- Node / TypeScript ----------
if [[ -f package.json ]]; then
  if [[ -f pnpm-lock.yaml ]]; then pm=pnpm
  elif [[ -f yarn.lock ]]; then pm=yarn
  elif [[ -f bun.lockb || -f bun.lock ]]; then pm=bun
  else pm=npm; fi
  has_script() { jq -e --arg s "$1" '.scripts[$s] // empty' package.json >/dev/null; }
  for s in lint typecheck test; do
    has_script "$s" && step "$pm" run "$s"
  done
  # Generated models must match their generator (not stale, not hand-edited). Compares
  # against the working tree, so it also passes before a regenerated model is committed.
  if has_script assets && [[ -d public/assets ]]; then
    assets_unchanged() {
      local before
      before=$(cd public/assets && sha256sum -- * | sort)
      "$pm" run --silent assets >/dev/null
      [[ "$(cd public/assets && sha256sum -- * | sort)" == "$before" ]] || {
        echo "public/assets did not match scripts/generate-assets.mjs; regenerated it. Review and commit:"
        git status --short public/assets
        return 1
      }
    }
    step assets_unchanged
  fi
  # Animation metrics for every clip (exits 1 on problems; warnings are fine).
  if has_script anim; then step "$pm" run --silent anim -- check; fi
  if [[ $FAST -eq 0 ]] && has_script build; then step "$pm" run build; fi
fi

# ---------- Python ----------
if [[ -f pyproject.toml || -f requirements.txt ]]; then
  if command -v uv >/dev/null; then run=(uv run); ruff=(uvx ruff); else run=(); ruff=(ruff); fi
  step "${ruff[@]}" check .
  step "${ruff[@]}" format --check .
  if [[ -n "$(git ls-files '*test_*.py' '*_test.py')" ]]; then
    step "${run[@]}" pytest -q
  fi
fi

# ---------- Go ----------
if [[ -f go.mod ]]; then
  unformatted=$(gofmt -l .)
  [[ -n "$unformatted" ]] && { echo "gofmt needed:"; echo "$unformatted"; exit 1; }
  step go vet ./...
  step go test ./...
fi

# ---------- Rust ----------
if [[ -f Cargo.toml ]]; then
  step cargo fmt --check
  step cargo clippy --all-targets -- -D warnings
  step cargo test
fi

echo "✔ scripts/check.sh passed ($ran steps)"
