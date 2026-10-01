/**
 * Item bases, hand-made in level tiers. Each base is plain data: slot, minimum item level,
 * implicit mods, base stats and tags. Affixes find the bases they roll on through tags
 * (`Affix.on`), the generator picks bases by weight among those at or under the item level.
 *
 * Base stats (`base`):
 *   weapons  physical [min, max], aps (attacks/s), crit (fraction), range (m)
 *   armour   armour, evasion, es; shields add block (fraction)
 *
 * Tags: the slot ('weapon', 'helm', ...), the class (`look`: 'sword', 'bow', ...),
 * 'onehand' | 'twohand', 'melee' | 'ranged', 'attack' or 'caster', defence types
 * 'ar' | 'ev' | 'es', 'armour' (helm/body/gloves/boots/shield) and 'jewellery'.
 */
import { flat, inc } from '../../core/mods';
import type { ItemBase } from '../../core/types';

type B = Omit<ItemBase, 'slot' | 'implicit' | 'tags' | 'look'> & { implicit?: ItemBase['implicit']; tags?: readonly string[] };

const weapon = (look: string, hands: 1 | 2, kind: 'melee' | 'ranged' | 'caster', extra: readonly string[] = []) =>
  (b: B): ItemBase => ({
    ...b,
    slot: 'weapon',
    look,
    implicit: b.implicit ?? [],
    tags: ['weapon', look, hands === 1 ? 'onehand' : 'twohand', ...(kind === 'caster' ? ['caster'] : ['attack', kind]), ...extra, ...(b.tags ?? [])],
  });

const armour = (slot: ItemBase['slot'], def: 'ar' | 'ev' | 'es') =>
  (b: B): ItemBase => ({ ...b, slot, look: slot, implicit: b.implicit ?? [], tags: [slot, 'armour', def, ...(b.tags ?? [])] });

const offhand = (look: 'shield' | 'quiver' | 'focus', def?: 'ar' | 'ev' | 'es') =>
  (b: B): ItemBase => ({
    ...b,
    slot: 'offhand',
    look,
    implicit: b.implicit ?? [],
    tags: ['offhand', look, ...(look === 'shield' ? ['armour'] : []), ...(look === 'focus' ? ['caster'] : []), ...(def ? [def] : []), ...(b.tags ?? [])],
  });

const jewel = (slot: 'amulet' | 'ring' | 'belt') =>
  (b: B): ItemBase => ({ ...b, slot, look: slot, implicit: b.implicit ?? [], tags: [slot, ...(slot === 'belt' ? [] : ['jewellery']), ...(b.tags ?? [])] });

const sword = weapon('sword', 1, 'melee');
const sword2 = weapon('sword', 2, 'melee');
const axe = weapon('axe', 1, 'melee');
const axe2 = weapon('axe', 2, 'melee');
const mace = weapon('mace', 1, 'melee');
const mace2 = weapon('mace', 2, 'melee');
const dagger = weapon('dagger', 1, 'melee');
const bow = weapon('bow', 2, 'ranged', ['projectile']);
const staff = weapon('staff', 2, 'caster');
const wand = weapon('wand', 1, 'caster');
const sceptre = weapon('sceptre', 1, 'caster', ['melee', 'attack']);

