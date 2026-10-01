import { inc, more, type Mod, type StatSheet } from '../core/mods';
import type { AilmentType, DamageType, Delivery, Effect } from '../core/types';
import type { DamageSpec, Range } from '../combat/damage';
import { StatQuery } from '../combat/stats';
import { PLACEMENT, REFERENCE_APS, WEAPON_CLASS_TAGS } from '../combat/tuning';
import { SKILLS } from './actives';
import { SUPPORTS } from './supports';
import type { ResolvedSkill, SkillGem, SupportGem, SupportLink } from './types';

/** Growth of a damaging gem per level when it doesn't say otherwise. */
export const DEFAULT_PER_LEVEL: readonly Mod[] = [more('damage', 0.06)];
/** Mana cost grows with gem level. */
export const COST_PER_LEVEL = 0.08;
export const MAX_GEM_LEVEL = 20;

export interface BuildOptions {
  /** Gem level of the active skill (1..20). */
  readonly level?: number;
}

/** Mods scaled by `levels` (gem level − 1). */
export function levelMods(mods: readonly Mod[], levels: number): Mod[] {
  if (levels <= 0) return [];
  return mods.map((m) => ({ ...m, value: m.value * levels }));
}

/** Does `support` fit a skill with these tags? */
export function supportFits(support: SupportGem, tags: readonly string[]): boolean {
  return support.requires.every((t) => tags.includes(t)) && !(support.excludes ?? []).some((t) => tags.includes(t));
}

function resolveSupport(link: SupportLink): { gem: SupportGem; level: number } {
  if (typeof link === 'string') return { gem: SUPPORTS.get(link), level: 1 };
  if ('gem' in link) return { gem: typeof link.gem === 'string' ? SUPPORTS.get(link.gem) : link.gem, level: link.level };
  return { gem: link, level: 1 };
}

/**
 * Resolve an active skill with its linked supports for one character: effective tags,
 * cost, cast time, cooldown, delivery changes (projectile count, chain, pierce, fork, area,
 * repeats) and the skill-only mods the damage pipeline folds in. Pure: reads `actorStats`,
 * changes nothing. Unit-tested in build.test.ts.
 *
 *   const fireball = buildSkill('fireball', ['gmp', 'added-fire'], hero.stats, { level: 5 });
 */
export function buildSkill(skill: SkillGem | string, supports: readonly SupportLink[], actorStats: StatSheet, options: BuildOptions = {}): ResolvedSkill {
  const def = typeof skill === 'string' ? SKILLS.get(skill) : skill;
  const level = Math.max(1, Math.min(MAX_GEM_LEVEL, Math.round(options.level ?? 1)));
  // Tags first: a support that adds tags can make later supports fit.
  const tags = [...(def.tags ?? [])];
  const applied: { gem: SupportGem; level: number }[] = [];
  const unsupported: string[] = [];
  for (const link of supports) {
    const s = resolveSupport(link);
    if (applied.some((a) => a.gem.id === s.gem.id) || !supportFits(s.gem, tags)) {
      unsupported.push(s.gem.id);
      continue;
    }
    applied.push(s);
    for (const t of s.gem.changes?.addTags ?? []) if (!tags.includes(t)) tags.push(t);
  }
  // attacks carry the equipped weapon's class (`weapon.axe` → 'axe', `weapon.twohand` → 'twohand'),
  // so passives and affixes scoped to a weapon class reach them
  if (tags.includes('attack')) for (const [stat, tag] of Object.entries(WEAPON_CLASS_TAGS)) if (!tags.includes(tag) && actorStats.has(stat)) tags.push(tag);
  // a totem or trap support turns the skill into something you place (the first one wins)
  const placement = applied.find((a) => a.gem.placement)?.gem.placement ?? null;

  const mods: Mod[] = [...levelMods(def.perLevel ?? (tags.includes('damage') ? DEFAULT_PER_LEVEL : []), level - 1)];
  let costMultiplier = 1;
  const change = { projectiles: 0, chain: 0, pierce: 0, fork: 0, area: 0, repeats: 0 };
  for (const { gem, level: l } of applied) {
    mods.push(...gem.mods, ...levelMods(gem.perLevel ?? [], l - 1));
    costMultiplier *= gem.costMultiplier ?? 1;
    const c = gem.changes ?? {};
    change.projectiles += c.projectiles ?? 0;
    change.chain += c.chain ?? 0;
    change.pierce += c.pierce ?? 0;
    change.fork += c.fork ?? 0;
    change.area += c.area ?? 0;
    change.repeats += c.repeats ?? 0;
  }
  if (change.area) mods.push(inc('area', change.area));

  const q = new StatQuery(actorStats, mods);
  const attack = tags.includes('attack');
  // attacks are timed from the weapon: `attack.speed.base` (its attacks per second) against the reference
  const aps = attack ? q.flat('attack.speed.base') : 0;
  const weapon = aps > 0 ? aps / REFERENCE_APS : 1;
  const speed = Math.max(0.05, q.scale(attack ? 'attack.speed' : tags.includes('spell') ? 'cast.speed' : 'action.speed', tags) * weapon);
  const area = Math.max(0.05, q.scale('area', tags));
  const radius = Math.sqrt(area);
  const duration = Math.max(0, q.scale('duration', tags));
  // traps are thrown faster with `trap.speed`
  const throwSpeed = tags.includes('trap') ? Math.max(0.05, q.scale('trap.speed', tags)) : 1;
  // auras reserve a share of the pool; reservation supports (Enlighten) and `mana.reservation` shrink it
  const reservation = def.reserve ? Math.min(1, Math.max(0, def.reserve * costMultiplier * q.scale('mana.reservation', tags))) : 0;

  const resolved: ResolvedSkill = {
    id: def.id,
    def,
    level,
    tags,
    supports: applied.map((a) => a.gem.id),
    unsupported,
    mods,
    cost: Math.round(def.cost * (1 + COST_PER_LEVEL * (level - 1)) * costMultiplier * q.scale('cost', tags) * 10) / 10,
    cooldown: def.cooldown / Math.max(0.05, q.scale('cooldown.recovery', tags)),
    castTime: def.castTime / speed / throwSpeed,
    speed,
    delivery: applyChanges(def.delivery, q, tags, change, radius, duration),
    area,
    duration,
    repeats: 1 + change.repeats + Math.round(q.flat('repeats', tags)),
    projectileSpeed: q.scale('projectile.speed', tags),
    damage: damageSpec(def, tags),
    effects: def.effects.map((e) => (e.kind === 'buff' && e.duration > 0 ? { ...e, duration: e.duration * duration } : e)),
    anims: def.combo?.length ? def.combo : [def.anim],
    channel: def.channel === true,
    moveDuringCast: def.moveDuringCast ?? (tags.includes('spell') ? 0.4 : 0.15),
    reservation,
    placement: null,
  };
  if (!placement) return resolved;
  // placing: a quick plant (`totem.speed`) or a throw; the totem / trap then uses the skill itself
  const totem = placement === 'totem';
  return {
    ...resolved,
    placement,
    inner: resolved,
    castTime: totem ? PLACEMENT.totemTime / Math.max(0.05, q.scale('totem.speed', tags)) : resolved.castTime,
    anims: [totem ? PLACEMENT.totemAnim : PLACEMENT.trapAnim],
    channel: false,
    repeats: 1,
    moveDuringCast: totem ? 0.2 : 0.4,
  };
}

