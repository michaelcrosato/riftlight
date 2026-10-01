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
  'life.regenPct': 'life.regen.pct',
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
  'life.recovery': 'inc/more: life regeneration, leech and life gained on kill',
  'life.onKill': 'flat: life gained on each kill (actors/Actor.ts onKill)',
  'mana.onKill': 'flat: mana gained on each kill',
  'es.onKill': 'flat: energy shield gained on each kill',
  'es.recharge': 'inc/more: energy shield recharge rate (base 33% of max per second after 2 s unhit)',
  'ailment.damage': 'inc/more: every damage-over-time ailment (with <ailment>.damage)',
  'dodge.recovery': 'inc/more: a quicker dodge roll',
  'dodge.distance': 'inc/more: a longer dodge roll',
  '<ailment>.duration': 'inc/more: duration of that ailment (stun.duration, freeze.duration...)',
  'action.speed': 'more: every action (animation, wind-ups); base 1 (Temporal Chains)',
  // charges (combat/charges.ts)
  'endurance.max': 'flat: more endurance charges (base 3); each: 4% physical reduction, +4% elemental resistances',
  'frenzy.max': 'flat: more frenzy charges (base 3); each: 4% more damage, 4% attack and cast speed',
  'power.max': 'flat: more power charges (base 3); each: 40% increased crit chance, +5% crit multiplier',
  'charge.duration': 'inc/more: how long charges last (base 10 s)',
  'charge.onKill': 'flat chance per kill to gain a charge; scope it with the charge tag (endurance / frenzy / power)',
  'charge.onHit': 'flat chance per landed hit to gain a charge (scoped by the charge tag)',
  'charge.onCrit': 'flat chance per critical strike to gain a charge (scoped by the charge tag)',
  'charge.onStun': 'flat chance per stun dealt to gain a charge (scoped by the charge tag)',
  // curses (combat/curses.ts)
  'curse.count': 'flat: more curses you keep on one target (base 1)',
  'curse.duration': 'inc/more: how long your curses last',
  'curse.effect': 'inc/more: the strength of your curses',
  'curse.immune': 'flag: curses do nothing to this actor',
  // totems and traps (combat/totems.ts, combat/deliveries/trap.ts)
  'totem.count': 'flat: more totems at once (base 1)',
  'totem.life': 'inc/more: totem life (base 60% of yours)',
  'totem.speed': 'inc/more: totem placement speed',
  'trap.count': 'flat: more traps armed at once (base 3)',
  'trap.speed': 'inc/more: trap throwing speed',
  'trap.arm': 'inc/more: trap arming time',
  // auras
  'mana.reservation': 'inc/more: mana (life with Blood Magic) your auras reserve',
  'aura.radius': 'inc/more: aura radius',
  'thorns.reflect': 'flat fraction of melee damage taken dealt back to the attacker (and harsher Thornweave vines)',
  'shatter.chance': 'flat chance for an enemy you kill to shatter (Frostglass)',
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
