/**
 * Loot's registries: every base, affix, unique, currency and gem, queryable by tags
 * (docs/GAME.md rule 1). Adding content is adding an entry to a file in `data/`.
 */
import { Registry } from '../core/registry';
import type { Affix, ItemBase, UniqueDef } from '../core/types';
import { AFFIXES as AFFIX_DATA, CORRUPTIONS as CORRUPTION_DATA } from './data/affixes';
import { EQUIPMENT_BASES } from './data/bases';
import { CURRENCY as CURRENCY_DATA, CURRENCY_BASES, type CurrencyDef } from './data/currency';
import { GEM_BASES, GEMS as GEM_DATA, type GemEntry } from './data/gems';
import { UNIQUES as UNIQUE_DATA } from './data/uniques';

export const BASES = new Registry<ItemBase>('item base', [...EQUIPMENT_BASES, ...CURRENCY_BASES, ...GEM_BASES]);
export const AFFIXES = new Registry<Affix>('affix', AFFIX_DATA);
export const CORRUPTIONS = new Registry<Affix>('corruption', CORRUPTION_DATA);
export const UNIQUES = new Registry<UniqueDef>('unique', UNIQUE_DATA);
export const CURRENCY = new Registry<CurrencyDef>('currency', CURRENCY_DATA);
export const GEMS = new Registry<GemEntry>('gem', GEM_DATA);

/** Equipment bases only (no currency, no gems). */
export const equipmentBases = (): ItemBase[] => BASES.query({ none: ['currency', 'gem'] });

/** True when `affix` can roll on `base` (any `on` tag matches the base's slot or tags). */
export function affixFits(affix: Affix, base: ItemBase): boolean {
  const tags = base.tags ?? [];
  return affix.on.some((t) => t === base.slot || tags.includes(t));
}

/** Uniques built on `base` (or all uniques). */
export function uniquesFor(base?: string): UniqueDef[] {
  return UNIQUES.all().filter((u) => !base || u.base === base);
}
