# Changelog

What changed in Pixel Engine for a game built on it, newest first. The version is
`package.json`'s; a game reads it as `ENGINE_VERSION`, `Engine.version` or
`engine.state().version`. The engine kit (`npm run bundle`, docs/GUIDE.md) ships this file.

When a change alters the public API (`src/bundle.ts` exports) or something a game can see,
bump the version (minor while it is 0.x) and add its section here; `npm test` fails when
`package.json`'s version has no section.

## 0.12.0

- **GPU compute**: `GpuSwarm` (render/gpuSwarm.ts): particles in storage buffers moved by a TSL
  compute shader (a spring pull, swirl, noise flow, drag, floor), drawn by one instanced sprite reading
  the same buffer; `attractor`, `pull`, `swirl`, `turbulence`, `drag` uniforms, `reset`, `read`;
  re-placed on a new renderer (a recovered GPU device). `dispose()` (or disposing its material)
  frees the compute shaders; `seed` varies the layout and the flow; two swarms never share a
  compiled program.
- **Render to texture**: `RenderView` (render/renderView.ts) and `PixelRenderer.onBeforeRender`
  (listeners cleared when a level unloads, `clearBeforeRender`; one that throws is reported once
  through `onError`, on screen in the engine, and skipped); `SCREEN_LAYER` (the main camera always sees it, views never);
  `PixelRenderer.activeCamera`. Half-float targets.
- **Mirrors**: `Mirror` and `mirrorCamera` (render/mirror.ts): a reflected camera with an oblique
  near plane, for orthographic and perspective cameras on both backends.
- **TSL materials**: `hologramMaterial`, `forceFieldMaterial`, `lavaMaterial`, `marbleMaterial`,
  `woodMaterial`, `crystalMaterial`, `bayer4` (render/shaders.ts).

## 0.11.0

- **Procedural generation** (`src/engine/procgen/`):
  - `createNoise(seed)`: seeded 2D/3D simplex noise, `fbm2` (octaves, lacunarity, gain) and
    `ridged2`.
  - `Terrain`: a heightfield from a height function, drawn flat-shaded and coloured by height
    bands and slope (`TERRAIN_BANDS`), `heightAt` on Rapier's triangulation, `normalAt`,
    `attach(physics)` for a heightfield collider, and `erode` (droplet hydraulic erosion: seeded,
    unit-independent, never digging below where a drop now is, a `margin` of edge points kept).
  - `Wfc` and `patternTiles`: tiled wave function collapse with weights, a border socket,
    fixed cells, restarts on contradiction, `step()` to watch it and `entropy(cell)`.
  - `expand`, `turtle` and `PLANTS`: L-systems with stochastic rules and a 3D turtle (branches
    with radius and depth, leaves, tropism, jitter).

## 0.10.0

- **Picking**: `input.pointer` (where the pointer is over the canvas, in normalised device
  coordinates, and whether it is over it; the screen's centre under pointer lock),
  `input.setPointer` for tests, and `camera.rayAt(x, y, origin, dir)`: the ray through a pixel.
- **Rewind**: `Rewind` (physics/rewind.ts) records tracked bodies (pose, velocities, sleep)
  and `extra` state every physics step in a ring buffer and plays it backwards while
  `rewinding`.
- `physics.onStep` listeners now run before bound meshes read their bodies, so a body a
  listener moves after the step is drawn where it put it; `onStep(f, { first: true })` runs
  ahead of the other listeners.
- `physics.remove`, `Ragdoll`, `Floaters` and joint chains check a body, collider or joint with
  `isValid()`, not by handle: a removed one's slot can hold a newer one, which a handle lookup
  took for the old one. A removed collider is no longer a conveyor belt (a newer collider in its
  slot was).
- `Ragdoll`: a part touching something may sit up to 12° past its cone instead of being turned
  back every step, so a ragdoll whose head is pressed into a stair or the floor comes to rest.

## 0.9.0

- **Vehicles**: `Vehicle` (physics/vehicle.ts) on Rapier's ray-cast vehicle controller:
  suspension, rear-wheel drive with a `topSpeed` (full force against the motion: a brake),
  speed-narrowed steering, mass-scaled brakes and rolling resistance, a handbrake drift (rear
  grip cut, `driftYaw` assist), `speed` along the heading, `slip` / `slipAngle`, `yaw`,
  `wheelPose` (world or chassis space), `reset`, `setSuspension`, `dispose`; the chassis never
  sleeps. `physics.clear()` frees vehicle controllers and `counts()` reports them.
- **Bullets**: `BulletPool` (ai/bullets.ts): thousands of projectiles in typed arrays (`fire`,
  `step` with a wall test, `hits`, `near` by team, `graze` once per bullet, `kill`, `killAll`,
  `clear`) and `emitter` for seeded patterns (`aimed`, `fan`, `ring`, `spiral`, `wave`,
  `burst`), safe against a zero interval and long hitches.

## 0.8.0

- **Navigation**: `NavGrid` (ai/navgrid.ts): walkable cells from an ASCII map (`fromRows`:
  '#' walls and ' ' pits closed by default) or set by hand; `path` (A*, 8 directions, no corner
  cutting, smoothed; a target in a wall goes to the nearest reachable cell), `lineOfSight` (a
  DDA, optional body width), `castWall` (the same cell walk), flow fields (`flowTo`,
  `flowDirection`, `flowDistance`), `setOpen` (doors).
- **Flocking**: `Boids` (ai/boids.ts): separation, alignment and cohesion over a spatial hash,
  `seek`, `flee`, sphere `obstacles`, `bounds` (pushed back in from `margin` inside them), `flat`
  herds and schools, seeded; `order()` and `spacing()` to measure it.

## 0.7.0

- **Ragdolls**: `Ragdoll` (physics/ragdoll.ts) turns a jointed model into capsules on hinge
  joints with limits or ball joints held in cones, parts that hit the world but not each other;
  `enable({ velocity, spin })`, `push(at, velocity)`, `sync()` (interpolated between physics
  steps), `rootPose()` (lying face up or down, the heading to get up with), `release()` (back to
  animation with a blend), `disable()`. `HERO_RAGDOLL`: the hero's eleven parts (also in the
  engine kit).

