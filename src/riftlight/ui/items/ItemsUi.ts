/**
 * The item windows: inventory + paper doll (right), stash or vendor (left), tooltips and
 * the item on the cursor. One 2D canvas at the art resolution, laid over the game canvas
 * with the engine's integer framing (the same approach as the engine Hud), so one UI pixel
 * is one art pixel at every size.
 *
 * Input: mouse (click to pick up / drop, drag and drop, right-click to equip or use,
 * Ctrl-click to stash / sell / buy, Alt for affix tiers), touch (tap = click, long-press =
 * right-click) and a gamepad cursor (left stick moves, A click, X right-click, Y Ctrl-click,
 * B close). Every change is a pure `loot/inventory` operation committed to the ItemsStore.
 *
 * The shell creates one per game (`new ItemsUi(ctx, store)`), calls `update(dt)` every
 * frame, and opens windows through the views (`ui.inventory.open()`, ...).
 */
import type { GameContext } from '../../../engine';
import { PALETTE } from '../../../engine/palette';
import type { Item } from '../../core/types';
import { compareEquip, type StatDelta } from '../../loot/compare';
import { CURRENCY } from '../../loot/content';
import { applyCurrency } from '../../loot/craft';
import { LOOT_SOUNDS } from '../../loot/data/sounds';
import { itemClass, itemColour } from '../../loot/filter';
import {
  addItem,
  dropAt,
  emptyGrid,
  equip,
  equipItem,
  findItem,
  type Grid,
  gridOf,
  itemAt,
  itemSize,
  type LootState,
  removeItem,
  replaceItem,
  setGrid,
  STASH_TABS,
  transfer,
  unequip,
} from '../../loot/inventory';
import { baseOf, EQUIP_SLOTS, type EquipSlot, isEquipment, requiredLevel } from '../../loot/itemMods';
import { buy, buyPrice, sell, sellPrice } from '../../loot/vendor';
import { drawIcon } from './icons';
import { canvasPainter, outline, type Painter, panel, shadowText, textWidth, UI } from './paint';
import type { ItemsStore } from './store';
import { drawTooltip, measureTooltip, tooltipLines } from './tooltip';

