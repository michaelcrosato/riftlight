/**
 * Vendors: sell prices by rarity and level, buy stock regenerated per town visit (seeded by
 * depth and visit, so a visit always offers the same goods), a gem vendor and a gamble
 * vendor. Pure.
 *
 * Gold sinks that stay worth it at any depth: the gem vendor's honed gems (levelled up to what
 * a hero of the area can socket, priced by gem level) and the gamble tab (an unrevealed item of
 * a chosen base at the area's item level with much better rarity odds, priced in kills' worth
 * of `SCALING.gold`, so its price follows income however deep the run goes).
 */
import { Rng } from '../core/rng';
import { SCALING } from '../core/scaling';
import type { Item, Rarity } from '../core/types';
import { CURRENCY, equipmentBases, GEMS } from './content';
import { currencyItem, rollGem, rollItem, rollUid } from './generate';
import { addItem, findItem, type LootState, removeItem, type Result } from './inventory';

export type VendorKind = 'smith' | 'gems' | 'gamble';

/** The gamble vendor (Ilsa's third tab). */
export const GAMBLE = {
  /** Rarity boost of a gamble (vs a drop's `rarityBoost(depth)`): 1 in 4 rare, 1 in 30 unique. */
  boost: 6,
  /** Price in normal kills' gold (`SCALING.gold(depth)`). */
  price: 32,
  /** Weapons and offhands cost this much more (they carry a build). */
  weaponPrice: 1.5,
} as const;

/** Honed gems the gem vendor adds to its level 1 stock, and how far under the area's top gem level they may be. */
export const HONED_GEMS = { count: 4, spread: 3 } as const;

/** Gold multiplier by rarity when selling. */
export const SELL_RARITY: Readonly<Record<Rarity, number>> = { normal: 1, magic: 2.5, rare: 6, unique: 15 };
/** Vendors charge this many times what they pay. */
export const BUY_MARKUP = 4;

/** Gold a vendor pays for `item`. */
export function sellPrice(item: Item): number {
  const qty = item.quantity ?? 1;
  if (CURRENCY.has(item.base)) return CURRENCY.get(item.base).value * qty;
  // gems: by gem level, and dearer deeper (a gem's item level is where it dropped or was sold)
  if (item.gem) return Math.round((4 + item.gem.level * 3) * (1 + Math.max(0, item.level - 1) * 0.1));
  return Math.max(1, Math.round((1 + item.level * 0.4) * SELL_RARITY[item.rarity]));
}

/** Gold a vendor asks for `item` (a honed gem: × its level; a gamble: its own price). */
export function buyPrice(item: Item): number {
  if (item.gamble) return item.gamble.price;
  return sellPrice(item) * BUY_MARKUP * (item.gem ? Math.max(1, item.gem.level) : 1);
}

/** Highest gem level a hero of `heroLevel` can socket (`SCALING.gemLevelReq`). */
export function gemLevelCap(heroLevel: number): number {
  let g = 1;
  while (g < 20 && SCALING.gemLevelReq(g + 1) <= heroLevel) g++;
  return g;
}

/** What a gamble at `depth` costs for a base in `slot`. */
export function gamblePrice(depth: number, slot: string): number {
  return Math.round(GAMBLE.price * SCALING.gold(Math.max(1, depth)) * (slot === 'weapon' || slot === 'offhand' ? GAMBLE.weaponPrice : 1));
}

/** The real item behind an unrevealed gamble (seeded by its uid: the same gamble, the same item). */
export function revealGamble(item: Item): Item {
  const rng = new Rng(1).fork(`gamble:${item.uid}`);
  const it = rollItem(rng, { itemLevel: item.level, base: item.base, rarityBoost: GAMBLE.boost });
  return { ...it, uid: item.uid };
}

/**
 * A vendor's stock for one visit: same (seed, depth, visit, kind) → same goods.
 * Smiths sell normal and magic gear around the current item level (a rare now and then)
 * plus basic orbs; the gem vendor sells level 1 skill and support gems (priced by the depth).
 */
export function vendorStock(seed: number, depth: number, visit: number, kind: VendorKind): Item[] {
  const rng = new Rng(seed).fork(`vendor:${kind}:${depth}:${visit}`);
  const itemLevel = SCALING.monsterLevel(Math.max(1, depth));
  if (kind === 'gems') {
    const ids = rng.shuffle(GEMS.all().map((g) => g.id));
    const fresh = ids.slice(0, 10).map((id) => ({ ...rollGem(rng, itemLevel, undefined, id), gem: { id, level: 1, support: GEMS.get(id).support } }));
    // honed gems: levelled near what a hero of the area (its item level) can socket, priced by level
    const cap = gemLevelCap(itemLevel);
    const honed = cap < 2 ? [] : ids.slice(10, 10 + HONED_GEMS.count).map((id) => ({ ...rollGem(rng, itemLevel, undefined, id), gem: { id, level: rng.int(Math.max(2, cap - HONED_GEMS.spread), cap), support: GEMS.get(id).support } }));
    return [...fresh, ...honed];
  }
  if (kind === 'gamble') {
    // one unrevealed base per equipment slot (two weapons), at the area's item level
    const bases = equipmentBases().filter((b) => b.level <= itemLevel);
    const slots = ['weapon', 'weapon', 'offhand', 'helm', 'body', 'gloves', 'boots', 'amulet', 'ring', 'belt'];
    const out: Item[] = [];
    for (const slot of slots) {
      const pool = bases.filter((b) => b.slot === slot && !out.some((o) => o.base === b.id));
      if (!pool.length) continue;
      const top = Math.max(...pool.map((b) => b.level));
      const base = rng.weighted(pool, (b) => (top - b.level > 30 ? 0.35 : 1) * (b.weight ?? 1));
      out.push({ uid: rollUid(rng), base: base.id, rarity: 'normal', level: itemLevel, name: `Unrevealed ${base.name}`, affixes: [], gamble: { price: gamblePrice(depth, slot) } });
    }
    return out;
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
  // a gamble is revealed as it is bought
  const a = addItem(state.inventory, item.gamble ? revealGamble(item) : item);
  if (a.rest) return { ok: false, reason: 'inventory is full' };
  return { ok: true, value: { state: { ...state, inventory: a.grid, gold: state.gold - price }, stock: stock.filter((i) => i.uid !== uid), price } };
}
