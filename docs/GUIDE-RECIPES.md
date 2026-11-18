# Pixel Engine: recipes

More whole games, each built into the kit as a page: steal from them. Read `GUIDE.md` and
`CONTROLS.md` first; `API.md` has every signature.

## 1. What every recipe does

Each meets `CONTROLS.md`'s checklist the way a game of yours should:

- **A `controls` table** (`Game.controls`): each action's key, pad button and touch button. A
  legend along the bottom (`hud.legend`) names the controls of the device in use, as many as fit
  `hud.width`, and steps aside while the touch controls are on screen (`ctx.engine.touch?.visible`).
- **Its own touch buttons** (`touchButtons`, `[]` when walking does it all), each pressing the key
  the keyboard uses, and `touchDensity: 2`, so a phone shows the art at two CSS pixels a pixel.
- **A HUD laid out from `hud.width` and `hud.height`**: short lines top left, a long one wrapped
  (`wrapText`) clear of the ⚙ in the top right; nothing low on the screen while the stick and
  buttons show there.
- **The play area in view at every window shape**: the camera follows the player and keeps
  enough of the world across (`camera: { minWidth }`), so a phone held upright zooms out; the
  page's zoom (`?zoom=` too) and the player's wheel and + / - work within it.
- **Settings on every device**: `settings: { padButton: true }`, so Options and Esc open them, and
  the ⚙ on touch.

## 2. Lantern Night: lights, pushable crates, music, custom particles

Top-down at night (`examples/top-down.html`). Walking does it all, so touch has the stick alone
(`touchButtons: []`); the camera follows the lantern and keeps 11 m across in view, so a phone
held upright sees across the yard.

```js top-down
// Lantern Night: walk (WASD, arrows, a stick), push both crates onto the glowing pads (walk into
// a crate to push it), then leave through the gate in the north wall. Esc / Options: settings.
import { compileClips, ContactShadow, Engine, HERO_CLIPS, HERO_MODEL, HERO_RIG, LOOK_PRESETS, mergeStaticMeshes, PALETTE, PlatformerCharacter, RAPIER, readMoveInput, setLookLayer, THREE, toonMaterial, withUrlOptions, wrapText } from './pixel-engine.js';

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
  controls = { move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' }, settings: { key: 'Escape', pad: 'PadStart' } };
  crates = [];
  pads = [];
  solved = false;
  escaped = false;
  nextFirefly = 0;
  target = new Vector3();
  at = new Vector3();

  async setup(ctx) {
    const { scene, physics, palette, engine } = ctx;
    this.sparkle = ctx.random.fork('fireflies'); // drawn per frame (cosmetic): its own stream, so gameplay's never depends on the frame rate
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
    this.hero = new PlatformerCharacter(physics, { position: [0, 0, 2], lockDepth: ctx.camera.lockDepth });
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
      ctx.particles.burst('firefly', this.at.set(this.sparkle.range(-7, 7), this.sparkle.range(0.5, 2), this.sparkle.range(-7, 7)));
    }
    const lit = this.pads.filter((p) => p.lit).length;
    const { hud } = ctx;
    hud.clear();
    hud.text(6, 6, this.escaped ? 'YOU ESCAPED!' : this.solved ? 'GATE OPEN' : `PADS ${lit}/${this.pads.length}`, { color: 'sand' });
    // the goal, wrapped clear of the ⚙ (top right)
    const goal = this.escaped ? '' : this.solved ? 'OUT THE NORTH GATE' : 'CRATES ONTO PADS';
    wrapText(goal, hud.width - 36).forEach((line, i) => hud.text(6, 16 + i * 10, line));
    // the controls in use, what fits (touch has its stick)
    const legend = [['move', 'WALK'], ['settings', 'SETTINGS']];
    while (hud.legendWidth(legend) > hud.width - 12) legend.pop();
    if (!ctx.engine.touch?.visible) hud.legend(6, hud.height - 12, legend);
  }

  cameraTarget() {
    const p = this.model?.position ?? this.target.set(0, 0, 2);
    return this.target.set(p.x, p.y + 0.9, p.z - 2); // 2 m ahead: the pads and the gate are north
  }

  status() {
    return this.escaped ? 'escaped' : `pads ${this.pads.filter((p) => p.lit).length}/${this.pads.length}`;
  }
}

await Engine.start(new LanternNight(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'topdown', zoom: 1.1, minWidth: 11 }, look: LOOK_PRESETS.dream, settings: { padButton: true }, touchButtons: [], touchDensity: 2 }));
```

