/**
 * Expected damage per second of a resolved skill against one defender: the model behind
 * `npm run combat -- dps` and `npm run balance`. Pure: the hit pipeline's `expectedHit`
 * (combat/damage.ts) plus how often a delivery lands on one target and on a pack.
 *
 *   const r = skillDps(hero.stats, buildSkill('fireball', ['gmp'], hero.stats), target, 3);
 *   r.dps.total   // single target, hits + ailment DoTs
 *   r.dps.pack    // the same over `targets` enemies (areas, chains, pierce)
 */
import type { StatSheet } from '../core/mods';
import { DAMAGE_TYPES, type AilmentType, type DamageType } from '../core/types';
import { AILMENTS } from '../combat/ailments';
import { baseRanges, expectedHit, mitigateDot, sumDamage, type Damage, type Defender } from '../combat/damage';
import { StatQuery } from '../combat/stats';
import { FINISHER } from '../combat/tuning';
import type { ResolvedSkill } from '../skills/types';

export interface DpsReport {
  skill: string;
  level: number;
  tags: readonly string[];
  supports: readonly string[];
  unsupported: readonly string[];
  delivery: ResolvedSkill['delivery'];
  cost: number;
  castTime: number;
  cooldown: number;
  repeats: number;
  area: number;
  hit: null | {
    base: Partial<Record<DamageType, [number, number]>>;
    perHit: Damage;
    mitigated: Damage;
    critChance: number;
    critMultiplier: number;
    landChance: number;
    average: number;
    ailments: Partial<Record<AilmentType, { chance: number; dps: number }>>;
  };
  hitsPerSecond: number;
  /** Hits on one target per use and per use over `targets`. */
  hitsPerUse: { single: number; pack: number };
  dps: { hit: number; dot: number; total: number; pack: number };
  manaPerSecond: number;
  notes: string[];
}

