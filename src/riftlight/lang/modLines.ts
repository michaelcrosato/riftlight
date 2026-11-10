/**
 * The mods area's lines as data, and `modText`, the one mod describer (docs/game/lang.md): a name
 * per stat (`stat.<id>`, by canonical id: core/stats.ts), the scopes a mod's tags give it
 * (`mod.scope.<tag>`, "with fire skills"), the words of skill and support tags (`tag.<tag>`), the
 * conditions (`when.<condition>`) and the sentence shapes (`mod.inc` "{value}% increased {stat}",
 * `mod.with` "{mod} with {scope}"...). Tooltips, the tree, the character sheet and the item
 * windows all read mods through it (`describeMod`, `describeItemMods`, `describeTreeMod`).
 *
 * This module imports nothing of the game's line list (lang/index.ts): core/mods.ts, which every
 * registry imports, uses it, and the line list imports every registry. It shows mods in
 * `modLanguage()`: the player's language once lang/mods.ts has loaded (with the line list), the
 * game's own (from these lines alone) for a tool that never loads it. Import from lang/mods.ts.
 */
import { Lang, type LineValues } from '../../engine/lang/lang';
import type { Mod } from '../core/mods';
import { canonicalStat, isPercentStat, PERCENT_STATS } from '../core/stats';
import { type LineArea, lineKey } from './area';

export { isPercentStat, PERCENT_STATS };

/**
 * Stat names by canonical id (core/stats.ts): lowercase, they go inside the sentence shapes
 * ("+12 maximum life", "8% reduced mana cost of skills"). A flag's name is its whole rule.
 * Aliases (`crit.multi`, `energy.shield`...) read through their canonical stat.
 */
