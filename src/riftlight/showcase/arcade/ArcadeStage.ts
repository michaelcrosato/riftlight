/**
 * The arcade side-scroller as a self-contained stage: build it anywhere in the world (an
 * `origin`), drive it from any `Game`, throw it away. It owns its meshes (under `root`), its
 * Rapier colliders, coin and goal triggers, the hero (a `Visitor`: the hero model on the
 * engine's `PlatformerCharacter`), the timer and the HUD it draws. Two hosts use it:
 *
 *   - `ArcadeGame` (`?game=arcade`): the stage as a whole game, the template to copy for a
 *     new side-scroller (camera `side`, a filter look, one class).
 *   - Riftlight's arcade cabinet (`ArcadeMode`): the same stage built next to the town, entered
 *     and left without `engine.loadGame`, paying out gold and keeping the best time in the save.
 *
 *   const stage = new ArcadeStage(ctx, { origin: new Vector3(-1000, 0, 0) });
 *   await stage.build();                    // meshes, colliders, coins, the hero
 *   stage.start();                          // READY → GO, the timer runs
 *   // fixedUpdate: stage.fixedUpdate(dt, readArcadeInput(ctx.input, input))
 *   // update:      stage.update(dt); stage.drawHud(ctx.hud); camera follows stage.cameraTarget()
 *   stage.dispose();                        // everything above is gone again
 */
