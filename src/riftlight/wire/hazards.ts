import { type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import type { Actor } from '../actors/Actor';
import { StatQuery } from '../combat/stats';
import { createTelegraph } from '../combat/telegraph';
import { ringDecal } from '../combat/visuals';
import { inc, more } from '../core/mods';
import type { Rng } from '../core/rng';
import { type ActorIndex, type ActorRef, refOf, type Vec } from '../core/saved';
import type { ActorLike, AilmentType, DamageType } from '../core/types';
import type { Level } from '../levels/Level';
import { MONSTER_SKILLS, type MonsterEvent } from '../monsters';
import { buildSkill } from '../skills/build';
import { SKILLS } from '../skills/actives';
import { loadSkill, type SavedSkill, saveSkill } from '../skills/saved';
import type { ResolvedSkill, SkillGem } from '../skills/types';
import { type LiveTelegraph, makeTelegraph, type MonsterUnit, monsterGem, unitOf } from './monsters';
import { WIRE_TUNING } from './tuning';
import { type CombatWorld, isProp, PropActor } from './world';

const H = WIRE_TUNING.hazard;

/** What the hazard stager needs from its level (wire/levels.ts implements it). */
export interface HazardHost {
  readonly world: CombatWorld;
  readonly level: Level;
  readonly root: Object3D;
  readonly rng: Rng;
  readonly ctx: import('../../engine').GameContext;
  shake(strength: number, seconds?: number): void;
  heroActor(): Actor | null;
  units(): readonly MonsterUnit[];
  /** Spawn adds around a monster (summons, splits, clones). */
  spawnAdds(from: MonsterUnit, o: { count: number; archetype?: string; scale?: number; mode: 'summon' | 'split' | 'clone'; at: Vector3 }): void;
}

const DAMAGE: readonly DamageType[] = ['physical', 'fire', 'cold', 'lightning', 'chaos'];
const asType = (v: unknown, d: DamageType = 'physical'): DamageType => (DAMAGE.includes(v as DamageType) ? (v as DamageType) : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const COLOR: Readonly<Record<DamageType, number>> = { physical: 0xef7d57, fire: 0xef7d57, cold: 0x73eff7, lightning: 0x41a6f6, chaos: 0xa7f070 };
const BOLT: Readonly<Record<DamageType, string>> = { physical: 'voidbolt', fire: 'firebolt', cold: 'frostbolt', lightning: 'sparkbolt', chaos: 'voidbolt' };
const AILMENT: Partial<Record<DamageType, AilmentType>> = { fire: 'ignite', cold: 'chill', lightning: 'shock', chaos: 'poison' };
/** How much darkness dims the level's ambient and sun. */
const DARK = 0.3;

/** A single projectile of a monster bolt (spirals fire many of them). */
const singles = new Map<string, SkillGem>();
function singleBolt(type: DamageType): SkillGem {
  let g = singles.get(type);
  if (!g) {
    const base = monsterGem(MONSTER_SKILLS.get(BOLT[type]));
    const d = base.delivery;
    g = {
      ...base,
      id: `hazard-bolt-${type}`,
      delivery: d.kind === 'projectile' ? { ...d, count: 1, spread: 0, speed: d.speed * 0.8, range: 13 } : d,
      effects: type === 'physical' ? [{ kind: 'damage', base: { physical: [4, 8] } }] : base.effects.filter((e) => e.kind !== 'light'),
    };
    singles.set(type, g);
  }
  return g;
}

/**
 * The gems monsters and hazards cast, by id, for `loadSkill` (save-states): every monster skill
 * (`monsterGem`) and the hazards' single bolts (`hazard-bolt-<type>`).
 */
export function monsterGems(id: string): SkillGem | undefined {
  if (id.startsWith('hazard-bolt-')) {
    const t = id.slice('hazard-bolt-'.length) as DamageType;
    return DAMAGE.includes(t) ? singleBolt(t) : undefined;
  }
  return MONSTER_SKILLS.has(id) ? monsterGem(MONSTER_SKILLS.get(id)) : undefined;
}

// ---------------------------------------------------------------- staged work as data

/**
 * Work staged for later (`Hazards.later`): an op and its arguments, with no closure. The
 * dispatcher (`Hazards.run`) does what each op means when its time comes, reading positions
 * then, as the closures it replaces did. Actors are held by reference while it waits.
 */
export type LaterOp =
  /** Summon adds around `unit` (at `at`, or where it stands then). */
  | { readonly op: 'adds'; readonly unit: MonsterUnit; readonly count: number; readonly archetype?: string; readonly scale?: number; readonly at: Vector3 | null }
  /** Shockwave rings from where `src` stands then. */
  | { readonly op: 'rings'; readonly src: Actor; readonly count: number; readonly speed: number; readonly gap: number; readonly type: DamageType; readonly slow: number }
  /** Echo slam: two rings and a strike where `src` stands then. */
  | { readonly op: 'echo'; readonly src: Actor; readonly delay: number }
  | { readonly op: 'spiral'; readonly src: Actor; readonly arms: number; readonly shots: number; readonly turn: number; readonly type: DamageType }
  /** A gust toward the hero (none without one). */
  | { readonly op: 'gust'; readonly src: Actor; readonly hero: Actor | null; readonly force: number; readonly length: number }
  /** A pull toward where `src` stands then. */
  | { readonly op: 'pull'; readonly src: Actor; readonly radius: number; readonly force: number; readonly duration: number; readonly collapse: boolean }
  | { readonly op: 'darkness'; readonly duration: number }
  | { readonly op: 'beams'; readonly src: Actor; readonly count: number; readonly length: number; readonly speed: number; readonly duration: number }
  | { readonly op: 'strike'; readonly src: Actor; readonly at: Vector3; readonly radius: number; readonly delay: number; readonly type: DamageType; readonly mult: number }
  /** A strike near where the hero stands then (none without one). */
  | { readonly op: 'strikeNear'; readonly src: Actor; readonly hero: Actor | null; readonly spread: number; readonly radius: number; readonly delay: number; readonly type: DamageType; readonly mult: number }
  /** The boss steps through behind the hero. */
  | { readonly op: 'portal'; readonly src: Actor; readonly hero: Actor | null }
  /** A level prop (brazier, pylon) set off by `src`. */
  | { readonly op: 'prop'; readonly prop: Actor; readonly src: Actor; readonly type: 'fire' | 'lightning' }
  /** A damaging patch at `at`, or where `on` stands then. */
  | { readonly op: 'zone'; readonly src: Actor; readonly at: Vector3 | null; readonly on: Actor; readonly radius: number; readonly duration: number; readonly type: DamageType; readonly mult: number; readonly ailment?: AilmentType };

const ACTOR_KEYS: ReadonlySet<string> = new Set(['src', 'hero', 'prop', 'on']);
type AsData<T> = { readonly [K in keyof T]: T[K] extends MonsterUnit ? ActorRef : T[K] extends Actor | null ? ActorRef : T[K] extends Vector3 | null ? Vec | null : T[K] };
type DataOf<T> = T extends unknown ? AsData<T> : never;
/** `LaterOp` as data: actors (and a unit) by their actor's id, vectors as `[x, y, z]`. */
export type LaterOpData = DataOf<LaterOp>;

function opData(o: LaterOp): LaterOpData {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = k === 'unit' ? refOf((v as MonsterUnit).actor) : ACTOR_KEYS.has(k) ? refOf(v as Actor | null) : v instanceof Vector3 ? v.toArray() : v;
  return out as LaterOpData;
}

function opActors(o: LaterOp): ActorLike[] {
  const out: ActorLike[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'unit') out.push((v as MonsterUnit).actor);
    else if (ACTOR_KEYS.has(k) && v) out.push(v as Actor);
  }
  return out;
}

/** Finds what a saved hazard pointed at (throws, saying what, when it is gone). */
interface Finder {
  actor(ref: ActorRef): Actor;
  unit(ref: ActorRef): MonsterUnit;
}

function opLive(d: LaterOpData, find: Finder): LaterOp {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = k === 'unit' ? find.unit(v as ActorRef) : ACTOR_KEYS.has(k) ? (v === null ? null : find.actor(v as ActorRef)) : k === 'at' && v ? new Vector3().fromArray(v as Vec) : v;
  return out as LaterOp;
}

// ---------------------------------------------------------------- hazards as data

/** A staged hazard as data (`Hazards.save`): one kind per effect, its arguments and its clocks. */
export type HazardState =
  | { readonly kind: 'later'; readonly seconds: number; readonly t: number; readonly op: LaterOpData }
  | { readonly kind: 'strike'; readonly src: ActorRef; readonly at: Vec; readonly radius: number; readonly delay: number; readonly type: DamageType; readonly mult: number; readonly ailment?: AilmentType; readonly t: number; readonly landed: boolean }
  | { readonly kind: 'rings'; readonly src: ActorRef; readonly center: Vec; readonly count: number; readonly speed: number; readonly gap: number; readonly type: DamageType; readonly slow: number; readonly t: number; readonly hit: readonly (readonly number[])[] }
  | { readonly kind: 'zone'; readonly src: ActorRef; readonly at: Vec; readonly radius: number; readonly duration: number; readonly type: DamageType; readonly mult: number; readonly ailment?: AilmentType; readonly t: number; readonly tick: number }
  | { readonly kind: 'spiral'; readonly src: ActorRef; readonly arms: number; readonly per: number; readonly turn: number; readonly base: number; readonly skill: SavedSkill; readonly fired: number; readonly t: number }
  | { readonly kind: 'pull'; readonly src: ActorRef; readonly center: Vec; readonly radius: number; readonly force: number; readonly duration: number; readonly collapse: boolean; readonly t: number }
  | { readonly kind: 'darkness'; readonly duration: number; readonly t: number }
  | { readonly kind: 'beams'; readonly src: ActorRef; readonly count: number; readonly length: number; readonly speed: number; readonly duration: number; readonly key: string; readonly t: number; readonly tick: number; readonly angle: number }
  | { readonly kind: 'aura'; readonly src: ActorRef; readonly radius: number; readonly effect: string; readonly tick: number };

/** Every hazard staged in a level, in order (`Hazards.save`). */
export interface HazardsState {
  readonly effects: readonly HazardState[];
}

interface Effect {
  /** Fixed step; false when done. */
  step(dt: number): boolean;
  render?(dt: number): void;
  /** It ends: its visuals go and what it changed in the world goes back (darkness). */
  dispose(): void;
  /** A load replaces it: only its visuals go (the world's state is the load's). */
  drop(): void;
  readonly tele?: LiveTelegraph | null;
  /** Elite toggles ('beam', 'aura') keep a key to switch off. */
  readonly key?: string;
  save(): HazardState;
  /** Actors it points at (save-states: each must be found again). */
  held(): readonly ActorLike[];
}

/** Work waiting its turn (`Hazards.later`). */
class Later implements Effect {
  constructor(
    private readonly hz: Hazards,
    readonly seconds: number,
    readonly op: LaterOp,
    private t = 0,
  ) {}

  step(dt: number): boolean {
    this.t += dt;
    if (this.t < this.seconds) return true;
    this.hz.run(this.op);
    return false;
  }

  dispose(): void {}
  drop(): void {}

  save(): HazardState {
    return { kind: 'later', seconds: this.seconds, t: this.t, op: opData(this.op) };
  }

  held(): readonly ActorLike[] {
    return opActors(this.op);
  }
}

/** A telegraphed circle that lands after `delay`. */
class Strike implements Effect {
  readonly tele: LiveTelegraph;
  t = 0;
  landed = false;

  constructor(
    private readonly hz: Hazards,
    readonly src: Actor,
    readonly at: Vector3,
    readonly radius: number,
    readonly delay: number,
    readonly type: DamageType,
    readonly mult: number,
    readonly ailment: AilmentType | undefined,
  ) {
    this.tele = makeTelegraph(hz.host.root, { shape: 'circle', size: radius, at: 'target' }, at, at, delay, type, src);
  }

  step(dt: number): boolean {
    this.t += dt;
    this.tele.t = this.t;
    const { at, radius, type, src } = this;
    if (this.t < this.delay) return true;
    if (!this.landed) {
      this.landed = true;
      this.tele.decal?.dispose();
      for (const v of this.hz.victims(src, at, radius)) this.hz.hit(src, v, type, this.mult, { from: at, ailment: this.ailment });
      const host = this.hz.host;
      const fx = host.ctx;
      const p = at.clone().setY(0.3);
      fx.particles.burst(type === 'fire' ? 'fire' : type === 'cold' ? 'frost' : type === 'lightning' ? 'zap' : type === 'chaos' ? 'toxic' : 'impact', p, { scale: Math.max(1, radius / 1.5) });
      fx.particles.burst('dust', p, { scale: Math.max(1, radius / 2) });
      fx.audio.play(type === 'lightning' ? 'zap' : type === 'cold' ? 'ice' : 'explode', { pitch: host.rng.range(-2, 1), volume: 0.6 });
      fx.lights.request({ position: [at.x, 1.2, at.z], color: COLOR[type], intensity: 6, radius: radius + 3, lifetime: 0.3, fadeIn: 0.02, priority: 2, name: 'hazard' });
      host.shake(Math.min(0.35, 0.08 * radius), 0.15);
    }
    return this.t < this.delay + 0.05;
  }

  render(): void {
    this.tele.decal?.update(Math.min(1, this.t / Math.max(0.01, this.delay)));
  }

  dispose(): void {
    this.tele.decal?.dispose();
  }

  drop(): void {
    this.dispose();
  }

  save(): HazardState {
    return { kind: 'strike', src: refOf(this.src), at: this.at.toArray(), radius: this.radius, delay: this.delay, type: this.type, mult: this.mult, ailment: this.ailment, t: this.t, landed: this.landed };
  }

  held(): readonly ActorLike[] {
    return [this.src];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'strike' }>, find: Finder): Strike {
    const e = new Strike(hz, find.actor(d.src), new Vector3().fromArray(d.at), d.radius, d.delay, d.type, d.mult, d.ailment);
    e.t = d.t;
    e.tele.t = d.t;
    e.landed = d.landed;
    if (e.landed) e.tele.decal?.dispose();
    else e.render();
    return e;
  }
}

