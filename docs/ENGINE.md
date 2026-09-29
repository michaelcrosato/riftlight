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
Toon/node scene ─▶ WebGPU scene pass ─▶ low-res pixelation ─▶ depth/normal edges ─▶ output color transform ─▶ nearest-neighbor presentation
  MeshToonNodeMaterial   pixelationPass renders       (same pass: MRT color     (TSL, PixelationNode)    RenderPipeline                   canvas = internal × integer scale,
  3-band gradient         at internal res into a       + normal + depth, nearest                          (sRGB, no tone mapping)          NearestFilter sampling, letterboxed
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
  plain full-res `pass()`. Same renderer, pipeline, canvas, camera, physics, animation,
  lighting and framing.
- **Edges.** Depth/silhouette edges 0.45, normal (internal crease) edges 0.08. Both are
  uniforms, so tune with `renderer.setEdges({ depth, normal })`.
- **Lighting.** One `DirectionalLight` (hard `BasicShadowMap` shadows) + modest
  `AmbientLight`, 3-band `MeshToonNodeMaterial` (`TOON_BANDS`), `ContactShadow` blobs under
  characters. Every color comes from `PALETTE` (Sweetie 16).
- **Pixel alignment is presentation only.** `FollowCamera` snaps its own position to whole
  art pixels in its view plane (both modes, so toggling never moves the view). Rapier bodies
  are never snapped; visuals are interpolated between fixed 60 Hz steps.
- **GPU errors.** `renderer.onError` is captured into `renderer.gpuErrors` and shown in the
  debug UI. It must stay at 0.
- **Compat shim.** `webgpuCompat.ts` drops three r186's identity `swizzle: 'rgba'` from
  texture views, which Chromium ≤ 141 rejects (black screen otherwise).

## Making a game

A game implements `Game` (`src/engine/Engine.ts`) and is started with `Engine.start`:

```ts
import { CharacterController, Engine, type Game, type GameContext, toonMaterial } from './engine';
import { BoxGeometry, Mesh, Vector3 } from 'three/webgpu';

class MyGame implements Game {
  readonly name = 'My Game';
  hero!: CharacterController;
  model = new Mesh(new BoxGeometry(0.6, 1.6, 0.6).translate(0, 0.8, 0), toonMaterial(0x3b5dc9));

  async setup({ scene, physics, palette }: GameContext) {
    const floor = new Mesh(new BoxGeometry(20, 1, 20), toonMaterial(palette.green));
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    scene.add(floor, this.model);
    physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [10, 0.5, 10] });
    this.hero = new CharacterController(physics, { position: [0, 0, 0] });
  }
  fixedUpdate({ input, camera }: GameContext, dt: number) {
    const a = input.moveAxis();
    const { right, forward } = camera.groundBasis();
    const move = right.multiplyScalar(a.x).addScaledVector(forward, a.y);
    this.hero.setInput(move, input.consumePress('Space'), input.isDown('Space'));
    this.hero.fixedUpdate(dt);
  }
  update({ physics }: GameContext) {
    this.model.position.copy(this.hero.interpolatedFeet(physics.alpha));
  }
  cameraTarget() {
    return this.model.position.clone().add(new Vector3(0, 0.8, 0));
  }
}

Engine.start(new MyGame(), { container: document.getElementById('app')! });
```

Rules of thumb for good-looking results:

- Use `PALETTE` colors only, via `toonMaterial(color)`. Load GLBs with `ctx.loadModel`;
  their materials are converted to toon automatically, so only base colors matter.
- Chunky, low-poly shapes read best at 480×270. Aim for features ≥ 0.25 world units
  (≈ 5 art pixels at the default view height of 13.5).
- Put movement and forces in `fixedUpdate`; animation, pickups and UI in `update`.
- Use `input.consumePress` in `fixedUpdate` (never drops a press); use `wasPressed` in `update`.
- New assets: extend `scripts/generate-assets.mjs` (deterministic) or drop GLBs into
  `public/assets/`. See `src/game/coinGarden.ts` for a complete example.

## Tooling for agents

- `window.__PIXEL_ENGINE__.state()`: backend, mode, resolution, framing, frame count,
  GPU errors, camera, player target and game status.
- `await window.__PIXEL_ENGINE__.renderer.capture()`: RGBA8 readback of the exact frame
  the pipeline presents, which lets you see what you built.
- `window.__PIXEL_ENGINE__.input.setKey(code, down)`: drive input from scripts.
- `npm run test:e2e`: runs the production build in Chromium under three scenarios (native
  WebGPU, natural WebGL 2 fallback, forced fallback) and checks backend, zero GPU/console
  errors, pixel-perfect blocks, the Raw-mode invariants, 320×180 framing and gameplay.
  Frames are written to `.scratch/e2e/*.png`. Needs `xvfb-run`: headless Chromium loses
  the WebGPU device when a canvas presents.
