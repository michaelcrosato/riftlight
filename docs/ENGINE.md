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
| Physics | `@dimforge/rapier3d@0.20.0`, its `.wasm` loaded separately (`src/engine/physics/rapierWasm.ts`) |
| Assets | local GLB in `public/assets/`, loaded with `GLTFLoader` |

`npm run lint` runs `scripts/forbidden-apis.mjs`, which fails on: `EffectComposer`,
`RenderPixelatedPass`, `ShaderPass`, `ShaderMaterial`, `RawShaderMaterial`,
`onBeforeCompile`, `WebGLRenderer`, raw GLSL, bare `'three'` imports, WebGL
post-processing addons, React/external engines, and version drift from the pins.

## Rendering architecture

```
            ┌────────────── art resolution (480×270): one fragment per art pixel ──────────────┐   ┌──── device resolution ────┐
Toon scene ─▶ scene pass (MRT color+normal+depth) ─▶ depth/normal edges ─▶ output transform ─▶ art filters ─▶ art target ─▶ ONE nearest upscale ─▶ [display filters] ─▶ canvas
 MeshToon-     pixelationPass at art res,             (TSL, PixelationNode)  renderOutput()      palettes, dither,  (RTT, nearest)   canvas = art × integer scale   scanlines, LCD,
 NodeMaterial  nearest-filtered target                                       (sRGB, no tone map) colour grades…                                                 CRT, VHS, bloom…
```

Everything that is decided per art pixel runs at the art resolution: the scene, the edge
detection (~10 texture reads per fragment), the output transform and the filters that
produce one value per art pixel. That stage renders into one art-sized, nearest-filtered
target, which is upscaled to the canvas exactly once. Only *display* filters, which need
sub-art-pixel detail, run per device pixel. At 4× scale that is 1/16 of the fragments for
everything but the final copy: in headless Chromium at 1920×1080 a frame went from 225 ms to
25 ms (no filter) and from 457 ms to 27 ms (`nes`) on software WebGPU, and from 141 → 21 ms
and 273 → 16 ms on the WebGL 2 fallback.

- **One renderer.** `PixelRenderer` owns a single `WebGPURenderer` and a single
  `RenderPipeline`. Native WebGPU is always attempted first; if it's unavailable,
  `WebGPURenderer` switches to its built-in WebGL 2 backend. Same scene, materials, TSL
  pipeline, controls and gameplay. There is no `WebGLRenderer` code path.
- **Backend label.** `renderer.backend` is `'WebGPU'` or `'WebGL 2 fallback'` (with a
  reason), shown in the debug UI. `?backend=webgl` forces the fallback for testing.
- **Resolution.** 480×270 default, 320×180 comparison (`R`). The canvas backing store is
  `art × scale` device pixels with the largest integer `scale` that fits, and
  `pixelSize = scale`, so the pixelation pass renders at exactly the art resolution.
  Letterboxed and centered. The orthographic camera's view height is fixed in world units,
  so framing is identical at both resolutions. Math lives in `src/engine/framing.ts` (unit-tested).
- **Aspect** (`EngineOptions.aspect`, `?aspect=`). `adaptive` (default) keeps the art
  height (270) and gives the art the screen's aspect, clamped to 0.4–2.4 and still
  integer-scaled: a portrait phone (390×844) gets 124×270 art filling ~92% of the screen
  instead of a 16:9 strip covering ~15%; a landscape phone gets ~584×270. On 16:9 screens it
  is identical to `fixed` (exactly `resolution`, letterboxed). Camera rigs follow the art
  aspect (`rig.setAspect`); `renderer.resolution` is the art size actually rendered,
  `renderer.baseResolution` the configured preset.
