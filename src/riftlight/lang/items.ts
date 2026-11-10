/**
 * The lines of items and loot: bases, affixes, uniques, currency, rare-name words, the item windows,
 * tooltips and the reasons an action can't be done (ui/items/, loot/, wire/loot.ts). The registries
 * keep their English (it is the source line); `loot/names.ts` shows them (`itemName`, `baseName`...).
 * docs/game/lang.md has the rules for a line.
 */
import { DAMAGE_TYPES } from '../core/types';
import { AFFIXES, BASES, CORRUPTIONS, CURRENCY, UNIQUES } from '../loot/content';
import { FIRST, SECOND } from '../loot/data/names';
import { type LineArea, lineKey } from './area';

/**
 * Why a loot action can't be done (inventory, crafting, sockets, vendors): gameplay returns the id
 * (and its blanks), the item windows show `item.reason.<id>`.
 */
export const REASONS = {
  no_room_there: 'No room there',
  out_of_bounds: "That doesn't fit there",
  covers_two: 'It would cover more than one item',
  wrong_slot: "It doesn't go in that slot",
  requires_level: 'Requires level {level}',
  not_in_inventory: 'Not in the inventory',
  cant_equip: "Can't be equipped",
  inventory_full: 'No room in the inventory',
  stash_full: 'This stash tab is full',
  nothing_equipped: 'Nothing equipped there',
  no_tab: 'No such tab',
  not_found: 'Item not found',
  not_enough_gold: 'Not enough gold',
  not_for_sale: 'Not for sale',
  equipment_only: 'Only equipment can be crafted',
  corrupted: 'Corrupted items cannot be modified',
  unique: 'Uniques cannot be modified',
  needs_normal: 'Needs a normal item',
  needs_magic: 'Needs a magic item',
  needs_rare: 'Needs a rare item',
  needs_magic_or_rare: 'Needs a magic or rare item',
  no_affix_room: 'No room for another affix',
  no_affix: 'Has no affix to remove',
  no_affix_values: 'Has no affix values to reroll',
  no_affix_fits: 'No affix can roll on this item',
  no_socket: 'No such socket',
  gems_only: 'Only gems go in skill sockets',
  support_in_link: 'Support gems go in the small link sockets',
  skill_in_socket: 'Skill gems go in the big socket',
} as const;

export type ReasonId = keyof typeof REASONS;

/** What a corrupting orb did (`CraftResult.note`): `item.craft.<note>`. */
export const CRAFT_NOTES = {
  nothing: 'Nothing happened',
  upgrade: 'An affix grew stronger',
  remade: 'The item was remade',
  implicit: 'A corrupted implicit appeared',
} as const;

export type CraftNote = keyof typeof CRAFT_NOTES;

/** Item classes (a base's `look`): the first line of an equipment tooltip. */
const CLASSES: Readonly<Record<string, string>> = {
  sword: 'Sword',
  axe: 'Axe',
  mace: 'Mace',
  dagger: 'Dagger',
  bow: 'Bow',
  staff: 'Staff',
  wand: 'Wand',
  sceptre: 'Sceptre',
  shield: 'Shield',
  quiver: 'Quiver',
  focus: 'Focus',
  helm: 'Helmet',
  body: 'Body armour',
  gloves: 'Gloves',
  boots: 'Boots',
  amulet: 'Amulet',
  ring: 'Ring',
  belt: 'Belt',
};

/** Damage types by name, lowercase: they go inside other lines ("{type} damage: 4-9", mod lines). */
const DAMAGE: Readonly<Record<(typeof DAMAGE_TYPES)[number], string>> = { physical: 'physical', fire: 'fire', cold: 'cold', lightning: 'lightning', chaos: 'chaos' };

