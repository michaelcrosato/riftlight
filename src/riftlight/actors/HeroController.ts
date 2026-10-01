import { type AnimationClip, type Camera, type Object3D, Vector3 } from 'three/webgpu';
import { compileClip, restPoseOf, type ClipDef, type FootPlacementInput, type FootPlacementState, type GroundProbe } from '../../engine/animation';
import { CharacterController } from '../../engine/physics/CharacterController';
import type { Physics } from '../../engine/physics/Physics';
import { COMBAT_TIMING } from '../../game/hero/clips/combat';
import { HERO_RIG } from '../../game/hero/rig';
import type { Mod } from '../core/mods';
import type { Combat } from '../combat/Combat';
import { StatQuery } from '../combat/stats';
import { WEAPON_CLASSES } from '../combat/tuning';
import { buildSkill } from '../skills/build';
import type { ResolvedSkill, SupportLink } from '../skills/types';
import { Actor } from './Actor';
import { HERO_KEYS } from './controls';
import { HeroAnimator } from './heroAnimator';
import { ControllerMover, type Mover } from './movers';
import { MouseAim } from './mouseAim';
import { HeroWeapons, weaponClassOf } from './weapons';

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
  /**
   * Foot placement (engine FootPlacement, docs/ANIMATION.md): planted feet stay where they
   * landed through blends and attacks; when the body moves on more than `maxDrift` m they
   * re-plant with a quick step.
   */
  feet: { maxDrift: 0.16, stepTime: 0.12, stepLift: 0.07, fadeOut: 0 },
  /**
   * The drawn body turns toward the gameplay facing (which snaps to the aim at once): at
   * `viewTurnRate` (1/s) for small corrections and while running; a standing turn of more
   * than `hopTurn` degrees is a quick hop round instead (`hopTime` s, `hopHeight` m), so
   * planted feet never pivot on the floor.
   */
  viewTurnRate: 30,
  hopTurn: 24,
  hopTime: 0.1,
  hopHeight: 0.03,
  /** Whirlwind: full turns per second at skill speed 1 (the model spins; the clip holds the pose), spin-up time (s). */
  spinTurns: 2.5,
  spinUp: 0.12,
  /** Lifts (m) that keep the feet off the floor: a melee lunge's bound, a roll's push-off; how fast a lift settles (1/s). */
  lungeHop: 0.07,
  rollPush: 0.075,
  liftFall: 30,
  /** A standing start at a run springs off for `startTime` s, `startHop` m up. */
  startHop: 0.04,
  startTime: 0.08,
} as const;

/** Roll frame (of 14, 30 fps) where the feet are back on the floor (foot locking resumes; ROLL_PROFILE has stopped the body). */
const ROLL_DOWN = 8.6;

export type HeroState = 'idle' | 'run' | 'attack' | 'cast' | 'channel' | 'dodge' | 'hit' | 'dead' | 'victory';

/** A skill slot: a gem, its supports and its level. */
export interface SlotSpec {
  skill: string;
  supports?: readonly SupportLink[];
  level?: number;
}

