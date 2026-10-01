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
import { emptySockets, type SkillSocket } from '../../loot/sockets';
import type { VendorKind } from '../../loot/vendor';

export class ItemsStore {
  state: LootState;
  heroLevel: number;
  /** The hero's StatSheet (equipment sources are kept in sync), or null. */
  sheet: StatSheet | null;
  /** Crafting randomness (fork it per run: `run.fork('craft')`). */
  rng: Rng;
  vendor: { kind: VendorKind; stock: Item[] } = { kind: 'smith', stock: [] };
  /** Every vendor's stock this visit (the vendor window's tabs); `vendor` is the one shown. */
  stocks: Partial<Record<VendorKind, Item[]>> = {};
  /** The four skill slots' gems (the skill panel); replaced wholesale by `setSkills`. */
  skills: SkillSocket[] = emptySockets();
  /** Bumps on every change (cheap dirty check). */
  version = 0;
  private readonly listeners = new Set<(state: LootState) => void>();
  private readonly skillListeners = new Set<(skills: SkillSocket[]) => void>();

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

  /** Change the skill sockets (and the loot state in the same step: a gem moves between them). */
  setSkills(skills: SkillSocket[], state?: LootState): void {
    this.skills = skills;
    if (state) this.set(state);
    else {
      this.version++;
      for (const fn of [...this.listeners]) fn(this.state);
    }
    for (const fn of [...this.skillListeners]) fn(skills);
  }

  onSkills(fn: (skills: SkillSocket[]) => void): () => void {
    this.skillListeners.add(fn);
    return () => this.skillListeners.delete(fn);
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
