/**
 * The hero's items as one observable value: the immutable `LootState` plus what the UI
 * needs around it (hero level, the hero's StatSheet, an Rng for crafting, the vendor's
 * stock). Every change goes through `set`, which also re-applies the equipment to the
 * StatSheet (`item:<slot>` sources), so stats follow gear without anyone else wiring it.
 */
import type { StatSheet } from '../../core/mods';
import { Rng } from '../../core/rng';
import type { Item } from '../../core/types';
import { emptyLoot, type LootState } from '../../loot/inventory';
import { applyEquipment } from '../../loot/itemMods';
import type { VendorKind } from '../../loot/vendor';

export class ItemsStore {
  state: LootState;
  heroLevel: number;
  /** The hero's StatSheet (equipment sources are kept in sync), or null. */
  sheet: StatSheet | null;
  /** Crafting randomness (fork it per run: `run.fork('craft')`). */
  rng: Rng;
  vendor: { kind: VendorKind; stock: Item[] } = { kind: 'smith', stock: [] };
  /** Bumps on every change (cheap dirty check). */
  version = 0;
  private readonly listeners = new Set<(state: LootState) => void>();

  constructor(opts: { state?: LootState; heroLevel?: number; sheet?: StatSheet | null; rng?: Rng } = {}) {
    this.state = opts.state ?? emptyLoot();
    this.heroLevel = opts.heroLevel ?? 1;
    this.sheet = opts.sheet ?? null;
    this.rng = opts.rng ?? new Rng('craft');
    if (this.sheet) applyEquipment(this.sheet, this.state.equipment);
  }

  set(state: LootState): void {
    const equipChanged = state.equipment !== this.state.equipment;
    this.state = state;
    this.version++;
    if (equipChanged && this.sheet) applyEquipment(this.sheet, state.equipment);
    for (const fn of [...this.listeners]) fn(state);
  }

  setSheet(sheet: StatSheet | null): void {
    this.sheet = sheet;
    if (sheet) applyEquipment(sheet, this.state.equipment);
    this.version++;
  }

  onChange(fn: (state: LootState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