## 0.6.0

- **Procedural motion** (animation/procedural.ts, exported from the engine): `SpringChain`
  (points hanging off a moving root with momentum, gravity, a pull toward their rest direction
  and fixed lengths: scarves, tails, antennae), `Squash` (a damped spring drawn as a
  volume-preserving `[xz, y]` scale), `LegStepper` (planted feet that step in arcs when they
  fall behind, only while their partners are down; `reset`, `planted()`), `gaitPartners(n)`
  (a tripod for six legs, a trot for four) and `twoBoneIK` (a 3D knee or elbow bent toward a
  pole).
- **Pixel sprites**: `SpriteBatch` (camera-facing quads, one instanced draw per sheet, each
  with its own position, size, frame and mirror; alpha cut-out, nearest sampling) and
  `drawSheet` (paint a sheet in code on a canvas).

## 0.5.0

- **Water**: `WaterSurface` (render/water.ts): up to four travelling waves moved in the vertex
  shader, the same `waterHeight` the CPU sums, plus a `RippleField` (the 2D wave equation on a
  grid, `splash(x, z, radius, strength)`) uploaded as a float texture; toon-lit from the waves'
  slopes, foam on crests, hard sun glints, and see-through by an ordered dither (`opacity`).
  `heightAt`, `covers`, `setWaves`.
- **Buoyancy**: `Floaters` (physics/buoyancy.ts) float Rapier bodies on any height function:
  eight octants each (any way up), the volume of the collider's shape, water density 1 in world
  mass units, drag, `onSplash`.
- **Weather and sky**: `Precipitation` (rain or snow: thousands of drops in one instanced draw,
  placed by the vertex shader, `intensity`, `wind`, `splashes(dt)`); `skyAt(hour)` and
  `applySky(engine, sky)` (a day of sun direction, colours, ambient and background, `night`);
  `groundFog()` (a `scene.fogNode` with live uniforms).
- **Grass and wind**: `GrassField` (instanced blades bent in the vertex shader: lean, flutter,
  rolling gusts, up to four pushers that part them), `WindUniforms` and `swayObject` /
  `swayMaterial` (trees and plants lean with the wind).
- **Trails and decals**: `Trail` (a camera-facing ribbon through recent points) and `Decals`
  (footprint, scorch, splat, crack and ring shapes cut out in the shader, one instanced draw per
  shape, dithered fade-out, a fixed pool).
- Exports: `WaterWave` (the water `Wave` type: `Wave` is the audio one), `MAX_WAVES`,
  `MAX_PUSHERS`, `DECAL_SHAPES`.

## 0.4.0

- **Moving platforms**: `physics.addMover(body, options)` drives a kinematic body along a path
  (eased legs, holds, pingpong or loop), spinning, swinging, or on any `curve(t)` (`orbit`,
  `pendulum`: level seats on a circle or an arc), as a pure function of its own clock
  (`mover.time`, from 0 when added; the body starts there). Removing the body stops it.
  `PlatformerCharacter` rides whatever is under its feet (`groundCollider`): kinematic
  platforms (turns included), dynamic ones (and presses them with its `weight`, 0 by default)
  and conveyors.
- **Conveyors**: `physics.conveyor(collider, velocity)` drags what touches it; `beltMaterial`
  scrolls stripes on game time.
