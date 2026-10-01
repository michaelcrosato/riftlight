import { type AnimationClip, type Camera, type Object3D, Vector3 } from 'three/webgpu';
import { compileClip, restPoseOf, type ClipDef } from '../../engine/animation';
import { CharacterController } from '../../engine/physics/CharacterController';
import type { Physics } from '../../engine/physics/Physics';
import { COMBAT_TIMING } from '../../game/hero/clips/combat';
import { HERO_RIG } from '../../game/hero/rig';
import type { Mod } from '../core/mods';
import type { Combat } from '../combat/Combat';
import { buildSkill } from '../skills/build';
import type { ResolvedSkill, SupportLink } from '../skills/types';
import { Actor } from './Actor';
import { HERO_KEYS } from './controls';
import { HeroAnimator } from './heroAnimator';
import { ControllerMover } from './movers';
import { MouseAim } from './mouseAim';
import { attachSword } from './sword';

/** Every timing and speed of the controller, documented and tunable in one place. */
export const HERO_TUNING = {
  /** Base run speed comes from the `move.speed` stat; these shape how it feels. */
  turnRate: 22,
  /** Input buffer: a press made while busy waits, and is kept this long once the hero is free (s). */
  buffer: 0.2,
  /** After a combo step ends, the next press continues the chain within this window. */
  comboWindow: 0.55,
  /** Melee attacks step toward a target this far beyond reach (m), up to `lunge` m/s. */
  lungeReach: 1.4,
  lunge: 5,
  /** Below this ground speed the hero idles; between walk and run thresholds it walks. */
  idleBelow: 0.4,
  walkBelow: 3.2,
  /** Blend times. */
  fadeAction: 0.06,
  fadeMove: 0.12,
  fadeOut: 0.25,
  /** Taking at least this share of max life in one hit plays the hit react. */
  hitReactShare: 0.08,
  /** Auto-aim (keys / pad / touch): nearest enemy within this range and cone (deg) ahead. */
  autoAimRange: 9,
  autoAimCone: 70,
} as const;

export type HeroState = 'idle' | 'run' | 'attack' | 'cast' | 'channel' | 'dodge' | 'hit' | 'dead' | 'victory';

/** A skill slot: a gem, its supports and its level. */
export interface SlotSpec {
  skill: string;
  supports?: readonly SupportLink[];
  level?: number;
}

export interface HeroOptions {
  physics: Physics;
  combat: Combat;
  /** The hero model (hero.glb), not yet animated. */
  model: Object3D;
  /** Clip definitions (HERO_CLIPS); compiled against the model here. */
  clips: readonly ClipDef[];
  at: [number, number, number];
  /** Basic attack (LMB / J), default 'slash'. */
  basic?: SlotSpec;
  /** Skill bar: RMB/K, Q, E, R, F. */
  slots?: readonly (SlotSpec | null)[];
  /** Extra stat sources at spawn (tree, items...). */
  mods?: Readonly<Record<string, readonly Mod[]>>;
  base?: Readonly<Record<string, number>>;
  /** The canvas, for mouse aim (null: keys, pad and touch only). */
  canvas?: HTMLElement | null;
}

interface ActionState {
  skill: ResolvedSkill;
  slot: number;
  clip: string;
  /** The animator's name for this playthrough (`clip`, or its alias when the clip restarts). */
  anim: string;
  /** Seconds into the action (game time scaled by action speed). */
  t: number;
  duration: number;
  hitTime: number;
  cancelTime: number;
  released: boolean;
  combo: number;
  aim: Vector3;
  /** Key codes that keep a channel going. */
  keys: readonly string[];
}

/** Compile clip definitions against the hero model (loops marked for the animator). */
export function compileHeroClips(model: Object3D, defs: readonly ClipDef[]): AnimationClip[] {
  const rest = restPoseOf(model, HERO_RIG);
  return defs.map((d) => {
    const c = compileClip(d, HERO_RIG, rest);
    c.userData.loop = d.loop === true;
    return c;
  });
}

const tmp = new Vector3();

