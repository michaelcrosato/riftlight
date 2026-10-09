# Pixel Engine: the guide

This guide is for an AI agent (or a person) building a game on Pixel Engine from the kit:
`pixel-engine.js` plus this guide, `API.md` and a starter game. Read it whole once; it is
written to be enough. `API.md` has every export with its exact signature: search it when you
need a name or a parameter, don't read it whole.

Contents: 1 Host it · 2 Mental model · 3 Quick start · 4 The API by system · 5 Recipes ·
6 Rules · 7 Common mistakes · 8 Debugging and checking · 9 Before you hand back · 10 Versions

## 1. Host it

A game is static files next to the engine. Nothing to install, no build step:

```
my-game/
  pixel-engine.js     the engine (never edit it; upgrade by replacing it)
  index.html          a page with <div id="app"> that loads game.js as a module
  game.js             your game: import { ... } from './pixel-engine.js'
  assets/             your own .glb models, if any (optional)
```

The kit's `index.html` and `game.js` are exactly that: copy the kit folder and edit `game.js`.
Split a bigger game into more modules (`import { Level } from './level.js'`) as usual.

- **Serve it over HTTP.** ES modules don't load from `file://`. Any static server works:
  `npx serve .`, `python3 -m http.server`, GitHub Pages, Netlify, an S3 bucket.
- **One import.** `pixel-engine.js` is one self-contained ES module (about 4.3 MB, 1.5 MB
  gzipped). It holds the engine, three.js r186 (as `THREE` and `TSL`), Rapier physics with its
  wasm, the hero (model, rig and every animation clip), three built-in models (`assets/hero.glb`,
  `assets/coin.glb`, `assets/tree.glb`) and the engine's CSS. Don't load anything else.
- **The page is the game's.** Importing the engine adds its CSS, which makes the page a
  full-screen game: `html, body` don't scroll and `#app` fills the window. To embed a game in a
  bigger page, give the container your own size and position (your CSS comes later and wins).
- **Browsers.** WebGPU where the browser has it, otherwise WebGL 2 (automatic, same picture).
  Phones and tablets get on-screen touch controls by themselves.
- **Your own models.** Put GLBs in `assets/` and call `ctx.loadModel('assets/ship.glb')`
  (paths are relative to the page). To ship one file with no `assets/` folder, set
  `window.__PIXEL_ASSETS__ = { 'assets/ship.glb': 'data:model/gltf-binary;base64,...' }`
  in a classic `<script>` before the module loads.

## 2. Mental model

**The engine renders 3D as pixel art.** You build a small 3D world out of chunky low-poly
shapes and toon materials in a 16-colour palette. The renderer draws it at a low art
resolution (480×270, wider or taller to fit the screen), adds pixel outlines and scales it
up by whole pixels. You never draw sprites; the pixel art comes from the camera and the
pipeline. A **look** can change that: other palettes, CRT, cel shading, or clean
full-resolution rendering, per layer (section 4, *Looks*).

**The engine owns the machinery; a game is a plain object with hooks.** The engine owns the
renderer, camera rig, physics stepping, the sun and ambient light, input, audio, particles,
the pixel HUD, the loading screen and the debug tools. You write a class:

| Hook | When | Do here |
| --- | --- | --- |
| `name`, `assets` | before start | the title; models to start downloading early |
| `async setup(ctx)` | once | build the level: meshes, colliders, models, characters, triggers |
| `fixedUpdate(ctx, dt)` | 60 times a second, before each physics step | movement, forces, anything gameplay that must be exact |
| `update(ctx, dt)` | every rendered frame, after physics | animation, visuals, pickups, HUD |
| `cameraTarget(ctx)` | every frame | return the `Vector3` the camera follows |
| `status(ctx)` | tooling | a one-line summary (`'coins 3/4'`), shown by the check tool |
| `onCameraChange(ctx)`, `eyePosition(ctx)`, `dispose(ctx)` | optional | camera swaps, first-person eye, cleanup |

`ctx` (the `GameContext`) is the same object in every hook: `ctx.scene` (three.js scene),
`ctx.physics`, `ctx.input`, `ctx.camera`, `ctx.audio`, `ctx.particles`, `ctx.hud`,
`ctx.lights`, `ctx.palette`, `ctx.loadModel`, `ctx.time` and `ctx.engine`.

**Physics owns positions; visuals follow.** Bodies move in fixed 60 Hz steps (Rapier).
Meshes are interpolated between steps, so motion is smooth at any frame rate. A character
controller moves its body in `fixedUpdate`; its model is posed in `update`.

**Scale.** One unit is one metre, Y is up, the ground is usually at y = 0. The hero is 1.6 m
tall, runs at 6.5 m/s and jumps 1.7 m (double jump 2.4 m, triple 3.5 m; it also grabs ledges).
At the default zoom the camera shows about 13.5 m vertically, so one art pixel is about
5 cm: give shapes at least 0.25 m so they read.

## 3. Quick start

A complete game, and the kit's `game.js`. Walk with WASD or the arrows, jump with Space,
collect the four coins.