- **Fill** (`aspect: 'fill'`, Riftlight's default; `?aspect=fill`). Both art dimensions
  follow the viewport at the nearest whole device-pixel scale to the configured art
  height. At 2560×1440, 480×270 becomes 512×288 at 5× and covers the entire screen.
  A final partial art pixel can extend past the viewport and is clipped at its edge;
  art pixels remain square and integer-scaled. Resizing, browser fullscreen and HiDPI
  screens use the same layout, and the HUD and in-game tree follow it. Fixed and adaptive
  modes keep their existing letterboxing.
- **Raw 3D mode** (`P`). Swaps the pipeline's `outputNode` from the pixelation pass to a
  plain full-res `pass()` (output transform only, no filters). Same renderer, pipeline,
  canvas, camera, physics, animation, lighting and framing.
- **Edges.** Depth/silhouette edges 0.45, normal (internal crease) edges 0.08. Both are
  uniforms, so tune with `renderer.setEdges({ depth, normal })`.
- **Lighting.** One `DirectionalLight` (hard `BasicShadowMap` shadows) + modest
  `AmbientLight`, 3-band `MeshToonNodeMaterial` (`TOON_BANDS`), `ContactShadow` blobs under
  characters. Every color comes from `PALETTE` (Sweetie 16). The shadow box follows the
  camera and scales with the view: ortho presets cover the visible ground (zooming out keeps
  shadows), perspective presets a box reaching ~29 units ahead of the camera. It moves in
  whole shadow texels, with a slope-scaled depth bias in texels so every map size is
  acne-free.
- **Dynamic lights.** `ctx.lights` is a fixed pool of `PointLight`s shared by any number of
  light requests (see *Dynamic lights* under Game systems).
- **Quality** (`EngineOptions.quality`, `?quality=`, `engine.setQuality()`): the shadow map
  size, `low` 256² · `medium` 512² · `high` 1024², and the dynamic light pool, `low` 4 ·
  `medium` 8 · `high` 16 point lights. At the iso art scale 512² is about one
  shadow texel per art pixel. `auto` (default) starts `low` on touch devices and `medium`
  elsewhere, then lowers once if the first ~3 s of play run below 75% of the frame-rate
  target (straight to `low` below 40%). `engine.quality` is the level in use.
- **Frame cap** (`EngineOptions.maxFps`, default 60, `?fps=`, 0 = display rate). The render
  loop skips whole display frames (`FrameLimiter`), so a 120 Hz phone runs the pipeline 60
  times a second, not 120. Physics keeps its fixed 60 Hz step; the next frame sees the full
  elapsed time.
- **Draw calls.** `mergeStaticMeshes(objects)` (`src/engine/render/merge.ts`) merges static
  meshes into one mesh per material (world transforms baked, multi-material geometry split
  by group). Keep one collider per block and anything that moves separate. The playground
  goes from 332 to 86 draw calls per frame (including the shadow pass).
- **Lost GPU device.** Mobile browsers drop the WebGPU device (or WebGL context) after
  backgrounding or under memory pressure. `PixelRenderer` notices (`device.lost`,
  `webglcontextlost`), builds a new renderer, canvas, scene passes and pipeline for the same
  scene, camera, filters and framing, re-attaches pointer input and keeps the loop going
  (`state().gpuRecoveries`). If that fails, or happens more than 3 times in 30 s, it shows a
  "tap to reload" overlay.
- **Start-up.** `Game.assets` lists the models `setup` loads; `Engine.start` begins those
  downloads, the renderer (adapter/device) and Rapier's wasm in parallel, behind a
  pixel-styled loading bar (`LoadingScreen`; `index.html` ships its first frame). The scene
  passes are precompiled (`compileAsync`) before the first frame. Evicted filter graphs
  dispose their render targets. Filter graphs themselves still compile on first use.
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

A game may also swap presets as part of play (Riftlight's arcade cabinet goes `side`, its
Hall of Beasts `first`, its photo mode `free`): pass `engine.setCamera(config, { syncUrl: false })`
so a reload still starts with the game's own camera (docs/GAME.md, *Showcase*).

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
work per **art pixel**, so they stay authentic at any integer scale.

Every `FilterDef` declares its `space`. `art` filters produce one value per art pixel and run
in the art-resolution stage; `display` filters need sub-art-pixel detail and run per device
pixel after the upscale. A stack runs its leading `art` filters at art resolution and
everything from its first `display` filter on at device resolution, so the order is kept
exactly (`splitFilters`). Put `art` filters first in your own stacks. A filter that needs its
input as a texture calls `fx.texture(node)`, which gives an art-sized target in the art stage.

| Space | Filters |
| --- | --- |
| `art` | `cel`, `8bit`, `16bit`, `ps1`, every palette (`sweetie16` … `onebit`), `dither`, `posterize`, every colour grade, `vignette`, `grain` |
| `display` | `scanlines`, `lcd`, `crt`, `chromatic`, `vhs`, `ntsc`, `bloom`, `halftone`, `sketch` |

Set them with
`EngineOptions.filters`, `engine.setFilters(ids)`, `?filters=a,b` or `?look=<preset>`; the
debug UI has a checkbox for each, and `[` / `]` cycle the looks.

| Group | Filters |
| --- | --- |
| Shading | `cel` (flat light bands, a saturation lift and ink lines where the depth jumps; bands, ink, line width, saturation) |
| Console eras | `8bit` (NES: half resolution, NES palette, light dither), `16bit` (Mega Drive/SNES: 9-bit colour, 512 colours, ordered dither), `ps1` (15-bit colour with the PlayStation's 4×4 dither table **and vertex wobble**: toon materials snap clip-space vertices to the art-pixel grid while it's on) |
| Palette / hardware | `sweetie16`, `pico8`, `nes`, `c64`, `zx`, `ega`, `cga`, `gameboy`, `gbpocket`, `virtualboy`, `onebit`, `dither`, `posterize` |
| Color | `adjust` (brightness, contrast, saturation, warmth), `grayscale`, `sepia`, `invert`, `bleach`, `sunset`, `moonlight`, `thermal`, `nightvision` |
| Display | `scanlines`, `lcd`, `crt` (curved, masked, vignetted), `vignette` |
| Signal | `chromatic`, `grain`, `vhs`, `ntsc` |
| Stylize | `bloom`, `halftone`, `sketch` |

Stacks (`FILTER_PRESETS`): `eight_bit`, `sixteen_bit` (+ scanlines), `playstation`, `arcade`, `handheld`, `famicom`, `home_computer`, `vhs_rental`,
`spectrum`, `mac_classic`, `pico`, `dream`, `spooky`. Add a filter by appending a
`FilterDef` to `FILTERS` in `src/engine/render/filters.ts`; the e2e suite picks it up
automatically on both backends.

**Parameters.** A `FilterDef` lists its tunable numbers (`params`: key, label, range, step,
default, unit) and named sets of them (`presets`: `classic`, `heavy`, `pop art`…); every filter
also has `amount` (strength: the result mixed over its input). `apply(c, fx, p)` reads them with
`p('key')`. The renderer hands out one uniform per layer, filter and parameter, so a slider
never rebuilds or recompiles a graph. `filterParams`, `defaultParams`, `filterPresets` and
`clampParam` are the helpers a UI needs.

### Looks: filters per layer (`src/engine/render/look.ts`)

A frame has two layers: **actors** (characters and objects) and the **environment**
(everything else). Tag a root with `setLookLayer(object, 'actors')`; its children follow
(`lookLayerOf` walks up to the nearest tag), and untagged objects are environment. A `Look`
gives each layer its own source and stack, then runs a third stack over the composed frame:

```
actors      → pixel art (art resolution × size, outlines) or clean + actor filters  ─┐
                                                                                      ├─ nearer wins (depth) ─▶ scene filters ─▶ screen
environment → pixel art or clean (full resolution, no outlines) + world filters      ─┘
```

```ts
engine.setLook(engine.lookPresets.pixel_heroes);   // clean world, pixel-art characters
engine.setLook({
  scene: [{ id: 'vignette' }],
  actors: { pixel: { size: 1, outline: 0.45, crease: 0.08 }, filters: [{ id: 'nes', params: { dither: 0.2 } }] },
  environment: { pixel: null, filters: [{ id: 'cel', params: { bands: 4 } }] },
});
engine.setFilters(['crt']);                         // = the whole-scene stack; layers keep theirs
```

- **One pass when the layers look the same** (equal pixel settings, no per-layer filters): the
  default look draws exactly the old graph. A look that differs per layer renders two scene
  passes; each draws only its layer's objects (a render-object filter on the pass, so lights,
  fog and shadow maps, cast by every object, are the same in both), and per pixel the nearer
  of the two depth buffers wins. Transparent materials (glows, telegraphs, loot beams, contact
  shadows) draw in both passes, each blending them over its own layer, so they show in front
  of or behind whichever layer wins a pixel. When both layers are pixel art they compose in
  the art stage; otherwise both are upscaled first.