/** Every fixed line of the item windows, tooltips, labels and names. */
const FIXED: LineArea = {
  lines: {
    // ---- names from parts
    'item.name.magic': '{prefix} {base} {suffix}',
    'item.name.magic_prefix': '{prefix} {base}',
    'item.name.magic_suffix': '{base} {suffix}',
    'item.name.rare': '{first} {second}',
    'item.name.unrevealed': 'Unrevealed {base}',
    'item.rarity.normal': 'Normal',
    'item.rarity.magic': 'Magic',
    'item.rarity.rare': 'Rare',
    'item.rarity.unique': 'Unique',
    // ---- on the ground, in the feed
    'item.label.stack': { one: '{count}x {name}', other: '{count}x {name}' },
    'item.label.gold': { one: '{count} gold', other: '{count} gold' },
    // ---- the loot filter (settings)
    'item.filter.show_all': 'Show all',
    'item.filter.hide_normal': 'Hide normal',
    'item.filter.rares_only': 'Rares only',
    // ---- tooltips
    'item.tip.stack': { one: '{name} x{count}', other: '{name} x{count}' },
    'item.tip.gem.skill': 'Skill gem, level {level}',
    'item.tip.gem.support': 'Support gem, level {level}',
    'item.tip.stack_size': 'Stack size {size}/{max}',
    'item.tip.use_orb': 'Right-click, then click an item to use',
    'item.tip.support_hint': 'Link it to a skill with matching tags',
    'item.tip.skill_hint': 'Socket it in a skill slot to use it',
    'item.tip.requires_level': 'Requires level {level}',
    'item.tip.requires_level_item': 'Requires level {level}, item level {item_level}',
    'item.tip.gem_max': 'Maximum gem level',
    'item.tip.gem_xp': 'Experience {xp}/{next} ({percent})',
    'item.tip.gem_waits': 'Levels up at hero level {level}',
    'item.tip.one_handed': '{class}, one-handed',
    'item.tip.two_handed': '{class}, two-handed',
    'item.tip.damage': '{type} damage: {min}-{max}',
    'item.tip.aps': 'Attacks per second: {aps}',
    'item.tip.crit': 'Critical chance: {chance}',
    'item.tip.dps': 'DPS: {dps}',
    'item.tip.block': 'Chance to block: {chance}',
    'item.tip.armour': 'Armour: {armour}',
    'item.tip.evasion': 'Evasion: {evasion}',
    'item.tip.energy_shield': 'Energy shield: {es}',
    'item.tip.prefix': "Prefix '{name}' T{tier}",
    'item.tip.suffix': "Suffix '{name}' T{tier}",
    'item.tip.corrupted': 'Corrupted',
    'item.tip.buy': { one: 'Buy: {count} gold', other: 'Buy: {count} gold' },
    'item.tip.sell': { one: 'Sells for: {count} gold', other: 'Sells for: {count} gold' },
    'item.tip.compared': 'Compared to equipped:',
    'item.tip.not_supported': "Doesn't support {skill}",
    'item.compare.gain': 'Gain: {mod}',
    'item.compare.lose': 'Lose: {mod}',
    // ---- hints at the bottom of a tooltip ({button}: item.button.*)
    'item.button.right_click': 'Right-click',
    'item.button.hold': 'Hold',
    'item.hint.equip': '{button}: equip',
    'item.hint.unequip': '{button}: unequip',
    'item.hint.take_out': '{button}: take out',
    'item.hint.socket': '{button}: socket in skill {slot}',
    'item.hint.socket_panel': 'Socket it in the skill panel ({key:skills})',
    // ---- the windows
    'item.window.inventory': 'Inventory',
    'item.window.bag': 'Bag',
    'item.window.stash': 'Stash',
    'item.window.smith': 'Smith',
    'item.window.gem_vendor': 'Gem vendor',
    'item.window.bench': 'Crafting bench',
    'item.window.skills': 'Skills',
    'item.window.ilsa': "Ilsa's wares",
    'item.window.brann': "Brann's anvil",
    'item.ui.gems': 'Gems',
    'item.ui.level': 'Lv {level}',
    'item.vendor.tab.smith': 'Wares',
    'item.vendor.tab.gems': 'Gems',
    'item.vendor.tab.gamble': 'Gamble',
    'item.vendor.hint': 'Ctrl-click: buy / sell',
    'item.vendor.hint_touch': 'Tap twice: buy. Drop: sell',
    // ---- the crafting bench
    'item.bench.summary': { one: '{rarity} · {count} affix', other: '{rarity} · {count} affixes' },
    'item.bench.hint': 'Click an item in your bag or gear',
    'item.bench.hint_touch': 'Tap an item in your bag',
    'item.bench.orb_hint': 'Click an orb to use it',
    'item.bench.orb_hint_touch': 'Tap an orb to use it',
    // ---- the skill panel
    'item.skill.empty': 'Empty',
    'item.skill.slot_empty': 'Skill {slot}: empty',
    'item.skill.hint': 'Right-click a gem in your bag to socket it',
    'item.skill.hint_touch': 'Hold a gem in your bag to socket it',
    'item.skill.title': '{name} lv{level}',
    'item.skill.title_max': '{name} lv{level} max',
    'item.skill.title_waits': '{name} lv{level} needs L{hero}',
    'item.skill.title_xp': '{name} lv{level} {percent} xp',
    'item.skill.row_cost': '{cost} MP',
    'item.skill.row_cost_cooldown': '{cost} MP {cooldown}s',
    'item.skill.row_channel': '{cost}/s',
    'item.skill.hit': 'Hit {hit} {type}',
    'item.skill.dps': 'DPS {dps} {rate}/s',
    'item.skill.no_damage': 'No damage',
    'item.skill.cost': 'Cost {cost}',
    'item.skill.cost_cooldown': 'Cost {cost} cd {cooldown}s',
    'item.skill.cost_channel': 'Cost {cost}/s',
    'item.skill.cast': 'Cast {time}s',
    'item.skill.cast_projectiles': { one: 'Cast {time}s x{count}', other: 'Cast {time}s x{count}' },
    'item.skill.cast_area': 'Cast {time}s area {area}',
    'item.skill.unfit': { one: "! {count} link doesn't fit", other: "! {count} links don't fit" },
    'item.skill.supports': { one: '{count} support linked', other: '{count} supports linked' },
    // ---- messages under the windows
    'item.say.pick_orb': 'Pick an orb on the bench',
    'item.say.open_skills': 'Open the skill panel ({key:skills}) to socket gems',
    'item.say.no_free_link': 'No free link in skill {slot}',
    'item.say.bench_first': 'Put an item on the bench first',
    'item.say.no_orb': 'No {orb} in the bag',
    'item.say.apply_orb': 'Apply {orb}: click an item',
    'item.say.orb_used': '{orb} used',
    'item.say.not_supported': "{support} doesn't support {skill}",
    'item.say.not_supported_here': "{support} doesn't support this skill",
    // ---- the Loot Lab (a developer page)
    'dev.lootlab.status': 'Loot Lab  depth {depth}  gold {gold}',
    'dev.lootlab.keys': 'K kill  F pick up  I inventory  T stash  U vendor  Alt filter {filter}',
    'dev.lootlab.on': 'on',
    'dev.lootlab.off': 'off',
    // ---- reasons and corrupting
    ...Object.fromEntries(Object.entries(REASONS).map(([id, text]) => [`item.reason.${id}`, text])),
    ...Object.fromEntries(Object.entries(CRAFT_NOTES).map(([id, text]) => [`item.craft.${id}`, text])),
    ...Object.fromEntries(Object.entries(CLASSES).map(([id, text]) => [lineKey('item.class', id), text])),
    ...Object.fromEntries(Object.entries(DAMAGE).map(([id, text]) => [lineKey('damage', id), text])),
  },
  notes: {
    'item.name.magic': 'A magic item’s name: a prefix (item.affix.*, e.g. "Heavy"), the base’s name (item.base.*) and a suffix (e.g. "of the Kiln"). Shown in the rarity’s colour on tooltips, ground labels and the feed.',
    'item.name.magic_prefix': 'A magic item with a prefix and no suffix: "Heavy Rusted Blade".',
    'item.name.magic_suffix': 'A magic item with a suffix and no prefix: "Rusted Blade of the Kiln".',
    'item.name.rare': 'A rare item’s random name: a first word (item.rare.first.*) and a second (item.rare.second.*), like "Doom Bite" or "Gale Shroud". Reorder as the language reads best.',
    'item.name.unrevealed': 'A gamble at the vendor: an item of this base whose rarity and affixes show only once bought.',
    'item.label.stack': 'A stack of orbs on the ground or in the feed: "3x Kindling Shard".',
    'item.label.gold': 'Gold: a pile on the ground, and the hero’s gold under the inventory.',
    'item.filter.show_all': 'Settings, the loot filter: show every item on the ground.',
    'item.filter.hide_normal': 'Settings, the loot filter: hide plain (normal) gear on the ground.',
    'item.filter.rares_only': 'Settings, the loot filter: show only rare and unique gear (and orbs, gems).',
    'item.tip.stack': 'An orb’s tooltip title with how many are stacked.',
    'item.tip.use_orb': 'An orb’s tooltip: how to use it on an item.',
    'item.tip.requires_level_item': 'The hero level an item needs, and the level it dropped at (it decides which affixes it can roll).',
    'item.tip.gem_xp': 'A gem’s XP toward its next level: "Experience 1.2K/4K (30%)".',
    'item.tip.gem_waits': 'A gem with full XP that waits on the hero to reach this level.',
    'item.tip.one_handed': '{class} is an item class (item.class.*), e.g. "Sword, one-handed".',
    'item.tip.damage': '{type} is a damage type (damage.*), lowercase: "physical damage: 4-9".',
    'item.tip.crit': 'A weapon’s chance to deal a critical strike, a percentage.',
    'item.tip.dps': 'Damage per second, as action RPGs abbreviate it.',
    'item.tip.prefix': 'With Alt held: an affix’s name and tier (T1 is the best tier, as in Path of Exile).',
    'item.tip.suffix': 'With Alt held: an affix’s name and tier (T1 is the best tier, as in Path of Exile).',
    'item.tip.buy': 'At a vendor: what an item costs.',
    'item.tip.sell': 'At a vendor: what an item in the bag sells for.',
    'item.tip.compared': 'Over the list of stats that would change if the hero equipped this item.',
    'item.compare.gain': 'Equipping the item gives an effect (a mod line, mods area) the hero lacks.',
    'item.compare.lose': 'Equipping the item takes away an effect the hero has.',
    'item.button.right_click': 'The mouse’s right button, in hints like "{button}: equip".',
    'item.button.hold': 'On a touch screen: press and hold, in hints like "{button}: equip".',
    'item.hint.equip': '{button} is the control that does it (item.button.*, or a gamepad button such as X).',
    'item.hint.socket': 'A gem in the bag while the skill panel is open: which of the four skill slots it goes in.',
    'item.window.inventory': 'Window title, beside a "Gems" button (item.ui.gems): the two share the title bar.',
    'item.window.bag': 'The inventory’s title when it is small, under another window (phones).',
    'item.window.bench': 'Window title: where orbs are used on items.',
    'item.window.ilsa': 'Window title: the trader Ilsa’s shop.',
    'item.window.brann': 'Window title: the smith Brann’s crafting bench.',
    'item.ui.gems': 'A small button that opens the skill panel (gems in the four skill slots).',
    'item.ui.level': 'The hero’s level, abbreviated, at the bottom of the inventory.',
    'item.vendor.tab.smith': 'A vendor tab: gear and orbs for sale.',
    'item.vendor.tab.gamble': 'A vendor tab: unrevealed items, bought blind.',
    'item.vendor.hint': 'Under the vendor’s goods. Ctrl is the keyboard key; click is a mouse click.',
    'item.vendor.hint_touch': 'Under the vendor’s goods on a phone: tap an item twice to buy it, drop one on the goods to sell it.',
    'item.bench.summary': 'Under the item on the crafting bench: its rarity (item.rarity.*) and how many affixes it has.',
    'item.skill.title': 'The skill panel: a skill’s name and level, abbreviated ("lv").',
    'item.skill.title_waits': 'The gem waits on the hero reaching level {hero} ("L" for level).',
    'item.skill.title_xp': 'The gem’s XP toward its next level, as a percentage.',
    'item.skill.row_cost': 'A skill slot’s row: its mana cost (MP: mana points).',
    'item.skill.row_cost_cooldown': 'A skill slot’s row: its mana cost and its cooldown in seconds.',
    'item.skill.row_channel': 'A channelled skill: mana per second.',
    'item.skill.hit': 'The skill panel: average damage of one hit and its main damage type (damage.*).',
    'item.skill.dps': 'Damage per second, then hits per second.',
    'item.skill.cost_cooldown': 'Mana cost and cooldown ("cd") in seconds.',
    'item.skill.cast': 'Time to use the skill once, in seconds.',
    'item.skill.cast_projectiles': 'Time to use the skill, and how many projectiles it fires.',
    'item.skill.cast_area': 'Time to use the skill, and its area of effect as a percentage.',
    'item.skill.unfit': 'Support gems linked to a skill they don’t work with.',
    'item.say.open_skills': 'A message under the windows when a gem is right-clicked with the skill panel closed.',
    'item.say.no_orb': '{orb} is an orb’s name (item.currency.*).',
    'item.say.apply_orb': 'After right-clicking an orb: the next item clicked gets it.',
    'item.say.not_supported': 'A support gem was linked to a skill it doesn’t work with; {support} and {skill} are gem names.',
    'item.reason.wrong_slot': 'An item dropped on a paper-doll slot it doesn’t belong in.',
    'item.reason.covers_two': 'An item dropped where it would overlap two items in the bag.',
    'item.craft.nothing': 'An Abyssal Eye (corrupting orb) was used and changed nothing but corrupting the item.',
    'damage.physical': 'A damage type’s name, lowercase: it goes inside other lines ("{type} damage", mod lines).',
  },
  max: {
    'item.window.inventory': 11,
    'item.window.bag': 17,
    'item.window.stash': 17,
    'item.window.smith': 17,
    'item.window.gem_vendor': 17,
    'item.window.bench': 17,
    'item.window.skills': 17,
    'item.window.ilsa': 17,
    'item.window.brann': 17,
    'item.ui.gems': 6,
    'item.vendor.tab.smith': 6,
    'item.vendor.tab.gems': 6,
    'item.vendor.tab.gamble': 6,
    'item.skill.empty': 8,
  },
};