export const STAT_NAMES: Readonly<Record<string, string>> = {
  // life, mana, energy shield, recovery
  life: 'maximum life',
  mana: 'maximum mana',
  es: 'maximum energy shield',
  'life.regen': 'life regenerated per second',
  'life.regen.pct': 'of life regenerated per second',
  'life.recovery': 'life recovery',
  'life.onKill': 'life gained on kill',
  'mana.onKill': 'mana gained on kill',
  'es.onKill': 'energy shield gained on kill',
  'mana.regen': 'mana regeneration rate',
  'es.recharge': 'energy shield recharge rate',
  'leech.life': 'of damage leeched as life',
  'leech.mana': 'of damage leeched as mana',
  'leech.rate': 'leech rate',
  'leech.instant': 'life leech is instant',
  cost: 'mana cost of skills',
  'mana.reservation': 'mana reserved by auras',
  // defence
  armour: 'armour',
  evasion: 'evasion rating',
  'block.chance': 'chance to block',
  'spell.block': 'chance to block spells',
  'block.spells': 'block applies to spells',
  'block.recovery': 'block recovery',
  'dodge.chance': 'chance to dodge hits',
  'res.fire': 'fire resistance',
  'res.cold': 'cold resistance',
  'res.lightning': 'lightning resistance',
  'res.chaos': 'chaos resistance',
  'res.elemental': 'elemental resistances',
  'res.physical': 'physical damage reduction',
  'res.max.fire': 'maximum fire resistance',
  'res.max.cold': 'maximum cold resistance',
  'res.max.lightning': 'maximum lightning resistance',
  'res.max.chaos': 'maximum chaos resistance',
  'res.max.elemental': 'maximum elemental resistances',
  'damage.taken': 'damage taken',
  'stun.threshold': 'stun threshold',
  'avoid.freeze': 'chance to avoid being frozen',
  'avoid.stun': 'chance to avoid being stunned',
  'avoid.ignite': 'chance to avoid being ignited',
  'avoid.chill': 'chance to avoid being chilled',
  'avoid.shock': 'chance to avoid being shocked',
  'avoid.poison': 'chance to avoid being poisoned',
  'avoid.bleed': 'chance to avoid bleeding',
  // offence
  damage: 'damage',
  'physical.damage': 'physical damage',
  'fire.damage': 'fire damage',
  'cold.damage': 'cold damage',
  'lightning.damage': 'lightning damage',
  'chaos.damage': 'chaos damage',
  'elemental.damage': 'elemental damage',
  'attack.speed': 'attack speed',
  'cast.speed': 'cast speed',
  'action.speed': 'action speed',
  'crit.chance': 'critical strike chance',
  'crit.multiplier': 'critical strike multiplier',
  'weapon.crit': 'base critical strike chance',
  'attack.speed.base': 'base attacks per second',
  'weapon.range': 'weapon range',
  'melee.range': 'melee range',
  accuracy: 'accuracy rating',
  area: 'area of effect',
  duration: 'skill effect duration',
  'cooldown.recovery': 'cooldown recovery rate',
  projectiles: 'additional projectiles',
  'projectile.speed': 'projectile speed',
  'projectile.homing': 'projectile homing',
  pierce: 'projectile pierces',
  chain: 'additional chains',
  fork: 'additional forks',
  repeats: 'additional repeats',
  knockback: 'knockback',
  'added.physical.min': 'minimum added physical damage',
  'added.physical.max': 'maximum added physical damage',
  'added.fire.min': 'minimum added fire damage',
  'added.fire.max': 'maximum added fire damage',
  'added.cold.min': 'minimum added cold damage',
  'added.cold.max': 'maximum added cold damage',
  'added.lightning.min': 'minimum added lightning damage',
  'added.lightning.max': 'maximum added lightning damage',
  'added.chaos.min': 'minimum added chaos damage',
  'added.chaos.max': 'maximum added chaos damage',
  'weapon.physical.min': 'minimum weapon physical damage',
  'weapon.physical.max': 'maximum weapon physical damage',
  'weapon.fire.min': 'minimum weapon fire damage',
  'weapon.fire.max': 'maximum weapon fire damage',
  'weapon.cold.min': 'minimum weapon cold damage',
  'weapon.cold.max': 'maximum weapon cold damage',
  'weapon.lightning.min': 'minimum weapon lightning damage',
  'weapon.lightning.max': 'maximum weapon lightning damage',
  'weapon.chaos.min': 'minimum weapon chaos damage',
  'weapon.chaos.max': 'maximum weapon chaos damage',
  'added.fire.ratio': 'of hit damage added as fire damage',
  'convert.physical.fire': 'of physical damage converted to fire',
  'convert.physical.cold': 'of physical damage converted to cold',
  'convert.physical.lightning': 'of physical damage converted to lightning',
  'convert.physical.chaos': 'of physical damage converted to chaos',
  'convert.fire.physical': 'of fire damage converted to physical',
  'convert.lightning.fire': 'of lightning damage converted to fire',
  'convert.cold.fire': 'of cold damage converted to fire',
  'pen.fire': 'fire resistance penetration',
  'pen.cold': 'cold resistance penetration',
  'pen.lightning': 'lightning resistance penetration',
  'pen.chaos': 'chaos resistance penetration',
  cull: 'kill enemies left below 10% life',
  noAilments: 'cannot inflict elemental ailments',
  'no.physical': 'deal no physical damage',
  'no.fire': 'deal no fire damage',
  'no.cold': 'deal no cold damage',
  'no.lightning': 'deal no lightning damage',
  'no.chaos': 'deal no chaos damage',
  // ailments
  'ignite.chance': 'chance to ignite',
  'freeze.chance': 'chance to freeze',
  'shock.chance': 'chance to shock',
  'chill.chance': 'chance to chill',
  'bleed.chance': 'chance to cause bleeding',
  'poison.chance': 'chance to poison',
  'stun.chance': 'chance to stun',
  'shatter.chance': 'chance for enemies you kill to shatter',
  'ailment.effect': 'effect of ailments',
  'ailment.damage': 'damage over time from ailments',
  'ailment.duration': 'duration of ailments',
  'ignite.damage': 'ignite damage',
  'poison.damage': 'poison damage',
  'bleed.damage': 'bleeding damage',
  'chill.effect': 'effect of chill',
  'shock.effect': 'effect of shock',
  'stun.duration': 'stun duration',
  'freeze.duration': 'freeze duration',
  'ignite.duration': 'ignite duration',
  'poison.duration': 'poison duration',
  'bleed.duration': 'bleeding duration',
  'chill.duration': 'chill duration',
  'shock.duration': 'shock duration',
  // minions, totems, traps, auras, curses
  'minion.damage': 'minion damage',
  'minion.life': 'minion life',
  'minion.speed': 'minion attack, cast and movement speed',
  'minion.count': 'maximum minions',
  minions: 'additional minions',
  'totem.count': 'totems you can summon',
  'totem.life': 'totem life',
  'totem.speed': 'totem placement speed',
  'trap.count': 'traps you can place',
  'trap.speed': 'trap throwing speed',
  'trap.arm': 'trap arming time',
  'aura.effect': 'effect of auras',
  'aura.radius': 'aura radius',
  'auras.selfOnly': 'your auras only affect you',
  'curse.effect': 'effect of curses',
  'curse.duration': 'curse duration',
  'curse.count': 'curses you can apply',
  'curse.immune': 'unaffected by curses',
  // charges
  'endurance.max': 'maximum endurance charges',
  'frenzy.max': 'maximum frenzy charges',
  'power.max': 'maximum power charges',
  'charge.duration': 'charge duration',
  'charge.onKill': 'chance to gain a charge on kill',
  'charge.onHit': 'chance to gain a charge on hit',
  'charge.onCrit': 'chance to gain a charge on critical strike',
  'charge.onStun': 'chance to gain a charge when you stun',
  // keystone rules (tree/data/keystones.ts KEYSTONE_FLAGS)
  'hits.cannotBeEvaded': "your hits can't be evaded",
  cannotCrit: 'never deal critical strikes',
  cannotBeStunned: 'cannot be stunned',
  cannotDodge: 'cannot dodge roll',
  'skills.costLife': 'skills cost life instead of mana',
  'evasion.toArmour': 'converts all evasion rating to armour',
  rampage: 'kills grant Rampage',
  pointBlank: 'projectiles deal more damage to close targets and less to far ones',
  'crit.affectsAilments': 'critical strike multiplier applies to ailments',
  'damage.morePerMechanic': 'more damage for each mechanic active in the level',
  'immune.chaos': 'immune to chaos damage',
  elementalOverload: 'critical strikes grant more elemental damage for a while',
  'crit.noMultiplier': 'your critical strikes deal no extra damage',
  'es.protectsMana': 'energy shield pays skill costs before mana',
  'damage.toMana': 'of damage taken from mana before life',
  'convert.toFire': 'of physical, cold and lightning damage converted to fire',
  'nonFireDamage.none': 'deal no non-fire damage',
  'cannotDealDamage.self': "you can't deal damage with skills yourself",
  // the hero, loot
  'skill.level': 'level of skill gems',
  'move.speed': 'movement speed',
  'light.radius': 'light radius',
  'gold.find': 'gold found',
  'item.rarity': 'rarity of items found',
  'item.quantity': 'quantity of items found',
  'xp.gain': 'experience gained',
  'dodge.recovery': 'dodge roll speed',
  'dodge.distance': 'dodge roll distance',
  'weapon.sword': 'wielding a sword',
  'weapon.axe': 'wielding an axe',
  'weapon.mace': 'wielding a mace',
  'weapon.dagger': 'wielding a dagger',
  'weapon.bow': 'wielding a bow',
  'weapon.staff': 'wielding a staff',
  'weapon.wand': 'wielding a wand',
  'weapon.sceptre': 'wielding a sceptre',
  'weapon.twohand': 'wielding a two-handed weapon',
  // Riftlight's level mechanics (docs/game/levels.md *The 12 designed levels*)
  'brazier.damage': 'brazier explosion damage',
  'brazier.area': 'brazier explosion area',
  'brazier.selfIgnite': 'brazier explosions set you alight instead of hurting you',
  'explosion.damage': 'damage of explosions you cause',
  'echo.damage': 'echo damage',
  'echo.delay': 'echo delay',
  'echo.repeatsSkills': 'your echo repeats every skill twice',
  'lantern.duration': 'duration of lantern buffs',
  'wind.resist': 'resistance to wind push',
  'well.resist': 'resistance to gravity well pull',
  'well.immune': 'immune to gravity wells',
  'mire.immune': 'unaffected by mire',
  'haste.duration': 'haste pad duration',
  'thorns.reflect': 'of melee damage taken reflected to attackers',
  'thorns.immune': 'immune to vine traps',
  'pylon.chain': 'additional pylon chains',
  'collapse.bonusLoot': 'collapse bonus loot',
  'collapse.fallImmune': 'crumbling floors hold under you',
  'gate.damage': 'damage after crossing a riftgate',
  // monsters (parts, plans, elite modifiers)
  thorns: 'damage dealt back to melee attackers',
  flying: 'flies',
  rooted: 'cannot move',
  frontalBlock: 'blocks hits from the front',
  knockbackImmune: 'cannot be knocked back',
  stunImmune: 'cannot be stunned',
  mass: 'mass',
  'aggro.radius': 'notice range',
  'aura.empower': 'its aura makes nearby monsters hit harder',
  'aura.halo': 'its halo shields nearby monsters',
};