```js quickstart
// Coin Garden: walk (WASD / arrows / stick), jump (Space), collect every coin.
import { compileClips, ContactShadow, Engine, HERO_CLIPS, HERO_MODEL, HERO_RIG, mergeStaticMeshes, PlatformerCharacter, readMoveInput, setLookLayer, THREE, toonMaterial, withUrlOptions } from './pixel-engine.js';

const { BoxGeometry, Mesh, Vector3 } = THREE;

/** A box you can see (toon material, palette colour) and stand on (a static collider). */
function block(ctx, [x, y, z], [w, h, d], color) {
  ctx.physics.addStaticBox({ position: [x, y, z], halfExtents: [w / 2, h / 2, d / 2] });
  const mesh = new Mesh(new BoxGeometry(w, h, d), toonMaterial(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

class CoinGarden {
  name = 'Coin Garden';
  assets = [HERO_MODEL, 'assets/coin.glb']; // start downloading before setup runs
  coins = [];
  collected = 0;
  won = false;
  target = new Vector3();
  ground = new Vector3();

  async setup(ctx) {
    const { scene, physics, palette } = ctx;
    // Level: static geometry merged into one draw call per material; one collider per block.
    scene.add(
      ...mergeStaticMeshes([
        block(ctx, [0, -0.5, 0], [24, 1, 24], palette.green),
        block(ctx, [4, 0.5, -2], [3, 1, 3], palette.slate),
        block(ctx, [7, 1.25, -2], [3, 2.5, 3], palette.teal),
        block(ctx, [-5, 0.75, 4], [2, 1.5, 2], palette.orange),
      ]),
    );
    // Coins: a model, spinning; a trigger volume collects it when the hero walks in.
    const coin = await ctx.loadModel('assets/coin.glb', { castShadow: false });
    for (const [x, y, z] of [[4, 1.4, -2], [7, 2.9, -2], [-5, 1.9, 4], [-2, 0.4, -5]]) {
      const mesh = coin.scene.clone(true);
      mesh.position.set(x, y, z);
      setLookLayer(mesh, 'actors'); // characters & objects can get their own look
      scene.add(mesh);
      const item = { mesh, taken: false };
      physics.trigger({ cylinder: { halfHeight: 0.6, radius: 0.5 } }, [x, y, z], { tag: 'character', once: true, onEnter: () => this.collect(ctx, item) });
      this.coins.push(item);
    }
    // The hero: the bundled model and clips on a Mario-64-style controller.
    const hero = await ctx.loadModel(HERO_MODEL, { castShadow: false });
    this.model = hero.scene;
    setLookLayer(this.model, 'actors');
    this.shadow = new ContactShadow(0.42);
    scene.add(this.model, this.shadow);
    this.hero = new PlatformerCharacter(physics, { position: [0, 0, 4], lockDepth: ctx.camera.lockDepth });
    this.hero.attachModel(this.model, compileClips(HERO_CLIPS, HERO_RIG, this.model), HERO_RIG);
  }

  collect(ctx, item) {
    item.taken = true;
    item.mesh.visible = false;
    this.collected++;
    ctx.audio.play('coin');
    ctx.particles.burst('sparkle', item.mesh.position);
  }

  fixedUpdate(ctx, dt) {
    this.input = readMoveInput(ctx, this.hero, this.input); // filled in place after the first step
    this.hero.fixedUpdate(dt, this.input); // movement and forces: fixed 60 Hz step
  }

  update(ctx, dt) {
    this.hero.updateVisual(this.model, dt, ctx.physics.alpha); // pose and interpolate
    const feet = this.model.position;
    const ground = ctx.physics.groundBelow(this.ground.set(feet.x, feet.y + 0.1, feet.z), 20, this.hero.body);
    if (ground) this.shadow.place(feet.x, ground.y, feet.z, feet.y - ground.y);
    for (const c of this.coins) if (!c.taken) c.mesh.rotation.y += dt * 3;
    if (!this.won && this.collected === this.coins.length) {
      this.won = true;
      this.hero.celebrate();
      ctx.audio.play('fanfare');
    }
    ctx.hud.clear();
    ctx.hud.text(6, 6, `COINS ${this.collected}/${this.coins.length}`, { color: 'sand' });
    if (this.won) ctx.hud.text(0, 0, 'YOU WIN!', { anchor: 'center', scale: 2, shadow: 'navy' });
  }

  cameraTarget() {
    const p = this.model?.position ?? this.target.set(0, 0, 4);
    return this.target.set(p.x, p.y + 0.9, p.z);
  }

  onCameraChange(ctx) {
    this.hero.setLockDepth(ctx.camera.lockDepth); // side view: stay on the lane
    this.model.visible = !ctx.camera.hidesTarget; // first person: no body in the way
  }

  status() {
    return `coins ${this.collected}/${this.coins.length}`;
  }
}

await Engine.start(new CoinGarden(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'iso' } }));
```

To make it yours: change the blocks (the level), the coin spots, the camera preset, the HUD,
the win condition. `withUrlOptions(options)` adds the review flags from the page URL on top of
your options (`?camera=side`, `?zoom=1.5`, `?look=noir`, `?debug=1`; section 8): the camera is
merged key by key, and with no flags your options are used as they are.

## 4. The API by system

Everything below comes from `./pixel-engine.js`. `API.md` has the full signatures.

### Starting

```js
const engine = await Engine.start(new MyGame(), withUrlOptions({  // + review flags from the URL
  container: document.getElementById('app'),
  camera: { preset: 'iso', zoom: 1.2 },  // one preset per game (see Camera)
  look: LOOK_PRESETS.pixel_heroes,       // optional: the art style (see Looks)
  background: PALETTE.sky,               // clear colour (default PALETTE.night)
}));
await engine.loadGame(new Level2());     // next level: same renderer, camera, input, audio
```

