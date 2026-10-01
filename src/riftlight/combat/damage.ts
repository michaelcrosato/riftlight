/**
 * The hit pipeline, as pure functions (unit-tested in damage.test.ts):
 *
 *   rollHit   attacker side: base damage (skill effect + weapon) → added flat damage →
 *             conversion → increased/more by tags → crit → ailment chances, knockback,
 *             accuracy, penetration. Gives a `Hit`.
 *   mitigate  defender side: evasion (attacks) → block → armour (physical, diminishing) →
 *             resistances (capped, penetration) → damage taken (shock) → energy shield →
 *             life → culling → ailments. Gives a `HitResult` plus what to apply.
 *   expected  the same maths as expected values, for the `npm run combat` DPS tool.
 *
 * Stats (all strings; see COMBAT_STATS for the full list with descriptions):
 *   attacker  damage, <type>.damage, elemental.damage   (inc/more, scoped by tags)
 *             added.<type>.min/max                       (flat, × damage effectiveness)
 *             weapon.<type>.min/max, weapon.crit          (attacks)
 *             convert.<from>.<to>                         (fraction, along physical → lightning → cold → fire → chaos)
 *             crit.chance (on the base crit), crit.multiplier (flat, base 1.5)
 *             accuracy, pen.<type>, <ailment>.chance, ailment.effect, ailment.duration,
 *             knockback, cull
 *   defender  armour, evasion, block.chance, spell.block, res.<type>, res.max.<type>,
 *             damage.taken, avoid.<ailment>, stun.threshold
 *
 * Tags: a hit's tags are the skill's effective tags plus, per damage portion, every damage
 * type it has been (converted physical → fire counts as both) and 'elemental' for fire,
 * cold and lightning. So `inc('damage', 0.3, ['fire'])` scales converted damage too.
 */
import type { StatSheet } from '../core/mods';
import type { Rng } from '../core/rng';
import { DAMAGE_TYPES, type ActorLike, type AilmentType, type DamageType, type Hit, type HitResult } from '../core/types';
import type { Vector3 } from 'three/webgpu';
import { AILMENTS, ailmentDamage, type AilmentDef } from './ailments';
import type { StatQuery } from './stats';

export type Range = readonly [number, number];
export type Damage = Partial<Record<DamageType, number>>;

/** The damage part of a resolved skill (built by skills/build.ts, pure data). */
export interface DamageSpec {
  /** Effective tags of the skill ('attack' | 'spell', 'melee', 'projectile', 'fire', ...). */
  readonly tags: readonly string[];
  /** Base damage ranges of the skill at its gem level. */
  readonly base: Partial<Record<DamageType, Range>>;
  /**
   * Attacks: multiplier on the whole base attack damage (weapon + skill + added).
   * Spells: multiplier on added flat damage only (PoE's "damage effectiveness").
   */
  readonly effectiveness: number;
  /** Base crit chance for spells (attacks use `weapon.crit`). */
  readonly crit: number;
  /** Base ailment chances from the skill's effects. */
  readonly ailments: Partial<Record<AilmentType, number>>;
  /** Knockback impulse (m/s) before stats. */
  readonly knockback: number;
}

export const ELEMENTAL: readonly DamageType[] = ['fire', 'cold', 'lightning'];
/** Conversion only goes forward along this order (PoE's chain), so it can't loop. */
export const CONVERSION_ORDER: readonly DamageType[] = ['physical', 'lightning', 'cold', 'fire', 'chaos'];
/** Attacks with no weapon and no skill damage punch for this. */
export const UNARMED: Range = [2, 6];
export const BASE_CRIT_MULTIPLIER = 1.5;
export const DEFAULT_ATTACK_CRIT = 0.05;
export const DEFAULT_RES_MAX = 0.75;
export const MIN_RES = -2;
export const ARMOUR_CAP = 0.9;
export const BLOCK_CAP = 0.75;

const isAttack = (tags: readonly string[]) => tags.includes('attack');

