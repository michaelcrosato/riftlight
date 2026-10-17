# Tooling for agents

## Runtime handles

- `await window.__PIXEL_READY__`: the one readiness signal. It exists before the engine starts,
  resolves with the engine once `Engine.start` has finished (`__PIXEL_ENGINE__` and the handles a
  game sets in `Game.ready` exist by then: `__RIFTLIGHT__`, `__WORLD__`, `__ARCADE__`,
  `__LOOTLAB__`; the labs set theirs just after) and rejects with the reason a start failed.
  `step()` before it throws; during a later `loadGame` it runs 0 frames.
- `window.__PIXEL_ENGINE__.state()`: backend, mode, resolution, aspect, framing, frame
  count, fps, maxFps, quality, GPU errors and recoveries, camera, player target, game speed,
  hitstop, the screen effects (transition, progress, flash, rings) and game status.
- `await window.__PIXEL_ENGINE__.renderer.capture()`: RGBA8 readback of the exact frame
  the pipeline presents, which lets you see what you built.
- `window.__PIXEL_ENGINE__.input.setKey(code, down)` / `.addPointer(dx, dy, wheel)`: drive
  input from scripts.
- `window.__PIXEL_ENGINE__.paused = true`: freeze simulation and animation (rendering
  continues), e.g. to capture an exact pose.
