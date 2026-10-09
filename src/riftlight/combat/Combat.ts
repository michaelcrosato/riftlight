import { type Camera, Group, type Object3D, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { more, type Mod } from '../core/mods';
import { Rng } from '../core/rng';
import type { Effect, GameEventBus, HitResult } from '../core/types';
import { Actor } from '../actors/Actor';
import type { ActorManager } from '../actors/ActorManager';
import { levelMods } from '../skills/build';
import type { ResolvedSkill } from '../skills/types';
import { CHARGE_TYPES, chargeChance } from './charges';
import { curseDuration, curseLimit, scaleCurse, type CurseOutcome } from './curses';
import { rollHit, type DamageSpec } from './damage';
import { DELIVERIES } from './deliveries';
import { skillTrap } from './deliveries/trap';
import { placeTotem } from './totems';
import type { CastContext, CastOptions, CombatEffect } from './deliveries/types';
import { LightService } from './lights';
import { placeholderMinion } from './minions';
import { DamageNumbers, type NumberHud } from './numbers';
import { registerCombatFx } from './sfx';
import { CameraShake } from '../../engine/shake';
import { StatQuery } from './stats';

/** Sounds: the engine's AudioManager (or anything with `play`). */
export interface AudioLike {
  play(name: string, options?: { pitch?: number; volume?: number }): boolean;
  register(name: string, def: never): void;
}
/** Particles: the engine's Particles. */
export interface ParticlesLike {
  burst(preset: string, at: Vector3, options?: { count?: number; direction?: readonly [number, number, number]; speed?: number; scale?: number; colors?: readonly PaletteColor[] }): number;
}

/** Level geometry between two points: the fraction (0..1) along from → to where a wall is hit, or null. */
export type WallQuery = (from: Vector3, to: Vector3) => number | null;

export interface SummonRequest {
  readonly genome: string;
  readonly owner: Actor;
  readonly at: Vector3;
  readonly skill: ResolvedSkill;
  /** Mods for the minion's sheet: the skill's mods with the 'minion' scope removed. */
  readonly mods: readonly Mod[];
  /** The minion's attack (from the summon gem's damage effect), with the 'minion' tag. */
  readonly attack: DamageSpec | null;
  readonly index: number;
  readonly combat: Combat;
}
/** Builds a minion actor (the monster system registers genomes; the default is a placeholder). */
export type SummonFactory = (req: SummonRequest) => Actor | null;

export interface CombatOptions {
  actors: ActorManager;
  /** Effects are added under a group in this scene (null: headless, no visuals). */
  scene?: Object3D | null;
  audio?: AudioLike | null;
  particles?: (ParticlesLike & { register?: unknown; presets?: unknown }) | null;
  rng?: Rng;
  wall?: WallQuery;
  summon?: SummonFactory;
  /** Which actor is the player (red damage numbers, shake when hit). */
  hero?: () => Actor | null;
}

export interface HitOptions {
  /** Multiplies the hit (combo finishers, ticks, splash). */
  scale?: number;
  /** Where the hit comes from (knockback direction). Default: the caster. */
  from?: Vector3;
  /** Multiplies knockback. */
  knockback?: number;
  /** Damage to use instead of the skill's (minions, explosions). */
  spec?: DamageSpec;
  /** Skip hit sounds/particles (ticks of a channel). */
  quiet?: boolean;
}

/**
 * The combat runtime: casts skills through their delivery (strike, slam, projectile, nova,
 * beam, dash, summon, aura, trap), resolves hits through the damage pipeline, and plays the
 * juice: hit-stop, knockback, flashes, damage numbers, screen shake, sounds, particles and
 * dynamic lights. One per level; the hero controller and monster brains call `cast`.
 *
 *   const combat = new Combat({ actors, scene: ctx.scene, audio: ctx.audio, particles: ctx.particles });
 *   combat.cast(hero.actor, buildSkill('fireball', ['gmp'], hero.actor.stats), aimPoint);
 *   // fixedUpdate: actors.fixedUpdate(dt); combat.fixedUpdate(dt);
 *   // update:      actors.update(dt, alpha); combat.update(dt); combat.shake.apply(ctx.camera, dt);
 *   //              hud.clear(); ...; combat.numbers.draw(ctx.hud, ctx.camera.camera);
 */
export class Combat {
  readonly actors: ActorManager;
  readonly events: GameEventBus;
  readonly root = new Group();
  readonly rng: Rng;
  readonly numbers = new DamageNumbers();
  readonly shake = new CameraShake();
  readonly lights: LightService;
  readonly effects: CombatEffect[] = [];
  readonly audio: AudioLike | null;
  readonly particles: ParticlesLike | null;
  readonly wall: WallQuery;
  summonFactory: SummonFactory;
  /** Fixed-step game time. */
  time = 0;
  /** Counters for tools and tests. */
  readonly stats = { casts: 0, hits: 0, kills: 0, damage: 0 };
  private readonly heroOf: () => Actor | null;
  private readonly off: (() => void)[] = [];
  private readonly queue: { at: number; run: () => void }[] = [];

  constructor(o: CombatOptions) {
    this.actors = o.actors;
    this.events = o.actors.events;
    this.rng = o.rng ?? new Rng('combat');
    this.audio = o.audio ?? null;
    this.particles = o.particles ?? null;
    this.wall = o.wall ?? (() => null);
    this.summonFactory = o.summon ?? placeholderMinion;
    this.heroOf = o.hero ?? (() => null);
    this.root.name = 'combat';
    o.scene?.add(this.root);
    this.lights = new LightService(this.events, o.scene ? this.root : null);
    registerCombatFx(this.audio as never, (this.particles as never) ?? null);
    this.off.push(
      this.events.on('hit', ({ target, result, hit }) => {
        const hero = this.heroOf();
        const isHero = target === hero;
        this.numbers.spawn(target.position, result, { hero: isHero, dot: hit.tags.includes('dot') });
        if (result.total > 0 && !hit.tags.includes('dot')) {
          this.stats.hits++;
          this.stats.damage += result.total;
          if (isHero) this.shake.add(0.18 + Math.min(0.3, result.total / Math.max(1, (target as Actor).maxLife ?? 100)));
        }
        if (result.blocked) this.play('block');
      }),
      this.events.on('death', ({ actor }) => {
        if (!(actor instanceof Actor) || actor.death !== 'ragdoll') return;
        this.burst('death', chest(actor.position, 0.6));
        this.play('die', { pitch: this.rng.range(-2, 2) });
      }),
      this.events.on('kill', () => void this.stats.kills++),
    );
    // a corpse that finishes its flicker leaves a puff (chained: the level may listen too)
    const previous = this.actors.onRemove;
    this.actors.onRemove = (a) => {
      previous?.(a);
      if (a.death === 'ragdoll' && a.deadFor >= 0) this.burst('smoke', a.body.position);
    };
  }

  // ------------------------------------------------------------------ casting

  /**
   * Use a skill now (at its release / hit frame): runs its delivery toward `aim` (a ground
   * point). Mana and cooldowns are the caller's job; channels pay their own cost per second.
   * Repeats (multistrike, spell echo) follow automatically. Returns the effect, if any.
   */
  cast(caster: Actor, skill: ResolvedSkill, aim: Vector3, opts: CastOptions = {}): CombatEffect | null {
    if (!caster.alive) return null;
    const impl = DELIVERIES[skill.delivery.kind];
    this.stats.casts++;
    this.events.emit('skill', { actor: caster, skill: skill.id });
    this.play(skill.def.look.sound?.cast, { pitch: opts.combo ? opts.combo * 2 : 0 });
    // a totem / trap support: plant or throw it; the totem or trap uses the skill itself later
    if (skill.placement && skill.inner) return this.place(caster, skill, aim, opts);
    // charges a skill gains or consumes on use (a consumed charge empowers this cast; repeats keep it)
    if (!opts.repeat) skill = this.castCharges(caster, skill);
    this.applyCastBuffs(caster, skill);
    const effect = impl(this.context(caster, skill, aim, opts));
    if (effect) this.effects.push(effect);
    if (skill.repeats > 1 && !skill.channel && !opts.repeat) {
      const gap = Math.max(0.08, Math.min(0.2, skill.castTime / skill.repeats));
      for (let i = 1; i < skill.repeats; i++) {
        this.later(gap * i, () => {
          if (!caster.alive || caster.stopped) return;
          // re-aim at whoever is closest in front (multistrike keeps hitting the pack)
          const near = this.actors.nearest(caster.position, 6, (a) => a.alive && caster.hostileTo(a));
          const again = near ? near.position.clone() : aim;
          this.cast(caster, skill, again, { ...opts, repeat: i, held: undefined });
        });
      }
    }
    return effect;
  }

  /** Plant a totem or throw a trap for a placement skill (see `ResolvedSkill.placement`). */
  private place(caster: Actor, skill: ResolvedSkill, aim: Vector3, opts: CastOptions): CombatEffect {
    const ctx = this.context(caster, skill, aim, opts);
    const inner = skill.inner!;
    const effect =
      skill.placement === 'totem'
        ? placeTotem(ctx)
        : skillTrap(ctx, (at, target) => {
            const proxy = proxyOf(caster, at);
            proxy.facing = Math.atan2(target.position.x - at.x, target.position.z - at.z);
            this.cast(proxy, inner, target.position.clone());
          });
    this.effects.push(effect);
    return effect;
  }

  /** Who holds the charges a caster earns: a trap's stand-in and a totem earn them for their owner. */
  chargeHolder(a: Actor): Actor {
    return a.owner && (a.tags.includes('proxy') || a.tags.includes('totem')) ? a.owner : a;
  }

  /** `charges` effects that act on use: gains, and consumption whose `perCharge` mods empower the cast. */
  private castCharges(caster: Actor, skill: ResolvedSkill): ResolvedSkill {
    let extra: Mod[] | null = null;
    const holder = this.chargeHolder(caster);
    for (const e of skill.effects) {
      if (e.kind !== 'charges' || (e.on ?? 'cast') !== 'cast') continue;
      if (e.chance !== undefined && !caster.rng.chance(e.chance)) continue;
      if (e.count > 0) for (const t of e.charge === 'all' ? CHARGE_TYPES : [e.charge]) holder.charges.gain(t, e.count);
      else if (e.count < 0) {
        const n = holder.charges.consume(e.charge, -e.count);
        if (n > 0 && e.perCharge) (extra ??= []).push(...levelMods(e.perCharge, n));
      }
    }
    return extra ? { ...skill, mods: [...skill.mods, ...extra] } : skill;
  }

  /** Charges from a landed hit: the skill's on-hit `charges` effects and `charge.onHit` / `onCrit` / `onStun`. */
  private hitCharges(caster: Actor, skill: ResolvedSkill, q: StatQuery, result: HitResult): void {
    const holder = this.chargeHolder(caster);
    for (const e of skill.effects) {
      if (e.kind !== 'charges' || e.on !== 'hit' || e.count <= 0) continue;
      if (e.chance !== undefined && !caster.rng.chance(e.chance)) continue;
      for (const t of e.charge === 'all' ? CHARGE_TYPES : [e.charge]) holder.charges.gain(t, e.count);
    }
    const stun = result.ailments.includes('stun');
    for (const t of CHARGE_TYPES) {
      let miss = 1 - chargeChance(q, t, 'onHit');
      if (result.crit) miss *= 1 - chargeChance(q, t, 'onCrit');
      if (stun) miss *= 1 - chargeChance(q, t, 'onStun');
      if (miss < 1 && caster.rng.chance(1 - miss)) holder.charges.gain(t);
    }
  }

  /**
   * Curse `target` with `skill`'s `curse` effect: its mods scaled by the caster's
   * `curse.effect`, for its duration × `curse.duration`, within the caster's `curseLimit`.
   * Returns what happened ('immune' for `curse.immune` targets), or null when it can't apply.
   */
  curse(caster: Actor, target: Actor, skill: ResolvedSkill): CurseOutcome | null {
    const e = skill.effects.find((x): x is Extract<Effect, { kind: 'curse' }> => x.kind === 'curse');
    if (!e || !target.alive || !caster.hostileTo(target)) return null;
    const q = new StatQuery(caster.stats, skill.mods);
    const source = this.chargeHolder(caster);
    const color = (e.color ?? skill.def.look.color) as PaletteColor;
    const outcome = target.curses.apply(
      { id: skill.def.id, name: skill.def.name, mods: scaleCurse(e.mods, q, skill.tags), duration: curseDuration(e.duration, skill.duration, q, skill.tags), source, color, limit: curseLimit(source.stats) },
      target.time,
    );
    this.events.emit('curse', { target, source, curse: skill.def.id, outcome });
    if (outcome === 'immune') this.burst('spark', chest(target.position, 1.4), { count: 6, colors: ['white', 'mist'] });
    return outcome;
  }

  private context(caster: Actor, skill: ResolvedSkill, aim: Vector3, opts: CastOptions): CastContext {
    const dir = new Vector3(aim.x - caster.position.x, 0, aim.z - caster.position.z);
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(caster.facing), 0, Math.cos(caster.facing));
    dir.normalize();
    return { combat: this, caster, skill, aim: aim.clone().setY(caster.position.y), dir, opts };
  }

  /** Buffs a skill gives at cast: `self` and `allies` (enemy debuffs go out with its hits). */
  private applyCastBuffs(caster: Actor, skill: ResolvedSkill): void {
    if (skill.delivery.kind === 'aura') return; // auras apply their own buff while active
    for (const e of skill.effects) {
      if (e.kind !== 'buff') continue;
      if (e.target === 'self') caster.addBuff(skill.id, e.mods, e.duration);
      else if (e.target === 'allies') {
        if (caster.stats.has('auras.selfOnly')) {
          caster.addBuff(skill.id, e.mods, e.duration); // keystone: only you
          continue;
        }
        for (const a of this.actors.query(caster.position, 8, [], (x) => x.alive && !caster.hostileTo(x))) a.addBuff(skill.id, e.mods, e.duration);
      }
    }
  }

  /** Enemy debuffs from a skill (war cry) on one target. */
  applyEnemyBuffs(target: Actor, skill: ResolvedSkill): void {
    for (const e of skill.effects as readonly Effect[]) if (e.kind === 'buff' && e.target === 'enemies' && target.alive) target.addBuff(`${skill.id}:debuff`, e.mods, e.duration);
  }

  /** Run `fn` after `seconds` of game time (fixed steps). */
  later(seconds: number, fn: () => void): void {
    this.queue.push({ at: this.time + seconds, run: fn });
  }

  // ------------------------------------------------------------------ hits

  /** One hit from `caster` with `skill` on `target`: rolls, mitigates, emits, juices. */
  hit(caster: Actor, target: Actor, skill: ResolvedSkill, o: HitOptions = {}): HitResult | null {
    const spec = o.spec ?? skill.damage;
    if (!spec || !target.alive || !caster.hostileTo(target)) return null;
    const q = new StatQuery(caster.stats, skill.mods);
    // keystone `cannotDealDamage.self`: only minions, totems and traps deal the damage
    if (!o.spec && !skill.tags.includes('trap') && !skill.tags.includes('totem') && q.has('cannotDealDamage.self', skill.tags)) return null;
    let scale = o.scale ?? 1;
    // keystone `pointBlank`: projectiles hit 30% harder up close, 30% softer at max range
    if (skill.delivery.kind === 'projectile' && q.has('pointBlank', skill.tags)) {
      const d = Math.hypot(target.position.x - caster.position.x, target.position.z - caster.position.z);
      scale *= 1.3 - 0.6 * Math.min(1, d / Math.max(1, skill.delivery.range));
    }
    let h = rollHit(q, spec, caster.rng, { source: caster, skill: skill.id, from: o.from ?? caster.position, scale });
    if (o.knockback !== undefined && h.knockback) h = { ...h, knockback: h.knockback * o.knockback };
    const result = target.takeHit(h);
    this.applyEnemyBuffs(target, skill);
    if (result.total > 0) {
      this.hitCharges(caster, skill, q, result);
      this.reflect(target, caster, result, spec);
    }
    // keystone `elementalOverload`: a crit grants 40% more elemental damage for 8 s
    if (result.crit && result.total > 0 && caster.stats.has('elementalOverload')) caster.addBuff('elementalOverload', [more('elemental.damage', 0.4)], 8);
    if (result.total > 0) {
      const lifeLeech = q.flat('leech.life', spec.tags);
      const manaLeech = q.flat('leech.mana', spec.tags);
      if (lifeLeech > 0 || manaLeech > 0) caster.leech(result.total * lifeLeech, result.total * manaLeech);
      // melee crunch; a killing blow holds two frames longer (the kill reads)
      if (h.hitStop && spec.tags.includes('melee')) caster.hitStop = Math.max(caster.hitStop, h.hitStop + (target.alive ? 0 : 2));
      if (!o.quiet) {
        const look = skill.def.look;
        this.play(result.crit ? 'crit' : (look.sound?.hit ?? 'hit'), { pitch: this.rng.range(-1.5, 1.5) });
        const at = chest(target.position, 1);
        this.burst(look.burst ?? 'spark', at, { count: result.crit ? 14 : undefined });
        if ((result.byType.physical ?? 0) > 0 && spec.tags.includes('attack')) this.burst('blood', at);
        // the element that dealt the most also shows, when the skill's own burst doesn't say it
        // (a sword with added fire throws embers, a frost-converted cleave throws ice)
        const el = elementOf(result);
        if (el && TYPE_BURST[el] !== look.burst) this.burst(TYPE_BURST[el], at, { count: result.crit ? 8 : 4 });
        if (caster === this.heroOf() && look.shake) this.shake.add(look.shake * (result.crit ? 1.6 : 1) * 0.5);
      }
    }
    return result;
  }

  /**
   * Thorns: a melee hit on an actor with `thorns.reflect` (gear, Thornmother's Embrace) hurts
   * the attacker back with that share of the damage taken, as physical (not reflected again).
   */
  private reflect(target: Actor, attacker: Actor, result: HitResult, spec: DamageSpec): void {
    if (!spec.tags.includes('melee') || !attacker.alive || attacker === target) return;
    const amount = result.total * Math.max(0, target.stats.get('thorns.reflect'));
    if (amount <= 0) return;
    attacker.takeHit({ source: target, skill: 'thorns', tags: ['thorns', 'physical'], damage: { physical: amount }, crit: false });
  }

  /** Hit every enemy of `caster` within `radius` of `center` once (explosions, novas, slams). */
  area(caster: Actor, skill: ResolvedSkill, center: Vector3, radius: number, o: HitOptions & { exclude?: Set<number> } = {}): Actor[] {
    const hit: Actor[] = [];
    for (const a of this.actors.query(center, radius, [], (x) => x.alive && caster.hostileTo(x))) {
      if (o.exclude?.has(a.id)) continue;
      if (this.wall(center, a.position) !== null) continue; // no hits through walls
      if (this.hit(caster, a, skill, { ...o, from: o.from ?? center })) hit.push(a);
    }
    return hit;
  }

  // ------------------------------------------------------------------ juice helpers

  play(sound: string | undefined, options?: { pitch?: number; volume?: number }): void {
    if (sound) this.audio?.play(sound, options);
  }

  burst(preset: string | undefined, at: Vector3, options?: Parameters<ParticlesLike['burst']>[2]): void {
    if (preset) this.particles?.burst(preset, at, options);
  }

  /** Ask for a dynamic light (the level's pool, or a fallback PointLight). */
  light(color: PaletteColor | number, intensity: number, radius: number, position: () => Vector3, duration: number, alive?: () => boolean): void {
    const hex = typeof color === 'number' ? color : PALETTE[color];
    this.lights.request({ color: hex, intensity, radius, position, duration, alive });
  }

  // ------------------------------------------------------------------ loop

  /** After `actors.fixedUpdate`: deliveries, projectiles, zones, delayed repeats. */
  fixedUpdate(dt: number): void {
    this.time += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]!;
      if (this.time >= q.at) {
        this.queue.splice(i, 1);
        q.run();
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      if (!e.step(dt)) {
        e.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  /** Per rendered frame: effect visuals, lights, damage numbers (shake is applied by the game). */
  update(dt: number): void {
    for (const e of this.effects) e.render?.(dt);
    this.lights.update(dt);
    this.numbers.update(dt);
  }

  /** Damage numbers on the pixel HUD (after the game's own `hud.clear()`). */
  drawNumbers(hud: NumberHud, camera: Camera): void {
    this.numbers.draw(hud, camera);
  }

  /** The effects of one kind (tests, inspectors). */
  active(kind?: string): CombatEffect[] {
    return kind ? this.effects.filter((e) => e.kind === kind) : this.effects;
  }

  /** End a caster's effects of a skill (channel released, aura toggled off). */
  stop(caster: Actor, skillId: string): number {
    let n = 0;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      if (e.caster === caster && e.skill === skillId) {
        e.dispose();
        this.effects.splice(i, 1);
        n++;
      }
    }
    return n;
  }

  dispose(): void {
    for (const e of this.effects) e.dispose();
    this.effects.length = 0;
    this.queue.length = 0;
    this.lights.clear();
    this.numbers.clear();
    for (const off of this.off) off();
    this.off.length = 0;
    this.root.removeFromParent();
  }
}

/**
 * A stand-in caster at `at` that shares `owner`'s live stat sheet (a sprung trap fires the
 * linked skill from where it lies). Not added to the world: it only casts. Its kills count for
 * its owner and the charges it earns go to its owner (`Combat.chargeHolder`).
 */
export function proxyOf(owner: Actor, at: Vector3): Actor {
  const p = new Actor({ faction: owner.faction, name: owner.name, sheet: owner.stats, at: [at.x, at.y, at.z], tags: ['proxy'], level: owner.level, radius: 0.2, seed: `proxy:${owner.id}:${at.x.toFixed(2)}:${at.z.toFixed(2)}` });
  p.owner = owner;
  return p;
}

/** The burst each element throws on a hit (`combat/sfx.ts` presets). */
const TYPE_BURST: Readonly<Record<'fire' | 'cold' | 'lightning' | 'chaos', string>> = { fire: 'fire', cold: 'frost', lightning: 'zap', chaos: 'toxic' };

/** The element that dealt most of a hit, if any dealt at least a quarter of it. */
function elementOf(r: HitResult): 'fire' | 'cold' | 'lightning' | 'chaos' | null {
  let best: 'fire' | 'cold' | 'lightning' | 'chaos' | null = null;
  let v = r.total * 0.25;
  for (const t of ['fire', 'cold', 'lightning', 'chaos'] as const) {
    const d = r.byType[t] ?? 0;
    if (d > v) {
      v = d;
      best = t;
    }
  }
  return best;
}

/** A point at chest height above feet. */
export function chest(feet: Vector3, h = 1): Vector3 {
  return new Vector3(feet.x, feet.y + h, feet.z);
}
