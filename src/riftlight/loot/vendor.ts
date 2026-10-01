/**
 * Vendors: sell prices by rarity and level, buy stock regenerated per town visit (seeded by
 * depth and visit, so a visit always offers the same goods), and a gem vendor. Pure.
 */
import { Rng } from '../core/rng';
import { SCALING } from '../core/scaling';
import type { Item, Rarity } from '../core/types';
import { CURRENCY, GEMS } from './content';
import { currencyItem, rollGem, rollItem } from './generate';
import { addItem, findItem, type LootState, removeItem, type Result } from './inventory';

export type VendorKind = 'smith' | 'gems';

/** Gold multiplier by rarity when selling. */
export const SELL_RARITY: Readonly<Record<Rarity, number>> = { normal: 1, magic: 2.5, rare: 6, unique: 15 };
/** Vendors charge this many times what they pay. */
export const BUY_MARKUP = 4;

/** Gold a vendor pays for `item`. */
export function sellPrice(item: Item): number {
  const qty = item.quantity ?? 1;
  if (CURRENCY.has(item.base)) return CURRENCY.get(item.base).value * qty;
  if (item.gem) return 4 + item.gem.level * 3;
  return Math.max(1, Math.round((1 + item.level * 0.4) * SELL_RARITY[item.rarity]));
}

/** Gold a vendor asks for `item`. */
export function buyPrice(item: Item): number {
  return sellPrice(item) * BUY_MARKUP;
}

/**
 * A vendor's stock for one visit: same (seed, depth, visit, kind) → same goods.
 * Smiths sell normal and magic gear around the current item level (a rare now and then)
 * plus basic orbs; the gem vendor sells level 1 skill and support gems.
 */
export function vendorStock(seed: number, depth: number, visit: number, kind: VendorKind): Item[] {
  const rng = new Rng(seed).fork(`vendor:${kind}:${depth}:${visit}`);
  const itemLevel = SCALING.monsterLevel(Math.max(1, depth));
  if (kind === 'gems') {
    const ids = rng.shuffle(GEMS.all().map((g) => g.id)).slice(0, 10);
    return ids.map((id) => ({ ...rollGem(rng, 1, undefined, id), gem: { id, level: 1, support: GEMS.get(id).support } }));
  }
  const out: Item[] = [];
  for (let i = 0; i < 14; i++) {
    const rarity: Rarity = rng.chance(0.08) ? 'rare' : rng.chance(0.55) ? 'magic' : 'normal';
    out.push(rollItem(rng, { itemLevel, rarity }));
  }
  for (const id of ['kindling-shard', 'shifting-ash', 'ember-bead', 'cleansing-salt']) {
    if (CURRENCY.get(id).level <= itemLevel) out.push(currencyItem(rng, id, 1, itemLevel));
  }
  return out;
}

/** Sell an inventory item: removes it and adds its price to the wallet. */
export function sell(state: LootState, uid: string): Result<{ state: LootState; gold: number; item: Item }> {
  const placed = findItem(state.inventory, uid);
  if (!placed) return { ok: false, reason: 'not in the inventory' };
  const gold = sellPrice(placed.item);
  return { ok: true, value: { state: { ...state, inventory: removeItem(state.inventory, uid), gold: state.gold + gold }, gold, item: placed.item } };
}

/** Buy `uid` from `stock` into the inventory (the stock loses it). */
export function buy(state: LootState, stock: readonly Item[], uid: string): Result<{ state: LootState; stock: Item[]; price: number }> {
  const item = stock.find((i) => i.uid === uid);
  if (!item) return { ok: false, reason: 'not for sale' };
  const price = buyPrice(item);
  if (price > state.gold) return { ok: false, reason: 'not enough gold' };
  const a = addItem(state.inventory, item);
  if (a.rest) return { ok: false, reason: 'inventory is full' };
  return { ok: true, value: { state: { ...state, inventory: a.grid, gold: state.gold - price }, stock: stock.filter((i) => i.uid !== uid), price } };
}
