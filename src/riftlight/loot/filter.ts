/**
 * Loot filter evaluation and the rarity colours everything (labels, beams, tooltips, icons)
 * agrees on. The rules themselves are data in `data/filter.ts`.
 */
import { PALETTE } from '../../engine/palette';
import type { Item, Rarity } from '../core/types';
import { LOOT_FILTER, type FilterRule, type FilterTier } from './data/filter';
import { baseOf } from './itemMods';

export type { FilterRule, FilterTier };
export { LOOT_FILTER };

/** Colour per rarity (PALETTE): normal white, magic sky, rare sand, unique orange; currency mist, gems cyan. */
export const RARITY_COLOURS: Readonly<Record<Rarity | 'currency' | 'gem', number>> = {
  normal: PALETTE.white,
  magic: PALETTE.sky,
  rare: PALETTE.sand,
  unique: PALETTE.orange,
  currency: PALETTE.mist,
  gem: PALETTE.cyan,
};

export const GOLD_COLOUR = PALETTE.sand;

/** Display class: the rarity, or 'currency' / 'gem'. */
export function itemClass(item: Item): Rarity | 'currency' | 'gem' {
  const slot = baseOf(item).slot;
  if (slot === 'currency') return 'currency';
  if (slot === 'gem') return 'gem';
  return item.rarity;
}

export function itemColour(item: Item): number {
  return RARITY_COLOURS[itemClass(item)];
}

/** The first matching rule for `item` dropped at `depth` (rules are checked in order). */
export function matchRule(item: Item, depth: number, rules: readonly FilterRule[] = LOOT_FILTER): FilterRule | null {
  const base = baseOf(item);
  const tags = base.tags ?? [];
  for (const r of rules) {
    const w = r.when;
    if (w.rarity && !w.rarity.includes(item.rarity)) continue;
    if (w.slot && !w.slot.includes(base.slot)) continue;
    if (w.tags && !w.tags.some((t) => tags.includes(t))) continue;
    if (w.minDepth !== undefined && depth < w.minDepth) continue;
    if (w.maxDepth !== undefined && depth > w.maxDepth) continue;
    if (w.minLevel !== undefined && item.level < w.minLevel) continue;
    return r;
  }
  return null;
}

/** How `item` shows on the ground at `depth` ('show' when no rule matches). */
export function filterTier(item: Item, depth: number, rules: readonly FilterRule[] = LOOT_FILTER): FilterTier {
  return matchRule(item, depth, rules)?.tier ?? 'show';
}
