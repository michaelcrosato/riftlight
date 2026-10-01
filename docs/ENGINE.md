# Pixel Engine

A WebGPU-first 3D engine that renders authentic 2D pixel art. It is built so AI agents
can reliably produce classic-looking (80s/90s/2000s) games: the look comes from the
engine, and a game is one plain object.

## Stack (pinned, do not change without a reason)

| Piece | Version / entry point |
| --- | --- |
| Build | Vite + TypeScript (strict), `package-lock.json` committed |
| Renderer | `three@0.186.0`: `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl` |
| Post-processing | r186 `RenderPipeline` + `pixelationPass` (`three/addons/tsl/display/PixelationPassNode.js`) |
| Physics | `@dimforge/rapier3d-compat@0.20.0` |
| Assets | local GLB in `public/assets/`, loaded with `GLTFLoader` |

`npm run lint` runs `scripts/forbidden-apis.mjs`, which fails on: `EffectComposer`,
`RenderPixelatedPass`, `ShaderPass`, `ShaderMaterial`, `RawShaderMaterial`,
`onBeforeCompile`, `WebGLRenderer`, raw GLSL, bare `'three'` imports, WebGL
post-processing addons, React/external engines, and version drift from the pins.

## Rendering architecture

```
Toon/node scene ─▶ WebGPU scene pass ─▶ low-res pixelation ─▶ depth/normal edges ─▶ output color transform ─▶ [TSL filters] ─▶ nearest-neighbor presentation
  MeshToonNodeMaterial   pixelationPass renders       (same pass: MRT color     (TSL, PixelationNode)    renderOutput()          palettes, dither,   canvas = internal × integer scale,
  3-band gradient         at internal res into a       + normal + depth, nearest                          (sRGB, no tone mapping)  CRT, LCD, VHS, …    NearestFilter sampling, letterboxed
                          nearest-filtered target)     filtered, no 2nd downsample)
```

- **One renderer.** `PixelRenderer` owns a single `WebGPURenderer` and a single
  `RenderPipeline`. Native WebGPU is always attempted first; if it's unavailable,
  `WebGPURenderer` switches to its built-in WebGL 2 backend. Same scene, materials, TSL
  pipeline, controls and gameplay. There is no `WebGLRenderer` code path.
- **Backend label.** `renderer.backend` is `'WebGPU'` or `'WebGL 2 fallback'` (with a
  reason), shown in the debug UI. `?backend=webgl` forces the fallback for testing.
- **Resolution.** 480×270 default, 320×180 comparison (`R`). The canvas backing store is
  `internal × scale` device pixels with the largest integer `scale` that fits, and
  `pixelSize = scale`, so the pixelation pass renders at exactly the internal resolution.
  Letterboxed and centered. The orthographic camera's view height is fixed in world units,
  so framing is identical at both resolutions. Math lives in `src/engine/framing.ts` (unit-tested).
- **Raw 3D mode** (`P`). Swaps the pipeline's `outputNode` from the pixelation pass to a
  plain full-res `pass()` (output transform only, no filters). Same renderer, pipeline,
  canvas, camera, physics, animation, lighting and framing.
- **Edges.** Depth/silhouette edges 0.45, normal (internal crease) edges 0.08. Both are
  uniforms, so tune with `renderer.setEdges({ depth, normal })`.
- **Lighting.** One `DirectionalLight` (hard `BasicShadowMap` shadows) + modest
  `AmbientLight`, 3-band `MeshToonNodeMaterial` (`TOON_BANDS`), `ContactShadow` blobs under
  characters. Every color comes from `PALETTE` (Sweetie 16).
- **Pixel alignment is presentation only.** Orthographic camera presets snap their own
  position to whole art pixels in the view plane (both modes, so toggling never moves the
  view). Rapier bodies are never snapped; visuals are interpolated between fixed 60 Hz steps.
- **GPU errors.** `renderer.onError` is captured into `renderer.gpuErrors` and shown in the
  debug UI. It must stay at 0. In r186 only the WebGPU backend reports through `onError`
  (uncaptured validation errors); on the WebGL 2 fallback the counter stays 0, so rely on
  the console check in `npm run test:e2e` there.
- **Compat shim.** `webgpuCompat.ts` drops three r186's identity `swizzle: 'rgba'` from
  texture views, which Chromium ≤ 141 rejects (black screen otherwise).

## Camera presets