/**
 * The hero's ARPG controller: twin-stick / mouse movement and aim, a buffered 3-hit basic
 * combo, five skill slots, a dodge roll with i-frames, attack cancels, slowed movement while
 * casting, hit-stop, attack-speed-scaled animation, and the hero's sword.
 *
 * Call `fixedUpdate` before `actors.fixedUpdate` (it sets the hero's intent) and `update`
 * after `actors.update` (it poses the model).
 *
 *   hero = new HeroController({ physics, combat, model, clips: HERO_CLIPS, at: [0, 0, 0], slots: [{ skill: 'fireball', supports: ['gmp'] }] });
 *   actors.add(hero.actor);
 */
export class HeroController {
  readonly actor: Actor;
  readonly cc: CharacterController;
  readonly model: Object3D;
  readonly sword: Object3D;
  readonly animator: HeroAnimator;
  readonly mouse: MouseAim;
  readonly combat: Combat;
  /** The basic attack and the skill bar (resolved for the hero's current stats). */
  basic!: ResolvedSkill;
  slots: (ResolvedSkill | null)[] = [];
  dodgeSkill!: ResolvedSkill;
  state: HeroState = 'idle';
  /** Cooldown seconds left per skill id. */
  readonly cooldowns = new Map<string, number>();
  /** The point the hero aims at (ground, world). */
  readonly aim = new Vector3();
  /** Counters for tools and tests. */
  readonly stats = { attacks: 0, casts: 0, dodges: 0, cancels: 0, buffered: 0, noMana: 0 };
  /** Last thing that failed (UI feedback: "NO MANA", "COOLDOWN"). */
  feedback: { text: string; until: number } | null = null;
  private specs: { basic: SlotSpec; slots: (SlotSpec | null)[] };
  private action: ActionState | null = null;
  private buffered: { kind: 'attack' | 'dodge' | 'slot'; slot: number; at: number } | null = null;
  private combo = 0;
  private comboUntil = 0;
  private time = 0;
  private moveWish = new Vector3();
  private lastLife = 0;
  private hitReact = 0;
  private deathT = 0;
  private victoryT = 0;
  private statsVersion = -1;
  private camera: Camera | null = null;
  /** Stepping in toward a melee target (the legs run under the swing). */
  private lunging = false;
  /** Last game time the hero was busy (an action or a roll): the buffer counts from here. */
  private busyUntil = -Infinity;
  /** Animator names of the current roll / hit react playthroughs (see `fresh`). */
  private rollAnim = 'Roll';
  private reactAnim = 'HitReact';
  /** The animator name each one-shot clip used last. */
  private readonly lastAnim = new Map<string, string>();

  constructor(o: HeroOptions) {
    this.combat = o.combat;
    this.model = o.model;
    // speed 1: the controller's wish is the velocity (see ControllerMover)
    this.cc = new CharacterController(o.physics, { position: o.at, radius: 0.32, halfHeight: 0.5, speed: 1, jumpSpeed: 0 });
    o.physics.tag(this.cc.collider, 'character');
    this.actor = new Actor({
      faction: 'hero',
      name: 'hero',
      body: o.model,
      mover: new ControllerMover(this.cc, o.physics),
      base: { life: 120, mana: 60, 'mana.regen': 4, 'life.regen': 2, 'move.speed': 5.6, accuracy: 600, mass: 3, ...o.base },
      mods: o.mods,
      radius: 0.35,
      death: 'anim',
      seed: 'hero',
    });
    this.lastLife = this.actor.life;
    this.animator = new HeroAnimator(o.model, compileHeroClips(o.model, o.clips));
    this.sword = attachSword(o.model);
    this.mouse = new MouseAim(o.canvas ?? null, { setKey: () => {} });
    this.specs = { basic: o.basic ?? { skill: 'slash' }, slots: [...(o.slots ?? [])] };
    this.rebuild();
    this.animator.play({ full: 'Idle' }, 0);
    this.animator.update(0);
    o.model.position.set(...o.at);
  }