Shipping options: `debugUI: false` is the default outside `?debug=1`; `debugKeys: false`
turns off the engine hotkeys (P, R, \`, [, ], M); `touchButtons: [{ label: 'A', code: 'Space', hint: 'jump' }]`
replaces the on-screen buttons, `touchBar: false` hides the touch tool bar.
`loadGame` can be called from anywhere (a trigger, `update`); the swap happens after the
frame. It unloads the old game: scene objects, physics, triggers, particles, HUD, music and
lights are freed, so a level never leaks into the next.

### Building a level

- **Materials:** `toonMaterial(color)` is a cached 3-band toon material. Use palette
  colours: `ctx.palette.green` or `PALETTE.green`. The 16 names: `ink plum red orange sand
  lime green teal navy blue sky cyan white mist slate night`. Options: `{ map, vertexColors, rim, dissolve }`.
- **Meshes:** plain three.js (`new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMaterial(c))`).
  Set `castShadow` / `receiveShadow`. For the static level, build meshes and add
  `...mergeStaticMeshes(meshes)`: one draw call per material instead of one per block (don't
  add the sources too). Keep anything that moves separate.
- **Colliders:** `physics.addStaticBox({ position, halfExtents, rotationY?, friction? })` and
  `physics.addStaticCylinder(position, halfHeight, radius)`. One per solid block, matching
  the mesh (half extents are half the size). Anything else through `RAPIER` and
  `physics.world` (see the top-down recipe's crates).
- **Collider tags** the hero understands: `physics.tag(collider, 'climbable')`, `'pushable'`,
  `'grabbable'`, `'slippery'`, `'noLedge'`, `'noCamera'` (camera rays ignore it).
- **Models:** `const m = await ctx.loadModel('assets/tree.glb')` returns `{ scene, animations }`,
  a fresh clone each call, materials converted to toon. `m.scene.clone(true)` copies a static model.
  List models in the game's `assets` so they download while the engine starts.
- **Look layers:** `setLookLayer(object, 'actors')` puts characters and objects on the actors
  layer (children follow); everything else is environment. Looks can treat them differently.
- **Shadow blob:** `new ContactShadow(radius)`, placed every frame with
  `shadow.place(x, groundY, z, heightAboveGround)` (see the quick start).

### The hero

`PlatformerCharacter` is a Mario-64-style controller with the full moveset and animation;
`HERO_MODEL`, `HERO_RIG` and `HERO_CLIPS` are its model and clips:

```js
const model = (await ctx.loadModel(HERO_MODEL, { castShadow: false })).scene;
setLookLayer(model, 'actors');
ctx.scene.add(model);
const hero = new PlatformerCharacter(ctx.physics, { position: [0, 0, 0], lockDepth: ctx.camera.lockDepth });
hero.attachModel(model, compileClips(HERO_CLIPS, HERO_RIG, model), HERO_RIG);
// fixedUpdate: input = readMoveInput(ctx, hero, input); hero.fixedUpdate(dt, input);  (input kept, filled in place)
// update:      hero.updateVisual(model, dt, ctx.physics.alpha);
```

Controls (`readMoveInput`, camera-relative in every preset): WASD / arrows move (Shift
walks), Space jumps (again on landing: double, triple; wall kicks), C crouches (+ Space
backflip; running: slide, long jump; in the air: ground pound), J punch / kick / dive, F grab
and pull, Z prone, X lie down, V wave, B sit. Ledges, climbing (`climbable`), pushing
(`pushable`), slopes and stairs just work. Gamepads and touch map onto the same keys.

The game drives it with: `hero.teleport([x, y, z])` (feet position; resets momentum),
`hero.hurt(from)` (knocked back away from `from`, the direction from the hero to what hit it:
enemy position minus hero position; false while `hero.invulnerable > 0`),
`hero.jump('Jump')` (bounce, e.g. off an enemy), `hero.celebrate()`, `hero.lookAt = vector`
(turns the head), `hero.setLockDepth(on)`. It reports `hero.state` (`'idle'`, `'run'`,
`'jump'`, ...), `hero.grounded`, `hero.vy`, `hero.speed`, `hero.facing`, `hero.stats`
(jumps, landings, hurts, ...), `hero.feetInto(v)` and `hero.body` (its Rapier body). Its
collider carries the `'character'` tag. For a simpler walk-and-jump capsule there is
`CharacterController`.

### Input

`ctx.input.isDown('KeyE')` (held), `wasPressed('KeyE')` (once, in `update`),
`consumePress('KeyE')` (once, in `fixedUpdate`: it keeps a press for 150 ms so none is lost
between steps), `moveAxis()` (`{ x, y }` from keys, stick or touch). Codes are
`KeyboardEvent.code` values: `KeyA`, `Space`, `ArrowUp`, `Digit1`, `ShiftLeft`.

### Physics queries and triggers

```js
const t = ctx.physics.trigger({ box: [1, 1.5, 0.5] }, [x, y, z], {
  tag: 'character', once: true,                // only the hero; remove itself after the first enter
  onEnter: () => win(), onExit: () => {},
});                                            // shapes: box (half extents), sphere, capsule, cylinder
t.position.set(4, 1, 0); t.enabled = false; t.remove();
ctx.physics.groundBelow(origin, 20, hero.body); // { y, distance } | null
ctx.physics.castRay(from, dir, maxDistance);    // { distance, collider, normal, point } | null
ctx.physics.remove(colliderOrBody);             // e.g. open a gate
```

Triggers see dynamic and kinematic bodies (the hero, crates), not level geometry. Dynamic
bodies: `RAPIER.RigidBodyDesc.dynamic()` and `RAPIER.ColliderDesc.cuboid(...)` on
`ctx.physics.world`, then `ctx.physics.bind(body, mesh)` so the mesh follows it.

### Camera

| Preset | View | Notes |
| --- | --- | --- |
| `iso` | orthographic 3/4 view, 32° pitch, 45° yaw | the default; `pitch`, `yaw` configurable |
| `topdown` | straight down, screen up = −Z | |
| `side` | straight side-on, screen right = +X | `ctx.camera.lockDepth` is true: pass it to the hero |
| `third` | perspective orbit behind the player | drag or Q/E to orbit |
| `first` | first person, mouse look (click locks the pointer) | `ctx.camera.hidesTarget`: hide your model |
| `free`, `fixed` | authoring fly-cam; a frozen view | `{ preset: 'fixed', position, target, fov }` |

Config: `{ preset, zoom, minZoom, maxZoom, viewHeight, pitch, yaw, fov, distance, stiffness }`.
Players zoom with the wheel or + / -. `engine.setCamera(config, { syncUrl: false })` swaps
the preset during play (a cutscene, a minigame); the game's `onCameraChange` fixes up
anything preset-specific.

### HUD

A pixel canvas over the game, in art pixels, drawn after the filters (always crisp).
It is retained: `clear()` then redraw each frame.

```js
ctx.hud.clear();
ctx.hud.text(6, 6, `SCORE ${score}`, { color: 'sand' });            // 5×7 font, UPPERCASE
ctx.hud.text(6, 6, 'LIVES 3', { anchor: 'top-right' });              // anchors: top-left (default), top,
ctx.hud.text(0, 0, 'PAUSED', { anchor: 'center', scale: 2 });        //   top-right, left, center, right, bottom-*
ctx.hud.rect(0, 0, ctx.hud.width, 12, 'ink', 'bottom-left');
ctx.hud.sprite(6, 20, ['.oo.', 'oyyo', '.oo.'], { o: 'orange', y: 'sand' }); // '.' is transparent
```

### Audio

```js
ctx.audio.play('coin');                       // built-in: jump doubleJump land coin step skid punch groundPound whoosh hurt fanfare
ctx.audio.play('coin', { pitch: 5, volume: 0.6, pan: -0.3 });
ctx.audio.register('zap', { wave: 'square', duty: 0.25, freq: 1200, freqEnd: 200, decay: 0.15, volume: 0.3 });
ctx.audio.playMusic(SONG);                    // a Song (data, see the top-down recipe); playMusic(null) stops
await ctx.audio.load('door', 'assets/door.ogg');
```

Sounds are synthesised from data, so a game needs no audio files. Browsers start sound on
the first key or tap; before that, calls are silent (and still counted in `ctx.audio.counts`).

### Particles and lights

```js
ctx.particles.burst('dust', at);              // built-in: dust skid sparkle smoke impact
ctx.particles.burst('sparkle', at, { count: 20, colors: ['white', 'cyan'] });
ctx.particles.register('ember', { count: [3, 5], life: [0.6, 1], speed: [1, 2], gravity: -2, size: [1, 1], colors: ['sand', 'orange', 'red'] });

