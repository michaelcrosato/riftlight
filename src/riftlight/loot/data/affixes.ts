/**
 * Explicit affixes, PoE style: prefixes and suffixes with 5–8 tiers each, gated by item
 * level. Every number here is hand-tuned; the helpers only spell the tiers compactly.
 *
 * - `on`: base tags it can roll on (any match). See data/bases.ts for the tag vocabulary.
 * - `group`: affixes sharing a group never roll together (e.g. the three "local armour"
 *   affixes, or flat fire to attacks on a weapon vs on a ring).
 * - `weight`: relative pick weight among the affixes that fit (default 100).
 * - tiers are in ascending item level; tier 0 is the weakest. Tooltips call the best tier
 *   "T1" (PoE convention): `T = tiers.length - index`.
 * - percentages are fractions (0.25 = 25%); rows below are written in whole percent and
 *   scaled by `pct`.
 */
import type { Mod } from '../../core/mods';
import type { Affix, AffixTier } from '../../core/types';

type Kind = Mod['kind'];
type Row3 = readonly [level: number, min: number, max: number];
type Row5 = readonly [level: number, minLo: number, minHi: number, maxLo: number, maxHi: number];

/** One mod per tier. */
function one(stat: string, kind: Kind, rows: readonly Row3[], tags?: readonly string[], when?: string): AffixTier[] {
  return rows.map(([level, min, max]) => ({ level, mods: [{ stat, kind, min, max, ...(tags ? { tags } : {}), ...(when ? { when } : {}) }] }));
}

/** Whole-percent rows → fractions. */
function pct(rows: readonly Row3[]): Row3[] {
  return rows.map(([l, a, b]) => [l, a / 100, b / 100] as const);
}

/** "Adds X to Y" damage: two mods (min stat and max stat) per tier. */
function adds(prefix: string, rows: readonly Row5[], tags?: readonly string[]): AffixTier[] {
  return rows.map(([level, a, b, c, d]) => ({
    level,
    mods: [
      { stat: `${prefix}.min`, kind: 'flat' as Kind, min: a, max: b, ...(tags ? { tags } : {}) },
      { stat: `${prefix}.max`, kind: 'flat' as Kind, min: c, max: d, ...(tags ? { tags } : {}) },
    ],
  }));
}

/** Several stats per tier with the same rolled range (hybrids, "all elemental resistances"). */
function many(stats: readonly (readonly [string, Kind])[], rows: readonly Row3[], tags?: readonly string[]): AffixTier[] {
  return rows.map(([level, min, max]) => ({ level, mods: stats.map(([stat, kind]) => ({ stat, kind, min, max, ...(tags ? { tags } : {}) })) }));
}

/** Two different stats per tier with their own ranges. */
function hybrid(a: readonly [string, Kind], b: readonly [string, Kind], rows: readonly (readonly [number, number, number, number, number])[]): AffixTier[] {
  return rows.map(([level, a1, a2, b1, b2]) => ({
    level,
    mods: [
      { stat: a[0], kind: a[1], min: a1, max: a2 },
      { stat: b[0], kind: b[1], min: b1, max: b2 },
    ],
  }));
}

/** +N to skill gem levels, with a % damage rider on the in-between tiers (PoE2 style). */
function skillLevels(tag: string | null, damageStat: string): AffixTier[] {
  const tags = tag ? [tag] : undefined;
  const lvl = (level: number, n: number, dmg?: [number, number]): AffixTier => ({
    level,
    mods: [{ stat: 'skill.level', kind: 'flat', min: n, max: n, ...(tags ? { tags } : {}) }, ...(dmg ? [{ stat: damageStat, kind: 'inc' as Kind, min: dmg[0] / 100, max: dmg[1] / 100 }] : [])],
  });
  return [lvl(2, 1), lvl(18, 1, [6, 10]), lvl(36, 2), lvl(55, 2, [10, 15]), lvl(75, 3)];
}

const WEAPON = ['weapon'];
const ATTACK_WEAPON = ['attack'];
const CASTER = ['caster'];
const LIFE_ON = ['armour', 'jewellery', 'belt'];
const RES_ON = ['armour', 'jewellery', 'belt'];
const ATTACK_JEWEL = ['ring', 'amulet', 'gloves', 'quiver'];

type A = Omit<Affix, 'type'>;
const prefix = (a: A): Affix => ({ weight: 100, ...a, type: 'prefix' });
const suffix = (a: A): Affix => ({ weight: 100, ...a, type: 'suffix' });

// ---------------------------------------------------------------- prefixes

