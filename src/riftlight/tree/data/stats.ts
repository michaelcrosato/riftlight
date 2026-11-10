/**
 * The tree's stat budget: how much of each stat one budget point buys (the stats' names and
 * how mods read are the game's lines: lang/mods.ts, tree/text.ts). Small nodes are rolled from a budget (generate.ts), and the
 * validator measures every node with the same table, so a region can't quietly end up
 * stronger than its neighbours.
 *
 * Conventions every system shares (see docs/game/tree.md):
 * - `inc` / `more` are fractions (0.1 = 10%).
 * - Chances, resistances, block and leech are flat *fractions* too: `flat('res.fire', 0.12)`
 *   is +12% fire resistance, `flat('crit.chance', 0.02)` is +2% base critical strike chance.
 * - Element-specific damage uses `<type>.damage` (`fire.damage`, `physical.damage`...);
 *   `elemental.damage` applies to fire, cold and lightning; plain `damage` applies to all.
 *   Skill-type scoping uses tags: `inc('damage', 0.1, ['melee'])`.
 * - `res.elemental` adds to fire, cold and lightning resistance.
 */
import type { Mod } from '../../core/mods';
import { isPercentStat } from '../../core/stats';
import type { ModRoll } from '../types';

/**
 * Value bought by ONE budget point, per `kind:stat` (falling back to `kind:*`). A small
 * node has a budget of ~10: 10 points of `inc:damage` is 12% increased damage.
 */
export const MOD_COSTS: Readonly<Record<string, number>> = {
  'inc:*': 0.012,
  'more:*': 0.004,
  'flat:life': 1.2,
  'inc:life': 0.006,
  'flat:mana': 1,
  'inc:mana': 0.008,
  'inc:mana.regen': 0.02,
  'inc:mana.cost': 0.008,
  'inc:mana.reservation': 0.008,
  'flat:energy.shield': 1,
  'inc:energy.shield': 0.012,
  'inc:es.recharge': 0.015,
  'flat:armour': 6,
  'inc:armour': 0.02,
  'flat:evasion': 6,
  'inc:evasion': 0.02,
  'flat:block': 0.003,
  'inc:block.recovery': 0.03,
  'flat:res.fire': 0.012,
  'flat:res.cold': 0.012,
  'flat:res.lightning': 0.012,
  'flat:res.elemental': 0.006,
  'flat:res.chaos': 0.008,
  'inc:damage': 0.012,
  'inc:physical.damage': 0.014,
  'inc:fire.damage': 0.014,
  'inc:cold.damage': 0.014,
  'inc:lightning.damage': 0.014,
  'inc:chaos.damage': 0.015,
  'inc:elemental.damage': 0.01,
  'inc:attack.speed': 0.005,
  'inc:cast.speed': 0.005,
  'inc:crit.chance': 0.025,
  'flat:crit.chance': 0.001,
  'flat:crit.multi': 0.015,
  'inc:area': 0.01,
  'inc:projectile.speed': 0.02,
  'flat:projectile.count': 0.05,
  'flat:pierce': 0.1,
  'inc:cooldown.recovery': 0.006,
  'inc:duration': 0.015,
  'flat:ignite.chance': 0.006,
  'flat:poison.chance': 0.006,
  'flat:bleed.chance': 0.006,
  'flat:freeze.chance': 0.004,
  'flat:shock.chance': 0.006,
  'inc:ignite.damage': 0.016,
  'inc:poison.damage': 0.016,
  'inc:bleed.damage': 0.016,
  'inc:ailment.duration': 0.012,
  'inc:ailment.damage': 0.012,
  'inc:chill.effect': 0.012,
  'inc:shock.effect': 0.012,
  'inc:stun.duration': 0.02,
  'inc:stun.threshold': 0.02,
  'inc:knockback': 0.03,
  'inc:minion.damage': 0.014,
  'inc:minion.life': 0.014,
  'inc:minion.speed': 0.008,
  'flat:minion.count': 0.05,
  'inc:aura.effect': 0.006,
  'inc:aura.radius': 0.02,
  'inc:curse.effect': 0.006,
  'inc:curse.duration': 0.03,
  'flat:curse.count': 0.05,
  'inc:trap.speed': 0.012,
  'flat:trap.count': 0.05,
  'inc:totem.life': 0.02,
  'flat:totem.count': 0.05,
  'inc:totem.speed': 0.015,
  'flat:endurance.max': 0.05,
  'flat:frenzy.max': 0.05,
  'flat:power.max': 0.05,
  'inc:charge.duration': 0.02,
  'flat:charge.onKill': 0.01,
  'inc:move.speed': 0.004,
  'inc:dodge.recovery': 0.01,
  'inc:dodge.distance': 0.015,
  'flat:life.leech': 0.0008,
  'flat:mana.leech': 0.0008,
  'inc:leech.rate': 0.02,
  'flat:life.onKill': 1.5,
  'flat:mana.onKill': 0.8,
  'flat:es.onKill': 1.5,
  'inc:light.radius': 0.02,
  'flat:life.regen': 0.3,
  'flat:life.regenPct': 0.0008,
  'inc:life.recovery': 0.01,
  'inc:damage.taken': 0.004,
  'more:damage.taken': 0.003,
};

