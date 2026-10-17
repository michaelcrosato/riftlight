# Plan: gameplay without a browser

Temporary. Execute top to bottom; delete this file in the last PR. Audit and spike of 2026-10-17
at `99a9f4a`, reviewed by the `verifier` subagent.

Goal: doctrine principle 2, "Gameplay runs without a renderer or a browser". Every game runs in
Node with the same `Engine` class and the same game code, and with no GPU, DOM, Vite server or
Chromium. Tests and tools step it, inject input, query state, save, restore and replay it, and get
the browser's results bit for bit, which CI checks.

Pictures stay in the browser (principle 6). A headless run has no frames: `look`, `film` and the
pixel checks keep Chromium.

"Headless" here means no renderer and no page. three.js's scene graph (objects, skinning,
`AnimationMixer`) and Rapier still run, because they are libraries doing JS and wasm math. There is
no second simulation either. A headless frame is the page's frame (`frameStep` → physics → `update`
→ camera → particles) with only the drawing skipped. So whatever presentation feeds into gameplay
(below) stays exactly the same.

## Evidence: a spike

A throwaway vitest file built the `Engine` around a 30-line stand-in renderer and three shims:
- `window`, for `Input`'s constructor;
- `ProgressEvent`, for three's `FileLoader`;
- `document.pointerLockElement`, for `setCamera`.

Results (4-core VM, Node 22.22, vitest 5.0.2):

| What | Result |
| --- | --- |
| Riftlight boots (town, packs, hero) | 0.6 s; entering depth 1 takes 0.9 s |
| The playtest bot clears depth 1, seed 1 | 2,255 frames in 3.5 s: 650 frames/s, 11× real time |
| The same run in Chromium (`npm run playtest -- 1`) | Identical report (frames 2,255, kills 38, damage 155, XP 3,843, gold 77, items 10, stuck 5); 13.8 s wall |
| The same run under tsx (how a headless CLI runs) | Identical report; 7.2 s wall (imports 2.0 s, boot and entering 1.4 s, bot 3.2 s) |
| Depth 2: snapshot, play 240 frames; restore, play 240 frames | Same fingerprint; the snapshot is 209 KB; restore takes 123 ms |
| Snapshot and restore on all 12 designed depths | All hold; 26 s on one worker (e2e `riftlight-snapshot` takes 54 s in CI) |
| A Playground recording, replayed | Same fingerprint; with one frame edited, a different one |
| Each Engine World room loaded and played 120 frames | 38 of 42 pass (see the four failures below) |
| Renderer members the engine read | `resolution`, `framing`, `screen`, `filters`, `setFilters`, `container` |

The four rooms that failed:
- sprites: `drawSheet` paints on a DOM canvas;
- gallery and workshop: they read `location.search`;
- swarm: GPU compute.

## Baseline (CI run #218 at `99a9f4a`)

| What | Now |
| --- | --- |
| e2e | 26 suites, 1,351 checks, 1,153 suite-seconds; wall 521 s, on the critical path `asset-lab` at 473 s |
| Gameplay-heavy e2e suites (s) | riftlight 90, world 71, riftlight-snapshot 54, riftlight-levels 18, riftlight-builds 13, riftlight-replay 12, riftlight-showcase 11, riftlight-loot 9, riftlight-combat 6, riftlight-monsters 6, moves 3 |
| e2e checks that read only gameplay state | ~360 of ~785 check sites, plus ~110 mixed (input through `page.mouse` / `page.keyboard`, or ANDed with pixels) |
| Checking a gameplay change | `npm run build` + an e2e group: 80–230 s in CI, longer locally; never in the Stop hook |
| `npm test` | 122 files, 1,202 tests, 58 s |
| Tests that fake the game's context by hand | 6 files (2 cast `as unknown as GameContext`, 5 `as unknown as ShellServices`): `riftlight/wire/{levelSave,monsters-saved,loot-tree}`, `riftlight/town/{town,outskirts,nopacks}` |
| `npm run playtest -- 1` | Vite dev server + Chromium: 13.8 s |

## Where presentation feeds gameplay (headless must match it)