  /** Wire mouse buttons into the engine input (call once with ctx.input). */
  bindInput(input: { setKey(code: string, down: boolean): void }, canvas: HTMLElement | null): void {
    this.mouse.dispose();
    (this as { mouse: MouseAim }).mouse = new MouseAim(canvas, input);
  }

  // ------------------------------------------------------------------ skills

  /** Re-resolve every skill for the hero's current stats (after gear / tree / level changes). */
  rebuild(): void {
    const s = this.actor.stats;
    const r = (spec: SlotSpec) => buildSkill(spec.skill, spec.supports ?? [], s, { level: spec.level });
    this.basic = r(this.specs.basic);
    this.slots = this.specs.slots.map((spec) => (spec ? r(spec) : null));
    this.dodgeSkill = buildSkill('dodge-roll', [], s);
    this.statsVersion = s.version;
  }

  /** Put a gem in a slot (0..4 = RMB/K, Q, E, R, F). */
  setSlot(i: number, spec: SlotSpec | null): void {
    this.specs.slots[i] = spec;
    this.rebuild();
  }

  setBasic(spec: SlotSpec): void {
    this.specs.basic = spec;
    this.rebuild();
  }

  // ------------------------------------------------------------------ film / tooling surface (like PlatformerCharacter)

  get anim(): string {
    return this.animator.current;
  }
  get grounded(): boolean {
    return this.actor.mover.grounded;
  }
  get feet(): Vector3 {
    return this.actor.position.clone();
  }
  get body() {
    return this.cc.body;
  }
  /** Horizontal velocity (m/s); film's `place` zeroes it. */
  get hvel(): Vector3 {
    return this.actor.velocity;
  }
  get vy(): number {
    return this.cc.velocity.y;
  }
  get speed(): number {
    return Math.hypot(this.cc.velocity.x, this.cc.velocity.z);
  }
  get facing(): number {
    return this.actor.facing;
  }
  set facing(v: number) {
    this.actor.facing = v;
  }
  animationMix() {
    return this.animator.mix();
  }
  teleport(p: [number, number, number]): void {
    this.actor.endMotion(true);
    this.actor.mover.teleport(...p);
    this.actor.position.copy(this.actor.mover.position);
    this.actor.velocity.set(0, 0, 0);
    this.actor.impulse.set(0, 0, 0);
    this.action = null;
    this.state = 'idle';
    this.model.position.set(...p);
  }

  // ------------------------------------------------------------------ input → intent (fixed step)

