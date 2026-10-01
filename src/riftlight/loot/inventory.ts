/**
 * Inventory, equipment, stash and wallet: pure, immutable logic (no DOM, no three).
 * Every operation returns a new `LootState` (or a reason it failed), so the UI can keep
 * history, tests can compare states, and saving is a plain copy.
 *
 * Items take PoE-style rectangles in a grid (a two-handed sword is 2×4, a ring 1×1);
 * currency stacks in one cell up to its stack size.
 */
import type { Item, SaveData } from '../core/types';
import { BASES, CURRENCY } from './content';
import { baseOf, EQUIP_SLOTS, type EquipSlot, type Equipment, isEquipment, isTwoHanded, requiredLevel } from './itemMods';

export const INVENTORY_SIZE = { w: 12, h: 5 } as const;
export const STASH_SIZE = { w: 12, h: 12 } as const;
export const STASH_TABS = 4;

export interface Placed {
  readonly item: Item;
  readonly x: number;
  readonly y: number;
}

export interface Grid {
  readonly w: number;
  readonly h: number;
  readonly items: readonly Placed[];
}

export interface LootState {
  readonly inventory: Grid;
  readonly equipment: Equipment;
  readonly stash: readonly Grid[];
  readonly gold: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
const okr = <T>(value: T): Result<T> => ({ ok: true, value });
const no = <T>(reason: string): Result<T> => ({ ok: false, reason });

// ---------------------------------------------------------------- sizes

/** Cell size by base class (`look`); two-handers are 2×4. */
export const ITEM_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  sword: [1, 3],
  axe: [2, 3],
  mace: [2, 3],
  dagger: [1, 2],
  bow: [2, 4],
  staff: [2, 4],
  wand: [1, 3],
  sceptre: [1, 3],
  shield: [2, 3],
  quiver: [2, 3],
  focus: [2, 2],
  helm: [2, 2],
  body: [2, 3],
  gloves: [2, 2],
  boots: [2, 2],
  amulet: [1, 1],
  ring: [1, 1],
  belt: [2, 1],
  gem: [1, 1],
  orb: [1, 1],
};

export function itemSize(item: Item): { w: number; h: number } {
  const base = baseOf(item);
  if (isTwoHanded(item)) return { w: 2, h: 4 };
  if (base.id === 'tower-shield') return { w: 2, h: 4 };
  const s = ITEM_SIZES[base.look ?? base.slot] ?? [1, 1];
  return { w: s[0], h: s[1] };
}

/** Max stack for an item (1 for anything but currency). */
export function stackSize(item: Item): number {
  return CURRENCY.has(item.base) ? CURRENCY.get(item.base).stack : 1;
}

// ---------------------------------------------------------------- grids

export const emptyGrid = (w: number, h: number): Grid => ({ w, h, items: [] });

export function emptyLoot(): LootState {
  return {
    inventory: emptyGrid(INVENTORY_SIZE.w, INVENTORY_SIZE.h),
    equipment: {},
    stash: Array.from({ length: STASH_TABS }, () => emptyGrid(STASH_SIZE.w, STASH_SIZE.h)),
    gold: 0,
  };
}

/** The placed item covering cell (x, y), if any. */
export function itemAt(grid: Grid, x: number, y: number): Placed | undefined {
  return grid.items.find((p) => {
    const s = itemSize(p.item);
    return x >= p.x && x < p.x + s.w && y >= p.y && y < p.y + s.h;
  });
}

export function findItem(grid: Grid, uid: string): Placed | undefined {
  return grid.items.find((p) => p.item.uid === uid);
}

/** Placed items an item of `item`'s size at (x, y) would overlap (ignoring `ignoreUid`). */
export function overlaps(grid: Grid, item: Item, x: number, y: number, ignoreUid?: string): Placed[] {
  const s = itemSize(item);
  return grid.items.filter((p) => {
    if (p.item.uid === ignoreUid) return false;
    const o = itemSize(p.item);
    return x < p.x + o.w && x + s.w > p.x && y < p.y + o.h && y + s.h > p.y;
  });
}