- **Riftlight's one random stream also feeds presentation.** `services.rng` supplies screen shake
  (3 numbers per rendered frame while shaking, `Riftlight.ts:1276`), damage-number jitter (`:288`)
  and sound pitch (`:281`, `:302`, `:657`). Loot rolled afterwards depends on those draws. So
  headless runs `update()` exactly as a page does, with the same play settings (zoom, shake, damage
  numbers: `game/settings.ts:66-79`).
- **Aim and movement go through the camera at `renderer.resolution`** (`game/controls.ts:167-180`,
  `:246-252`). HUD hit tests and loot labels are laid out in art pixels. In a page the art size
  comes from the viewport: `computeFraming(width, height, devicePixelRatio, baseResolution,
  aspect)` (`PixelRenderer.ts:475-479`). A recording replays the same only on the same viewport.
- **The bot bypasses `ctx.input`.** The bot writes `game.botIntent` directly (`game/api.ts:220`),
  and so do `rl.step(n, intent)` and `moveTo` (`:117, 152, 168`). A bot run is therefore not in its
  recording. Compare bot runs by their report (same seed), not by replaying them.

## Rules for every phase

- One concern per PR, in order. `scripts/check.sh` green and the `verifier` subagent before each
  push. After the merge, wait for CI on `main` to pass before the next phase; a red, reverted main
  is fixed and re-landed first.
- Every new check is shown to fail once: break it, see red, restore. Each guard is covered by a
  headless test that goes red when the guard is reverted.
- Put before/after numbers in each PR body.
- An engine change a game can see bumps the version and adds a `CHANGELOG.md` section.
- **No polyfills in headless tests and tools.** None of them stubs `window`, `document`, `location`
  or `ProgressEvent`, or calls `vi.stubGlobal`; fix the code that reads them instead.
  `src/engine/replay.test.ts:193-195` stays: it is a DOM test of `attachPointer`.
- **One engine at a time per test file.** Module state outlives an engine: the asset caches
  (`assets.ts:14-17, 64`), World's `shell` singleton (`world/shell.ts:414`: visited, busy, room),
  and handles like `__RIFTLIGHT__` (the last writer wins). All boots share one readiness
  (`Engine.ts:626-627`), so never start two at once. Reset the shell between rooms, or use one
  file per wing.
- vitest's default per-test timeout is 5 s. Give headless tests their own, and keep each test
  file at or under 15 s in CI (split by depth range or room wing).
- Timing checks that move into `src/` need `// real time: <why>` comments, because the lint scans
  tests too.
- AGENTS.md has ~370 bytes left under its 11 KB cap (`src/docs.test.ts`). Make room before adding
  rows.
- Nothing outside this file cites `docs/plans/headless.md`; deleting it in Phase 5 must not break
  `src/docs.test.ts`.

## Phase 1: `Engine.headless`