function applyChanges(d: Delivery, q: StatQuery, tags: readonly string[], c: { projectiles: number; chain: number; pierce: number; fork: number }, radius: number, duration: number): Delivery {
  const areaScaled = tags.includes('area');
  switch (d.kind) {
    case 'projectile':
      return {
        ...d,
        speed: d.speed * q.scale('projectile.speed', tags),
        count: Math.max(1, d.count + c.projectiles + Math.round(q.flat('projectiles', tags))),
        // more projectiles fan out wider (a single one stays a single line)
        spread: d.count + c.projectiles > 1 ? Math.max(d.spread, 10 * (d.count + c.projectiles - 1)) : d.spread,
        chain: d.chain + c.chain + Math.round(q.flat('chain', tags)),
        pierce: d.pierce + c.pierce + Math.round(q.flat('pierce', tags)),
        fork: (d.fork ?? 0) + c.fork + Math.round(q.flat('fork', tags)),
        homing: (d.homing ?? 0) + q.flat('projectile.homing', tags),
      };
    case 'strike':
      return areaScaled ? { ...d, range: d.range * radius } : d;
    case 'slam':
      return { ...d, radius: d.radius * radius };
    case 'nova':
      return { ...d, radius: d.radius * radius };
    case 'aura':
      return { ...d, radius: d.radius * radius * Math.max(0.1, q.scale('aura.radius', tags)) };
    case 'curse':
      return { ...d, radius: d.radius * radius };
    case 'trap':
      return { ...d, radius: d.radius * radius, duration: d.duration * duration, arm: d.arm * Math.max(0, q.scale('trap.arm', tags)) };
    case 'beam':
      return { ...d, width: d.width * radius };
    case 'summon':
      return { ...d, count: d.count + Math.round(q.flat('minions', tags)), duration: d.duration * duration };
    case 'dash':
      return d;
  }
}

/** The damage part of a skill (null when it deals none). */
export function damageSpec(def: SkillGem, tags: readonly string[]): DamageSpec | null {
  const dmg = def.effects.find((e): e is Extract<Effect, { kind: 'damage' }> => e.kind === 'damage');
  if (!dmg) return null; // summons: the damage their minions deal
  const ailments: Partial<Record<AilmentType, number>> = {};
  let knockback = 0;
  for (const e of def.effects) {
    if (e.kind === 'ailment') ailments[e.ailment] = (ailments[e.ailment] ?? 0) + e.chance;
    if (e.kind === 'knockback') knockback += e.force;
  }
  return {
    tags,
    base: dmg.base as Partial<Record<DamageType, Range>>,
    effectiveness: dmg.effectiveness ?? 1,
    crit: def.crit ?? 0.05,
    ailments,
    knockback,
  };
}

/** Every support that fits a skill (inspector, gem UI). */
export function supportsFor(skill: SkillGem | string): SupportGem[] {
  const def = typeof skill === 'string' ? SKILLS.get(skill) : skill;
  return SUPPORTS.all().filter((s) => supportFits(s, def.tags ?? []));
}