export function inBounds(grid: Grid, item: Item, x: number, y: number): boolean {
  const s = itemSize(item);
  return x >= 0 && y >= 0 && x + s.w <= grid.w && y + s.h <= grid.h;
}

export function canPlace(grid: Grid, item: Item, x: number, y: number, ignoreUid?: string): boolean {
  return inBounds(grid, item, x, y) && overlaps(grid, item, x, y, ignoreUid).length === 0;
}

/** First free top-left cell for `item`, scanning columns left to right (PoE order). */
export function findSpace(grid: Grid, item: Item): { x: number; y: number } | null {
  for (let x = 0; x < grid.w; x++) for (let y = 0; y < grid.h; y++) if (canPlace(grid, item, x, y)) return { x, y };
  return null;
}

export function place(grid: Grid, item: Item, x: number, y: number): Result<Grid> {
  if (!canPlace(grid, item, x, y)) return no('no room there');
  return okr({ ...grid, items: [...grid.items, { item, x, y }] });
}

export function removeItem(grid: Grid, uid: string): Grid {
  return { ...grid, items: grid.items.filter((p) => p.item.uid !== uid) };
}

/** Replace an item (same uid) in place, e.g. after crafting. */
export function replaceItem(grid: Grid, item: Item): Grid {
  return { ...grid, items: grid.items.map((p) => (p.item.uid === item.uid ? { ...p, item } : p)) };
}

/**
 * Add an item anywhere: currency first tops up existing stacks of the same orb, then
 * takes a free cell. Returns the new grid and whatever didn't fit (null when all fit).
 */
export function addItem(grid: Grid, item: Item): { grid: Grid; rest: Item | null } {
  let g = grid;
  let qty = item.quantity ?? 1;
  const max = stackSize(item);
  if (max > 1) {
    g = {
      ...g,
      items: g.items.map((p) => {
        if (qty <= 0 || p.item.base !== item.base) return p;
        const have = p.item.quantity ?? 1;
        const take = Math.min(qty, max - have);
        if (take <= 0) return p;
        qty -= take;
        return { ...p, item: { ...p.item, quantity: have + take } };
      }),
    };
    if (qty <= 0) return { grid: g, rest: null };
  }
  const rest = max > 1 ? { ...item, quantity: qty } : item;
  const at = findSpace(g, rest);
  if (!at) return { grid: g, rest };
  return { grid: { ...g, items: [...g.items, { item: rest, x: at.x, y: at.y }] }, rest: null };
}

/**
 * Drop `item` at (x, y): places it, merges a stack onto the same orb, or swaps with the one
 * item it covers (returned as `swapped`, e.g. to go back on the cursor).
 */
export function dropAt(grid: Grid, item: Item, x: number, y: number): Result<{ grid: Grid; swapped: Item | null }> {
  if (!inBounds(grid, item, x, y)) return no('out of bounds');
  const hit = overlaps(grid, item, x, y);
  if (hit.length === 0) return okr({ grid: { ...grid, items: [...grid.items, { item, x, y }] }, swapped: null });
  if (hit.length > 1) return no('covers more than one item');
  const other = hit[0]!;
  const max = stackSize(item);
  if (max > 1 && other.item.base === item.base) {
    const have = other.item.quantity ?? 1;
    const take = Math.min(item.quantity ?? 1, max - have);
    const left = (item.quantity ?? 1) - take;
    const g = { ...grid, items: grid.items.map((p) => (p === other ? { ...p, item: { ...p.item, quantity: have + take } } : p)) };
    return okr({ grid: g, swapped: left > 0 ? { ...item, quantity: left } : null });
  }
  const without = removeItem(grid, other.item.uid);
  return okr({ grid: { ...without, items: [...without.items, { item, x, y }] }, swapped: other.item });
}

// ---------------------------------------------------------------- equipment

/** Equipment slots an item fits. */
export function slotsFor(item: Item): EquipSlot[] {
  if (!isEquipment(item)) return [];
  const slot = baseOf(item).slot;
  if (slot === 'ring') return ['ring1', 'ring2'];
  return (EQUIP_SLOTS as readonly string[]).includes(slot) ? [slot as EquipSlot] : [];
}