/** Shockwave rings rolling out from `center`; each ring hits each target once. */
class Rings implements Effect {
  private static readonly MAX_R = 13;
  private readonly rings: { start: number; hit: Set<number>; mesh: Mesh }[] = [];
  t = 0;

  constructor(
    private readonly hz: Hazards,
    readonly src: Actor,
    readonly center: Vector3,
    readonly count: number,
    readonly speed: number,
    readonly gap: number,
    readonly type: DamageType,
    readonly slow: number,
  ) {
    for (let i = 0; i < count; i++) {
      const mesh = ringDecal(COLOR[type], 0.8);
      mesh.position.set(center.x, 0.06, center.z);
      mesh.visible = false;
      hz.host.root.add(mesh);
      this.rings.push({ start: i * gap, hit: new Set(), mesh });
    }
  }

  step(dt: number): boolean {
    this.t += dt;
    const { src, center, speed } = this;
    let live = false;
    for (const r of this.rings) {
      const age = this.t - r.start;
      const radius = age * speed;
      if (age < 0 || radius > Rings.MAX_R) continue;
      live = true;
      for (const v of this.hz.victims(src, center, radius + H.band)) {
        if (r.hit.has(v.id)) continue;
        const d = Math.hypot(v.position.x - center.x, v.position.z - center.z);
        if (Math.abs(d - radius) > H.band + v.radius) continue;
        r.hit.add(v.id);
        this.hz.hit(src, v, this.type, 0.9, { from: center, knockback: 5 });
        if (this.slow > 0) v.addBuff('mud-wave', [inc('move.speed', -this.slow)], 2);
      }
    }
    return live || this.t < (this.count - 1) * this.gap;
  }

