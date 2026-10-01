/**
 * The default loot filter, as data. Rules are checked top to bottom; the first rule whose
 * `when` matches decides how a dropped item is shown. Every condition in `when` must hold
 * (an empty `when` matches everything). Alt toggles the filter off (show everything).
 *
 * Tiers: 'loud' (big label, border, beam, louder sound), 'show' (label), 'dim' (small grey
 * label), 'hide' (no label, no mesh; Alt shows it).
 */
import type { ItemSlot, Rarity } from '../../core/types';

export type FilterTier = 'hide' | 'dim' | 'show' | 'loud';

export interface FilterRule {
  readonly id: string;
  readonly when: {
    readonly rarity?: readonly Rarity[];
    readonly slot?: readonly ItemSlot[];
    /** Any of these base tags (e.g. a currency action: 'exalt'). */
    readonly tags?: readonly string[];
    /** Applies from this depth on (inclusive). */
    readonly minDepth?: number;
    readonly maxDepth?: number;
    /** Item level at least / at most. */
    readonly minLevel?: number;
  };
  readonly tier: FilterTier;
}

export const LOOT_FILTER: readonly FilterRule[] = [
  { id: 'uniques', when: { rarity: ['unique'] }, tier: 'loud' },
  { id: 'valuable-currency', when: { slot: ['currency'], tags: ['exalt', 'divine', 'annul', 'corrupt'] }, tier: 'loud' },
  { id: 'currency', when: { slot: ['currency'] }, tier: 'show' },
  { id: 'gems', when: { slot: ['gem'] }, tier: 'show' },
  { id: 'rares', when: { rarity: ['rare'] }, tier: 'show' },
  { id: 'jewellery', when: { slot: ['ring', 'amulet', 'belt'] }, tier: 'show' },
  { id: 'late-magic', when: { rarity: ['magic'], minDepth: 16 }, tier: 'dim' },
  { id: 'late-normal', when: { rarity: ['normal'], minDepth: 6 }, tier: 'hide' },
  { id: 'early-normal', when: { rarity: ['normal'] }, tier: 'dim' },
  { id: 'default', when: {}, tier: 'show' },
];