const torch = ctx.lights.request({ position: [3, 1.6, 4], color: 0xffa040, intensity: 6, radius: 7, flicker: 'torch' });
ctx.lights.request({ follow: heroModel, offset: [0, 1.4, 0], intensity: 5, radius: 6, priority: 8 });
torch.release();
ctx.engine.sun.intensity = 0.6;               // the sun and ambient light are the engine's: dim them for night
```

Particle sizes are whole art pixels and colours are palette names. Point lights come from a
fixed pool (4 to 16 by quality), handed to the most important requests: never add your own
`PointLight`s (each one recompiles every material).

### Game feel and scene changes

```js
ctx.engine.hitstop(0.08);                    // freeze the game 0.08 s when a hit lands (rendering goes on)
ctx.engine.shake.add(0.4);                   // screen shake: trauma 0..1 that drains; whole art pixels
ctx.engine.timeScale = 0.25;                 // slow motion (1 normal, 0 a frozen menu); loadGame resets it
ctx.engine.screen.flash('white', { duration: 0.1 });
ctx.engine.screen.shockwave(blastAt, { radius: 0.4 });        // a ring that pushes the picture outward
await ctx.engine.screen.cover('iris', { center: heroAt });    // fade iris diamonds dissolve dither blinds wipe curtain mosaic
await ctx.engine.loadGame(new Level2());
await ctx.engine.screen.reveal('iris');
ctx.tweens.to(door.position, { y: 3 }, { duration: 0.8, ease: 'outBack' }); // game time, cleared on unload
ctx.tweens.call(1.5, () => spawnWave());     // a timer
ctx.engine.setSunDirection([1, 0.3, 0.2]);   // a low dawn sun; the next level resets it
```

Transitions, flashes and shockwaves are uniforms at the end of the pipeline: they never
compile a shader, work with every look, and keep running while a level loads.

### Looks

A `Look` sets the art style per layer: `{ scene, actors, environment }`. Each layer is
`{ pixel: { size, outline, crease } | null, filters: [...] }` (`null` renders it clean, at
full resolution); `scene` filters apply to the whole frame on top.

```js
engine.setLook(LOOK_PRESETS.noir);            // or Engine.start(game, { look }) / ?look=noir
engine.setLook({
  scene: [{ id: 'vignette' }],
  actors: { pixel: { size: 2, outline: 0.8, crease: 0.1 }, filters: [{ id: 'nes' }] },
  environment: { pixel: null, filters: [{ id: 'cel', params: { bands: 4 } }] },
});
```

Named looks (`LOOK_PRESETS`): `none` (the default pixel art) `no_filters` `eight_bit`
`sixteen_bit` `playstation` `arcade` `handheld` `famicom` `home_computer` `vhs_rental`
`spectrum` `mac_classic` `pico` `dream` `spooky` `pixel_heroes` `pixel_world` `chunky_world`
`cel_cartoon` `cel_heroes` `retro_heroes` `spotlight` `sketchbook` `dream_world`
`handheld_heroes` `noir` `sin_city` `comic_book` `pop_art` `storybook` `neon_nights`
`heat_vision` `night_ops` `ps1_horror` `found_footage` `old_photo` `virtual_boy` `pico_world`.
Filters (`FILTERS`, each with parameters and presets, see API.md): `cel 8bit 16bit ps1
sweetie16 pico8 nes c64 zx ega cga gameboy gbpocket virtualboy onebit dither posterize adjust
grayscale sepia invert bleach sunset moonlight thermal nightvision scanlines lcd crt vignette
chromatic grain vhs ntsc bloom halftone sketch`. Changing parameters or pixel sizes is free;
changing which filters are on rebuilds the pipeline once.

## 5. Recipes

Each recipe is a whole game, built into the kit as `examples/<name>.html`. Steal from them.

### Side-scroller: levels as data, enemies, level progression

```js side-scroller
// Cliff Run: a side-scroller. Run (A/D or arrows), jump (Space; again on landing for a higher
// one), stomp the slimes, reach the flag. Two levels, then it starts over.
import { compileClips, ContactShadow, Engine, HERO_CLIPS, HERO_MODEL, HERO_RIG, mergeStaticMeshes, PALETTE, PlatformerCharacter, readMoveInput, setLookLayer, THREE, toonMaterial, withUrlOptions } from './pixel-engine.js';

const { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, Vector3 } = THREE;

// Levels are data. platforms: [left x, right x, top y]; slimes: [x, patrol half-width]; flag: x.
const LEVELS = [
  { platforms: [[-4, 10, 0], [12, 15, 1.2], [17, 20, 2.2], [22, 32, 0], [34, 37, 1.4], [39, 48, 0]], slimes: [[27, 3], [43, 2]], flag: 46 },
  { platforms: [[-4, 6, 0], [8, 10, 1.4], [12, 14, 2.6], [16, 18, 1.4], [20, 28, 0], [30, 31.5, 1.2], [33.5, 35, 2.2], [37, 48, 0]], slimes: [[24, 3], [41, 2]], flag: 46 },
];
const START = [-2, 0, 0];

class CliffRun {
  name = 'Cliff Run';
  assets = [HERO_MODEL, 'assets/tree.glb'];
  slimes = [];
  stomps = 0;
  falls = 0;
  clearedAt = null;
  leaving = false;
  startTime = null;
  feet = new Vector3();
  from = new Vector3();
  target = new Vector3();

  constructor(level = 0) {
    this.level = level;
    this.data = LEVELS[level];
  }