A game picks **one** preset (`EngineOptions.camera`, or `?camera=` / `?cam=` in the URL).
For reviewing, `engine.setCamera(config)` (and the debug UI's picker) hot-swaps the
preset **without touching the world**: the player stays where they are, and so do coins,
physics and the renderer. Switching back to the game's own preset restores its configured
zoom and angles. Switching to `free`/`fixed` starts from the current view and keeps its
field of view. The game's `onCameraChange(ctx)` hook re-applies anything preset-specific,
such as the side lane lock or hiding the model in first person.

The URL is kept in sync. Normal presets use `?camera=`. `free`/`fixed` write their full
config to `?cam=`, so a reload brings back the same shot.

| Preset | Projection | Controls | Zoom |
| --- | --- | --- | --- |
| `iso` (default) | ortho, 32° pitch / 45° yaw (both configurable) | follows player | wheel / `+` `-` |
| `topdown` | ortho, straight down, screen-up = −Z | follows player | wheel / `+` `-` |
| `side` | ortho, straight side-on; **locks the player to their Z lane** | follows player | wheel / `+` `-` |
| `third` | perspective orbit; pulls in when walls block the view | drag or Q/E to orbit | wheel / `+` `-` (distance) |
| `first` | perspective at the eyes; hides the player model; player strafes | click to lock mouse, Q/E turn | **none** |
| `free` | authoring fly-cam | WASD, Q/E down/up, drag or click to look, Shift fast, Enter = fix | wheel (FOV) |
| `fixed` | a frozen view (what `free` produces) | none | wheel |

Free-camera workflow: start with `?camera=free`, fly to the shot you want, press **Enter**.
The view freezes, the player gets control, and the config (e.g.
`{"preset":"fixed","projection":"perspective","position":[3,6,9],"target":[0,1,0],"fov":55,"zoom":1}`)
is printed to the console, copied to the clipboard and shown in the debug UI. Paste it into
`EngineOptions.camera`, or pass it as `?cam=<json>`. Press Enter again to unfix.

Config keys (`CameraConfig`): `preset`, `zoom`, `minZoom`, `maxZoom`, `viewHeight` (ortho),
`pitch`/`yaw` (iso, third, first), `fov`, `distance` (third), `position`/`target`/`projection`
(fixed/free), `stiffness` (follow smoothing). Movement is always camera-relative through
`camera.groundBasis()`.

## Filters

Post filters are TSL functions applied in display space after the output color transform,
in any order, in Pixel mode only. Pixel-space effects (dither, palettes, LCD grid, grain)
work per **art pixel**, so they stay authentic at any integer scale. Set them with
`EngineOptions.filters`, `engine.setFilters(ids)`, `?filters=a,b` or `?look=<preset>`; the
debug UI has a checkbox for each, and `[` / `]` cycle the looks.

| Group | Filters |
| --- | --- |
| Console eras | `8bit` (NES: half resolution, NES palette, light dither), `16bit` (Mega Drive/SNES: 9-bit colour, 512 colours, ordered dither), `ps1` (15-bit colour with the PlayStation's 4×4 dither table **and vertex wobble**: toon materials snap clip-space vertices to the art-pixel grid while it's on) |
| Palette / hardware | `sweetie16`, `pico8`, `nes`, `c64`, `zx`, `ega`, `cga`, `gameboy`, `gbpocket`, `virtualboy`, `onebit`, `dither`, `posterize` |
| Color | `grayscale`, `sepia`, `invert`, `bleach`, `sunset`, `moonlight`, `thermal`, `nightvision` |
| Display | `scanlines`, `lcd`, `crt` (curved, masked, vignetted), `vignette` |
| Signal | `chromatic`, `grain`, `vhs`, `ntsc` |
| Stylize | `bloom`, `halftone`, `sketch` |

Looks (`FILTER_PRESETS`): `eight_bit`, `sixteen_bit` (+ scanlines), `playstation`, `arcade`, `handheld`, `famicom`, `home_computer`, `vhs_rental`,
`spectrum`, `mac_classic`, `pico`, `dream`, `spooky`. Add a filter by appending a
`FilterDef` to `FILTERS` in `src/engine/render/filters.ts`; the e2e suite picks it up
automatically on both backends.

## Characters: the moveset

`PlatformerCharacter` (`src/engine/character/`) is a Mario-64-style controller (and then
some) on Rapier's kinematic character controller, driven by the hero rig's baked clips
(`scripts/assets/hero.mjs`: jointed body with elbows/knees and a pelvis root, 57 clips).
`readMoveInput(ctx, hero, out?)` maps the default keys, camera-relative for every preset; pass
a `MoveInput` you keep as `out` and it is filled in place (no garbage per step).

| Key | Action |
| --- | --- |
| WASD / arrows | walk → run (Mario-style turning; reverse at speed = **skid**) |
| Shift | walk / tiptoe |
| Space | jump · again on landing = **double**, then **triple** (front flip; a press up to 0.12 s before touchdown counts) · while skidding = **side flip** · **wall kick** off walls |
| C / Ctrl (hold) | **crouch**, crouch-walk · while running = **crouch slide** · + Space = **backflip** · running + C + Space = **long jump** · in the air (press) = **ground pound** |
| Z | **prone** / crawl (fits 0.75-high gaps); again to **get up** (only with headroom) |
| X | **lie down** on the back (dozes off: **sleep**); again to **get up**. Idle 16 s = lies down by itself |
| F (hold) | **grab** a block, then pull (move away) or push (move toward) |
| J | **punch → punch → kick** combo · + C = **sweep kick** · in the air: **dive** (moving) or **jump kick** |
| V / B | **wave** / **sit** |

**Touch (phones/tablets):** shown automatically on coarse pointers (or `?touch=1`):
joystick bottom-left, buttons **A** jump · **B** attack · **C** crouch · **G** grab · **Z** prone ·
**X** lie down; drag on the game to orbit/look, pinch to zoom; top bar ⚙ debug panel,
**P** Pixel/Raw, **R** resolution, **◐** cycle looks (`TouchControls`, `input.analog`).
Landscape works best.

Automatic moves: **step up / step down** (autostep 0.4), **teeter** at edges, **fall**, soft
**land** or **hard landing** (drops > 5.5, face-plant + get-up), **ledge grab** → hang →
**shimmy** (A/D) → **pull up** (toward wall / Space) or **drop** (C / away), **climb**
colliders tagged `climbable` in any direction and **climb over the top**, **push** colliders
tagged `pushable` by walking into them, **slope slide** on steep or `slippery` ground,
**dive → belly slide → get up**, **victory** via `hero.celebrate()`. Walls take away the speed that
runs into them (at a glancing angle the hero slides along at the real speed); running head-on
into a wall at full speed **bonks** (stops dead and reels back), walking into one stands against it.

How it's built (`src/engine/character/`):

| file | what |
| --- | --- |
| `PlatformerCharacter.ts` | the core and the public API: body and KCC sweep (walls take speed away), probes, ledge detection, stance, animation playback |
| `states.ts` | `STATES`: one entry per state, `{ step, anim, stance, airborne, snapToGround, attached, snapFacing, lock }`; `MoveState` is its keys |
| `tuning.ts` | `TUNING`: every speed, acceleration, jump velocity, timing and threshold, documented |
| `controls.ts` | default key map, `readMoveInput` |

To add a state, add one entry to `STATES` (and its step function next to it) and any numbers to
`TUNING`; then film it. Cross-fades between clips go through `RotationBlend`
(`src/engine/animation/rotationBlend.ts`): a blend never flips a joint to the other side, however
far apart the two poses hold it.

Tag colliders with `physics.tag(collider, ...)`: `climbable`, `pushable`, `grabbable`,
`slippery`, `noLedge`, `noCamera`. `hero.state`, `hero.anim` and `hero.stats` expose what
the character is doing. The simpler `CharacterController` remains for games that only need
walk + jump.

## Making a game

A game implements `Game` (`src/engine/Engine.ts`) and is started with `Engine.start`:

```ts
import { compileClips, Engine, type Game, type GameContext, PlatformerCharacter, readMoveInput, toonMaterial } from './engine';
import { HERO_CLIPS, HERO_RIG } from './game/hero';
import { BoxGeometry, Mesh, type Object3D, Vector3 } from 'three/webgpu';

class MyGame implements Game {
  readonly name = 'My Game';
  hero!: PlatformerCharacter;
  model!: Object3D;

  async setup(ctx: GameContext) {
    const { scene, physics, palette } = ctx;
    const floor = new Mesh(new BoxGeometry(20, 1, 20), toonMaterial(palette.green));
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    scene.add(floor);
    physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [10, 0.5, 10] });
    const ledge = physics.addStaticBox({ position: [4, 1.25, 0], halfExtents: [1, 1.25, 2] });
    physics.tag(ledge, 'noLedge'); // or 'climbable', 'pushable', ...
    const hero = await ctx.loadModel('assets/hero.glb', { castShadow: false });
    this.model = hero.scene;
    scene.add(this.model);
    this.hero = new PlatformerCharacter(physics, { position: [0, 0, 0], lockDepth: ctx.camera.lockDepth });
    // Clips are data (docs/ANIMATION.md), compiled against the model's joints.
    this.hero.attachModel(this.model, compileClips(HERO_CLIPS, HERO_RIG, this.model));
    this.model.visible = !ctx.camera.hidesTarget;
  }
  fixedUpdate(ctx: GameContext, dt: number) {
    this.hero.fixedUpdate(dt, readMoveInput(ctx, this.hero));
  }
  update(ctx: GameContext, dt: number) {
    this.hero.updateVisual(this.model, dt, ctx.physics.alpha);
  }
  cameraTarget() {
    return this.model.position.clone().add(new Vector3(0, 0.9, 0));
  }
  eyePosition(ctx: GameContext) {
    return this.hero.eye(ctx.physics.alpha);
  }
}

Engine.start(new MyGame(), {
  container: document.getElementById('app')!,
  camera: { preset: 'side', zoom: 1.2 },
  filters: ['nes', 'scanlines'],
});
```

Rules of thumb for good-looking results:

- Use `PALETTE` colors only, via `toonMaterial(color)`. Load GLBs with `ctx.loadModel`;
  their materials are converted to toon automatically, so only base colors matter.
  Clones are skeleton-aware (`SkeletonUtils.clone`), so skinned GLBs work too.
- Chunky, low-poly shapes read best at 480×270. Aim for features ≥ 0.25 world units
  (≈ 5 art pixels at the default view height of 13.5).
- Put movement and forces in `fixedUpdate`; animation, pickups and UI in `update`.
- Use `input.consumePress` in `fixedUpdate` (never drops a press); use `wasPressed` in `update`.
  `input.anyDown(codes)` / `input.consumeAny(codes)` take an array (no rest-argument garbage).
- `hero.feet` / `hero.forward` allocate; per-step code can use `hero.feetInto(v)` / `hero.forwardInto(v)`.
- New assets: extend `scripts/generate-assets.mjs` (deterministic) or drop GLBs into
  `public/assets/`. See `src/game/playground.ts` for a complete example.

## Animation

Clips are data in `src/game/hero/clips/` (one file per family), with foot IK and a procedural gait
generator. They are checked by metrics (floor contact, foot slide, loop seams, joint limits)
and viewed as contact-sheet PNGs or in the Animation Lab. The full workflow is in
**[docs/ANIMATION.md](ANIMATION.md)**:

- `npm run anim -- check` prints metrics for every clip and exits 1 on problems.
- `npm run anim -- sheet Run` writes `.scratch/anim/Run.png` and `curves Run` writes
  `.scratch/anim/Run.curves.png`. Read the PNGs to see the animation. `npm run film --
  run-stop` films it in the game.
- `/lab.html` previews a clip in the real renderer: scrub, views, skeleton, hot reload, and
  `window.__ANIM_LAB__`.

## Tooling for agents

- `window.__PIXEL_ENGINE__.state()`: backend, mode, resolution, framing, frame count,
  GPU errors, camera, player target and game status.
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
  engine hotkeys (P, R, `, [ ]); it only advances the game.
- `hero.animationMix()`: the clips currently contributing to the pose, with their blend
  weight, time and rate. Blends are driven by `PlatformerCharacter` (rotations re-blended by
  `RotationBlend` so they never flip), not three's
  `crossFadeFrom`: every outgoing clip fades from the weight it has *now*, and
  locomotion-to-locomotion switches start in step with the outgoing stride.
- `engine.setFilters(ids)`, `engine.availableFilters`, `engine.camera.setZoom(z)`,
  `engine.camera.describe()`.
- `npm run test:e2e` runs the production build in Chromium. Suites:
  - three backend paths (native WebGPU, natural WebGL 2 fallback, forced fallback)
  - every camera preset, including zoom, the side lane and free → fix → `?cam=`
  - every filter on both backends
  - every move in `scripts/e2e-moves.mjs`
  - camera hot-swap keeps the player in place
  - the Animation Lab (every clip, views, sheets, curves, API)
  - `Engine.step()` manual time

  Frames are written to `.scratch/e2e/*.png`. It needs `xvfb-run`, because headless
  Chromium loses the WebGPU device when a canvas presents. Run one suite with
  `npm run test:e2e -- moves`.
- `npm run build:single` writes `dist-single/pixel-engine.html`, one self-contained offline file.