/**
 * Tags as a mod's scope: what follows "with" ("12% increased damage with two-handed weapons").
 * A mod with several tags reads them joined by `mod.scope.and`.
 */
export const SCOPES: Readonly<Record<string, string>> = {
  attack: 'attacks',
  spell: 'spells',
  melee: 'melee skills',
  projectile: 'projectile skills',
  area: 'area skills',
  minion: 'minion skills',
  trap: 'traps',
  mine: 'mines',
  totem: 'totems',
  slam: 'slams',
  strike: 'strikes',
  curse: 'curses',
  aura: 'auras',
  hit: 'hits',
  dot: 'damage over time',
  twohand: 'two-handed weapons',
  dualwield: 'dual wielding',
  bow: 'bows',
  fire: 'fire skills',
  cold: 'cold skills',
  lightning: 'lightning skills',
  chaos: 'chaos skills',
  physical: 'physical hits',
  elemental: 'elemental skills',
  bleed: 'bleeding',
  poison: 'poison',
  ignite: 'ignite',
  endurance: 'endurance charges',
  frenzy: 'frenzy charges',
  power: 'power charges',
  charge: 'charges',
};

/** The words of skill and support tags, shown in gem tooltips ("attack, melee, area"). */
export const TAG_WORDS: Readonly<Record<string, string>> = {
  area: 'area',
  attack: 'attack',
  aura: 'aura',
  basic: 'basic',
  beam: 'beam',
  blink: 'blink',
  bow: 'bow',
  buff: 'buff',
  chain: 'chain',
  channel: 'channelling',
  chaos: 'chaos',
  charge: 'charge',
  cold: 'cold',
  curse: 'curse',
  damage: 'damage',
  dodge: 'dodge',
  duration: 'duration',
  elemental: 'elemental',
  fire: 'fire',
  lightning: 'lightning',
  melee: 'melee',
  mine: 'mine',
  minion: 'minion',
  movement: 'movement',
  nova: 'nova',
  physical: 'physical',
  projectile: 'projectile',
  slam: 'slam',
  spell: 'spell',
  strike: 'strike',
  stun: 'stun',
  summon: 'summon',
  totem: 'totem',
  trap: 'trap',
  warcry: 'warcry',
  zone: 'zone',
  twohand: 'two-handed',
  dualwield: 'dual wield',
};

