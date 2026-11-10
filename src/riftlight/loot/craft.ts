/**
 * Crafting: one pure function per currency action. Each takes an Rng and an item and
 * returns a new item (items are immutable; the uid is kept so inventories still find it),
 * or a reason it can't apply (a `Reason`: a line id the item windows show, loot/names.ts).
 * `applyCurrency(rng, currencyId, item)` looks up the action.
 */
import type { Rng } from '../core/rng';
import type { Item, RolledAffix } from '../core/types';
import type { CraftNote, ReasonId } from '../lang/items';
import { AFFIXES, affixFits, BASES, CORRUPTIONS, CURRENCY } from './content';
import type { CraftAction } from './data/currency';
import { addAffix, AFFIX_LIMITS, magicName, rareName, rollAffixes, rollTierMods } from './generate';
import { baseOf, isEquipment } from './itemMods';
import type { Reason } from './names';

/** A crafted item (and, for a corrupting orb, what it did), or why the orb can't be used. */
export type CraftResult = { ok: true; item: Item; note?: CraftNote } | { ok: false; reason: Reason };

const fail = (reason: Reason): CraftResult => ({ ok: false, reason });
const ok = (item: Item, note?: CraftNote): CraftResult => ({ ok: true, item, ...(note ? { note } : {}) });

/** Why `action` can't apply to `item`, or null when it can. */
export function craftBlocker(action: CraftAction, item: Item): Reason | null {
  const why = (id: ReasonId | null): Reason | null => (id ? { id } : null);
  if (!isEquipment(item)) return why('equipment_only');
  if (item.corrupted) return why('corrupted');
  if (action === 'corrupt') return null;
  if (item.rarity === 'unique') return why('unique');
  const n = item.affixes.length;
  switch (action) {
    case 'transmute':
      return why(item.rarity === 'normal' ? null : 'needs_normal');
    case 'augment':
      return why(item.rarity !== 'magic' ? 'needs_magic' : n >= AFFIX_LIMITS.magic.max ? 'no_affix_room' : null);
    case 'alteration':
      return why(item.rarity === 'magic' ? null : 'needs_magic');
    case 'regal':
      return why(item.rarity === 'magic' ? null : 'needs_magic');
    case 'chaos':
      return why(item.rarity === 'rare' ? null : 'needs_rare');
    case 'exalt':
      return why(item.rarity !== 'rare' ? 'needs_rare' : n >= AFFIX_LIMITS.rare.max ? 'no_affix_room' : null);
    case 'annul':
      return why(n > 0 ? null : 'no_affix');
    case 'scour':
      return why(item.rarity === 'magic' || item.rarity === 'rare' ? null : 'needs_magic_or_rare');
    case 'divine':
      return why(n > 0 ? null : 'no_affix_values');
  }
}

/** The item without a rare's name words (it is no longer rare). */
function plain(item: Item): Item {
  if (!item.words) return item;
  const out: { -readonly [K in keyof Item]: Item[K] } = { ...item };
  delete out.words;
  return out;
}

/** Upgrade a normal item to magic (1–2 affixes). */
export function transmute(rng: Rng, item: Item): CraftResult {
  return run('transmute', item, () => {
    const base = baseOf(item);
    const affixes = rollAffixes(rng, base, item.level, 'magic');
    return { ...item, rarity: 'magic', affixes, name: magicName(base, affixes) };
  });
}

/** Add an affix to a magic item with room. */
export function augment(rng: Rng, item: Item): CraftResult {
  return run('augment', item, () => {
    const base = baseOf(item);
    const a = addAffix(rng, base, item.level, 'magic', item.affixes);
    if (!a) return null;
    const affixes = [...item.affixes, a];
    return { ...item, affixes, name: magicName(base, affixes) };
  });
}

/** Reroll a magic item's affixes. */
export function alteration(rng: Rng, item: Item): CraftResult {
  return run('alteration', item, () => {
    const base = baseOf(item);
    const affixes = rollAffixes(rng, base, item.level, 'magic');
    return { ...item, affixes, name: magicName(base, affixes) };
  });
}

/** Magic → rare, adding one affix. */
export function regal(rng: Rng, item: Item): CraftResult {
  return run('regal', item, () => {
    const base = baseOf(item);
    const a = addAffix(rng, base, item.level, 'rare', item.affixes);
    return { ...item, rarity: 'rare', affixes: a ? [...item.affixes, a] : [...item.affixes], ...rareName(rng, base) };
  });
}

/** Reroll a rare item (4–6 new affixes, same name). */
export function chaos(rng: Rng, item: Item): CraftResult {
  return run('chaos', item, () => ({ ...item, affixes: rollAffixes(rng, baseOf(item), item.level, 'rare') }));
}