/** Damage ranges before conversion and scaling. */
export function baseRanges(q: StatQuery, spec: DamageSpec): Partial<Record<DamageType, Range>> {
  const out: Partial<Record<DamageType, Range>> = {};
  const attack = isAttack(spec.tags);
  let weaponAny = false;
  if (attack) for (const t of DAMAGE_TYPES) if (q.flat(`weapon.${t}.max`) > 0) weaponAny = true;
  const skillAny = DAMAGE_TYPES.some((t) => spec.base[t]);
  for (const t of DAMAGE_TYPES) {
    const added: Range = [q.flat(`added.${t}.min`, spec.tags), q.flat(`added.${t}.max`, spec.tags)];
    const skill = spec.base[t] ?? [0, 0];
    let lo: number;
    let hi: number;
    if (attack) {
      const weapon: Range = weaponAny ? [q.flat(`weapon.${t}.min`), q.flat(`weapon.${t}.max`)] : t === 'physical' && !skillAny ? UNARMED : [0, 0];
      lo = (weapon[0] + skill[0] + added[0]) * spec.effectiveness;
      hi = (weapon[1] + skill[1] + added[1]) * spec.effectiveness;
    } else {
      lo = skill[0] + added[0] * spec.effectiveness;
      hi = skill[1] + added[1] * spec.effectiveness;
    }
    if (hi > 0) out[t] = [Math.max(0, lo), Math.max(lo, hi)];
  }
  return out;
}

/** One slice of damage and every type it has been (for scaling by tags). */
export interface Portion {
  type: DamageType;
  amount: number;
  history: DamageType[];
}

/**
 * Convert along CONVERSION_ORDER with `convert.<from>.<to>` (fractions; more than 100% from
 * one type is scaled down to 100%). Converted damage remembers where it came from.
 */
export function convert(q: StatQuery, amounts: Damage, tags: readonly string[]): Portion[] {
  let portions: Portion[] = [];
  for (const t of CONVERSION_ORDER) if ((amounts[t] ?? 0) > 0) portions.push({ type: t, amount: amounts[t]!, history: [t] });
  for (let i = 0; i < CONVERSION_ORDER.length; i++) {
    const from = CONVERSION_ORDER[i]!;
    const targets = CONVERSION_ORDER.slice(i + 1).map((to) => ({ to, f: Math.max(0, q.flat(`convert.${from}.${to}`, tags)) }));
    const total = targets.reduce((s, x) => s + x.f, 0);
    if (total <= 0) continue;
    const k = total > 1 ? 1 / total : 1;
    const next: Portion[] = [];
    for (const p of portions) {
      if (p.type !== from) {
        next.push(p);
        continue;
      }
      let left = p.amount;
      for (const { to, f } of targets) {
        if (f <= 0) continue;
        const moved = p.amount * f * k;
        left -= moved;
        next.push({ type: to, amount: moved, history: [...p.history, to] });
      }
      if (left > 1e-9) next.push({ ...p, amount: left });
    }
    portions = next;
  }
  return portions;
}

/** Tags and stat names that scale a portion. */
export function portionScaling(p: Portion, skillTags: readonly string[]): { tags: string[]; stats: string[] } {
  const tags = [...skillTags, ...p.history];
  const stats = ['damage', ...p.history.map((h) => `${h}.damage`)];
  if (p.history.some((h) => ELEMENTAL.includes(h))) {
    tags.push('elemental');
    stats.push('elemental.damage');
  }
  return { tags, stats };
}

/** Scale portions by increased/more damage and sum them per final type. */
export function scaleDamage(q: StatQuery, portions: readonly Portion[], skillTags: readonly string[]): Damage {
  const out: Damage = {};
  for (const p of portions) {
    const { tags, stats } = portionScaling(p, skillTags);
    out[p.type] = (out[p.type] ?? 0) + p.amount * q.scale(stats, tags);
  }
  return out;
}

export function critChance(q: StatQuery, spec: DamageSpec): number {
  const base = isAttack(spec.tags) ? q.flat('weapon.crit') || DEFAULT_ATTACK_CRIT : spec.crit;
  return Math.min(1, Math.max(0, q.value('crit.chance', spec.tags, base)));
}

export function critMultiplier(q: StatQuery, spec: DamageSpec): number {
  return Math.max(1, q.value('crit.multiplier', spec.tags, BASE_CRIT_MULTIPLIER));
}