/** The slot a right-click equips into: the item's slot, or the first empty ring slot. */
export function defaultSlot(item: Item, equipment: Equipment): EquipSlot | null {
  const slots = slotsFor(item);
  return slots.find((s) => !equipment[s]) ?? slots[0] ?? null;
}

/** Why `item` can't go in `slot` (null = it can). Two-handers and offhands push each other out instead. */
export function equipBlocker(item: Item, slot: EquipSlot, heroLevel: number): string | null {
  if (!slotsFor(item).includes(slot)) return `doesn't fit the ${slot} slot`;
  const need = requiredLevel(item);
  if (heroLevel < need) return `requires level ${need}`;
  return null;
}

/** True when a weapon and an offhand can be held together. */
export function compatibleHands(weapon: Item | undefined, offhand: Item | undefined): boolean {
  if (!weapon || !offhand || !isTwoHanded(weapon)) return true;
  return baseOf(weapon).look === 'bow' && baseOf(offhand).look === 'quiver';
}

/**
 * Put a free-floating `item` (not in any grid) into `slot`. Returns the new equipment and
 * the items it displaced (the old item in that slot, plus an offhand or weapon that can't be
 * held with it), which the caller puts back on the cursor or in the inventory.
 */
export function equipItem(equipment: Equipment, item: Item, slot: EquipSlot, heroLevel: number): Result<{ equipment: Equipment; displaced: Item[] }> {
  const blocked = equipBlocker(item, slot, heroLevel);
  if (blocked) return no(blocked);
  const next: Equipment = { ...equipment, [slot]: item };
  const displaced: Item[] = [];
  const old = equipment[slot];
  if (old) displaced.push(old);
  if (!compatibleHands(next.weapon, next.offhand)) {
    const out = slot === 'weapon' ? 'offhand' : 'weapon';
    displaced.push(next[out]!);
    delete next[out];
  }
  return okr({ equipment: next, displaced });
}

/** Equip an inventory item (right-click). Displaced items go back into the inventory. */
export function equip(state: LootState, uid: string, heroLevel: number, slot?: EquipSlot): Result<LootState> {
  const placed = findItem(state.inventory, uid);
  if (!placed) return no('not in the inventory');
  const target = slot ?? defaultSlot(placed.item, state.equipment);
  if (!target) return no("can't be equipped");
  const r = equipItem(state.equipment, placed.item, target, heroLevel);
  if (!r.ok) return r;
  let inv = removeItem(state.inventory, uid);
  for (const [i, d] of r.value.displaced.entries()) {
    // The first displaced item tries the spot the new item came from.
    if (i === 0 && canPlace(inv, d, placed.x, placed.y)) {
      inv = { ...inv, items: [...inv.items, { item: d, x: placed.x, y: placed.y }] };
      continue;
    }
    const a = addItem(inv, d);
    if (a.rest) return no('no room in the inventory');
    inv = a.grid;
  }
  return okr({ ...state, inventory: inv, equipment: r.value.equipment });
}

/** Unequip into the inventory. */
export function unequip(state: LootState, slot: EquipSlot): Result<LootState> {
  const item = state.equipment[slot];
  if (!item) return no('nothing equipped there');
  const a = addItem(state.inventory, item);
  if (a.rest) return no('no room in the inventory');
  const equipment = { ...state.equipment };
  delete equipment[slot];
  return okr({ ...state, inventory: a.grid, equipment });
}

// ---------------------------------------------------------------- stash & wallet

/** Move an item between the inventory and a stash tab (Ctrl-click). */
export function transfer(state: LootState, uid: string, from: 'inventory' | number, to: 'inventory' | number): Result<LootState> {
  const src = from === 'inventory' ? state.inventory : state.stash[from];
  const dst = to === 'inventory' ? state.inventory : state.stash[to];
  if (!src || !dst) return no('no such tab');
  const placed = findItem(src, uid);
  if (!placed) return no('item not found');
  const a = addItem(dst, placed.item);
  if (a.rest) return no(to === 'inventory' ? 'inventory is full' : 'stash tab is full');
  const srcAfter = removeItem(src, uid);
  return okr(setGrid(setGrid(state, from, srcAfter), to, a.grid));
}