  async setup(ctx) {
    const { scene, physics, palette } = ctx;
    const parts = [];
    for (const [x0, x1, top] of this.data.platforms) {
      const w = x1 - x0;
      const h = top + 4; // every platform reaches down out of view
      physics.addStaticBox({ position: [(x0 + x1) / 2, top - h / 2, 0], halfExtents: [w / 2, h / 2, 2] });
      const body = new Mesh(new BoxGeometry(w, h, 4), toonMaterial(palette.sand));
      body.position.set((x0 + x1) / 2, top - h / 2, 0);
      const grass = new Mesh(new BoxGeometry(w + 0.1, 0.3, 4.1), toonMaterial(palette.green));
      grass.position.set((x0 + x1) / 2, top - 0.14, 0);
      for (const m of [body, grass]) m.receiveShadow = m.castShadow = true;
      parts.push(body, grass);
    }
    // The flag: no collider, a trigger ends the level.
    const pole = new Mesh(new CylinderGeometry(0.06, 0.06, 3, 6), toonMaterial(palette.white));
    pole.position.set(this.data.flag, 1.5, -1);
    const cloth = new Mesh(new BoxGeometry(0.9, 0.6, 0.06), toonMaterial(palette.red));
    cloth.position.set(this.data.flag + 0.45, 2.65, -1);
    parts.push(pole, cloth);
    scene.add(...mergeStaticMeshes(parts));
    physics.trigger({ box: [0.5, 2, 2] }, [this.data.flag, 2, 0], { tag: 'character', once: true, onEnter: () => this.clear(ctx) });

    // Scenery behind the lane: trees (a built-in model) and clouds.
    const tree = await ctx.loadModel('assets/tree.glb');
    for (const x of [2, 25, 41]) {
      const t = tree.scene.clone(true);
      t.position.set(x, 0, -1.4);
      scene.add(t);
    }
    for (const [x, y] of [[0, 7], [14, 8], [30, 6.5], [44, 7.5]]) {
      const cloud = new Mesh(new BoxGeometry(3, 0.8, 0.8), toonMaterial(palette.white));
      cloud.position.set(x, y, -6);
      scene.add(cloud);
    }

    // Slimes: a squashed sphere with eyes, patrolling; stomp them from above.
    for (const [x, range] of this.data.slimes) {
      const mesh = new Group();
      const blob = new Mesh(new SphereGeometry(0.45, 12, 8), toonMaterial(palette.lime));
      blob.scale.y = 0.7;
      blob.position.y = 0.3;
      blob.castShadow = true;
      mesh.add(blob);
      for (const ex of [-0.15, 0.15]) {
        const eye = new Mesh(new BoxGeometry(0.1, 0.14, 0.05), toonMaterial(palette.ink));
        eye.position.set(ex, 0.42, 0.4);
        mesh.add(eye);
      }
      mesh.position.set(x, 0, 0);
      setLookLayer(mesh, 'actors');
      scene.add(mesh);
      this.slimes.push({ mesh, x, range, phase: x, dead: false });
    }

    const hero = await ctx.loadModel(HERO_MODEL, { castShadow: false });
    this.model = hero.scene;
    setLookLayer(this.model, 'actors');
    this.shadow = new ContactShadow(0.42);
    scene.add(this.model, this.shadow);
    this.hero = new PlatformerCharacter(physics, { position: START, lockDepth: ctx.camera.lockDepth });
    this.hero.attachModel(this.model, compileClips(HERO_CLIPS, HERO_RIG, this.model), HERO_RIG);
  }

  clear(ctx) {
    this.clearedAt = ctx.time;
    this.hero.celebrate();
    ctx.audio.play('fanfare');
    ctx.particles.burst('sparkle', [this.data.flag, 3, -1], { count: 30 });
  }

  fixedUpdate(ctx, dt) {
    this.input = readMoveInput(ctx, this.hero, this.input);
    if (this.clearedAt !== null) this.input.move.set(0, 0, 0); // level clear: stand still and celebrate
    this.hero.fixedUpdate(dt, this.input);
    const f = this.hero.feetInto(this.feet);
    for (const s of this.slimes) {
      if (s.dead) continue;
      s.phase += dt * 1.3;
      s.mesh.position.x = s.x + Math.sin(s.phase) * s.range;
      const dx = f.x - s.mesh.position.x;
      if (Math.abs(dx) > 0.7 || f.y > 0.9 || f.y < -0.3) continue;
      if (this.hero.vy < 0 && f.y > 0.3) {
        // landed on it: stomp and bounce
        s.dead = true;
        s.mesh.visible = false;
        this.stomps++;
        ctx.audio.play('punch');
        ctx.particles.burst('impact', s.mesh.position);
        this.hero.jump('Jump');
      } else if (this.hero.hurt(this.from.set(-dx, 0, 0))) {
        // `from` points from the hero to what hit it (slime - hero): knocked back the other way
        ctx.audio.play('hurt');
      }
    }
    if (f.y < -8) {
      this.falls++;
      ctx.audio.play('hurt');
      this.hero.teleport(START);
    }
  }

  update(ctx, dt) {
    this.startTime ??= ctx.time;
    this.hero.updateVisual(this.model, dt, ctx.physics.alpha);
    const feet = this.model.position;
    const ground = ctx.physics.groundBelow(this.target.set(feet.x, feet.y + 0.1, feet.z), 20, this.hero.body);
    this.shadow.visible = !!ground;
    if (ground) this.shadow.place(feet.x, ground.y, feet.z, feet.y - ground.y);
    if (this.clearedAt !== null && ctx.time - this.clearedAt > 2.5 && !this.leaving) {
      this.leaving = true;
      void ctx.engine.loadGame(new CliffRun((this.level + 1) % LEVELS.length));
    }
    const time = (this.clearedAt ?? ctx.time) - this.startTime;
    ctx.hud.clear();
    ctx.hud.text(6, 6, `LEVEL ${this.level + 1}`, { color: 'sand' });
    ctx.hud.text(6, 16, `TIME ${time.toFixed(1)}  STOMPS ${this.stomps}`);
    if (this.clearedAt !== null) ctx.hud.text(0, 0, 'LEVEL CLEAR!', { anchor: 'center', scale: 2, shadow: 'navy' });
  }

  cameraTarget() {
    const p = this.model?.position ?? this.feet.set(...START);
    return this.target.set(p.x, p.y + 1.2, p.z);
  }

  onCameraChange(ctx) {
    this.hero.setLockDepth(ctx.camera.lockDepth);
    this.model.visible = !ctx.camera.hidesTarget;
  }

  status() {
    return `level ${this.level + 1}${this.clearedAt !== null ? ' clear' : ''}, stomps ${this.stomps}, falls ${this.falls}`;
  }
}

await Engine.start(new CliffRun(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'side', zoom: 1.2 }, background: PALETTE.sky }));
```

### Top-down at night: lights, pushable crates, music, custom particles

```js top-down
// Lantern Night: walk (WASD / arrows), push both crates onto the glowing pads (walk into a
// crate to push it), then leave through the gate in the north wall.
import { compileClips, ContactShadow, Engine, HERO_CLIPS, HERO_MODEL, HERO_RIG, LOOK_PRESETS, mergeStaticMeshes, PALETTE, PlatformerCharacter, RAPIER, readMoveInput, setLookLayer, THREE, toonMaterial, withUrlOptions } from './pixel-engine.js';

const { BoxGeometry, Color, CylinderGeometry, Mesh, Vector3 } = THREE;

const SONG = {
  bpm: 84,
  tracks: { lead: { wave: 'triangle', decay: 0.3, volume: 0.12 }, bass: { wave: 'square', duty: 0.125, decay: 0.25, volume: 0.05 } },
  patterns: { a: { lead: 'A4 . C5 . E5 . . . D5 . C5 . B4 . . .', bass: 'A2 . . . . . . . F2 . . . . . . .' } },
  order: ['a'],
};
const PADS = [[-3, -4], [3, -4]];
const CRATES = [[-3, 1], [3, 1]];

class LanternNight {
  name = 'Lantern Night';
  assets = [HERO_MODEL, 'assets/tree.glb'];
  crates = [];
  pads = [];
  solved = false;
  escaped = false;
  nextFirefly = 0;
  target = new Vector3();
  at = new Vector3();