/** Ailment chances for a hit with these damage types present. */
export function ailmentChances(q: StatQuery, spec: DamageSpec, present: Damage, crit: boolean): Partial<Record<AilmentType, number>> {
  const out: Partial<Record<AilmentType, number>> = {};
  for (const def of AILMENTS.all()) {
    if (def.always || def.threshold) continue; // decided by the defender from the landed damage
    if (!def.from.some((t) => (present[t] ?? 0) > 0)) continue;
    if (def.requires && !def.requires.every((t) => spec.tags.includes(t))) continue;
    let c = (spec.ailments[def.id] ?? 0) + q.flat(`${def.id}.chance`, spec.tags);
    if (crit && def.critApplies) c = 1;
    if (c > 0) out[def.id] = Math.min(1, c);
  }
  return out;
}

export interface RollOptions {
  source?: ActorLike | null;
  skill?: string;
  from?: Vector3;
  /** Multiplies every amount (e.g. a nova's falloff, a beam tick's share). */
  scale?: number;
  /** Force (true/false) instead of rolling (tests, the DPS tool). */
  crit?: boolean;
}

/** Attacker side: everything up to (not including) the target's defences. */
export function rollHit(q: StatQuery, spec: DamageSpec, rng: Rng, opts: RollOptions = {}): Hit {
  const ranges = baseRanges(q, spec);
  const rolled: Damage = {};
  for (const t of DAMAGE_TYPES) {
    const r = ranges[t];
    if (r) rolled[t] = r[0] + (r[1] - r[0]) * rng.next();
  }
  const scaled = scaleDamage(q, convert(q, rolled, spec.tags), spec.tags);
  const crit = opts.crit ?? rng.chance(critChance(q, spec));
  const mult = (crit ? critMultiplier(q, spec) : 1) * (opts.scale ?? 1);
  const damage: Damage = {};
  for (const t of DAMAGE_TYPES) if ((scaled[t] ?? 0) > 0) damage[t] = scaled[t]! * mult;
  const penetration: Damage = {};
  for (const t of DAMAGE_TYPES) {
    const p = q.flat(`pen.${t}`, spec.tags);
    if (p) penetration[t] = p;
  }
  const total = Object.values(damage).reduce((s, v) => s + v, 0);
  return {
    source: opts.source ?? null,
    skill: opts.skill,
    tags: spec.tags,
    damage,
    crit,
    ailments: ailmentChances(q, spec, damage, crit),
    knockback: q.value('knockback', spec.tags, spec.knockback),
    from: opts.from,
    hitStop: hitStopFor(total, crit, spec.tags),
    accuracy: isAttack(spec.tags) ? q.value('accuracy', spec.tags, 0) || undefined : undefined,
    penetration,
    ailmentEffect: q.scale('ailment.effect', spec.tags),
    ailmentDuration: q.scale('ailment.duration', spec.tags),
    cull: q.has('cull', spec.tags) ? 0.1 : undefined,
  };
}

/** Juice: frames of hit-stop for a hit (melee crunches, big crits crunch more). */
export function hitStopFor(total: number, crit: boolean, tags: readonly string[]): number {
  if (total <= 0) return 0;
  const melee = tags.includes('melee');
  const base = melee ? 3 : tags.includes('area') ? 1 : 0;
  return Math.min(8, base + (crit ? 2 : 0) + (melee && total > 60 ? 1 : 0));
}

// ------------------------------------------------------------------------- defender side

/** What mitigation needs to know about the target. `stats.get` includes the actor's base values. */
export interface Defender {
  readonly stats: StatSheet;
  readonly life: number;
  readonly maxLife: number;
  readonly es: number;
  /** Current shock (increased damage taken, 0..1). */
  readonly shock: number;
}

/** chance to evade = 1 − 1.25·acc / (acc + (eva/5)^0.9), hit chance clamped to [5%, 100%]. */
export function hitChance(accuracy: number | undefined, evasion: number): number {
  if (accuracy === undefined || evasion <= 0) return 1;
  const c = (1.25 * accuracy) / (accuracy + Math.pow(evasion / 5, 0.9));
  return Math.min(1, Math.max(0.05, c));
}

/** Armour vs one physical hit: armour / (armour + 5·damage), capped at 90%. Bigger hits get through more. */
export function armourReduction(armour: number, damage: number): number {
  if (armour <= 0 || damage <= 0) return 0;
  return Math.min(ARMOUR_CAP, armour / (armour + 5 * damage));
}