export const WEAPON_BASES: readonly ItemBase[] = [
  // swords: crit multiplier implicit
  sword({ id: 'rusted-blade', name: 'Rusted Blade', level: 1, base: { physical: [4, 9], aps: 1.5, crit: 0.05, range: 1.6 }, implicit: [flat('crit.multi', 0.1)] }),
  sword({ id: 'arming-sword', name: 'Arming Sword', level: 12, base: { physical: [9, 20], aps: 1.5, crit: 0.05, range: 1.6 }, implicit: [flat('crit.multi', 0.15)] }),
  sword({ id: 'ember-sabre', name: 'Ember Sabre', level: 28, base: { physical: [16, 34], aps: 1.55, crit: 0.055, range: 1.6 }, implicit: [flat('crit.multi', 0.2)] }),
  sword({ id: 'riftsteel-blade', name: 'Riftsteel Blade', level: 50, base: { physical: [26, 55], aps: 1.6, crit: 0.06, range: 1.7 }, implicit: [flat('crit.multi', 0.25)] }),
  sword2({ id: 'bastard-sword', name: 'Bastard Sword', level: 5, base: { physical: [11, 22], aps: 1.25, crit: 0.05, range: 2.1 }, implicit: [flat('crit.multi', 0.2)] }),
  sword2({ id: 'greatsword', name: 'Greatsword', level: 30, base: { physical: [34, 70], aps: 1.25, crit: 0.05, range: 2.2 }, implicit: [flat('crit.multi', 0.3)] }),
  sword2({ id: 'starforged-claymore', name: 'Starforged Claymore', level: 55, base: { physical: [56, 116], aps: 1.3, crit: 0.055, range: 2.3 }, implicit: [flat('crit.multi', 0.4)] }),
  // axes: no implicit, highest damage
  axe({ id: 'hatchet', name: 'Hatchet', level: 2, base: { physical: [5, 11], aps: 1.4, crit: 0.05, range: 1.5 } }),
  axe({ id: 'bearded-axe', name: 'Bearded Axe', level: 22, base: { physical: [14, 33], aps: 1.4, crit: 0.05, range: 1.5 } }),
  axe({ id: 'cinder-cleaver', name: 'Cinder Cleaver', level: 45, base: { physical: [26, 58], aps: 1.45, crit: 0.05, range: 1.6 } }),
  axe2({ id: 'woodsplitter', name: 'Woodsplitter', level: 6, base: { physical: [14, 27], aps: 1.2, crit: 0.05, range: 2.0 } }),
  axe2({ id: 'executioner-axe', name: 'Executioner Axe', level: 35, base: { physical: [44, 90], aps: 1.2, crit: 0.05, range: 2.1 } }),
  axe2({ id: 'gravewell-reaver', name: 'Gravewell Reaver', level: 60, base: { physical: [70, 140], aps: 1.25, crit: 0.05, range: 2.2 } }),
  // maces: knockback implicit
  mace({ id: 'club', name: 'Club', level: 1, base: { physical: [5, 8], aps: 1.4, crit: 0.05, range: 1.5 }, implicit: [inc('knockback', 0.2)] }),
  mace({ id: 'flanged-mace', name: 'Flanged Mace', level: 20, base: { physical: [14, 26], aps: 1.4, crit: 0.05, range: 1.5 }, implicit: [inc('knockback', 0.3)] }),
  mace({ id: 'stormhammer', name: 'Stormhammer', level: 48, base: { physical: [28, 50], aps: 1.4, crit: 0.05, range: 1.6 }, implicit: [inc('knockback', 0.4)] }),
  mace2({ id: 'maul', name: 'Maul', level: 8, base: { physical: [16, 30], aps: 1.15, crit: 0.05, range: 2.0 }, implicit: [inc('area', 0.1)] }),
  mace2({ id: 'war-hammer', name: 'War Hammer', level: 32, base: { physical: [44, 82], aps: 1.15, crit: 0.05, range: 2.0 }, implicit: [inc('area', 0.15)] }),
  mace2({ id: 'collapse-maul', name: 'Collapse Maul', level: 58, base: { physical: [72, 134], aps: 1.2, crit: 0.05, range: 2.1 }, implicit: [inc('area', 0.2)] }),
  // daggers: crit chance implicit
  dagger({ id: 'shiv', name: 'Shiv', level: 1, base: { physical: [3, 10], aps: 1.6, crit: 0.065, range: 1.3 }, implicit: [inc('crit.chance', 0.3)] }),
  dagger({ id: 'kris', name: 'Kris', level: 18, base: { physical: [8, 28], aps: 1.6, crit: 0.07, range: 1.3 }, implicit: [inc('crit.chance', 0.4)] }),
  dagger({ id: 'gloomfang', name: 'Gloomfang', level: 42, base: { physical: [16, 54], aps: 1.65, crit: 0.075, range: 1.3 }, implicit: [inc('crit.chance', 0.5)] }),
  // bows
  bow({ id: 'short-bow', name: 'Short Bow', level: 1, base: { physical: [4, 12], aps: 1.4, crit: 0.05, range: 14 } }),
  bow({ id: 'recurve-bow', name: 'Recurve Bow', level: 16, base: { physical: [11, 32], aps: 1.35, crit: 0.06, range: 15 } }),
  bow({ id: 'galebow', name: 'Galebow', level: 38, base: { physical: [22, 62], aps: 1.4, crit: 0.06, range: 16 }, implicit: [inc('projectile.speed', 0.2)] }),
  bow({ id: 'riftstring-longbow', name: 'Riftstring Longbow', level: 62, base: { physical: [38, 104], aps: 1.35, crit: 0.065, range: 18 }, implicit: [flat('projectiles', 1)] }),
  // staves: block implicit, spell damage
  staff({ id: 'gnarled-staff', name: 'Gnarled Staff', level: 3, base: { physical: [8, 16], aps: 1.2, crit: 0.06, range: 2.0 }, implicit: [flat('block.chance', 0.12), inc('damage', 0.15, ['spell'])] }),
  staff({ id: 'quarterstaff', name: 'Quarterstaff', level: 24, base: { physical: [22, 44], aps: 1.25, crit: 0.06, range: 2.0 }, implicit: [flat('block.chance', 0.15), inc('damage', 0.25, ['spell'])] }),
  staff({ id: 'stormspire-staff', name: 'Stormspire Staff', level: 52, base: { physical: [40, 80], aps: 1.25, crit: 0.065, range: 2.1 }, implicit: [flat('block.chance', 0.18), inc('damage', 0.4, ['spell'])] }),
  // wands: spell damage implicit
  wand({ id: 'driftwood-wand', name: 'Driftwood Wand', level: 1, base: { physical: [3, 6], aps: 1.4, crit: 0.07, range: 12 }, implicit: [inc('damage', 0.1, ['spell'])] }),
  wand({ id: 'bone-wand', name: 'Bone Wand', level: 20, base: { physical: [8, 15], aps: 1.4, crit: 0.07, range: 12 }, implicit: [inc('damage', 0.18, ['spell'])] }),
  wand({ id: 'prism-wand', name: 'Prism Wand', level: 46, base: { physical: [15, 28], aps: 1.45, crit: 0.075, range: 13 }, implicit: [inc('damage', 0.26, ['spell'])] }),
  // sceptres: elemental damage implicit, attack or cast
  sceptre({ id: 'stone-sceptre', name: 'Stone Sceptre', level: 4, base: { physical: [6, 10], aps: 1.3, crit: 0.06, range: 1.5 }, implicit: [inc('fire.damage', 0.1), inc('cold.damage', 0.1), inc('lightning.damage', 0.1)] }),
  sceptre({ id: 'crystal-sceptre', name: 'Crystal Sceptre', level: 26, base: { physical: [16, 26], aps: 1.3, crit: 0.06, range: 1.5 }, implicit: [inc('fire.damage', 0.16), inc('cold.damage', 0.16), inc('lightning.damage', 0.16)] }),
  sceptre({ id: 'riftlight-sceptre', name: 'Riftlight Sceptre', level: 54, base: { physical: [30, 48], aps: 1.35, crit: 0.065, range: 1.6 }, implicit: [inc('fire.damage', 0.22), inc('cold.damage', 0.22), inc('lightning.damage', 0.22)] }),
];