- `window.__PIXEL_ENGINE__.step(n)`: switch to manual time (`engine.manual = true`) and
  advance exactly `n` frames of 1/60 s: simulation, animation and camera. Then
  `renderer.capture()` shows the result. Recordings are frame-exact however slowly the
  browser renders. `npm run film` is built on it (see docs/ANIMATION.md). Set
  `manual = false` to hand time back to the render loop. `step()` ignores `paused` and the
  engine hotkeys (P, R, `, [ ], M); it only advances the game. `capture()` always shows the
  current state: it starts a fresh node frame, so the scene pass re-renders even when the
  loop already rendered in this animation frame (otherwise passes render once per frame).
- `?debug=1` shows the debug panel and turns the engine hotkeys on in a production build (both are on by default only in dev);
  `` ` `` creates it on demand. `?game=playground` / `?game=sandbox` open the engine demos (`/` is Riftlight;
  every `?game=` id: docs/engine/game-api.md *Level lifecycle*).
- `engine.audio.counts` / `.log` (sounds played, even when silent), `engine.particles.alive`,
  `engine.physics.counts()`, `engine.hud.canvas`, `engine.input.queuedPresses`.
- `hero.footPlacement()`: what runtime foot placement did this frame: pelvis drop, and per
  foot the offset from the clip, pitch, lock and step state. `npm run film` logs it.
- `physics.castDown(x, y, z, maxDistance, out, ignoreTags?, exclude?)`: a non-allocating
  ray straight down that fills `out` with the hit height, normal and collider handle.
- `hero.animationMix()`: the clips currently contributing to the pose, with their blend
  weight, time and rate. Blends are driven by `PlatformerCharacter` (rotations re-blended by
  `RotationBlend` so they never flip), not three's
  `crossFadeFrom`: every outgoing clip fades from the weight it has *now*, and
  locomotion-to-locomotion switches start in step with the outgoing stride.
- `engine.setFilters(ids)`, `engine.availableFilters`, `engine.setLook(look)`, `engine.look`,
  `engine.lookPresets`, `engine.camera.setZoom(z)`, `engine.camera.describe()`.

## Command-line tools

Each CLI's header comment is its manual: `help`, `--help` or `-h` prints it and does nothing else
(`scripts/manual.mjs`; the e2e `tools` suite checks every CLI). `--json` for machine output, exit 1
when a check fails. A script that opens the game uses `scripts/page.mjs`: `startServer` (the dev
server, or `vite preview` of the build; `--strictPort`, refuses a port someone else serves) and
`openPage` (collects console errors, awaits `__PIXEL_READY__`). One look at a page of the build:
`npm run look -- "?game=…" [--keys …]` (PNG + `report.json` in `.scratch/look/`).

| Command | Script | Docs |
| --- | --- | --- |
| `npm run test:e2e [-- <suite> \| @group]` | `scripts/e2e.mjs` (`-- --help` lists suites and groups) | below |
| `npm run anim`, `npm run film` | `scripts/anim.ts`, `scripts/film.ts` | docs/ANIMATION.md |
| `npm run model`, `npm run tex`, `npm run gate-b` | `scripts/model.ts`, `scripts/tex.ts`, `scripts/gate-b.ts` | docs/ASSETS.md, docs/assets/ |
| `npm run inspect -- <target>` · `diff <a> [b]` | `scripts/inspect.ts`, `src/engine/inspect/` | the script's header |
| `npm run monster`, `loot`, `tree`, `level`, `combat`, `balance`, `playtest` | `scripts/riftlight/` | docs/game/balance.md *Agent tools* |
| `npm run build:single` | writes `dist-single/pixel-engine.html`: one offline file (Rapier's `.wasm` inlined as a data: URL, the GLBs and every pack the code loads, cut to the models it names, in `__PIXEL_ASSETS__`) | |

**Browser e2e.** `npm run build && npm run test:e2e` runs the production build headless in
Chromium (`scripts/browser.mjs`, the one launcher every browser tool uses: Chromium's headless
shell by default, or `CHROMIUM_PATH`; with ANGLE on SwiftShader too, Chromium keeps WebGPU on
SwiftShader's Vulkan and presents). Frames are written to `.scratch/e2e/*.png`. Run one suite with
`-- <suite>`, a CI group with `-- @core` (`@cameras`, `@filters`, `@world`, `@assets`), and set
`E2E_PORT` when another run uses the default port. Software rendering runs at a few frames per
second, so suites wait for conditions, game time or `Engine.step()` frames, never for a fixed number
of rendered frames.

**`npm run inspect`** renders with the contact sheets' software rasterizer, not Chromium: about a
second with no GPU, byte-for-byte deterministic (fingerprints and diffs stay stable), with rig
overlays the real renderer has no pass for. The cost is fidelity: flat 3-band toon shading without
the pixel pipeline, lights or filters (a mesh whose shader colours it procedurally can carry
per-triangle preview colours in `geometry.userData.triColors`, see `presetTriangleColour` in
`animation/raster.ts`). For the real look, film it (`npm run film`) or open a lab page.

## Tools for agents: how to build your own

Every tool here (`anim`, `film`, `monster`, `loot`, `tree`, `level`, `combat`, `balance`,
`inspect`, `playtest`) has the same shape. Follow it and the next agent can use your tool
without reading its code:

1. **A pure core in `src/`**, importable by the game, the tests and the CLI: data in, data
   out, seeded (`Rng`, never `Math.random`), no DOM and no GPU (`src/engine/inspect/`,
   `src/riftlight/balance/`). It reuses the real code paths (the game's `buildSkill`, the
   engine's raster), so what it measures is what ships. Assumptions live in one named object
   and are printed with every result.
2. **A CLI in `scripts/`** run through `tsx` (`npm run <tool> -- <command> [--flags]`), whose
   header comment is its manual (`help` prints it). Text for people, `--json` for agents, the
   same numbers in both; exit 1 when a check fails (`check`, `validate`, `--strict`).
3. **Pictures**: a PNG in `.scratch/<tool>/` for anything spatial or over time (sheets,
   turntables, charts), drawn on `src/engine/animation/raster.ts` (`Canvas`: rects, lines,
   depth-tested triangles, outlines, the 5×7 font) and written with `scripts/png.ts`. Read your
   PNGs: an agent sees what it can look at.
4. **Machine output**: JSON (and CSV for tables) next to the PNG, with the inputs and the seed,
   so a result can be reproduced and diffed.
5. **A lab page** when a human or an agent needs to play with it live in the real renderer
   (`/lab.html`, `/asset-lab.html`, `/monster-lab.html`, `/tree.html`), with a `window.__<TOOL>__` handle.
6. **Tests**: unit tests for the core next to it (`*.test.ts`), and a smoke run of the CLI in
   the `tools` e2e suite (`scripts/e2e.mjs` `runTools`: it runs, writes its files, and the
   numbers are sane), so the tool can't silently rot.
