/**
 * Item words in the player's language (docs/game/lang.md): an item's name made from its parts (its
 * base, its affixes, its unique, its gem, a rare's two words), the parts' own lines, damage types,
 * item classes, ground labels and the reasons a loot action can't be done. The lines are in
 * `lang/items.ts`; the registries keep their English (the source line), and `Item.name` keeps the
 * English as rolled (tools, logs, and what an old save shows when its parts aren't known).
 */
import type { LineValues } from '../../engine';
import type { DamageType, Item } from '../core/types';
import { lang, lineKey, t } from '../lang';
import type { ReasonId } from '../lang/items';
import { skillDescription, skillName, supportDescription, supportName } from '../lang/skills';
import { AFFIXES, BASES, CORRUPTIONS, CURRENCY, UNIQUES } from './content';
import { FIRST, SECOND } from './data/names';

/** Why a loot action can't be done: an `item.reason.<id>` line and its blanks (gameplay returns it, the windows show it). */
export interface Reason {
  readonly id: ReasonId;
  readonly values?: LineValues;
}

/** The reason in the player's language. */
export const reasonText = (r: Reason): string => t(`item.reason.${r.id}`, r.values);

/** A base's name (an orb's for currency). */
export function baseName(id: string): string {
  return CURRENCY.has(id) ? t(lineKey('item.currency', id, 'name')) : t(lineKey('item.base', id, 'name'));
}

/** An affix's (or a corruption's) name: a prefix or a suffix word. */
export const affixName = (id: string): string => t(lineKey('item.affix', id, 'name'));
export const uniqueName = (id: string): string => t(lineKey('item.unique', id, 'name'));
export const uniqueFlavour = (id: string): string => t(lineKey('item.unique', id, 'flavour'));
export const currencyName = (id: string): string => t(lineKey('item.currency', id, 'name'));
export const currencyDescription = (id: string): string => t(lineKey('item.currency', id, 'description'));
/** The three letters on an orb's icon. */
export const currencyShort = (id: string): string => t(lineKey('item.currency', id, 'short'));
/** A damage type's name, lowercase ("fire"): it goes inside other lines. */
export const damageName = (type: DamageType | string): string => t(lineKey('damage', type));
/** An item class (a base's `look`: "Sword", "Body armour"). */
export const className = (look: string): string => t(lineKey('item.class', look));
/** A rarity's name ("Magic"). */
export const rarityName = (rarity: Item['rarity']): string => t(lineKey('item.rarity', rarity));

/** A gem's name: its skill's or its support's (the skills area's lines). */
export function gemName(id: string, support: boolean): string {
  return support ? supportName(id) : skillName(id);
}

/** A gem's description (its skill's or support's), or null when it has none. */
export function gemDescription(id: string, support: boolean): string | null {
  return (support ? supportDescription(id) : skillDescription(id)) || null;
}

/** Words as a list in the player's language ("fire, spell, projectile"). */
export function listText(parts: readonly string[]): string {
  const l = lang();
  try {
    return new Intl.ListFormat(l.fake ? l.source.language : l.code, { type: 'unit', style: 'short' }).format(parts);
  } catch {
    return parts.join(', ');
  }
}


const FIRST_WORDS: ReadonlySet<string> = new Set(FIRST);
const SECOND_WORDS: ReadonlySet<string> = new Set(Object.values(SECOND).flat());

/** A magic item's name from its base and its first prefix and suffix (as `magicName` rolls it). */
function magicItemName(item: Item): string {
  const defs = item.affixes.filter((a) => AFFIXES.has(a.id)).map((a) => AFFIXES.get(a.id));
  const p = defs.find((a) => a.type === 'prefix');
  const s = defs.find((a) => a.type === 'suffix');
  const base = baseName(item.base);
  if (p && s) return t('item.name.magic', { prefix: affixName(p.id), base, suffix: affixName(s.id) });
  if (p) return t('item.name.magic_prefix', { prefix: affixName(p.id), base });
  if (s) return t('item.name.magic_suffix', { base, suffix: affixName(s.id) });
  return base;
}

/**
 * An item's name in the player's language, from its parts: a gem's skill, an orb, a unique, a
 * magic item's base and affixes, a rare's two words. An item whose parts aren't known (an old
 * save's rare, a base that is gone) shows the name it was saved with.
 */
export function itemName(item: Item): string {
  if (!BASES.has(item.base)) return item.name;
  if (item.gamble) return t('item.name.unrevealed', { base: baseName(item.base) });
  if (item.gem) return gemName(item.gem.id, item.gem.support);
  if (CURRENCY.has(item.base)) return currencyName(item.base);
  if (item.rarity === 'unique') return item.unique && UNIQUES.has(item.unique) ? uniqueName(item.unique) : item.name;
  if (item.rarity === 'magic') return magicItemName(item);
  if (item.rarity === 'rare') {
    const w = item.words;
    return w && FIRST_WORDS.has(w[0]) && SECOND_WORDS.has(w[1]) ? t('item.name.rare', { first: t(lineKey('item.rare.first', w[0])), second: t(lineKey('item.rare.second', w[1])) }) : item.name;
  }
  return baseName(item.base);
}

/** An item as a label on the ground or in the feed: its name, with how many for a stack. */
export function itemLabel(item: Item): string {
  const q = item.quantity ?? 1;
  return q > 1 ? t('item.label.stack', { count: q, name: itemName(item) }) : itemName(item);
}

/** A pile of gold as a label ("120 gold"). */
export const goldLabel = (amount: number): string => t('item.label.gold', { count: amount });

/** An affix's or a corruption's definition by id (null when neither has it). */
export const affixDef = (id: string) => (AFFIXES.has(id) ? AFFIXES.get(id) : CORRUPTIONS.has(id) ? CORRUPTIONS.get(id) : null);

/** The settings' loot filter choices, in order (`settings.lootFilter`: 0 show all, 1 hide normal, 2 rares only). */
export const lootFilterOptions = (): string[] => [t('item.filter.show_all'), t('item.filter.hide_normal'), t('item.filter.rares_only')];