  /**
   * One fixed step of control: read input, buffer presses, run the action state machine and
   * set the actor's velocity and facing. Before `actors.fixedUpdate`.
   */
  fixedUpdate(ctx: { input: InputLike; camera: { camera: Camera; groundBasis(): { right: Vector3; forward: Vector3 } } }, dt: number): void {
    this.time += dt;
    this.camera = ctx.camera.camera;
    this.mouse.tick(this.time);
    const a = this.actor;
    if (a.stats.version !== this.statsVersion) this.rebuild();
    for (const [id, left] of this.cooldowns) {
      if (left - dt <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, left - dt);
    }
    this.detectHits();
    if (!a.alive) {
      this.state = 'dead';
      this.action = null;
      a.velocity.set(0, 0, 0);
      return;
    }
    if (this.state === 'victory') {
      a.velocity.set(0, 0, 0);
      return;
    }
    const input = ctx.input;
    // move intent, camera-relative
    const axis = input.moveAxis();
    const { right, forward } = ctx.camera.groundBasis();
    this.moveWish.set(0, 0, 0).addScaledVector(right, axis.x).addScaledVector(forward, axis.y);
    if (this.moveWish.lengthSq() > 1) this.moveWish.normalize();
    this.updateAim(input);
    // presses into the buffer (latest wins)
    if (input.consumeAny(HERO_KEYS.dodge)) this.buffer('dodge', -1);
    for (let i = 0; i < HERO_KEYS.slots.length; i++) if (input.consumeAny(HERO_KEYS.slots[i]!)) this.buffer('slot', i);
    if (input.consumeAny(HERO_KEYS.attack)) this.buffer('attack', -1);
    // a press waits while the hero is busy, then stays good for `buffer` seconds
    if (this.action || this.state === 'dodge') this.busyUntil = this.time;
    if (this.buffered && this.time - Math.max(this.buffered.at, this.busyUntil) > HERO_TUNING.buffer) this.buffered = null;
    const attackHeld = input.anyDown(HERO_KEYS.attack);

    if (a.stopped) {
      // frozen / stunned: nothing but the buffer survives it
      this.state = 'hit';
      a.velocity.set(0, 0, 0);
      return;
    }
    if (this.state === 'hit' && !a.stopped) this.state = 'idle';

    const speed = a.actionSpeed;
    if (this.action) this.stepAction(dt * speed, input);
    if (this.state === 'dodge' && !a.motion) this.state = 'idle';

    // start what's buffered (or a held attack) when free
    if (this.free()) {
      const b = this.buffered;
      if (b) {
        this.buffered = null;
        if (b.kind === 'dodge') this.startDodge();
        else if (b.kind === 'attack') this.startSkill(this.basic, -1, HERO_KEYS.attack);
        else this.startSlot(b.slot);
      } else if (attackHeld) this.startSkill(this.basic, -1, HERO_KEYS.attack);
    }

    // movement: full speed when free, slowed while casting, scripted during dashes
    if (a.motion) return;
    let k = 1;
    if (this.action) k = this.action.released || this.state === 'channel' ? this.action.skill.moveDuringCast : this.action.skill.moveDuringCast * 0.6;
    const v = this.moveWish.clone().multiplyScalar(a.moveSpeed * k);
    this.lunging = false;
    if (this.action && !this.action.released && this.action.skill.delivery.kind === 'strike' && v.lengthSq() < 0.01) this.lunging = this.lunge(v);
    a.velocity.copy(v);
    if (!this.action && this.state !== 'dodge') {
      this.state = v.lengthSq() > HERO_TUNING.idleBelow ** 2 ? 'run' : 'idle';
      if (v.lengthSq() > 0.01) this.turnToward(Math.atan2(v.x, v.z), dt);
    }
  }

  private buffer(kind: 'attack' | 'dodge' | 'slot', slot: number): void {
    if (this.buffered) this.stats.buffered++;
    this.buffered = { kind, slot, at: this.time };
  }

  /** Ready for a new action: nothing running, or the running one is past its cancel point. */
  private free(): boolean {
    if (this.state === 'dodge') return false;
    const act = this.action;
    if (!act) return true;
    if (this.state === 'channel') return false;
    // attacks and casts chain into each other (and into the dodge) after their cancel point
    if (act.released && act.t >= act.cancelTime) {
      this.stats.cancels++;
      this.endAction();
      return true;
    }
    return false;
  }

  private stepAction(dt: number, input: InputLike): void {
    const act = this.action!;
    const a = this.actor;
    // a dodge press cancels an action once its hit has landed
    if (this.buffered?.kind === 'dodge' && act.released && this.state !== 'channel') {
      this.stats.cancels++;
      this.endAction();
      return;
    }
    act.t += dt;
    if (!act.released && act.t >= act.hitTime) this.release(act, input);
    if (this.state === 'channel') {
      const live = this.combat.effects.some((e) => e.caster === a && e.skill === act.skill.id);
      if (!live || !input.anyDown(act.keys)) {
        this.combat.stop(a, act.skill.id);
        this.endAction();
      } else this.turnToward(Math.atan2(this.aim.x - a.position.x, this.aim.z - a.position.z), dt);
      return;
    }
    // moving out of an action's recovery cancels it
    if (act.released && act.t >= act.cancelTime && this.moveWish.lengthSq() > 0.25) {
      this.stats.cancels++;
      this.endAction();
      return;
    }
    if (act.t >= act.duration) this.endAction();
  }