/** Scoped mods (tags or a condition) only apply sometimes, so they cost less. */
export const SCOPED_DISCOUNT = 0.75;

/** Value per budget point for a mod's stat/kind, or 0 when the stat has no price (flags, overrides). */
export function costPer(stat: string, kind: Mod['kind']): number {
  if (kind === 'flag' || kind === 'override') return 0;
  return MOD_COSTS[`${kind}:${stat}`] ?? (kind === 'flat' ? 0 : MOD_COSTS[`${kind}:*`] ?? 0);
}

/** Budget points a mod is worth (|value| / price, discounted when scoped). 0 for unpriced stats. */
export function modBudget(m: Mod): number {
  const per = costPer(m.stat, m.kind);
  if (!per) return 0;
  const scoped = (m.tags?.length ?? 0) > 0 || !!m.when;
  return (Math.abs(m.value) / per) * (scoped ? SCOPED_DISCOUNT : 1);
}

/** Budget points a list of mods is worth. */
export function modsBudget(mods: readonly Mod[]): number {
  let b = 0;
  for (const m of mods) b += modBudget(m);
  return b;
}

/** Rounding step for a rolled value, so tooltips read "12%" and "+15 life", not "11.73%". */
function stepFor(roll: ModRoll): number {
  if (roll.kind === 'flat') {
    if (roll.stat.endsWith('.leech') || roll.stat === 'life.regenPct') return 0.001;
    if (isPercentStat(roll.stat)) return 0.005;
    const per = costPer(roll.stat, 'flat');
    return per >= 1 ? 1 : per >= 0.2 ? 0.1 : 0.01;
  }
  return 0.01;
}

/** The mod a roll gives for `points` of budget (rounded; never zero). */
export function rollMod(roll: ModRoll, points: number): Mod {
  const per = costPer(roll.stat, roll.kind);
  const scoped = (roll.tags?.length ?? 0) > 0 || !!roll.when;
  const raw = (points * per) / (scoped ? SCOPED_DISCOUNT : 1);
  const step = stepFor(roll);
  const value = Math.max(step, Math.round(raw / step) * step);
  const v = Number(value.toFixed(4)) * (roll.negative ? -1 : 1);
  const mod: Mod = { stat: roll.stat, kind: roll.kind, value: v };
  return { ...mod, ...(roll.tags ? { tags: roll.tags } : {}), ...(roll.when ? { when: roll.when } : {}) };
}

/** Shorthand for writing pools as data: R('life', 'flat', 3). */
export const R = (stat: string, kind: ModRoll['kind'], weight = 1, tags?: readonly string[], when?: string, negative?: boolean): ModRoll => ({
  stat,
  kind,
  weight,
  ...(tags ? { tags } : {}),
  ...(when ? { when } : {}),
  ...(negative ? { negative } : {}),
});