  async setup(ctx) {
    const { scene, physics, palette, engine } = ctx;
    // Night: dim the engine's sun and ambient light (reset for the next game on unload).
    engine.sun.color.setHex(PALETTE.sky);
    engine.sun.intensity = 1.2;
    engine.ambient.color.setHex(PALETTE.navy);
    engine.ambient.intensity = 1.4;
    scene.background = new Color(PALETTE.ink);

    const parts = [];
    const wall = (x, z, w, d) => {
      physics.addStaticBox({ position: [x, 0.6, z], halfExtents: [w / 2, 0.6, d / 2] });
      const m = new Mesh(new BoxGeometry(w, 1.2, d), toonMaterial(palette.slate));
      m.position.set(x, 0.6, z);
      m.castShadow = m.receiveShadow = true;
      parts.push(m);
    };
    const floor = new Mesh(new BoxGeometry(30, 1, 30), toonMaterial(palette.teal));
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    parts.push(floor);
    physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [15, 0.5, 15] });
    wall(-4.75, -8, 6.5, 1); // north wall, with a 3 m gap for the gate
    wall(4.75, -8, 6.5, 1);
    wall(0, 8, 17, 1);
    wall(-8, 0, 1, 15);
    wall(8, 0, 1, 15);
    for (const [x, z] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) {
      const post = new Mesh(new CylinderGeometry(0.12, 0.15, 1.6, 6), toonMaterial(palette.plum));
      post.position.set(x, 0.8, z);
      parts.push(post);
      ctx.lights.request({ position: [x, 1.8, z], color: 0xffa040, intensity: 7, radius: 7, flicker: 'torch' });
    }
    scene.add(...mergeStaticMeshes(parts));

    // The gate: a collider we remove when the puzzle is solved.
    this.gate = new Mesh(new BoxGeometry(3, 1.6, 0.6), toonMaterial(palette.red));
    this.gate.position.set(0, 0.8, -8);
    scene.add(this.gate);
    this.gateCollider = physics.addStaticBox({ position: [0, 0.8, -8], halfExtents: [1.5, 0.8, 0.3] });
    physics.trigger({ box: [1.5, 1, 0.5] }, [0, 1, -9.2], { tag: 'character', once: true, onEnter: () => this.escape(ctx) });

    // Pads and crates. A crate is a dynamic Rapier body the hero pushes (tag 'pushable').
    for (const [x, z] of PADS) {
      const mesh = new Mesh(new BoxGeometry(1.2, 0.06, 1.2), toonMaterial(palette.navy));
      mesh.position.set(x, 0.03, z);
      scene.add(mesh);
      this.pads.push({ x, z, mesh, lit: false });
    }
    for (const [x, z] of CRATES) {
      const mesh = new Mesh(new BoxGeometry(0.98, 0.98, 0.98), toonMaterial(palette.orange));
      mesh.castShadow = mesh.receiveShadow = true;
      setLookLayer(mesh, 'actors');
      scene.add(mesh);
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.5, z).setLinearDamping(4).enabledRotations(false, false, false));
      physics.tag(physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.49, 0.49, 0.49).setFriction(0.1).setDensity(8), body), 'pushable');
      physics.bind(body, mesh);
      this.crates.push(body);
    }

    const tree = await ctx.loadModel('assets/tree.glb');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const t = tree.scene.clone(true);
      t.position.set(Math.cos(a) * 11.5, 0, Math.sin(a) * 11.5);
      scene.add(t);
    }

    const hero = await ctx.loadModel(HERO_MODEL, { castShadow: false });
    this.model = hero.scene;
    setLookLayer(this.model, 'actors');
    this.shadow = new ContactShadow(0.42);
    scene.add(this.model, this.shadow);
    this.hero = new PlatformerCharacter(physics, { position: [0, 0, 5], lockDepth: ctx.camera.lockDepth });
    this.hero.attachModel(this.model, compileClips(HERO_CLIPS, HERO_RIG, this.model), HERO_RIG);
    ctx.lights.request({ follow: this.model, offset: [0, 1.5, 0], color: 0xffe0a0, intensity: 5, radius: 6, priority: 8 }); // the lantern

    ctx.particles.register('firefly', { count: [1, 1], life: [1.5, 2.5], speed: [0.2, 0.5], gravity: -0.2, size: [1, 1], colors: ['lime', 'sand', 'lime'] });
    ctx.audio.register('chime', { wave: 'triangle', freq: 880, decay: 0.4, volume: 0.3, arp: [0, 4, 7], arpRate: 0.06 });
    ctx.audio.playMusic(SONG, 'night');
  }

  escape(ctx) {
    this.escaped = true;
    this.hero.celebrate();
    ctx.audio.play('fanfare');
  }

  fixedUpdate(ctx, dt) {
    this.input = readMoveInput(ctx, this.hero, this.input);
    if (this.escaped) this.input.move.set(0, 0, 0); // the end: stand and celebrate
    this.hero.fixedUpdate(dt, this.input);
  }

  update(ctx, dt) {
    this.hero.updateVisual(this.model, dt, ctx.physics.alpha);
    const feet = this.model.position;
    this.shadow.place(feet.x, 0, feet.z, feet.y); // flat floor: the ground is y = 0
    // A pad lights when a crate sits on it; both lit opens the gate.
    for (const pad of this.pads) {
      const on = this.crates.some((b) => Math.hypot(b.translation().x - pad.x, b.translation().z - pad.z) < 0.5);
      if (on && !pad.lit) {
        pad.lit = true;
        pad.mesh.material = toonMaterial(ctx.palette.lime);
        ctx.lights.request({ position: [pad.x, 0.6, pad.z], color: 0x9cf060, intensity: 5, radius: 4, flicker: 'pulse' });
        ctx.audio.play('chime');
      }
    }
    if (!this.solved && this.pads.every((p) => p.lit)) {
      this.solved = true;
      ctx.physics.remove(this.gateCollider);
      this.gate.visible = false;
      ctx.particles.burst('smoke', this.gate.position, { count: 24 });
      ctx.audio.play('groundPound');
    }
    if (ctx.time > this.nextFirefly) {
      this.nextFirefly = ctx.time + 0.3;
      ctx.particles.burst('firefly', this.at.set(Math.random() * 14 - 7, 0.5 + Math.random() * 1.5, Math.random() * 14 - 7));
    }
    const lit = this.pads.filter((p) => p.lit).length;
    ctx.hud.clear();
    ctx.hud.text(6, 6, this.escaped ? 'YOU ESCAPED!' : this.solved ? 'THE GATE IS OPEN' : `PADS ${lit}/${this.pads.length}`, { color: 'sand' });
  }

  cameraTarget() {
    const p = this.model?.position ?? this.target.set(0, 0, 5);
    return this.target.set(p.x, p.y + 0.9, p.z);
  }

  status() {
    return this.escaped ? 'escaped' : `pads ${this.pads.filter((p) => p.lit).length}/${this.pads.length}`;
  }
}