- **Whole scene only.** Filters that move pixels (`crt`, `chromatic`, `vhs`, `ntsc`:
  `FilterDef.sceneOnly`) would no longer line up with the other layer once composed, so
  `normalizeLook` drops them from layer stacks; they run on the whole scene.
- **Pixel art per layer.** `pixel: { size, outline, crease }` or `null` (clean: the scene at the
  device resolution, like Raw mode but with filters). `size` is art pixels per rendered pixel
  (1 native, 2+ chunkier).
- **What rebuilds.** `planLook(look).key` (pixel on/off per layer and the filter ids in order)
  picks the graph; parameter values and pixel sizes are uniforms. Graphs are cached (8).
- **Presets.** `LOOK_PRESETS` starts with the default (`none`: pixel art, no filters; menus call
  it "default") and `no_filters` (nothing at all: full resolution, no pixel art, no outlines,
  no filters), then every `FILTER_PRESETS` stack as a whole-scene look, then looks that mix
  layers and stacks: `pixel_heroes`, `pixel_world`, `chunky_world`, `cel_cartoon`,
  `cel_heroes`, `retro_heroes`, `spotlight`, `sketchbook`, `dream_world`, `handheld_heroes`,
  `noir`, `sin_city` (a grey posterized world, comic-cel characters), `comic_book`, `pop_art`,
  `storybook`, `neon_nights`, `heat_vision` (thermal characters on a grey world), `night_ops`,
  `ps1_horror`, `found_footage`, `old_photo`, `virtual_boy` and `pico_world`. `[` / `]` and
  `?look=<name>` cycle and pick them; `lookPresetOf(look)` names a look (or null),
  `lookPresetName` resolves old names (`LOOK_ALIASES`: `hd_clean` is `no_filters`).
- **Side effects per layer.** The PS1 vertex wobble is on while a pass whose stack has `ps1`
  draws.
- `normalizeLook(anything)` makes a valid look (unknown filters and duplicates dropped, every
  parameter present and clamped), so stored and URL looks are safe. `?filters=` wins over
  `?look=`. `renderer.split` says
  whether two passes are running; `state().look` names the preset in use (or `custom`).

Riftlight's **Look studio** (pause or settings → Look studio, or **L**; docs/GAME.md) is a UI
over this: per layer, every filter with its presets and sliders.

## Characters: the moveset

`PlatformerCharacter` (`src/engine/character/`) is a Mario-64-style controller (and then
some) on Rapier's kinematic character controller, driven by the hero rig's baked clips
(`scripts/assets/hero.mjs`: jointed body with elbows/knees, a pelvis root and a springy cap, 60 clips).
`readMoveInput(ctx, hero, out?)` maps the default keys, camera-relative for every preset; pass
a `MoveInput` you keep as `out` and it is filled in place (no garbage per step).