/** Add an affix to a rare item with room. */
export function exalt(rng: Rng, item: Item): CraftResult {
  return run('exalt', item, () => {
    const a = addAffix(rng, baseOf(item), item.level, 'rare', item.affixes);
    return a ? { ...item, affixes: [...item.affixes, a] } : null;
  });
}

/** Remove one random affix. */
export function annul(rng: Rng, item: Item): CraftResult {
  return run('annul', item, () => {
    const drop = rng.int(0, item.affixes.length - 1);
    const affixes = item.affixes.filter((_, i) => i !== drop);
    return { ...item, affixes, name: item.rarity === 'magic' ? magicName(baseOf(item), affixes) : item.name };
  });
}

/** Strip every affix: back to a normal item. */
export function scour(_rng: Rng, item: Item): CraftResult {
  return run('scour', item, () => ({ ...plain(item), rarity: 'normal', affixes: [], name: baseOf(item).name }));
}

/** Reroll every affix value within its tier. */
export function divine(rng: Rng, item: Item): CraftResult {
  return run('divine', item, () => ({ ...item, affixes: item.affixes.map((a) => reroll(rng, a)) }));
}

/**
 * Corrupt: unpredictable, and the item can never be crafted again. Outcomes (weights):
 * nothing (25), a corruption implicit (35), one affix up a tier (20), rerolled as a rare
 * with new affixes (20; uniques get an implicit instead).
 */
export function corrupt(rng: Rng, item: Item): CraftResult {
  const blocked = craftBlocker('corrupt', item);
  if (blocked) return fail(blocked);
  const base = baseOf(item);
  const outcome = rng.weighted(['nothing', 'implicit', 'upgrade', 'reroll'] as const, (o) => ({ nothing: 25, implicit: 35, upgrade: 20, reroll: 20 })[o]);
  const upgradable = item.affixes.map((a, i) => ({ a, i })).filter(({ a }) => a.tier < AFFIXES.get(a.id).tiers.length - 1);
  const addImplicit = (): Item => {
    const pool = CORRUPTIONS.all().filter((c) => affixFits(c, base));
    if (!pool.length) return { ...item, corrupted: true };
    const c = rng.weighted(pool, (x) => x.weight ?? 100);
    const rolled: RolledAffix = { id: c.id, tier: 0, mods: rollTierMods(rng, c.tiers[0]!) };
    return { ...item, corrupted: true, implicits: [...(item.implicits ?? []), rolled] };
  };
  if (outcome === 'nothing') return ok({ ...item, corrupted: true }, 'nothing');
  if (outcome === 'upgrade' && upgradable.length) {
    const { a, i } = rng.pick(upgradable);
    const tier = a.tier + 1;
    const up: RolledAffix = { id: a.id, tier, mods: rollTierMods(rng, AFFIXES.get(a.id).tiers[tier]!) };
    return ok({ ...item, corrupted: true, affixes: item.affixes.map((x, k) => (k === i ? up : x)) }, 'upgrade');
  }
  if (outcome === 'reroll' && item.rarity !== 'unique') {
    const affixes = rollAffixes(rng, base, item.level, 'rare');
    return ok({ ...item, corrupted: true, rarity: 'rare', affixes, ...(item.rarity === 'rare' ? {} : rareName(rng, base)) }, 'remade');
  }
  return ok(addImplicit(), 'implicit');
}

const ACTIONS: Record<CraftAction, (rng: Rng, item: Item) => CraftResult> = { transmute, augment, alteration, regal, chaos, exalt, annul, scour, divine, corrupt };

/** Apply a crafting action. */
export function craft(rng: Rng, action: CraftAction, item: Item): CraftResult {
  return ACTIONS[action](rng, item);
}

/** Apply a currency orb by id ('kindling-shard', ...). */
export function applyCurrency(rng: Rng, currencyId: string, item: Item): CraftResult {
  return craft(rng, CURRENCY.get(currencyId).action, item);
}

/** True when `item` is a currency orb. */
export function isCurrency(item: Item): boolean {
  return BASES.has(item.base) && BASES.get(item.base).slot === 'currency';
}

function reroll(rng: Rng, a: RolledAffix): RolledAffix {
  const def = AFFIXES.has(a.id) ? AFFIXES.get(a.id) : CORRUPTIONS.get(a.id);
  return { ...a, mods: rollTierMods(rng, def.tiers[a.tier]!) };
}

function run(action: CraftAction, item: Item, fn: () => Item | null): CraftResult {
  const blocked = craftBlocker(action, item);
  if (blocked) return fail(blocked);
  const out = fn();
  return out ? ok(out) : fail({ id: 'no_affix_fits' });
}
