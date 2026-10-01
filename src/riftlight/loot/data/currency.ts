/**
 * Currency: crafting orbs with Riftlight names, plus how often they drop and what a vendor
 * pays for them. Each orb names a crafting `action`; `craft.ts` implements the actions.
 * Orbs are items too (slot 'currency', stackable): `CURRENCY_BASES` turns each into an
 * `ItemBase` so inventories, filters and the ground treat them like any other item.
 */
import type { Entry } from '../../core/registry';
import type { ItemBase } from '../../core/types';

export type CraftAction = 'transmute' | 'augment' | 'alteration' | 'regal' | 'chaos' | 'exalt' | 'annul' | 'scour' | 'divine' | 'corrupt';

export interface CurrencyDef extends Entry {
  readonly name: string;
  readonly action: CraftAction;
  readonly description: string;
  /** Max stack in one inventory cell. */
  readonly stack: number;
  /** Gold a vendor pays for one. */
  readonly value: number;
  /** Minimum item level (monster level) to drop. */
  readonly level: number;
  /** Three-letter label drawn on the icon. */
  readonly short: string;
}

export const CURRENCY: readonly CurrencyDef[] = [
  { id: 'kindling-shard', name: 'Kindling Shard', short: 'KIN', action: 'transmute', description: 'Upgrades a normal item to a magic item', stack: 40, value: 2, level: 1, weight: 400 },
  { id: 'ember-bead', name: 'Ember Bead', short: 'EMB', action: 'augment', description: 'Adds a new affix to a magic item with room for one', stack: 30, value: 3, level: 1, weight: 300 },
  { id: 'shifting-ash', name: 'Shifting Ash', short: 'ASH', action: 'alteration', description: 'Rerolls the affixes of a magic item', stack: 40, value: 3, level: 1, weight: 320 },
  { id: 'crown-cinder', name: 'Crown Cinder', short: 'CRN', action: 'regal', description: 'Upgrades a magic item to a rare item, adding one affix', stack: 20, value: 12, level: 6, weight: 80 },
  { id: 'rift-ember', name: 'Rift Ember', short: 'RFT', action: 'chaos', description: 'Rerolls a rare item with new random affixes', stack: 20, value: 15, level: 10, weight: 70 },
  { id: 'starfall-orb', name: 'Starfall Orb', short: 'STR', action: 'exalt', description: 'Adds a new random affix to a rare item', stack: 10, value: 60, level: 25, weight: 12 },
  { id: 'hollow-orb', name: 'Hollow Orb', short: 'HOL', action: 'annul', description: 'Removes a random affix from a magic or rare item', stack: 10, value: 40, level: 20, weight: 18 },
  { id: 'cleansing-salt', name: 'Cleansing Salt', short: 'SLT', action: 'scour', description: 'Removes every affix, leaving a normal item', stack: 30, value: 6, level: 4, weight: 120 },
  { id: 'sunsoul-orb', name: 'Sunsoul Orb', short: 'SUN', action: 'divine', description: 'Rerolls the values of every affix within its tier', stack: 10, value: 80, level: 30, weight: 8 },
  { id: 'abyssal-eye', name: 'Abyssal Eye', short: 'EYE', action: 'corrupt', description: 'Corrupts an item with unpredictable results. It can no longer be crafted', stack: 10, value: 25, level: 15, weight: 30 },
];

export const CURRENCY_BASES: readonly ItemBase[] = CURRENCY.map((c) => ({
  id: c.id,
  name: c.name,
  slot: 'currency',
  level: c.level,
  implicit: [],
  base: { stack: c.stack },
  look: 'orb',
  tags: ['currency', c.action],
  weight: c.weight,
}));