/** The words a rare's name is made of, once each (a second word may serve several slots). */
const secondWords = (): string[] => [...new Set(Object.values(SECOND).flat())];

/** Every line of items and loot: the fixed ones and one per registry entry (content added as data brings its lines). */
export function ITEMS(): LineArea {
  const lines: Record<string, LineArea['lines'][string]> = { ...FIXED.lines };
  const notes: Record<string, string> = { ...FIXED.notes };
  const add = (id: string, text: string, note?: string) => {
    if (id in lines) throw new Error(`ITEMS: line ${id} is given twice`);
    lines[id] = text;
    if (note) notes[id] = note;
  };
  for (const b of BASES.all()) if (b.slot !== 'currency') add(lineKey('item.base', b.id, 'name'), b.name, 'An item base: the name of a plain (normal) item, the {base} of a magic item’s name, and the line under a rare’s or a unique’s name.');
  for (const a of [...AFFIXES.all(), ...CORRUPTIONS.all()])
    add(lineKey('item.affix', a.id, 'name'), a.name, a.type === 'prefix' ? 'A prefix: the {prefix} before the base in a magic item’s name (item.name.magic).' : 'A suffix: the {suffix} after the base in a magic item’s name (item.name.magic).');
  for (const u of UNIQUES.all()) {
    add(lineKey('item.unique', u.id, 'name'), u.name, 'A unique item’s name (one of a kind, orange). Translate or keep as a name, as the language’s action RPGs do.');
    add(lineKey('item.unique', u.id, 'flavour'), u.flavour, 'A unique item’s flavour text, in italics in other games: a short line of lore at the bottom of its tooltip.');
  }
  for (const c of CURRENCY.all()) {
    add(lineKey('item.currency', c.id, 'name'), c.name, 'A crafting orb’s name (currency).');
    add(lineKey('item.currency', c.id, 'description'), c.description, 'What the orb does, on its tooltip and the crafting bench.');
    add(lineKey('item.currency', c.id, 'short'), c.short, 'Three letters drawn on the orb’s icon on the crafting bench: an abbreviation of its name.');
  }
  for (const w of FIRST) add(lineKey('item.rare.first', w), w, 'The first word of a rare item’s random name ({first} in item.name.rare), a dark fantasy word: "Doom", "Gale".');
  for (const w of secondWords()) add(lineKey('item.rare.second', w), w, 'The second word of a rare item’s random name ({second} in item.name.rare), fitting the item: "Bite" (weapons), "Shroud" (body armour), "Band" (rings).');
  const max: Record<string, number> = { ...FIXED.max };
  for (const c of CURRENCY.all()) max[lineKey('item.currency', c.id, 'short')] = 3;
  return { lines, notes, max };
}