export const CELL = 10;
const PANEL_W = 128;
const INV_H = 178;
const LEFT_H = 162;
const VENDOR_SIZE = { w: 12, h: 10 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Paper doll slot boxes, relative to the inventory panel. */
export const DOLL: Readonly<Record<EquipSlot, Rect>> = {
  weapon: { x: 12, y: 30, w: 20, h: 40 },
  offhand: { x: 96, y: 30, w: 20, h: 40 },
  helm: { x: 54, y: 14, w: 20, h: 20 },
  amulet: { x: 78, y: 22, w: 10, h: 10 },
  body: { x: 54, y: 38, w: 20, h: 30 },
  ring1: { x: 40, y: 52, w: 10, h: 10 },
  ring2: { x: 78, y: 52, w: 10, h: 10 },
  belt: { x: 54, y: 72, w: 20, h: 10 },
  gloves: { x: 12, y: 76, w: 20, h: 20 },
  boots: { x: 96, y: 76, w: 20, h: 20 },
};

const SLOT_LOOK: Readonly<Record<EquipSlot, string>> = { weapon: 'sword', offhand: 'shield', helm: 'helm', amulet: 'amulet', body: 'body', ring1: 'ring', ring2: 'ring', belt: 'belt', gloves: 'gloves', boots: 'boots' };

export type Target =
  | { kind: 'grid'; where: 'inventory' | number; cx: number; cy: number; gx: number; gy: number }
  | { kind: 'slot'; slot: EquipSlot }
  | { kind: 'vendor'; cx: number; cy: number }
  | { kind: 'tab'; index: number }
  | { kind: 'close'; panel: 'right' | 'left' }
  | { kind: 'panel' };

type Origin = { kind: 'grid'; where: 'inventory' | number; x: number; y: number } | { kind: 'slot'; slot: EquipSlot };

export type LeftPanel = 'stash' | 'vendor' | null;

export class ItemsUi {
  /** The overlay canvas (art resolution). */
  readonly canvas: HTMLCanvasElement;
  inventoryOpen = false;
  left: LeftPanel = null;
  stashTab = 0;
  /** Item on the cursor (picked up, not yet placed). */
  held: { item: Item; origin: Origin } | null = null;
  /** Currency being applied (right-clicked orb's uid). */
  applying: string | null = null;
  /** Cursor in art pixels. */
  cursor = { x: 0, y: 0 };
  /** Last input device that moved the cursor. */
  cursorMode: 'pointer' | 'pad' = 'pointer';
  altHeld = false;
  message = '';
  private messageTime = 0;
  private readonly abort = new AbortController();
  private downAt: { x: number; y: number; t: number; touch: boolean; moved: boolean; picked: boolean } | null = null;
  private longPressed = false;
  private time = 0;
  private compareCache = { key: '', deltas: [] as StatDelta[] };
  private vendorCache: { stock: readonly Item[]; grid: Grid } = { stock: [], grid: emptyGrid(VENDOR_SIZE.w, VENDOR_SIZE.h) };
  private size = { w: 480, h: 270 };
  private drawnKey = '';

  constructor(
    private readonly ctx: GameContext,
    readonly store: ItemsStore,
  ) {
    const container = ctx.engine.renderer.container;
    const c = document.createElement('canvas');
    c.dataset.itemsUi = 'true';
    c.className = 'riftlight-items';
    Object.assign(c.style, { position: 'absolute', imageRendering: 'pixelated', zIndex: '6', display: 'none', touchAction: 'none', cursor: 'default' });
    container.appendChild(c);
    this.canvas = c;
    for (const [id, def] of Object.entries(LOOT_SOUNDS)) ctx.audio.register(id, def);
    const signal = this.abort.signal;
    c.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    c.addEventListener('pointermove', (e) => this.onMove(e), { signal });
    c.addEventListener('pointerup', (e) => this.onUp(e), { signal });
    c.addEventListener('pointercancel', () => (this.downAt = null), { signal });
    c.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    c.addEventListener('wheel', (e) => e.preventDefault(), { passive: false, signal });
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Alt') {
          this.altHeld = true;
          if (this.isOpen) e.preventDefault();
        }
        if (e.code === 'Escape' && this.isOpen) this.closeAll();
      },
      { signal },
    );
    window.addEventListener('keyup', (e) => e.key === 'Alt' && (this.altHeld = false), { signal });
    window.addEventListener('blur', () => (this.altHeld = false), { signal });
  }

  get isOpen(): boolean {
    return this.inventoryOpen || this.left !== null;
  }

  // ---------------------------------------------------------------- windows

  openInventory(): void {
    this.inventoryOpen = true;
  }

  openStash(): void {
    this.left = 'stash';
    this.inventoryOpen = true;
  }

  openVendor(): void {
    this.left = 'vendor';
    this.inventoryOpen = true;
  }

  /** Close one side (or everything); the item on the cursor goes back. */
  close(which: 'inventory' | 'stash' | 'vendor' | 'all' = 'all'): void {
    if (which === 'all' || which === 'inventory') {
      this.inventoryOpen = false;
      this.left = null;
    } else if (this.left === which) this.left = null;
    if (!this.inventoryOpen && !this.left) {
      this.returnHeld();
      this.applying = null;
    }
  }

  closeAll(): void {
    this.close('all');
  }

  dispose(): void {
    this.abort.abort();
    this.canvas.remove();
  }

  // ---------------------------------------------------------------- layout

  /** Inventory panel rect (art pixels). */
  rightRect(): Rect {
    return { x: Math.max(0, this.size.w - PANEL_W - 4), y: Math.max(2, Math.floor((this.size.h - INV_H) / 2)), w: PANEL_W, h: INV_H };
  }

  leftRect(): Rect {
    const r = this.rightRect();
    return { x: Math.max(0, Math.min(4, r.x - PANEL_W - 4)), y: r.y, w: PANEL_W, h: LEFT_H };
  }

  inventoryGridOrigin(): { x: number; y: number } {
    const r = this.rightRect();
    return { x: r.x + 4, y: r.y + 104 };
  }

  leftGridOrigin(): { x: number; y: number } {
    const r = this.leftRect();
    return { x: r.x + 4, y: r.y + 28 };
  }

  slotRect(slot: EquipSlot): Rect {
    const r = this.rightRect();
    const d = DOLL[slot];
    return { x: r.x + d.x, y: r.y + d.y, w: d.w, h: d.h };
  }

  tabRect(i: number): Rect {
    const r = this.leftRect();
    return { x: r.x + 4 + i * 16, y: r.y + 13, w: 14, h: 11 };
  }

  /** Grid shown on the left (stash tab or the vendor's packed stock). */
  leftGrid(): Grid | null {
    if (this.left === 'stash') return this.store.state.stash[this.stashTab] ?? null;
    if (this.left === 'vendor') return this.vendorGrid();
    return null;
  }

  private vendorGrid(): Grid {
    const stock = this.store.vendor.stock;
    if (this.vendorCache.stock !== stock) {
      let g = emptyGrid(VENDOR_SIZE.w, VENDOR_SIZE.h);
      for (const it of stock) g = addItem(g, it).grid;
      this.vendorCache = { stock, grid: g };
    }
    return this.vendorCache.grid;
  }

  /** What's under art point (x, y). */
  hit(x: number, y: number): Target | null {
    const inside = (r: Rect) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
    if (this.inventoryOpen) {
      const r = this.rightRect();
      if (inside(r)) {
        if (inside({ x: r.x + r.w - 11, y: r.y + 2, w: 9, h: 9 })) return { kind: 'close', panel: 'right' };
        for (const slot of EQUIP_SLOTS) if (inside(this.slotRect(slot))) return { kind: 'slot', slot };
        const g = this.inventoryGridOrigin();
        const gx = (x - g.x) / CELL;
        const gy = (y - g.y) / CELL;
        const inv = this.store.state.inventory;
        if (gx >= 0 && gy >= 0 && gx < inv.w && gy < inv.h) return { kind: 'grid', where: 'inventory', cx: Math.floor(gx), cy: Math.floor(gy), gx, gy };
        return { kind: 'panel' };
      }
    }
    if (this.left) {
      const r = this.leftRect();
      if (inside(r)) {
        if (inside({ x: r.x + r.w - 11, y: r.y + 2, w: 9, h: 9 })) return { kind: 'close', panel: 'left' };
        if (this.left === 'stash') for (let i = 0; i < STASH_TABS; i++) if (inside(this.tabRect(i))) return { kind: 'tab', index: i };
        const grid = this.leftGrid()!;
        const g = this.leftGridOrigin();
        const gx = (x - g.x) / CELL;
        const gy = (y - g.y) / CELL;
        if (gx >= 0 && gy >= 0 && gx < grid.w && gy < grid.h) {
          if (this.left === 'stash') return { kind: 'grid', where: this.stashTab, cx: Math.floor(gx), cy: Math.floor(gy), gx, gy };
          return { kind: 'vendor', cx: Math.floor(gx), cy: Math.floor(gy) };
        }
        return { kind: 'panel' };
      }
    }
    return null;
  }

  /** The item under a target, if any. */
  itemAtTarget(t: Target | null): Item | null {
    if (!t) return null;
    if (t.kind === 'grid') return itemAt(gridOf(this.store.state, t.where), t.cx, t.cy)?.item ?? null;
    if (t.kind === 'slot') return this.store.state.equipment[t.slot] ?? null;
    if (t.kind === 'vendor') return itemAt(this.vendorGrid(), t.cx, t.cy)?.item ?? null;
    return null;
  }

  // ---------------------------------------------------------------- tools/tests

  /** Art point → client (CSS) point on the page. */
  toClient(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((x + 0.5) / this.canvas.width) * r.width, y: r.top + ((y + 0.5) / this.canvas.height) * r.height };
  }

  /** Centre of an equipment slot / an item / a grid cell, in art pixels. */
  slotCenter(slot: EquipSlot): { x: number; y: number } {
    const r = this.slotRect(slot);
    return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
  }

  itemCenter(uid: string): { x: number; y: number } | null {
    const inv = findItem(this.store.state.inventory, uid);
    const left = this.leftGrid();
    const lp = left ? findItem(left, uid) : undefined;
    const p = inv ?? lp;
    if (!p) return null;
    const o = inv ? this.inventoryGridOrigin() : this.leftGridOrigin();
    const s = itemSize(p.item);
    return { x: o.x + p.x * CELL + Math.floor((s.w * CELL) / 2), y: o.y + p.y * CELL + Math.floor((s.h * CELL) / 2) };
  }

  cellCenter(where: 'inventory' | 'left', x: number, y: number): { x: number; y: number } {
    const o = where === 'inventory' ? this.inventoryGridOrigin() : this.leftGridOrigin();
    return { x: o.x + x * CELL + 5, y: o.y + y * CELL + 5 };
  }

  // ---------------------------------------------------------------- input

  private toArt(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * this.canvas.width), y: Math.floor(((e.clientY - r.top) / Math.max(1, r.height)) * this.canvas.height) };
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    const p = this.toArt(e);
    this.cursor = p;
    this.cursorMode = 'pointer';
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    const touch = e.pointerType === 'touch';
    this.downAt = { x: p.x, y: p.y, t: this.time, touch, moved: false, picked: false };
    this.longPressed = false;
    if (touch) return; // taps resolve on pointerup (long-press = right-click)
    if (e.button === 2) this.secondary(p.x, p.y);
    else if (e.button === 0) {
      const had = !!this.held;
      this.primary(p.x, p.y, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
      this.downAt.picked = !had && !!this.held;
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.toArt(e);
    this.cursor = p;
    this.cursorMode = 'pointer';
    if (this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 3) this.downAt.moved = true;
  }

  private onUp(e: PointerEvent): void {
    const p = this.toArt(e);
    this.cursor = p;
    const d = this.downAt;
    this.downAt = null;
    if (!d) return;
    if (d.touch) {
      if (!this.longPressed) this.primary(p.x, p.y, { ctrl: false, shift: false });
      return;
    }
    // Drag and drop: an item picked up on this press and released somewhere else lands there.
    if (e.button === 0 && d.picked && d.moved && this.held) this.primary(p.x, p.y, { ctrl: false, shift: false });
  }

  /** Per frame: gamepad cursor, long-press, message timer, repaint. */
  update(dt: number): void {
    this.time += dt;
    const input = this.ctx.input;
    if (this.isOpen && input.gamepadConnected) {
      const ax = input.padAxis;
      if (Math.abs(ax.x) > 0.01 || Math.abs(ax.y) > 0.01) {
        this.cursorMode = 'pad';
        this.cursor.x = Math.max(0, Math.min(this.size.w - 1, this.cursor.x + ax.x * 180 * dt));
        this.cursor.y = Math.max(0, Math.min(this.size.h - 1, this.cursor.y - ax.y * 180 * dt));
      }
      if (this.cursorMode === 'pad') {
        const cx = Math.floor(this.cursor.x);
        const cy = Math.floor(this.cursor.y);
        if (input.wasPressed('Space')) this.primary(cx, cy, { ctrl: false, shift: false });
        if (input.wasPressed('KeyJ')) this.secondary(cx, cy);
        if (input.wasPressed('KeyF')) this.primary(cx, cy, { ctrl: true, shift: false });
        if (input.wasPressed('KeyC')) this.closeAll();
      }
    }
    const d = this.downAt;
    if (d?.touch && !d.moved && !this.longPressed && this.time - d.t > 0.45) {
      this.longPressed = true;
      this.secondary(d.x, d.y);
    }
    if (this.message && this.time - this.messageTime > 2.5) this.message = '';
    this.paint();
  }

  // ---------------------------------------------------------------- actions

  private say(text: string, sound: 'loot-deny' | null = 'loot-deny'): void {
    this.message = text;
    this.messageTime = this.time;
    if (sound) this.ctx.audio.play(sound);
  }

  private commit(state: LootState, sound: string | null = 'loot-pickup'): void {
    this.store.set(state);
    if (sound) this.ctx.audio.play(sound);
  }

  /** Left click / tap / pad A at art point (x, y). */
  primary(x: number, y: number, mods: { ctrl: boolean; shift: boolean }): void {
    const t = this.hit(x, y);
    if (!t) return;
    if (t.kind === 'close') {
      this.close(t.panel === 'right' ? 'all' : (this.left ?? 'all'));
      return;
    }
    if (t.kind === 'tab') {
      this.stashTab = t.index;
      return;
    }
    if (this.applying) {
      this.applyAt(t, mods.shift);
      return;
    }
    if (this.held) {
      this.dropHeld(t);
      return;
    }
    if (mods.ctrl) {
      this.quick(t);
      return;
    }
    if (t.kind === 'vendor') {
      this.buyAt(t);
      return;
    }
    this.pick(t);
  }

  /** Right click / long-press / pad X. */
  secondary(x: number, y: number): void {
    const t = this.hit(x, y);
    if (this.applying || this.held) {
      this.applying = null;
      if (this.held) this.returnHeld();
      return;
    }
    if (!t) return;
    const item = this.itemAtTarget(t);
    if (!item) return;
    const s = this.store.state;
    if (t.kind === 'slot') {
      const r = unequip(s, t.slot);
      if (r.ok) this.commit(r.value);
      else this.say(r.reason);
    } else if (t.kind === 'vendor') this.buyAt(t);
    else if (t.kind === 'grid' && t.where !== 'inventory') {
      const r = transfer(s, item.uid, t.where, 'inventory');
      if (r.ok) this.commit(r.value);
      else this.say(r.reason);
    } else if (t.kind === 'grid') {
      if (itemClass(item) === 'currency') {
        this.applying = item.uid;
        this.say(`apply ${item.name}: click an item`, null);
      } else if (isEquipment(item)) {
        const r = equip(s, item.uid, this.store.heroLevel);
        if (r.ok) this.commit(r.value);
        else this.say(r.reason);
      } else this.say('gems go in the skill panel');
    }
  }

  /** Ctrl-click: inventory ↔ stash, sell to / buy from the vendor, unequip. */
  quick(t: Target): void {
    const item = this.itemAtTarget(t);
    if (!item) return;
    const s = this.store.state;
    if (t.kind === 'grid' && t.where === 'inventory') {
      if (this.left === 'stash') {
        const r = transfer(s, item.uid, 'inventory', this.stashTab);
        if (r.ok) this.commit(r.value);
        else this.say(r.reason);
      } else if (this.left === 'vendor') {
        const r = sell(s, item.uid);
        if (r.ok) this.commit(r.value.state, 'loot-gold');
        else this.say(r.reason);
      }
    } else if (t.kind === 'grid') {
      const r = transfer(s, item.uid, t.where, 'inventory');
      if (r.ok) this.commit(r.value);
      else this.say(r.reason);
    } else if (t.kind === 'vendor') this.buyAt(t);
    else if (t.kind === 'slot') {
      const r = unequip(s, t.slot);
      if (r.ok) this.commit(r.value);
      else this.say(r.reason);
    }
  }

  private buyAt(t: Target): void {
    const item = this.itemAtTarget(t);
    if (!item) return;
    const r = buy(this.store.state, this.store.vendor.stock, item.uid);
    if (!r.ok) return this.say(r.reason);
    this.store.vendor = { ...this.store.vendor, stock: r.value.stock };
    this.commit(r.value.state, 'loot-gold');
  }

  private pick(t: Target): void {
    const s = this.store.state;
    if (t.kind === 'grid') {
      const p = itemAt(gridOf(s, t.where), t.cx, t.cy);
      if (!p) return;
      this.held = { item: p.item, origin: { kind: 'grid', where: t.where, x: p.x, y: p.y } };
      this.commit(setGrid(s, t.where, removeItem(gridOf(s, t.where), p.item.uid)), null);
    } else if (t.kind === 'slot') {
      const item = s.equipment[t.slot];
      if (!item) return;
      const equipment = { ...s.equipment };
      delete equipment[t.slot];
      this.held = { item, origin: { kind: 'slot', slot: t.slot } };
      this.commit({ ...s, equipment }, null);
    }
  }

  private dropHeld(t: Target): void {
    const held = this.held!;
    const s = this.store.state;
    if (t.kind === 'grid') {
      const size = itemSize(held.item);
      const x = Math.round(t.gx - size.w / 2);
      const y = Math.round(t.gy - size.h / 2);
      const grid = gridOf(s, t.where);
      const r = dropAt(grid, held.item, Math.max(0, Math.min(grid.w - size.w, x)), Math.max(0, Math.min(grid.h - size.h, y)));
      if (!r.ok) return this.say(r.reason);
      const swapped = r.value.swapped;
      this.held = swapped ? { item: swapped, origin: held.origin } : null;
      this.commit(setGrid(s, t.where, r.value.grid));
    } else if (t.kind === 'slot') {
      const r = equipItem(s.equipment, held.item, t.slot, this.store.heroLevel);
      if (!r.ok) return this.say(r.reason);
      const [first, ...rest] = r.value.displaced;
      let inv = s.inventory;
      for (const d of rest) {
        const a = addItem(inv, d);
        if (a.rest) return this.say('no room in the inventory');
        inv = a.grid;
      }
      this.held = first ? { item: first, origin: { kind: 'slot', slot: t.slot } } : null;
      this.commit({ ...s, inventory: inv, equipment: r.value.equipment });
    } else if (t.kind === 'vendor') {
      // Dropping on the vendor sells it.
      const price = sellPrice(held.item);
      this.held = null;
      this.commit({ ...s, gold: s.gold + price }, 'loot-gold');
    }
  }

  /** Put the item on the cursor back where it came from (or anywhere in the inventory). */
  returnHeld(): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    const s = this.store.state;
    const o = held.origin;
    if (o.kind === 'grid') {
      const r = dropAt(gridOf(s, o.where), held.item, o.x, o.y);
      if (r.ok && !r.value.swapped) return this.store.set(setGrid(s, o.where, r.value.grid));
    } else if (!s.equipment[o.slot]) {
      return this.store.set({ ...s, equipment: { ...s.equipment, [o.slot]: held.item } });
    }
    const a = addItem(s.inventory, held.item);
    if (!a.rest) return this.store.set({ ...s, inventory: a.grid });
    for (let tab = 0; tab < STASH_TABS; tab++) {
      const b = addItem(s.stash[tab]!, held.item);
      if (!b.rest) return this.store.set(setGrid(s, tab, b.grid));
    }
    this.held = held; // nowhere to put it: keep it on the cursor
  }

  private applyAt(t: Target, keep: boolean): void {
    const s = this.store.state;
    const orb = findItem(s.inventory, this.applying!);
    if (!orb) {
      this.applying = null;
      return;
    }
    const target = this.itemAtTarget(t);
    if (!target || t.kind === 'vendor') {
      this.applying = null;
      return;
    }
    const r = applyCurrency(this.store.rng, orb.item.base, target);
    if (!r.ok) return this.say(r.reason);
    let next: LootState = s;
    if (t.kind === 'grid') next = setGrid(next, t.where, replaceItem(gridOf(next, t.where), r.item));
    else if (t.kind === 'slot') next = { ...next, equipment: { ...next.equipment, [t.slot]: r.item } };
    const left = (orb.item.quantity ?? 1) - 1;
    next = {
      ...next,
      inventory: left > 0 ? replaceItem(next.inventory, { ...orb.item, quantity: left }) : removeItem(next.inventory, orb.item.uid),
    };
    if (left <= 0 || !keep) this.applying = null;
    this.commit(next, 'loot-craft');
    this.say(r.note ?? `${CURRENCY.get(orb.item.base).name} used`, null);
  }

  // ---------------------------------------------------------------- drawing

  private comparison(item: Item): StatDelta[] {
    const sheet = this.store.sheet;
    if (!sheet || !isEquipment(item) || Object.values(this.store.state.equipment).includes(item)) return [];
    const key = `${item.uid}|${this.store.version}|${sheet.version}`;
    if (this.compareCache.key !== key) this.compareCache = { key, deltas: compareEquip(sheet, this.store.state.equipment, item) };
    return this.compareCache.deltas;
  }

  private paint(): void {
    const c = this.canvas;
    const renderer = this.ctx.engine.renderer;
    const res = renderer.resolution;
    const f = renderer.framing;
    if (!this.isOpen) {
      if (c.style.display !== 'none') c.style.display = 'none';
      this.drawnKey = '';
      return;
    }
    this.size = { w: res.width, h: res.height };
    if (c.width !== res.width || c.height !== res.height) {
      c.width = res.width;
      c.height = res.height;
      this.drawnKey = '';
    }
    Object.assign(c.style, { display: '', width: `${f.cssWidth}px`, height: `${f.cssHeight}px`, left: `${f.offsetX}px`, top: `${f.offsetY}px` });
    const key = `${this.store.version}|${this.inventoryOpen}|${this.left}|${this.stashTab}|${Math.floor(this.cursor.x)},${Math.floor(this.cursor.y)}|${this.held?.item.uid}|${this.applying}|${this.altHeld}|${this.message}|${this.cursorMode}|${this.store.heroLevel}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    const p = canvasPainter(g);
    if (this.inventoryOpen) this.drawInventory(p);
    if (this.left) this.drawLeft(p);
    this.drawCursor(p);
    if (this.message) {
      const w = textWidth(this.message.toUpperCase()) + 8;
      const x = Math.floor((this.size.w - w) / 2);
      panel(p, x, this.size.h - 16, w, 13, UI.panelEdge);
      p.text(x + 4, this.size.h - 13, this.message, UI.text);
    }
  }

  private drawItem(p: Painter, item: Item, x: number, y: number, w: number, h: number, highlight = false): void {
    const colour = itemColour(item);
    p.rect(x, y, w, h, highlight ? UI.panelEdge : 0x2a2f48);
    drawIcon(p, baseOf(item).look ?? baseOf(item).slot, x + 1, y + 1, w - 2, h - 2, colour, CURRENCY.has(item.base) ? CURRENCY.get(item.base).short : undefined);
    outline(p, x, y, w, h, item.rarity === 'normal' && itemClass(item) === item.rarity ? UI.cellEdge : colour);
    if ((item.quantity ?? 1) > 1) shadowText(p, x + 1, y + 1, String(item.quantity), PALETTE.white);
    if (item.gem) shadowText(p, x + 1, y + h - 8, String(item.gem.level), PALETTE.white);
    // Items the hero can't use yet get a red corner.
    if (isEquipment(item) && requiredLevel(item) > this.store.heroLevel) p.rect(x + w - 3, y + 1, 2, 2, UI.bad);
  }

  private drawGrid(p: Painter, grid: Grid, ox: number, oy: number): void {
    for (let x = 0; x < grid.w; x++) {
      for (let y = 0; y < grid.h; y++) {
        p.rect(ox + x * CELL, oy + y * CELL, CELL - 1, CELL - 1, UI.cell);
      }
    }
    const hover = this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y));
    const hovered = this.held ? null : this.itemAtTarget(hover);
    for (const pl of grid.items) {
      const s = itemSize(pl.item);
      this.drawItem(p, pl.item, ox + pl.x * CELL, oy + pl.y * CELL, s.w * CELL - 1, s.h * CELL - 1, hovered?.uid === pl.item.uid);
    }
  }

  private drawInventory(p: Painter): void {
    const r = this.rightRect();
    panel(p, r.x, r.y, r.w, r.h);
    shadowText(p, r.x + 4, r.y + 3, 'Inventory', UI.title);
    p.text(r.x + r.w - 9, r.y + 3, 'X', UI.dim);
    const eq = this.store.state.equipment;
    for (const slot of EQUIP_SLOTS) {
      const sr = this.slotRect(slot);
      p.rect(sr.x, sr.y, sr.w, sr.h, UI.cell);
      const item = eq[slot];
      if (item) this.drawItem(p, item, sr.x, sr.y, sr.w, sr.h);
      else drawIcon(p, SLOT_LOOK[slot], sr.x + 2, sr.y + 2, sr.w - 4, sr.h - 4, UI.panelEdge);
      if (this.held && this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y))?.kind === 'slot') {
        const t = this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y));
        if (t?.kind === 'slot' && t.slot === slot) outline(p, sr.x - 1, sr.y - 1, sr.w + 2, sr.h + 2, equipItem(eq, this.held.item, slot, this.store.heroLevel).ok ? UI.valid : UI.invalid);
      }
    }
    const g = this.inventoryGridOrigin();
    this.drawGrid(p, this.store.state.inventory, g.x, g.y);
    shadowText(p, r.x + 4, r.y + r.h - 12, `Gold ${this.store.state.gold}`, UI.gold);
    const lvl = `Lv ${this.store.heroLevel}`;
    p.text(r.x + r.w - 4 - textWidth(lvl.toUpperCase()), r.y + r.h - 12, lvl, UI.dim);
  }

  private drawLeft(p: Painter): void {
    const r = this.leftRect();
    panel(p, r.x, r.y, r.w, r.h);
    const title = this.left === 'stash' ? 'Stash' : this.store.vendor.kind === 'gems' ? 'Gem vendor' : 'Smith';
    shadowText(p, r.x + 4, r.y + 3, title, UI.title);
    p.text(r.x + r.w - 9, r.y + 3, 'X', UI.dim);
    if (this.left === 'stash') {
      for (let i = 0; i < STASH_TABS; i++) {
        const t = this.tabRect(i);
        p.rect(t.x, t.y, t.w, t.h, i === this.stashTab ? UI.panelEdge : UI.cell);
        p.text(t.x + 4, t.y + 2, String(i + 1), i === this.stashTab ? UI.title : UI.dim);
      }
    } else {
      p.text(r.x + 4, r.y + 14, 'Ctrl-click: buy / sell', UI.dim);
    }
    const g = this.leftGridOrigin();
    this.drawGrid(p, this.leftGrid()!, g.x, g.y);
  }

  private drawCursor(p: Painter): void {
    const cx = Math.floor(this.cursor.x);
    const cy = Math.floor(this.cursor.y);
    const t = this.hit(cx, cy);
    if (this.held) {
      const s = itemSize(this.held.item);
      if (t?.kind === 'grid') {
        const grid = gridOf(this.store.state, t.where);
        const x = Math.max(0, Math.min(grid.w - s.w, Math.round(t.gx - s.w / 2)));
        const y = Math.max(0, Math.min(grid.h - s.h, Math.round(t.gy - s.h / 2)));
        const o = t.where === 'inventory' ? this.inventoryGridOrigin() : this.leftGridOrigin();
        const okDrop = dropAt(grid, this.held.item, x, y).ok;
        outline(p, o.x + x * CELL - 1, o.y + y * CELL - 1, s.w * CELL + 1, s.h * CELL + 1, okDrop ? UI.valid : UI.invalid);
      }
      this.drawItem(p, this.held.item, cx - Math.floor((s.w * CELL) / 2), cy - Math.floor((s.h * CELL) / 2), s.w * CELL - 1, s.h * CELL - 1);
    } else {
      const item = this.itemAtTarget(t);
      if (item) this.drawTip(p, item, t!, cx, cy);
    }
    if (this.applying) {
      drawIcon(p, 'orb', cx + 3, cy + 3, 7, 7, UI.dim);
    }
    if (this.cursorMode === 'pad') {
      p.rect(cx - 3, cy, 7, 1, PALETTE.white);
      p.rect(cx, cy - 3, 1, 7, PALETTE.white);
    }
  }

  private drawTip(p: Painter, item: Item, t: Target, cx: number, cy: number): void {
    const forSale = t.kind === 'vendor';
    const inInventory = t.kind === 'grid' && t.where === 'inventory';
    const price = forSale
      ? { label: 'Buy', gold: buyPrice(item), affordable: buyPrice(item) <= this.store.state.gold }
      : this.left === 'vendor' && inInventory
        ? { label: 'Sells for', gold: sellPrice(item) }
        : undefined;
    const hint = inInventory && isEquipment(item) ? 'Right-click: equip' : t.kind === 'slot' ? 'Right-click: unequip' : undefined;
    const lines = tooltipLines(item, {
      showTiers: this.altHeld,
      compare: t.kind === 'slot' ? [] : this.comparison(item),
      heroLevel: this.store.heroLevel,
      ...(price ? { price } : {}),
      ...(hint ? { hint } : {}),
    });
    const size = measureTooltip(lines);
    let x = cx + 10;
    if (x + size.w > this.size.w - 2) x = cx - size.w - 6;
    x = Math.max(2, x);
    const y = Math.max(2, Math.min(this.size.h - size.h - 2, cy - Math.floor(size.h / 2)));
    drawTooltip(p, x, y, lines);
  }
}