await Engine.start(new LanternNight(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'topdown', zoom: 1.1 }, look: LOOK_PRESETS.dream }));
```

### Looks: mixing art styles per layer

```js looks
// Look Lab: one scene, six looks. Keys 1-6 pick a look, T toggles chunky pixels on the custom
// one. Walk around (WASD): characters & objects (the 'actors' layer) and the environment each
// get their own look.
import { compileClips, Engine, HERO_CLIPS, HERO_MODEL, HERO_RIG, LOOK_PRESETS, mergeStaticMeshes, PlatformerCharacter, readMoveInput, setLookLayer, THREE, toonMaterial, withUrlOptions } from './pixel-engine.js';

const { BoxGeometry, Mesh, Vector3 } = THREE;

// A look of our own: pixel-art characters on a clean, cel-shaded world, a vignette on top.
const STORYBOOK_HEROES = {
  scene: [{ id: 'vignette', params: { intensity: 0.35 } }],
  actors: { pixel: { size: 1, outline: 0.85, crease: 0.2 }, filters: [{ id: 'nes' }] },
  environment: { pixel: null, filters: [{ id: 'cel', params: { bands: 4, ink: 0.6 } }] },
};
const LOOKS = [
  ['default', LOOK_PRESETS.none],
  ['storybook heroes', STORYBOOK_HEROES],
  ['pixel heroes', LOOK_PRESETS.pixel_heroes],
  ['noir', LOOK_PRESETS.noir],
  ['sin city', LOOK_PRESETS.sin_city],
  ['handheld', LOOK_PRESETS.handheld],
];

class LookLab {
  name = 'Look Lab';
  assets = [HERO_MODEL, 'assets/coin.glb', 'assets/tree.glb'];
  current = 1;
  target = new Vector3();

  async setup(ctx) {
    const { scene, physics, palette } = ctx;
    const parts = [];
    for (const [x, z, w, h, d, c] of [[0, 0, 16, 1, 12, 'green'], [-4, -3, 2, 2, 2, 'slate'], [4, -3, 3, 1, 2, 'sand'], [0, -5, 6, 3, 1, 'plum']]) {
      const y = c === 'green' ? -0.5 : h / 2;
      physics.addStaticBox({ position: [x, y, z], halfExtents: [w / 2, h / 2, d / 2] });
      const m = new Mesh(new BoxGeometry(w, h, d), toonMaterial(palette[c]));
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      parts.push(m);
    }
    scene.add(...mergeStaticMeshes(parts));
    for (const [x, z] of [[-6, 3], [6, 2], [-2, -4]]) {
      const tree = await ctx.loadModel('assets/tree.glb'); // environment: no layer tag
      tree.scene.position.set(x, 0, z);
      scene.add(tree.scene);
    }
    // Objects on the actors layer: coins and a crate.
    const coin = await ctx.loadModel('assets/coin.glb');
    this.coins = [[-1.5, 0.6, 1], [0, 0.6, 1], [1.5, 0.6, 1]].map(([x, y, z]) => {
      const c = coin.scene.clone(true);
      c.position.set(x, y, z);
      setLookLayer(c, 'actors');
      scene.add(c);
      return c;
    });
    const crate = new Mesh(new BoxGeometry(1, 1, 1), toonMaterial(palette.orange));
    crate.position.set(3, 0.5, 2);
    crate.castShadow = true;
    setLookLayer(crate, 'actors');
    scene.add(crate);
    physics.addStaticBox({ position: [3, 0.5, 2], halfExtents: [0.5, 0.5, 0.5] });

    const hero = await ctx.loadModel(HERO_MODEL);
    this.model = hero.scene;
    setLookLayer(this.model, 'actors');
    scene.add(this.model);
    this.hero = new PlatformerCharacter(physics, { position: [0, 0, 3], lockDepth: ctx.camera.lockDepth });
    this.hero.attachModel(this.model, compileClips(HERO_CLIPS, HERO_RIG, this.model), HERO_RIG);
  }

  fixedUpdate(ctx, dt) {
    this.input = readMoveInput(ctx, this.hero, this.input);
    this.hero.fixedUpdate(dt, this.input);
  }

  update(ctx, dt) {
    this.hero.updateVisual(this.model, dt, ctx.physics.alpha);
    for (const c of this.coins) c.rotation.y += dt * 2;
    for (let i = 0; i < LOOKS.length; i++) {
      if (ctx.input.wasPressed(`Digit${i + 1}`)) {
        this.current = i;
        ctx.engine.setLook(LOOKS[i][1]);
      }
    }
    if (ctx.input.wasPressed('KeyT')) {
      // Parameters and pixel sizes are uniforms: changing them never rebuilds the pipeline.
      STORYBOOK_HEROES.actors.pixel.size = STORYBOOK_HEROES.actors.pixel.size === 1 ? 3 : 1;
      if (this.current === 1) ctx.engine.setLook(STORYBOOK_HEROES);
    }
    ctx.hud.clear();
    ctx.hud.text(6, 6, `LOOK ${this.current + 1}/${LOOKS.length}: ${LOOKS[this.current][0].toUpperCase()}`, { color: 'sand' });
    ctx.hud.text(6, 6, '1-6 LOOKS  T CHUNKY', { anchor: 'bottom-left' });
  }

  cameraTarget() {
    const p = this.model?.position ?? this.target.set(0, 0, 3);
    return this.target.set(p.x, p.y + 0.9, p.z);
  }

  status() {
    return `look ${LOOKS[this.current][0]}`;
  }
}