1. **A `View` interface** (`src/engine/render/view.ts`): PixelRenderer's public members minus its
   GPU handles (`renderer`, `pipeline`), with `container: HTMLElement | null`.
   - `PixelRenderer implements View`, and `engine.renderer` becomes a `View`.
   - Export `View` from `src/engine/index.ts`, and widen `BackendName` (`PixelRenderer.ts:50`,
     exported at `index.ts:217`) with `'headless'`.
   - `engine.gpu: PixelRenderer | null` (null when headless) gives direct GPU access.
   - The GPU helpers take the `View` and do nothing headless: `Mirror.attach`, `RenderView.attach`
     and `GpuSwarm.update`. Game code and the GUIDE examples stay the same in both runtimes, apart
     from `swarm.update(engine.renderer, dt)`.
     - `attach` registers its `onBeforeRender` hook as it does now and reaches the WebGPU renderer
       inside the hook, which a `HeadlessView` never calls.
     - `GpuSwarm.update` returns early when `backend` is `'headless'`.
     - `mirror.ts` and `renderView.ts` check `backend`, or import `PixelRenderer` as a type only:
       `PixelRenderer.ts:21` imports `renderView.ts`, so a runtime import back would be a cycle.
   - These move to `engine.gpu`, typechecked:
     - the readbacks at `world/rooms/swarm.ts:117` and `world/rooms/views.ts:217, 226`;
     - the canvas at `riftlight/game/controls.ts:128` and `labs/monster-lab/main.ts:366`;
     - DebugUI's `container.appendChild` (`DebugUI.ts:91`). DebugUI is page-only, so headless never
       builds it.
   - Null containers, compile-safe now (they work headless in Phase 2): `ui/items/ItemsUi.ts:182-190`
     and `riftlight/wire/tree.ts:60`.
   - The callers of `mirror.attach` / `view.attach` (`world/rooms/views.ts:100, 123`) stay as they
     are.
   - Update the docs that show the old calls:
     - `docs/GUIDE.md:389-391` (1,250 characters are left under `src/guide.test.ts`'s cap);
     - `docs/engine/render.md:124-131`;
     - the JSDoc that says "the engine's PixelRenderer" (`render/mirror.ts:162`,
       `render/renderView.ts:77`) and `render/gpuSwarm.ts:9`.
2. **`HeadlessView`** (`src/engine/render/headlessView.ts`), with no GPU and no DOM:
   - It holds a viewport `{ width, height, dpr }`, by default 960×540 at DPR 1. That is the
     riftlight-replay page's size, and it gives Riftlight's `fill` 480×270.
   - Framing goes through one function that both views call: `layout()`'s math (`PixelRenderer.ts:476-485`),
     moved out, including the rule that keeps `baseResolution`'s identity when the art size equals
     it. It re-runs on `setResolution` / `setAspect` (`:428-440`), so settings that change the art
     size (pixel size) change it here too.
   - Look, filters, mode and edges are kept as data: setters store them and `lookVersion` counts.
   - A real `ScreenFx`: transitions advance with `step()`, and `cover()` / `reveal()` resolve.
   - `render`, `precompile` and `setAnimationLoop` do nothing. `onBeforeRender` keeps its hooks
     without calling them.
   - `capture()` rejects with `headless: no pictures (npm run look, npm run film)`.
   - `container` is null and `backend` is `'headless'`.
3. **`Engine.headless(game, options)`**, sharing one private boot sequence with `Engine.start`.
   Only the view and the page parts differ, so the two can't drift.
   - No LoadingScreen, DebugUI, TouchControls, SettingsPanel or error box. Errors go to
     `engine.errors` and the console. `showDebug` and the debug hotkey do nothing headless:
     Riftlight's Debug info setting reaches `showDebug` through `ui/menus.ts:209` and
     `Engine.ts:593-595`.
   - It calls `settings.start()` with no URL options. Without it, `settings.set()` never applies
     (`settings.ts:203`), for example Riftlight's Pixel size (`ui/menus.ts:206`).
   - No event listeners: `Input` and `AudioManager` get no target, so there is no AudioContext.
     `audio.counts` still counts.
   - Manual time from the start, driven by `step()`.
   - `__PIXEL_READY__` resolves and `__PIXEL_ENGINE__` is set on `globalThis`, as in a page.
   - Player settings are not stored unless `settings.key` is given.
4. **Assets without `fetch`.** One process-wide reader, `setAssetReader((path) =>
   Promise<ArrayBuffer>)`. It must be process-wide because `loadModel` and `loadPack` are free
   functions over a module cache.
   - `loadModel`, `loadPack`, `loadPackIndex` and `preloadModels` use it (`assets.ts`). Headless,
     `loadPackIndex` (`:105-109`) would otherwise empty the shelves of the gallery and workshop
     rooms (`world/rooms/shelves.ts:70-73`).
   - GLBs parse with `GLTFLoader.parseAsync`. three's `FileLoader` creates a `ProgressEvent`, which
     Node lacks, and the load never settles.
   - Packs parse with `JSON.parse`.
   - `nodeAssets(root = 'public')` lives in `src/engine/node.ts`, a Node-only module that the
     browser index never imports. It returns `buf.buffer.slice(byteOffset, byteOffset +
     byteLength)`, because `parseAsync` rejects a Node `Buffer`.
   - `Engine.headless` never imports `node.ts`. A static import would put `node:fs` in the page,
     and the kit and single-file builds inline dynamic ones (`codeSplitting: false`:
     `scripts/bundle.mjs:99`, `scripts/build-single.mjs:27`).
     - Node entry points pass `assets: nodeAssets()`: the headless tests, `headlessRiftlight`,
       `replay.ts` and playtest.
     - An asset load with no reader throws, naming `nodeAssets`.
   - One Node way to load packs: `loadPacksSync` (`riftlight/nodePacks.ts`) and `loadPack` share
     parsed packs.
     - Its users are `riftlight/levels/validate.ts:119`, `scripts/inspect.ts`, and the tests in
       `levels/affixes`, `levels/themes/props` and `town/outskirts`.
     - Today it adds its own defs to `MODEL_LIBRARY`, and `Catalog.add` throws on an id held by
       another object (`catalog.ts:26`).
     - The `packs` cache holds promises (`assets.ts:64`) and `loadPacksSync` is synchronous. So
       `loadPack` also keeps a map of settled parses, which `loadPacksSync` reads, and
       `loadPacksSync` seeds `packs` with resolved entries. Either order then adds the same def
       objects.
   - The page's path is unchanged.
   - `world/rooms/gallery.ts:61-64` and `workshop.ts:244` quote `assets.ts`, pinned by
     `src/world/world.test.ts:36-46`. Update the quotes with the code.
5. **Guards** the headless path reaches:
   - `Input`'s default target is `window` (`input.ts:198`; the field is at `Engine.ts:322`).
   - `setCamera` reads `document.pointerLockElement` (`Engine.ts:760`), and every World room calls
     it.
   - `reportError` assumes a container (`Engine.ts:1372`); a game hook throwing during a replay
     reaches it.
   - `Hud.sync` returns before it records `size` when there is no container (`hud/Hud.ts:92-95`),
     so the HUD lays out at 480×270 whatever the view.
   - `drawSheet` paints on a DOM canvas (`render/sprites.ts:39`). Headless keeps the frames and
     gives a blank texture.
   - The headless path never reads `import.meta.env` (`assets.ts:133`, `Engine.ts:1526`), because
     tsx tools have none.
6. **`Recording.view`**, the viewport a recording was made on (`{ width, height, dpr }`).
   `replay()` applies it to a `HeadlessView` before `start()`. In a page, `replay()` warns when the
   viewport differs, since pointer aim depends on it.
7. **Release notes and docs:**
   - the version bump and a CHANGELOG section (`Engine.headless`, `View`, `engine.gpu`, helpers
     that take the view, `setAssetReader` / `nodeAssets`, `Recording.view`);
   - `docs/engine/headless.md`, a new topic listed in docs/ENGINE.md, with `.claude/rules/engine.md`
     mapping `render/headlessView.ts` and `node.ts` to it;
   - the viewport in docs/engine/determinism.md *Recording and replay*;
   - a GUIDE.md line: `Engine.headless` runs in this repository's tests, but the kit doesn't run in
     Node yet (follow-up below).

Accept:
- `src/engine/headless.test.ts` checks all of this:
  - Playground boots headless;
  - 200 frames of `input.setKey` move and jump the hero;
  - the recording replays (`engine.replay(rec, () => engine.loadGame(new Playground()))`) to the
    same fingerprint;
  - with one frame's keys edited, the recording ends elsewhere;
  - a small test game with `snapshot` / `restore` (a body, `ctx.random`) keeps its fingerprint
    across a round trip through JSON;
  - `capture()` rejects, `engine.gpu` is null, and `state().backend` is `'headless'`.
- The shared framing function has a unit test against hand-computed sizes (`fill`, `adaptive`,
  `fixed`, two pixel sizes, DPR 1 and 2). It covers the baseResolution-identity rule.
- The headless tests stub nothing. A grep of them for
  `stubGlobal|\b(window|document|location|ProgressEvent)\s*(\?\?)?=([^=]|$)` prints nothing, and
  goes red once when the spike's `window` shim is pasted in.
- `npm run build && npm run test:e2e` passes in full, because boot, assets, Hud, sprites and
  PixelRenderer change for every page.

## Phase 2: Riftlight headless, `npm run replay`, parity with the browser

1. **Riftlight and its labs under `Engine.headless`:**
   - **The passive tree.** Headless, `TreePanel` opens with its `TreeState` (the layer stack is as
     in a page) and performs `rl:'tree'` actions itself. Activate, refund and close move out of
     `TreeView` (`ui/tree/TreeView.ts:276-281, 648-697`) into `TreeState` or the panel, shared with
     `TreeView`, which is built only when there is a container. Today the actions apply only
     through the view (`wire/tree.ts:93`), so a headless replay would drop them.
   - The item windows keep their state and layout and skip their canvas when there is no container
     (`ui/items/ItemsUi.ts:182-190`, `:1132-1151`).
   - Save export/import (`Riftlight.ts:749-786`) does nothing headless.
   - The page globals go to `globalThis`, or get guarded:
     - `game/api.ts:474`;
     - `loot/lootlab.ts:97, 172`;
     - `showcase/arcade/ArcadeGame.ts:52, 65`;
     - `levels/levelLab.ts:83, 102` (`location.search` in setup) and `:104, 237`
       (`__LEVEL_LAB__`);
     - `showcase/bestiary/BestiaryMode.ts:148, 374` (`document.pointerLockElement`, every bestiary
       frame).
   - Photo mode doesn't capture headless. `showcase/photo/PhotoMode.ts:218, 277` call
     `void this.capture()`. Headless, the rejection is unhandled, which fails vitest and exits tsx.
     `capturing` also stays true, since `:232-234` has no `finally`.
   - The labs (LootLab, LevelLab, Arena) take their URL choices (god, depth, skills) as constructor
     options, so tests run `Engine.headless(new LevelLab({ depth: 3 }))`.
2. **`headlessRiftlight({ seed?, viewport? })`** (`src/riftlight/headless.ts`) returns
   `{ engine, game, rl }`.
   - `rl` is the same `RiftlightApi` that tools get from `window.__RIFTLIGHT__`.
   - Saves stay in memory (`new SaveStore(null)`).
   - It is the one way tests and tools boot Riftlight in Node. `npm run replay` uses it for
     Riftlight's recordings.
3. **One games table**, `src/games.ts`: `{ id, name, make, options }`. It replaces `GAMES` and
   `OPTIONS` in `src/main.ts:18-33`; main.ts and `npm run replay` both read it.
   - Look a game up by `Game.name`, which is what `rec.game` holds (`Engine.ts:1076`): `'Riftlight'`,
     `'Move Playground'`, `'Rift Runner'`, and `Engine World: <title>` for each room.
   - Rooms are found by title (all 42 are unique) and built with `WORLD_OPTIONS`.
   - Without a game's options (its camera above all), a replay aims through another camera.
   - `window.__PIXEL_GAMES__` (`main.ts:48`) keeps its `{ id: () => Game }` shape, derived from the
     table. e2e suites call it (`e2e-riftlight-replay.mjs:104, 232`,
     `e2e-riftlight-snapshot.mjs:39`, `e2e-systems.mjs:313`, …), and docs/engine/game-api.md:64
     documents it.
   - **`Game.args`** (engine: version bump and CHANGELOG) is the plain JSON a game was made with.
     It is kept in `Recording.args` and passed back to `make(args)`. A name alone can't rebuild:
     - LevelLab's depth, seed, god and zoom (`levels/levelLab.ts:59-60, 83, 102-103`);
     - the Arena's skills (`combat/arena.ts:169`);
     - the door a room was entered by (`RoomGame.arrivedFrom`; `world/rooms/atrium.ts:212` spawns
       the hero there).
4. **`npm run replay -- <recording.json> [--frames n] [--expect <fingerprint>] [--json]`**
   (`scripts/replay.ts`, tsx with `registerEngineHooks` before any import):
   - It boots the recorded game headless on the recording's viewport.
   - It prints the fingerprint, `engine.state()`, the game's own state (Riftlight's is `rl.state()`)
     and errors.
   - It exits 1 on a hook error or when `--expect` doesn't match.
