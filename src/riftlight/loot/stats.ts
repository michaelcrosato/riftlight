/**
 * The stat vocabulary loot speaks, and how item mods read in a tooltip. Stats are plain
 * strings (docs/GAME.md *One modifier language*); this file only names them for humans.
 *
 * Conventions (see docs/game/loot.md):
 * - `local.*` stats exist only on an item: `itemMods` folds them into the item's own base
 *   (weapon damage, armour) and never hands them to a StatSheet.
 * - Weapon base stats reach the sheet as `weapon.<type>.min/max`, `attack.speed.base`,
 *   `crit.chance.base` and `weapon.range`; armour bases as flat `armour`, `evasion`,
 *   `energy.shield` and `block.chance`.
 * - Resistances, leech, block, crit multiplier and ailment chances are fractions
 *   (0.3 = 30%) even when they are `flat`.
 */
import type { Mod } from '../core/mods';
import { DAMAGE_TYPES } from '../core/types';
import { lineKey } from '../lang/area';
import { lang } from '../lang/index';
import { conditionName, modNumber, modText, PERCENT_STATS, STAT_NAMES } from '../lang/mods';

/** Stat names and the stats counted in percent: the game's one table (lang/mods.ts). */
export { PERCENT_STATS, STAT_NAMES };

/** Tooltip text for one item mod, in the player's language (lang/mods.ts `modText`). */
export function describeItemMod(m: Mod): string {
  return modText(m);
}

/**
 * Tooltip lines for a list of mods: `added.<type>.min` + `added.<type>.max` with the same
 * tags read as one "Adds 3 to 7 fire damage" line; `local.*` stats as the stat they add to;
 * everything else one line per mod.
 */
export function describeItemMods(mods: readonly Mod[]): string[] {
  const l = lang();
  const out: string[] = [];
  const used = new Set<number>();
  mods.forEach((m, i) => {
    if (used.has(i)) return;
    const pair = /^(local\.)?added\.(\w+)\.min$/.exec(m.stat);
    if (pair) {
      const maxStat = m.stat.replace(/\.min$/, '.max');
      const j = mods.findIndex((o, k) => k > i && !used.has(k) && o.stat === maxStat && sameTags(o, m));
      if (j >= 0) {
        used.add(j);
        const to = pair[1] ? '' : m.tags?.includes('spell') ? '.spells' : m.tags?.includes('attack') ? '.attacks' : '';
        const line = l.t(`mod.added${to}`, { min: modNumber(m.value), max: modNumber(mods[j]!.value), type: l.t(lineKey('damage', pair[2]!)) });
        out.push(m.when ? l.t('mod.while', { mod: line, condition: conditionName(m.when, l) }) : line);
        return;
      }
    }
    if (m.stat.startsWith('local.')) {
      const stat = m.stat.slice(6);
      out.push(modText({ ...m, stat: LOCAL_AS[stat] ?? stat }, l));
      return;
    }
    out.push(modText(m, l));
  });
  return out;
}

/** Local stats that read as a different global stat name. */
const LOCAL_AS: Readonly<Record<string, string>> = { physical: 'physical.damage', block: 'block.chance' };

function sameTags(a: Mod, b: Mod): boolean {
  return (a.tags ?? []).join() === (b.tags ?? []).join() && a.when === b.when;
}

/** Damage types in display order (re-exported for tooltips and generators). */
export { DAMAGE_TYPES };