  private release(act: ActionState, input: InputLike): void {
    act.released = true;
    const a = this.actor;
    const timing = COMBAT_TIMING[act.clip];
    const airTime = timing?.land !== undefined ? ((timing.land - timing.hit) / (this.animator.duration(act.clip) * 30)) * act.duration : undefined;
    const keys = act.keys;
    this.combat.cast(a, act.skill, act.aim, {
      combo: act.combo,
      airTime,
      held: act.skill.channel ? () => input.anyDown(keys) : undefined,
      aimNow: () => this.aim,
    });
    if (act.skill.channel) this.state = 'channel';
  }

  private endAction(): void {
    const act = this.action;
    if (act && act.slot < 0 && act.skill.anims.length > 1) this.comboUntil = this.time + HERO_TUNING.comboWindow;
    this.action = null;
    if (this.state !== 'dodge') this.state = 'idle';
  }

  private startSlot(i: number): void {
    const s = this.slots[i];
    if (s) this.startSkill(s, i, HERO_KEYS.slots[i]!);
  }

  /** Start a skill: pay mana, start its cooldown, face the aim, play its clip at its speed. */
  startSkill(skill: ResolvedSkill, slot: number, keys: readonly string[]): boolean {
    const a = this.actor;
    if ((this.cooldowns.get(skill.id) ?? 0) > 0) return this.fail('COOLDOWN');
    const upfront = skill.channel ? skill.cost * 0.25 : skill.cost;
    if (a.mana < upfront) {
      this.stats.noMana++;
      return this.fail('NO MANA');
    }
    a.mana -= upfront;
    if (skill.cooldown > 0) this.cooldowns.set(skill.id, skill.cooldown);
    // combo step: continues if pressed within the window after the last step
    const chain = slot < 0 && skill.anims.length > 1;
    if (chain) this.combo = this.time <= this.comboUntil ? this.combo + 1 : 0;
    const step = chain ? this.combo % skill.anims.length : 0;
    const clip = this.animator.has(skill.anims[step]!) ? skill.anims[step]! : 'Cast';
    const len = this.animator.duration(clip);
    const timing = COMBAT_TIMING[clip];
    const frames = Math.max(1, len * 30);
    const duration = skill.castTime;
    const hitAt = skill.def.hitAt ?? (timing ? timing.hit / frames : 0.5);
    const cancelAt = timing ? Math.max(hitAt, timing.cancel / frames) : Math.max(hitAt, 0.7);
    // turn instantly toward the aim
    a.facing = Math.atan2(this.aim.x - a.position.x, this.aim.z - a.position.z);
    const anim = this.fresh(clip);
    this.action = {
      skill,
      slot,
      clip,
      anim,
      t: 0,
      duration,
      hitTime: duration * hitAt,
      cancelTime: duration * cancelAt,
      released: false,
      combo: step,
      aim: this.aim.clone(),
      keys,
    };
    this.state = skill.tags.includes('attack') ? 'attack' : 'cast';
    if (slot < 0) this.stats.attacks++;
    else this.stats.casts++;
    this.animator.setTime(anim, 0);
    this.comboUntil = 0;
    return true;
  }

  private startDodge(): void {
    const a = this.actor;
    this.endAction();
    const dir = this.moveWish.lengthSq() > 0.04 ? this.moveWish.clone().normalize() : tmp.set(Math.sin(a.facing), 0, Math.cos(a.facing)).clone();
    a.facing = Math.atan2(dir.x, dir.z);
    this.state = 'dodge';
    this.stats.dodges++;
    this.rollAnim = this.fresh('Roll');
    this.animator.setTime(this.rollAnim, 0);
    this.combat.cast(a, this.dodgeSkill, a.position.clone().addScaledVector(dir, 4));
  }

  /**
   * The animator name for a new playthrough of `clip`: the clip itself, or its alias when the
   * last playthrough may still be on screen, so the restart blends instead of popping.
   */
  private fresh(clip: string): string {
    const last = this.lastAnim.get(clip);
    const next = last === clip ? `${clip}~2` : clip;
    this.lastAnim.set(clip, next);
    return next;
  }

  private fail(text: string): false {
    this.feedback = { text, until: this.time + 0.8 };
    return false;
  }

