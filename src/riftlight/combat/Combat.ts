import { type Camera, Group, type Object3D, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { more, type Mod } from '../core/mods';
import { Rng } from '../core/rng';
import { type ActorIndex, type ActorRef, refOf, type Vec } from '../core/saved';
import type { ActorLike, Effect, Faction, GameEventBus, HitResult } from '../core/types';
import { Actor, type ActorState, actorIds, setActorIds } from '../actors/Actor';
import type { ActorManager } from '../actors/ActorManager';
import { GridMover, type GridMoverState } from '../actors/movers';
import { levelMods } from '../skills/build';
import { loadSkill, type SavedSkill, saveSkill } from '../skills/saved';
import type { ResolvedSkill } from '../skills/types';
import { CHARGE_TYPES, chargeChance } from './charges';
import { curseDuration, curseLimit, scaleCurse, type CurseOutcome } from './curses';
import { rollHit, type DamageSpec } from './damage';
import { DELIVERIES, RESTORE } from './deliveries';
import { skillTrap } from './deliveries/trap';
import { placeTotem, totemActor } from './totems';
import { type CastContext, type CastOptions, type CastWiring, type CombatEffect, type EffectState, type SavedCastOptions, saveCastOptions, v3 } from './deliveries/types';
import { LightService } from './lights';
import { minionMods, placeholderMinion } from './minions';
import { DamageNumbers, type DamageNumbersState, type NumberHud } from './numbers';
import { registerCombatFx } from './sfx';
import { CameraShake, type ShakeState } from '../../engine/shake';
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
/**
 * Builds a minion actor (the monster system registers genomes; the default is a placeholder).
 * A restore calls it again with the request it got (`Combat.make`) and the actor id set, so it
 * must build exactly one actor; its brain keeps its state with `save()` / `load(s)`.
 */
export type SummonFactory = (req: SummonRequest) => Actor | null;

/** An actor combat made (a minion, a totem), as the arguments that make it again. */
export type MadeArgs =
  | { readonly kind: 'minion'; readonly genome: string; readonly owner: ActorRef; readonly at: Vec; readonly skill: SavedSkill; readonly index: number; readonly time: number }
  | { readonly kind: 'totem'; readonly owner: ActorRef; readonly skill: SavedSkill; readonly at: Vec; readonly time: number };

/** A brain whose state a save-state keeps (minions', totems'). */
interface SavedBrain {
  save(): unknown;
  load(s: unknown): void;
}

/**
 * Combat's own actors as data (save-states), in the order they were made (by id): the minions
 * and totems in the world (how to make them again, then their state), the trap stand-ins a
 * running effect or a lingering ailment still points at, and "ghosts": actors gone from the
 * world that something combat keeps still points at (a projectile whose caster died and
 * crumbled, a bleed from a minion that is gone), made again bare so those references hold.
 */
export type MadeActorState =
  | (MadeArgs & { readonly id: number; readonly actor: ActorState; readonly mover: GridMoverState; readonly brain: unknown })
  | { readonly kind: 'proxy'; readonly id: number; readonly owner: ActorRef; readonly at: Vec; readonly facing: number; readonly life: number; readonly hitStop: number; readonly deadFor: number; readonly rng: number; readonly counters: Actor['counters'] }
  | {
      readonly kind: 'ghost';
      readonly id: number;
      readonly faction: Faction;
      readonly name: string;
      readonly radius: number;
      readonly order: number;
      readonly tags: readonly string[];
      readonly death: 'ragdoll' | 'anim';
      readonly actor: ActorState;
      readonly mover: GridMoverState | null;
    };

/** A repeat (multistrike, spell echo) waiting for its moment, as data. */
interface QueuedState {
  readonly at: number;
  readonly op: 'repeat';
  readonly caster: ActorRef;
  readonly skill: SavedSkill;
  readonly aim: Vec;
  readonly opts: SavedCastOptions;
}

/** A short light at a fixed point (an explosion, a blink), kept so a restore lights it again. */
interface Flash {
  readonly color: PaletteColor | number;
  readonly intensity: number;
  readonly radius: number;
  readonly at: Vector3;
  readonly until: number;
}

/**
 * Combat as data (`Combat.save`): the clock, counters and random stream, the shake and the
 * numbers on screen, its own actors, every running effect in order, the queued repeats in
 * order and the flashes still lit.
 */
export interface CombatState {
  readonly time: number;
  readonly stats: Combat['stats'];
  readonly rng: number;
  readonly shake: ShakeState;
  readonly numbers: DamageNumbersState;
  readonly actors: readonly MadeActorState[];
  readonly effects: readonly EffectState[];
  readonly queue: readonly QueuedState[];
  readonly flashes: readonly (Omit<Flash, 'at'> & { at: Vec })[];
}

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
  /** Repeats (multistrike, spell echo) waiting for their moment: data, run by `fixedUpdate`. */
  private readonly queue: { at: number; op: 'repeat'; caster: Actor; skill: ResolvedSkill; aim: Vector3; opts: CastOptions }[] = [];
  /** Minions and totems combat made, while they are in the world, with what makes them again. */
  private readonly made = new Map<Actor, MadeArgs>();
  /** Trap stand-ins (not in the world) with their owner and spot. */
  private standIns: { actor: Actor; owner: Actor; at: Vector3 }[] = [];
  /** Actors gone from the world that a restore made again bare, because combat still points at them. */
  private readonly ghosts = new Map<number, Actor>();
  /** Short lights at fixed points still lit. */
  private flashes: Flash[] = [];
  /** How each caster's cast closures are made again (`wire`). */
  private readonly wirings = new Map<Actor, CastWiring>();
  /** The state `make` made the actors of (`load` makes them first when it was not called). */
  private madeFor: CombatState | null = null;

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
      this.made.delete(a);
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
      for (let i = 1; i < skill.repeats; i++) this.queue.push({ at: this.time + gap * i, op: 'repeat', caster, skill, aim: aim.clone(), opts: { ...opts, repeat: i, held: undefined } });
    }
    return effect;
  }

  /** A queued repeat comes due: cast again, re-aimed at whoever is closest in front (multistrike keeps hitting the pack). */
  private run(q: Combat['queue'][number]): void {
    const caster = q.caster;
    if (!caster.alive || caster.stopped) return;
    const near = this.actors.nearest(caster.position, 6, (a) => a.alive && caster.hostileTo(a));
    this.cast(caster, q.skill, near ? near.position.clone() : q.aim, q.opts);
  }

  /** Plant a totem or throw a trap for a placement skill (see `ResolvedSkill.placement`). */
  private place(caster: Actor, skill: ResolvedSkill, aim: Vector3, opts: CastOptions): CombatEffect {
    const ctx = this.context(caster, skill, aim, opts);
    const effect = skill.placement === 'totem' ? placeTotem(ctx) : skillTrap(ctx);
    this.effects.push(effect);
    return effect;
  }

  /**
   * A trap thrown by the Trap support goes off: a stand-in caster at `at` with its owner's live
   * sheet (`proxyOf`) casts the skill it carries at whoever set it off.
   */
  spring(owner: Actor, skill: ResolvedSkill, at: Vector3, target: Actor): void {
    const proxy = proxyOf(owner, at);
    proxy.facing = Math.atan2(target.position.x - at.x, target.position.z - at.z);
    this.prune();
    this.standIns.push({ actor: proxy, owner, at: at.clone() });
    this.cast(proxy, skill, target.position.clone());
  }

  /** A minion or totem combat made joins its list (with what makes it again on a restore). */
  adopt(actor: Actor, args: MadeArgs): void {
    this.made.set(actor, args);
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

  /**
   * Ask for a dynamic light (the level's pool, or a fallback PointLight). Its closures are not
   * kept by a save-state: an effect that asks for one asks again when it is restored.
   */
  light(color: PaletteColor | number, intensity: number, radius: number, position: () => Vector3, duration: number, alive?: () => boolean): void {
    const hex = typeof color === 'number' ? color : PALETTE[color];
    this.lights.request({ color: hex, intensity, radius, position, duration, alive });
  }

  /** A short light at a fixed point for `duration` seconds (explosions, blinks); a restore lights it again for what is left. */
  flash(color: PaletteColor | number, intensity: number, radius: number, at: Vector3, duration: number): void {
    const f: Flash = { color, intensity, radius, at: at.clone(), until: this.time + duration };
    this.flashes.push(f);
    this.light(color, intensity, radius, () => f.at, duration);
  }

  // ------------------------------------------------------------------ loop

  /** After `actors.fixedUpdate`: deliveries, projectiles, zones, delayed repeats. */
  fixedUpdate(dt: number): void {
    this.time += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]!;
      if (this.time >= q.at) {
        this.queue.splice(i, 1);
        this.run(q);
      }
    }
    if (this.flashes.length) this.flashes = this.flashes.filter((f) => f.until > this.time);
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
    this.made.clear();
    this.standIns = [];
    this.ghosts.clear();
    this.flashes = [];
    for (const off of this.off) off();
    this.off.length = 0;
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------------ save-states

  /**
   * Make `caster`'s cast closures again from data on a restore (`held`, `aimNow`: wiring, not
   * state). The hero controller registers its own; a cast that had them and whose caster has
   * none can't be restored (refused, saying so).
   */
  wire(caster: Actor, wiring: CastWiring): void {
    this.wirings.set(caster, wiring);
  }

  /**
   * An actor by id: in the world, or one of combat's own outside it (trap stand-ins, ghosts). A
   * ghost comes first: a restore makes one for an actor that was gone at the saved moment, while
   * the rebuilt stage may still hold its namesake until the world loads.
   */
  find(id: ActorRef): Actor | null {
    if (id === null) return null;
    return this.ghosts.get(id) ?? this.standIns.find((p) => p.actor.id === id)?.actor ?? this.actors.get(id) ?? null;
  }

  /** `find` as an `ActorIndex`: what a restore loads every actor's references through. */
  index(): ActorIndex {
    return (id) => this.find(id);
  }

  /** The ids of those in `list` that are in the world (what an effect's lists keep: the rest is dead and stays so). */
  known(list: readonly Actor[]): number[] {
    return list.filter((a) => this.actors.actors.includes(a)).map((a) => a.id);
  }

  /**
   * Every actor what combat keeps points at, and what those point at in turn: casters of effects
   * and queued repeats, owners, and the sources of ailments and curses on the actors in the world.
   */
  private refs(): Set<Actor> {
    const out = new Set<Actor>();
    const outside = this.outsideRefs.flatMap((f) => [...f()]);
    const todo: Actor[] = [];
    const add = (a: ActorLike | null | undefined) => {
      if (a instanceof Actor && !out.has(a)) {
        out.add(a);
        todo.push(a);
      }
    };
    const follow = (a: Actor) => {
      add(a.owner);
      for (const x of a.ailments) add(x.source);
      for (const c of a.curses.list) add(c.source);
    };
    for (const e of this.effects) add(e.caster);
    for (const q of this.queue) add(q.caster);
    for (const a of outside) add(a);
    for (const a of this.actors.actors) follow(a);
    for (let a = todo.pop(); a; a = todo.pop()) follow(a);
    return out;
  }

  /** Who else points at actors in this world (a monster at its target): `holdRefs`. */
  private readonly outsideRefs: (() => Iterable<ActorLike | null | undefined>)[] = [];

  /**
   * Actors something outside combat points at (a monster's target, an attack's): kept like an
   * effect's caster, so one that has left the world comes back as a ghost and the pointer holds.
   */
  holdRefs(refs: () => Iterable<ActorLike | null | undefined>): void {
    this.outsideRefs.push(refs);
  }

  /** Will `save()` keep actor `id` (in the world, a stand-in, a ghost, or gone and pointed at: made a ghost)? */
  keeps(id: ActorRef): boolean {
    if (id === null) return true;
    return this.find(id) !== null || [...this.refs()].some((a) => a.id === id);
  }

  /** Forget the stand-ins and ghosts nothing points at any more. */
  private prune(): void {
    const refs = this.refs();
    this.standIns = this.standIns.filter((p) => refs.has(p.actor));
    for (const [id, g] of this.ghosts) if (!refs.has(g)) this.ghosts.delete(id);
  }

  /**
   * Combat as data (save-states, `CombatState`): plain values, numbers as they are
   * (`engine.snapshot` encodes Infinity and -0). Refuses, saying why, what it can't make again:
   * a cast held by a closure with no `hold`, a minion whose brain or mover keeps no state.
   */
  save(): CombatState {
    this.prune();
    const inWorld = new Set(this.actors.actors);
    const actors: MadeActorState[] = [];
    for (const a of this.actors.actors) {
      const args = this.made.get(a);
      if (!args) continue;
      const brain = a.brain as Partial<SavedBrain> | null;
      if (!brain?.save) throw new Error(`Combat.save: ${args.kind} ${a.id} (${a.name}) has a brain that keeps no state`);
      if (!(a.mover instanceof GridMover)) throw new Error(`Combat.save: ${args.kind} ${a.id} (${a.name}) has a mover that keeps no state`);
      actors.push({ ...args, id: a.id, actor: a.save(), mover: a.mover.save(), brain: brain.save() });
    }
    const standIns = new Set(this.standIns.map((p) => p.actor));
    for (const p of this.standIns) {
      const a = p.actor;
      actors.push({ kind: 'proxy', id: a.id, owner: refOf(p.owner), at: p.at.toArray(), facing: a.facing, life: a.life, hitStop: a.hitStop, deadFor: a.deadFor, rng: a.rng.state, counters: { ...a.counters } });
    }
    for (const a of this.refs()) {
      if (inWorld.has(a) || standIns.has(a)) continue;
      actors.push({ kind: 'ghost', id: a.id, faction: a.faction, name: a.name, radius: a.radius, order: a.order, tags: [...a.tags], death: a.death, actor: a.save(), mover: a.mover instanceof GridMover ? a.mover.save() : null });
    }
    actors.sort((x, y) => x.id - y.id);
    return {
      time: this.time,
      stats: { ...this.stats },
      rng: this.rng.state,
      shake: this.shake.state(),
      numbers: this.numbers.save(),
      actors,
      effects: this.effects.map((e) => e.save()),
      queue: this.queue.map((q) => ({ at: q.at, op: q.op, caster: refOf(q.caster), skill: saveSkill(q.skill), aim: q.aim.toArray(), opts: saveCastOptions(q.opts) })),
      flashes: this.flashes.filter((f) => f.until > this.time).map((f) => ({ ...f, at: f.at.toArray() })),
    };
  }

  /**
   * First half of a restore: make combat's own actors of `s` again, each with its saved id
   * (`setActorIds(id)` right before it is built; the counter is put back as it was after),
   * minions and totems added to the world, once the stage has rebuilt its own (owners are found
   * through `actors`, then among those made here). What combat made before goes quietly. Call
   * it before building the `ActorIndex` the other actors load through (`index()` covers these);
   * `load` calls it itself when it was not (again for the same state object: nothing).
   */
  make(s: CombatState, actors: ActorIndex = () => null): void {
    if (this.madeFor === s) return;
    for (const a of [...this.made.keys()]) {
      const i = this.actors.actors.indexOf(a);
      if (i >= 0) this.actors.actors.splice(i, 1);
      a.dispose();
    }
    this.made.clear();
    this.standIns = [];
    this.ghosts.clear();
    const owner = (id: ActorRef, what: string): Actor => {
      const o = this.find(id) ?? actors(id);
      if (!(o instanceof Actor)) throw new Error(`Combat.make: the owner (${id}) of ${what} is not here (the stage makes its own actors first)`);
      return o;
    };
    const next = actorIds();
    try {
      for (const m of s.actors) this.remake(m, owner);
    } finally {
      setActorIds(next);
    }
    this.madeFor = s;
  }

  /** One of combat's own actors made again with its id. */
  private remake(m: MadeActorState, owner: (id: ActorRef, what: string) => Actor): void {
    setActorIds(m.id);
    let a: Actor | null;
    if (m.kind === 'minion') {
      const skill = loadSkill(m.skill);
      const attack: DamageSpec | null = skill.damage ? { ...skill.damage, tags: [...skill.damage.tags, 'minion'] } : null;
      a = this.summonFactory({ genome: m.genome, owner: owner(m.owner, `minion ${m.id}`), at: v3(m.at), skill, mods: minionMods(skill.mods), attack, index: m.index, combat: this });
    } else if (m.kind === 'totem') a = totemActor(this, owner(m.owner, `totem ${m.id}`), loadSkill(m.skill), v3(m.at), m.time);
    else if (m.kind === 'proxy') a = proxyOf(owner(m.owner, `trap stand-in ${m.id}`), v3(m.at));
    else a = new Actor({ faction: m.faction, name: m.name, radius: m.radius, order: m.order, tags: m.tags, death: m.death });
    if (!a || a.id !== m.id) throw new Error(`Combat.make: ${m.kind} ${m.id} came back as ${a ? `actor ${a.id}` : 'nothing'} (a summon factory must build exactly one actor)`);
    if (m.kind === 'minion' || m.kind === 'totem') {
      this.made.set(a, m.kind === 'minion' ? { kind: m.kind, genome: m.genome, owner: m.owner, at: m.at, skill: m.skill, index: m.index, time: m.time } : { kind: m.kind, owner: m.owner, skill: m.skill, at: m.at, time: m.time });
      this.actors.add(a);
    } else if (m.kind === 'proxy') this.standIns.push({ actor: a, owner: a.owner!, at: v3(m.at) });
    else this.ghosts.set(a.id, a);
  }

  /**
   * Second half of a restore, after every other actor loaded (an actor's load drops its motion,
   * which the effect that started it links again here). What runs now goes quietly (no hits, no
   * sounds, nothing given back); then combat's own actors' states, every effect in order (made
   * again by `RESTORE`: visuals, lights, motions; cast closures through `wire`), the queue, the
   * flashes, the clock, counters, random stream, shake and numbers. The same state loaded into
   * a fresh combat or into this one mid-fight comes out the same.
   */
  load(s: CombatState, actors: ActorIndex = () => null): void {
    this.make(s, actors);
    this.madeFor = null;
    for (const e of this.effects) e.drop();
    this.effects.length = 0;
    this.queue.length = 0;
    this.lights.clear();
    this.flashes = [];
    const index: ActorIndex = (id) => this.find(id) ?? actors(id);
    const actor = (id: ActorRef, what: string): Actor => {
      const a = index(id);
      if (!(a instanceof Actor)) throw new Error(`Combat.load: ${what}: actor ${id} is not here`);
      return a;
    };
    this.time = s.time;
    Object.assign(this.stats, s.stats);
    this.rng.state = s.rng;
    this.shake.setState(s.shake);
    this.numbers.load(s.numbers);
    for (const m of s.actors) {
      const a = actor(m.id, m.kind);
      if (m.kind === 'proxy') {
        a.facing = m.facing;
        a.life = m.life;
        a.hitStop = m.hitStop;
        a.deadFor = m.deadFor;
        a.rng.state = m.rng;
        Object.assign(a.counters, m.counters);
        continue;
      }
      a.load(m.actor, index);
      if (m.mover) (a.mover as GridMover).load(m.mover);
      if (m.kind !== 'ghost') (a.brain as unknown as SavedBrain).load(m.brain);
    }
    for (const e of s.effects) {
      const restore = RESTORE[e.kind];
      if (!restore) throw new Error(`Combat.load: no restore for a "${e.kind}" effect`);
      const caster = actor(e.cast.caster, `the caster of a ${e.kind}`);
      const c: CastContext = { combat: this, caster, skill: loadSkill(e.cast.skill), aim: v3(e.cast.aim), dir: v3(e.cast.dir), opts: this.castOptions(caster, e.cast.opts) };
      this.effects.push(restore(c, e));
    }
    for (const q of s.queue) {
      const caster = actor(q.caster, 'a queued repeat');
      this.queue.push({ at: q.at, op: q.op, caster, skill: loadSkill(q.skill), aim: v3(q.aim), opts: this.castOptions(caster, q.opts) });
    }
    for (const f of s.flashes) this.flash(f.color, f.intensity, f.radius, v3(f.at), f.until - this.time);
  }

  /** Cast options from data: their closures made again by the caster's wiring. */
  private castOptions(caster: Actor, o: SavedCastOptions): CastOptions {
    const { hold, aimNow, ...rest } = o;
    if (hold === undefined && !aimNow) return { ...rest };
    const wiring = this.wirings.get(caster);
    if (!wiring) throw new Error(`Combat.load: a cast of actor ${caster.id} (${caster.name}) had closures, and nothing wires them again (Combat.wire)`);
    const w = wiring({ hold, aimNow: !!aimNow });
    return { ...rest, ...(hold !== undefined ? { held: w.held, hold } : {}), ...(aimNow ? { aimNow: w.aimNow } : {}) };
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