export interface HeroOptions {
  /** Rapier world for the default character-controller mover (required unless `mover` is given). */
  physics?: Physics;
  /**
   * Floor movement instead of the Rapier character controller (a game whose stages are grids,
   * like Riftlight's town and levels). Without it the hero gets a `ControllerMover`.
   */
  mover?: Mover;
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
  /**
   * Ray down onto the ground under a foot (foot placement and locking). Default: the Rapier
   * world when `physics` is given, else flat ground at the hero's feet.
   */
  probe?: GroundProbe;
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

export { WEAPON_CLASSES } from '../combat/tuning';

/**
 * The hero's ARPG controller: twin-stick / mouse movement and aim, a buffered 3-hit basic
 * combo, five skill slots, a dodge roll with i-frames, attack cancels, slowed movement while
 * casting, hit-stop, attack-speed-scaled animation, and the weapon of the equipped class in hand (HeroWeapons).
 *
 * Call `fixedUpdate` before `actors.fixedUpdate` (it sets the hero's intent) and `update`
 * after `actors.update` (it poses the model).
 *
 *   hero = new HeroController({ physics, combat, model, clips: HERO_CLIPS, at: [0, 0, 0], slots: [{ skill: 'fireball', supports: ['gmp'] }] });
 *   actors.add(hero.actor);
 */
export class HeroController {
  readonly actor: Actor;
  /** The Rapier character controller (null when the hero was given its own `mover`). */
  readonly cc: CharacterController | null;
  readonly model: Object3D;
  /** The weapons in the hero's hands (the equipped class shows). */
  readonly weapons: HeroWeapons;
  readonly animator: HeroAnimator;
  readonly mouse: MouseAim;
  /** Ray down onto the ground (foot placement; is the hero in the air?). */
  private readonly probe: GroundProbe;
  /** The combat runtime the hero casts through (`attach` moves the hero to another one, e.g. per stage). */
  combat: Combat;
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
  /** Victory poses end by themselves after this long, or as soon as the player moves. */
  static readonly VICTORY_HOLD = 1.6;
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
    let mover = o.mover;
    if (mover) this.cc = null;
    else {
      if (!o.physics) throw new Error('HeroController: needs `physics` (or a `mover`)');
      // speed 1: the controller's wish is the velocity (see ControllerMover)
      this.cc = new CharacterController(o.physics, { position: o.at, radius: 0.32, halfHeight: 0.5, speed: 1, jumpSpeed: 0 });
      o.physics.tag(this.cc.collider, 'character');
      mover = new ControllerMover(this.cc, o.physics);
    }
    this.actor = new Actor({
      faction: 'hero',
      name: 'hero',
      body: o.model,
      mover,
      base: { life: 120, mana: 60, 'mana.regen': 4, 'life.regen': 2, 'move.speed': 5.6, accuracy: 600, mass: 3, ...o.base },
      mods: o.mods,
      radius: 0.35,
      death: 'anim',
      seed: 'hero',
    });
    this.lastLife = this.actor.life;
    const physics = o.physics;
    const probe: GroundProbe =
      o.probe ??
      (physics && !o.mover
        ? (x, y, z, down, out) => physics.castDown(x, y, z, down, out, ['character'])
        : (_x, _y, _z, _down, out) => {
            out.y = this.actor.position.y;
            out.nx = out.nz = 0;
            out.ny = 1;
            out.id = 0;
            return true;
          });
    this.probe = probe;
    this.animator = new HeroAnimator(o.model, compileHeroClips(o.model, o.clips), { rig: HERO_RIG, probe, feet: HERO_TUNING.feet });
    this.weapons = new HeroWeapons(o.model);
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
    // the roll: dodge.recovery makes it quicker, dodge.distance longer
    const roll = buildSkill('dodge-roll', [], s);
    const q = new StatQuery(s);
    const quick = Math.max(0.25, q.scale('dodge.recovery'));
    const far = Math.max(0.25, q.scale('dodge.distance'));
    this.dodgeSkill = { ...roll, castTime: roll.castTime / quick, delivery: roll.delivery.kind === 'dash' ? { ...roll.delivery, distance: roll.delivery.distance * far } : roll.delivery };
    this.statsVersion = s.version;
    // the equipped weapon's class shows in hand
    this.weapons.equip(weaponClassOf((flag) => s.has(flag)), s.has('weapon.twohand'));
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
    return this.cc?.body;
  }
  /** Horizontal velocity (m/s); film's `place` zeroes it. */
  get hvel(): Vector3 {
    return this.actor.velocity;
  }
  get vy(): number {
    return this.cc ? this.cc.velocity.y : 0;
  }
  /** Ground speed (m/s) the legs match: the controller's, or what the mover actually moved. */
  get speed(): number {
    if (this.cc) return Math.hypot(this.cc.velocity.x, this.cc.velocity.z);
    return this.actor.mover.speed ?? Math.hypot(this.actor.velocity.x, this.actor.velocity.z);
  }
  /** Move the hero to another combat runtime (a new stage): drops the action in progress. */
  attach(combat: Combat): void {
    if (combat === this.combat) return;
    this.combat = combat;
    this.action = null;
    this.buffered = null;
    this.cooldowns.clear();
    if (this.state !== 'dead') this.state = 'idle';
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
  /** What foot placement did this frame (film, tooling). */
  footPlacement(): FootPlacementState | null {
    return this.animator.footPlacement();
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
    this.animator.resetLayers();
    this.snapView = true;
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
    const input = ctx.input;
    if (this.state === 'victory') {
      const axis = input.moveAxis();
      if (this.victoryT < HeroController.VICTORY_HOLD && Math.hypot(axis.x, axis.y) < 0.2) {
        a.velocity.set(0, 0, 0);
        return;
      }
      this.state = 'idle';
    }
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
    // weapon-class skills need that weapon (the equipped weapon sets the `weapon.<class>` flag)
    for (const cls of WEAPON_CLASSES) if (skill.tags.includes(cls) && !a.stats.has(`weapon.${cls}`)) return this.fail(`NEEDS A ${cls.toUpperCase()}`);
    // auras reserve instead of paying: turning one on needs room in the pool, turning it off is free
    const aura = skill.delivery.kind === 'aura' && skill.reservation > 0;
    if (aura && !this.auraOn(skill.id) && !a.canReserve(skill.id, skill.reservation)) {
      this.stats.noMana++;
      return this.fail(a.reservesLife ? 'NO LIFE' : 'NO MANA');
    }
    const upfront = aura ? 0 : skill.channel ? skill.cost * 0.25 : skill.cost;
    if (!payCost(a, upfront)) {
      this.stats.noMana++;
      return this.fail(a.stats.has('skills.costLife') ? 'NO LIFE' : 'NO MANA');
    }
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

  /** Is this aura on (its effect running in the hero's combat)? */
  auraOn(id: string): boolean {
    return this.combat.effects.some((e) => e.kind === 'aura' && e.caster === this.actor && e.skill === id);
  }

  private startDodge(): void {
    const a = this.actor;
    if (a.stats.has('cannotDodge')) return void this.fail('CANNOT DODGE'); // keystone: Unwavering Stance
    this.endAction();
    const dir = this.moveWish.lengthSq() > 0.04 ? this.moveWish.clone().normalize() : tmp.set(Math.sin(a.facing), 0, Math.cos(a.facing)).clone();
    a.facing = Math.atan2(dir.x, dir.z);
    this.state = 'dodge';
    this.stats.dodges++;
    this.rollAnim = this.fresh('Roll');
    this.animator.setTime(this.rollAnim, 0);
    const reach = this.dodgeSkill.delivery.kind === 'dash' ? this.dodgeSkill.delivery.distance : 4.2;
    this.combat.cast(a, this.dodgeSkill, a.position.clone().addScaledVector(dir, reach * 0.95));
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
    if (input.aimAt?.(this.aim)) return; // the game decides the aim (one input path)
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
    if (loco !== 'Idle') this.gaitRun = loco === 'Run';
    an.advance('Idle', k);
    // Walk and Run share one phase (both strike the right heel at 0), so a cross-fade between
    // them (a cast slowing the run to a walk, and back) keeps the feet in step. The phase
    // advances so the leading gait's stride matches the ground speed, within what it can
    // stretch to.
    const walkSpeed = an.speedOf('Walk') || 2;
    const runSpeed = an.speedOf('Run') || 6;
    const walkLen = an.duration('Walk') || 0.4;
    const runLen = an.duration('Run') || 0.4;
    const running = this.gaitRun;
    // stopped, the stride in the air finishes (to the next heel strike: the right at phase 0,
    // the left at 0.5) and the legs hold while they blend back to the stance: no foot left
    // hanging in the air, none dragged along the floor
    let rate = running ? Math.min(1.6, Math.max(0.5, v / runSpeed)) / runLen : Math.min(1.6, v / walkSpeed) / walkLen;
    // (only through the air: a foot on the floor would be dragged by its stance)
    const grounded = (this.animator.footPlacement()?.feet ?? []).some((f) => f.height < 0.02);
    if (v < HERO_TUNING.idleBelow) rate = this.gaitHold || grounded ? 0 : this.gaitRate * 2;
    else this.gaitRate = rate;
    const before = this.gaitPhase;
    this.gaitPhase = (this.gaitPhase + k * rate) % 1;
    if (v < HERO_TUNING.idleBelow && !this.gaitHold && rate > 0 && (this.gaitPhase < before || (before < 0.5 && this.gaitPhase >= 0.5))) {
      this.gaitPhase = this.gaitPhase < before ? 0 : 0.5;
      this.gaitHold = true;
    }
    if (v >= HERO_TUNING.idleBelow) this.gaitHold = false;
    an.setTime('Walk', this.gaitPhase * walkLen);
    an.setTime('Run', this.gaitPhase * runLen);
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
      // legs keep running under a cast when moving; attacks own the whole body (a melee
      // lunge bounds in on the attack's own legs: see `liftFor`)
      const melee = act.skill.tags.includes('melee');
      const moving = v > HERO_TUNING.idleBelow && act.skill.moveDuringCast > 0 && !act.skill.def.leap && !melee;
      const spin = act.clip === 'Spin';
      if (moving && !spin) an.play({ lower: loco === 'Idle' ? 'Walk' : loco, upper: name }, HERO_TUNING.fadeAction);
      else an.play({ full: name }, HERO_TUNING.fadeAction);
    } else if (this.hitReact > 0) {
      this.hitReact -= k;
      an.advance(this.reactAnim, k);
      an.play(v > HERO_TUNING.idleBelow ? { lower: loco === 'Idle' ? 'Walk' : loco, upper: this.reactAnim } : { full: this.reactAnim }, 0.05);
    } else {
      // out of an airborne pose (the whirlwind's skimming feet) the feet come down quickly
      const fade = this.state !== 'idle' ? HERO_TUNING.fadeMove : this.lastClip === 'Spin' ? HERO_TUNING.fadeMove : HERO_TUNING.fadeOut;
      an.play({ full: loco }, fade);
    }
    if (this.action) this.lastClip = this.action.clip;
    else if (this.state === 'dodge') this.lastClip = 'Roll';
    const hop = this.turnModel(k, v);
    const lift = Math.max(hop, this.liftFor(k, v));
    an.update(frozen ? 0 : dt, this.feetFor(v, lift));
    // (after foot placement, which works from where the body really is)
    if (lift > 0) this.model.position.y += lift;
    this.weapons.update(this.model);
  }

  /**
   * The drawn facing: follows the gameplay facing, hopping round for a big standing turn;
   * spins the whole model during a whirlwind. Returns how high the hop lifts the body now.
   */
  private turnModel(k: number, speed: number): number {
    const T = HERO_TUNING;
    const a = this.actor;
    const act = this.action;
    const spinning = !!act && act.clip === 'Spin' && this.state === 'channel';
    if (spinning) {
      this.spinT += k;
      const rate = T.spinTurns * Math.PI * 2 * act.skill.speed * smooth(this.spinT / T.spinUp);
      this.spinAngle -= rate * k;
      this.spinRate = rate;
    } else if (this.spinAngle !== 0) {
      // out of the spin: carry on the same way round to the facing (a spin-down hop)
      const from = a.facing + this.spinAngle;
      let left = wrapAngle(from - a.facing);
      if (left < 0) left += Math.PI * 2; // turning rightwards (decreasing yaw)
      this.viewYaw = from;
      this.spinAngle = 0;
      this.spinT = 0;
      const rate = Math.max(this.spinRate * 0.8, Math.PI * 4);
      this.hop = { t: 0, time: Math.max(T.hopTime, left / rate), from, to: from - left };
    }
    const target = a.facing + this.spinAngle;
    if (this.snapView) {
      this.snapView = false;
      this.viewYaw = target;
      this.hop = null;
    }
    let lift = 0;
    const standing = speed < T.idleBelow && this.state !== 'dodge' && !spinning;
    if (this.state === 'dodge' || spinning) {
      // a roll turns at once (its feet are already off the floor); a spin is the spin
      this.viewYaw = target;
      this.hop = null;
    } else if (this.hop) {
      const h = this.hop;
      h.t += k;
      const u = Math.min(1, h.t / h.time);
      // the target may move on during the hop (a new aim): keep heading for it
      h.to += wrapAngle(target - h.to);
      this.viewYaw = h.from + (h.to - h.from) * smooth(u);
      lift = T.hopHeight * Math.min(1, 1.6 * Math.sin(Math.PI * u));
      if (u >= 1) this.hop = null;
    } else {
      const d = wrapAngle(target - this.viewYaw);
      if (standing && Math.abs(d) > (T.hopTurn * Math.PI) / 180) {
        this.hop = { t: k, time: T.hopTime, from: this.viewYaw, to: this.viewYaw + d };
        lift = T.hopHeight * Math.min(1, 1.6 * Math.sin((Math.PI * k) / T.hopTime));
        this.viewYaw += d * smooth(k / T.hopTime);
      } else this.viewYaw += d * (1 - Math.exp(-T.viewTurnRate * k));
    }
    this.model.rotation.y = this.viewYaw;
    return lift;
  }

  /**
   * Moments the feet must be off the floor although the clip has them on it: a melee lunge
   * (the hero bounds in toward the target), the push-off of a roll, the first instants of a
   * whirlwind, a standing start at a run. The body springs up at once and settles over a few frames.
   */
  private liftFor(k: number, speed: number): number {
    const T = HERO_TUNING;
    let want = 0;
    // a standing start at a run (instant top speed): spring off the planted feet instead of
    // leaving them behind
    if (this.state === 'run' && this.lastSpeed < T.idleBelow && speed >= T.walkBelow) this.startT = T.startTime;
    if (k > 0) this.lastSpeed = speed;
    if (this.state !== 'run') this.startT = 0;
    if (this.startT > 0) {
      this.startT -= k;
      want = T.startHop;
    }
    if (this.lunging) want = T.lungeHop;
    else if (this.state === 'dodge') {
      const frame = (this.animator.time(this.rollAnim) / Math.max(1e-3, this.animator.duration(this.rollAnim))) * 14;
      if (frame < 2.5) want = T.rollPush;
    } else if (this.action?.clip === 'Spin' && this.spinT < T.spinUp) want = T.rollPush;
    if (k <= 0) return this.lift;
    // (rising at once: the first frames blend from a pose with the feet down, which the body
    // must already be clear of)
    if (want > this.lift) this.lift = want;
    else this.lift += (want - this.lift) * (1 - Math.exp(-T.liftFall * k));
    if (this.lift < 1e-4) this.lift = 0;
    return this.lift;
  }
  private lift = 0;
  private lastClip = '';
  /** Shared Walk / Run phase (0..1) and which gait leads it. */
  private gaitPhase = 0;
  private gaitRun = true;
  /** Phase rate (cycles/s) while moving, and whether a stop has finished its stride. */
  private gaitRate = 0;
  private gaitHold = true;
  /** Seconds of the standing-start spring left (see `liftFor`), and last frame's ground speed. */
  private startT = 0;
  private lastSpeed = 0;
  private viewYaw = 0;
  /** Snap the drawn facing next frame (spawn, teleport). */
  private snapView = true;
  private hop: { t: number; time: number; from: number; to: number } | null = null;
  private spinAngle = 0;
  private spinT = 0;
  private spinRate = 0;

  /**
   * Foot placement this frame: planted feet stay where they are in the world wherever the
   * hero stands (idle, running, attacking, casting, getting hit, dying); feet that the body
   * lifts clear (a hop, a lunge, a spin) follow the clip; off while the clip itself flies the
   * body (the roll's tuck, a leap in the air), back on as the roll's feet come down.
   */
  private feetFor(speed: number, lift: number): FootPlacementInput {
    const f = this.feetInput;
    f.speed = speed;
    let ik = true;
    // (a lift settling the last centimetre may lock: the feet are just above where they plant)
    let lock = lift < 0.012 && !this.hop && this.spinAngle === 0;
    if (this.state === 'dodge') {
      const frame = (this.animator.time(this.rollAnim) / Math.max(1e-3, this.animator.duration(this.rollAnim))) * 14;
      ik = frame >= ROLL_DOWN - 1;
      lock = frame >= ROLL_DOWN;
    }
    // a dash or a leap flies the body: the clip has the feet (a leap's stay planted until the
    // body actually leaves the ground)
    if (this.actor.motion && this.state !== 'dodge' && (!this.action?.skill.def.leap || this.airborne())) ik = lock = false;
    f.ik = ik;
    f.lock = ik && lock;
    return f;
  }
  private readonly feetInput: FootPlacementInput = { ik: true, lock: true, speed: 0 };

  /** The drawn body clearly above the ground under it (a leap's arc; the physics may already be a step ahead). */
  private airborne(): boolean {
    const p = this.model.position;
    return this.probe(p.x, p.y + 0.5, p.z, 3, this.groundHit) && p.y - this.groundHit.y > 0.02;
  }
  private readonly groundHit = { y: 0, nx: 0, ny: 1, nz: 0, id: 0 };

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
  /** Optional: the game's own aim point (fills `out`, returns true); skips mouse / stick / auto-aim. */
  aimAt?(out: Vector3): boolean;
}

/**
 * Pay a skill cost, honouring the keystones (KEYSTONE_FLAGS): `skills.costLife` pays from life
 * (never the last point), `es.protectsMana` takes it from energy shield first. False when the
 * actor can't afford it (nothing is paid).
 */
export function payCost(a: Actor, cost: number): boolean {
  if (cost <= 0) return true;
  if (a.stats.has('skills.costLife')) {
    if (a.life - cost < 1) return false;
    a.life -= cost;
    return true;
  }
  const fromEs = a.stats.has('es.protectsMana') ? Math.min(a.es, cost) : 0;
  if (a.mana + fromEs < cost) return false;
  a.es -= fromEs;
  a.mana -= cost - fromEs;
  return true;
}

/** An angle in (−π, π]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Smoothstep on 0..1 (clamped). */
function smooth(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

function groundBasisOf(camera: Camera): { right: Vector3; forward: Vector3 } {
  const m = camera.matrixWorld;
  const right = new Vector3().setFromMatrixColumn(m, 0).setY(0).normalize();
  const forward = new Vector3().setFromMatrixColumn(m, 2).negate().setY(0);
  if (forward.lengthSq() < 1e-6) forward.setFromMatrixColumn(m, 1).setY(0);
  return { right, forward: forward.normalize() };
}