  render(): void {
    for (const r of this.rings) {
      const age = this.t - r.start;
      const radius = age * this.speed;
      r.mesh.visible = age >= 0 && radius <= Rings.MAX_R;
      r.mesh.scale.setScalar(Math.max(0.05, radius + 0.4));
    }
  }

  dispose(): void {
    for (const r of this.rings) r.mesh.removeFromParent();
  }

  drop(): void {
    this.dispose();
  }

  save(): HazardState {
    return { kind: 'rings', src: refOf(this.src), center: this.center.toArray(), count: this.count, speed: this.speed, gap: this.gap, type: this.type, slow: this.slow, t: this.t, hit: this.rings.map((r) => [...r.hit]) };
  }

  held(): readonly ActorLike[] {
    return [this.src];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'rings' }>, find: Finder): Rings {
    const e = new Rings(hz, find.actor(d.src), new Vector3().fromArray(d.center), d.count, d.speed, d.gap, d.type, d.slow);
    e.t = d.t;
    e.rings.forEach((r, i) => {
      for (const id of d.hit[i] ?? []) r.hit.add(id);
    });
    e.render();
    return e;
  }
}

/** A damaging patch of ground (molten trails, ice, thorns). */
class Zone implements Effect {
  private readonly mesh: Object3D;
  t = 0;
  tick = 0;

  constructor(
    private readonly hz: Hazards,
    readonly src: Actor,
    readonly at: Vector3,
    readonly radius: number,
    readonly duration: number,
    readonly type: DamageType,
    readonly mult: number,
    readonly ailment: AilmentType | undefined,
  ) {
    // a lasting patch: the telegraph look held calm (rim + stipple), never an opaque disc
    this.mesh = createTelegraph({ shape: 'circle', size: radius }, type, 1, { zone: true }).object;
    this.mesh.position.set(at.x, 0.01, at.z);
    hz.host.root.add(this.mesh);
  }

