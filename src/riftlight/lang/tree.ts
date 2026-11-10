/**
 * The lines of the passive tree (docs/game/lang.md): its regions, clusters, notables, keystones
 * (and their rules), masteries, the names small nodes are given from their mods, and the tree
 * view's words (ui/tree/). Built from the registries (their English is the line), so a notable
 * or a keystone added as data brings its lines along; tree/text.ts shows them (`nodeName`,
 * `nodeFlavour`, `smallName`, `regionName`...). Saves keep node ids, never these words.
 */
import type { Line } from '../../engine/lang/lang';
import { canonicalStat } from '../core/stats';
import { CLUSTERS, NOTABLES } from '../tree/data/clusters';
import { KEYSTONES } from '../tree/data/keystones';
import { MASTERIES } from '../tree/data/masteries';
import { OVERRIDES } from '../tree/data/overrides';
import { REGIONS } from '../tree/data/regions';
import type { NodeLine } from '../tree/types';
import { type LineArea, lineKey } from './area';

/** Short stat names for small passives' titles ("Melee Damage", "Life and Armour"), by canonical stat. */
export const SMALL_NAMES: Readonly<Record<string, string>> = {
  life: 'Life',
  mana: 'Mana',
  es: 'Energy Shield',
  'es.recharge': 'Shield Recharge',
  'es.onKill': 'Shield on Kill',
  'life.regen': 'Life Regeneration',
  'life.regen.pct': 'Life Regeneration',
  'life.recovery': 'Life Recovery',
  'leech.life': 'Life Leech',
  'leech.mana': 'Mana Leech',
  'leech.rate': 'Leech Rate',
  'life.onKill': 'Life on Kill',
  'mana.onKill': 'Mana on Kill',
  'mana.regen': 'Mana Regeneration',
  cost: 'Mana Cost',
  'mana.reservation': 'Reservation',
  'crit.chance': 'Critical Chance',
  'crit.multiplier': 'Critical Multiplier',
  'attack.speed': 'Attack Speed',
  'cast.speed': 'Cast Speed',
  'move.speed': 'Movement Speed',
  'projectile.speed': 'Projectile Speed',
  projectiles: 'Projectile Count',
  pierce: 'Pierce',
  area: 'Area',
  'cooldown.recovery': 'Cooldown Recovery',
  duration: 'Duration',
  damage: 'Damage',
  'physical.damage': 'Physical Damage',
  'fire.damage': 'Fire Damage',
  'cold.damage': 'Cold Damage',
  'lightning.damage': 'Lightning Damage',
  'chaos.damage': 'Chaos Damage',
  'elemental.damage': 'Elemental Damage',
  'res.fire': 'Fire Resistance',
  'res.cold': 'Cold Resistance',
  'res.lightning': 'Lightning Resistance',
  'res.chaos': 'Chaos Resistance',
  'res.elemental': 'Elemental Resistance',
  'block.chance': 'Block',
  'block.recovery': 'Block Recovery',
  'ignite.chance': 'Ignite Chance',
  'ignite.damage': 'Ignite Damage',
  'poison.chance': 'Poison Chance',
  'poison.damage': 'Poison Damage',
  'bleed.chance': 'Bleed Chance',
  'bleed.damage': 'Bleed Damage',
  'freeze.chance': 'Freeze Chance',
  'chill.effect': 'Chill Effect',
  'shock.chance': 'Shock Chance',
  'shock.effect': 'Shock Effect',
  'ailment.duration': 'Ailment Duration',
  'ailment.damage': 'Ailment Damage',
  'stun.duration': 'Stun Duration',
  'stun.threshold': 'Stun Threshold',
  knockback: 'Knockback',
  'damage.taken': 'Damage Taken',
  'minion.damage': 'Minion Damage',
  'minion.life': 'Minion Life',
  'minion.speed': 'Minion Speed',
  'minion.count': 'Minion Count',
  'aura.effect': 'Aura Effect',
  'aura.radius': 'Aura Radius',
  'curse.effect': 'Curse Effect',
  'curse.duration': 'Curse Duration',
  'curse.count': 'Curse Count',
  'trap.speed': 'Trap Speed',
  'trap.count': 'Trap Count',
  'totem.life': 'Totem Life',
  'totem.speed': 'Totem Placement',
  'totem.count': 'Totem Count',
  'endurance.max': 'Endurance Max',
  'frenzy.max': 'Frenzy Max',
  'power.max': 'Power Max',
  'charge.duration': 'Charge Duration',
  'charge.onKill': 'Charges on Kill',
  'dodge.chance': 'Dodge Chance',
  'dodge.recovery': 'Dodge Speed',
  'dodge.distance': 'Dodge Distance',
  'light.radius': 'Light Radius',
  armour: 'Armour',
  evasion: 'Evasion',
};