await Engine.start(new LookLab(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'iso', zoom: 1.3 }, look: STORYBOOK_HEROES }));
```

## 6. Rules

1. **Import everything from `./pixel-engine.js`.** three.js is `THREE` (`three/webgpu`) and
   `TSL`; Rapier is `RAPIER`. Never load three.js or Rapier from a CDN or npm as well: two
   copies break `instanceof` checks and the renderer.
2. **Never edit `pixel-engine.js`.** Upgrade by replacing it (section 10).
3. **No WebGL-era three.js APIs.** The renderer is `WebGPURenderer`: `WebGLRenderer`,
   `EffectComposer`, `ShaderMaterial`, `onBeforeCompile` and GLSL don't work. Custom shading is
   TSL on node materials; post effects are looks.
4. **Gameplay in `fixedUpdate`, presentation in `update`.** Move characters and apply forces at
   the fixed 60 Hz step; animate, spin pickups and draw the HUD per frame. Use `ctx.time`
   (it stops while paused) and the `dt` you are given, never `performance.now()`.
5. **Physics owns positions.** Don't set `mesh.position` on things with bodies: `physics.bind`
   them, or let the character controller pose its model. Static blocks: one collider each,
   the same size as the mesh.
6. **Palette colours and toon materials** (`toonMaterial(palette.x)`), chunky shapes (≥ 0.25 m).
   Other materials render, but break the look.
7. **Lights come from `ctx.lights`**, never `new PointLight()`. Dim `ctx.engine.sun` and
   `ctx.engine.ambient` for night scenes.
8. **Tag characters and objects** with `setLookLayer(root, 'actors')`, so looks can treat
   them apart from the environment.
9. **Reuse vectors in per-frame code** (`hero.feetInto(v)`, a `target` vector for
   `cameraTarget`): no garbage per frame.
10. **Give `status()` a meaningful line** (score, lives, level, state): the check tool and
   other agents read it.
11. **Clean up what the engine doesn't own**: DOM you add, timers and listeners go in `dispose(ctx)`.

## 7. Common mistakes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, console: CORS / "Failed to load module script" | opened with `file://` | serve the folder over HTTP |
| Console: "Multiple instances of Three.js being imported" | three.js loaded twice | use `THREE` from the bundle, nothing else |
| A red **GAME ERROR** box | an exception in a hook | the box and `engine.errors` have the message, the console the stack: fix the first one |
| "Failed to start: ..." | `setup()` threw (often a bad model path or a typo'd name) | read the message; check the path or the name in API.md |
| The hero falls through the world | no collider under the mesh | `physics.addStaticBox` for every solid block |
| The hero is stuck at the start | spawned inside a block | `position` is the feet: put it on the top surface |
| A trigger never fires | wrong tag, or it doesn't overlap the body | `tag: 'character'` only matches the hero; level geometry needs `includeStatic: true` |
| A colour is black or a material missing | a colour name that isn't in the palette | the 16 names in section 4 |
| A model 404s | path not relative to the page | `assets/x.glb` next to `index.html`; built-ins need no file |
| HUD text shows gaps | characters the 5×7 font doesn't have | uppercase letters, digits, common punctuation |
| A key does nothing in `fixedUpdate` | `wasPressed` there | `consumePress` in `fixedUpdate`, `wasPressed` in `update` |
| Side-scroller hero drifts off the lane | `lockDepth` not passed | `lockDepth: ctx.camera.lockDepth` |
| The camera doesn't follow | `cameraTarget` returns nothing before `setup` ends | return a fallback vector (see the quick start) |
| Slow, low fps | hundreds of separate meshes | `mergeStaticMeshes` the static level; share materials (`toonMaterial` caches) |
| Everything is dark | a dimmed sun with no lights | `ctx.lights.request(...)` torches, or raise `ctx.engine.ambient.intensity` |
| No sound | the browser waits for a key or tap | expected: sound starts on the first input |

## 8. Debugging and checking

The engine is on `window.__PIXEL_ENGINE__` once it runs (also the value `Engine.start` returns):

```js
const e = window.__PIXEL_ENGINE__;
e.state();                // version, backend, fps, camera, look, game status, errors, gpuErrors, ...
e.errors;                 // exceptions thrown by the game's hooks in the render loop (also on screen)
e.step(60);               // manual time: exactly 60 frames (1 s), a hook's exception thrown to you; e.manual = false resumes
e.input.setKey('KeyD', true); e.step(30); e.input.setKey('KeyD', false);  // play by script
await e.renderer.capture();   // { width, height, pixels }: the exact frame (without the HUD canvas)
e.game;                   // your game object: e.game.hero.teleport([x, y, z]) to test a spot
e.setLook(e.lookPresets.noir); e.setCamera({ preset: 'third' }, { syncUrl: false });
e.audio.counts; e.particles.alive; e.physics.counts(); e.hud.canvas;
```

URL flags (with `withUrlOptions` in `Engine.start`): `?debug=1` (debug panel),
`?backend=webgl` (force the fallback), `?look=noir`, `?filters=crt,scanlines`,
`?camera=third`, `?zoom=1.5`, `?mode=raw` (no pixel pass), `?res=320`, `?touch=1`,
`?quality=low`, `?fps=30`. Hotkeys: P pixel/raw, R resolution, \` debug panel,
[ and ] cycle looks, M mute.

**`check.mjs` plays a page in a real browser** and fails on anything wrong:

```
node check.mjs                                  # index.html: start, run 90 frames, screenshot
node check.mjs --keys KeyD*60,Space*4,KeyD*40   # hold each key for that many frames, in order
node check.mjs examples/side-scroller.html --cameras --looks noir,handheld
node check.mjs "index.html?look=handheld&zoom=1.5"   # with URL flags
node check.mjs --backend webgpu                 # WebGPU (needs a display, e.g. xvfb-run)
```

It writes `check/<page>.png` (the frame with the HUD), the camera and look shots and
`check/report.json` (errors, warnings, `state()`), and prints a summary: the backend, frames
and your `status()`. Exit code 0: the game started, ran with no page, console, game or GPU
errors and drew a real picture; 1: it didn't; 2: the tool couldn't run (bad arguments, no
page, no browser; `--help` lists the options). It needs Node 20.15+ (or 22.2+) and Playwright
(`npm i -D playwright && npx playwright install chromium`), or `playwright-core` plus a
Chromium in `CHROMIUM_PATH`. **Look at the PNGs**: a passing check only proves nothing crashed.

## 9. Before you hand back

- [ ] `node check.mjs` exits 0 for every page, with `--keys` that actually play the game
      (reach a goal, collect something, lose a life).
- [ ] You looked at the screenshots: the scene reads, the HUD is legible, nothing is black or
      clipped, the hero is on the ground.
- [ ] `status()` reports the game's state, and it changes as you play.
- [ ] No WebGL-era APIs, no second three.js, no `new PointLight`, no unknown palette names.
- [ ] The controls are written down (the header comment of `game.js`, or on screen).
- [ ] On a phone (or `?touch=1`) the game is playable with the touch buttons, or you set
      `touchButtons` for its own actions.

## 10. Versions

`ENGINE_VERSION` (also `Engine.version` and `state().version`) is the engine's version, and
the kit's `CHANGELOG.md` says what changed in each. To upgrade a game, replace
`pixel-engine.js` (and `pixel-engine.d.ts`, `types/` if you use them), read the changelog
entries since the old version, then run `node check.mjs` again. The kit is built from the
engine's repository with `npm run bundle`.