const shield = offhand('shield');
export const OFFHAND_BASES: readonly ItemBase[] = [
  offhand('shield', 'ev')({ id: 'buckler', name: 'Buckler', level: 1, base: { evasion: 18, block: 0.2 } }),
  offhand('shield', 'ar')({ id: 'kite-shield', name: 'Kite Shield', level: 10, base: { armour: 40, block: 0.24 } }),
  offhand('shield', 'es')({ id: 'spirit-shield', name: 'Spirit Shield', level: 20, base: { es: 22, block: 0.22 }, implicit: [inc('damage', 0.1, ['spell'])] }),
  offhand('shield', 'ar')({ id: 'tower-shield', name: 'Tower Shield', level: 34, base: { armour: 130, block: 0.26 }, implicit: [flat('life', 20)] }),
  shield({ id: 'mirrored-shield', name: 'Mirrored Shield', level: 50, base: { armour: 120, es: 34, block: 0.25 }, tags: ['ar', 'es'], implicit: [flat('res.fire', 0.06), flat('res.cold', 0.06), flat('res.lightning', 0.06)] }),
  offhand('quiver')({ id: 'hide-quiver', name: 'Hide Quiver', level: 1, base: {}, implicit: [flat('added.physical.min', 1, ['attack', 'projectile']), flat('added.physical.max', 4, ['attack', 'projectile'])] }),
  offhand('quiver')({ id: 'serrated-quiver', name: 'Serrated Quiver', level: 25, base: {}, implicit: [flat('bleed.chance', 0.15, ['projectile'])] }),
  offhand('quiver')({ id: 'stormfletch-quiver', name: 'Stormfletch Quiver', level: 48, base: {}, implicit: [inc('projectile.speed', 0.25), inc('attack.speed', 0.06, ['projectile'])] }),
  offhand('focus', 'es')({ id: 'twig-focus', name: 'Twig Focus', level: 2, base: { es: 12 }, implicit: [inc('cast.speed', 0.04)] }),
  offhand('focus', 'es')({ id: 'lens-focus', name: 'Lens Focus', level: 30, base: { es: 38 }, implicit: [inc('cast.speed', 0.08)] }),
];

