import { type AnimationMixer, Group, type Object3D, Vector3 } from 'three/webgpu';
import { flat, type Mod, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import type { Rank } from '../core/scaling';
import type { ActorLike, AilmentType, DamageType, Faction, GameEventBus, Hit, HitResult } from '../core/types';
import { AILMENTS } from '../combat/ailments';
import { mitigate, mitigateDot, type AilmentApplication, type Defender } from '../combat/damage';
import { BodyFx } from './bodyFx';
import { GridMover, openFloor, type Mover } from './movers';

/**
 * Base numbers every actor starts from, as a `base` mod source (so every system reads them
 * the same way, through the sheet). Override per actor with `ActorOptions.base`.
 */
export const ACTOR_BASE: Readonly<Record<string, number>> = {
  life: 100,
  mana: 50,
  es: 0,
  'life.regen': 1,
  'mana.regen': 3,
  'move.speed': 5,
  accuracy: 400,
  'damage.taken': 1,
  mass: 1,
};

/** Seconds a "recently" condition lasts. */
export const RECENTLY = 4;
/** Below this fraction of life the actor is on `lowLife`. */
export const LOW_LIFE = 0.35;
/** Leech returns at most this fraction of max life (or mana) per second. */
export const LEECH_RATE = 0.2;
/** Energy shield starts recharging after this long without being hit, at 33% per second. */
export const ES_DELAY = 2;

export interface AilmentInstance {
  readonly id: AilmentType;
  magnitude: number;
  remaining: number;
  readonly duration: number;
  readonly source: ActorLike | null;
}

/** Scripted movement that overrides the brain / controller (dashes, rolls, leaps, charges). */
export interface Motion {
  vx: number;
  vz: number;
  /** Seconds left. */
  left: number;
  /** Called every step while it runs (hits along a dash path). */
  onStep?(actor: Actor, dt: number): void;
  /** Called once when it ends (or is cut short by a stun / freeze / death). */
  onEnd?(actor: Actor, interrupted: boolean): void;
}

/** What an actor's brain may look at (the manager implements it). */
export interface ActorWorld {
  readonly time: number;
  nearest(from: Vector3, radius: number, filter: (a: Actor) => boolean): Actor | null;
  query(center: Vector3, radius: number, out?: Actor[]): Actor[];
}

/** Decides what an actor wants each fixed step (monster AI, minion AI). The hero has its controller instead. */
export interface Brain {
  think(actor: Actor, dt: number, world: ActorWorld): void;
}

export interface ActorOptions {
  faction: Faction;
  name?: string;
  /** Base stat values (merged over ACTOR_BASE). */
  base?: Readonly<Record<string, number>>;
  /** Extra mods sources at spawn (`{ 'genome': [...], 'elite': [...] }`). */
  mods?: Readonly<Record<string, readonly Mod[]>>;
  level?: number;
  rank?: Rank;
  radius?: number;
  /** Visual root (added to the scene by the owner). Default: an empty Group. */
  body?: Object3D;
  mixer?: AnimationMixer;
  /** Floor movement. Default: a GridMover on an open floor at `at`. */
  mover?: Mover;
  at?: Vector3 | readonly [number, number, number];
  brain?: Brain;
  /** How it dies: monsters pop and flicker out, the hero plays a clip. */
  death?: 'ragdoll' | 'anim';
  /** Seed for its rolls (evasion, block, ailments). Default: derived from its id. */
  seed?: number | string;
  /** Update order: lower first (hero 0, minions 1, monsters 2). */
  order?: number;
  /** Free-form tags ('minion', 'summon-skeletons', 'elite', 'boss', 'dummy'...). */
  tags?: readonly string[];
  /** Per-frame visual hook (procedural bob, look-at...); skipped while frozen. */
  animate?: (actor: Actor, dt: number) => void;
}

let nextId = 1;

/**
 * Anything that fights: the hero, monsters, minions. Owns a StatSheet, life / mana / energy
 * shield with regeneration, a faction, a body (Object3D + optional mixer), a velocity with
 * decaying impulses, a Mover, statuses (ailments with timers, buffs as sheet sources with
 * expiry, conditions on the sheet) and death. `takeHit` runs the defender side of the damage
 * pipeline and emits `hit` / `death` / `kill` on the bus the ActorManager gives it.
 */
export class Actor implements ActorLike {
  readonly id = nextId++;
  readonly faction: Faction;
  readonly name: string;
  readonly stats: StatSheet;
  readonly radius: number;
  readonly body: Object3D;
  mixer: AnimationMixer | null;
  readonly mover: Mover;
  brain: Brain | null;
  level: number;
  rank: Rank;
  readonly order: number;
  readonly tags: readonly string[];
  animate: ((actor: Actor, dt: number) => void) | null;
  readonly death: 'ragdoll' | 'anim';
  readonly rng: Rng;
  readonly fx: BodyFx;
  /** Feet, fixed-step truth (synced from the mover). */
  readonly position = new Vector3();
  /** Desired horizontal velocity (m/s) set by the brain / controller each step. */
  readonly velocity = new Vector3();
  /** Knockback, wind, wells: decays on its own. */
  readonly impulse = new Vector3();
  /** Push out of other actors this step (set by the ActorManager). */
  readonly separation = new Vector3();
  /** Vertical speed to apply on the next step (leaps), then cleared. */
  launch: number | undefined;
  /** Scripted movement in progress (see Motion). */
  motion: Motion | null = null;
  /** Facing yaw (0 = +Z). */
  facing = 0;
  life: number;
  mana: number;
  es: number;
  readonly ailments: AilmentInstance[] = [];
  /** Buff key → game time it expires (Infinity = until removed). */
  readonly buffs = new Map<string, number>();
  /** Invulnerable while > 0 (dodge rolls). Seconds. */
  iframes = 0;
  /** Hit-stop: frames of frozen movement and animation left. */
  hitStop = 0;
  /** Game time, advanced by fixedUpdate. */
  time = 0;
  events: GameEventBus | null = null;
  /** Depth of the level, for `kill` events (set by the manager). */
  depth = 1;
  /** Set by the summoner: minions follow and fight for it. */
  owner: Actor | null = null;
  /** Seconds since death (−1 while alive). */
  deadFor = -1;
  /** True once the death visuals are over: the manager removes it. */
  gone = false;
  /** Counters for tools and tests. */
  readonly counters = { hitsTaken: 0, damageTaken: 0, kills: 0, evaded: 0, blocked: 0 };
  private readonly leechPool = { life: 0, mana: 0 };
  private sinceHit = 99;
  private sinceKill = 99;
  private esTimer = 0;
  private dotShown = 0;
  private dotTimer = 0;
  private readonly tmp = new Vector3();

  constructor(o: ActorOptions) {
    this.faction = o.faction;
    this.name = o.name ?? o.faction;
    this.level = o.level ?? 1;
    this.rank = o.rank ?? 'normal';
    this.radius = o.radius ?? 0.45;
    this.order = o.order ?? (o.faction === 'hero' ? 0 : 2);
    this.tags = o.tags ?? [];
    this.animate = o.animate ?? null;
    this.death = o.death ?? (o.faction === 'hero' ? 'anim' : 'ragdoll');
    this.stats = new StatSheet();
    const base = { ...ACTOR_BASE, ...o.base };
    this.stats.set('base', Object.entries(base).map(([stat, v]) => flat(stat, v)));
    for (const [source, mods] of Object.entries(o.mods ?? {})) this.stats.set(source, mods);
    this.body = o.body ?? new Group();
    this.mixer = o.mixer ?? null;
    this.brain = o.brain ?? null;
    this.mover = o.mover ?? new GridMover(openFloor(), o.at ?? [0, 0, 0], this.radius);
    this.position.copy(this.mover.position);
    this.rng = new Rng(o.seed ?? `actor:${this.id}`);
    this.fx = new BodyFx(this.body);
    this.life = this.maxLife;
    this.mana = this.maxMana;
    this.es = this.maxEs;
  }

  // ------------------------------------------------------------------ derived

  get alive(): boolean {
    return this.life > 0 && this.deadFor < 0;
  }
  get maxLife(): number {
    return Math.max(1, this.stats.get('life'));
  }
  get maxMana(): number {
    return Math.max(0, this.stats.get('mana'));
  }
  get maxEs(): number {
    return Math.max(0, this.stats.get('es'));
  }
  /** Strongest active ailment of a kind (0 if none). */
  ailment(id: AilmentType): number {
    let m = 0;
    for (const a of this.ailments) if (a.id === id) m = Math.max(m, a.magnitude);
    return m;
  }
  get shock(): number {
    return this.ailment('shock');
  }
  get chill(): number {
    return this.ailment('chill');
  }
  /** Frozen or stunned: no actions, no movement. */
  get stopped(): boolean {
    return this.ailments.some((a) => AILMENTS.get(a.id).kind === 'stop');
  }
  /** Multiplier on actions and movement: chill slows, freeze/stun stop, hit-stop pauses. */
  get actionSpeed(): number {
    if (!this.alive || this.stopped || this.hitStop > 0) return 0;
    return (1 - this.chill) * Math.max(0.1, this.stats.get('action.speed') || 1);
  }
  get moveSpeed(): number {
    return Math.max(0, this.stats.get('move.speed')) * (1 - this.chill);
  }
  /** Defender view for the damage pipeline. */
  get defender(): Defender {
    return this;
  }

  hostileTo(other: ActorLike): boolean {
    return other.faction !== this.faction && other.faction !== 'neutral' && this.faction !== 'neutral';
  }

  // ------------------------------------------------------------------ status

  /** A buff (or debuff) as a StatSheet source; `duration` ≤ 0 = until removed. Re-applying refreshes. */
  addBuff(key: string, mods: readonly Mod[], duration: number): void {
    this.stats.set(`buff:${key}`, mods);
    this.buffs.set(key, duration > 0 ? this.time + duration : Infinity);
  }

  removeBuff(key: string): void {
    this.stats.remove(`buff:${key}`);
    this.buffs.delete(key);
  }

  hasBuff(key: string): boolean {
    return this.buffs.has(key);
  }

  /** Put an ailment on: stacking ones add an instance, others keep the strongest and refresh. */
  applyAilment(a: AilmentApplication, source: ActorLike | null): void {
    const def = AILMENTS.get(a.id);
    if (!def.stacks) {
      const cur = this.ailments.find((x) => x.id === a.id);
      if (cur) {
        if (a.magnitude >= cur.magnitude || cur.remaining < a.duration * 0.5) {
          cur.magnitude = Math.max(cur.magnitude, a.magnitude);
          cur.remaining = Math.max(cur.remaining, a.duration);
        }
        return;
      }
    } else if (this.ailments.filter((x) => x.id === a.id).length >= 20) return;
    this.ailments.push({ id: a.id, magnitude: a.magnitude, remaining: a.duration, duration: a.duration, source });
    if (def.kind === 'stop') this.velocity.set(0, 0, 0);
  }

  /** Movement impulse (knockback, wind, gravity wells), m/s; heavier actors move less. */
  push(impulse: Vector3): void {
    if (!this.alive) return;
    const mass = Math.max(0.1, this.stats.get('mass') || 1);
    this.impulse.addScaledVector(impulse, 1 / mass);
  }

  /** Life (or mana) returned over time, at most LEECH_RATE of the max per second. */
  leech(life: number, mana = 0): void {
    if (!this.alive) return;
    this.leechPool.life += life;
    this.leechPool.mana += mana;
  }

  heal(amount: number): void {
    if (this.alive) this.life = Math.min(this.maxLife, this.life + amount);
  }

  /** The killer side: called by the hit pipeline when this actor kills something. */
  onKill(): void {
    this.sinceKill = 0;
    this.counters.kills++;
  }

  // ------------------------------------------------------------------ hits

  takeHit(hit: Hit): HitResult {
    if (!this.alive) return { total: 0, byType: {}, crit: hit.crit, killed: false, ailments: [] };
    if (this.iframes > 0) {
      this.counters.evaded++;
      const result: HitResult = { total: 0, byType: {}, crit: false, killed: false, evaded: true, ailments: [] };
      this.events?.emit('hit', { target: this, result, hit });
      return result;
    }
    const m = mitigate(hit, this, this.rng);
    const { result } = m;
    if (result.evaded) this.counters.evaded++;
    if (result.blocked) this.counters.blocked++;
    if (!result.evaded && !result.blocked) {
      this.es -= m.toEs;
      this.life -= m.toLife;
      this.counters.hitsTaken++;
      this.counters.damageTaken += result.total;
      this.sinceHit = 0;
      this.esTimer = 0;
      for (const a of m.apply) this.applyAilment(a, hit.source);
      if (hit.knockback && hit.from) {
        const d = this.tmp.subVectors(this.position, hit.from).setY(0);
        if (d.lengthSq() < 1e-6) d.set(Math.sin(this.facing), 0, Math.cos(this.facing)).negate();
        this.push(d.normalize().multiplyScalar(hit.knockback));
      }
      this.hitStop = Math.max(this.hitStop, hit.hitStop ?? 0);
      if (result.total > 0) this.fx.flash(hit.crit ? 0.12 : 0.08);
    }
    this.events?.emit('hit', { target: this, result, hit });
    if (result.killed) this.die(hit.source);
    return result;
  }

  /** Life reaches 0: emits `death`, and `kill` with the killer. */
  die(killer: ActorLike | null = null): void {
    if (this.deadFor >= 0) return;
    this.life = 0;
    this.deadFor = 0;
    this.velocity.set(0, 0, 0);
    this.ailments.length = 0;
    this.endMotion(true);
    if (killer instanceof Actor) killer.onKill();
    this.events?.emit('death', { actor: this });
    this.events?.emit('kill', { target: this, killer, rank: this.rank, depth: this.depth });
    if (this.death === 'ragdoll') this.fx.pop(this.impulse, this.rng);
  }

  // ------------------------------------------------------------------ simulation

  /** One fixed step: brain, statuses, regeneration, movement. */
  fixedUpdate(dt: number, world: ActorWorld | null = null): void {
    this.time += dt;
    if (this.deadFor >= 0) {
      this.deadFor += dt;
      if (this.death === 'ragdoll') this.gone = this.fx.ragdollDone;
      return;
    }
    if (this.hitStop > 0) {
      this.hitStop--;
      this.mover.move(0, 0, dt); // keep gravity / interpolation in step
      this.position.copy(this.mover.position);
      return;
    }
    this.tickStatus(dt);
    if (!this.alive) return;
    if (this.brain && world && !this.stopped) this.brain.think(this, dt, world);
    this.moveStep(dt);
  }

  private tickStatus(dt: number): void {
    this.sinceHit += dt;
    this.sinceKill += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    for (const [key, until] of this.buffs) if (this.time >= until) this.removeBuff(key);
    // ailments: tick damage over time, expire
    let dot = 0;
    let dotSource: ActorLike | null = null;
    for (let i = this.ailments.length - 1; i >= 0; i--) {
      const a = this.ailments[i]!;
      const def = AILMENTS.get(a.id);
      if (def.kind === 'dot') {
        const d = mitigateDot(this, def.dotType as DamageType, a.magnitude * Math.min(dt, a.remaining));
        dot += d;
        dotSource = a.source;
      }
      a.remaining -= dt;
      if (a.remaining <= 0) this.ailments.splice(i, 1);
    }
    if (dot > 0) {
      const toEs = Math.min(this.es, dot);
      this.es -= toEs;
      this.life -= dot - toEs;
      this.dotShown += dot;
      this.counters.damageTaken += dot;
    }
    // damage-over-time numbers: one event every 0.5 s, not every step
    this.dotTimer += dt;
    if (this.dotTimer >= 0.5 && this.dotShown > 0) {
      const result: HitResult = { total: this.dotShown, byType: {}, crit: false, killed: this.life <= 0, ailments: [] };
      this.events?.emit('hit', { target: this, result, hit: { source: dotSource, tags: ['dot'], damage: {}, crit: false } });
      this.dotShown = 0;
      this.dotTimer = 0;
    } else if (this.dotTimer >= 0.5) this.dotTimer = 0;
    if (this.life <= 0) {
      this.die(dotSource);
      return;
    }
    // regeneration, leech, energy shield recharge
    const maxLife = this.maxLife;
    const maxMana = this.maxMana;
    this.life = Math.min(maxLife, this.life + Math.max(0, this.stats.get('life.regen')) * dt);
    this.mana = Math.min(maxMana, this.mana + Math.max(0, this.stats.get('mana.regen')) * dt);
    const lifeLeech = Math.min(this.leechPool.life, maxLife * LEECH_RATE * dt);
    const manaLeech = Math.min(this.leechPool.mana, maxMana * LEECH_RATE * dt);
    this.leechPool.life -= lifeLeech;
    this.leechPool.mana -= manaLeech;
    this.life = Math.min(maxLife, this.life + lifeLeech);
    this.mana = Math.min(maxMana, this.mana + manaLeech);
    this.esTimer += dt;
    const maxEs = this.maxEs;
    if (this.esTimer >= ES_DELAY && this.es < maxEs) this.es = Math.min(maxEs, this.es + maxEs * 0.33 * dt);
    if (this.es > maxEs) this.es = maxEs;
    // conditions mods can key on (`when: 'lowLife'` ...)
    const s = this.stats;
    s.setCondition('lowLife', this.life < maxLife * LOW_LIFE);
    s.setCondition('fullLife', this.life >= maxLife);
    s.setCondition('recentlyHit', this.sinceHit < RECENTLY);
    s.setCondition('recentlyKilled', this.sinceKill < RECENTLY);
    s.setCondition('moving', this.velocity.lengthSq() > 0.25);
    for (const def of AILMENTS.all()) s.setCondition(def.id, this.ailments.some((a) => a.id === def.id));
  }

  /** Start a scripted movement (replaces any running one). */
  startMotion(m: Motion): void {
    this.endMotion(true);
    this.motion = m;
  }

  endMotion(interrupted: boolean): void {
    const m = this.motion;
    if (!m) return;
    this.motion = null;
    m.onEnd?.(this, interrupted);
  }

  private moveStep(dt: number): void {
    const stop = this.stopped;
    if (stop && this.motion) this.endMotion(true);
    const m = this.motion;
    const k = stop ? 0 : 1;
    const vx = m ? m.vx : this.velocity.x * k + this.impulse.x + this.separation.x;
    const vz = m ? m.vz : this.velocity.z * k + this.impulse.z + this.separation.z;
    this.mover.move(vx, vz, dt, this.launch);
    this.launch = undefined;
    this.position.copy(this.mover.position);
    if (m) {
      m.onStep?.(this, dt);
      m.left -= dt;
      if (m.left <= 0 && this.motion === m) this.endMotion(false);
    }
    // impulses fade fast (snappy knockback, no ice-skating)
    const decay = Math.exp(-9 * dt);
    this.impulse.multiplyScalar(decay);
    if (this.impulse.lengthSq() < 0.0004) this.impulse.set(0, 0, 0);
  }

  /** Per rendered frame: body follows the mover, faces `facing`, animates, plays its effects. */
  update(dt: number, alpha: number): void {
    if (this.deadFor >= 0 && this.death === 'ragdoll') {
      this.fx.update(dt);
      return;
    }
    this.mover.visual(alpha, this.body.position);
    this.body.rotation.y = this.facing;
    const frozen = this.hitStop > 0 || this.stopped;
    if (this.mixer && !frozen) this.mixer.update(dt * Math.max(0, 1 - this.chill));
    if (this.animate && !frozen) this.animate(this, dt * Math.max(0, 1 - this.chill));
    this.fx.update(dt);
  }

  /** Free what this actor owns (cloned materials, the mover's physics). The body is removed by the owner. */
  dispose(): void {
    this.fx.dispose();
    this.mover.dispose?.();
    this.body.removeFromParent();
  }
}