5. **Parity in CI.** e2e `riftlight-replay` writes its browser session to
   `.scratch/e2e/riftlight-replay.json` and runs `npm run replay -- … --expect <the browser's
   fingerprint>`. That session (`e2e-riftlight-replay.mjs:101-215`) covers:
   - New Run by mouse;
   - a fight aimed with the mouse;
   - menus;
   - the tree through the DOM (`:176-215`), which reaches the game as `rl:'tree'` commands.

   It is a 960×540 page at DPR 1, so it matches the default viewport too. tsx is a devDependency,
   and e2e.mjs already spawns it.

Accept:
- `src/riftlight/headless.test.ts` checks that:
  - the bot clears depth 1 (seed 1) with no hook errors;
  - a mid-level snapshot, restored and played on, keeps the fingerprint;
  - the inventory, stash and vendor open and close;
  - a tree node allocated by an `rl:'tree'` command lands in the save.
- The parity check passes, and fails once when one recorded frame is edited.
- A LevelLab recording (`depth: 3`) and a room entered by a door replay to their fingerprints
  through `Recording.args`.
- `npm run replay -- --help` prints its manual, and the `tools` suite's CLI list includes it.
- Docs: docs/engine/headless.md *Replaying a recording*, `headlessRiftlight` in
  docs/game/shell.md, and an AGENTS.md row for `npm run replay`.