export const ARMOUR_BASES: readonly ItemBase[] = [
  armour('helm', 'ar')({ id: 'iron-hat', name: 'Iron Hat', level: 1, base: { armour: 14 } }),
  armour('helm', 'ar')({ id: 'great-helm', name: 'Great Helm', level: 30, base: { armour: 92 } }),
  armour('helm', 'ev')({ id: 'leather-cap', name: 'Leather Cap', level: 1, base: { evasion: 14 } }),
  armour('helm', 'ev')({ id: 'hunter-hood', name: 'Hunter Hood', level: 28, base: { evasion: 88 } }),
  armour('helm', 'es')({ id: 'circlet', name: 'Circlet', level: 3, base: { es: 8 } }),
  armour('helm', 'es')({ id: 'riftseer-crown', name: 'Riftseer Crown', level: 32, base: { es: 36 }, implicit: [inc('light.radius', 0.1)] }),
  armour('body', 'ar')({ id: 'plate-vest', name: 'Plate Vest', level: 1, base: { armour: 24 } }),
  armour('body', 'ar')({ id: 'full-plate', name: 'Full Plate', level: 34, base: { armour: 190 } }),
  armour('body', 'ev')({ id: 'padded-jacket', name: 'Padded Jacket', level: 1, base: { evasion: 24 } }),
  armour('body', 'ev')({ id: 'shadow-coat', name: 'Shadow Coat', level: 30, base: { evasion: 170 } }),
  armour('body', 'es')({ id: 'simple-robe', name: 'Simple Robe', level: 2, base: { es: 16 } }),
  armour('body', 'es')({ id: 'starweave-vestment', name: 'Starweave Vestment', level: 36, base: { es: 76 } }),
  armour('gloves', 'ar')({ id: 'iron-gauntlets', name: 'Iron Gauntlets', level: 1, base: { armour: 8 } }),
  armour('gloves', 'ar')({ id: 'ember-gauntlets', name: 'Ember Gauntlets', level: 30, base: { armour: 70 } }),
  armour('gloves', 'ev')({ id: 'rawhide-gloves', name: 'Rawhide Gloves', level: 1, base: { evasion: 8 } }),
  armour('gloves', 'ev')({ id: 'gale-wraps', name: 'Gale Wraps', level: 28, base: { evasion: 66 } }),
  armour('gloves', 'es')({ id: 'wool-gloves', name: 'Wool Gloves', level: 2, base: { es: 6 } }),
  armour('gloves', 'es')({ id: 'conjurer-gloves', name: 'Conjurer Gloves', level: 32, base: { es: 26 } }),
  armour('boots', 'ar')({ id: 'iron-greaves', name: 'Iron Greaves', level: 1, base: { armour: 8 } }),
  armour('boots', 'ar')({ id: 'warden-boots', name: 'Warden Boots', level: 30, base: { armour: 70 } }),
  armour('boots', 'ev')({ id: 'rawhide-boots', name: 'Rawhide Boots', level: 1, base: { evasion: 8 } }),
  armour('boots', 'ev')({ id: 'stalker-boots', name: 'Stalker Boots', level: 28, base: { evasion: 66 } }),
  armour('boots', 'es')({ id: 'wool-shoes', name: 'Wool Shoes', level: 2, base: { es: 6 } }),
  armour('boots', 'es')({ id: 'riftwalker-slippers', name: 'Riftwalker Slippers', level: 32, base: { es: 26 }, implicit: [inc('move.speed', 0.04)] }),
];

