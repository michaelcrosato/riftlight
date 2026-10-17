# Headless: gameplay without a page

`Engine.headless(game, options)` runs a game in Node with the same `Engine` class, the same game
code and the same frames as a page (doctrine principle 2), with no GPU, DOM, Vite server or
browser. Tests and tools step it, give it input, read its state, save, restore and replay it.
Pictures stay in the browser (principle 6): `npm run look`, `npm run film` and the pixel checks.

```ts
import { Engine } from '../engine';
import { nodeAssets } from '../engine/node';   // Node only: the page never imports it

const engine = await Engine.headless(new Playground(), { seed: 7, assets: nodeAssets() });
engine.input.setKey('KeyD', true);            // input as a script gives it (setPointer, send, analog)
engine.step(120);                             // manual time from the start: nothing runs on its own
engine.state();                               // backend 'headless'; target, camera, errors...
const rec = engine.recording();               // with the viewport it ran on (`view`)
await engine.replay(rec, () => engine.loadGame(new Playground()));
engine.fingerprint();                         // the same as the page's for the same input
```

## What a headless engine is

"Headless" means no renderer and no page. three.js's scene graph (objects, skinning,
`AnimationMixer`) and Rapier still run, because they are libraries doing JS and wasm math. A
headless frame is the page's frame (`frameStep` → physics → `update` → camera → particles) with
only the drawing skipped, so whatever presentation feeds into gameplay stays the same.

- **One boot.** `Engine.start` and `Engine.headless` share one private boot sequence; only the
  view and the page's parts differ, so the two can't drift.
- **`engine.renderer` is a `View`** (`render/view.ts`): what gameplay reads from a view (art
  resolution, framing, viewport, look, mode, filters, `screen`). In a page it is the
  `PixelRenderer`; headless a `HeadlessView` (`render/headlessView.ts`), which keeps the same
  state as data and draws nothing. `engine.gpu` is the `PixelRenderer` for direct GPU work
  (readbacks, the canvas, compute), null headless.
- **The viewport** (`{ width, height, dpr }`, default 960×540 at DPR 1) frames the view through
  `frameView`, the one function both views call, so the art size (`fill`, `adaptive`, `fixed`, the
  pixel size setting) is the page's for the same viewport. Pointer aim and the HUD's layout depend
  on it: a recording keeps it (`Recording.view`), and a headless replay frames for it.
- **The screen effects are real**: transitions advance with `step()`, `cover()` / `reveal()`
  resolve. `render`, `precompile` and the animation loop do nothing; `onBeforeRender` hooks are
  kept and never called (mirrors, render-to-texture views); `GpuSwarm.update` does nothing;
  `capture()` rejects (`headless: no pictures`).
- **No page parts**: no loading screen, debug panel, touch controls, settings panel or error box
  (errors go to `engine.errors` and the console). `showDebug` and the debug hotkey do nothing.
  `Input` and `AudioManager` listen to nothing (no AudioContext; `audio.counts` still counts).
  Player settings apply (`settings.set`) but are stored only under a `settings.key` you give.
- **`__PIXEL_READY__` and `__PIXEL_ENGINE__`** are set on `globalThis`, as in a page. Module state
  outlives an engine (the asset caches, a game's `__HANDLES__`): boot one engine at a time, never
  two at once.

## Assets in Node

Models and packs are read through one process-wide reader (`setAssetReader`), because `loadModel`
and `loadPack` are free functions over one cache. `Engine.headless` installs `options.assets` (a
reader set earlier stays when none is given; a failed load is tried again next time):
`nodeAssets(root = 'public')` from `src/engine/node.ts` reads `public/<path>`. GLBs are parsed from
the bytes (`GLTFLoader.parseAsync`), packs with `JSON.parse`. Without a reader a load rejects,
naming `nodeAssets`. `node.ts` is Node-only and never imported by the engine or the page (a static
import would put `node:fs` in the page; the kit and single-file builds inline dynamic ones).

Packs parse once per URL (`settlePack`): `loadPack` and Node's `loadPacksSync`
(`src/riftlight/nodePacks.ts`) hand out the same defs, so `MODEL_LIBRARY` can take a pack from
either.

## Writing headless tests

- Stub nothing: no `window`, `document`, `location`, `ProgressEvent`, no `vi.stubGlobal`. Code that
  needs the page guards on `engine.renderer.container` (null headless) or uses `engine.gpu`.
- One engine at a time per test file; give headless tests their own timeout (vitest's default is
  5 s) and keep a file at or under 15 s.
- `src/engine/headless.test.ts` is the model: Playground boots, input moves and jumps the hero,
  the recording replays to the same fingerprint (and an edited one doesn't), a save-state survives
  JSON, a recording replays on its own viewport; each page-only guard (camera swaps, hook errors,
  the HUD's size, drawn sheets, GPU compute, settings, the debug panel) has a check that goes red
  without it.

The kit's `pixel-engine.js` doesn't run in Node yet (its Rapier wasm and CSS load the page's
way): `Engine.headless` is for this repository's tests and tools.
