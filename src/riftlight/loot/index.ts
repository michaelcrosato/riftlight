// Loot: item bases, affixes, uniques, currency, generation, crafting, inventory, vendors and
// loot in the world. The public API other systems (shell, combat, town) use. See the "Loot"
// section of docs/GAME.md.
export { AFFIXES, BASES, CORRUPTIONS, CURRENCY, GEMS, UNIQUES, affixFits, equipmentBases, uniquesFor } from './content';
export type { CraftAction, CurrencyDef } from './data/currency';
export type { GemEntry } from './data/gems';
export {
  AFFIX_LIMITS,
  DROPS,
  RARITIES,
  RARITY_WEIGHTS,
  currencyItem,
  makeUnique,
  rarityBoost,
  rarityWeights,
  rollAffix,
  rollAffixes,
  rollBase,
  rollCurrency,
  rollDrops,
  rollGem,
  rollItem,
  rollRarity,
  tierWeights,
  type DropOptions,
  type Drops,
  type RollOptions,
} from './generate';
export { alteration, annul, applyCurrency, augment, chaos, corrupt, craft, craftBlocker, divine, exalt, isCurrency, regal, scour, transmute, type CraftResult } from './craft';
export {
  EQUIP_SLOTS,
  applyEquipment,
  baseOf,
  defenceStats,
  equipmentMods,
  isEquipment,
  isTwoHanded,
  itemMods,
  rawMods,
  requiredLevel,
  sourceKey,
  weaponStats,
  type DefenceStats,
  type EquipSlot,
  type Equipment,
  type WeaponStats,
} from './itemMods';
export {
  INVENTORY_SIZE,
  STASH_SIZE,
  STASH_TABS,
  addGold,
  addItem,
  allItems,
  canPlace,
  defaultSlot,
  dropAt,
  emptyLoot,
  equip,
  equipBlocker,
  equipItem,
  findSpace,
  itemSize,
  lootFromSave,
  lootToSave,
  pickUp,
  spendGold,
  transfer,
  unequip,
  writeSave,
  type Grid,
  type LootSave,
  type LootState,
  type Placed,
} from './inventory';
export { buy, buyPrice, sell, sellPrice, vendorStock, type VendorKind } from './vendor';
export { cloneSheet, compareEquip, diffEquipment, type StatDelta } from './compare';
export { LOOT_FILTER, RARITY_COLOURS, filterTier, itemClass, itemColour, matchRule, type FilterRule, type FilterTier } from './filter';
export { PERCENT_STATS, STAT_NAMES, describeItemMod, describeItemMods } from './stats';
export { PointLightPool, WorldLoot, type GroundDrop, type LightHandle, type LightPool, type WorldLootOptions } from './world';