## 3. Look Lab: mixing art styles per layer

One scene, six looks (`examples/looks.html`), picked on every device: Q and E, L1 and R1, or
the touch buttons < and >. On a pad L1, R1 and Triangle are also the hero's prone, lie down and
grab (`KEYMAP`), so the game takes those off its `MoveInput`. The look's name wraps under its
number, clear of the ⚙.

```js looks
// Look Lab: one scene, six looks. Walk (WASD, a stick); Q / E, L1 / R1 or < / > on touch pick the
// previous / next look (keys 1-6 one directly); T, Triangle or PX toggles chunky pixels on the
// custom one. Characters & objects (the 'actors' layer) and the environment each get their own
// look. Esc / Options: settings.
import { compileClips, Engine, HERO_CLIPS, HERO_MODEL, HERO_RIG, LOOK_PRESETS, mergeStaticMeshes, PlatformerCharacter, readMoveInput, setLookLayer, THREE, toonMaterial, withUrlOptions, wrapText } from './pixel-engine.js';

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
/** Touch: a button for each look key (each presses its key code), the first in the corner: they read PX < >. */
const TOUCH = [{ label: '>', code: 'KeyE', hint: 'look' }, { label: '<', code: 'KeyQ', hint: 'look' }, { label: 'PX', code: 'KeyT', hint: 'chunky' }];

class LookLab {
  name = 'Look Lab';
  assets = [HERO_MODEL, 'assets/coin.glb', 'assets/tree.glb'];
  controls = {
    move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' },
    prev: { key: 'KeyQ', pad: 'PadLB', touch: '<' },
    next: { key: 'KeyE', pad: 'PadRB', touch: '>' },
    chunky: { key: 'KeyT', pad: 'PadY', touch: 'PX' },
    settings: { key: 'Escape', pad: 'PadStart' },
  };
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
    this.input.prone = this.input.lie = this.input.grab = false; // L1, R1 and Triangle pick looks here
    this.hero.fixedUpdate(dt, this.input);
  }

  pick(ctx, i) {
    this.current = (i + LOOKS.length) % LOOKS.length;
    ctx.engine.setLook(LOOKS[this.current][1]);
  }

  update(ctx, dt) {
    const { hud, input } = ctx;
    this.hero.updateVisual(this.model, dt, ctx.physics.alpha);
    for (const c of this.coins) c.rotation.y += dt * 2;
    if (input.wasPressed('KeyQ', 'PadLB')) this.pick(ctx, this.current - 1);
    if (input.wasPressed('KeyE', 'PadRB')) this.pick(ctx, this.current + 1);
    for (let i = 0; i < LOOKS.length; i++) if (input.wasPressed(`Digit${i + 1}`)) this.pick(ctx, i);
    if (input.wasPressed('KeyT', 'PadY')) {
      // Parameters and pixel sizes are uniforms: changing them never rebuilds the pipeline.
      STORYBOOK_HEROES.actors.pixel.size = STORYBOOK_HEROES.actors.pixel.size === 1 ? 3 : 1;
      if (this.current === 1) ctx.engine.setLook(STORYBOOK_HEROES);
    }
    hud.clear();
    hud.text(6, 6, `LOOK ${this.current + 1}/${LOOKS.length}`, { color: 'sand' });
    wrapText(LOOKS[this.current][0].toUpperCase(), hud.width - 36).forEach((line, i) => hud.text(6, 16 + i * 10, line));
    // the controls in use, what fits (touch has its stick and buttons)
    const legend = [['prev', 'PREV'], ['next', 'NEXT'], ['chunky', 'CHUNKY'], ['move', 'WALK'], ['settings', 'SETTINGS']];
    while (hud.legendWidth(legend) > hud.width - 12) legend.pop();
    if (!ctx.engine.touch?.visible) hud.legend(6, hud.height - 12, legend);
  }

  cameraTarget() {
    const p = this.model?.position ?? this.target.set(0, 0, 3);
    return this.target.set(p.x, p.y + 0.9, p.z);
  }

  status() {
    return `look ${LOOKS[this.current][0]}`;
  }
}

await Engine.start(new LookLab(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'iso', zoom: 1.3, minWidth: 9 }, look: STORYBOOK_HEROES, settings: { padButton: true }, touchButtons: TOUCH, touchDensity: 2 }));
```