## Phase 3: playtests without a browser; real engines in tests

1. `npm run playtest` runs headless, with no server and no Chromium, unless `--film`, `--gif` or
   `--browser` is given.
   - `--runs n` spreads its runs over forked tsx processes: `child_process.fork(file, { execArgv:
     process.execArgv })`, each child calling `registerEngineHooks()` and importing the game in
     ~1 s.
   - The pool size is set by `--jobs n`, default `os.availableParallelism()`.
   - Worker threads won't do. Under tsx 4.23 they fail on the engine's extensionless imports, and
     `registerHooks` is per thread (measured).
   - The campaign stays sequential: each try farms and carries the save of the last
     (`playtest.ts:358-437`).
   - The output is unchanged.
2. Parity: an e2e check that `playtest -- 1 --json` prints the same report headless and with
   `--browser`.
3. The 6 hand-built contexts listed in the baseline switch to `Engine.headless` or
   `headlessRiftlight`, unless faking is the point of the test (say why in a comment).

Accept:
- The report parity check passes, and fails once with another seed.
- Record wall times before and after for `playtest -- 1` and `playtest -- 3 --runs 8`.
- `git grep -lE 'as unknown as (GameContext|ShellServices)' -- src` prints nothing, or only
  commented exceptions.
- Record `npm test` time before and after.