const PREFIXES: readonly Affix[] = [
  // --- weapon damage (local: improves the weapon's own numbers)
  prefix({ id: 'local-phys-inc', name: 'Heavy', on: ATTACK_WEAPON, group: 'local-phys', tags: ['physical', 'damage', 'attack'],
    tiers: one('local.physical', 'inc', pct([[1, 15, 24], [8, 25, 34], [16, 35, 49], [25, 50, 64], [35, 65, 84], [46, 85, 109], [60, 110, 134], [75, 135, 164]])) }),
  prefix({ id: 'local-phys-flat', name: 'Glinting', on: ATTACK_WEAPON, group: 'local-phys-flat', tags: ['physical', 'damage', 'attack'],
    tiers: adds('local.added.physical', [[1, 1, 2, 3, 5], [10, 3, 5, 6, 9], [19, 5, 7, 10, 14], [28, 7, 10, 15, 20], [38, 10, 14, 21, 27], [50, 13, 18, 28, 36], [64, 17, 23, 36, 46]]) }),
  prefix({ id: 'local-fire-flat', name: 'Heated', on: ATTACK_WEAPON, group: 'local-fire-flat', tags: ['fire', 'damage', 'attack', 'elemental'],
    tiers: adds('local.added.fire', [[1, 1, 3, 4, 7], [11, 4, 7, 9, 14], [20, 8, 12, 16, 24], [30, 13, 19, 26, 36], [42, 20, 28, 38, 52], [55, 29, 38, 54, 70], [70, 40, 52, 72, 92]]) }),
  prefix({ id: 'local-cold-flat', name: 'Frosted', on: ATTACK_WEAPON, group: 'local-cold-flat', tags: ['cold', 'damage', 'attack', 'elemental'],
    tiers: adds('local.added.cold', [[1, 1, 3, 3, 6], [11, 4, 6, 8, 12], [20, 7, 10, 14, 21], [30, 11, 16, 22, 32], [42, 17, 24, 33, 46], [55, 25, 33, 47, 62], [70, 35, 45, 64, 82]]) }),
  prefix({ id: 'local-lightning-flat', name: 'Sparking', on: ATTACK_WEAPON, group: 'local-lightning-flat', tags: ['lightning', 'damage', 'attack', 'elemental'],
    tiers: adds('local.added.lightning', [[1, 1, 1, 5, 9], [11, 1, 2, 14, 20], [20, 1, 3, 26, 36], [30, 2, 4, 40, 54], [42, 2, 6, 58, 78], [55, 3, 8, 80, 104], [70, 4, 10, 106, 134]]) }),
  prefix({ id: 'local-chaos-flat', name: 'Tainted', on: ATTACK_WEAPON, group: 'local-chaos-flat', weight: 40, tags: ['chaos', 'damage', 'attack'],
    tiers: adds('local.added.chaos', [[15, 4, 7, 10, 15], [27, 8, 12, 17, 25], [40, 13, 19, 27, 38], [54, 20, 28, 40, 54], [68, 29, 39, 56, 74], [82, 40, 52, 76, 98]]) }),
  // --- spell damage (caster weapons)
  prefix({ id: 'spell-damage', name: "Apprentice's", on: CASTER, group: 'spell-damage', tags: ['damage', 'spell'],
    tiers: one('damage', 'inc', pct([[1, 10, 19], [9, 20, 29], [18, 30, 39], [28, 40, 54], [40, 55, 69], [54, 70, 84], [68, 85, 99], [82, 100, 119]]), ['spell']) }),
  prefix({ id: 'spell-fire', name: 'Smouldering', on: CASTER, group: 'spell-element', tags: ['fire', 'damage', 'spell', 'elemental'],
    tiers: one('fire.damage', 'inc', pct([[1, 12, 22], [12, 23, 34], [24, 35, 49], [36, 50, 64], [50, 65, 84], [66, 85, 109]]), ['spell']) }),
  prefix({ id: 'spell-cold', name: 'Bitter', on: CASTER, group: 'spell-element', tags: ['cold', 'damage', 'spell', 'elemental'],
    tiers: one('cold.damage', 'inc', pct([[1, 12, 22], [12, 23, 34], [24, 35, 49], [36, 50, 64], [50, 65, 84], [66, 85, 109]]), ['spell']) }),
  prefix({ id: 'spell-lightning', name: 'Charged', on: CASTER, group: 'spell-element', tags: ['lightning', 'damage', 'spell', 'elemental'],
    tiers: one('lightning.damage', 'inc', pct([[1, 12, 22], [12, 23, 34], [24, 35, 49], [36, 50, 64], [50, 65, 84], [66, 85, 109]]), ['spell']) }),
  prefix({ id: 'spell-added-fire', name: 'Kindled', on: CASTER, group: 'spell-added-fire', tags: ['fire', 'damage', 'spell', 'elemental'],
    tiers: adds('added.fire', [[1, 1, 2, 3, 5], [12, 3, 5, 7, 11], [24, 6, 9, 13, 19], [36, 10, 14, 21, 29], [50, 15, 21, 31, 42], [66, 22, 30, 44, 58]], ['spell']) }),
  prefix({ id: 'spell-added-cold', name: 'Rimed', on: CASTER, group: 'spell-added-cold', tags: ['cold', 'damage', 'spell', 'elemental'],
    tiers: adds('added.cold', [[1, 1, 2, 3, 4], [12, 3, 4, 6, 10], [24, 5, 8, 12, 17], [36, 9, 12, 19, 26], [50, 13, 18, 28, 38], [66, 19, 26, 40, 52]], ['spell']) }),
  prefix({ id: 'spell-added-lightning', name: 'Static', on: CASTER, group: 'spell-added-lightning', tags: ['lightning', 'damage', 'spell', 'elemental'],
    tiers: adds('added.lightning', [[1, 1, 1, 4, 7], [12, 1, 2, 10, 16], [24, 1, 3, 19, 27], [36, 2, 4, 30, 41], [50, 2, 5, 44, 58], [66, 3, 7, 62, 80]], ['spell']) }),
  prefix({ id: 'weapon-elemental', name: 'Prismatic', on: WEAPON, group: 'weapon-elemental', weight: 60, tags: ['damage', 'elemental', 'fire', 'cold', 'lightning'],
    tiers: many([['fire.damage', 'inc'], ['cold.damage', 'inc'], ['lightning.damage', 'inc']], pct([[4, 8, 12], [15, 13, 18], [27, 19, 25], [40, 26, 33], [55, 34, 42], [72, 43, 52]])) }),
  // --- jewellery damage
  prefix({ id: 'global-phys', name: 'Honed', on: ['amulet', 'ring', 'belt'], group: 'global-phys', tags: ['physical', 'damage'],
    tiers: one('physical.damage', 'inc', pct([[1, 5, 9], [10, 10, 14], [22, 15, 19], [35, 20, 24], [50, 25, 30], [66, 31, 36]])) }),
  prefix({ id: 'attack-damage', name: 'Brutal', on: ['amulet', 'ring', 'gloves'], group: 'attack-damage', tags: ['damage', 'attack'],
    tiers: one('damage', 'inc', pct([[1, 4, 8], [12, 9, 13], [24, 14, 18], [38, 19, 23], [54, 24, 28], [70, 29, 34]]), ['attack']) }),
  prefix({ id: 'added-phys-attack', name: 'Barbed', on: ATTACK_JEWEL, group: 'added-phys-attack', tags: ['physical', 'damage', 'attack'],
    tiers: adds('added.physical', [[2, 1, 1, 2, 3], [13, 1, 2, 3, 5], [24, 2, 3, 5, 7], [36, 3, 5, 7, 10], [50, 4, 6, 10, 13], [65, 6, 8, 12, 16]], ['attack']) }),
  prefix({ id: 'added-fire-attack', name: 'Searing', on: ATTACK_JEWEL, group: 'added-fire-attack', tags: ['fire', 'damage', 'attack', 'elemental'],
    tiers: adds('added.fire', [[1, 1, 2, 3, 4], [12, 3, 4, 6, 9], [24, 5, 7, 10, 14], [36, 7, 10, 15, 20], [50, 10, 13, 20, 26], [66, 13, 17, 26, 33]], ['attack']) }),
  prefix({ id: 'added-cold-attack', name: 'Frigid', on: ATTACK_JEWEL, group: 'added-cold-attack', tags: ['cold', 'damage', 'attack', 'elemental'],
    tiers: adds('added.cold', [[1, 1, 2, 3, 4], [12, 3, 4, 6, 8], [24, 4, 6, 9, 13], [36, 6, 9, 13, 18], [50, 9, 12, 18, 24], [66, 12, 15, 24, 30]], ['attack']) }),
  prefix({ id: 'added-lightning-attack', name: 'Crackling', on: ATTACK_JEWEL, group: 'added-lightning-attack', tags: ['lightning', 'damage', 'attack', 'elemental'],
    tiers: adds('added.lightning', [[1, 1, 1, 4, 6], [12, 1, 2, 8, 12], [24, 1, 2, 14, 19], [36, 1, 3, 20, 27], [50, 2, 4, 28, 36], [66, 2, 5, 36, 46]], ['attack']) }),
  prefix({ id: 'melee-damage', name: 'Fierce', on: ['melee', 'gloves', 'amulet'], group: 'melee-damage', tags: ['damage', 'melee', 'attack'],
    tiers: one('damage', 'inc', pct([[1, 6, 10], [12, 11, 15], [25, 16, 21], [38, 22, 27], [52, 28, 33], [68, 34, 40]]), ['melee']) }),
  prefix({ id: 'projectile-damage', name: "Fletcher's", on: ['bow', 'quiver', 'wand'], group: 'projectile-damage', tags: ['damage', 'projectile'],
    tiers: one('damage', 'inc', pct([[1, 8, 14], [12, 15, 22], [25, 23, 31], [38, 32, 41], [52, 42, 52], [68, 53, 64]]), ['projectile']) }),
  prefix({ id: 'area-damage', name: 'Sweeping', on: ['twohand', 'amulet'], group: 'area-damage', tags: ['damage', 'area'],
    tiers: one('damage', 'inc', pct([[4, 8, 14], [16, 15, 22], [28, 23, 31], [42, 32, 41], [56, 42, 52], [72, 53, 64]]), ['area']) }),
  // minions wear no gear: these are their weapon (added damage grows by item level like a weapon's)
  prefix({ id: 'minion-damage', name: "Commander's", on: ['helm', 'caster', 'amulet', 'shield'], group: 'minion-damage', weight: 80, tags: ['damage', 'minion'],
    tiers: one('damage', 'inc', pct([[4, 10, 19], [16, 20, 29], [28, 30, 39], [42, 40, 54], [56, 55, 69], [72, 70, 84]]), ['minion']) }),
  prefix({ id: 'minion-added-physical', name: "Gravecaller's", on: ['caster', 'amulet', 'ring', 'gloves'], group: 'minion-added', weight: 60, tags: ['damage', 'minion', 'physical'],
    tiers: adds('added.physical', [[2, 1, 2, 3, 5], [10, 3, 5, 6, 9], [19, 5, 7, 10, 14], [28, 7, 10, 15, 20], [38, 10, 14, 21, 27], [50, 13, 18, 28, 36], [64, 17, 23, 36, 46]], ['minion']) }),
  // --- skill gem levels
  prefix({ id: 'skill-fire', name: 'Pyromancer\'s', on: ['caster', 'amulet', 'helm'], group: 'skill-level-elemental', weight: 30, tags: ['fire', 'skill', 'gem'], tiers: skillLevels('fire', 'fire.damage') }),
  prefix({ id: 'skill-cold', name: 'Cryomancer\'s', on: ['caster', 'amulet', 'helm'], group: 'skill-level-elemental', weight: 30, tags: ['cold', 'skill', 'gem'], tiers: skillLevels('cold', 'cold.damage') }),
  prefix({ id: 'skill-lightning', name: 'Stormcaller\'s', on: ['caster', 'amulet', 'helm'], group: 'skill-level-elemental', weight: 30, tags: ['lightning', 'skill', 'gem'], tiers: skillLevels('lightning', 'lightning.damage') }),
  prefix({ id: 'skill-chaos', name: 'Riftbound', on: ['caster', 'amulet'], group: 'skill-level-chaos', weight: 20, tags: ['chaos', 'skill', 'gem'], tiers: skillLevels('chaos', 'chaos.damage') }),
  prefix({ id: 'skill-physical', name: 'Warlord\'s', on: ['attack', 'amulet'], group: 'skill-level-physical', weight: 25, tags: ['physical', 'skill', 'gem'], tiers: skillLevels('physical', 'physical.damage') }),
  prefix({ id: 'skill-melee', name: 'Champion\'s', on: ['melee', 'gloves', 'amulet'], group: 'skill-level-style', weight: 25, tags: ['melee', 'skill', 'gem'], tiers: skillLevels('melee', 'attack.speed') }),
  prefix({ id: 'skill-projectile', name: 'Marksman\'s', on: ['bow', 'quiver', 'amulet'], group: 'skill-level-style', weight: 25, tags: ['projectile', 'skill', 'gem'], tiers: skillLevels('projectile', 'projectile.speed') }),
  prefix({ id: 'skill-minion', name: 'Necromancer\'s', on: ['caster', 'helm'], group: 'skill-level-style', weight: 20, tags: ['minion', 'skill', 'gem'], tiers: skillLevels('minion', 'minion.life') }),
  // --- life, mana, energy shield
  prefix({ id: 'life', name: 'Hale', on: LIFE_ON, group: 'life', weight: 160, tags: ['life', 'defence'],
    tiers: one('life', 'flat', [[1, 10, 19], [8, 20, 29], [16, 30, 39], [26, 40, 54], [36, 55, 69], [48, 70, 84], [62, 85, 99], [78, 100, 119]]) }),
  prefix({ id: 'life-inc', name: 'Vital', on: ['body', 'belt', 'amulet'], group: 'life-inc', weight: 50, tags: ['life', 'defence'],
    tiers: one('life', 'inc', pct([[10, 3, 5], [24, 6, 8], [38, 9, 11], [52, 12, 14], [68, 15, 17], [84, 18, 21]])) }),
  prefix({ id: 'mana', name: 'Azure', on: ['helm', 'gloves', 'boots', 'body', 'jewellery', 'caster'], group: 'mana', tags: ['mana'],
    tiers: one('mana', 'flat', [[1, 10, 19], [10, 20, 29], [20, 30, 39], [32, 40, 49], [45, 50, 64], [60, 65, 79], [76, 80, 94]]) }),
  prefix({ id: 'global-es', name: 'Shimmering', on: ['amulet', 'ring', 'belt'], group: 'global-es', tags: ['es', 'defence'],
    tiers: one('energy.shield', 'flat', [[3, 3, 6], [12, 7, 11], [24, 12, 16], [36, 17, 22], [50, 23, 29], [66, 30, 37]]) }),
  prefix({ id: 'es-inc', name: 'Radiant', on: ['amulet'], group: 'es-inc', weight: 50, tags: ['es', 'defence'],
    tiers: one('energy.shield', 'inc', pct([[10, 4, 6], [24, 7, 9], [38, 10, 12], [52, 13, 15], [68, 16, 18]])) }),
  prefix({ id: 'belt-armour', name: 'Plated', on: ['belt'], group: 'belt-armour', tags: ['armour', 'defence'],
    tiers: one('armour', 'flat', [[1, 20, 39], [12, 40, 79], [24, 80, 129], [38, 130, 189], [54, 190, 259], [70, 260, 339]]) }),
  // --- local defences
  prefix({ id: 'local-armour', name: 'Lacquered', on: ['ar'], group: 'local-defence-flat', tags: ['armour', 'defence'],
    tiers: one('local.armour', 'flat', [[1, 6, 12], [10, 13, 26], [20, 27, 44], [30, 45, 68], [42, 69, 98], [56, 99, 134], [72, 135, 175]]) }),
  prefix({ id: 'local-evasion', name: 'Agile', on: ['ev'], group: 'local-defence-flat', tags: ['evasion', 'defence'],
    tiers: one('local.evasion', 'flat', [[1, 6, 12], [10, 13, 26], [20, 27, 44], [30, 45, 68], [42, 69, 98], [56, 99, 134], [72, 135, 175]]) }),
  prefix({ id: 'local-es', name: 'Glimmering', on: ['es'], group: 'local-defence-flat', tags: ['es', 'defence'],
    tiers: one('local.energy.shield', 'flat', [[1, 3, 6], [10, 7, 11], [20, 12, 17], [30, 18, 24], [42, 25, 33], [56, 34, 44], [72, 45, 56]]) }),
  prefix({ id: 'local-armour-inc', name: 'Reinforced', on: ['ar'], group: 'local-defence-inc', tags: ['armour', 'defence'],
    tiers: one('local.armour', 'inc', pct([[1, 15, 26], [12, 27, 42], [24, 43, 55], [36, 56, 67], [50, 68, 79], [66, 80, 91], [80, 92, 110]])) }),
  prefix({ id: 'local-evasion-inc', name: 'Shadowed', on: ['ev'], group: 'local-defence-inc', tags: ['evasion', 'defence'],
    tiers: one('local.evasion', 'inc', pct([[1, 15, 26], [12, 27, 42], [24, 43, 55], [36, 56, 67], [50, 68, 79], [66, 80, 91], [80, 92, 110]])) }),
  prefix({ id: 'local-es-inc', name: 'Warded', on: ['es'], group: 'local-defence-inc', tags: ['es', 'defence'],
    tiers: one('local.energy.shield', 'inc', pct([[1, 15, 26], [12, 27, 42], [24, 43, 55], [36, 56, 67], [50, 68, 79], [66, 80, 91], [80, 92, 110]])) }),
  prefix({ id: 'hybrid-armour-life', name: 'Stalwart', on: ['ar'], group: 'local-defence-hybrid', weight: 60, tags: ['armour', 'life', 'defence'],
    tiers: hybrid(['local.armour', 'inc'], ['life', 'flat'], [[5, 0.06, 0.13, 7, 10], [18, 0.14, 0.2, 11, 15], [32, 0.21, 0.26, 16, 20], [46, 0.27, 0.32, 21, 25], [62, 0.33, 0.38, 26, 30], [78, 0.39, 0.42, 31, 35]]) }),
  prefix({ id: 'hybrid-evasion-life', name: 'Lithe', on: ['ev'], group: 'local-defence-hybrid', weight: 60, tags: ['evasion', 'life', 'defence'],
    tiers: hybrid(['local.evasion', 'inc'], ['life', 'flat'], [[5, 0.06, 0.13, 7, 10], [18, 0.14, 0.2, 11, 15], [32, 0.21, 0.26, 16, 20], [46, 0.27, 0.32, 21, 25], [62, 0.33, 0.38, 26, 30], [78, 0.39, 0.42, 31, 35]]) }),
  prefix({ id: 'hybrid-es-mana', name: "Seer's", on: ['es'], group: 'local-defence-hybrid', weight: 60, tags: ['es', 'mana', 'defence'],
    tiers: hybrid(['local.energy.shield', 'inc'], ['mana', 'flat'], [[5, 0.06, 0.13, 11, 15], [18, 0.14, 0.2, 16, 19], [32, 0.21, 0.26, 20, 22], [46, 0.27, 0.32, 23, 25], [62, 0.33, 0.38, 26, 28], [78, 0.39, 0.42, 29, 33]]) }),
  prefix({ id: 'move-speed', name: "Runner's", on: ['boots'], group: 'move-speed', weight: 120, tags: ['speed'],
    tiers: one('move.speed', 'inc', pct([[1, 10, 10], [15, 15, 15], [30, 20, 20], [45, 25, 25], [60, 30, 30], [80, 35, 35]])) }),
  // --- Riftlight mechanics
  prefix({ id: 'brazier-damage', name: 'Emberwrought', on: ['weapon', 'amulet', 'ring', 'gloves'], group: 'mechanic-damage', weight: 40, tags: ['mechanic', 'fire', 'damage'],
    tiers: one('brazier.damage', 'inc', pct([[1, 20, 34], [10, 35, 49], [20, 50, 69], [32, 70, 94], [46, 95, 124], [62, 125, 160]])) }),
  prefix({ id: 'dark-damage', name: "Gloomstalker's", on: ['weapon', 'amulet', 'helm'], group: 'mechanic-damage', weight: 40, tags: ['mechanic', 'damage'],
    tiers: one('damage', 'inc', pct([[2, 10, 17], [12, 18, 25], [24, 26, 34], [36, 35, 44], [50, 45, 56], [66, 57, 70]]), undefined, 'inDark') }),
  prefix({ id: 'ice-damage', name: "Rimewalker's", on: ['weapon', 'boots', 'ring'], group: 'mechanic-damage', weight: 40, tags: ['mechanic', 'damage', 'cold'],
    tiers: one('damage', 'inc', pct([[4, 10, 17], [14, 18, 25], [26, 26, 34], [38, 35, 44], [52, 45, 56], [68, 57, 70]]), undefined, 'onIce') }),
  prefix({ id: 'wind-damage', name: 'Galeborn', on: ['weapon', 'gloves', 'amulet'], group: 'mechanic-damage', weight: 40, tags: ['mechanic', 'damage'],
    tiers: one('damage', 'inc', pct([[3, 10, 17], [13, 18, 25], [25, 26, 34], [37, 35, 44], [51, 45, 56], [67, 57, 70]]), undefined, 'inWind') }),
  prefix({ id: 'pylon-lightning', name: 'Pylonbound', on: ['weapon', 'ring', 'helm'], group: 'mechanic-damage', weight: 40, tags: ['mechanic', 'damage', 'lightning'],
    tiers: one('lightning.damage', 'inc', pct([[6, 15, 24], [16, 25, 34], [28, 35, 49], [40, 50, 64], [54, 65, 84], [70, 85, 104]]), undefined, 'nearPylon') }),
  prefix({ id: 'echo-damage', name: 'Resonant', on: ['weapon', 'amulet'], group: 'mechanic-damage', weight: 30, tags: ['mechanic', 'damage'],
    tiers: one('echo.damage', 'inc', pct([[8, 15, 24], [18, 25, 34], [30, 35, 49], [42, 50, 64], [56, 65, 84], [72, 85, 104]])) }),
  prefix({ id: 'explosion-damage', name: 'Volatile', on: ['weapon', 'amulet', 'body'], group: 'mechanic-damage', weight: 30, tags: ['mechanic', 'damage', 'fire'],
    tiers: one('explosion.damage', 'inc', pct([[10, 20, 34], [20, 35, 49], [32, 50, 69], [44, 70, 94], [58, 95, 124], [74, 125, 160]])) }),
];