| Key | Action |
| --- | --- |
| WASD / arrows | tiptoe → walk → run (speed follows the stick's tilt; Mario-style turning; reverse at speed = **skid**, then a hop round = **skid turn**) |
| Shift | walk / tiptoe |
| Space | jump · again on landing = **double**, then **triple** (front flip; a press up to 0.12 s before touchdown counts) · while skidding = **side flip** · **wall kick** off walls (also from a **wall slide**) |
| C / Ctrl (hold) | **crouch**, crouch-walk · while running = **crouch slide** · + Space = **backflip** · running + C + Space = **long jump** · in the air (press) = **ground pound** |
| Z | **prone** / crawl (fits 0.75-high gaps); again to **get up** (only with headroom) |
| X | **lie down** on the back (dozes off: **sleep**); again to **get up**. Idle 16 s = lies down by itself |
| F (hold) | **grab** a block, then pull (move away) or push (move toward) |
| J | **punch → punch → kick** combo · + C = **sweep kick** · in the air: **dive** (moving) or **jump kick** |
| V / B | **wave** / **sit** (sits down; B, Space or the stick stands up again) |

**Touch (phones/tablets):** shown automatically on coarse pointers (or `?touch=1`):
joystick bottom-left, buttons **A** jump · **B** attack · **C** crouch · **G** grab · **Z** prone ·
**X** lie down; drag on the game to orbit/look, pinch to zoom; top bar ⚙ debug panel,
**P** Pixel/Raw, **R** resolution, **◐** cycle looks, **♪** mute (`TouchControls`, `input.analog`;
the buttons are `EngineOptions.touchButtons`).
Landscape works best.

A game lays out and drives its own buttons (Riftlight's action cluster, `src/riftlight/game/touch.ts`):

- **Placement**: a `TouchButton` with `at: { x, y, size, corner }` is placed by its centre, in CSS
  pixels from a screen corner (default bottom-right, inside the safe area), instead of in the
  grid; tap targets keep their size whatever the art scale is. The first button is the accent one.
- **State** each frame: `engine.touch.set(code, { icon, label, hint, cooldown, timer, badge,
  disabled, hidden })`: an icon canvas (drawn pixelated) instead of the label, a cooldown shutter
  (0..1) with its seconds, a corner badge (a cost), dimmed when it can't be used, hidden (its
  place is kept). Only what changed touches the DOM.
- `engine.touch.show(false)` hides the stick and the buttons while a menu owns the screen (held
  keys and the stick are released); `engine.touch.rects()` gives their client rects (with
  `hidden` flags) so a HUD can lay itself out around them.
- The top bar is for development: `touchBar: false` keeps it off a shipped game, and it then
  shows only with the debug UI (`?debug=1`, dev builds).

Automatic moves: **step up / step down** (autostep 0.4; Rapier's autostep alone misses a
riser met at speed, so `riseAhead` lifts the body onto a flat step found just ahead and holds
it there while it crosses the edge, `TUNING.body.stepAssist`), **teeter** at edges, **fall**, soft
**land** or **hard landing** (drops > 5.5, face-plant + get-up), **ledge grab** → hang →
**shimmy** (A/D) → **pull up** (toward wall / Space) or **drop** (C / away), **climb**
colliders tagged `climbable` in any direction and **climb over the top**, **push** colliders
tagged `pushable` by walking into them, **slope slide** on steep or `slippery` ground,
**dive → belly slide → get up**, **victory** via `hero.celebrate()`. Walls take away the speed that
runs into them (at a glancing angle the hero slides along at the real speed); running head-on
into a wall at full speed **bonks** (stops dead and reels back), walking into one **leans on it**
(PushIdle; so does pushing a crate that's stuck). Falling while pushing into a wall
**wall-slides** down it (Space kicks off, letting go of the stick drops away).

**Weight (Mario 64).** Speed builds over about 0.65 s to the top (fast from a standstill,
slow for the last metres per second). Turns are tight at walking pace and wide at full speed
(a ~1.3 m arc). The stick's tilt is squared, so a gentle tilt tiptoes. In the air the hero
keeps their momentum and can only nudge it. **Uphill slows the run**: the grade 0.9 m
ahead (stairs count by their average climb) lowers the top speed by up to 60% between
grades 0.2 and 0.33 (the 15° ramp runs at ~4.8 m/s, the playground stairs at ~3.3);
downhill and gentle slopes keep full speed, and ground too steep to stand on slides you
back (`TUNING.ground.uphill`). A jump takes off on the physics step it is pressed (the
jump's own step runs right away, not one step later). Every number is in `TUNING.ground` and
`TUNING.air`, with the reasoning next to it.

`hero.teleport(position)` starts over: idle, no momentum, no jump chain, and the animator
restarts (no blends, no locked feet, no procedural memory), so what happens after a
teleport doesn't depend on what came before it (films and e2e rely on that).

**Getting hurt.** `hero.hurt(fromDirection, strength = 1)` knocks the hero back, away from
`fromDirection` (e.g. enemy position − hero position; only the horizontal part counts), in
an arc. It plays Hurt, takes control away for `TUNING.hurt.stun` s and lets go of ledges,
walls and blocks. Then `hero.invulnerable` counts down (`TUNING.hurt.invulnerable` s);
while it is above 0, `hurt()` returns false and does nothing. `hero.stats.hurts` counts
hits. The playground's spike pad uses it and blinks the hero while invulnerable.

**Presentation.** `hero.lookAt = vector | null` turns the head (and a little of the torso)
toward a point of interest; otherwise it looks where it's going. Pass the rig to
`attachModel(model, clips, HERO_RIG)` to get runtime foot placement on stairs and slopes,
foot locking, leaning into turns and landing squash (docs/ANIMATION.md, "At runtime").

How it's built (`src/engine/character/`):

| file | what |
| --- | --- |
| `PlatformerCharacter.ts` | the core and the public API: body and KCC sweep (walls take speed away), probes, ledge detection, stance, `hurt()` |
| `animator.ts` | animation playback: cross-fades, the Tiptoe/Walk/Run blend space, pose layers and foot placement |
| `states.ts` | `STATES`: one entry per state, `{ step, anim, stance, airborne, snapToGround, attached, snapFacing, lock, feet, lean }`; `MoveState` is its keys. `feet` picks foot placement (`'ik'` on the real ground, `'lock'` planted in the world), `lean` turns on leaning into turns |
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
  readonly assets = ['assets/hero.glb']; // starts downloading before the renderer is up
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
    // With the rig: feet placed on the real ground, leaning, looking, landing squash.
    this.hero.attachModel(this.model, compileClips(HERO_CLIPS, HERO_RIG, this.model), HERO_RIG);
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
  their materials are converted to toon automatically, keeping base colors, textures
  (nearest-filtered) and vertex colors.
  Clones are skeleton-aware (`SkeletonUtils.clone`), so skinned GLBs work too.
- Build static level geometry as plain meshes, then `scene.add(...mergeStaticMeshes(meshes))`
  (one draw per material); keep one collider per block, and keep movers separate.
- Chunky, low-poly shapes read best at 480×270. Aim for features ≥ 0.25 world units
  (≈ 5 art pixels at the default view height of 13.5).
- Put movement and forces in `fixedUpdate`; animation, pickups and UI in `update`.
- Use `input.consumePress` in `fixedUpdate` (keeps a press for 150 ms of game time); use
  `wasPressed` in `update`.
  `input.anyDown(codes)` / `input.consumeAny(codes)` take an array (no rest-argument garbage).
- `hero.feet` / `hero.forward` allocate; per-step code can use `hero.feetInto(v)` / `hero.forwardInto(v)`.
- Sounds, particles and HUD text: `ctx.audio.play('jump')`, `ctx.particles.burst('dust', at)`,
  `ctx.hud.text(4, 4, 'SCORE 10')` (see Game systems below). Pickups: `physics.trigger`.
- New assets: extend `scripts/generate-assets.mjs` (deterministic) or drop GLBs into
  `public/assets/`. See `src/game/playground.ts` for a complete example.

## Game systems

Everything below hangs off the `GameContext` passed to every hook (`ctx.audio`,
`ctx.particles`, `ctx.hud`, `ctx.physics`, `ctx.input`) or off the `Engine`. The playground
(`src/game/playground.ts`) uses all of them; `src/game/sandbox.ts` is a second, smaller level.

### Audio (`src/engine/audio/`)

`ctx.audio` is an `AudioManager`. Sounds are **data**: a `SoundDef` is rendered once to a
buffer by pure, seeded synthesis (`synth.ts`, unit-tested), so it sounds the same everywhere.

```ts
ctx.audio.play('jump');                          // built-in SFX (sfx.ts)
ctx.audio.play('coin', { pitch: 2, volume: 0.5, pan: -0.3 }); // semitones, 0..1, -1..1
ctx.audio.register('laser', {
  wave: 'square', duty: 0.125,                   // square | triangle | saw | sine | noise
  freq: 1400, freqEnd: 300,                      // exponential pitch sweep (Hz)
  attack: 0.002, sustain: 0.04, decay: 0.12,     // envelope, seconds
  volume: 0.3, arp: [0, 7], arpRate: 0.05,       // optional arpeggio (semitones)
  layers: [{ wave: 'noise', freq: 4000, decay: 0.05, volume: 0.1 }],
});
ctx.audio.playMusic(MY_SONG, 'level1');          // loops; playMusic(null) stops
await ctx.audio.load('door', 'assets/door.ogg'); // optional audio files, then play('door')
ctx.audio.setVolume('music', 0.4);               // 'master' | 'sfx' | 'music', persisted
ctx.audio.toggleMute();                          // also the M key and the debug panel button
```

Built-in SFX: `jump`, `doubleJump`, `land`, `coin`, `step`, `skid`, `punch`, `groundPound`,
`whoosh`, `hurt`, `fanfare`. A song is patterns of note strings per track:

```ts
const MY_SONG: Song = {
  bpm: 140,                                      // stepsPerBeat defaults to 4 (16ths)
  tracks: {
    lead: { wave: 'square', duty: 0.25, decay: 0.08, volume: 0.13 },
    bass: { wave: 'triangle', decay: 0.06, volume: 0.3 },
    drums: { wave: 'noise', decay: 0.05, volume: 0.1 }, // noise: pitch = hiss (C6 snare, C8 hat)
  },
  patterns: {
    a: { lead: 'C5 . E5 . G5 - - .', bass: 'C3 . . . G2 . . .', drums: 'C6 . C8 . C6 . C8 .' },
  },
  order: ['a', 'a'],                             // '.' rest, '-' hold the previous note
};
```

`parseSong` throws on a typo (bad note, uneven pattern), so `npm test` catches it. Browsers
allow sound only after a user gesture: the AudioContext is created on the first key /
pointer / touch input (`touchend` / `click` on iOS), and the engine keeps listening until it
is actually running; it resumes again after the tab comes back or iOS interrupts audio
(at the next input if the browser insists on one). Before that, and without Web Audio (headless), every call is a
silent no-op that still counts plays in `audio.counts` / `audio.log`, so tests can assert on
sounds. Volumes and mute live in `localStorage` (`pixel-engine:audio`), with try/catch.

Hero sounds without touching the character: compare `hero.stats`, `hero.state`,
`hero.jumpKind` and `hero.anim` with last step's values in `fixedUpdate`, as
`Playground.heroEvents` does.

### Particles (`src/engine/particles/`)

```ts
ctx.particles.burst('dust', hero.feet);                          // landing puff
ctx.particles.burst('skid', feet, { direction: [vx, 0.6, vz] }); // kicked back
ctx.particles.burst('sparkle', coinPos, { count: 20, scale: 2, colors: ['white', 'cyan'] });
ctx.particles.register('confetti', {
  count: [20, 30], life: [0.6, 1.2], speed: [3, 5], direction: [0, 1, 0], spread: 30,
  gravity: 6, drag: 1, size: [2, 2], colors: ['red', 'sand', 'lime', 'sky'],
});
```

Presets are data (`presets.ts`: `dust`, `skid`, `sparkle`, `smoke`, `impact`). Sizes are
whole **art pixels** (converted with the camera's world size of one art pixel at the focus),
colors are `PALETTE` names stepped over each particle's life, never blended. Each preset is
one pooled CPU simulation (`ParticlePool`, unit-tested) drawn as **one instanced
`SpriteNodeMaterial` draw call** from a reused instance buffer. Emitters are keyed by
preset name, or by content for inline preset objects (building the same literal every frame
stays one emitter); `register` under an existing name frees the old emitter. Vary bursts
with the options (`count`, `direction`, `speed`, `scale`, `colors`) rather than new presets.
Particles freeze with `paused`, advance with `step()`, and are cleared when a level unloads.

### Pixel HUD (`src/engine/hud/`)

```ts
update(ctx: GameContext) {
  const { hud } = ctx;
  hud.clear();                                                   // retained: clear + redraw
  hud.sprite(6, 6, ['.oo.', 'oyyo', 'oyyo', '.oo.'], { o: 'orange', y: 'sand' });
  hud.text(14, 6, `${coins}/12`, { color: 'sand' });           // 5×7 font, uppercase
  hud.text(6, 6, 'LIVES 3', { anchor: 'top-right' });
  hud.text(0, 0, 'PAUSED', { anchor: 'center', scale: 2, shadow: 'navy' });
  hud.rect(0, 0, hud.width, 12, 'ink', 'bottom-left');           // a bar along the bottom
}
```

The HUD is a 2D canvas at the internal resolution (480×270 or 320×180), placed exactly over
the game canvas with the framing's integer scale and letterbox offset, so one HUD pixel is
one art pixel at every size and after `R`. It is drawn after (outside) the post filters and
the pixel pass: text stays crisp in Raw 3D mode and under CRT/VHS looks. x/y are art-pixel
offsets from the `anchor` (`top-left` default, `top`, `top-right`, `left`, `center`, `right`,
`bottom-left`, `bottom`, `bottom-right`); `hud.measure(text, scale)` gives the size. It only
repaints when the content or layout changed, and `renderer.capture()` does not include it.

### Dynamic lights (`src/engine/render/lights.ts`)

Torches, spells, projectiles, loot beams and glowing monsters all want a light, but every
light a toon material sees is compiled into its shader: adding or removing lights
recompiles every lit material. `ctx.lights` (`LightPool`) solves both: it keeps a **fixed
number of real `PointLight`s** in the scene (quality `low` 4 · `medium` 8 · `high` 16, unused
ones at intensity 0) and hands them, every frame, to the most important of any number of
**light requests**.

```ts
const torch = ctx.lights.request({
  position: [3, 1.6, 4], color: 0xffa040, intensity: 6, radius: 7, // radius = PointLight.distance
  flicker: 'torch',                       // none | torch | candle | brazier | pulse | strobe | spell
});
torch.position.set(4, 1.6, 4);            // move it, recolour it: uniforms only, no recompiles
torch.update({ color: 0xff4040, intensity: 9 });
torch.release();                          // fades out, frees its light

ctx.lights.request({ follow: projectileMesh, color: 0xffb060, intensity: 6, priority: 3 }); // follows an object
ctx.lights.request({ position: at, color: 0xffffff, intensity: 14, radius: 9, lifetime: 0.4, fadeIn: 0.02 }); // a flash
ctx.lights.stats();      // { size, requests, lit, assignments, waiting, updateMs }
ctx.lights.describe();   // every request with its score, slot and fade level
```

- **Assignment.** Each frame a request scores `intensity × priority × proximity` to the
  camera focus (`1 / (1 + (d / max(4, radius))²)`, zero beyond the visible range + its
  radius). The top `size` requests get a light. A request that already holds one scores
  ×1.35 (**hysteresis**), so two similar torches never trade a light back and forth.
- **No pops.** A light changes hands only after its old owner has **faded out**
  (`fadeOut`, default 0.2 s, twice as fast while a new request waits); the new owner
  **fades in** (`fadeIn`, 0.25 s). Fades are smoothstepped; levels never jump by more than
  `dt / fade` per frame (unit-tested).
- **Priority** puts important lights first: the hero's light 8, a projectile 3, a loot beam 2,
  a torch 1. `lifetime` releases flashes by themselves. `follow` + `offset` track an object.
- **Engine-owned.** The pool is created on first use of `ctx.lights` and stays in the scene
  across `loadGame` (its requests are released on unload), so a new level never changes the
  light count. `engine.setQuality()` resizes it: one recompile of lit materials, on purpose.
  `new LightPool({ size, parent })` + `pool.update(dt, focus, range)` makes a private one.
- **Logic is pure.** `LightAssigner` (the slot/fade/hysteresis logic) has no three.js in it
  and is unit-tested in `lights.test.ts`; the `riftlight-levels` e2e suite checks a constant
  8 lights in the scene and **zero new node builds** while 24 requests move and change
  colour, on WebGPU and the WebGL 2 fallback.
- **Cost.** CPU: one pass over the requests per frame, 0.02–0.07 ms for 60–67 requests
  (average of 200 updates, measured by the e2e suite). GPU: every lit fragment loops over all `size` lights, so cost grows linearly
  with the pool, which is why quality caps it; the scene renders at the art resolution
  (480×270 ≈ 130 k fragments), so even 16 lights are cheap on real GPUs. Measured on
  SwiftShader (CPU rendering, shared machine, noisy), median ms per captured level frame on
  the WebGL 2 fallback: 0 lights ~67–84, 8 lights ~101, 16 lights ~116–133; WebGPU on
  SwiftShader varied more between runs than between pool sizes.

### Triggers and collision events

```ts
const coin = physics.trigger({ cylinder: { halfHeight: 0.6, radius: 0.45 } }, [x, y + 0.5, z], {
  tag: 'character',          // only the hero (PlatformerCharacter tags its collider)
  once: true,                // removes itself after the first enter
  onEnter: (other, trigger) => collect(),
  onExit: (other) => {},
});
const zone = physics.trigger({ box: [2, 1, 2] }, [0, 1, 0], { onEnter: () => alarm() });
zone.position.set(4, 1, 0);  // movable; zone.enabled = false; zone.remove()
```

Shapes: `{ box: [hx, hy, hz] }`, `{ sphere: r }`, `{ capsule: { halfHeight, radius } }`,
`{ cylinder: { halfHeight, radius } }`. A trigger is not a collider: after every fixed step
Physics runs a Rapier intersection query for it and diffs the result, so it never blocks the
character, ray casts or the camera. It reports dynamic and kinematic bodies (set
`includeStatic` for level geometry); `filter(collider)` narrows further.

### Level lifecycle

```ts
await engine.loadGame(new Level2());                      // same renderer, camera, input, audio
await engine.loadGame(new Level3(), { camera: { preset: 'side' } });
engine.dispose();                                         // stop and free everything

// A level door, from the game's own code: the swap happens after this frame.
physics.trigger({ box: [1, 1.5, 0.3] }, door, { tag: 'character', once: true, onEnter: () => void ctx.engine.loadGame(new Level2()) });
```

`loadGame` can be called from anywhere, including the running game's `update`,
`fixedUpdate` or a trigger callback: it never swaps games in the middle of a frame. Loads
run one at a time and the latest call wins (an older load stops after its `setup()`, and
the newer one unloads what it built); `dispose()` during a load lets that `setup()` finish
on a live world and then frees everything.

Unloading calls the old game's optional `dispose(ctx)` hook, then removes every scene
object that is not engine-owned (`userData.engineOwned`: the lights, the particle group) and
disposes its geometry, materials and textures (also textures used only inside TSL node
graphs, and skinned meshes' bone textures), except resources marked `userData.shared`
(cached toon materials, the toon gradient, GLB geometry and textures that other clones
share). It clears physics, particles, the HUD and music, resets input, and resets the
scene background, fog and the sun / ambient light colors and intensities to the engine
defaults. **Carried over** between levels: filters, render mode, resolution, quality,
volumes / mute, the debug panel and the camera rig (unless `camera` is passed; it is applied
before `setup()`, so `ctx.camera` is already the new preset there). While a level loads the
render loop keeps drawing (paused while its pipelines precompile), but the game does not
advance, engine hotkeys are ignored, and keys pressed meanwhile are dropped, so nothing
fires on the first frame; that frame is a normal 1/60 s step. Use `Game.dispose` for
anything else the game owns (DOM, timers, listeners). Physics on its own:

```ts
physics.remove(body);       // or a collider; a static collider takes its empty fixed body along
physics.clear();            // all bodies, colliders, joints, character controllers, triggers, tags, bindings
                            // (safe from a fixedUpdate or trigger callback: that step loop stops)
physics.counts();           // { bodies, colliders, tags, bindings, triggers, controllers }: leak checks
input.dispose();            // removes every window / canvas listener (engine.dispose does it)
```

The `systems` e2e suite switches playground ↔ sandbox six times and checks that bodies,
colliders, controllers, triggers, tags, scene objects and GPU geometries/textures all return
to the same numbers. The page at `/` runs Riftlight (docs/GAME.md); `?game=playground` and
`?game=sandbox` open the engine demos (`?game=arcade` is Riftlight's side-scroller on its own, a
template for that genre), and `window.__PIXEL_GAMES__` holds every game (`src/main.ts`).

### Input: gamepads and press timing

Gamepads with the W3C **standard** mapping (`gamepad.mapping === 'standard'`, what Chrome,
Firefox and Safari report for Xbox / PlayStation / Switch Pro and most others) need no
setup; pads with an unknown layout are ignored rather than guessed at. For them: the left stick feeds `input.moveAxis()` (radial
deadzone 0.2, `applyDeadzone`), the right stick turns into pointer movement (camera look,
`input.gamepadLookSpeed`), and buttons press key codes through `input.gamepadButtons`
(`GAMEPAD_BUTTONS`: A Space · B C · X J · Y F · LB Z · RB X · LT Shift · RT C · Back V ·
Start B · d-pad arrows), so `KEYMAP` / `readMoveInput` work unchanged. Remap with
`input.gamepadButtons[2] = 'KeyF'`.

`consumePress` keeps a press for at most `input.pressWindow` = **150 ms of game time**, so a
jump pressed during a hitch still lands, but presses never pile up. While `engine.paused` is
true (or a level is loading, including the start-up loading screen) game time (`ctx.time`)
stops and queued presses are dropped, so nothing fires on resume.

### Textured and vertex-colored toon materials

`toonify` (and so `ctx.loadModel`) keeps a material's base color **texture** (switched to
nearest filtering, no mipmaps: crisp texels) and its **vertex colors**, on the same 3-band
toon material: `color × map × vertex color`. By hand:
`toonMaterial(palette.white, { map: pixelTexture(tex), vertexColors: true })`.

Two more options make bodies read in dark scenes and leave with style (TSL, cached per option
set like every toon material; the colour is a uniform, so every rim colour shares one shader):

- `rim: 0xrrggbb`: a hard-banded rim light on grazing, upward-facing surfaces, added to the
  emissive (so `material.emissive` hit flashes still work). Riftlight's monsters use their
  glow colour.
- `dissolve: true`: the material reads its own `dissolve` property (0 solid … 1 gone) through
  a material reference and discards a per-art-pixel noise below it, with a 1-pixel glowing
  front. Set it on per-body clones (`m.clone()` then `m.dissolve = 0`), never on the cached one.

### Engine options for shipping a game

```ts
Engine.start(game, {
  debugUI: false,                              // default: on in dev (vite) or with ?debug=1
  debugKeys: { resolution: 'F2', mute: null }, // rebind / disable; `false` = no hotkeys at all
  touchButtons: [{ label: 'A', code: 'Space', hint: 'jump' }, { label: 'B', code: 'KeyJ' }],
  touchBar: false,                             // no ⚙ P R ◐ ♪ bar on phones unless ?debug=1
});
```

Default hotkeys (`DEFAULT_DEBUG_KEYS`): `mode` P · `resolution` R · `debug` \` (creates the
panel on demand) · `nextLook` ] · `prevLook` [ · `mute` M. The touch top bar follows them.

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

- `window.__PIXEL_ENGINE__.state()`: backend, mode, resolution, aspect, framing, frame
  count, fps, maxFps, quality, GPU errors and recoveries, camera, player target and game status.
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
- `?debug=1` shows the debug panel in a production build (it is on by default only in dev);
  `` ` `` creates it on demand. `?game=playground` / `?game=sandbox` open the engine demos (`/` is Riftlight).
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
- `npm run test:e2e` runs the production build in Chromium. Suites:
  - the backend paths (native WebGPU, natural WebGL 2 fallback, forced fallback)
  - every camera preset, including zoom, the side lane and free → fix → `?cam=`
  - every filter and every look on both backends; per-layer looks change only their layer
  - every move in `scripts/e2e-moves.mjs`
  - camera hot-swap keeps the player in place
  - the Animation Lab (clips, views, sheets, curves, API)
  - `phone`: a portrait viewport fills the screen (adaptive aspect), and a destroyed WebGPU
    device / lost WebGL context is recovered; Riftlight on a phone in portrait and landscape
    with no `?debug` (`scripts/e2e-riftlight-phone.mjs`): no tool bar, every skill slot
    reachable by touch, no HUD element under a control, panels that fit with 40 px targets
  - `Engine.step()` manual time
  - the tools: `build:single` runs from `file://` with no errors or requests, `film` writes
    its PNG + JSON, `balance` (a small matrix) writes its rows, CSV and charts, `inspect`
    reports the hero, a monster and a prop and diffs two GLBs
  - `riftlight-levels` (`scripts/e2e-riftlight-levels.mjs`, `@filters`): Riftlight levels 1, 6,
    12 and a rift build and render, the light pool keeps 8 lights with no shader builds while
    lights move, the hero walks start → exit with `Engine.step`, the boss opens the portal
  - `riftlight-showcase` (`scripts/e2e-riftlight-showcase.mjs`, `@cameras`): Riftlight's arcade
    side-scroller (scripted run to the flag), first-person Hall of Beasts and photo mode
    (a gameboy PNG), on WebGPU and the WebGL 2 fallback
  - `systems` (`scripts/e2e-systems.mjs`, in the `@filters` group): HUD framing, audio unlock and
    hero sounds, particles, coin triggers, gamepad, pause, hotkeys, `loadGame` without leaks,
    textured toon materials, `dispose()`, on WebGPU and the WebGL 2 fallback

  Frames are written to `.scratch/e2e/*.png`. It needs `xvfb-run`, because headless
  Chromium loses the WebGPU device when a canvas presents. Run one suite with
  `npm run test:e2e -- moves`, a CI group with `-- @core` (`@cameras`, `@filters`), and set
  `E2E_PORT` when another run uses the default port. Software rendering in CI runs at a few
  frames per second, so suites wait for conditions, game time or `Engine.step()` frames,
  never for a fixed number of rendered frames when they can avoid it.
- `npm run inspect -- <target>` (`src/engine/inspect/`, `scripts/inspect.ts`): any asset as
  `.scratch/inspect/<name>.png` + `.json`: an 8-angle turntable at one scale, a rig front and
  side (mesh dimmed, joints and names on top, right side orange, left cyan) and a panel with
  triangles, vertices, meshes, draw calls, materials (and distinct colours), textures,
  geometries, bounds, joints, clips with durations, and warnings: degenerate triangles, NaN
  positions, missing normals, too many materials or draw calls, triangle budget, huge or tiny
  bounds, below the floor, non-uniform scale on nodes with children, negative scale, joints
  that drive nothing (no vertex weights / no mesh under them), clips with no length. Targets:
  a GLB path or `hero`/`coin`/`tree` (the hero gets `HERO_RIG` and `HERO_CLIPS`),
  `clip:<name>` (the hero posed mid-clip plus its contact strip), `monster:<seed>` (`--depth
  --rank --plan --archetype --tags`), `boss:<level>`, `npc:<id>`, `prop:<id>` (`--theme`),
  `item:<seed>`, `list`. `--json` prints the report; `--strict` exits 1 on warnings.
  `npm run inspect -- diff <a> <b>` renders both at one scale with the B − A counts, joints,
  clips and materials added/removed; `diff <a>` compares `<a>` with the last *different*
  version inspected (every run records a fingerprint and a turntable in
  `.scratch/inspect/history/`), so after changing a generator an agent sees what changed:

  ```
  $ npm run inspect -- boss:4
  Kryssa, the Glass Matriarch  (hexapod caster, signature glaze-floor, scale 2.15)
    triangles 2060  vertices 2920  meshes 52  draw calls 52  materials 6  textures 0
    bounds 3.516 × 1.988 × 3.834 m  (min -1.758, 0, -2.076  max 1.758, 1.988, 1.758)
    joints 36  clips 9: Idle 2s, Walk 0.433s, Run 0.333s, Hit 0.467s, Death 1.133s, …
  $ npm run inspect -- diff coin tree
    vertices         88 → 124      +36
    meshes            2 → 3        +1
    - clips: Spin
  ```

  It renders with the software rasterizer of the contact sheets, not Chromium: it runs in
  about a second with no GPU, is byte-for-byte deterministic (fingerprints and diffs stay
  stable), and draws rig overlays and labels the real renderer has no pass for. The cost is
  fidelity: flat 3-band toon shading without the pixel pipeline, lights or filters (a mesh
  whose shader colours it procedurally can carry per-triangle preview colours in
  `geometry.userData.triColors`, see `presetTriangleColour` in `animation/raster.ts`; the
  sheets and portraits use them too). For the
  real look, film it (`npm run film`) or open a lab page.
- `npm run balance` (Riftlight, docs/GAME.md *Balance*): a headless combat sim over the game's
  real code, build × depth, as charts, CSV and JSON with its outliers.
- `npm run build:single` writes `dist-single/pixel-engine.html`, one self-contained offline
  file (Rapier's `.wasm` inlined as a data: URL).

### Tools for agents: how to build your own

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
   (`/lab.html`, `/monster-lab.html`, `/tree.html`), with a `window.__<TOOL>__` handle.
6. **Tests**: unit tests for the core next to it (`*.test.ts`), and a smoke run of the CLI in
   the `tools` e2e suite (`scripts/e2e.mjs` `runTools`: it runs, writes its files, and the
   numbers are sane), so the tool can't silently rot.

## Build size

`npm run build` (gzipped): `three` 271 kB, Rapier JS 28 kB + `rapier_wasm3d_bg.wasm` 774 kB
(fetched and compiled while it streams, in parallel with the renderer and models), engine
and game 111 kB, page 0.5 kB. The engine and game part is a `hero` chunk of 64 kB (the
engine, the animation toolkit and every hero clip as data; the Animation Lab loads it too),
`main` 40 kB (the playground and game systems), the pixel font 7 kB (JS + CSS) and the
Riftlight stat registry 2 kB. The Lab page adds 8 kB, the skill-tree page (`tree.html`)
31 kB. With `@dimforge/rapier3d-compat` the wasm was base64 inside a
1,094 kB JS chunk, decoded and compiled only after the whole chunk had been parsed.
`vite.config.ts` has a tiny `rapier-wasm-stub` plugin: wasm-bindgen's bundler build
imports the `.wasm` as an ES module, which the plugin stubs out so `initRapier()` can
instantiate it explicitly (no top-level await blocking the app).
Serve `.wasm` compressed (gzip/brotli; most static hosts and CDNs do, `vite preview` does
not): uncompressed it is 2.0 MB on the wire instead of 774 kB.

## The engine kit (`npm run bundle`)

Games outside this repo use the engine through a kit (`scripts/bundle.mjs`; `npm run build`
also writes it to `dist/engine/` and `dist/engine.zip`, so the site serves it at `/engine/`):

- `pixel-engine.js`: a Vite library build of `src/bundle.ts`, one self-contained ES module
  (about 4.3 MB, 1.5 MB gzipped). It exports the public engine API (`src/engine/index.ts`),
  three.js as `THREE` and `TSL` (a game must never load a second copy), `RAPIER`, the hero kit
  and `BUILTIN_MODELS`. Everything is inlined: Rapier's wasm as a data URL (`?url`), the
  engine CSS (injected on import, before the page's own), and `public/assets/*.glb` through
  `__PIXEL_BUILTINS__` → `window.__PIXEL_ASSETS__`, which `loadModel` reads first. Built with
  `base: './'`, so a game's own `assets/x.glb` resolves next to its page.
- `GUIDE.md` (docs/GUIDE.md, stamped with the version and build): the manual. Its fenced
  blocks `js <name>` are whole games: `quickstart` becomes the kit's `game.js` (+ `index.html`),
  the others `examples/<name>.html`. `src/guide.test.ts` checks that they import only real
  exports and that its lists (palette, looks, filters, sounds, particles, cameras, URL flags,
  built-in models) are the engine's; the `bundle` e2e suite plays every one of them.
- `API.md`: every export with its signature and doc comment, grouped by subsystem, generated
  from the TypeScript program (`scripts/bundle/api.mjs`). Mark a public member that games
  shouldn't use `/** @internal */`: it leaves API.md and the `.d.ts`.
- `pixel-engine.d.ts` + `types/`: declarations (`stripInternal`); a strict TypeScript game
  typechecks against them (the `bundle` e2e suite does it).
- `check.mjs` (`scripts/bundle/check.mjs`): the receiving agent's test tool. It serves the kit
  folder, plays a page in Chromium (`--keys KeyD*60,Space*4`, `--cameras`, `--looks`,
  `--backend webgpu`), saves PNGs with the HUD and a `report.json`, and exits 1 on any page,
  console, game or GPU error or a blank frame.
- `CHANGELOG.md`, `README.md` (generated: what is where, sizes, token estimates) and
  `manifest.json` (version, build, every file with its bytes).

Diagnostics that make the kit self-correcting live in the engine: `Engine.start` sets
`window.__PIXEL_ENGINE__` (`dispose()` clears it); an exception in a game hook is caught per
frame, kept once in `engine.errors` (at most 20; also `state().errors`), logged and shown in a
box (`[data-engine-error]`) while the loop keeps running; `step()` throws it to its caller
instead (tools); a failed start shows "Failed to start: ..." in `.fatal`. Games start with
`withUrlOptions(options)`, so the URL's review flags (`?look=`, `?camera=`, `?zoom=`,
`?debug=1`) work in any kit game without replacing its own camera.
`ENGINE_VERSION` comes from `package.json` (`__ENGINE_VERSION__` in `vite.config.ts`).