/** Conditions (`Mod.when`), as they follow "while" ("30% more damage while in the dark"). */
export const CONDITIONS: Readonly<Record<string, string>> = {
  lowLife: 'on low life',
  fullLife: 'on full life',
  moving: 'moving',
  inDark: 'in the dark',
  inLight: 'in light',
  inWind: 'in the wind',
  onIce: 'on ice',
  nearPylon: 'near a pylon',
  recentlyKilled: 'you have killed recently',
  recentlyHit: 'you have been hit recently',
  hitRecently: 'you have been hit recently',
  notHitRecently: 'you have not been hit recently',
  recentlyGated: 'you have crossed a riftgate recently',
  ignited: 'ignited',
  chill: 'chilled',
  shock: 'shocked',
  freeze: 'frozen',
  ignite: 'ignited',
  poison: 'poisoned',
  bleed: 'bleeding',
  stun: 'stunned',
  frenzy: 'frenzied',
  phased: 'phased',
  shielded: 'shielded',
};

/** The sentence shapes. */
const SHAPES: Readonly<Record<string, string>> = {
  'mod.inc': '{value}% increased {stat}',
  'mod.reduced': '{value}% reduced {stat}',
  'mod.more': '{value}% more {stat}',
  'mod.less': '{value}% less {stat}',
  'mod.flat': '+{value} {stat}',
  'mod.flat.minus': '-{value} {stat}',
  'mod.flat.percent': '+{value}% {stat}',
  'mod.flat.percent_minus': '-{value}% {stat}',
  'mod.override': '{stat} is {value}',
  'mod.override.percent': '{stat} is {value}%',
  'mod.with': '{mod} with {scope}',
  'mod.while': '{mod} while {condition}',
  'mod.scope.and': '{first} and {second}',
  'mod.list': '{first}, {second}',
  'mod.skill_level': '+{value} to level of {gems}',
  'mod.skill_level.minus': '-{value} to level of {gems}',
  'mod.skill_gems.all': 'all skill gems',
  'mod.skill_gems.tagged': '{tags} skill gems',
  'mod.added': 'Adds {min} to {max} {type} damage',
  'mod.added.attacks': 'Adds {min} to {max} {type} damage to attacks',
  'mod.added.spells': 'Adds {min} to {max} {type} damage to spells',
};

