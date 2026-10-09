# Agent operating contract

This repository is written by AI agents, end to end. Humans set direction through
issues and review outcomes; agents plan, implement, verify, open PRs, fix CI, and
merge. Optimize for throughput with a green main branch. **[docs/DOCTRINE.md](docs/DOCTRINE.md)**
is the direction (principles, escalation, and where the repo still falls short of them);
this file is how the work is done.

## Loop

1. **Understand**: read the issue/prompt, then the code it touches. Don't ask
   questions you can answer from the repo; pick the conventional default and say so.
2. **Branch**: work on a `claude/<short-topic>` branch cut from the default
   branch. Never commit directly to the default branch.
3. **Build**: make the smallest change that fully solves the task. Add or update
   tests alongside behavior changes.
4. **Verify**: run `scripts/check.sh` until it passes. A task is not done while
   checks fail. For UI or runtime behavior, actually run it, and look as well as
   measure: capture frames and look at them, not only the numbers. Show every new
   check fails when what it guards breaks (break it once, see red, put it back);
   a test that cannot fail proves nothing. Before a non-trivial change ships, someone
   other than its author checks it (a verifier agent counts).
5. **Ship**: commit (Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`,
   `refactor:`, `test:`, `ci:`), push, and open a PR. Pushing a `claude/*`
   branch auto-opens a PR and merges it right away (`.github/workflows/autopilot.yml`).
   Merges don't wait for CI: there are no required checks, by choice. That is why
   step 4 matters.
6. **Drive to green**: CI then runs on `main`. If it goes red, the merge is reverted
   automatically (CI's `revert-red-main` job) and the change has to land again with a fix
   (an issue labeled `claude` tracks it). CI failures, revert PRs and review
   issues about your change are your job.

## Commands

| Task | Command |
| --- | --- |
| All checks (lint, types, tests, models, clip metrics, build) | `scripts/check.sh` |
| Fast checks only (Stop hook) | `scripts/check.sh --fast` |
| Browser e2e (CI runs the groups in parallel) | `npm run build && npm run test:e2e [-- <suite or @group>]` |
| Install deps | `scripts/session-start.sh` (runs automatically in cloud sessions) |

`scripts/check.sh` auto-detects the stack (Node, Python, Go, Rust) and runs
whatever exists. When you add a stack, wire its lint/test/build into the
standard entry points (`package.json` scripts, `pyproject.toml`, etc.) so the
script and CI pick them up with no extra config.

## Rules

- **Green main is the only hard rule.** Everything merges through a PR; CI runs on
  `main` after each merge and a red `main` is reverted automatically.
- Never skip, disable, or weaken a test to get green. Fix the cause.
- Never commit secrets. Use environment variables; document them in `README.md`.
- Never force-push the default branch or rewrite shared history.
- Keep PRs focused: one concern per PR. Several small PRs beat one large one.
- Label a PR `hold` to stop Autopilot merging it.
- One obvious way to do each thing: extend what the engine already has before adding a
  second way to do the same job.
- New systems keep their state plain, serializable data where they reasonably can
  (doctrine principle 1), so it can later be saved, restored and replayed.
- Escalate as [docs/DOCTRINE.md](docs/DOCTRINE.md#escalation) says: a reversible call may be
  made after 15 minutes without an answer; anything irreversible or outside the project
  (money, credentials, licences, publishing, deleting data or shared history) waits. Record
  each one in an issue labelled `escalation`, linked from the PR.
- If blocked on something only a human can do (credentials, billing, account
  settings), say exactly what is needed in the PR or issue and move on to
  the next task.

## Stack

WebGPU-first pixel-art game engine: Vite + TypeScript, `three@0.186.0`
(`three/webgpu` + `three/tsl`), `@dimforge/rapier3d@0.20.0` (wasm loaded separately), local GLBs.
**Read `docs/ENGINE.md` before touching rendering.** It holds the pipeline contract,
the game API and the agent tooling. **Read `docs/ANIMATION.md` before touching
animations**: never guess a pose. After every change, run `npm run anim -- check` and look at
the contact sheet and motion curves (`npm run anim -- sheet <clip> --compare`, `curves <clip>
--compare`). For anything that plays in the game, also look at a film
(`npm run film -- <scenario>`): it shows transitions, blends and speed matching, which
isolated clips can't.

| Path | What |
| --- | --- |
| `src/engine/` | Engine (public API in `src/engine/index.ts`) |
| `src/engine/render/PixelRenderer.ts` | The one `WebGPURenderer` + `RenderPipeline`, pixel/raw modes, filters, capture |
| `src/engine/render/filters.ts` | TSL post filters (palettes, dither, CRT, LCD, VHS, …) |
| `src/engine/camera.ts` | Camera presets: iso, topdown, side, third, first, free/fixed |
| `src/engine/character/` | `PlatformerCharacter` core, the state table (`states.ts`), every tuning number (`tuning.ts`), default key map |
| `src/engine/animation/` | Animation toolkit: clip format, foot IK, gait generator, compiler, flip-free cross-fades (`RotationBlend`), metrics, contact sheets, motion curves |
| `src/game/hero/` | Hero rig spec (`rig.ts`) and every hero clip as data (`clips/`, one file per family; `animations.ts` re-exports `HERO_CLIPS`) |
| `scripts/anim.ts` | `npm run anim -- check / sheet / curves / diff / overview / pose`: measure and look at animations |
| `scripts/film.ts` | `npm run film -- <scenario>`: film the real game frame by frame (filmstrip, timeline, pops/slips, GIF); exits 1 if a scenario never reaches a state it waits for |
| `src/lab/`, `lab.html` | Animation Lab page: preview, scrub, metrics, sheets, `window.__ANIM_LAB__` |
| `src/engine/framing.ts` | Integer scaling / letterbox math (unit-tested) |
| `src/game/playground.ts` | Movement demo (`?game=playground`): a station for every move, a complete example of the `Game` API |
| `src/riftlight/showcase/` | Other genres inside Riftlight, as templates: a side-scroller (`?game=arcade`), a first-person gallery, photo mode (docs/GAME.md, *Showcase*) |
| `src/world/` | Engine World (`?game=world`, docs/WORLD.md): the engine's tech demo, a room per technique (each room its own `Game`, data + a building kit), station guides, `window.__WORLD__`; e2e in `scripts/e2e-world.mjs` |
| `src/riftlight/game/` | Riftlight, the default game at `/`: the `Riftlight` shell (flow, saves, difficulty, camera, music), the ports to gameplay systems (`ports.ts`) and their stubs (`stubs/`), `window.__RIFTLIGHT__` (`api.ts`), the playtest bot (`bot.ts`). See docs/GAME.md, Game shell |
| `src/riftlight/town/` | Emberfall, the town hub: layout as data, the primitive kit, townsfolk models on the hero rig and their clips as data (`npm run anim -- check` covers them) |
| `src/riftlight/ui/` | Pixel HUD, menus, panels and the UI kit on the engine Hud (`ui/tree`, `ui/items` are the tree and loot views) |
| `scripts/riftlight/playtest.ts` | `npm run playtest -- <depth> [--runs n] [--film]`: the bot plays the real game, reports clear time, deaths, loot |
| `scripts/generate-assets.mjs` | Deterministic GLB generator (`npm run assets`); hero rig (geometry + joints only) in `scripts/assets/hero.mjs` |
| `scripts/forbidden-apis.mjs` | Guardrail run by `npm run lint` |
| `src/bundle.ts`, `scripts/bundle.mjs`, `docs/GUIDE.md` | The engine kit for agents outside this repo (`npm run bundle`): one-module `pixel-engine.js`, the guide (its named code blocks become pages; `src/guide.test.ts` keeps its names true), a generated `API.md`, `check.mjs`. Engine changes a game can see bump the version and add a `CHANGELOG.md` section |
| `scripts/e2e.mjs` | Browser verification (`npm run build && npm run test:e2e`); moves in `scripts/e2e-moves.mjs`, the Riftlight shell in `scripts/e2e-riftlight.mjs`; engine suites open `?game=playground` through `urlFor` |

Hard constraints (enforced by lint): no `WebGLRenderer`, `EffectComposer`,
`ShaderPass`, `RenderPixelatedPass`, `(Raw)ShaderMaterial`, `onBeforeCompile` or GLSL;
all shader logic in TSL; no React or external engines; version pins exact. Pixel
snapping is camera/presentation only, never physics. Any rendering change must keep
`npm run test:e2e` green on both the WebGPU and WebGL 2 fallback scenarios.