- **Force fields**: `physics.fields.add({ box | sphere, at, force, radial, falloff, drag })`
  push dynamic bodies and the character (momentum in the air, a drift standing; an updraft's
  rise isn't cut short by letting go of jump); `character: false` / `bodies: false` hold for
  their drag too. `physics.explode(at, { radius, impulse })`.
  `character.launch(vy, { hvel })`: a jump no button can cut short.
- **Joints** (`physics/joints.ts`): `chain` (a wrecking ball), `ropeBridge` (walkable, `cut`),
  `hingeDoor`, `springPad`, `seesaw`, each with `remove()`. Spring motors are force-based and
  scaled by mass or inertia (they give under weight).
- **Destruction**: `Breakables` (`add`, `break`, `near`, `byCollider`, `restore`, `crumble`
  tiles that drop and grow back; pieces dissolve after `linger` and leave the world) on
  `fractureBox` (seeded, jittered cuts that tile the box).
- **Soft bodies** (`physics/verlet.ts`): `clothGrid` (any plane: `down`), `ropeLine`,
  `softBlob` with pins, wind, spheres, boxes and a floor; `SoftMesh` and `RopeMesh` draw them.
  Cloth wind is a pressure along each triangle's normal (speed squared) plus skin drag, the
  same however finely the cloth is cut (`drag` per (m/s)² for cloth, per m/s for ropes).
- **Many bodies**: `InstancedBodies` (one draw call per shape, interpolated, `spawn` reuses the
  oldest, `ccd`). `physics.onStep(f)`, `physics.time`, `physics.stepMs`, `physics.castUp`.
- **Character**: `shove` and `weight` (both 0 by default: walking into loose dynamic bodies
  pushes them up to that much mass; standing on one presses it), `crushed` / `stats.crushes`
  (a kinematic body coming down on the head), an updraft stronger than gravity lifts it off
  the ground, and it only grabs ledges of fixed bodies (never a loose body or a moving
  platform: hanging doesn't ride).
- `physics.clear()` (every `loadGame`) also restores gravity and the solver's iterations and
  drops movers, fields, belts and step listeners; `counts()` reports joints, movers, fields
  and belts.

## 0.3.0

- **Game feel**: `engine.timeScale` (slow motion, fast forward, 0 to freeze) scales game time
  for physics, animation, particles, tweens and the camera (at 0, presses are dropped like a
  pause); `engine.hitstop(seconds)` freezes the game for real seconds while rendering, shake and
  transitions go on. Both work with `engine.step()`; `loadGame` resets the speed.
- **Screen shake in the engine**: `engine.shake.add(trauma)` (`CameraShake`, trauma squared,
  deterministic), added to the camera after the rig, by whole art pixels on ortho presets.
- **Screen effects** (`engine.screen`, `render/screenFx.ts`): nine transitions (`TRANSITIONS`:
  fade, iris, diamonds, dissolve, dither, blinds, wipe, curtain, mosaic) with `cover`, `reveal`
  and `transition` (they resolve `true` when they ran to the end), a `flash`, and up to four
  `shockwave` rings. Uniforms at the end of every output graph: no shader compiles, every look,
  Pixel and Raw mode, almost free while nothing runs; real time and across `loadGame`.
  Colours are display colours (palette names or hex). `coversPixel` mirrors the patterns.
- **Tweens**: `ctx.tweens.to / value / call` with 22 eases (`EASES`, including stepped ones),
  yoyo, repeat, delays and takeover; on game time, cleared on unload (`done` resolves `false`).
- `engine.setSunDirection(dir)` and `engine.sunDir`: point the sun and its shadows (reset on
  unload).
- `input.preventKeys`: keys whose browser default is blocked (a game's F1 / Tab panels).
- `loadGame` also clears a TSL `scene.fogNode`, and a light with an unknown flicker preset is a
  steady light instead of a NaN that blacked out every lit pixel.
- The 5×7 font has `{ } ; & | \ ~ ^ $` and the backtick.
- `state()` reports `timeScale`, `hitstop` and `screen`.

## 0.2.0

- **The engine kit**: `npm run bundle` builds `pixel-engine.js`, one self-contained ES module
  (engine, three.js as `THREE` and `TSL`, Rapier with its wasm, the hero kit, the built-in
  models and the CSS), with `GUIDE.md` (how to build a game on it), a generated `API.md`,
  TypeScript declarations, a starter game, the guide's recipes as pages, and `check.mjs` (plays
  a page in a browser and fails on any error). `npm run build` also writes it to `dist/engine/`
  and `dist/engine.zip`.
- **Errors are reported, not just logged**: an exception in a game hook is caught, kept in
  `engine.errors` (and `state().errors`), shown in a box on screen, and the loop keeps running.
  A `setup()` that throws shows "Failed to start: ...".
- `Engine.start` sets `window.__PIXEL_ENGINE__` itself, so every page has the tooling handle
  (only this repo's `main.ts` used to set it); `dispose()` clears it.
- `withUrlOptions(options)`: a game's options with the URL's review flags on top (`?zoom=`
  keeps the game's camera preset, `?filters=` replaces its look).
- `ENGINE_VERSION`, `Engine.version`, `state().version`.
- Looks: filters per layer (characters & objects vs environment) with parameters and presets,
  38 named looks (`LOOK_PRESETS`) including `no_filters`, the `cel` and `adjust` filters.

## 0.1.0

The engine before versions: the WebGPU-first pixel pipeline with the WebGL 2 fallback, camera
presets, Rapier physics and triggers, `PlatformerCharacter` with the hero's moveset and clips,
audio, particles, the pixel HUD, the dynamic light pool, post filters and the agent tooling.