export function gridOf(state: LootState, where: 'inventory' | number): Grid {
  return where === 'inventory' ? state.inventory : state.stash[where]!;
}

export function setGrid(state: LootState, where: 'inventory' | number, grid: Grid): LootState {
  if (where === 'inventory') return { ...state, inventory: grid };
  return { ...state, stash: state.stash.map((g, i) => (i === where ? grid : g)) };
}

/** Pick up an item from the ground into the inventory. */
export function pickUp(state: LootState, item: Item): Result<LootState> {
  const a = addItem(state.inventory, item);
  if (a.rest) return no('inventory is full');
  return okr({ ...state, inventory: a.grid });
}

export function addGold(state: LootState, amount: number): LootState {
  return { ...state, gold: Math.max(0, state.gold + Math.round(amount)) };
}

export function spendGold(state: LootState, amount: number): Result<LootState> {
  if (amount > state.gold) return no('not enough gold');
  return okr({ ...state, gold: state.gold - amount });
}

/** Every item the hero owns (inventory, equipment, stash). */
export function allItems(state: LootState): Item[] {
  return [...state.inventory.items.map((p) => p.item), ...EQUIP_SLOTS.flatMap((s) => (state.equipment[s] ? [state.equipment[s]!] : [])), ...state.stash.flatMap((g) => g.items.map((p) => p.item))];
}

// ---------------------------------------------------------------- save

export type LootSave = Pick<SaveData, 'stash' | 'positions'> & { hero: Pick<SaveData['hero'], 'gold' | 'equipment' | 'inventory'> };

/** The loot part of a save: items, equipment, stash, gold and every grid position. */
export function lootToSave(state: LootState): LootSave {
  const positions: Record<string, { tab?: number; x: number; y: number }> = {};
  for (const p of state.inventory.items) positions[p.item.uid] = { x: p.x, y: p.y };
  state.stash.forEach((g, tab) => g.items.forEach((p) => (positions[p.item.uid] = { tab, x: p.x, y: p.y })));
  const equipment: Partial<Record<string, Item>> = {};
  for (const s of EQUIP_SLOTS) if (state.equipment[s]) equipment[s] = state.equipment[s];
  return {
    hero: { gold: state.gold, equipment, inventory: state.inventory.items.map((p) => p.item) },
    stash: state.stash.flatMap((g) => g.items.map((p) => p.item)),
    positions,
  };
}

/** Write the loot part into a full save (returns a new SaveData). */
export function writeSave(save: SaveData, state: LootState): SaveData {
  const l = lootToSave(state);
  return { ...save, hero: { ...save.hero, ...l.hero }, stash: l.stash, positions: l.positions };
}

/** Rebuild the loot state from a save. Items with no (or a clashing) position are packed. */
export function lootFromSave(save: LootSave): LootState {
  let state = emptyLoot();
  const pos = save.positions ?? {};
  const known = (it: Item) => BASES.has(it.base);
  const put = (where: 'inventory' | number, item: Item) => {
    const p = pos[item.uid];
    let grid = gridOf(state, where);
    if (p && canPlace(grid, item, p.x, p.y)) grid = { ...grid, items: [...grid.items, { item, x: p.x, y: p.y }] };
    else {
      const a = addItem(grid, item);
      grid = a.grid;
      if (a.rest) return false;
    }
    state = setGrid(state, where, grid);
    return true;
  };
  for (const item of save.hero.inventory.filter(known)) put('inventory', item);
  for (const item of save.stash.filter(known)) {
    const tab = pos[item.uid]?.tab ?? 0;
    if (!put(Math.min(STASH_TABS - 1, Math.max(0, tab)), item)) state.stash.some((_, t) => put(t, item));
  }
  const equipment: Equipment = {};
  for (const s of EQUIP_SLOTS) {
    const it = save.hero.equipment[s];
    if (it && known(it)) equipment[s] = it;
  }
  return { ...state, equipment, gold: Math.max(0, Math.round(save.hero.gold ?? 0)) };
}