/** Tags at the front of a small passive's title ("Melee Damage", "Two-Handed Attack Speed"). */
export const SMALL_TAGS: Readonly<Record<string, string>> = {
  twohand: 'Two-Handed',
  dualwield: 'Dual Wield',
  attack: 'Attack',
  spell: 'Spell',
  melee: 'Melee',
  projectile: 'Projectile',
  area: 'Area',
  slam: 'Slam',
  trap: 'Trap',
  totem: 'Totem',
  minion: 'Minion',
  curse: 'Curse',
  bow: 'Bow',
  hit: 'Hit',
  fire: 'Fire',
  cold: 'Cold',
  lightning: 'Lightning',
  chaos: 'Chaos',
  physical: 'Physical',
  elemental: 'Elemental',
  bleed: 'Bleed',
  poison: 'Poison',
  ignite: 'Ignite',
  endurance: 'Endurance',
  frenzy: 'Frenzy',
  power: 'Power',
};

/** Conditions at the end of a small passive's title ("Damage in Dark", "Life Regeneration Unhurt"). */
export const SMALL_WHEN: Readonly<Record<string, string>> = {
  inDark: 'in Dark',
  inLight: 'in Light',
  lowLife: 'on Low Life',
  recentlyKilled: 'after Kills',
  notHitRecently: 'Unhurt',
  hitRecently: 'when Hit',
};

/** The tree view's words: its top bar, hints, tooltips and messages (ui/tree/). */
const VIEW: Readonly<Record<string, Line>> = {
  // names made from parts
  'tree.start.name': '{region} Gate',
  'tree.small.scoped': '{scope} {stat}',
  'tree.small.condition': '{name} {condition}',
  'tree.small.and': '{first} and {second}',
  'tree.mastery.flavour': 'Allocate, then choose one.',
  'tree.region.heart': 'Heart',
  // kinds of node
  'tree.kind.small': 'Small',
  'tree.kind.notable': 'Notable',
  'tree.kind.keystone': 'Keystone',
  'tree.kind.mastery': 'Mastery',
  'tree.kind.start': 'Gate',
  'tree.tip.kind_region': '{kind}  {region}',
  // the stat summary (Tab)
  'tree.summary.rules': 'Rules',
  'tree.summary.offence': 'Offence',
  'tree.summary.ailments': 'Ailments',
  'tree.summary.defence': 'Defence',
  'tree.summary.life': 'Life, mana and shield',
  'tree.summary.minions': 'Minions and totems',
  'tree.summary.auras': 'Auras and curses',
  'tree.summary.utility': 'Utility',
  'tree.summary.allocated': { one: '{count} allocated', other: '{count} allocated' },
  'tree.summary.nothing': 'Nothing allocated yet',
  // the top bar
  'tree.view.title': 'Passive tree',
  'tree.view.points': 'Points {left}/{total}',
  'tree.view.points_short': 'Pts {left}/{total}',
  'tree.view.spent': 'Spent {count}',
  'tree.view.gold': 'Gold {gold}',
  'tree.view.gold_short': '{gold}g',
  'tree.view.search': '/ search',
  'tree.view.search_short': '/find',
  'tree.view.search_label': 'Search the passive tree',
  // the bottom bar: hints, in order of importance (those that don't fit are left out)
  'tree.hint.take': 'Click take',
  'tree.hint.refund': 'R-click refund',
  'tree.hint.stats': 'Tab stats',
  'tree.hint.find': '/ find',
  'tree.hint.pan': 'Drag pan',
  'tree.hint.zoom': 'Wheel zoom',
  'tree.hint.tap': 'Tap twice: take',
  'tree.pad.take': 'A take',
  'tree.pad.close': 'B close',
  'tree.pad.refund': 'X refund',
  'tree.pad.stats': 'Y stats',
  'tree.pad.move': 'Stick move',
  'tree.pad.zoom': 'LT/RT zoom',
  // a node's tooltip: what clicking it does
  'tree.tip.gate': 'A gate: always yours',
  'tree.tip.next_choice': 'Click: next choice',
  'tree.tip.refund': 'R-click: refund',
  'tree.tip.refund_cost': 'R-click: refund ({cost} gold)',
  'tree.tip.depends': 'Others depend on it',
  'tree.tip.unreachable': 'Unreachable',
  'tree.tip.take': { one: 'Click: take {count} point ({left} left)', other: 'Click: take {count} points ({left} left)' },
  'tree.tip.needs': { one: 'Needs {count} point, {left} left', other: 'Needs {count} points, {left} left' },
  // what an action did
  'tree.msg.taken': '+{count} {name}',
  'tree.msg.refunded': 'Refunded',
  'tree.msg.refunded_gold': 'Refunded for {cost} gold',
  'tree.deny.unreachable': 'Unreachable',
  'tree.deny.no_points': 'No passive points left',
  'tree.deny.need_points': { one: 'Need {count} point, have {have}', other: 'Need {count} points, have {have}' },
  'tree.deny.cant': 'Can not allocate',
  'tree.deny.gates_free': 'The gates are free',
  'tree.deny.depends': 'Other nodes depend on it',
  'tree.deny.refund_cost': 'Refund costs {cost} gold',
  'tree.deny.refund_oru': 'Only Oru the mystic can refund',
};

