/**
 * The hero as a platformer: a clone of the hero model driven by the engine's
 * `PlatformerCharacter` (the full Mario-64 moveset: jumps, flips, wall kicks, ground pound,
 * ledges...) on Rapier, with the playground's sounds and dust. The arcade side-scroller and
 * the first-person bestiary both walk with it, so a showcase stage is just colliders plus
 * one of these.
 *
 *   const v = await Visitor.load(ctx);                 // model + compiled clips (once)
 *   v.spawn(ctx.physics, [x, y, z], { lockDepth: true }); // a body in the physics world
 *   v.fixedUpdate(dt, input);  v.update(dt);           // per step / per frame
 *   v.despawn();                                       // body, collider and controller gone
 */
import type { AnimationClip, Object3D } from 'three/webgpu';
import { Vector3 } from 'three/webgpu';
import { compileClips, ContactShadow, type GameContext, type MoveInput, type MoveState, PlatformerCharacter } from '../../engine';
import type { Physics } from '../../engine/physics/Physics';
import { setLookLayer } from '../../engine/render/lookLayer';
import { HERO_CLIPS, HERO_MODEL, HERO_RIG } from '../../game/hero';

/** Compiled once per page: clips address joints by name, so every clone of the hero shares them. */
let compiled: AnimationClip[] | null = null;

const PUNCHES = new Set(['Punch', 'Punch2', 'Kick', 'SweepKick', 'JumpKick']);
const STEPPING = new Set<MoveState>(['walk', 'run', 'crouchWalk', 'crawl', 'push', 'pull']);

export class Visitor {
  hero: PlatformerCharacter | null = null;
  readonly shadow = new ContactShadow(0.42);
  private physics: Physics | null = null;
  private readonly seen = { jumps: 0, landings: 0, state: 'idle' as MoveState, anim: 'Idle', step: 0, puff: 0 };
  private readonly tmp = new Vector3();
  private readonly feet = new Vector3();
  /** Seconds since spawn (blinking while invulnerable). */
  private clock = 0;

  private constructor(
    private readonly ctx: GameContext,
    readonly model: Object3D,
  ) {
    this.shadow.visible = false;
    setLookLayer(model, 'actors');
  }

  /** A fresh hero clone, ready to spawn (the GLB is downloaded once and cached by the engine). */
  static async load(ctx: GameContext): Promise<Visitor> {
    const m = await ctx.loadModel(HERO_MODEL, { castShadow: false });
    compiled ??= compileClips(HERO_CLIPS, HERO_RIG, m.scene);
    return new Visitor(ctx, m.scene);
  }

  /** Put a body in the physics world at `at` (feet), facing `facing` (radians, 0 = +Z). */
  spawn(physics: Physics, at: readonly [number, number, number], o: { facing?: number; lockDepth?: boolean } = {}): PlatformerCharacter {
    this.despawn();
    this.physics = physics;
    const hero = new PlatformerCharacter(physics, { position: [at[0], at[1], at[2]], lockDepth: o.lockDepth ?? false });
    hero.attachModel(this.model, compiled!, HERO_RIG);
    hero.facing = o.facing ?? 0;
    this.model.rotation.y = hero.facing;
    this.model.position.set(at[0], at[1], at[2]);
    this.seen.jumps = hero.stats.jumps;
    this.seen.landings = hero.stats.landings;
    this.seen.state = hero.state;
    this.clock = 0;
    this.hero = hero;
    return hero;
  }

  /** Remove the body, its collider and its character controller from the physics world. */
  despawn(): void {
    const h = this.hero;
    const p = this.physics;
    if (h && p) {
      p.world.removeCharacterController(h.kcc);
      p.remove(h.body);
    }
    this.hero = null;
    this.physics = null;
    this.shadow.visible = false;
  }

