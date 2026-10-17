# Rendering

The pipeline contract (`src/engine/render/`, `PixelRenderer`), toon materials, render-to-texture, mirrors, TSL materials and the sun. Lights: docs/engine/lights.md; filters and looks: docs/engine/looks.md.

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
everything but the final copy.

- **Before the pipeline.** `PixelRenderer.onBeforeRender(f)` listeners run before each frame
  (and each capture), outside the pipeline: render-to-texture views and mirrors draw their own
  cameras there into half-float targets, so this frame's screens show this frame. They are
  cleared when a level unloads; one that throws is reported once (on screen, `engine.errors`)
  and skipped, the frame's render target put back. Screens
  and mirrors sit on `SCREEN_LAYER` (2), which the main camera always sees and the views never
  do. Each extra camera also renders the shadow map again.
- **One renderer, WebGPU only.** `PixelRenderer` owns a single `WebGPURenderer` and a single
  `RenderPipeline`, on WebGPU and nothing else (docs/DOCTRINE.md, principle 6). Without it (no
  `navigator.gpu`, no adapter, or three falling back to its WebGL 2 backend) `PixelRenderer.create`
  throws `NO_WEBGPU` and the page says so: "Failed to start: WebGPU unavailable: …".
  `renderer.backend` is `'WebGPU'`, shown in the debug UI. Development runs it in Chromium's
  headless shell on SwiftShader's Vulkan (`scripts/browser.mjs`), no display needed.
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
  light requests (docs/engine/lights.md).
- **Screen effects.** Every output graph (Pixel and Raw, every look) ends with the same small
  stage: retro transitions, a flash and up to four shockwave rings, all uniforms
  (`engine.screen`, docs/engine/effects.md *Screen effects*).
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
  by group; `uv` stays under a textured material, `color` under a vertex-coloured one). Keep
  one collider per block and anything that moves separate.
- **Lost GPU device.** Mobile browsers drop the WebGPU device after backgrounding or under
  memory pressure. `PixelRenderer` notices (`device.lost`), builds a new renderer, canvas, scene passes and pipeline for the same
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
  debug UI (uncaptured validation errors). It must stay at 0.
- **Compat shim.** `webgpuCompat.ts` drops three r186's identity `swizzle: 'rgba'` from
  texture views, which Chromium ≤ 141 rejects (black screen otherwise).

## Textured and vertex-colored toon materials

`toonify` (and so `ctx.loadModel`) keeps a material's base color **texture** (switched to
nearest filtering, no mipmaps: crisp texels) and its **vertex colors**, on the same 3-band
toon material: `color × map × vertex color`. By hand:
`toonMaterial(palette.white, { map: pixelTexture(tex), vertexColors: true })`. `glowMaterial(color)` is the
unlit counterpart of `toonMaterial`, for flames and screens.

Two more options make bodies read in dark scenes and leave with style (TSL, cached per option
set like every toon material; the colour is a uniform, so every rim colour shares one shader):

- `rim: 0xrrggbb`: a hard-banded rim light on grazing, upward-facing surfaces, added to the
  emissive (so `material.emissive` hit flashes still work). Riftlight's monsters use their
  glow colour.
- `dissolve: true`: the material reads its own `dissolve` property (0 solid … 1 gone) through
  a material reference and discards a per-art-pixel noise below it, with a 1-pixel glowing
  front. Set it on per-body clones (`m.clone()` then `m.dissolve = 0`), never on the cached one.

## GPU compute, render to texture, mirrors, TSL materials

```ts
const swarm = new GpuSwarm({ count: 32768, center: [0, 2, 0] }); // storage buffers + a TSL compute shader
scene.add(swarm.mesh); swarm.update(engine.renderer, dt);      // per frame (nothing headless); swarm.attractor.value.set(...)

const cam = new RenderView({ size: [160, 90], every: 2 });     // a camera drawn into a texture
const stop = cam.attach(engine.renderer, scene);                // before every frame; stop() (or a level unload) ends it; headless never runs it
screen.material = cam.screenMaterial(); RenderView.screen(screen); // its layer: views never see it

const mirror = new Mirror({ size: [8, 3] }); scene.add(mirror.mesh); // faces its local +z
const unmirror = mirror.attach(engine.renderer, scene);         // ortho or perspective camera
// leaving: stop(); unmirror(); cam.dispose(); mirror.dispose(); swarm.dispose()

mesh.material = hologramMaterial({ color: PALETTE.cyan });      // also forceField, lava, marble, wood, crystal
```

`render/gpuSwarm.ts` keeps positions and velocities in `instancedArray` storage buffers; an
init compute places every particle from a hash of its index, a step compute adds a spring pull, a
swirl and a noise flow, drag, a floor bounce; one instanced `Sprite` draw reads the same buffer
(`positions.toAttribute()`), so nothing goes back to the CPU (`read()` does, for tests).
`dispose()` (or disposing
its material, as a level unload does) frees both compute shaders too. `seed` varies the layout
and the flow; whatever it is, each swarm's shaders carry a literal of their own, so two swarms
never share a compiled program. `PixelRenderer.onBeforeRender(f)` runs
before each frame (and capture), outside the pipeline: `render/renderView.ts` (`RenderView`)
draws its own camera into a small nearest-filtered target there, every `every` frames.
`render/mirror.ts` (`Mirror`) does the same from `mirrorCamera`: the active camera reflected in
the glass with an oblique near plane on it (Lengyel, general for orthographic and perspective,
WebGPU and WebGL depth ranges), at the art resolution, and the glass samples it at
`screenUV.flipX()`. Screens and mirrors go on `SCREEN_LAYER` (2): the main camera always sees it,
views never do, so a texture is never sampled while it is drawn. Targets are half-float like the
pipeline's own (colour is linear there: 8 bits would band the darks). Each view costs a scene
render at its size plus another shadow-map render; `capture()` runs the listeners too. `render/shaders.ts` holds TSL
materials computed per pixel (noise, Worley cells, rim from the view normal), banded into
palette steps; the see-through ones dither with `bayer4()` instead of blending.

## The sun

`engine.setSunDirection([x, y, z])` points the sun (and its shadows) toward a direction (kept
just above the horizon; dim `engine.sun.intensity` for night). `engine.sunDir` reads it. The
shadow box re-fits and stays texel-snapped. Like the sun's colour and intensity, the direction
goes back to the engine default when the level unloads.