export const JEWELLERY_BASES: readonly ItemBase[] = [
  jewel('amulet')({ id: 'coral-amulet', name: 'Coral Amulet', level: 1, base: {}, implicit: [flat('life.regen', 2)] }),
  jewel('amulet')({ id: 'amber-amulet', name: 'Amber Amulet', level: 8, base: {}, implicit: [inc('damage', 0.08)] }),
  jewel('amulet')({ id: 'lapis-amulet', name: 'Lapis Amulet', level: 16, base: {}, implicit: [flat('mana', 25)] }),
  jewel('amulet')({ id: 'lantern-amulet', name: 'Lantern Amulet', level: 30, base: {}, implicit: [inc('light.radius', 0.15), flat('res.chaos', 0.07)] }),
  jewel('ring')({ id: 'iron-ring', name: 'Iron Ring', level: 1, base: {}, implicit: [flat('added.physical.min', 1, ['attack']), flat('added.physical.max', 4, ['attack'])] }),
  jewel('ring')({ id: 'ruby-ring', name: 'Ruby Ring', level: 5, base: {}, implicit: [flat('res.fire', 0.2)] }),
  jewel('ring')({ id: 'sapphire-ring', name: 'Sapphire Ring', level: 5, base: {}, implicit: [flat('res.cold', 0.2)] }),
  jewel('ring')({ id: 'topaz-ring', name: 'Topaz Ring', level: 5, base: {}, implicit: [flat('res.lightning', 0.2)] }),
  jewel('ring')({ id: 'prism-ring', name: 'Prism Ring', level: 24, base: {}, implicit: [flat('res.fire', 0.08), flat('res.cold', 0.08), flat('res.lightning', 0.08)] }),
  jewel('ring')({ id: 'gold-ring', name: 'Gold Ring', level: 20, base: {}, implicit: [inc('item.rarity', 0.12)] }),
  jewel('belt')({ id: 'leather-belt', name: 'Leather Belt', level: 1, base: {}, implicit: [flat('life', 20)] }),
  jewel('belt')({ id: 'heavy-belt', name: 'Heavy Belt', level: 10, base: {}, implicit: [flat('armour', 40)] }),
  jewel('belt')({ id: 'chain-belt', name: 'Chain Belt', level: 22, base: {}, implicit: [flat('energy.shield', 15)] }),
];

/** Every equippable base (gems and currency have their own registries). */
export const EQUIPMENT_BASES: readonly ItemBase[] = [...WEAPON_BASES, ...OFFHAND_BASES, ...ARMOUR_BASES, ...JEWELLERY_BASES];
