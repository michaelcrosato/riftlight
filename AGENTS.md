# Agent operating contract

This repository is written by AI agents, end to end. Humans set direction through
issues and review outcomes; agents plan, implement, verify, open PRs, fix CI, and
merge. Optimize for throughput with a green main branch.

## Loop

1. **Understand**: read the issue/prompt, then the code it touches. Don't ask
   questions you can answer from the repo; pick the conventional default and say so.
2. **Branch**: work on a `claude/<short-topic>` branch cut from the default
   branch. Never commit directly to the default branch.
3. **Build**: make the smallest change that fully solves the task. Add or update
   tests alongside behavior changes.
4. **Verify**: run `scripts/check.sh` until it passes. A task is not done while
   checks fail. For UI or runtime behavior, actually run it.
5. **Ship**: commit (Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`,
   `refactor:`, `test:`, `ci:`), push, and open a PR. Pushing a `claude/*`
   branch auto-opens a PR and enables auto-merge (`.github/workflows/autopilot.yml`).
6. **Drive to green**: CI failures and review comments are your job. Fix and push
   until the PR merges.

## Commands

| Task | Command |
| --- | --- |
| All checks (lint, types, tests, build) | `scripts/check.sh` |
| Fast checks only | `scripts/check.sh --fast` |
| Install deps | `scripts/session-start.sh` (runs automatically in cloud sessions) |

`scripts/check.sh` auto-detects the stack (Node, Python, Go, Rust) and runs
whatever exists. When you add a stack, wire its lint/test/build into the
standard entry points (`package.json` scripts, `pyproject.toml`, etc.) so the
script and CI pick them up with no extra config.

## Rules

- **Green main is the only hard rule.** Everything merges through CI.
- Never skip, disable, or weaken a test to get green. Fix the cause.
- Never commit secrets. Use environment variables; document them in `README.md`.
- Never force-push the default branch or rewrite shared history.
- Keep PRs focused: one concern per PR. Several small PRs beat one large one.
- Label a PR `hold` to stop auto-merge on it.
- If blocked on something only a human can do (credentials, billing, account
  settings), say exactly what is needed in the PR or issue and move on to
  the next task.

## Stack

WebGPU-first pixel-art game engine: Vite + TypeScript, `three@0.186.0`
(`three/webgpu` + `three/tsl`), `@dimforge/rapier3d-compat@0.20.0`, local GLBs.
**Read `docs/ENGINE.md` before touching rendering.** It holds the pipeline contract,
the game API and the agent tooling.

| Path | What |
| --- | --- |
| `src/engine/` | Engine (public API in `src/engine/index.ts`) |
| `src/engine/render/PixelRenderer.ts` | The one `WebGPURenderer` + `RenderPipeline`, pixel/raw modes, capture |
| `src/engine/framing.ts` | Integer scaling / letterbox math (unit-tested) |
| `src/game/coinGarden.ts` | Demo game, a complete example of the `Game` API |
| `scripts/generate-assets.mjs` | Deterministic GLB generator (`npm run assets`) |
| `scripts/forbidden-apis.mjs` | Guardrail run by `npm run lint` |
| `scripts/e2e.mjs` | Browser verification (`npm run build && npm run test:e2e`) |

Hard constraints (enforced by lint): no `WebGLRenderer`, `EffectComposer`,
`ShaderPass`, `RenderPixelatedPass`, `(Raw)ShaderMaterial`, `onBeforeCompile` or GLSL;
all shader logic in TSL; no React or external engines; version pins exact. Pixel
snapping is camera/presentation only, never physics. Any rendering change must keep
`npm run test:e2e` green on both the WebGPU and WebGL 2 fallback scenarios.
