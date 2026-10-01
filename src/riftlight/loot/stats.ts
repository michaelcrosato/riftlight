/**
 * The stat vocabulary loot speaks, and how item mods read in a tooltip. Stats are plain
 * strings (docs/GAME.md, "One modifier language"); this file only names them for humans.
 *
 * Conventions (see the "Loot" section of docs/GAME.md):
 * - `local.*` stats exist only on an item: `itemMods` folds them into the item's own base
 *   (weapon damage, armour) and never hands them to a StatSheet.
 * - Weapon base stats reach the sheet as `weapon.<type>.min/max`, `attack.speed.base`,
 *   `crit.chance.base` and `weapon.range`; armour bases as flat `armour`, `evasion`,
 *   `energy.shield` and `block.chance`.
 * - Resistances, leech, block, crit multiplier and ailment chances are fractions
 *   (0.3 = 30%) even when they are `flat`.
 */
import { describeMod, type Mod } from '../core/mods';
import { DAMAGE_TYPES } from '../core/types';

/** Human names for stats (uppercased by the pixel font anyway). */
export const STAT_NAMES: Readonly<Record<string, string>> = {
  life: 'maximum life',
  mana: 'maximum mana',
  'energy.shield': 'maximum energy shield',
  'life.regen': 'life regenerated per second',
  'mana.regen': 'mana regeneration rate',
  armour: 'armour',
  evasion: 'evasion',
  'block.chance': 'chance to block',
  'res.fire': 'fire resistance',
  'res.cold': 'cold resistance',
  'res.lightning': 'lightning resistance',
  'res.chaos': 'chaos resistance',
  damage: 'damage',
  'physical.damage': 'physical damage',
  'fire.damage': 'fire damage',
  'cold.damage': 'cold damage',
  'lightning.damage': 'lightning damage',
  'chaos.damage': 'chaos damage',
  'attack.speed': 'attack speed',
  'cast.speed': 'cast speed',
  'crit.chance': 'critical strike chance',
  'crit.multi': 'critical strike multiplier',
  'move.speed': 'movement speed',
  'life.leech': 'of damage leeched as life',
  'mana.leech': 'of damage leeched as mana',
  'life.onKill': 'life gained on kill',
  'mana.onKill': 'mana gained on kill',
  'skill.level': 'to level of skill gems',
  'light.radius': 'light radius',
  'gold.find': 'gold found',
  'item.rarity': 'rarity of items found',
  'item.quantity': 'quantity of items found',
  area: 'area of effect',
  'projectile.speed': 'projectile speed',
  projectiles: 'additional projectiles',
  'cooldown.recovery': 'cooldown recovery rate',
  'mana.cost': 'mana cost of skills',
  'ignite.chance': 'chance to ignite',
  'freeze.chance': 'chance to freeze',
  'shock.chance': 'chance to shock',
  'bleed.chance': 'chance to cause bleeding',
  'poison.chance': 'chance to poison',
  knockback: 'knockback',
  'dodge.recovery': 'dodge roll recovery',
  'weapon.range': 'weapon range',
  'attack.speed.base': 'base attacks per second',
  'crit.chance.base': 'base critical strike chance',
  // Riftlight mechanics (docs/GAME.md, "The 12 designed levels")
  'brazier.damage': 'brazier explosion damage',
  'brazier.area': 'brazier explosion area',
  'brazier.selfIgnite': 'brazier explosions set you alight instead of hurting you',
  'explosion.damage': 'damage of explosions you cause',
  'echo.damage': 'echo damage',
  'echo.delay': 'echo delay',
  'lantern.duration': 'duration of lantern buffs',
  'wind.resist': 'resistance to wind push',
  'well.resist': 'resistance to gravity well pull',
  'well.immune': 'immune to gravity wells',
  'mire.immune': 'unaffected by mire',
  'haste.duration': 'haste pad duration',
  'thorns.reflect': 'physical damage reflected to attackers',
  'thorns.immune': 'immune to vine traps',
  'pylon.chain': 'additional pylon chains',
  'shatter.chance': 'chance for enemies you kill to shatter',
  'collapse.bonusLoot': 'collapse bonus loot',
  'collapse.fallImmune': 'crumbling floors hold under you',
  'echo.repeatsSkills': 'your echo repeats every skill twice',
  'gate.damage': 'damage after crossing a riftgate',
  'block.spells': 'block applies to spells',
  'leech.instant': 'life leech is instant',
  'minion.life': 'minion life',
  'minion.speed': 'minion attack, cast and movement speed',
  'curse.immune': 'unaffected by curses',
  'charge.onKill': 'chance to gain a charge on kill',
  'charge.onHit': 'chance to gain a charge on hit',
  'charge.onCrit': 'chance to gain a charge on critical strike',
  'charge.onStun': 'chance to gain a charge when you stun',
  'stun.duration': 'stun duration',
};