/** Effective resistance: capped at `res.max.<type>` (75% default), lowered by penetration, floored at −200%. */
export function resistance(stats: StatSheet, type: DamageType, pen = 0): number {
  const max = stats.get(`res.max.${type}`) || DEFAULT_RES_MAX;
  return Math.max(MIN_RES, Math.min(stats.get(`res.${type}`), max) - pen);
}

export function blockChance(stats: StatSheet, tags: readonly string[]): number {
  const c = tags.includes('attack') ? stats.get('block.chance', tags) : tags.includes('spell') ? stats.get('spell.block', tags) : 0;
  return Math.min(BLOCK_CAP, Math.max(0, c));
}

/** Damage taken multiplier for one type: shock and `damage.taken` mods (base 1). */
export function takenMultiplier(d: Defender, type: DamageType, tags: readonly string[]): number {
  const t = d.stats.get('damage.taken', [...tags, type]);
  return (1 + d.shock) * (t > 0 ? t : 1);
}

/** Damage of one type after armour/resistance/taken (no ES/life yet). */
export function mitigateType(d: Defender, type: DamageType, amount: number, hit: Pick<Hit, 'tags' | 'penetration'>): number {
  if (amount <= 0) return 0;
  let a = amount;
  if (type === 'physical') a *= 1 - Math.min(ARMOUR_CAP, armourReduction(d.stats.get('armour'), amount) + Math.max(0, d.stats.get('res.physical')));
  else a *= 1 - resistance(d.stats, type, hit.penetration?.[type] ?? 0);
  return a * takenMultiplier(d, type, hit.tags);
}

/** An ailment to put on the target. */
export interface AilmentApplication {
  readonly id: AilmentType;
  readonly magnitude: number;
  readonly duration: number;
}

export interface Mitigated {
  readonly result: HitResult;
  /** Damage taken by energy shield and by life. */
  readonly toEs: number;
  readonly toLife: number;
  readonly apply: readonly AilmentApplication[];
}

const NOTHING: Mitigated = {
  result: { total: 0, byType: {}, crit: false, killed: false, ailments: [] },
  toEs: 0,
  toLife: 0,
  apply: [],
};

/** Defender side of a hit. `rng` is the target's (evasion, block, ailment rolls). */
export function mitigate(hit: Hit, d: Defender, rng: Rng): Mitigated {
  if (d.life <= 0) return NOTHING;
  const attack = isAttack(hit.tags);
  if (attack && !rng.chance(hitChance(hit.accuracy, d.stats.get('evasion')))) {
    return { ...NOTHING, result: { ...NOTHING.result, crit: hit.crit, evaded: true } };
  }
  if (rng.chance(blockChance(d.stats, hit.tags))) {
    return { ...NOTHING, result: { ...NOTHING.result, crit: hit.crit, blocked: true } };
  }
  const byType: Damage = {};
  let total = 0;
  for (const t of DAMAGE_TYPES) {
    const a = mitigateType(d, t, hit.damage[t] ?? 0, hit);
    if (a > 0) {
      byType[t] = a;
      total += a;
    }
  }
  const toEs = Math.min(d.es, total);
  let toLife = total - toEs;
  let lifeAfter = d.life - toLife;
  if (hit.cull && lifeAfter > 0 && lifeAfter < d.maxLife * hit.cull) {
    toLife += lifeAfter;
    lifeAfter = 0;
  }
  const killed = lifeAfter <= 0;
  const apply = killed ? [] : rollAilments(hit, byType, d, rng);
  return {
    result: { total: toEs + toLife, byType, crit: hit.crit, killed, ailments: apply.map((a) => a.id) },
    toEs,
    toLife,
    apply,
  };
}

/** Which ailments a landed hit applies, with their strength and duration. */
export function rollAilments(hit: Hit, byType: Damage, d: Defender, rng: Rng): AilmentApplication[] {
  const out: AilmentApplication[] = [];
  for (const def of AILMENTS.all()) {
    const dmg = ailmentDamage(def, byType);
    if (dmg <= 0) continue;
    const avoid = d.stats.get(`avoid.${def.id}`);
    if (avoid >= 1) continue;
    const landed = def.threshold ? def.threshold(dmg, d.maxLife * thresholdScale(d, def)) : def.always ? true : rng.chance(hit.ailments?.[def.id] ?? 0);
    if (!landed) continue;
    if (avoid > 0 && rng.chance(avoid)) continue;
    out.push(ailmentFrom(def, dmg, d.maxLife, hit.ailmentEffect ?? 1, hit.ailmentDuration ?? 1));
  }
  return out;
}