  /** Melee wind-up: step in toward a target just out of reach. True while stepping. */
  private lunge(v: Vector3): boolean {
    const a = this.actor;
    const act = this.action!;
    const d = act.skill.delivery;
    const reach = d.kind === 'strike' ? d.range : 2;
    const t = this.combat.actors.nearest(act.aim, 1.5, (x) => x.alive && a.hostileTo(x));
    if (!t) return false;
    const dx = t.position.x - a.position.x;
    const dz = t.position.z - a.position.z;
    const dist = Math.hypot(dx, dz) - t.radius;
    if (dist <= reach * 0.7 || dist >= reach + HERO_TUNING.lungeReach) return false;
    v.set((dx / (dist + t.radius)) * HERO_TUNING.lunge, 0, (dz / (dist + t.radius)) * HERO_TUNING.lunge);
    return true;
  }

  private turnToward(yaw: number, dt: number): void {
    const a = this.actor;
    let d = yaw - a.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    a.facing += d * Math.min(1, dt * HERO_TUNING.turnRate);
  }

  /** Where the hero aims: the cursor's ground point, else the right stick, else auto-aim, else ahead. */
  private updateAim(input: InputLike): void {
    const a = this.actor;
    const p = a.position;
    if (this.camera && this.mouse.recent() && this.mouse.ground(this.camera, p.y, this.aim)) return;
    const look = input.gamepadConnected ? input.mouseDelta : null;
    if (look && Math.hypot(look.x, look.y) > 0.5 && this.camera) {
      // right stick: screen direction → ground direction
      const { right, forward } = groundBasisOf(this.camera);
      const dir = tmp.set(0, 0, 0).addScaledVector(right, look.x).addScaledVector(forward, -look.y).normalize();
      this.aim.copy(p).addScaledVector(dir, 5);
      return;
    }
    // keys / touch: the nearest enemy roughly ahead (or along the stick), else straight ahead
    const ahead = this.moveWish.lengthSq() > 0.04 ? Math.atan2(this.moveWish.x, this.moveWish.z) : a.facing;
    const cone = Math.cos((HERO_TUNING.autoAimCone * Math.PI) / 180);
    const fx = Math.sin(ahead);
    const fz = Math.cos(ahead);
    const target = this.combat.actors.nearest(p, HERO_TUNING.autoAimRange, (x) => {
      if (!x.alive || !a.hostileTo(x)) return false;
      const dx = x.position.x - p.x;
      const dz = x.position.z - p.z;
      const d = Math.hypot(dx, dz);
      return d < 0.01 || (dx * fx + dz * fz) / d >= cone;
    });
    if (target) this.aim.copy(target.position);
    else this.aim.set(p.x + fx * 4, p.y, p.z + fz * 4);
  }

  /** Hits taken → hit react (only when it doesn't interrupt anything). */
  private detectHits(): void {
    const a = this.actor;
    const lost = this.lastLife - a.life;
    if (lost > a.maxLife * HERO_TUNING.hitReactShare && !this.action && this.state !== 'dodge') {
      this.hitReact = this.animator.duration('HitReact');
      this.reactAnim = this.fresh('HitReact');
      this.animator.setTime(this.reactAnim, 0);
    }
    this.lastLife = a.life;
  }

  /** Play the victory pose (level cleared). */
  celebrate(): void {
    if (!this.actor.alive) return;
    this.endAction();
    this.state = 'victory';
    this.victoryT = 0;
    this.animator.setTime('Triumph', 0);
  }

  /** Back on its feet with full life and mana. */
  revive(): void {
    const a = this.actor;
    a.deadFor = -1;
    a.gone = false;
    a.life = a.maxLife;
    a.mana = a.maxMana;
    a.ailments.length = 0;
    this.lastLife = a.life;
    this.state = 'idle';
    this.deathT = 0;
  }

  // ------------------------------------------------------------------ visuals (per frame)