/** Expected DPS of `s` used by an actor with `sheet` against `target` (and `targets` enemies in reach). */
export function skillDps(sheet: StatSheet, s: ResolvedSkill, target: Defender, targets = 1): DpsReport {
  const notes: string[] = [];
  const d = s.delivery;
  const q = new StatQuery(sheet, s.mods);
  const spec = s.damage;
  // uses per second (cooldowns cap it)
  const usePeriod = Math.max(s.castTime, s.cooldown);
  let uses = usePeriod > 0 ? 1 / usePeriod : 0;
  let perUse = 1;
  let pack = 1;
  let scale = 1;
  switch (d.kind) {
    case 'strike':
      if (s.anims.length > 1) {
        scale = (s.anims.length - 1 + FINISHER.damage) / s.anims.length;
        notes.push(`combo of ${s.anims.length}: the last hit deals ${FINISHER.damage}× (averaged in)`);
      }
      perUse = s.repeats;
      pack = s.repeats * targets;
      break;
    case 'projectile': {
      const hitsOne = Math.min(d.count, 1 + Math.floor((d.count - 1) / 3)); // a fan rarely lands every arrow on one target
      perUse = s.repeats * hitsOne;
      pack = Math.max(perUse, s.repeats * Math.min(targets, d.count + d.chain + d.pierce + (d.fork ?? 0) * 2));
      if (s.def.explode) pack = Math.max(pack, perUse * targets);
      if (s.def.explode) notes.push(`explodes in ${(s.def.explode * Math.sqrt(s.area)).toFixed(1)} m (splash counted in pack)`);
      if (d.chain) notes.push(`chains ${d.chain}×`);
      if (d.pierce) notes.push(`pierces ${d.pierce}`);
      if (d.fork) notes.push(`forks ${d.fork}×`);
      break;
    }
    case 'nova':
    case 'beam':
      if (s.channel) {
        const period = d.kind === 'beam' ? Math.max(0.05, d.tick / s.speed) : Math.max(0.12, 0.3 / s.speed);
        uses = 1 / period;
        scale = s.def.tickDamage ?? 1;
        notes.push(`channelled: ${uses.toFixed(1)} ticks/s at ${Math.round(scale * 100)}% of a hit`);
      }
      perUse = s.repeats;
      pack = s.repeats * targets;
      break;
    case 'trap':
      if (s.def.zone) {
        uses = 1 / Math.max(0.1, s.def.zone.tick);
        scale = s.def.tickDamage ?? 0.25;
        notes.push(`burning ground: ${uses.toFixed(1)} ticks/s while standing in it for ${d.duration.toFixed(1)} s`);
      }
      pack = targets;
      break;
    case 'slam':
      perUse = s.repeats;
      pack = s.repeats * targets;
      if (d.delay > 0) notes.push(`lands ${d.delay.toFixed(2)} s after the cast`);
      break;
    case 'summon':
      notes.push(`raises ${d.count} ${d.genome}${d.duration > 0 ? ` for ${d.duration.toFixed(0)} s` : ''}: minion hits use the summoner's 'minion' mods`);
      uses = d.count / 0.8;
      pack = targets;
      break;
    case 'aura':
      notes.push('aura: no damage; buffs allies in range while on');
      break;
    case 'dash':
      pack = targets;
      if (d.hitWidth <= 0) notes.push('movement only');
      break;
  }
  let hit: DpsReport['hit'] = null;
  let hitDps = 0;
  let dotDps = 0;
  if (spec) {
    const e = expectedHit(q, spec, target);
    const perHit = sumDamage(e.mitigated) * e.landChance * scale;
    hitDps = perHit * uses * perUse;
    const ailments: NonNullable<DpsReport['hit']>['ailments'] = {};
    for (const [id, chance] of Object.entries(e.ailments) as [AilmentType, number][]) {
      const def = AILMENTS.get(id);
      if (def.kind !== 'dot') {
        ailments[id] = { chance, dps: 0 };
        continue;
      }
      const src = def.from.reduce((sum, t) => sum + (e.mitigated[t] ?? 0), 0) * scale;
      const tick = mitigateDot(target, def.dotType!, def.magnitude(src, target.maxLife) * q.scale('ailment.effect', spec.tags));
      // stacking ailments add up; the strongest-only ones are up while procs keep coming
      const rate = chance * e.landChance * uses * perUse;
      const dur = def.duration * q.scale('ailment.duration', spec.tags);
      const dps = def.stacks ? tick * rate * dur : tick * Math.min(1, rate * dur);
      ailments[id] = { chance, dps };
      dotDps += dps;
    }
    const ranges = baseRanges(q, spec);
    hit = {
      base: Object.fromEntries(Object.entries(ranges).map(([t, r]) => [t, [round(r[0]), round(r[1])]])) as Partial<Record<DamageType, [number, number]>>,
      perHit: roundD(e.damage),
      mitigated: roundD(e.mitigated),
      critChance: round(e.critChance, 3),
      critMultiplier: round(e.critMultiplier, 2),
      landChance: round(e.landChance, 3),
      average: round(perHit),
      ailments,
    };
  }
  const packMul = perUse > 0 ? pack / perUse : 1;
  const mana = s.channel ? s.cost : s.cost * (usePeriod > 0 ? 1 / usePeriod : 0);
  return {
    skill: s.id,
    level: s.level,
    tags: s.tags,
    supports: s.supports,
    unsupported: s.unsupported,
    delivery: s.delivery,
    cost: s.cost,
    castTime: round(s.castTime, 3),
    cooldown: round(s.cooldown, 2),
    repeats: s.repeats,
    area: round(s.area, 2),
    hit,
    hitsPerSecond: round(uses * perUse, 2),
    hitsPerUse: { single: perUse, pack },
    dps: { hit: round(hitDps), dot: round(dotDps), total: round(hitDps + dotDps), pack: round((hitDps + dotDps) * packMul) },
    manaPerSecond: round(mana, 2),
    notes,
  };
}

export function round(v: number, digits = 1): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

function roundD(d: Damage): Damage {
  const o: Damage = {};
  for (const t of DAMAGE_TYPES) if (d[t]) o[t] = round(d[t]!);
  return o;
}