// ---------------------------------------------------------------- suffixes

const SUFFIXES: readonly Affix[] = [
  // --- minions
  suffix({ id: 'minion-speed', name: 'of the Horde', on: ['caster', 'gloves', 'amulet', 'shield'], group: 'minion-speed', weight: 60, tags: ['speed', 'minion'],
    tiers: one('minion.speed', 'inc', pct([[6, 5, 9], [18, 10, 14], [32, 15, 19], [48, 20, 24], [66, 25, 30]])) }),
  // --- speed and crit
  suffix({ id: 'local-attack-speed', name: 'of Skill', on: ATTACK_WEAPON, group: 'local-attack-speed', tags: ['speed', 'attack'],
    tiers: one('local.attack.speed', 'inc', pct([[1, 5, 7], [11, 8, 10], [22, 11, 13], [30, 14, 16], [37, 17, 19], [45, 20, 22], [60, 23, 25], [77, 26, 27]])) }),
  suffix({ id: 'attack-speed', name: 'of Haste', on: ['gloves', 'quiver', 'ring', 'amulet'], group: 'attack-speed', tags: ['speed', 'attack'],
    tiers: one('attack.speed', 'inc', pct([[1, 3, 4], [12, 5, 6], [24, 7, 8], [38, 9, 10], [54, 11, 13], [72, 14, 16]])) }),
  suffix({ id: 'cast-speed', name: 'of Talent', on: ['caster', 'amulet', 'ring'], group: 'cast-speed', tags: ['speed', 'spell'],
    tiers: one('cast.speed', 'inc', pct([[2, 5, 8], [10, 9, 12], [20, 13, 16], [32, 17, 20], [44, 21, 24], [56, 25, 28], [70, 29, 32], [84, 33, 36]])) }),
  suffix({ id: 'local-crit', name: 'of Precision', on: ATTACK_WEAPON, group: 'local-crit', tags: ['crit', 'attack'],
    tiers: one('local.crit.chance', 'inc', pct([[1, 10, 14], [10, 15, 19], [20, 20, 24], [30, 25, 29], [44, 30, 34], [58, 35, 38], [73, 39, 42]])) }),
  suffix({ id: 'global-crit', name: 'of Menace', on: ['amulet', 'quiver', 'helm', 'ring'], group: 'global-crit', tags: ['crit'],
    tiers: one('crit.chance', 'inc', pct([[5, 10, 14], [15, 15, 19], [28, 20, 24], [40, 25, 29], [54, 30, 34], [70, 35, 38]])) }),
  suffix({ id: 'crit-multi', name: 'of Ire', on: ['weapon', 'amulet', 'gloves', 'quiver'], group: 'crit-multi', tags: ['crit'],
    tiers: one('crit.multi', 'flat', pct([[8, 10, 14], [18, 15, 19], [30, 20, 24], [44, 25, 29], [58, 30, 34], [74, 35, 38]])) }),
  suffix({ id: 'spell-crit', name: 'of Foresight', on: CASTER, group: 'spell-crit', tags: ['crit', 'spell'],
    tiers: one('crit.chance', 'inc', pct([[4, 10, 19], [14, 20, 39], [26, 40, 59], [38, 60, 79], [52, 80, 99], [70, 100, 109]]), ['spell']) }),
  // --- resistances
  suffix({ id: 'res-fire', name: 'of the Kiln', on: RES_ON, group: 'res-fire', weight: 150, tags: ['res', 'fire', 'elemental', 'defence'],
    tiers: one('res.fire', 'flat', pct([[1, 6, 11], [12, 12, 17], [24, 18, 23], [36, 24, 29], [48, 30, 35], [60, 36, 41], [72, 42, 45], [84, 46, 48]])) }),
  suffix({ id: 'res-cold', name: 'of the Floe', on: RES_ON, group: 'res-cold', weight: 150, tags: ['res', 'cold', 'elemental', 'defence'],
    tiers: one('res.cold', 'flat', pct([[1, 6, 11], [14, 12, 17], [26, 18, 23], [38, 24, 29], [50, 30, 35], [60, 36, 41], [72, 42, 45], [84, 46, 48]])) }),
  suffix({ id: 'res-lightning', name: 'of the Squall', on: RES_ON, group: 'res-lightning', weight: 150, tags: ['res', 'lightning', 'elemental', 'defence'],
    tiers: one('res.lightning', 'flat', pct([[1, 6, 11], [13, 12, 17], [25, 18, 23], [37, 24, 29], [49, 30, 35], [60, 36, 41], [72, 42, 45], [84, 46, 48]])) }),
  suffix({ id: 'res-chaos', name: 'of the Rift', on: RES_ON, group: 'res-chaos', weight: 60, tags: ['res', 'chaos', 'defence'],
    tiers: one('res.chaos', 'flat', pct([[16, 5, 10], [30, 11, 15], [44, 16, 20], [56, 21, 25], [68, 26, 30], [81, 31, 35]])) }),
  suffix({ id: 'res-all', name: 'of the Prism', on: ['jewellery'], group: 'res-all', weight: 60, tags: ['res', 'elemental', 'defence'],
    tiers: many([['res.fire', 'flat'], ['res.cold', 'flat'], ['res.lightning', 'flat']], pct([[12, 3, 5], [24, 6, 8], [36, 9, 11], [48, 12, 14], [60, 15, 16], [75, 17, 18]])) }),
  suffix({ id: 'res-fire-cold', name: 'of Tempering', on: ['armour', 'belt'], group: 'res-hybrid', weight: 40, tags: ['res', 'fire', 'cold', 'elemental', 'defence'],
    tiers: many([['res.fire', 'flat'], ['res.cold', 'flat']], pct([[20, 6, 8], [32, 9, 11], [44, 12, 14], [56, 15, 17], [70, 18, 20]])) }),
  suffix({ id: 'res-cold-lightning', name: 'of the Thunderhead', on: ['armour', 'belt'], group: 'res-hybrid', weight: 40, tags: ['res', 'cold', 'lightning', 'elemental', 'defence'],
    tiers: many([['res.cold', 'flat'], ['res.lightning', 'flat']], pct([[20, 6, 8], [32, 9, 11], [44, 12, 14], [56, 15, 17], [70, 18, 20]])) }),
  suffix({ id: 'res-fire-lightning', name: 'of Cinderstorms', on: ['armour', 'belt'], group: 'res-hybrid', weight: 40, tags: ['res', 'fire', 'lightning', 'elemental', 'defence'],
    tiers: many([['res.fire', 'flat'], ['res.lightning', 'flat']], pct([[20, 6, 8], [32, 9, 11], [44, 12, 14], [56, 15, 17], [70, 18, 20]])) }),
  // --- recovery
  suffix({ id: 'life-regen', name: 'of Mending', on: ['armour', 'jewellery', 'belt'], group: 'life-regen', tags: ['life', 'defence'],
    tiers: one('life.regen', 'flat', [[1, 1, 2], [10, 3, 4], [20, 5, 7], [32, 8, 11], [44, 12, 16], [58, 17, 22], [74, 23, 30]]) }),
  suffix({ id: 'mana-regen', name: 'of Clarity', on: ['caster', 'jewellery', 'helm'], group: 'mana-regen', tags: ['mana'],
    tiers: one('mana.regen', 'inc', pct([[2, 10, 19], [12, 20, 29], [24, 30, 39], [36, 40, 49], [50, 50, 59], [66, 60, 69]])) }),
  suffix({ id: 'life-leech', name: 'of the Leech', on: ['attack', 'gloves', 'ring'], group: 'life-leech', weight: 60, tags: ['life', 'attack'],
    tiers: one('life.leech', 'flat', [[6, 0.002, 0.003], [16, 0.004, 0.005], [28, 0.006, 0.007], [40, 0.008, 0.009], [54, 0.01, 0.011], [70, 0.012, 0.014]]) }),
  suffix({ id: 'mana-leech', name: 'of Thirst', on: ['attack', 'gloves', 'ring'], group: 'mana-leech', weight: 50, tags: ['mana', 'attack'],
    tiers: one('mana.leech', 'flat', [[6, 0.002, 0.003], [16, 0.004, 0.005], [28, 0.006, 0.007], [40, 0.008, 0.009], [54, 0.01, 0.011]]) }),
  suffix({ id: 'life-on-kill', name: 'of Feasting', on: ['weapon', 'gloves', 'ring'], group: 'life-on-kill', tags: ['life'],
    tiers: one('life.onKill', 'flat', [[1, 2, 4], [10, 5, 8], [22, 9, 13], [34, 14, 19], [48, 20, 27], [64, 28, 36]]) }),
  suffix({ id: 'mana-on-kill', name: 'of Absorption', on: ['weapon', 'gloves', 'ring'], group: 'mana-on-kill', tags: ['mana'],
    tiers: one('mana.onKill', 'flat', [[1, 1, 2], [10, 3, 4], [22, 5, 6], [34, 7, 8], [48, 9, 11], [64, 12, 14]]) }),
  // --- finding things
  suffix({ id: 'light-radius', name: 'of the Lantern', on: ['helm', 'amulet', 'weapon', 'offhand'], group: 'light-radius', tags: ['light'],
    tiers: one('light.radius', 'inc', pct([[1, 5, 9], [10, 10, 14], [22, 15, 19], [36, 20, 24], [52, 25, 30]])) }),
  suffix({ id: 'gold-find', name: 'of Avarice', on: ['helm', 'amulet', 'ring', 'gloves', 'boots'], group: 'gold-find', weight: 60, tags: ['find'],
    tiers: one('gold.find', 'inc', pct([[3, 6, 10], [14, 11, 16], [26, 17, 22], [40, 23, 28], [56, 29, 35], [72, 36, 42]])) }),
  suffix({ id: 'item-rarity', name: 'of Plunder', on: ['helm', 'boots', 'gloves', 'amulet', 'ring'], group: 'item-rarity', weight: 60, tags: ['find'],
    tiers: one('item.rarity', 'inc', pct([[3, 6, 10], [14, 11, 14], [26, 15, 20], [40, 21, 25], [56, 26, 30], [72, 31, 35]])) }),
  suffix({ id: 'item-quantity', name: 'of Bounty', on: ['amulet', 'ring'], group: 'item-quantity', weight: 15, tags: ['find'],
    tiers: one('item.quantity', 'inc', pct([[10, 2, 3], [24, 4, 5], [40, 6, 7], [58, 8, 9], [76, 10, 12]])) }),
  // --- skill shape
  suffix({ id: 'area', name: 'of Reach', on: ['amulet', 'gloves', 'twohand'], group: 'area', tags: ['area'],
    tiers: one('area', 'inc', pct([[4, 4, 6], [16, 7, 9], [28, 10, 12], [42, 13, 15], [58, 16, 18], [74, 19, 22]])) }),
  suffix({ id: 'projectile-speed', name: 'of Flight', on: ['bow', 'quiver', 'wand'], group: 'projectile-speed', tags: ['projectile', 'speed'],
    tiers: one('projectile.speed', 'inc', pct([[1, 10, 17], [12, 18, 25], [24, 26, 33], [36, 34, 41], [50, 42, 50], [66, 51, 60]])) }),
  suffix({ id: 'cooldown', name: 'of the Hourglass', on: ['helm', 'amulet', 'belt'], group: 'cooldown', weight: 50, tags: ['speed'],
    tiers: one('cooldown.recovery', 'inc', pct([[8, 4, 6], [20, 7, 9], [34, 10, 12], [48, 13, 15], [64, 16, 18]])) }),
  suffix({ id: 'mana-cost', name: 'of Frugality', on: ['ring', 'amulet', 'helm'], group: 'mana-cost', weight: 50, tags: ['mana'],
    tiers: one('mana.cost', 'inc', pct([[4, -6, -4], [16, -9, -7], [28, -12, -10], [42, -15, -13], [58, -18, -16]])) }),
  suffix({ id: 'local-block', name: 'of the Bulwark', on: ['shield'], group: 'local-block', tags: ['block', 'defence'],
    tiers: one('local.block', 'flat', pct([[1, 1, 2], [12, 3, 3], [24, 4, 4], [38, 5, 5], [54, 6, 6], [70, 7, 8]])) }),
  suffix({ id: 'knockback', name: 'of Force', on: ['mace', 'twohand', 'gloves'], group: 'knockback', weight: 50, tags: ['attack'],
    tiers: one('knockback', 'inc', pct([[1, 10, 19], [12, 20, 29], [24, 30, 39], [38, 40, 54], [54, 55, 70]])) }),
  suffix({ id: 'dodge', name: 'of the Wind', on: ['boots', 'belt'], group: 'dodge', weight: 60, tags: ['speed'],
    tiers: one('dodge.recovery', 'inc', pct([[2, 5, 8], [14, 9, 12], [28, 13, 16], [42, 17, 20], [58, 21, 25]])) }),
  // --- ailments
  suffix({ id: 'ignite', name: 'of Kindling', on: ['weapon', 'gloves', 'quiver'], group: 'ailment', weight: 50, tags: ['ailment', 'fire'],
    tiers: one('ignite.chance', 'flat', pct([[2, 4, 6], [14, 7, 9], [26, 10, 12], [40, 13, 15], [56, 16, 18], [72, 19, 22]])) }),
  suffix({ id: 'freeze', name: 'of Rime', on: ['weapon', 'gloves', 'quiver'], group: 'ailment', weight: 50, tags: ['ailment', 'cold'],
    tiers: one('freeze.chance', 'flat', pct([[2, 4, 6], [14, 7, 9], [26, 10, 12], [40, 13, 15], [56, 16, 18], [72, 19, 22]])) }),
  suffix({ id: 'shock', name: 'of Sparks', on: ['weapon', 'gloves', 'quiver'], group: 'ailment', weight: 50, tags: ['ailment', 'lightning'],
    tiers: one('shock.chance', 'flat', pct([[2, 4, 6], [14, 7, 9], [26, 10, 12], [40, 13, 15], [56, 16, 18], [72, 19, 22]])) }),
  suffix({ id: 'bleed', name: 'of Lacerating', on: ['attack', 'gloves', 'quiver'], group: 'ailment', weight: 50, tags: ['ailment', 'physical'],
    tiers: one('bleed.chance', 'flat', pct([[2, 5, 8], [14, 9, 12], [26, 13, 16], [40, 17, 20], [56, 21, 25], [72, 26, 30]])) }),
  suffix({ id: 'poison', name: 'of Venom', on: ['attack', 'gloves', 'quiver'], group: 'ailment', weight: 50, tags: ['ailment', 'chaos'],
    tiers: one('poison.chance', 'flat', pct([[2, 5, 8], [14, 9, 12], [26, 13, 16], [40, 17, 20], [56, 21, 25], [72, 26, 30]])) }),
  // --- Riftlight mechanics
  suffix({ id: 'lamplighter', name: 'of the Lamplighter', on: ['helm', 'amulet', 'offhand'], group: 'mechanic-utility', weight: 30, tags: ['mechanic', 'light'],
    tiers: hybrid(['lantern.duration', 'inc'], ['light.radius', 'inc'], [[6, 0.2, 0.3, 0.04, 0.06], [16, 0.31, 0.45, 0.07, 0.09], [28, 0.46, 0.6, 0.1, 0.12], [42, 0.61, 0.8, 0.13, 0.15], [58, 0.81, 1, 0.16, 0.18]]) }),
  suffix({ id: 'glide', name: 'of the Glide', on: ['boots'], group: 'mechanic-utility', weight: 30, tags: ['mechanic', 'speed'],
    tiers: one('move.speed', 'inc', pct([[6, 8, 12], [18, 13, 17], [30, 18, 22], [44, 23, 27], [60, 28, 32]]), undefined, 'onIce') }),
  suffix({ id: 'anchored', name: 'of the Anchor', on: ['boots', 'belt', 'body'], group: 'mechanic-utility', weight: 30, tags: ['mechanic'],
    tiers: hybrid(['wind.resist', 'inc'], ['well.resist', 'inc'], [[6, 0.1, 0.15, 0.1, 0.15], [18, 0.16, 0.22, 0.16, 0.22], [30, 0.23, 0.3, 0.23, 0.3], [44, 0.31, 0.4, 0.31, 0.4], [60, 0.41, 0.5, 0.41, 0.5]]) }),
  suffix({ id: 'thornskin', name: 'of Thornskin', on: ['body', 'shield', 'gloves'], group: 'mechanic-utility', weight: 30, tags: ['mechanic', 'physical'],
    tiers: one('thorns.reflect', 'flat', pct([[5, 10, 14], [16, 15, 19], [28, 20, 24], [42, 25, 29], [58, 30, 35]])) }),
  suffix({ id: 'conductor', name: 'of the Conductor', on: ['caster', 'ring', 'gloves'], group: 'mechanic-utility', weight: 25, tags: ['mechanic', 'lightning'],
    tiers: hybrid(['pylon.chain', 'flat'], ['shock.chance', 'flat'], [[10, 1, 1, 0.02, 0.04], [24, 1, 1, 0.05, 0.08], [38, 2, 2, 0.04, 0.06], [52, 2, 2, 0.07, 0.1], [68, 3, 3, 0.06, 0.1]]) }),
  suffix({ id: 'quickmire', name: 'of Quickmire', on: ['boots', 'belt'], group: 'mechanic-utility', weight: 30, tags: ['mechanic', 'speed'],
    tiers: one('haste.duration', 'inc', pct([[14, 20, 34], [26, 35, 49], [38, 50, 69], [52, 70, 89], [68, 90, 110]])) }),
  suffix({ id: 'gatekeeper', name: 'of the Gatekeeper', on: ['weapon', 'ring', 'amulet'], group: 'mechanic-utility', weight: 25, tags: ['mechanic', 'damage'],
    tiers: one('gate.damage', 'inc', pct([[18, 15, 24], [30, 25, 34], [42, 35, 49], [56, 50, 64], [72, 65, 80]])) }),
  suffix({ id: 'crumbling', name: 'of Crumbling Halls', on: ['boots', 'amulet', 'helm'], group: 'mechanic-utility', weight: 20, tags: ['mechanic', 'find'],
    tiers: one('collapse.bonusLoot', 'inc', pct([[24, 10, 14], [36, 15, 19], [48, 20, 24], [60, 25, 29], [74, 30, 35]])) }),
  suffix({ id: 'brazier-area', name: 'of Embers', on: ['gloves', 'amulet', 'weapon'], group: 'mechanic-utility', weight: 30, tags: ['mechanic', 'fire', 'area'],
    tiers: one('brazier.area', 'inc', pct([[1, 10, 15], [12, 16, 22], [24, 23, 30], [38, 31, 40], [54, 41, 50]])) }),
];