  step(dt: number): boolean {
    this.t += dt;
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.5;
      for (const v of this.hz.victims(this.src, this.at, this.radius)) this.hz.hit(this.src, v, this.type, this.mult, { knockback: 0, ailment: this.ailment });
    }
    return this.t < this.duration;
  }

  /** How it looks at its clock (no random draw: a load poses it with this). */
  private pose(): void {
    this.mesh.visible = this.t < this.duration - 0.6 || Math.floor(this.t * 12) % 2 === 0;
  }

  render(): void {
    this.pose();
    const type = this.type;
    if (this.hz.host.rng.next() < 0.08) this.hz.host.ctx.particles.burst(type === 'fire' ? 'ember' : type === 'cold' ? 'frost' : type === 'physical' ? 'thorn' : 'toxic', this.at.clone().setY(0.2), { count: 1 });
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }

  drop(): void {
    this.dispose();
  }

  save(): HazardState {
    return { kind: 'zone', src: refOf(this.src), at: this.at.toArray(), radius: this.radius, duration: this.duration, type: this.type, mult: this.mult, ailment: this.ailment, t: this.t, tick: this.tick };
  }

  held(): readonly ActorLike[] {
    return [this.src];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'zone' }>, find: Finder): Zone {
    const e = new Zone(hz, find.actor(d.src), new Vector3().fromArray(d.at), d.radius, d.duration, d.type, d.mult, d.ailment);
    e.t = d.t;
    e.tick = d.tick;
    e.pose();
    return e;
  }
}

/** Projectiles fired in rotating arms from the source. */
class Spiral implements Effect {
  fired = 0;
  t = 0;

  constructor(
    private readonly hz: Hazards,
    readonly src: Actor,
    readonly arms: number,
    readonly per: number,
    readonly turn: number,
    readonly base: number,
    /** The bolt as resolved when the spiral started (its numbers stay those). */
    readonly skill: ResolvedSkill,
  ) {}

  step(dt: number): boolean {
    this.t += dt;
    const src = this.src;
    while (this.fired < this.per && this.t >= this.fired * 0.16) {
      if (!src.alive) return false;
      for (let a = 0; a < this.arms; a++) {
        const ang = this.base + (a / this.arms) * Math.PI * 2 + this.fired * this.turn;
        const aim = this.hz.tmp.set(src.position.x + Math.sin(ang) * 5, src.position.y, src.position.z + Math.cos(ang) * 5);
        this.hz.host.world.combat.cast(src, this.skill, aim.clone());
      }
      this.fired++;
    }
    return this.fired < this.per;
  }

  dispose(): void {}
  drop(): void {}

  save(): HazardState {
    return { kind: 'spiral', src: refOf(this.src), arms: this.arms, per: this.per, turn: this.turn, base: this.base, skill: saveSkill(this.skill), fired: this.fired, t: this.t };
  }

  held(): readonly ActorLike[] {
    return [this.src];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'spiral' }>, find: Finder): Spiral {
    const e = new Spiral(hz, find.actor(d.src), d.arms, d.per, d.turn, d.base, loadSkill(d.skill, monsterGems));
    e.fired = d.fired;
    e.t = d.t;
    return e;
  }
}

/** Everything hostile is dragged toward `center` for a while (optionally collapsing in a blast). */
class Pull implements Effect {
  readonly tele = null;
  private readonly ring: Mesh;
  t = 0;

  constructor(
    private readonly hz: Hazards,
    readonly src: Actor,
    readonly center: Vector3,
    readonly radius: number,
    readonly force: number,
    readonly duration: number,
    readonly collapse: boolean,
  ) {
    this.ring = ringDecal(0x5d275d, 0.9);
    this.ring.position.set(center.x, 0.05, center.z);
    hz.host.root.add(this.ring);
  }

  step(dt: number): boolean {
    this.t += dt;
    for (const v of this.hz.victims(this.src, this.center, this.radius)) {
      const d = this.hz.tmp.subVectors(this.center, v.position).setY(0);
      if (d.lengthSq() < 0.04) continue;
      v.push(d.normalize().multiplyScalar(this.force * 9 * dt));
    }
    if (this.t >= this.duration) {
      if (this.collapse) this.hz.strike(this.src, this.center, 3, 0.01, 'chaos', 1.4);
      return false;
    }
    return true;
  }

  private pose(): void {
    const k = 1 - (this.t % 0.6) / 0.6;
    this.ring.scale.setScalar(Math.max(0.2, this.radius * k));
  }

  render(): void {
    this.pose();
    if (this.hz.host.rng.next() < 0.3) this.hz.host.ctx.particles.burst('grav', this.hz.near(this.center, this.radius * 0.7).setY(0.5), { count: 1 });
  }

  dispose(): void {
    this.ring.removeFromParent();
  }

  drop(): void {
    this.dispose();
  }

  save(): HazardState {
    return { kind: 'pull', src: refOf(this.src), center: this.center.toArray(), radius: this.radius, force: this.force, duration: this.duration, collapse: this.collapse, t: this.t };
  }

  held(): readonly ActorLike[] {
    return [this.src];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'pull' }>, find: Finder): Pull {
    const e = new Pull(hz, find.actor(d.src), new Vector3().fromArray(d.center), d.radius, d.force, d.duration, d.collapse);
    e.t = d.t;
    e.pose();
    return e;
  }
}

/**
 * The level goes dark for a while (lanterns gutter, the hero is `inDark`). Starting it dims the
 * level's light environment (`Hazards.darkness`); its end brightens it back. A load does neither:
 * the environment it finds is the saved one, darkness included (the level's state).
 */
class Darkness implements Effect {
  t = 0;

  constructor(
    private readonly hz: Hazards,
    readonly duration: number,
  ) {}

  step(dt: number): boolean {
    this.t += dt;
    this.hz.host.heroActor()?.stats.setCondition('inDark', true);
    return this.t < this.duration;
  }