const VIEW_NOTES: Readonly<Record<string, string>> = {
  'tree.deny.refund_oru': 'Why a passive point can\'t be refunded here: only Oru (a name), the mystic in town, refunds them.',
  'tree.start.name': 'The node each region of the passive tree starts from; {region} is a region name (tree.region.*.name).',
  'tree.small.scoped': "A small passive's title from a stat and a skill tag: \"Melee Damage\". Titles are short, in title case where the language has it.",
  'tree.small.condition': "A small passive's title with a condition: \"Damage in Dark\".",
  'tree.small.and': "A small passive with two stats: \"Life and Armour\".",
  'tree.mastery.flavour': 'Under every mastery in its tooltip: allocating it costs a point, then the player picks one of its options.',
  'tree.region.heart': 'The centre of the passive tree (no region): shown where a node’s region would be.',
  'tree.tip.kind_region': 'The second line of a node’s tooltip: what kind of node, and its region.',
  'tree.summary.allocated': 'At the top of the stat summary: how many passive points are spent.',
  'tree.view.points': 'Top bar: unspent passive points / all points.',
  'tree.view.points_short': 'Top bar on a phone: unspent passive points / all points.',
  'tree.view.gold_short': 'Top bar on a phone: the hero’s gold (g for gold).',
  'tree.view.search': 'The search box’s placeholder; / is the key that opens it.',
  'tree.view.search_short': 'The search box’s placeholder on a phone; / is the key that opens it.',
  'tree.hint.take': 'Bottom bar hints with a mouse: an action, then what it does. Key and button names (Tab, /, R-click) stay as they are.',
  'tree.pad.take': 'Bottom bar hints with a gamepad: A, B, X, Y, LT and RT are the pad’s buttons.',
  'tree.tip.refund': 'R-click is a right click (a long press on a phone).',
  'tree.msg.taken': 'After allocating: {count} points spent to reach the node {name}.',
};

const LINE_NOTE = 'A rule of this node, in its tooltip.';

/** The lines of a node's hand-written tooltip lines (mods aside: they read as mod lines). */
function addLines(lines: Record<string, Line>, notes: Record<string, string>, prefix: string, list: readonly NodeLine[] | undefined): void {
  list?.forEach((l, i) => {
    if (typeof l === 'object' && 'stat' in l) return;
    const id = `${prefix}.line.${i + 1}`;
    lines[id] = typeof l === 'string' ? l : l.text;
    notes[id] = LINE_NOTE;
  });
}

/** Every line of the passive tree (a function: the registries are read when the list is made). */
export function TREE(): LineArea {
  const lines: Record<string, Line> = { ...VIEW };
  const notes: Record<string, string> = { ...VIEW_NOTES };
  for (const r of REGIONS.all()) {
    lines[lineKey('tree.region', r.id, 'name')] = r.name;
    lines[lineKey('tree.region', r.id, 'flavour')] = r.flavour;
    notes[lineKey('tree.region', r.id, 'name')] = 'A region of the passive tree (like a class’s side of it); also drawn large on the tree when zoomed out.';
  }
  for (const c of CLUSTERS.all()) {
    lines[lineKey('tree.cluster', c.id, 'name')] = c.name;
    notes[lineKey('tree.cluster', c.id, 'name')] = 'A theme of passive nodes (tools and the tree’s tooltips).';
  }
  for (const n of NOTABLES.all()) {
    const p = lineKey('tree.notable', n.id);
    lines[`${p}.name`] = n.name;
    lines[`${p}.flavour`] = n.flavour;
    notes[`${p}.name`] = 'A notable passive: a named node worth several small ones.';
    addLines(lines, notes, p, n.lines);
  }
  for (const k of KEYSTONES.all()) {
    const p = lineKey('tree.keystone', k.id);
    lines[`${p}.name`] = k.name;
    lines[`${p}.flavour`] = k.flavour;
    notes[`${p}.name`] = 'A keystone passive: a build-defining trade-off at the edge of the tree.';
    addLines(lines, notes, p, k.lines);
  }
  for (const m of MASTERIES.all()) lines[lineKey('tree.mastery', m.id, 'name')] = m.name;
  for (const o of OVERRIDES) {
    const p = lineKey('tree.override', o.id);
    if (o.name) lines[`${p}.name`] = o.name;
    if (o.flavour) lines[`${p}.flavour`] = o.flavour;
    addLines(lines, notes, p, o.lines);
  }
  for (const [stat, name] of Object.entries(SMALL_NAMES)) lines[lineKey('tree.small.stat', canonicalStat(stat))] = name;
  for (const [tag, name] of Object.entries(SMALL_TAGS)) lines[lineKey('tree.small.tag', tag)] = name;
  for (const [when, name] of Object.entries(SMALL_WHEN)) lines[lineKey('tree.small.when', when)] = name;
  notes[lineKey('tree.small.stat', 'life')] = 'Small passives are named from their stats: these short stat names, in title case where the language has it.';
  return { lines, notes };
}