/** Stats whose flat values are fractions, shown as percentages. */
export const PERCENT_STATS: ReadonlySet<string> = new Set([
  'res.fire',
  'res.cold',
  'res.lightning',
  'res.chaos',
  'block.chance',
  'crit.multi',
  'crit.chance.base',
  'life.leech',
  'mana.leech',
  'ignite.chance',
  'freeze.chance',
  'shock.chance',
  'bleed.chance',
  'poison.chance',
  'shatter.chance',
  'thorns.reflect',
  'charge.onKill',
  'charge.onHit',
  'charge.onCrit',
  'charge.onStun',
]);

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const num = (v: number) => (Math.abs(v) >= 10 ? `${Math.round(v)}` : `${Math.round(v * 100) / 100}`);

function scopeText(m: Mod): string {
  const tags = m.tags ?? [];
  if (!tags.length) return '';
  if (tags.length === 1 && tags[0] === 'attack') return ' with attacks';
  if (tags.length === 1 && tags[0] === 'spell') return ' with spells';
  if (tags.length === 1 && ['projectile', 'minion', 'melee', 'area'].includes(tags[0]!)) return ` with ${tags[0]} skills`;
  return ` with ${tags.join(' ')}`;
}

function whenText(m: Mod): string {
  return m.when ? ` while ${m.when.replace(/([A-Z])/g, ' $1').toLowerCase()}` : '';
}

/**
 * Tooltip text for one item mod. Handles percent stats, skill levels and flags; falls back
 * to the core `describeMod` with `STAT_NAMES`.
 */
export function describeItemMod(m: Mod): string {
  const name = STAT_NAMES[m.stat] ?? m.stat.replace(/\./g, ' ');
  if (m.stat === 'skill.level') {
    const what = m.tags?.length ? `${m.tags.join(' ')} skill gems` : 'all skill gems';
    return `${m.value >= 0 ? '+' : ''}${num(m.value)} to level of ${what}`;
  }
  if (m.kind === 'flat' && PERCENT_STATS.has(m.stat)) {
    const sign = m.value >= 0 ? '+' : '-';
    return `${sign}${pct(Math.abs(m.value))} ${name}${scopeText(m)}${whenText(m)}`;
  }
  if (m.kind === 'flag') return `${name}${scopeText(m)}${whenText(m)}`;
  if (m.kind === 'inc' || m.kind === 'more') {
    const word = m.kind === 'inc' ? (m.value >= 0 ? 'increased' : 'reduced') : m.value >= 0 ? 'more' : 'less';
    return `${pct(Math.abs(m.value))} ${word} ${name}${scopeText(m)}${whenText(m)}`;
  }
  return describeMod(m, STAT_NAMES);
}

/**
 * Tooltip lines for a list of mods: `added.<type>.min` + `added.<type>.max` with the same
 * tags read as one "Adds 3 to 7 fire damage" line; everything else one line per mod.
 */
export function describeItemMods(mods: readonly Mod[]): string[] {
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
        const type = pair[2]!;
        const local = pair[1] ? '' : m.tags?.includes('spell') ? ' to spells' : m.tags?.includes('attack') ? ' to attacks' : '';
        out.push(`Adds ${num(m.value)} to ${num(mods[j]!.value)} ${type} damage${local}${whenText(m)}`);
        return;
      }
    }
    if (m.stat.startsWith('local.')) {
      const stat = m.stat.slice(6);
      out.push(describeItemMod({ ...m, stat: LOCAL_AS[stat] ?? stat }));
      return;
    }
    out.push(describeItemMod(m));
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