const NOTES: Readonly<Record<string, string>> = {
  'mod.inc': 'Every bonus in the game is described with these shapes (item tooltips, the passive tree, the character sheet). {stat} is a stat.* line, lowercase: "12% increased fire damage".',
  'mod.flat': 'A flat bonus: "+12 maximum life". {stat} is a stat.* line.',
  'mod.flat.percent': 'A flat bonus counted in percent: "+12% fire resistance".',
  'mod.override': 'A stat set to a value by a rule: "maximum life is 1".',
  'mod.with': 'A bonus that only counts for some skills: {mod} is a whole mod line, {scope} a mod.scope.* line ("attacks", "fire skills").',
  'mod.while': 'A bonus that only counts in a situation: {mod} is a whole mod line, {condition} a when.* line ("on low life", "in the dark").',
  'mod.scope.and': 'Two scopes a bonus needs at once: "two-handed weapons and melee skills".',
  'mod.list': 'Two bonuses of one choice, in a list.',
  'mod.skill_gems.tagged': '{tags} are skill tag words (tag.*): "+1 to level of fire skill gems".',
  'mod.added': 'Damage an item or a gem adds to every hit; {type} is a damage.* line (lowercase: "fire").',
};

/** Every mod line (the mods area: lang/mods.ts `MODS`). */
export function modLines(): LineArea {
  const lines: Record<string, string> = { ...SHAPES };
  const notes: Record<string, string> = { ...NOTES };
  for (const [stat, name] of Object.entries(STAT_NAMES)) {
    lines[lineKey('stat', stat)] = name;
    if (/^[a-z]/.test(name) && stat !== name) notes[lineKey('stat', stat)] = `A stat's name, inside mod lines ("+{value} {stat}", "{value}% increased {stat}"): lowercase.${isPercentStat(stat) ? ' Counted in percent.' : ''}`;
  }
  for (const [tag, scope] of Object.entries(SCOPES)) lines[lineKey('mod.scope', tag)] = scope;
  for (const [tag, word] of Object.entries(TAG_WORDS)) {
    lines[lineKey('tag', tag)] = word;
    notes[lineKey('tag', tag)] = 'A skill tag: gem tooltips list them ("attack, melee, area"), and supports fit skills by them. Lowercase.';
  }
  for (const [when, words] of Object.entries(CONDITIONS)) {
    lines[lineKey('when', when)] = words;
    notes[lineKey('when', when)] = 'What follows "while" in mod.while: "30% more damage while {condition}".';
  }
  return { lines, notes };
}

// ------------------------------------------------------------------ showing them

/** The language a mod is described in: lines filled (`t`) and known (`has`). */
export type In = Pick<Lang, 't' | 'has'>;

let own: Lang | null = null;
let shown: (() => In) | null = null;

/** The language mods are shown in: the player's (set by lang/mods.ts), else the game's own. */
export function modLanguage(): In {
  return shown?.() ?? (own ??= new Lang({ version: 1, language: 'en', lines: modLines().lines, names: [], brief: '' }));
}

/** lang/mods.ts: show mods in this language from now on (the line list's `lang`). */
export function showModsIn(language: () => In): void {
  shown = language;
}

/** "dodge.recovery" → "dodge recovery": a stat or tag with no line yet (tests keep this from showing). */
const humanize = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ').toLowerCase();

/** A line, or `fallback` when the game has none for `id`. */
function lineOr(l: In, id: string, fallback: string, values?: LineValues): string {
  return l.has(id) ? l.t(id, values) : fallback;
}