  /** Back to `at`, standing still (respawns, retries). */
  teleport(at: readonly [number, number, number], facing?: number): void {
    const h = this.hero;
    if (!h) return;
    h.teleport([at[0], at[1], at[2]]);
    if (facing !== undefined) h.facing = this.model.rotation.y = facing;
    this.seen.state = h.state;
  }

  fixedUpdate(dt: number, input: MoveInput): void {
    const h = this.hero;
    if (!h) return;
    h.fixedUpdate(dt, input);
    this.events(dt);
  }

  /** Per render frame: pose the model, place the blob shadow. `visible` false hides both (first person). */
  update(dt: number, visible = true): void {
    const h = this.hero;
    if (!h) return;
    this.clock += dt;
    h.updateVisual(this.model, dt, this.ctx.physics.alpha);
    this.model.visible = visible && (h.invulnerable <= 0 || Math.floor(this.clock * 15) % 2 === 0);
    const f = this.model.position;
    const ground = visible ? this.ctx.physics.groundBelow(this.tmp.set(f.x, f.y + 0.1, f.z), 20, h.body) : null;
    if (ground) this.shadow.place(f.x, ground.y, f.z, f.y - ground.y);
    else this.shadow.visible = false;
  }

  /** Feet (interpolated, what is on screen). */
  get position(): Vector3 {
    return this.model.position;
  }

  /**
   * Sounds and dust from what the hero just did, read from `hero.stats` / `state` / `anim`
   * once per fixed step (the playground's `heroEvents`, so every showcase stage sounds alike).
   */
  private events(dt: number): void {
    const h = this.hero!;
    const s = this.seen;
    const { audio, particles } = this.ctx;
    const feet = h.feetInto(this.feet);
    if (h.stats.jumps > s.jumps && h.jumpKind !== 'JumpKick') {
      const kind = h.jumpKind;
      if (kind === 'Jump' || kind === 'JumpUp' || kind === 'LongJump') audio.play('jump');
      else audio.play('doubleJump', { pitch: kind === 'TripleJump' || kind === 'Backflip' ? 3 : 0 });
      if (kind === 'WallKick') particles.burst('dust', [feet.x, feet.y + 0.6, feet.z], { count: 5 });
    }
    if (h.stats.landings > s.landings) {
      if (h.state === 'groundPoundLand') {
        audio.play('groundPound');
        particles.burst('impact', feet);
        particles.burst('dust', feet, { scale: 1.5, speed: 1.6 });
      } else if (h.state === 'hardLand') {
        audio.play('land', { pitch: -4 });
        particles.burst('dust', feet, { scale: 1.4, speed: 1.4 });
      } else {
        audio.play('land');
        particles.burst('dust', feet);
      }
    }
    if (h.state !== s.state) {
      if (h.state === 'skid') audio.play('skid');
      if (h.state === 'groundPound') audio.play('whoosh');
    }
    if (h.anim !== s.anim && PUNCHES.has(h.anim)) audio.play('punch', { pitch: h.anim === 'Kick' || h.anim === 'SweepKick' ? -3 : h.anim === 'Punch2' ? 2 : 0 });
    s.puff -= dt;
    if ((h.state === 'skid' || h.state === 'crouchSlide') && s.puff <= 0) {
      particles.burst('skid', feet, { direction: [h.hvel.x, 0.6, h.hvel.z] });
      s.puff = 0.07;
    }
    s.step -= dt;
    if (STEPPING.has(h.state) && h.grounded && s.step <= 0) {
      audio.play('step', { volume: h.state === 'run' ? 1 : 0.6 });
      s.step = h.state === 'run' ? 0.27 : 0.4;
    }
    s.jumps = h.stats.jumps;
    s.landings = h.stats.landings;
    s.state = h.state;
    s.anim = h.anim;
  }
}

/** A MoveInput you keep and refill every step (no garbage). */
export function moveInput(): MoveInput {
  return { move: new Vector3(), jump: false, jumpHeld: false, crouch: false, crouchPressed: false, attack: false, grab: false, walk: false, face: null };
}