## Phase 4: Riftlight's gameplay checks leave the browser

Port these to vitest, next to the code they check. Use `headlessRiftlight`, or `Engine.headless`
with a lab, and `engine.input`'s hooks (`analog` at `src/engine/input.ts:162`; `setKey`,
`setPointer`, `setButtons`, `send` at `:488-574`) in place of `page.keyboard` / `page.mouse`:
- riftlight-snapshot (all but the picture-only paths), riftlight-builds, and riftlight-combat (the
  Arena);
- the gameplay checks of:
  - riftlight and riftlight-items;
  - riftlight-loot (the LootLab);
  - riftlight-levels (the LevelLab: build, autopilot, encounters, portal);
  - riftlight-showcase (arcade and bestiary; not photo mode).

riftlight-monsters stays in the browser. `MonsterLab` lives in a page entry that runs
`getElementById` and `Engine.start` at import (`labs/monster-lab/main.ts:65, 602-604`).

Move, don't copy: a ported check leaves its e2e suite in the same PR. Suites keep their pixel and
DOM checks and one browser run of each flow. Wall-clock limits written for the browser
(`e2e-riftlight-snapshot.mjs:281, 378`, `e2e-riftlight-levels.mjs:108`) either get Node budgets or
stay in the browser.

Accept:
- A table in the PR, one row per suite: e2e checks before and after, vitest tests added, CI seconds
  before and after.
- Each new test file shown to fail once.
- Every e2e group passes.
- `npm test` time before and after.

## Phase 5: Engine World and engine checks leave the browser; the doctrine

1. **World rooms headless.**
   - `rooms/gallery.ts:180` and `rooms/workshop.ts:591` read `location.search` unguarded.
   - `rooms/sandbox.ts:135, 143` use `localStorage`; check that they are guarded.
   - The GPU rooms (swarm's compute, views' readback) say they need `engine.gpu` and are skipped
     headless.
