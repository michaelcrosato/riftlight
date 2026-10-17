#!/usr/bin/env bash
# Single entry point for every quality gate: agents, the Stop hook, and CI all run this.
# Auto-detects the stack and runs whatever lint/typecheck/test/build steps exist.
#
#   scripts/check.sh          full run (CI)
#   scripts/check.sh --fast   the Stop hook: no build, and unit tests only for what changed since
#                             the branch left the default branch (`vitest related`); lint and
#                             typecheck are fast anyway once their caches (node_modules/.cache) are warm
#
# Quiet on success: each step prints its summary, a failing step its problems last.
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
  # Data checks first (seconds): the unit tests assert the same libraries, and a failure here
  # ends the output with its `✘ <id>: <problem>` recap instead of vitest's.
  # Animation metrics for every clip (exits 1 on problems; warnings are fine).
  if has_script anim; then step "$pm" run --silent anim -- check; fi
  # Texture checks for every texture (scripts/tex.ts; exits 1 on problems). Before the models, which
  # name textures: a broken texture shows its own problem, not a model's mention of it.
  if has_script tex; then step "$pm" run --silent tex -- check; fi
  # Model checks for every model (scripts/model.ts; exits 1 on problems; warnings are fine).
  if has_script model; then step "$pm" run --silent model -- check; fi
  # --fast: only the tests that what changed since the branch left the default branch (and what
  # isn't committed yet) can break: the tests that import a changed file (`vitest related`) and
  # the tests that name it (they read it as text). A changed file that isn't code (docs, data,
  # models, config: tests read those from disk) runs every test; nothing changed, no tests.
  changed=() related=() named=() all_tests=0
  if [[ $FAST -eq 1 && -x node_modules/.bin/vitest ]] && base=$(git merge-base HEAD origin/HEAD 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null); then
    mapfile -d '' -t changed < <({ git diff -z --name-only --diff-filter=d "$base"; git ls-files -z --others --exclude-standard; } | sort -zu)
    for f in "${changed[@]}"; do
      if [[ $f =~ \.(ts|mts|mjs|js)$ ]]; then related+=("$f"); else all_tests=1; fi
    done
    for f in "${related[@]}"; do
      mapfile -t -O "${#named[@]}" named < <(git grep -l -F "$(basename "$f")" -- 'src/*.test.ts' 2>/dev/null)
    done
  fi
  for s in lint typecheck test; do
    has_script "$s" || continue
    if [[ $s == test && $FAST -eq 1 && -n "${base:-}" && $all_tests -eq 0 ]]; then
      if [[ ${#related[@]} -gt 0 ]]; then step node_modules/.bin/vitest related --run --passWithNoTests "${related[@]}" "${named[@]}"
      else echo "▶ test: nothing changed since $(git rev-parse --short "$base"), skipped"; fi
    else
      step "$pm" run --silent "$s"
    fi
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
  if [[ $FAST -eq 0 ]] && has_script build; then step "$pm" run --silent build; fi
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