import { AnimationMixer, BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { type GameContext, type Hud, type Input, mergeStaticMeshes, type MoveInput, PALETTE, type PaletteColor, toonMaterial, type Trigger } from '../../../engine';
import type RAPIER from '@dimforge/rapier3d';
import { moveInput, Visitor } from '../visitor';
import { ARCADE_COLORS, ARCADE_STAGE, type ArcadeBlock, type ArcadeScenery } from './stage';

export type ArcadePhase = 'ready' | 'play' | 'done';

/** What a finished run reports to its host (which answers with the record and a reward). */
export interface ArcadeRun {
  time: number;
  coins: number;
  total: number;
}

export interface ArcadeResult extends ArcadeRun {
  best: number;
  newBest: boolean;
  reward: number;
}

export interface ArcadeStageOptions {
  /** World position of the stage's (0, 0, 0). */
  origin?: Vector3;
  /** A finished run: return the record (best time, reward) to show on the results card. */
  onFinish?: (run: ArcadeRun) => { best: number; newBest: boolean; reward: number };
  /** Best time to show before the first finish (seconds, 0 = none). */
  best?: number;
}

/** Keys for the side-scroller (keyboard, Riftlight's virtual pad codes and the touch buttons). */
export const ARCADE_KEYS = {
  jump: ['Space', 'PadA', 'KeyK'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight', 'PadB', 'PadLT'],
  down: ['KeyS', 'ArrowDown'],
  attack: ['KeyJ', 'PadX'],
  walk: ['ShiftLeft', 'ShiftRight'],
} as const;

/**
 * Side-scroller input: the stick's x runs along the course (world +x), down or C crouches
 * (in the air: ground pound), Space jumps. Fills `out` in place.
 */
export function readArcadeInput(input: Input, out: MoveInput): MoveInput {
  const axis = input.moveAxis();
  out.move.set(Math.abs(axis.x) > 0.15 ? axis.x : 0, 0, 0);
  if (out.move.lengthSq() > 1) out.move.normalize();
  const downHeld = axis.y < -0.55;
  out.walk = input.anyDown(ARCADE_KEYS.walk);
  out.jump = input.consumeAny(ARCADE_KEYS.jump);
  out.jumpHeld = input.anyDown(ARCADE_KEYS.jump);
  out.crouch = input.anyDown(ARCADE_KEYS.crouch) || downHeld;
  out.crouchPressed = input.consumeAny(ARCADE_KEYS.crouch) || input.consumeAny(ARCADE_KEYS.down);
  out.attack = input.consumeAny(ARCADE_KEYS.attack);
  out.grab = false;
  out.face = null;
  return out;
}

interface Coin {
  root: Object3D;
  mixer: AnimationMixer | null;
  trigger: Trigger;
  taken: boolean;
  at: Vector3;
}

interface Slab {
  mesh: Object3D;
  collider: RAPIER.Collider | null;
  x: readonly [number, number];
  y: readonly [number, number];
}

const READY_TIME = 1.1;
const S = ARCADE_STAGE;

export class ArcadeStage {
  /** Add this to the scene: the course (offset to `origin`) and the hero (world space). */
  readonly root = new Group();
  /** The course's meshes, in stage-local coordinates. */
  readonly course = new Group();
  readonly origin: Vector3;
  readonly visitor: Promise<Visitor>;
  hero: Visitor | null = null;
  phase: ArcadePhase = 'ready';
  /** Seconds since GO (frozen at the finish). */
  time = 0;
  /** Seconds in the current phase. */
  phaseTime = 0;
  coins = 0;
  respawns = 0;
  /** Cracked slabs broken (ground pound). */
  broken = false;
  result: ArcadeResult | null = null;
  best: number;
  /** Driven by the host (an autopilot or a script) instead of the keyboard, when set. */
  autopilot: ((stage: ArcadeStage, out: MoveInput) => MoveInput) | null = null;
  private readonly bodies: RAPIER.RigidBody[] = [];
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly triggers: Trigger[] = [];
  private readonly coinList: Coin[] = [];
  private readonly slabs: Slab[] = [];
  private readonly parallax: { object: Object3D; factor: number; x: number }[] = [];
  private flagCloth!: Object3D;
  private checkpoint = 0;
  private readonly input = moveInput();
  private readonly target = new Vector3();
  private readonly feet = new Vector3();
  private built = false;
  private disposed = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly options: ArcadeStageOptions = {},
  ) {
    this.origin = options.origin?.clone() ?? new Vector3();
    this.root.name = 'arcade';
    this.course.position.copy(this.origin);
    this.root.add(this.course);
    this.best = options.best ?? 0;
    this.visitor = Visitor.load(ctx);
  }

  get total(): number {
    return this.coinList.length;
  }

  /** Stage-local → world. */
  world(x: number, y: number, z = 0): [number, number, number] {
    return [this.origin.x + x, this.origin.y + y, this.origin.z + z];
  }

  // ------------------------------------------------------------------ build

  async build(): Promise<void> {
    if (this.built) return;
    this.built = true;
    const { ctx } = this;
    const physics = ctx.physics;
    ctx.particles.register('arcade.debris', { count: [12, 16], life: [0.5, 0.9], speed: [3, 6], direction: [0, 1, 0], spread: 75, gravity: 16, drag: 0.5, size: [2, 3], colors: ['sand', 'orange', 'plum'] });
    ctx.particles.register('arcade.coin', { count: [8, 10], life: [0.3, 0.5], speed: [1.5, 3], direction: [0, 1, 0], spread: 180, gravity: 0, drag: 2, size: [1, 2], colors: ['white', 'sand', 'orange'] });

    // solid blocks: one merged mesh per material, one collider per block
    const statics: Object3D[] = [];
    for (const b of S.blocks as readonly ArcadeBlock[]) {
      statics.push(...blockMeshes(b));
      const [x0, x1] = b.x;
      const [y0, y1] = b.y;
      const [z0, z1] = b.z ?? [-S.depth, S.depth];
      const c = physics.addStaticBox({ position: this.world((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), halfExtents: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2] });
      if (b.tags?.length) physics.tag(c, ...b.tags);
      this.colliders.push(c);
    }
    statics.push(...this.flagPole());
    const merged = new Group();
    merged.add(...mergeStaticMeshes(statics));
    this.course.add(merged);

    // cracked slabs: their own meshes and colliders (they break)
    for (const s of S.breakable) {
      const mesh = crackedSlab(s.x[1] - s.x[0], s.y[1] - s.y[0]);
      mesh.position.set((s.x[0] + s.x[1]) / 2, (s.y[0] + s.y[1]) / 2, 0);
      this.course.add(mesh);
      this.slabs.push({ mesh, collider: null, x: s.x, y: s.y });
    }
    this.restoreSlabs();

    // scenery: parallax layers (no colliders)
    for (const sc of S.scenery) {
      const mesh = sceneryMesh(sc.shape ?? 'box', sc.size, sc.color);
      mesh.position.set(sc.at[0], sc.at[1], sc.at[2]);
      this.course.add(mesh);
      this.parallax.push({ object: mesh, factor: sc.parallax, x: sc.at[0] });
    }

    // coins: the spinning coin model, collected by trigger volumes
    const coin = await ctx.loadModel('assets/coin.glb', { castShadow: false });
    if (this.disposed) return;
    for (const [x, y] of S.coins) {
      const root = coin.scene.clone(true);
      root.position.set(x, y, 0);
      root.scale.setScalar(0.8);
      const clip = coin.animations[0];
      const mixer = clip ? new AnimationMixer(root) : null;
      if (mixer && clip) {
        mixer.clipAction(clip).play();
        mixer.setTime(x * 0.37);
      }
      this.course.add(root);
      const c: Coin = { root, mixer, taken: false, at: new Vector3(x, y, 0), trigger: null! };
      c.trigger = physics.trigger({ cylinder: { halfHeight: 0.55, radius: 0.5 } }, this.world(x, y + 0.45, 0), {
        tag: 'character',
        filter: (other) => other === this.hero?.hero?.collider,
        onEnter: () => this.collect(c),
      });
      this.triggers.push(c.trigger);
      this.coinList.push(c);
    }
    // the goal: a tall box at the flag pole
    this.triggers.push(
      physics.trigger({ box: [0.6, 3, 2] }, this.world(S.flag, 3, 0), {
        tag: 'character',
        filter: (other) => other === this.hero?.hero?.collider,
        onEnter: () => this.finish(),
      }),
    );

    const visitor = await this.visitor;
    if (this.disposed) return;
    this.hero = visitor;
    // the hero model and its shadow are in world space (the character writes world positions)
    this.root.add(visitor.model, visitor.shadow);
    visitor.spawn(physics, this.world(S.spawn[0], S.spawn[1], 0), { facing: Math.PI / 2, lockDepth: true });
  }

  private flagPole(): Mesh[] {
    const out: Mesh[] = [];
    const add = (geo: BoxGeometry | CylinderGeometry, color: PaletteColor, x: number, y: number, z = 0) => {
      const m = new Mesh(geo, toonMaterial(PALETTE[color]));
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      out.push(m);
    };
    add(new BoxGeometry(1, 0.5, 1), 'slate', S.flag, 0.25);
    add(new CylinderGeometry(0.08, 0.08, 5.2, 6), 'white', S.flag, 3.1);
    add(new BoxGeometry(0.34, 0.34, 0.34), 'sand', S.flag, 5.8);
    // the cloth is animated (it slides down at the finish)
    const cloth = new Group();
    const flag = new Mesh(new ConeGeometry(0.55, 1.4, 3), toonMaterial(PALETTE.red));
    flag.rotation.z = Math.PI / 2;
    flag.scale.set(1, 1, 0.25);
    flag.position.set(-0.7, 0, 0);
    flag.castShadow = true;
    cloth.add(flag);
    cloth.position.set(S.flag, 5.0, 0);
    this.flagCloth = cloth;
    this.course.add(cloth);
    return out;
  }

  // ------------------------------------------------------------------ flow

  /** READY → GO: put the hero at the start, coins back, timer at zero. */
  start(): void {
    this.phase = 'ready';
    this.phaseTime = 0;
    this.time = 0;
    this.coins = 0;
    this.respawns = 0;
    this.checkpoint = 0;
    this.result = null;
    this.broken = false;
    for (const c of this.coinList) {
      c.taken = false;
      c.root.visible = true;
    }
    this.restoreSlabs();
    this.flagCloth.position.y = 5.0;
    this.hero?.teleport(this.world(S.spawn[0], S.spawn[1], 0), Math.PI / 2);
  }

  /** Straight to GO (the film tool, agents): the timer starts now. */
  skipIntro(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'play';
    this.phaseTime = 0;
  }

  private restoreSlabs(): void {
    for (const s of this.slabs) {
      s.mesh.visible = true;
      if (!s.collider) {
        s.collider = this.ctx.physics.addStaticBox({
          position: this.world((s.x[0] + s.x[1]) / 2, (s.y[0] + s.y[1]) / 2, 0),
          halfExtents: [(s.x[1] - s.x[0]) / 2, (s.y[1] - s.y[0]) / 2, S.depth],
        });
      }
    }
  }

  private collect(c: Coin): void {
    if (c.taken || this.phase !== 'play') return;
    c.taken = true;
    c.root.visible = false;
    this.coins++;
    this.ctx.audio.play('coin', { pitch: Math.min(7, this.coins % 8) });
    this.ctx.particles.burst('arcade.coin', this.world(c.at.x, c.at.y + 0.5, 0));
  }

  private finish(): void {
    if (this.phase !== 'play') return;
    this.phase = 'done';
    this.phaseTime = 0;
    const run: ArcadeRun = { time: this.time, coins: this.coins, total: this.total };
    const rec = this.options.onFinish?.(run) ?? { best: this.best <= 0 || run.time < this.best ? run.time : this.best, newBest: this.best <= 0 || run.time < this.best, reward: 0 };
    this.best = rec.best;
    this.result = { ...run, ...rec };
    this.hero?.hero?.celebrate();
    this.ctx.audio.play('fanfare');
    this.ctx.particles.burst('sparkle', this.world(S.flag, 5.8, 0), { count: 24, scale: 2, colors: ['white', 'sand', 'cyan'] });
  }

  /** Ground pound on a cracked slab: the whole run breaks and the hero drops through. */
  private breakSlabs(): void {
    if (this.broken) return;
    this.broken = true;
    for (const s of this.slabs) {
      if (s.collider) this.ctx.physics.remove(s.collider);
      s.collider = null;
      s.mesh.visible = false;
      this.ctx.particles.burst('arcade.debris', this.world((s.x[0] + s.x[1]) / 2, s.y[1], 0));
    }
    this.ctx.audio.play('punch', { pitch: -9 });
    // the floor is gone: drop through it (not stand on air in the landing pose)
    this.hero?.hero?.enter('fall');
  }

  // ------------------------------------------------------------------ per step / frame

  fixedUpdate(dt: number, input: MoveInput | null): void {
    const v = this.hero;
    const h = v?.hero;
    if (!v || !h) return;
    this.phaseTime += dt;
    if (this.phase === 'ready' && this.phaseTime >= READY_TIME) {
      this.phase = 'play';
      this.phaseTime = 0;
      this.ctx.audio.play('coin', { pitch: 12 });
    }
    let i = input ?? this.idle();
    if (this.phase === 'play' && this.autopilot) i = this.autopilot(this, this.input);
    if (this.phase !== 'play') i = this.idle();
    v.fixedUpdate(dt, i);
    if (this.phase === 'play') this.time += dt;
    const f = h.feetInto(this.feet).sub(this.origin);
    // a ground pound landing on the cracked slabs breaks them (the state can switch a step
    // before the feet touch, so look for a moment after it starts)
    if (!this.broken && h.state === 'groundPoundLand' && h.stateTime < 0.3) {
      const s0 = S.breakable[0]!;
      const s1 = S.breakable[S.breakable.length - 1]!;
      if (f.x > s0.x[0] - 0.4 && f.x < s1.x[1] + 0.4 && Math.abs(f.y - s0.y[1]) < 0.6) this.breakSlabs();
    }
    // checkpoints and the kill plane
    for (let k = this.checkpoint + 1; k < S.checkpoints.length; k++) {
      const [cx, cy] = S.checkpoints[k]!;
      if (f.x >= cx && f.y >= cy - 0.1 && h.grounded) this.checkpoint = k;
    }
    if (f.y < S.killY) this.respawn();
  }

  private respawn(): void {
    const [x, y] = S.checkpoints[this.checkpoint]!;
    this.respawns++;
    this.hero?.teleport(this.world(x, y, 0), Math.PI / 2);
    this.ctx.audio.play('hurt');
    this.ctx.particles.burst('smoke', this.world(x, y + 0.5, 0));
  }

  private idle(): MoveInput {
    const i = this.input;
    i.move.set(0, 0, 0);
    i.jump = i.jumpHeld = i.crouch = false;
    i.crouchPressed = i.attack = false;
    return i;
  }

  update(dt: number): void {
    const v = this.hero;
    if (!v?.hero) return;
    v.update(dt, true);
    for (const c of this.coinList) if (!c.taken) c.mixer?.update(dt);
    if (this.phase === 'done') this.flagCloth.position.y = Math.max(1.0, this.flagCloth.position.y - dt * 4);
    // parallax: far layers follow the camera a little, so they drift slower than the course
    const camX = this.ctx.camera.focus.x - this.origin.x;
    for (const p of this.parallax) p.object.position.x = p.x + camX * p.factor;
  }

  /** Where the side camera looks: ahead of the hero, never so low the sky fills the screen. */
  cameraTarget(): Vector3 {
    const v = this.hero;
    if (!v) return this.target.set(...this.world(S.spawn[0] + 2, 3.8, 0));
    const p = v.model.position;
    const ahead = v.hero ? Math.sin(v.hero.facing) * 1.6 : 0;
    return this.target.set(p.x + ahead, Math.max(this.origin.y + 3.8, p.y + 1.6), this.origin.z);
  }

  /** Coins, timer and best on the pixel HUD (the caller clears it first). */
  drawHud(hud: Hud): void {
    hud.sprite(6, 6, COIN_ICON, COIN_COLORS);
    hud.text(16, 6, `${String(this.coins).padStart(2, '0')}/${this.total}`, { color: 'sand', shadow: 'ink' });
    hud.text(0, 5, S.name, { anchor: 'top', color: 'white', shadow: 'ink' });
    hud.text(0, 15, formatRace(this.time), { anchor: 'top', color: this.phase === 'done' ? 'lime' : 'sand', shadow: 'ink' });
    hud.text(6, 6, this.best > 0 ? `BEST ${formatRace(this.best)}` : 'BEST --:--.--', { anchor: 'top-right', color: 'mist', shadow: 'ink' });
    if (this.phase === 'ready') {
      hud.text(0, -10, this.phaseTime < READY_TIME * 0.6 ? 'READY?' : 'GO!', { anchor: 'center', scale: 3, color: 'sand', shadow: 'ink' });
    } else if (this.phase === 'play' && this.time < 4) {
      hud.text(0, 8, 'ARROWS RUN  SPACE JUMP  C POUND  ESC LEAVE', { anchor: 'bottom', color: 'white', shadow: 'ink' });
    }
    const r = this.result;
    if (this.phase === 'done' && r) {
      const w = 180;
      const h = 74;
      hud.rect(0, -6, w, h, 'ink', 'center');
      hud.rect(0, -6, w - 4, h - 4, 'navy', 'center');
      hud.text(0, -34, 'COURSE CLEAR!', { anchor: 'center', scale: 2, color: 'sand', shadow: 'ink' });
      hud.text(0, -14, `TIME ${formatRace(r.time)}${r.newBest ? '  NEW BEST!' : ''}`, { anchor: 'center', color: r.newBest ? 'lime' : 'white' });
      hud.text(0, -3, `COINS ${r.coins}/${r.total}   PAR ${formatRace(S.par)}`, { anchor: 'center', color: 'white' });
      hud.text(0, 8, r.reward > 0 ? `+${r.reward} GOLD` : `BEST ${formatRace(r.best)}`, { anchor: 'center', color: 'sand' });
      if (this.phaseTime > 0.8) hud.text(0, 21, 'ENTER AGAIN   ESC LEAVE', { anchor: 'center', color: 'mist' });
    }
  }

  /** Where the hero is, stage-local (agents, the autopilot). */
  heroLocal(out = new Vector3()): Vector3 {
    const h = this.hero?.hero;
    if (!h) return out.set(0, 0, 0);
    return h.feetInto(out).sub(this.origin);
  }

  /** Everything this stage added to the scene and the physics world goes. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const physics = this.ctx.physics;
    for (const t of this.triggers) t.remove();
    for (const c of this.colliders) physics.remove(c);
    for (const s of this.slabs) if (s.collider) physics.remove(s.collider);
    for (const b of this.bodies) physics.remove(b);
    this.hero?.despawn();
    for (const c of this.coinList) c.mixer?.stopAllAction();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.geometry.userData.shared) return;
      m.geometry.dispose();
    });
  }
}

/** 01:23.45 */
export function formatRace(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

const COIN_ICON = ['..ooo..', '.oyyyo.', 'oyywyyo', 'oyywyyo', 'oyywyyo', '.oyyyo.', '..ooo..'];
const COIN_COLORS = { o: 'orange', y: 'sand', w: 'white' } as const;

// ------------------------------------------------------------------ meshes

function box(w: number, h: number, d: number, top: PaletteColor, side: PaletteColor): Mesh {
  const s = toonMaterial(PALETTE[side]);
  const mesh = new Mesh(new BoxGeometry(w, h, d), [s, s, toonMaterial(PALETTE[top]), s, s, s]);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** A block's meshes (merged later): grass caps on dirt, mortar lines on bricks, a studded gate. */
function blockMeshes(b: ArcadeBlock): Mesh[] {
  const [x0, x1] = b.x;
  const [y0, y1] = b.y;
  const [z0, z1] = b.z ?? [-S.depth, S.depth];
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  const [top, side] = ARCADE_COLORS[b.kind];
  const out: Mesh[] = [];
  const at = (m: Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    out.push(m);
    return m;
  };
  if (b.kind === 'ground') {
    at(box(w, h - 0.3, d, side, side), cx, y0 + (h - 0.3) / 2, cz);
    at(box(w, 0.3, d + 0.06, top, 'green'), cx, y1 - 0.15, cz);
    // pebbles in the dirt face
    for (let x = x0 + 0.8; x < x1 - 0.4; x += 2.3) at(box(0.32, 0.22, 0.05, 'plum', 'plum'), x, y1 - 1.1 - ((x * 7) % 3) * 0.55, z1 + 0.01);
  } else if (b.kind === 'brick') {
    at(box(w, h, d, top, side), cx, cy, cz);
    // mortar lines on the face toward the camera
    for (let y = y0 + 0.4; y < y1 - 0.05; y += 0.4) at(box(w, 0.05, 0.04, 'plum', 'plum'), cx, y, z1 + 0.01);
    for (let y = y0, row = 0; y < y1 - 0.05; y += 0.4, row++) {
      for (let x = x0 + (row % 2 ? 0.5 : 1); x < x1 - 0.05; x += 1) at(box(0.05, 0.4, 0.04, 'plum', 'plum'), x, y + 0.2, z1 + 0.01);
    }
  } else if (b.kind === 'gate') {
    at(box(w, h, d, top, side), cx, cy, cz);
    for (let y = y0 + 0.5; y < y1; y += 1.2) at(box(w + 0.08, 0.14, d + 0.08, 'slate', 'slate'), cx, y, cz);
    // spikes along the bottom edge
    for (let z = z0 + 0.3; z < z1; z += 0.6) {
      const c = new Mesh(new ConeGeometry(0.16, 0.36, 4), toonMaterial(PALETTE.mist));
      c.rotation.x = Math.PI;
      at(c, cx, y0 - 0.16, z);
    }
  } else {
    at(box(w, h, d, top, side), cx, cy, cz);
    // stone courses
    for (let y = y0 + 0.9; y < y1 - 0.2; y += 0.9) at(box(w + 0.04, 0.06, 0.04, 'night', 'night'), cx, y, z1 + 0.01);
  }
  return out;
}

function crackedSlab(w: number, h: number): Group {
  const g = new Group();
  const slab = box(w - 0.04, h, S.depth * 2, 'sand', 'orange');
  g.add(slab);
  const crack = toonMaterial(PALETTE.plum);
  for (const [x, y, r] of [
    [-0.2, 0.05, 30],
    [0.15, -0.08, -40],
    [0.05, 0.12, 80],
  ] as const) {
    const c = new Mesh(new BoxGeometry(0.4, 0.05, 0.04), crack);
    c.position.set(x * w, y * h * 2, S.depth + 0.02);
    c.rotation.z = (r * Math.PI) / 180;
    g.add(c);
  }
  return g;
}

function sceneryMesh(shape: NonNullable<ArcadeScenery['shape']>, size: readonly [number, number, number], color: PaletteColor): Object3D {
  const mat = toonMaterial(PALETTE[color]);
  const flat = (m: Mesh) => {
    m.castShadow = m.receiveShadow = false;
    return m;
  };
  const [w, h, d] = size;
  if (shape === 'mountain') {
    // a four-sided peak seen edge-on, with a snow cap
    const g = new Group();
    const peak = flat(new Mesh(new ConeGeometry(w / 2, h, 4), mat));
    peak.rotation.y = Math.PI / 4;
    peak.scale.z = d / w;
    peak.position.y = h / 2;
    const cap = flat(new Mesh(new ConeGeometry(w * 0.13, h * 0.26, 4), toonMaterial(PALETTE.white)));
    cap.rotation.y = Math.PI / 4;
    cap.scale.z = d / w;
    cap.position.set(0, h * 0.87 + 0.02, 0.05);
    g.add(peak, cap);
    return g;
  }
  if (shape === 'hill') {
    // a faceted half-buried drum: a round hill
    const m = flat(new Mesh(new CylinderGeometry(w / 2, w / 2, d, 12), mat));
    m.rotation.x = Math.PI / 2;
    m.position.y = h / 2;
    return m;
  }
  if (shape === 'cloud') {
    const g = new Group();
    for (const [x, y, s] of [
      [0, 0, 1],
      [-w * 0.32, -h * 0.18, 0.7],
      [w * 0.3, -h * 0.12, 0.75],
    ] as const) {
      const m = flat(new Mesh(new BoxGeometry(w * s * 0.7, h * s, d), mat));
      m.position.set(x, y, 0);
      g.add(m);
    }
    return g;
  }
  if (shape === 'disc') {
    const m = flat(new Mesh(new CylinderGeometry(w / 2, w / 2, d, 10), mat));
    m.rotation.x = Math.PI / 2;
    return m;
  }
  return flat(new Mesh(new BoxGeometry(w, h, d), mat));
}