  /** Pose the model: which clips, at which times, blended how. After `actors.update`. */
  update(dt: number): void {
    const a = this.actor;
    const an = this.animator;
    const frozen = a.hitStop > 0;
    const k = frozen ? 0 : dt * Math.max(0.05, 1 - a.chill);
    const v = this.speed;
    // locomotion clocks: stride matched to ground speed
    const loco = v < HERO_TUNING.idleBelow ? 'Idle' : v < HERO_TUNING.walkBelow ? 'Walk' : 'Run';
    an.advance('Idle', k);
    // strides match the ground speed, within what each gait can stretch to (a walk fading out
    // under a sudden run must not spin its feet)
    const walkRate = an.speedOf('Walk') ? Math.min(1.6, v / an.speedOf('Walk')) : 1;
    const runRate = an.speedOf('Run') ? Math.min(1.6, Math.max(0.5, v / an.speedOf('Run'))) : 1;
    an.advance('Walk', k, walkRate);
    an.advance('Run', k, runRate);
    if (this.state === 'dead') {
      if (this.deathT === 0) an.setTime('Death', 0);
      this.deathT += dt;
      an.setTime('Death', this.deathT);
      an.play({ full: 'Death' }, HERO_TUNING.fadeAction);
    } else if (this.state === 'victory') {
      this.victoryT += dt;
      an.setTime('Triumph', this.victoryT);
      an.play({ full: 'Triumph' }, HERO_TUNING.fadeMove);
    } else if (this.state === 'dodge') {
      const roll = this.rollAnim;
      const len = an.duration(roll);
      const total = this.dodgeSkill.castTime * 0.8;
      an.setTime(roll, Math.min(len, an.time(roll) + (frozen ? 0 : (dt * len) / Math.max(0.05, total))));
      an.play({ full: roll }, 0.05);
    } else if (this.action) {
      const act = this.action;
      const name = act.anim;
      const len = an.duration(name);
      if (this.state === 'channel') {
        // looping channels (whirlwind) keep spinning; others hold their release pose (beams)
        if (an.isLoop(name)) an.advance(name, k, act.skill.speed);
        else an.setTime(name, (COMBAT_TIMING[act.clip]?.hit ?? len * 30 * 0.5) / 30);
      } else an.setTime(name, Math.min(len, (act.t / Math.max(0.01, act.duration)) * len));
      // legs keep running under a cast when moving; attacks own the whole body
      const melee = act.skill.tags.includes('melee');
      const moving = v > HERO_TUNING.idleBelow && act.skill.moveDuringCast > 0 && !act.skill.def.leap && (!melee || this.lunging);
      const spin = act.clip === 'Spin';
      if (moving && !spin) an.play({ lower: loco === 'Idle' ? 'Walk' : loco, upper: name }, HERO_TUNING.fadeAction);
      else an.play({ full: name }, HERO_TUNING.fadeAction);
    } else if (this.hitReact > 0) {
      this.hitReact -= k;
      an.advance(this.reactAnim, k);
      an.play(v > HERO_TUNING.idleBelow ? { lower: loco === 'Idle' ? 'Walk' : loco, upper: this.reactAnim } : { full: this.reactAnim }, 0.05);
    } else {
      an.play({ full: loco }, this.state === 'idle' ? HERO_TUNING.fadeOut : HERO_TUNING.fadeMove);
    }
    an.update(frozen ? 0 : dt);
  }

  /** Free listeners (the engine frees physics and the scene). */
  dispose(): void {
    this.mouse.dispose();
  }
}

/** What the controller reads from the engine's Input. */
export interface InputLike {
  moveAxis(): { x: number; y: number };
  consumeAny(codes: readonly string[]): boolean;
  anyDown(codes: readonly string[]): boolean;
  readonly gamepadConnected: boolean;
  readonly mouseDelta: { x: number; y: number };
}

function groundBasisOf(camera: Camera): { right: Vector3; forward: Vector3 } {
  const m = camera.matrixWorld;
  const right = new Vector3().setFromMatrixColumn(m, 0).setY(0).normalize();
  const forward = new Vector3().setFromMatrixColumn(m, 2).negate().setY(0);
  if (forward.lengthSq() < 1e-6) forward.setFromMatrixColumn(m, 1).setY(0);
  return { right, forward: forward.normalize() };
}
