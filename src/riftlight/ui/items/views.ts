/**
 * The three item windows the shell wires to keys and town NPCs. They are thin views over
 * one `ItemsUi` (one canvas, one cursor), so the inventory sits beside the stash or the
 * vendor and items move between them.
 *
 *   const ui = new ItemsUi(ctx, store);
 *   const inventory = new InventoryView(ui);   // key I
 *   const stash = new StashView(ui);           // stash chest NPC
 *   const vendor = new VendorView(ui);         // smith / gem vendor NPC
 *   vendor.open('smith', vendorStock(seed, depth, visit, 'smith'));
 *   // every frame: ui.update(dt); while ui.isOpen, don't feed hero movement input
 */
import type { Item } from '../../core/types';
import type { VendorKind } from '../../loot/vendor';
import type { ItemsUi } from './ItemsUi';

export interface ItemView {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

export class InventoryView implements ItemView {
  constructor(readonly ui: ItemsUi) {}
  open(): void {
    this.ui.openInventory();
  }
  close(): void {
    this.ui.close('all');
  }
  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }
  isOpen(): boolean {
    return this.ui.inventoryOpen;
  }
}

export class StashView implements ItemView {
  constructor(readonly ui: ItemsUi) {}
  open(tab?: number): void {
    if (tab !== undefined) this.ui.stashTab = tab;
    this.ui.openStash();
  }
  close(): void {
    this.ui.close('stash');
  }
  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }
  isOpen(): boolean {
    return this.ui.left === 'stash';
  }
}

export class VendorView implements ItemView {
  constructor(readonly ui: ItemsUi) {}
  /** Open with this visit's stock (see `vendorStock`); omitted = keep the current stock. */
  open(kind?: VendorKind, stock?: Item[]): void {
    if (kind && stock) this.ui.store.vendor = { kind, stock };
    this.ui.openVendor();
  }
  close(): void {
    this.ui.close('vendor');
  }
  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }
  isOpen(): boolean {
    return this.ui.left === 'vendor';
  }
}