function thresholdScale(d: Defender, def: AilmentDef): number {
  const s = d.stats.get(`${def.id}.threshold`);
  return s > 0 ? s : 1;
}

export function ailmentFrom(def: AilmentDef, damage: number, maxLife: number, effect = 1, duration = 1): AilmentApplication {
  const dur = def.duration * (def.scaleDuration?.(damage, maxLife) ?? 1) * duration;
  const mag = def.kind === 'stop' ? 1 : def.magnitude(damage, maxLife) * effect;
  return { id: def.id, magnitude: def.kind === 'slow' ? Math.min(0.5, mag) : def.kind === 'amp' ? Math.min(0.5, mag) : mag, duration: dur };
}

/** Damage-over-time tick against the target's defences: resistances apply, armour does not. */
export function mitigateDot(d: Defender, type: DamageType, amount: number): number {
  if (amount <= 0) return 0;
  const a = type === 'physical' ? amount * (1 - Math.max(0, d.stats.get('res.physical'))) : amount * (1 - resistance(d.stats, type));
  return a * takenMultiplier(d, type, ['dot']);
}

// ------------------------------------------------------------------------- expected values

export interface ExpectedHit {
  /** Average damage per hit by type, after scaling and expected crits, before the target. */
  readonly damage: Damage;
  readonly critChance: number;
  readonly critMultiplier: number;
  /** Average per landed hit against the target, and the chance to land at all. */
  readonly mitigated: Damage;
  readonly landChance: number;
  /** Expected ailment chance per hit. */
  readonly ailments: Partial<Record<AilmentType, number>>;
}

/** Expected value of a hit (no rolls): the DPS tool and balance sims use it. */
export function expectedHit(q: StatQuery, spec: DamageSpec, target?: Defender): ExpectedHit {
  const ranges = baseRanges(q, spec);
  const avg: Damage = {};
  for (const t of DAMAGE_TYPES) if (ranges[t]) avg[t] = (ranges[t]![0] + ranges[t]![1]) / 2;
  const scaled = scaleDamage(q, convert(q, avg, spec.tags), spec.tags);
  const cc = critChance(q, spec);
  const cm = critMultiplier(q, spec);
  const k = 1 + cc * (cm - 1);
  const damage: Damage = {};
  for (const t of DAMAGE_TYPES) if ((scaled[t] ?? 0) > 0) damage[t] = scaled[t]! * k;
  const chances = ailmentChances(q, spec, damage, false);
  const critChances = ailmentChances(q, spec, damage, true);
  const ailments: Partial<Record<AilmentType, number>> = {};
  for (const id of new Set([...Object.keys(chances), ...Object.keys(critChances)]) as Set<AilmentType>) {
    ailments[id] = (chances[id] ?? 0) * (1 - cc) + (critChances[id] ?? 0) * cc;
  }
  let mitigated: Damage = damage;
  let landChance = 1;
  if (target) {
    const pen: Damage = {};
    for (const t of DAMAGE_TYPES) pen[t] = q.flat(`pen.${t}`, spec.tags);
    mitigated = {};
    for (const t of DAMAGE_TYPES) {
      const a = mitigateType(target, t, damage[t] ?? 0, { tags: spec.tags, penetration: pen });
      if (a > 0) mitigated[t] = a;
    }
    const acc = isAttack(spec.tags) ? q.value('accuracy', spec.tags, 0) || undefined : undefined;
    landChance = (isAttack(spec.tags) ? hitChance(acc, target.stats.get('evasion')) : 1) * (1 - blockChance(target.stats, spec.tags));
  }
  return { damage, critChance: cc, critMultiplier: cm, mitigated, landChance, ailments };
}

export const sumDamage = (d: Damage): number => {
  let s = 0;
  for (const t of DAMAGE_TYPES) s += d[t] ?? 0;
  return s;
};