/** Does the game name this stat (canonical or an alias)? */
export function hasStatName(stat: string): boolean {
  return canonicalStat(stat) in STAT_NAMES;
}

/** A stat's name in the player's language ("maximum life"), by any of its names. */
export function statName(stat: string, l: In = modLanguage()): string {
  const s = canonicalStat(stat);
  return lineOr(l, lineKey('stat', s), humanize(s));
}

/** A skill or support tag's word ("melee"). */
export function tagWord(tag: string, l: In = modLanguage()): string {
  return lineOr(l, lineKey('tag', tag), humanize(tag));
}

/** A mod's tags as its scope ("two-handed weapons and melee skills"). */
export function scopeName(tags: readonly string[], l: In = modLanguage()): string {
  return tags.map((tag) => lineOr(l, lineKey('mod.scope', tag), humanize(tag))).reduce((first, second) => l.t('mod.scope.and', { first, second }));
}

/** A condition's words ("on low life"). */
export function conditionName(when: string, l: In = modLanguage()): string {
  return lineOr(l, lineKey('when', when), humanize(when));
}

/** Two or more mod lines as one ("8% increased damage, 5% increased maximum life"). */
export function modList(texts: readonly string[], l: In = modLanguage()): string {
  return texts.length ? texts.reduce((first, second) => l.t('mod.list', { first, second })) : '';
}

/** A number as mod lines show it: whole from 10 up, else two decimals at most. */
export function modNumber(v: number): number {
  return Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
}

/** A fraction as a percentage, to a tenth (0.125 → 12.5). */
export function modPercent(v: number): number {
  return Math.round(v * 1000) / 10;
}

/** A mod line with its scope and condition: "{mod} with {scope}", then "… while {condition}". */
export function scoped(text: string, m: Pick<Mod, 'tags' | 'when'>, l: In = modLanguage()): string {
  let out = m.tags?.length ? l.t('mod.with', { mod: text, scope: scopeName(m.tags, l) }) : text;
  if (m.when) out = l.t('mod.while', { mod: out, condition: conditionName(m.when, l) });
  return out;
}

/**
 * A mod in the player's language: "12% increased fire damage with attacks while on low life",
 * "+12% fire resistance", "+1 to level of fire skill gems", a flag's rule. Core's `describeMod`
 * is this (installed below).
 */
export function modText(m: Mod, l: In = modLanguage()): string {
  if (canonicalStat(m.stat) === 'skill.level') {
    const gems = m.tags?.length ? l.t('mod.skill_gems.tagged', { tags: m.tags.map((tag) => tagWord(tag, l)).join(' ') }) : l.t('mod.skill_gems.all');
    const line = l.t(m.value >= 0 ? 'mod.skill_level' : 'mod.skill_level.minus', { value: modNumber(Math.abs(m.value)), gems });
    return m.when ? l.t('mod.while', { mod: line, condition: conditionName(m.when, l) }) : line;
  }
  const stat = statName(m.stat, l);
  const up = m.value >= 0;
  switch (m.kind) {
    case 'flag':
      return scoped(stat, m, l);
    case 'flat': {
      const pct = isPercentStat(m.stat);
      const id = pct ? (up ? 'mod.flat.percent' : 'mod.flat.percent_minus') : up ? 'mod.flat' : 'mod.flat.minus';
      return scoped(l.t(id, { value: pct ? modPercent(Math.abs(m.value)) : modNumber(Math.abs(m.value)), stat }), m, l);
    }
    case 'inc':
      return scoped(l.t(up ? 'mod.inc' : 'mod.reduced', { value: modPercent(Math.abs(m.value)), stat }), m, l);
    case 'more':
      return scoped(l.t(up ? 'mod.more' : 'mod.less', { value: modPercent(Math.abs(m.value)), stat }), m, l);
    case 'override': {
      const subject = m.tags?.length ? l.t('mod.with', { mod: stat, scope: scopeName(m.tags, l) }) : stat;
      const pct = isPercentStat(m.stat);
      const line = l.t(pct ? 'mod.override.percent' : 'mod.override', { stat: subject, value: pct ? modPercent(m.value) : modNumber(m.value) });
      return m.when ? l.t('mod.while', { mod: line, condition: conditionName(m.when, l) }) : line;
    }
  }
}