  dispose(): void {
    const host = this.hz.host;
    const env = host.level.env;
    env.ambient /= DARK;
    env.sun /= DARK;
    if (!host.level.spec.mechanics.includes('gloom')) host.heroActor()?.stats.setCondition('inDark', false);
  }

  drop(): void {}

  save(): HazardState {
    return { kind: 'darkness', duration: this.duration, t: this.t };
  }

  held(): readonly ActorLike[] {
    return [];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'darkness' }>): Darkness {
    const e = new Darkness(hz, d.duration);
    e.t = d.t;
    return e;
  }
}

/** Rotating beams around a monster (elite Arcane Beams, boss Mirror Beams). */
class Beams implements Effect {
  readonly key: string | undefined;
  private readonly lines: LiveTelegraph[];
  private readonly hitAt = new Vector3();
  t = 0;
  tick = 0;
  angle: number;

  constructor(
    private readonly hz: Hazards,
    readonly src: Actor,
    readonly count: number,
    readonly length: number,
    readonly speed: number,
    readonly duration: number,
    key: string,
  ) {
    this.key = key || undefined;
    this.lines = Array.from({ length: count }, () => {
      const tele = makeTelegraph(hz.host.root, { shape: 'line', size: length, width: 0.45, at: 'self' }, src.position, src.position.clone().add(new Vector3(0, 0, 1)), 0.01, 'lightning', src);
      tele.decal?.update(1);
      return tele;
    });
    this.angle = src.facing;
  }

  step(dt: number): boolean {
    const src = this.src;
    this.t += dt;
    if (!src.alive || this.t >= this.duration) return false;
    this.angle += this.speed * dt;
    this.tick -= dt;
    if (this.tick > 0) return true;
    this.tick = 0.2;
    const hit = this.hitAt;
    for (let b = 0; b < this.count; b++) {
      const a = this.angle + (b / this.count) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      for (const v of this.hz.victims(src, src.position, this.length + 0.5)) {
        hit.subVectors(v.position, src.position).setY(0);
        const along = hit.x * dx + hit.z * dz;
        if (along < 0 || along > this.length) continue;
        if (Math.abs(hit.x * dz - hit.z * dx) > 0.35 + v.radius) continue;
        this.hz.hit(src, v, 'lightning', 0.3, { knockback: 1 });
      }
    }
    return true;
  }

  render(): void {
    this.lines.forEach((l, b) => {
      const o = l.decal?.object;
      if (!o) return;
      o.position.set(this.src.body.position.x, 0.05, this.src.body.position.z);
      o.rotation.y = this.angle + (b / this.count) * Math.PI * 2;
    });
  }

  dispose(): void {
    for (const l of this.lines) l.decal?.dispose();
  }

  drop(): void {
    this.dispose();
  }

  save(): HazardState {
    return { kind: 'beams', src: refOf(this.src), count: this.count, length: this.length, speed: this.speed, duration: this.duration, key: this.key ?? '', t: this.t, tick: this.tick, angle: this.angle };
  }

  held(): readonly ActorLike[] {
    return [this.src];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'beams' }>, find: Finder): Beams {
    const e = new Beams(hz, find.actor(d.src), d.count, d.length, d.speed, d.duration, d.key);
    e.t = d.t;
    e.tick = d.tick;
    e.angle = d.angle;
    e.render();
    return e;
  }
}

/** Elite auras: chill everything near it, or empower its allies. */
class Aura implements Effect {
  readonly key: string;
  private readonly ring: Mesh;
  tick = 0;

  constructor(
    private readonly hz: Hazards,
    readonly src: Actor,
    readonly radius: number,
    readonly effect: string,
  ) {
    this.key = `aura:${src.id}`;
    this.ring = ringDecal(effect === 'chill' ? 'cyan' : 'sand', 0.92);
    this.ring.scale.setScalar(radius);
    hz.host.root.add(this.ring);
  }

  step(dt: number): boolean {
    const src = this.src;
    if (!src.alive) return false;
    this.tick -= dt;
    if (this.tick > 0) return true;
    this.tick = 0.5;
    if (this.effect === 'chill') for (const v of this.hz.victims(src, src.position, this.radius)) v.applyAilment({ id: 'chill', magnitude: 0.3, duration: 1 }, src);
    else for (const a of this.hz.host.world.actors.query(src.position, this.radius, [], (x) => x.alive && x !== src && !isProp(x) && !x.hostileTo(src))) a.addBuff('empowered', [more('damage', 0.25), inc('attack.speed', 0.1)], 1);
    return true;
  }

  render(): void {
    this.ring.position.set(this.src.body.position.x, 0.05, this.src.body.position.z);
  }

  dispose(): void {
    this.ring.removeFromParent();
  }

  drop(): void {
    this.dispose();
  }

  save(): HazardState {
    return { kind: 'aura', src: refOf(this.src), radius: this.radius, effect: this.effect, tick: this.tick };
  }

  held(): readonly ActorLike[] {
    return [this.src];
  }

  static load(hz: Hazards, d: Extract<HazardState, { kind: 'aura' }>, find: Finder): Aura {
    const e = new Aura(hz, find.actor(d.src), d.radius, d.effect);
    e.tick = d.tick;
    e.render();
    return e;
  }
}

/**
 * Stages what monster brains ask the world for (`MonsterEvent`s): boss signature patterns
 * (slam waves, spirals, gusts, pulls, beams, meteors, quakes, darkness, mechanic hazards,
 * adds) and elite behaviours (death novas, burning trails, chilling and empowering auras,
 * rotating beams, storm strikes, pulls). Everything telegraphs on the floor before it hurts
 * (`telegraphs()` feeds the bot and the HUD), damage goes through the actor's `takeHit` with
 * the source monster's damage scaling (depth, rank, difficulty), and lights come from the
 * engine pool.
 *
 * Every staged hazard is a small class holding its arguments and clocks, and work for later is
 * data (`LaterOp`) run by `run`, so the whole stager is `save()`d as data and `load`ed back
 * (save-states), its visuals made again from that.
 */