2. **Port as in Phase 4:**
   - world's gameplay checks (~108: physics, genre, AI, procedural, workshop, replay and save-state
     wings);
   - moves (32);
   - the gameplay checks of systems (audio counts, particles, triggers, pause, a load from
     `update`);
   - the rig-state checks of cameras.

   These stay in the browser:
   - **The gamepad check.** `frameStep` polls `navigator.getGamepads` itself every frame
     (`Engine.ts:904`, `input.ts:641-674`), so pads passed by hand are wiped. Decoding pads is
     already unit-tested (`input.test.ts:60`).
   - **Checks of the live `requestAnimationFrame` loop:** `e2e-world.mjs:690-727` and `:808-815`,
     and systems' loop checks.
3. **Docs:**
   - docs/DOCTRINE.md *Where this repository stands*: principle 2 is met (headless runs three.js's
     scene graph and Rapier in Node; the GPU, the DOM and audio output are presentation).
     Principle 1's open items stay as they are.
   - AGENTS.md: gameplay is checked headless first; the e2e suites hold pixels and the DOM.
   - `.claude/rules/{engine,riftlight,world}.md` name the helpers.
4. Delete this plan.

Accept:
- Everything from Phase 4's list.
- The full `npm run test:e2e` passes, and CI is green on `main`.

## Cost and benefit

Benefits:
- **Gameplay is checked before the push.** Ported checks run in `npm test`, `scripts/check.sh` and
  the Stop hook (`vitest related` picks them by import graph). They take seconds, need no build,
  server or browser, and a failure prints an assertion instead of a browser log.
- **The browser suites shrink.** e2e loses ~340 checks and up to ~200 suite-seconds (each suite
  keeps its browser start-up), and vitest gains an estimated 60–120 CPU-seconds (+20–40 s wall on
  4 workers). CI wall-clock stays about the same, since `asset-lab` is the critical path.
- **Playtests need no server or browser.** One run drops from 13.8 s to ~7 s. The bigger gain is
  that runs go in parallel, one per core (~4× throughput on 4 cores).
- **A recording from a page replays in Node** (`npm run replay`), so a recorded bug becomes a vitest
  test.
- **Tests use the real engine** instead of 6 hand-made contexts that drift.
- **Doctrine principle 2 is met.**

Costs:
- **Five PRs, one per phase.** The work, by kind:
  - engine work, ~500–800 lines with tests (`View` and its fallout, `HeadlessView`, the shared boot,
    the asset reader, the guards, `Recording.view`, `Game.args`);
  - game changes, ~200–300 lines (the tree's actions out of its view, the labs' options, the page
    globals);
  - the games table, the replay CLI and the headless playtest, ~400 lines;
  - porting ~3,000 lines of e2e scripts into vitest, the largest and most mechanical part.
- **Ongoing:**
  - gameplay runs in two runtimes, which the parity checks guard;
  - `npm test` takes +20–40 s;
  - the Stop hook runs more tests whenever an engine or Riftlight file changes, because the headless
    tests import the whole game.
- **Risk is low.** Nothing beyond the three shims broke in the spike. Node 22 and Chromium gave
  identical results for 2,255 frames of combat (the same V8 math, the same Rapier wasm), and the
  parity checks catch any future divergence.
- **The cheapest useful slice is Phases 1–3**, less than half the work. It delivers the headless
  engine, Riftlight, replay, playtests and parity. Phases 4–5 move the existing checks.

## Not in this plan

- **Pictures headless:** frames need WebGPU (principle 6), so `look`, `film` and the pixel checks
  keep Chromium.
- **A pure-data simulation without three.js objects:** that is principle 1's long road, and
  headless works without it.
- **MonsterLab headless:** first move it out of its page entry.
- **Follow-up issues.** File these without the `claude` label, since that label starts an agent:
  - The kit's `pixel-engine.js` in Node, so agents outside this repo can test their games headless.
    That means:
    - Rapier's inlined wasm (`physics/rapierWasm.ts` reads a file in Node);
    - CSS injected at import;
    - `check.mjs --headless`;
    - a GUIDE.md section.
  - Riftlight's presentation draws from gameplay's random stream (`Riftlight.ts:281, 288, 302,
    657, 1276`). Give shake, damage-number jitter and sound pitch their own fork, so display
    settings never change loot (principle 1).
  - The bot and `rl.step(intent)` bypass `ctx.input` (`game/api.ts:117, 152, 168, 220`), so a bot
    run can't be replayed from its recording.
  - CI's critical path is `asset-lab` (240 s and 473 s in two consecutive runs on near-identical
    code). Split it.
