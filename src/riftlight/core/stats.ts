/**
 * Canonical stat names: one name per stat, and the aliases other systems wrote before they
 * agreed. Every `StatSheet` renames mods on the way in (`set`) and queries on the way out
 * (`get`, `has`, `explain`), so a mod written under an alias works everywhere and `stats()`
 * lists canonical names only. New code writes the canonical name; the alias table is for
 * data that predates it (and is cheap to keep: one lookup per mod when a source changes).
 *
 *   flat('energy.shield', 20)   → stored as flat('es', 20)
 *   flat('res.elemental', 0.1)  → res.fire, res.cold and res.lightning, 0.1 each
 *   sheet.get('crit.multi')     → sheet.get('crit.multiplier')
 *
 * What each canonical stat does is in `CANONICAL_STATS` (docs/GAME.md, "Stats the pipeline
 * reads" has the full list); the integration layer reads all of them.
 */
import type { Mod } from './mods';

/** alias → canonical stat name. */
export const STAT_ALIASES: Readonly<Record<string, string>> = {
  'crit.multi': 'crit.multiplier',
  block: 'block.chance',
  'energy.shield': 'es',
  'crit.chance.base': 'weapon.crit',
  'life.leech': 'leech.life',
  'mana.leech': 'leech.mana',
  'mana.cost': 'cost',
  'projectile.count': 'projectiles',
  'evasion.chance': 'dodge.chance',
  'fire.damage.added': 'added.fire.ratio',
  'life.regen.percent': 'life.regen.pct',
};

/** One alias that stands for several canonical stats (each gets the mod). */
export const STAT_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  'res.elemental': ['res.fire', 'res.cold', 'res.lightning'],
  'res.max.elemental': ['res.max.fire', 'res.max.cold', 'res.max.lightning'],
};

/**
 * Canonical stats beyond the damage pipeline's own list (combat/damage.ts), with what reads
 * them. Producers (items, passives, monsters) should use exactly these names.
 */
export const CANONICAL_STATS: Readonly<Record<string, string>> = {
  'crit.multiplier': 'flat, base 1.5: damage of a critical strike (combat/damage.ts)',
  'block.chance': 'flat fraction: chance to block attacks (and spells with `block.spells`)',
  'block.spells': 'flag: block chance also applies to spells',
  'spell.block': 'flat fraction: chance to block spells',
  'block.recovery': 'inc: shortens the stagger after a block (actors/Actor.ts)',
  es: 'flat: maximum energy shield',
  'weapon.crit': "flat fraction: the weapon's base critical strike chance (attacks)",
  'attack.speed.base': "flat: the weapon's attacks per second; attack skills are timed from it (skills/build.ts)",
  'leech.life': 'flat fraction of hit damage leeched as life',
  'leech.mana': 'flat fraction of hit damage leeched as mana',
  'leech.rate': 'inc: how fast leech returns (base 20% of max per second)',
  cost: 'inc/more: mana cost of skills',
  projectiles: 'flat: extra projectiles',
  '<ailment>.damage': 'inc/more: damage of that damage-over-time ailment (bleed.damage, poison.damage, ignite.damage)',
  '<ailment>.effect': 'inc/more: strength of that ailment (chill.effect, shock.effect)',
  'aura.effect': 'inc/more: strength of the buffs your auras grant',
  'weapon.<class>': 'flag set by the equipped weapon (weapon.bow, weapon.wand...): skills tagged with that class need it',
  'minion.<stat>': "an owner's stat that applies to its minions as <stat> (minion.damage, minion.life, minion.attack.speed...)",
  'dodge.chance': 'flat fraction: ignore a hit outright (max 75%)',
  'added.fire.ratio': 'flat: monsters add this share of their hit as fire (elite Fire Enchanted)',
  'life.regen.pct': 'flat fraction of maximum life regenerated per second',
};

/** Canonical name of one stat (aliases resolved; `chance.<x>` → `<x>.chance`). */
export function canonicalStat(stat: string): string {
  const a = STAT_ALIASES[stat];
  if (a) return a;
  if (stat.startsWith('chance.')) return `${stat.slice(7)}.chance`;
  return stat;
}

/** Mods with canonical stat names (expansions become several mods). Returns the input when nothing changes. */
export function canonicalMods(mods: readonly Mod[]): readonly Mod[] {
  let changed = false;
  for (const m of mods) if (STAT_EXPANSIONS[m.stat] || canonicalStat(m.stat) !== m.stat) changed = true;
  if (!changed) return mods;
  const out: Mod[] = [];
  for (const m of mods) {
    const many = STAT_EXPANSIONS[m.stat];
    if (many) for (const stat of many) out.push({ ...m, stat });
    else {
      const stat = canonicalStat(m.stat);
      out.push(stat === m.stat ? m : { ...m, stat });
    }
  }
  return out;
}