export const AFFIXES: readonly Affix[] = [...PREFIXES, ...SUFFIXES];

/**
 * Corruption implicits (the corrupt orb's "add an implicit" outcome). Same shape as an
 * affix; `on` works the same way. Stored on the item as `implicits`.
 */
export const CORRUPTIONS: readonly Affix[] = [
  suffix({ id: 'corrupt-life', name: 'Corrupted Vitality', on: LIFE_ON, group: 'corrupt', tags: ['life'], tiers: one('life', 'inc', pct([[1, 4, 8]])) }),
  suffix({ id: 'corrupt-res', name: 'Corrupted Warding', on: RES_ON, group: 'corrupt', tags: ['res'], tiers: one('res.chaos', 'flat', pct([[1, 10, 20]])) }),
  suffix({ id: 'corrupt-speed', name: 'Corrupted Haste', on: ['boots', 'gloves'], group: 'corrupt', tags: ['speed'], tiers: one('move.speed', 'inc', pct([[1, 4, 8]])) }),
  suffix({ id: 'corrupt-damage', name: 'Corrupted Fury', on: ['weapon', 'jewellery'], group: 'corrupt', tags: ['damage'], tiers: one('damage', 'inc', pct([[1, 10, 20]])) }),
  suffix({ id: 'corrupt-skill', name: 'Corrupted Mastery', on: ['weapon', 'amulet', 'helm'], group: 'corrupt', weight: 30, tags: ['skill'], tiers: one('skill.level', 'flat', [[1, 1, 1]]) }),
  suffix({ id: 'corrupt-crit', name: 'Corrupted Malice', on: ['weapon', 'gloves', 'jewellery'], group: 'corrupt', tags: ['crit'], tiers: one('crit.multi', 'flat', pct([[1, 10, 20]])) }),
  suffix({ id: 'corrupt-light', name: 'Corrupted Lantern', on: ['helm', 'offhand', 'belt'], group: 'corrupt', tags: ['light'], tiers: one('light.radius', 'inc', pct([[1, 15, 25]])) }),
  suffix({ id: 'corrupt-curse', name: 'Corrupted Ward', on: ['body', 'belt'], group: 'corrupt', weight: 30, tags: ['defence'], tiers: [{ level: 1, mods: [{ stat: 'curse.immune', kind: 'flag', min: 1, max: 1 }] }] }),
];