export class Hazards {
  private readonly effects: Effect[] = [];
  /** Scratch vector the effects share. */
  readonly tmp = new Vector3();

  constructor(readonly host: HazardHost) {}

  /** Telegraphs that haven't landed yet. */
  telegraphs(): LiveTelegraph[] {
    const out: LiveTelegraph[] = [];
    for (const e of this.effects) if (e.tele && e.tele.remaining > 0) out.push(e.tele);
    return out;
  }

  get count(): number {
    return this.effects.length;
  }

  fixedUpdate(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      if (!e.step(dt)) {
        e.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  update(dt: number): void {
    for (const e of this.effects) e.render?.(dt);
  }

  dispose(): void {
    for (const e of this.effects) e.dispose();
    this.effects.length = 0;
  }

  // ------------------------------------------------------------- save-states

  /** Every staged hazard as data, in order (`HazardState`). */
  save(): HazardsState {
    return { effects: this.effects.map((e) => e.save()) };
  }

  /** The actors staged hazards point at (a save must be able to find each one again). */
  held(): ActorLike[] {
    const out = new Set<ActorLike>();
    for (const e of this.effects) for (const a of e.held()) out.add(a);
    return [...out];
  }

  /**
   * Back to `save()`'s hazards, replacing whatever is staged now (its decals and meshes go; the
   * world's own state is the load's, so ending darkness does not brighten the level). Actors come
   * through `actors` (monsters whose corpses are gone too: `LevelStage.loadUnits` keeps the ones
   * hazards hold). Call it after the units are back.
   */
  load(s: HazardsState, actors: ActorIndex): void {
    for (const e of this.effects) e.drop();
    this.effects.length = 0;
    const find: Finder = {
      actor: (ref) => {
        const a = actors(ref);
        if (!a) throw new Error(`Hazards.load: actor ${ref} is gone`);
        return a as Actor;
      },
      unit: (ref) => {
        const u = unitOf(actors(ref));
        if (!u) throw new Error(`Hazards.load: monster ${ref} is gone`);
        return u;
      },
    };
    for (const d of s.effects) this.effects.push(this.revive(d, find));
  }

  private revive(d: HazardState, find: Finder): Effect {
    switch (d.kind) {
      case 'later':
        return new Later(this, d.seconds, opLive(d.op, find), d.t);
      case 'strike':
        return Strike.load(this, d, find);
      case 'rings':
        return Rings.load(this, d, find);
      case 'zone':
        return Zone.load(this, d, find);
      case 'spiral':
        return Spiral.load(this, d, find);
      case 'pull':
        return Pull.load(this, d, find);
      case 'darkness':
        return Darkness.load(this, d);
      case 'beams':
        return Beams.load(this, d, find);
      case 'aura':
        return Aura.load(this, d, find);
    }
  }

  // ------------------------------------------------------------- events

  handle(unit: MonsterUnit, e: MonsterEvent): void {
    const src = unit.actor;
    switch (e.type) {
      case 'summon':
        return this.later(0.1, { op: 'adds', unit, count: e.count, archetype: e.archetype, scale: e.scale, at: e.at });
      case 'split':
        return this.host.spawnAdds(unit, { count: e.count, scale: e.scale, mode: 'split', at: e.at });
      case 'clone':
        return this.host.spawnAdds(unit, { count: e.count, mode: 'clone', at: e.at });
      case 'nova':
        return this.strike(src, e.at, e.radius, 0.45, asType(e.damage), 1.2, { ailment: e.ailment as AilmentType | undefined });
      case 'trail':
        return this.zone(src, e.at, 0.9, e.duration, asType(e.damage, 'fire'), 0.25);
      case 'strike':
        return this.strike(src, e.at, e.radius, e.delay, asType(e.damage, 'lightning'), 1.1);
      case 'pull':
        return this.pull(src, e.at, e.radius, e.force, 1.2, false);
      case 'aura':
        return e.on ? this.aura(src, e.radius, e.effect) : this.off(`aura:${src.id}`);
      case 'beam':
        return e.on ? this.beams(src, e.count, e.length, e.speed, Infinity, `beam:${src.id}`) : this.off(`beam:${src.id}`);
      case 'shield':
        if (e.on) this.host.ctx.particles.burst('swirl', src.position.clone().setY(1), { count: 16, colors: ['sky', 'white'] });
        return;
      case 'roar':
        this.host.shake(unit.rank === 'boss' ? 0.5 : 0.25, 0.4);
        this.host.ctx.audio.play('rl.roar', { pitch: unit.rank === 'boss' ? -4 : 2 });
        this.host.ctx.particles.burst('dust', e.at.clone().setY(0.2), { count: 18, scale: 2 });
        return;
      case 'phase':
        return;
      case 'heal':
        return void src.heal(e.amount);
      case 'hex':
        // a curse gem through combat (its hex circle, the curse limit, `curse.immune`)
        if (SKILLS.has(e.curse)) this.host.world.combat.cast(src, buildSkill(e.curse, [], src.stats), e.at);
        return;
      case 'hazard':
        return this.pattern(unit, e.id, e.at, e.data ?? {});
    }
  }

  /** A boss signature (BOSS_ATTACKS pattern) staged in the level. */
  private pattern(unit: MonsterUnit, id: string, _at: Vector3, d: Readonly<Record<string, number | string>>): void {
    const src = unit.actor;
    const delay = num(d.delay, 0.8);
    const type = asType(d.damage);
    const hero = this.host.heroActor();
    switch (id) {
      case 'slamWave':
        if (num(d.slow, 0) > 0) return this.later(delay, { op: 'rings', src, count: num(d.rings, 2), speed: num(d.speed, 5), gap: num(d.gap, 1.2), type, slow: num(d.slow, 0) });
        return this.later(delay, { op: 'rings', src, count: num(d.rings, 3), speed: num(d.speed, 6), gap: num(d.gap, 1.2), type, slow: 0 });
      case 'echo':
        return this.later(delay, { op: 'echo', src, delay: num(d.delay, 2) });
      case 'spiral':
        return this.later(delay, { op: 'spiral', src, arms: num(d.arms, 4), shots: num(d.shots, 20), turn: num(d.turn, 0.3), type });
      case 'gust':
        return this.later(delay, { op: 'gust', src, hero, force: num(d.force, 12), length: num(d.length, 12) });
      case 'pull':
        return this.later(delay, { op: 'pull', src, radius: num(d.radius, 10), force: num(d.force, 8), duration: num(d.duration, 2), collapse: num(d.collapse, 0) > 0 });
      case 'darkness':
        return this.later(delay, { op: 'darkness', duration: num(d.duration, 6) });
      case 'beam':
        return this.later(delay, { op: 'beams', src, count: num(d.count, 2), length: num(d.length, 10), speed: num(d.speed, 0.7), duration: num(d.duration, 5) });
      case 'nova': {
        const r = num(d.radius, 4);
        this.strike(src, src.position.clone(), r, delay, type, 1.4);
        // blood nova: every corpse nearby bursts too
        if (num(d.corpses, 0) > 0)
          for (const u of this.host.units()) if (!u.actor.alive && u.actor.position.distanceTo(src.position) < 14) this.strike(src, u.actor.position.clone(), 2, delay + 0.3, 'physical', 0.8);
        return;
      }
      case 'meteor':
        for (let i = 0; i < num(d.count, 4); i++) this.later(delay + i * num(d.interval, 0.45), { op: 'strikeNear', src, hero, spread: 1.2, radius: num(d.radius, 1.8), delay: 1.0, type, mult: 1.2 });
        return;
      case 'quake': {
        const n = Math.min(24, num(d.tiles, 12));
        const c = (hero ?? src).position.clone();
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + this.host.rng.range(-0.2, 0.2);
          const r = 1.5 + (i % 3) * 1.6;
          this.later(delay * 0.5 + (i % 3) * 0.35, { op: 'strike', src, at: new Vector3(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r), radius: 1.1, delay: num(d.delay, 1.2), type: 'physical', mult: 0.9 });
        }
        return;
      }
      case 'portal':
        return this.later(delay + 0.7, { op: 'portal', src, hero });
      case 'summon':
        return this.later(delay, { op: 'adds', unit, count: num(d.count, 3), archetype: typeof d.archetype === 'string' ? d.archetype : undefined, at: null });
      case 'hazard':
        return this.mechanicHazard(unit, String(d.hazard ?? ''), d, delay);
      case 'charge':
      case 'leap':
        return; // the skill itself moves the boss
    }
  }

  /** Arena hazards built on the level's mechanic. */
  private mechanicHazard(unit: MonsterUnit, kind: string, d: Readonly<Record<string, number | string>>, delay: number): void {
    const src = unit.actor;
    const hero = this.host.heroActor();
    const props = (k: string) => this.host.world.actors.actors.filter((a): a is PropActor => isProp(a) && (a as PropActor).name === k && a.position.distanceTo(src.position) < 22);
    switch (kind) {
      case 'braziers': {
        let i = 0;
        for (const b of props('brazier')) this.later(delay + num(d.delay, 0.6) * i++, { op: 'prop', prop: b, src, type: 'fire' });
        if (i === 0 && hero) this.later(delay, { op: 'rings', src, count: 2, speed: 6, gap: 1, type: 'fire', slow: 0 });
        return;
      }
      case 'pylons': {
        for (const p of props('pylon')) this.later(delay, { op: 'prop', prop: p, src, type: 'lightning' });
        for (let i = 0; i < num(d.arcs, 3); i++) this.later(delay + i * 0.5, { op: 'strikeNear', src, hero, spread: 1.5, radius: 1.6, delay: 0.9, type: 'lightning', mult: 1 });
        return;
      }
      case 'ice':
        return this.later(delay, { op: 'zone', src, at: null, on: hero ?? src, radius: Math.min(5, num(d.radius, 6) * 0.6), duration: num(d.duration, 8), type: 'cold', mult: 0.2, ailment: 'chill' });
      case 'thorns': {
        const lines = num(d.lines, 6);
        const length = num(d.length, 8);
        const c = src.position.clone();
        for (let l = 0; l < lines; l++) {
          const a = (l / lines) * Math.PI * 2;
          for (let r = 2; r <= length; r += 1.6) this.later(delay + r * 0.05, { op: 'zone', src, at: new Vector3(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r), on: src, radius: 0.75, duration: num(d.duration, 5), type: 'physical', mult: 0.3, ailment: 'bleed' });
        }
        return;
      }
      default:
        this.later(delay, { op: 'rings', src, count: 2, speed: 6, gap: 1.2, type: 'physical', slow: 0 });
    }
  }

  // ------------------------------------------------------------- primitives

  private off(key: string): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i]!.key !== key) continue;
      this.effects[i]!.dispose();
      this.effects.splice(i, 1);
    }
  }

  /** Run `op` after `seconds` of game time (`run` does it). */
  later(seconds: number, op: LaterOp): void {
    this.effects.push(new Later(this, seconds, op));
  }

  /** What a staged op does when its time comes. */
  run(o: LaterOp): void {
    switch (o.op) {
      case 'adds':
        return this.host.spawnAdds(o.unit, { count: o.count, archetype: o.archetype, scale: o.scale, mode: 'summon', at: o.at ?? o.unit.actor.position.clone() });
      case 'rings':
        return this.rings(o.src, o.src.position.clone(), o.count, o.speed, o.gap, o.type, o.slow);
      case 'echo': {
        const c = o.src.position.clone();
        this.rings(o.src, c, 2, 6, 1.2, 'physical', 0);
        this.strike(o.src, c, 3, o.delay, 'physical', 1.1);
        return;
      }
      case 'spiral':
        return this.spiral(o.src, o.arms, o.shots, o.turn, o.type);
      case 'gust':
        if (o.hero) this.gust(o.src, o.hero.position, o.force, o.length);
        return;
      case 'pull':
        return this.pull(o.src, o.src.position.clone(), o.radius, o.force, o.duration, o.collapse);
      case 'darkness':
        return this.darkness(o.duration);
      case 'beams':
        return this.beams(o.src, o.count, o.length, o.speed, o.duration, '');
      case 'strike':
        return this.strike(o.src, o.at, o.radius, o.delay, o.type, o.mult);
      case 'strikeNear':
        if (o.hero) this.strike(o.src, this.near(o.hero.position, o.spread), o.radius, o.delay, o.type, o.mult);
        return;
      case 'portal': {
        const { hero, src } = o;
        if (!hero || !src.alive) return;
        const back = new Vector3(Math.sin(hero.facing), 0, Math.cos(hero.facing)).multiplyScalar(-2.5).add(hero.position);
        if (!this.host.level.isWalkable(back.x, back.z)) return;
        this.host.ctx.particles.burst('blink', src.position.clone().setY(1), { count: 20 });
        src.mover.teleport(back.x, 0, back.z);
        src.position.copy(src.mover.position);
        this.host.ctx.particles.burst('blink', back.clone().setY(1), { count: 20 });
        return;
      }
      case 'prop':
        o.prop.takeHit({ source: o.src, tags: ['hazard', o.type], damage: { [o.type]: 1 }, crit: false });
        return;
      case 'zone':
        return this.zone(o.src, o.at ?? o.on.position.clone(), o.radius, o.duration, o.type, o.mult, o.ailment);
    }
  }

  /** A point within `spread` of `p` (the level's random stream). */
  near(p: Vector3, spread: number): Vector3 {
    const r = this.host.rng;
    return new Vector3(p.x + r.range(-spread, spread), 0, p.z + r.range(-spread, spread));
  }

  /** Hostile actors (not props) inside a circle, nearest first. */
  victims(src: Actor, center: Vector3, radius: number): Actor[] {
    return this.host.world.actors.query(center, radius, [], (x) => x.alive && !isProp(x) && src.hostileTo(x));
  }

  /** One hazard hit: the source's damage scaling (depth, rank, phase, difficulty) on the base. */
  hit(src: Actor, target: Actor, type: DamageType, mult: number, o: { from?: Vector3; knockback?: number; ailment?: AilmentType } = {}): void {
    const q = new StatQuery(src.stats);
    const scale = q.scale(['damage', `${type}.damage`], ['hazard', 'area', type]);
    const amount = H.damage * mult * scale * this.host.rng.range(0.85, 1.15);
    const ailment = o.ailment ?? AILMENT[type];
    target.takeHit({ source: src, skill: 'hazard', tags: ['hazard', 'area', type], damage: { [type]: amount }, crit: false, knockback: o.knockback ?? 3, from: o.from, ailments: ailment ? { [ailment]: 0.35 } : undefined, hitStop: 2 });
  }

  /** A telegraphed circle that lands after `delay`. */
  strike(src: Actor, at: Vector3, radius: number, delay: number, type: DamageType, mult: number, o: { ailment?: AilmentType } = {}): void {
    this.effects.push(new Strike(this, src, at, radius, delay, type, mult, o.ailment));
  }

  /** Shockwave rings rolling out from `center`; each ring hits each target once. */
  rings(src: Actor, center: Vector3, count: number, speed: number, gap: number, type: DamageType, slow: number): void {
    const e = new Rings(this, src, center, count, speed, gap, type, slow);
    this.host.ctx.particles.burst('impact', center.clone().setY(0.2), { scale: 2 });
    this.effects.push(e);
  }

  /** A damaging patch of ground (molten trails, ice, thorns). */
  zone(src: Actor, at: Vector3, radius: number, duration: number, type: DamageType, mult: number, ailment?: AilmentType): void {
    this.effects.push(new Zone(this, src, at, radius, duration, type, mult, ailment));
  }

  /** Projectiles fired in rotating arms from the source. */
  spiral(src: Actor, arms: number, shots: number, turn: number, type: DamageType): void {
    const per = Math.max(1, Math.round(shots / Math.max(1, arms)));
    this.effects.push(new Spiral(this, src, arms, per, turn, src.facing, buildSkill(singleBolt(type), [], src.stats)));
  }

  /** A cone of wind from the source toward `toward`: shoves and stings. */
  gust(src: Actor, toward: Vector3, force: number, length: number): void {
    const dir = new Vector3(toward.x - src.position.x, 0, toward.z - src.position.z).normalize();
    for (const v of this.victims(src, src.position, length)) {
      const to = this.tmp.subVectors(v.position, src.position).setY(0);
      const d = to.length();
      if (d > 0.01 && to.dot(dir) / d < Math.cos((35 * Math.PI) / 180)) continue;
      v.push(dir.clone().multiplyScalar(force));
      this.hit(src, v, 'physical', 0.35, { knockback: 0 });
    }
    for (let i = 1; i < length; i += 1.5) this.host.ctx.particles.burst('wind', new Vector3(src.position.x + dir.x * i, 0.8, src.position.z + dir.z * i), { count: 2 });
    this.host.ctx.audio.play('gust');
  }

  /** Everything hostile is dragged toward `center` for a while (optionally collapsing in a blast). */
  pull(src: Actor, center: Vector3, radius: number, force: number, duration: number, collapse: boolean): void {
    this.effects.push(new Pull(this, src, center, radius, force, duration, collapse));
  }

  /** The level goes dark for a while (lanterns gutter, the hero is `inDark`). */
  darkness(duration: number): void {
    const env = this.host.level.env;
    env.ambient *= DARK;
    env.sun *= DARK;
    this.effects.push(new Darkness(this, duration));
  }

  /** Rotating beams around a monster (elite Arcane Beams, boss Mirror Beams). */
  beams(src: Actor, count: number, length: number, speed: number, duration: number, key: string): void {
    this.effects.push(new Beams(this, src, count, length, speed, duration, key));
  }

  /** Elite auras: chill everything near it, or empower its allies. */
  aura(src: Actor, radius: number, effect: string): void {
    this.effects.push(new Aura(this, src, radius, effect));
  }
}
