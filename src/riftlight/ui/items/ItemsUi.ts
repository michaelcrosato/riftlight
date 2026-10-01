/**
 * The item windows: inventory + paper doll (right), and on the left the stash, a vendor
 * (wares and gems tabs), the crafting bench or the skill panel (gems in the four skill
 * slots); tooltips and the item on the cursor. One 2D canvas at the art resolution, laid
 * over the game canvas with the engine's integer framing (the same approach as the engine
 * Hud), so one UI pixel is one art pixel at every size. Windows wear the shell's chrome
 * (ui/kit.ts: bevelled frame, navy title bar, close box).
 *
 * Input: mouse (click to pick up / drop, drag and drop, right-click to equip, socket or use,
 * Ctrl-click to stash / sell / buy, Alt for affix tiers), touch (tap shows the tooltip, a
 * second tap acts, long-press = right-click) and keys or a gamepad (a cursor that steps
 * between cells and slots: confirm = click, X = right-click, Y / V = Ctrl-click, tab = the
 * next tab, back = put the held item back / close). Every change is a pure
 * `loot/inventory` or `loot/sockets` operation committed to the ItemsStore.
 *
 * Standalone (`/?game=lootlab`): call `update(dt)` every frame; the view polls the pad and
 * Escape itself. Hosted by the game shell (`{ hosted: true }`, wire/loot.ts): the shell
 * routes UiEvents to `handle(e)` and closes it; nothing listens to keys or polls the pad.
 *
 * Narrow screens (a phone in portrait: 124 art pixels wide) stack the left window above a
 * compact bag (no paper doll) and wrap tooltips to the screen.
 */
import type { GameContext } from '../../../engine';
import { PALETTE } from '../../../engine/palette';
import type { StatSheet } from '../../core/mods';
import type { Item } from '../../core/types';
import { compareEquip, type StatDelta } from '../../loot/compare';
import { CURRENCY } from '../../loot/content';
import { applyCurrency, craftBlocker } from '../../loot/craft';
import { LOOT_SOUNDS } from '../../loot/data/sounds';
import { itemClass, itemColour } from '../../loot/filter';
import { addItem, dropAt, emptyGrid, equip, equipItem, findItem, type Grid, gridOf, itemAt, itemSize, type LootState, removeItem, replaceItem, setGrid, STASH_TABS, transfer, unequip } from '../../loot/inventory';
import { baseOf, EQUIP_SLOTS, type EquipSlot, isEquipment, requiredLevel } from '../../loot/itemMods';
import { autoSocket, gemAt, gemProgress, isGem, setSocket, SKILL_SLOTS, skillNumbers, socketBlocker, SUPPORT_LINKS, supportApplies, type SkillNumbers } from '../../loot/sockets';
import { buy, buyPrice, sell, sellPrice, type VendorKind } from '../../loot/vendor';
import { SKILLS } from '../../skills/actives';
import { miniRows, type UiEvent } from '../kit';
import { drawIcon } from './icons';
import { canvasPainter, outline, type Painter, panel, shadowText, textWidth, UI } from './paint';
import type { ItemsStore } from './store';
import { drawTooltip, measureTooltip, TIP_CHARS, tooltipLines } from './tooltip';

export const CELL = 10;
const PANEL_W = 128;
/** Title bar height: content starts this far below a window's top. */
export const HEADER = 16;
const INV_H = 182;
const INV_COMPACT_H = 84;
const STASH_H = 156;
const VENDOR_H = 148;
const BENCH_H = 156;
const SKILLS_H = 164;
const VENDOR_SIZE = { w: 12, h: 10 };
/** Screens narrower than this stack the windows (phones in portrait). */
const WIDE = PANEL_W * 2 + 12;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Paper doll slot boxes, relative to the inventory panel's content (below the title bar, 128 wide). */
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
const DOLL_Y = 4;

const SLOT_LOOK: Readonly<Record<EquipSlot, string>> = { weapon: 'sword', offhand: 'shield', helm: 'helm', amulet: 'amulet', body: 'body', ring1: 'ring', ring2: 'ring', belt: 'belt', gloves: 'gloves', boots: 'boots' };

/** Skill slot keys as the bar shows them. */
const SLOT_KEYS = ['1', '2', '3', '4'];

export type Target =
  | { kind: 'grid'; where: 'inventory' | number; cx: number; cy: number; gx: number; gy: number }
  | { kind: 'slot'; slot: EquipSlot }
  | { kind: 'vendor'; cx: number; cy: number }
  | { kind: 'tab'; index: number }
  | { kind: 'close'; panel: 'right' | 'left' }
  | { kind: 'socket'; slot: number; link: number }
  | { kind: 'skillrow'; slot: number }
  | { kind: 'orb'; base: string }
  | { kind: 'bench' }
  | { kind: 'button'; id: 'skills' }
  | { kind: 'panel' };

type Origin = { kind: 'grid'; where: 'inventory' | number; x: number; y: number } | { kind: 'slot'; slot: EquipSlot } | { kind: 'socket'; slot: number; link: number };

export type LeftPanel = 'stash' | 'vendor' | 'bench' | 'skills' | null;

export interface ItemsUiOptions {
  /** Driven by the game shell: no Escape / gamepad of its own; input comes through `handle`. */
  hosted?: boolean;
  /** The hero's StatSheet for "compared to equipped" and skill numbers (default `store.sheet`). */
  sheet?: () => StatSheet | null;
  /** The windows asked to close (their close box): the host closes them. */
  onClose?: () => void;
  /** Titles for the left windows (the shell names its townsfolk). */
  titles?: Partial<Record<Exclude<LeftPanel, null>, string>>;
}

/** Vendor tabs, in order (a kind without stock is not shown). */
const VENDOR_TABS: readonly { kind: VendorKind; label: string }[] = [
  { kind: 'smith', label: 'WARES' },
  { kind: 'gems', label: 'GEMS' },
];

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
  /** The crafting bench's item (uid, in the inventory or equipped). */
  benchItem: string | null = null;
  /** The skill slot the skill panel details (and right-clicked gems go to). */
  skillSlot = 0;
  /** Cursor in art pixels. */
  cursor = { x: 0, y: 0 };
  /** Last input device that moved the cursor. */
  cursorMode: 'pointer' | 'pad' = 'pointer';
  altHeld = false;
  message = '';
  /** Touch: the item whose tooltip a first tap opened (a second tap acts on it). */
  private touchPick: string | null = null;
  private lastTouch = false;
  private hoverOrb: string | null = null;
  private messageTime = 0;
  private readonly abort = new AbortController();
  private downAt: { x: number; y: number; t: number; touch: boolean; moved: boolean; picked: boolean } | null = null;
  private longPressed = false;
  private time = 0;
  private compareCache = { key: '', deltas: [] as StatDelta[] };
  private skillCache = { key: '', numbers: [] as (SkillNumbers | null)[] };
  private vendorCache: { stock: readonly Item[]; grid: Grid } = { stock: [], grid: emptyGrid(VENDOR_SIZE.w, VENDOR_SIZE.h) };
  private size = { w: 480, h: 270 };
  private drawnKey = '';

  constructor(
    private readonly ctx: GameContext,
    readonly store: ItemsStore,
    private readonly opts: ItemsUiOptions = {},
  ) {
    const container = ctx.engine.renderer.container;
    const c = document.createElement('canvas');
    c.dataset.itemsUi = 'true';
    c.dataset.hud = 'true'; // a 2D overlay, not a rendering canvas (the e2e canvas count)
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
        if (!this.opts.hosted && e.code === 'Escape' && this.isOpen) this.closeAll();
      },
      { signal },
    );
    window.addEventListener('keyup', (e) => e.key === 'Alt' && (this.altHeld = false), { signal });
    window.addEventListener('blur', () => (this.altHeld = false), { signal });
  }

  get isOpen(): boolean {
    return this.inventoryOpen || this.left !== null;
  }

  /** Narrow screen: windows stack and the bag goes compact under a left window. */
  get narrow(): boolean {
    return this.size.w < WIDE;
  }

  // ---------------------------------------------------------------- windows

  openInventory(): void {
    this.inventoryOpen = true;
    this.refreshSize();
  }

  openStash(): void {
    this.left = 'stash';
    this.inventoryOpen = true;
    this.refreshSize();
  }

  openVendor(): void {
    this.left = 'vendor';
    this.inventoryOpen = true;
    this.refreshSize();
  }

  /** The crafting bench: pick an item, then an orb. */
  openBench(): void {
    this.left = 'bench';
    this.inventoryOpen = true;
    this.refreshSize();
  }

  /** The skill panel: gems in the four skill slots, beside the bag. */
  openSkills(): void {
    this.left = 'skills';
    this.inventoryOpen = true;
    this.refreshSize();
  }

  /** Close one side (or everything); the item on the cursor goes back. */
  close(which: 'inventory' | 'stash' | 'vendor' | 'bench' | 'skills' | 'all' = 'all'): void {
    if (which === 'all' || which === 'inventory') {
      this.inventoryOpen = false;
      this.left = null;
    } else if (this.left === which) this.left = null;
    if (!this.inventoryOpen && !this.left) {
      this.returnHeld();
      this.applying = null;
      this.benchItem = null;
      this.touchPick = null;
      this.paint(); // hide the canvas now: a hosted view gets no more updates once closed
    }
  }

  closeAll(): void {
    this.close('all');
  }

  dispose(): void {
    this.abort.abort();
    this.canvas.remove();
  }

  private refreshSize(): void {
    const res = this.ctx.engine.renderer.resolution;
    this.size = { w: res.width, h: res.height };
  }

  // ---------------------------------------------------------------- layout

  private panelW(): number {
    return Math.min(PANEL_W, this.size.w);
  }

  /** The bag shows without the paper doll (a left window above it on a narrow screen). */
  private compact(): boolean {
    return this.narrow && this.left !== null;
  }

  private leftH(): number {
    return this.left === 'vendor' ? VENDOR_H : this.left === 'bench' ? BENCH_H : this.left === 'skills' ? SKILLS_H : STASH_H;
  }

  /** Inventory panel rect (art pixels). */
  rightRect(): Rect {
    const w = this.panelW();
    const h = this.compact() ? INV_COMPACT_H : INV_H;
    if (this.narrow) {
      const x = Math.floor((this.size.w - w) / 2);
      if (!this.left) return { x, y: Math.max(1, Math.floor((this.size.h - h) / 2)), w, h };
      const total = this.leftH() + 3 + h;
      return { x, y: Math.max(1, Math.floor((this.size.h - total) / 2)) + this.leftH() + 3, w, h };
    }
    return { x: Math.max(0, this.size.w - w - 4), y: Math.max(2, Math.floor((this.size.h - INV_H) / 2)), w, h };
  }

  leftRect(): Rect {
    const w = this.panelW();
    const h = this.leftH();
    if (this.narrow) {
      const total = h + 3 + INV_COMPACT_H;
      return { x: Math.floor((this.size.w - w) / 2), y: Math.max(1, Math.floor((this.size.h - total) / 2)), w, h };
    }
    const r = this.rightRect();
    return { x: Math.max(0, Math.min(4, r.x - w - 4)), y: r.y, w, h };
  }

  /** Left edge of a 12-cell grid inside a window of width w. */
  private gridX(r: Rect): number {
    return r.x + Math.floor((r.w - 12 * CELL) / 2);
  }

  inventoryGridOrigin(): { x: number; y: number } {
    const r = this.rightRect();
    return { x: this.gridX(r), y: r.y + (this.compact() ? HEADER + 2 : 108) };
  }

  leftGridOrigin(): { x: number; y: number } {
    const r = this.leftRect();
    return { x: this.gridX(r), y: r.y + HEADER + 16 };
  }

  slotRect(slot: EquipSlot): Rect {
    const r = this.rightRect();
    const d = DOLL[slot];
    return { x: r.x + d.x + Math.floor((r.w - PANEL_W) / 2), y: r.y + d.y + DOLL_Y, w: d.w, h: d.h };
  }

  /** A stash tab (1..4) or a vendor tab (wares, gems). */
  tabRect(i: number): Rect {
    const r = this.leftRect();
    if (this.left === 'vendor') return { x: r.x + 4 + i * 42, y: r.y + HEADER + 1, w: 40, h: 12 };
    return { x: r.x + 4 + i * 16, y: r.y + HEADER + 1, w: 14, h: 12 };
  }

  private closeRect(r: Rect): Rect {
    return { x: r.x + r.w - 15, y: r.y + 3, w: 12, h: 11 };
  }

  private skillsButton(): Rect {
    const r = this.rightRect();
    return { x: r.x + r.w - 49, y: r.y + 3, w: 32, h: 11 };
  }

  /** The active socket (link −1) or a support link of a skill slot. */
  socketRect(slot: number, link: number): Rect {
    const r = this.leftRect();
    const y = r.y + HEADER + 2 + slot * 21;
    if (link < 0) return { x: r.x + 10, y: y + 1, w: 18, h: 18 };
    return { x: r.x + 31 + link * 13, y: y + 4, w: 12, h: 12 };
  }

  private skillRowRect(slot: number): Rect {
    const r = this.leftRect();
    return { x: r.x + 3, y: r.y + HEADER + 2 + slot * 21, w: r.w - 6, h: 20 };
  }

  private benchFrame(): Rect {
    const r = this.leftRect();
    return { x: r.x + 4, y: r.y + HEADER + 2, w: 22, h: 42 };
  }

  private orbRect(i: number): Rect {
    const r = this.leftRect();
    // five a row, as wide as the window allows (24 px apart on a 128 px window, 23 on a phone)
    const stride = Math.min(24, Math.floor((r.w - 8) / 5));
    return { x: r.x + 4 + (i % 5) * stride, y: r.y + HEADER + 48 + Math.floor(i / 5) * 24, w: stride - 2, h: 22 };
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

  private vendorTabs(): { kind: VendorKind; label: string }[] {
    return VENDOR_TABS.filter((t) => t.kind === this.store.vendor.kind || (this.store.stocks[t.kind]?.length ?? 0) > 0);
  }

  /** True when art pixel (x, y) is on a window (the shell's `Panel.covers`). */
  covers(x: number, y: number): boolean {
    return this.hit(x, y) !== null;
  }

  /** What's under art point (x, y). */
  hit(x: number, y: number): Target | null {
    const inside = (r: Rect) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
    if (this.inventoryOpen) {
      const r = this.rightRect();
      if (inside(r)) {
        if (inside(this.closeRect(r))) return { kind: 'close', panel: 'right' };
        if (!this.compact() && (this.left === null || this.left === 'skills') && inside(this.skillsButton())) return { kind: 'button', id: 'skills' };
        if (!this.compact()) for (const slot of EQUIP_SLOTS) if (inside(this.slotRect(slot))) return { kind: 'slot', slot };
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
        if (inside(this.closeRect(r))) return { kind: 'close', panel: 'left' };
        if (this.left === 'stash') for (let i = 0; i < STASH_TABS; i++) if (inside(this.tabRect(i))) return { kind: 'tab', index: i };
        if (this.left === 'vendor') for (let i = 0; i < this.vendorTabs().length; i++) if (inside(this.tabRect(i))) return { kind: 'tab', index: i };
        if (this.left === 'skills') {
          for (let s = 0; s < SKILL_SLOTS; s++) {
            for (let l = -1; l < SUPPORT_LINKS; l++) if (inside(this.socketRect(s, l))) return { kind: 'socket', slot: s, link: l };
            if (inside(this.skillRowRect(s))) return { kind: 'skillrow', slot: s };
          }
          return { kind: 'panel' };
        }
        if (this.left === 'bench') {
          if (inside(this.benchFrame())) return { kind: 'bench' };
          const orbs = CURRENCY.all();
          for (let i = 0; i < orbs.length; i++) if (inside(this.orbRect(i))) return { kind: 'orb', base: orbs[i]!.id };
          return { kind: 'panel' };
        }
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
    if (t.kind === 'socket') return gemAt(this.store.skills, t);
    if (t.kind === 'bench') return this.benchTarget();
    return null;
  }

  /** The bench's item (it stays where it is: in the bag or on the hero). */
  benchTarget(): Item | null {
    if (!this.benchItem) return null;
    const s = this.store.state;
    return findItem(s.inventory, this.benchItem)?.item ?? Object.values(s.equipment).find((it) => it?.uid === this.benchItem) ?? null;
  }

  // ---------------------------------------------------------------- tools/tests

  /** Art point → client (CSS) point on the page. */
  toClient(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((x + 0.5) / this.canvas.width) * r.width, y: r.top + ((y + 0.5) / this.canvas.height) * r.height };
  }

  private centre(r: Rect): { x: number; y: number } {
    return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
  }

  /** Centre of an equipment slot / an item / a grid cell / a socket / an orb, in art pixels. */
  slotCenter(slot: EquipSlot): { x: number; y: number } {
    return this.centre(this.slotRect(slot));
  }

  socketCenter(slot: number, link: number): { x: number; y: number } {
    return this.centre(this.socketRect(slot, link));
  }

  orbCenter(base: string): { x: number; y: number } | null {
    const i = CURRENCY.all().findIndex((c) => c.id === base);
    return i < 0 ? null : this.centre(this.orbRect(i));
  }

  tabCenter(i: number): { x: number; y: number } {
    return this.centre(this.tabRect(i));
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

  /** Every window rect on screen now (tools: the phone layout check). */
  rects(): Rect[] {
    return [...(this.inventoryOpen ? [this.rightRect()] : []), ...(this.left ? [this.leftRect()] : [])];
  }

  // ---------------------------------------------------------------- pointer input

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
    this.lastTouch = touch;
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
    this.lastTouch = e.pointerType === 'touch';
    if (this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 3) this.downAt.moved = true;
  }

  private onUp(e: PointerEvent): void {
    const p = this.toArt(e);
    this.cursor = p;
    const d = this.downAt;
    this.downAt = null;
    if (!d) return;
    if (d.touch) {
      if (!this.longPressed) this.tap(p.x, p.y);
      return;
    }
    // Drag and drop: an item picked up on this press and released somewhere else lands there.
    if (e.button === 0 && d.picked && d.moved && this.held) this.primary(p.x, p.y, { ctrl: false, shift: false });
  }

  /** Touch tap: the first tap on an item shows its tooltip, a second tap acts (empty cells and buttons act at once). */
  tap(x: number, y: number): void {
    const t = this.hit(x, y);
    const item = this.held || this.applying ? null : this.itemAtTarget(t);
    if (item && this.touchPick !== item.uid && t?.kind !== 'bench') {
      this.touchPick = item.uid;
      this.ctx.audio.play('loot-pickup', { volume: 0.25 });
      return;
    }
    this.touchPick = null;
    this.primary(x, y, { ctrl: false, shift: false });
  }

  // ---------------------------------------------------------------- keys / pad (hosted)

  /**
   * A UiEvent from the shell (keys, pad, the shell's own pointer echo). Returns true when
   * used. `back` with an item on the cursor puts it back; otherwise the shell closes.
   */
  handle(e: UiEvent): boolean {
    switch (e.kind) {
      case 'nav':
        this.nav(e.dir);
        return true;
      case 'confirm':
        if (this.cursorMode !== 'pad') this.padStart();
        else this.primary(Math.floor(this.cursor.x), Math.floor(this.cursor.y), { ctrl: false, shift: false });
        return true;
      case 'back':
        if (this.held || this.applying) {
          this.applying = null;
          this.returnHeld();
          return true;
        }
        return false;
      case 'tab':
        this.cycleTab(e.dir);
        return true;
      case 'key': {
        const cx = Math.floor(this.cursor.x);
        const cy = Math.floor(this.cursor.y);
        if (this.cursorMode !== 'pad') this.padStart();
        else if (e.code === 'KeyX' || e.code === 'PadX') this.secondary(cx, cy);
        else if (e.code === 'KeyV' || e.code === 'PadY') this.primary(cx, cy, { ctrl: true, shift: false });
        return true;
      }
      case 'pointer':
        // the canvas got the press itself; this is the shell's copy
        return this.covers(e.x, e.y);
      case 'wheel':
        return this.covers(this.cursor.x, this.cursor.y);
    }
  }

  /** Keys / pad take over: the cursor lands on something useful. */
  private padStart(): void {
    this.cursorMode = 'pad';
    if (this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y))?.kind !== 'panel' && this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y))) return;
    const first = this.left === 'skills' ? this.socketCenter(this.skillSlot, -1) : this.left === 'bench' ? this.centre(this.benchFrame()) : this.cellCenter('inventory', 0, 0);
    this.cursor = { ...first };
  }

  /** Every place the pad cursor can stop (centres), with the item there. */
  private stops(): { x: number; y: number; uid: string | null }[] {
    const out: { x: number; y: number; uid: string | null }[] = [];
    const add = (r: Rect, item: Item | null = null) => out.push({ ...this.centre(r), uid: item?.uid ?? null });
    const grid = (g: Grid, o: { x: number; y: number }) => {
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) out.push({ x: o.x + x * CELL + 5, y: o.y + y * CELL + 5, uid: itemAt(g, x, y)?.item.uid ?? null });
    };
    if (this.inventoryOpen) {
      if (!this.compact()) for (const s of EQUIP_SLOTS) add(this.slotRect(s), this.store.state.equipment[s] ?? null);
      grid(this.store.state.inventory, this.inventoryGridOrigin());
    }
    if (this.left === 'stash' || this.left === 'vendor') grid(this.leftGrid()!, this.leftGridOrigin());
    if (this.left === 'skills') for (let s = 0; s < SKILL_SLOTS; s++) for (let l = -1; l < SUPPORT_LINKS; l++) add(this.socketRect(s, l), gemAt(this.store.skills, { slot: s, link: l }));
    if (this.left === 'bench') {
      add(this.benchFrame());
      CURRENCY.all().forEach((_, i) => add(this.orbRect(i)));
    }
    return out;
  }

  /** Step the pad cursor to the next stop in a screen direction (big items are one stop). */
  nav(dir: 'up' | 'down' | 'left' | 'right'): void {
    if (this.cursorMode !== 'pad') return this.padStart();
    const [dx, dy] = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
    const here = { x: Math.floor(this.cursor.x), y: Math.floor(this.cursor.y) };
    const at = this.itemAtTarget(this.hit(here.x, here.y))?.uid ?? null;
    let best: { x: number; y: number } | null = null;
    let score = Infinity;
    for (const s of this.stops()) {
      if (at && s.uid === at) continue;
      const vx = s.x - here.x;
      const vy = s.y - here.y;
      const along = vx * dx + vy * dy;
      if (along <= 2) continue;
      const sc = along + Math.abs(vx * dy - vy * dx) * 2.5;
      if (sc < score) {
        score = sc;
        best = s;
      }
    }
    if (best) {
      this.cursor = { x: best.x, y: best.y };
      const t = this.hit(best.x, best.y);
      if (t?.kind === 'socket' || t?.kind === 'skillrow') this.skillSlot = t.slot;
      this.ctx.audio.play('loot-pickup', { volume: 0.15, pitch: 6 });
    }
  }

  /** Next / previous tab: stash tabs, vendor tabs; on the bag alone it toggles the skill panel. */
  cycleTab(dir: 1 | -1): void {
    if (this.left === 'stash') this.stashTab = (this.stashTab + dir + STASH_TABS) % STASH_TABS;
    else if (this.left === 'vendor') {
      const tabs = this.vendorTabs();
      const i = tabs.findIndex((t) => t.kind === this.store.vendor.kind);
      this.switchVendor(tabs[(i + dir + tabs.length) % tabs.length]!.kind);
    } else if (this.left === 'skills') this.left = null;
    else if (this.left === null) this.left = 'skills';
  }

  private switchVendor(kind: VendorKind): void {
    const v = this.store.vendor;
    if (v.kind === kind) return;
    this.store.stocks[v.kind] = v.stock;
    this.store.vendor = { kind, stock: this.store.stocks[kind] ?? [] };
    this.store.version++;
  }

  // ---------------------------------------------------------------- per frame

  /** Per frame: gamepad cursor (standalone), long-press, message timer, repaint. */
  update(dt: number): void {
    this.time += dt;
    this.refreshSize();
    const input = this.ctx.input;
    if (!this.opts.hosted && this.isOpen && input.gamepadConnected) {
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
      this.touchPick = null;
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

  private closeWindows(side: 'right' | 'left'): void {
    if (this.opts.hosted) {
      if (this.opts.onClose) return this.opts.onClose();
      return this.closeAll();
    }
    this.close(side === 'right' ? 'all' : (this.left ?? 'all'));
  }

  /** Left click / tap / pad A at art point (x, y). */
  primary(x: number, y: number, mods: { ctrl: boolean; shift: boolean }): void {
    const t = this.hit(x, y);
    if (!t) return;
    if (t.kind === 'close') return this.closeWindows(t.panel);
    if (t.kind === 'button') {
      this.left = this.left === 'skills' ? null : 'skills';
      this.ctx.audio.play('loot-pickup', { volume: 0.4 });
      return;
    }
    if (t.kind === 'tab') {
      if (this.left === 'stash') this.stashTab = t.index;
      else if (this.left === 'vendor') this.switchVendor(this.vendorTabs()[t.index]!.kind);
      return;
    }
    if (t.kind === 'skillrow') {
      this.skillSlot = t.slot;
      return;
    }
    if (t.kind === 'orb') return this.benchOrb(t.base);
    if (this.applying) {
      this.applyAt(t, mods.shift);
      return;
    }
    if (this.held) {
      this.dropHeld(t);
      return;
    }
    // The bench: clicking an item puts it on the bench (it stays where it is).
    if (this.left === 'bench' && (t.kind === 'grid' || t.kind === 'slot') && !mods.ctrl) {
      const item = this.itemAtTarget(t);
      if (item && isEquipment(item)) {
        this.benchItem = item.uid;
        this.ctx.audio.play('loot-pickup');
      } else if (item) this.say(itemClass(item) === 'currency' ? 'pick an orb on the bench' : 'only equipment can be crafted');
      return;
    }
    if (t.kind === 'socket') {
      this.skillSlot = t.slot;
      this.pick(t);
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
    else if (t.kind === 'socket') this.unsocket(t);
    else if (t.kind === 'grid' && t.where !== 'inventory') {
      const r = transfer(s, item.uid, t.where, 'inventory');
      if (r.ok) this.commit(r.value);
      else this.say(r.reason);
    } else if (t.kind === 'grid') {
      if (itemClass(item) === 'currency') {
        if (this.left === 'bench' && this.benchTarget()) return this.benchOrb(item.base);
        this.applying = item.uid;
        this.say(`apply ${item.name}: click an item`, null);
      } else if (isGem(item)) {
        if (this.left !== 'skills') return this.say('open the skill panel (G) to socket gems');
        const ref = autoSocket(this.store.skills, item, this.skillSlot);
        if (!ref) return this.say(`no free link in skill ${this.skillSlot + 1}`);
        this.socketFromBag(item, ref);
      } else if (isEquipment(item)) {
        const r = equip(s, item.uid, this.store.heroLevel);
        if (r.ok) this.commit(r.value);
        else this.say(r.reason);
      }
    }
  }

  /** Ctrl-click: inventory ↔ stash, sell to / buy from the vendor, unequip, unsocket. */
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
      } else if (this.left === 'skills' && isGem(item)) {
        const ref = autoSocket(this.store.skills, item, this.skillSlot);
        if (ref) this.socketFromBag(item, ref);
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
    } else if (t.kind === 'socket') this.unsocket(t);
  }

  private buyAt(t: Target): void {
    const item = this.itemAtTarget(t);
    if (!item) return;
    const r = buy(this.store.state, this.store.vendor.stock, item.uid);
    if (!r.ok) return this.say(r.reason);
    this.store.vendor = { ...this.store.vendor, stock: r.value.stock };
    this.commit(r.value.state, 'loot-gold');
  }

  /** A gem from the bag into a socket; whatever was there goes back into the bag. */
  private socketFromBag(item: Item, ref: { slot: number; link: number }): void {
    const why = socketBlocker(item, ref);
    if (why) return this.say(why);
    const need = requiredLevel(item);
    if (need > this.store.heroLevel) return this.say(`requires level ${need}`);
    const s = this.store.state;
    const r = setSocket(this.store.skills, ref, item);
    let inv = removeItem(s.inventory, item.uid);
    if (r.displaced) {
      const a = addItem(inv, r.displaced);
      if (a.rest) return this.say('no room in the inventory');
      inv = a.grid;
    }
    this.skillSlot = ref.slot;
    this.store.setSkills(r.sockets, { ...s, inventory: inv });
    this.ctx.audio.play('loot-gem');
    this.noteSupport(r.sockets[ref.slot]!, item);
  }

  private unsocket(t: { slot: number; link: number }): void {
    const gem = gemAt(this.store.skills, t);
    if (!gem) return;
    const a = addItem(this.store.state.inventory, gem);
    if (a.rest) return this.say('no room in the inventory');
    const r = setSocket(this.store.skills, t, null);
    this.store.setSkills(r.sockets, { ...this.store.state, inventory: a.grid });
    this.ctx.audio.play('loot-pickup');
  }

  private noteSupport(socket: (typeof this.store.skills)[number], item: Item): void {
    if (item.gem?.support && supportApplies(socket, item) === false) this.say(`${item.name} doesn't support ${socket.gem?.name ?? 'this skill'}`, null);
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
    } else if (t.kind === 'socket') {
      const gem = gemAt(this.store.skills, t);
      if (!gem) return;
      this.held = { item: gem, origin: { kind: 'socket', slot: t.slot, link: t.link } };
      this.store.setSkills(setSocket(this.store.skills, t, null).sockets);
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
    } else if (t.kind === 'socket') {
      const why = socketBlocker(held.item, t);
      if (why) return this.say(why);
      const need = requiredLevel(held.item);
      if (need > this.store.heroLevel) return this.say(`requires level ${need}`);
      const r = setSocket(this.store.skills, t, held.item);
      this.held = r.displaced ? { item: r.displaced, origin: held.origin } : null;
      this.skillSlot = t.slot;
      this.store.setSkills(r.sockets);
      this.ctx.audio.play('loot-gem');
      this.noteSupport(r.sockets[t.slot]!, held.item);
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
    } else if (o.kind === 'socket') {
      if (!gemAt(this.store.skills, o) && !socketBlocker(held.item, o)) return this.store.setSkills(setSocket(this.store.skills, o, held.item).sockets);
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
    if (!target || t.kind === 'vendor' || t.kind === 'socket') {
      this.applying = null;
      return;
    }
    if (this.useOrb(orb.item, target) && (!keep || (orb.item.quantity ?? 1) <= 1)) this.applying = null;
  }

  /** The bench: use one orb of `base` from the bag on the bench's item. */
  private benchOrb(base: string): void {
    this.hoverOrb = base;
    const target = this.benchTarget();
    if (!target) return this.say('put an item on the bench first');
    const orb = this.store.state.inventory.items.find((p) => p.item.base === base)?.item;
    if (!orb) return this.say(`no ${CURRENCY.get(base).name} in the bag`);
    this.useOrb(orb, target);
  }

  /** Apply one `orb` (an inventory stack) to `target` (in the bag or equipped). True when it worked. */
  private useOrb(orb: Item, target: Item): boolean {
    const r = applyCurrency(this.store.rng, orb.base, target);
    if (!r.ok) {
      this.say(r.reason);
      return false;
    }
    const s = this.store.state;
    let next: LootState = s;
    if (findItem(s.inventory, target.uid)) next = setGrid(next, 'inventory', replaceItem(next.inventory, r.item));
    else {
      const slot = EQUIP_SLOTS.find((k) => s.equipment[k]?.uid === target.uid);
      if (slot) next = { ...next, equipment: { ...next.equipment, [slot]: r.item } };
      else {
        const tab = s.stash.findIndex((g) => findItem(g, target.uid));
        if (tab >= 0) next = setGrid(next, tab, replaceItem(next.stash[tab]!, r.item));
      }
    }
    const left = (orb.quantity ?? 1) - 1;
    next = { ...next, inventory: left > 0 ? replaceItem(next.inventory, { ...orb, quantity: left }) : removeItem(next.inventory, orb.uid) };
    this.commit(next, 'loot-craft');
    this.say(r.note ?? `${CURRENCY.get(orb.base).name} used`, null);
    return true;
  }

  // ---------------------------------------------------------------- drawing

  private sheet(): StatSheet | null {
    return this.opts.sheet?.() ?? this.store.sheet;
  }

  private comparison(item: Item): StatDelta[] {
    const sheet = this.sheet();
    if (!sheet || !isEquipment(item) || Object.values(this.store.state.equipment).includes(item)) return [];
    const key = `${item.uid}|${this.store.version}|${sheet.version}`;
    if (this.compareCache.key !== key) this.compareCache = { key, deltas: compareEquip(sheet, this.store.state.equipment, item) };
    return this.compareCache.deltas;
  }

  /** Each slot's resolved numbers (cached per store and sheet version). */
  numbers(): (SkillNumbers | null)[] {
    const sheet = this.sheet();
    const key = `${this.store.version}|${sheet?.version ?? -1}`;
    if (this.skillCache.key !== key) this.skillCache = { key, numbers: this.store.skills.map((s) => skillNumbers(s, sheet)) };
    return this.skillCache.numbers;
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
    const sheet = this.sheet();
    const key = `${this.store.version}|${this.inventoryOpen}|${this.left}|${this.stashTab}|${this.store.vendor.kind}|${Math.floor(this.cursor.x)},${Math.floor(this.cursor.y)}|${this.held?.item.uid}|${this.applying}|${this.benchItem}|${this.skillSlot}|${this.touchPick}|${this.hoverOrb}|${this.altHeld}|${this.message}|${this.cursorMode}|${this.store.heroLevel}|${sheet?.version}|${c.width}x${c.height}`;
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
      const text = this.message.toUpperCase();
      const lines = this.narrow ? wrapChars(text, Math.floor((this.size.w - 10) / 6)) : [text];
      const w = Math.max(...lines.map(textWidth)) + 8;
      const h = lines.length * 9 + 4;
      const x = Math.floor((this.size.w - w) / 2);
      const y = this.size.h - h - 3;
      panel(p, x, y, w, h, UI.panelEdge);
      lines.forEach((l, i) => p.text(x + 4, y + 3 + i * 9, l, UI.text));
    }
  }

  /** A window in the shell's chrome: bevelled frame, navy title bar, close box. */
  private frame(p: Painter, r: Rect, title: string): void {
    const { x, y, w, h } = r;
    p.rect(x + 1, y, w - 2, h, PALETTE.ink);
    p.rect(x, y + 1, w, h - 2, PALETTE.ink);
    p.rect(x + 1, y + 1, w - 2, h - 2, PALETTE.slate);
    p.rect(x + 2, y + 2, w - 4, h - 4, PALETTE.ink);
    p.rect(x + 3, y + 3, w - 6, 11, PALETTE.navy);
    shadowText(p, x + 6, y + 5, title.toUpperCase(), UI.title);
    const c = this.closeRect(r);
    const hot = this.cursorMode === 'pointer' && this.cursor.x >= c.x && this.cursor.x < c.x + c.w && this.cursor.y >= c.y && this.cursor.y < c.y + c.h;
    p.rect(c.x, c.y, c.w, c.h, hot ? PALETTE.red : PALETTE.plum);
    p.text(c.x + 3, c.y + 2, 'X', PALETTE.white);
  }

  private gemColour(item: Item): number {
    if (item.gem && !item.gem.support && SKILLS.has(item.gem.id)) return PALETTE[SKILLS.get(item.gem.id).look.color];
    return itemColour(item);
  }

  private drawItem(p: Painter, item: Item, x: number, y: number, w: number, h: number, highlight = false): void {
    const colour = item.gem ? this.gemColour(item) : itemColour(item);
    p.rect(x, y, w, h, highlight ? UI.panelEdge : 0x2a2f48);
    drawIcon(p, baseOf(item).look ?? baseOf(item).slot, x + 1, y + 1, w - 2, h - 2, colour, CURRENCY.has(item.base) ? CURRENCY.get(item.base).short : undefined);
    outline(p, x, y, w, h, item.rarity === 'normal' && itemClass(item) === item.rarity ? UI.cellEdge : colour);
    if ((item.quantity ?? 1) > 1) shadowText(p, x + 1, y + 1, String(item.quantity), PALETTE.white);
    if (item.gem && h >= 16) shadowText(p, x + 1, y + h - 8, String(item.gem.level), PALETTE.white);
    // Items the hero can't use yet get a red corner; the bench's item a sand one.
    if ((isEquipment(item) || item.gem) && requiredLevel(item) > this.store.heroLevel) p.rect(x + w - 3, y + 1, 2, 2, UI.bad);
    if (item.uid === this.benchItem && this.left === 'bench') outline(p, x - 1, y - 1, w + 2, h + 2, PALETTE.sand);
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
    const compact = this.compact();
    this.frame(p, r, compact ? 'Bag' : 'Inventory');
    if (!compact) {
      if (this.left === null || this.left === 'skills') {
        const b = this.skillsButton();
        const on = this.left === 'skills';
        p.rect(b.x, b.y, b.w, b.h, on ? PALETTE.sand : PALETTE.slate);
        p.text(b.x + 2, b.y + 2, 'GEMS', on ? PALETTE.ink : PALETTE.white);
      }
      const eq = this.store.state.equipment;
      const cur = this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y));
      for (const slot of EQUIP_SLOTS) {
        const sr = this.slotRect(slot);
        p.rect(sr.x, sr.y, sr.w, sr.h, UI.cell);
        const item = eq[slot];
        if (item) this.drawItem(p, item, sr.x, sr.y, sr.w, sr.h, !this.held && cur?.kind === 'slot' && cur.slot === slot);
        else drawIcon(p, SLOT_LOOK[slot], sr.x + 2, sr.y + 2, sr.w - 4, sr.h - 4, UI.panelEdge);
        if (this.held && cur?.kind === 'slot' && cur.slot === slot) outline(p, sr.x - 1, sr.y - 1, sr.w + 2, sr.h + 2, equipItem(eq, this.held.item, slot, this.store.heroLevel).ok ? UI.valid : UI.invalid);
      }
    }
    const g = this.inventoryGridOrigin();
    this.drawGrid(p, this.store.state.inventory, g.x, g.y);
    const by = r.y + r.h - 12;
    shadowText(p, r.x + 5, by, `GOLD ${this.store.state.gold}`, UI.gold);
    const lvl = `LV ${this.store.heroLevel}`;
    p.text(r.x + r.w - 5 - textWidth(lvl), by, lvl, UI.dim);
  }

  private drawLeft(p: Painter): void {
    const r = this.leftRect();
    const titles = this.opts.titles ?? {};
    const title =
      this.left === 'stash'
        ? (titles.stash ?? 'Stash')
        : this.left === 'vendor'
          ? (titles.vendor ?? (this.store.vendor.kind === 'gems' ? 'Gem vendor' : 'Smith'))
          : this.left === 'bench'
            ? (titles.bench ?? 'Crafting bench')
            : (titles.skills ?? 'Skills');
    this.frame(p, r, title);
    if (this.left === 'skills') return this.drawSkills(p, r);
    if (this.left === 'bench') return this.drawBench(p, r);
    if (this.left === 'stash') {
      for (let i = 0; i < STASH_TABS; i++) {
        const t = this.tabRect(i);
        p.rect(t.x, t.y, t.w, t.h, i === this.stashTab ? UI.panelEdge : UI.cell);
        p.text(t.x + 4, t.y + 3, String(i + 1), i === this.stashTab ? UI.title : UI.dim);
      }
    } else {
      this.vendorTabs().forEach((tab, i) => {
        const t = this.tabRect(i);
        const on = tab.kind === this.store.vendor.kind;
        p.rect(t.x, t.y, t.w, t.h, on ? UI.panelEdge : UI.cell);
        p.text(t.x + Math.floor((t.w - textWidth(tab.label)) / 2), t.y + 3, tab.label, on ? UI.title : UI.dim);
      });
      const hint = this.narrow ? 'TAP TWICE: BUY. DROP: SELL' : 'CTRL-CLICK: BUY / SELL';
      miniText(p, r.x + 5, r.y + r.h - 10, hint, PALETTE.mist);
    }
    const g = this.leftGridOrigin();
    this.drawGrid(p, this.leftGrid()!, g.x, g.y);
  }

  private drawSkills(p: Painter, r: Rect): void {
    const nums = this.numbers();
    const cur = this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y));
    for (let s = 0; s < SKILL_SLOTS; s++) {
      const row = this.skillRowRect(s);
      const sock = this.store.skills[s]!;
      const on = s === this.skillSlot;
      if (on) p.rect(row.x, row.y, row.w, row.h, PALETTE.night);
      p.text(row.x + 1, row.y + 6, SLOT_KEYS[s]!, on ? UI.title : UI.dim);
      const a = this.socketRect(s, -1);
      // links between the sockets
      p.rect(a.x + a.w, a.y + 9, 3 + SUPPORT_LINKS * 13 - 3, 1, sock.gem ? PALETTE.slate : UI.cellEdge);
      this.drawSocket(p, a, sock.gem, cur, s, -1);
      for (let l = 0; l < SUPPORT_LINKS; l++) this.drawSocket(p, this.socketRect(s, l), sock.supports[l] ?? null, cur, s, l, sock.gem && sock.supports[l] ? supportApplies(sock, sock.supports[l]!) === false : false);
      // gem XP: a bar under every socketed gem (full and orange while it waits on the hero's level)
      for (let l = -1; l < SUPPORT_LINKS; l++) {
        const gem = l < 0 ? sock.gem : (sock.supports[l] ?? null);
        const prog = gem ? gemProgress(gem, this.store.heroLevel) : null;
        if (!prog) continue;
        const g = this.socketRect(s, l);
        p.rect(g.x, g.y + g.h, g.w, 1, PALETTE.night);
        p.rect(g.x, g.y + g.h, Math.max(prog.xp > 0 ? 1 : 0, Math.round(g.w * prog.fraction)), 1, prog.max ? PALETTE.sand : prog.waiting ? PALETTE.orange : PALETTE.cyan);
      }
      const n = nums[s];
      const tx = r.x + 72;
      const chars = Math.floor((r.x + r.w - 3 - tx + 1) / 4);
      if (n) {
        miniText(p, tx, row.y + 4, n.name.toUpperCase().slice(0, chars), on ? PALETTE.white : PALETTE.mist);
        const line = n.channel ? `${fmt(n.cost)}/S` : `${fmt(n.cost)} MP${n.cooldown > 0 ? ` ${fmt(n.cooldown)}S` : ''}`;
        miniText(p, tx, row.y + 11, line.slice(0, chars), PALETTE.sky);
        if (n.unsupported.length) p.rect(r.x + r.w - 5, row.y + 11, 2, 5, PALETTE.red);
      } else miniText(p, tx, row.y + 7, 'EMPTY', PALETTE.slate);
    }
    // details of the selected slot: a pocket `npm run combat -- dps`
    const top = r.y + HEADER + 2 + SKILL_SLOTS * 21 + 1;
    p.rect(r.x + 4, top, r.w - 8, 1, PALETTE.slate);
    const lines = this.skillLines(nums[this.skillSlot] ?? null, Math.floor((r.w - 10) / 6), this.store.skills[this.skillSlot]?.gem ?? null);
    lines.slice(0, 6).forEach((l, i) => p.text(r.x + 5, top + 4 + i * 9, l.text, l.color));
  }

  /** The detail lines for one slot (also the skill panel's test surface). */
  skillLines(n: SkillNumbers | null, chars = 20, gem: Item | null = null): { text: string; color: number }[] {
    if (!n) {
      return [{ text: `SKILL ${this.skillSlot + 1}: EMPTY`, color: UI.dim }, ...wrapChars(this.narrow ? 'HOLD A GEM IN YOUR BAG TO SOCKET IT' : 'RIGHT-CLICK A GEM IN YOUR BAG TO SOCKET IT', chars).map((t) => ({ text: t, color: PALETTE.slate }))];
    }
    // the gem's XP toward its next level when it fits on the title line
    const prog = gem ? gemProgress(gem, this.store.heroLevel) : null;
    const title = `${n.name.toUpperCase()} LV${n.level}`;
    const xp = !prog ? '' : prog.max ? ' MAX' : prog.waiting ? ` NEEDS L${prog.nextReq}` : ` ${Math.floor(prog.fraction * 100)}%XP`;
    const out: { text: string; color: number }[] = [{ text: (title.length + xp.length <= chars ? title + xp : title).slice(0, chars), color: UI.title }];
    if (n.hit > 0) {
      out.push({ text: `HIT ${fmt(n.hit)} ${(n.types[0] ?? '').toUpperCase()}`.slice(0, chars), color: PALETTE.white });
      out.push({ text: `DPS ${fmt(n.dps)} ${fmt(n.hitsPerSecond)}/S`.slice(0, chars), color: PALETTE.lime });
    } else out.push({ text: 'NO DAMAGE', color: UI.dim });
    out.push({ text: (n.channel ? `COST ${fmt(n.cost)}/S` : `COST ${fmt(n.cost)}${n.cooldown > 0 ? ` CD ${fmt(n.cooldown)}S` : ''}`).slice(0, chars), color: PALETTE.sky });
    const shape = [`CAST ${fmt(n.castTime)}S`, n.projectiles > 1 ? `X${n.projectiles}` : n.area !== 1 ? `AREA ${Math.round(n.area * 100)}%` : ''].filter(Boolean).join(' ');
    out.push({ text: shape.slice(0, chars), color: PALETTE.mist });
    if (n.unsupported.length) out.push({ text: `! ${n.unsupported.length} LINK${n.unsupported.length > 1 ? 'S' : ''} DON'T FIT`.slice(0, chars), color: PALETTE.red });
    else if (n.supports.length) out.push({ text: `${n.supports.length} SUPPORT${n.supports.length > 1 ? 'S' : ''} LINKED`.slice(0, chars), color: PALETTE.green });
    return out;
  }

  private drawSocket(p: Painter, r: Rect, gem: Item | null, cur: Target | null, slot: number, link: number, bad = false): void {
    const hot = cur?.kind === 'socket' && cur.slot === slot && cur.link === link;
    p.rect(r.x, r.y, r.w, r.h, UI.cell);
    if (gem) this.drawItem(p, gem, r.x, r.y, r.w, r.h, hot && !this.held);
    else {
      // an empty socket: a ring in the socket's kind (big = skill, small = support)
      outline(p, r.x + 2, r.y + 2, r.w - 4, r.h - 4, link < 0 ? PALETTE.slate : 0x3b4466);
    }
    if (bad) outline(p, r.x, r.y, r.w, r.h, PALETTE.red);
    if (this.held && hot) outline(p, r.x - 1, r.y - 1, r.w + 2, r.h + 2, socketBlocker(this.held.item, { slot, link }) ? UI.invalid : UI.valid);
  }

  private drawBench(p: Painter, r: Rect): void {
    const f = this.benchFrame();
    p.rect(f.x, f.y, f.w, f.h, UI.cell);
    outline(p, f.x, f.y, f.w, f.h, UI.cellEdge);
    const target = this.benchTarget();
    const tx = f.x + f.w + 4;
    const chars = Math.floor((r.x + r.w - 4 - tx) / 6);
    if (target) {
      const s = itemSize(target);
      const scale = Math.min(1, (f.w - 2) / (s.w * CELL), (f.h - 2) / (s.h * CELL));
      const w = Math.max(8, Math.floor(s.w * CELL * scale));
      const h = Math.max(8, Math.floor(s.h * CELL * scale));
      this.drawItem(p, target, f.x + Math.floor((f.w - w) / 2), f.y + Math.floor((f.h - h) / 2), w, h);
      wrapChars(target.name.toUpperCase(), chars)
        .slice(0, 3)
        .forEach((l, i) => p.text(tx, f.y + 1 + i * 9, l, itemColour(target)));
      miniText(p, tx, f.y + 30, `${target.rarity.toUpperCase()} · ${target.affixes.length} AFFIX${target.affixes.length === 1 ? '' : 'ES'}`, PALETTE.mist);
    } else {
      wrapChars(this.narrow ? 'TAP AN ITEM IN YOUR BAG' : 'CLICK AN ITEM IN YOUR BAG OR GEAR', chars).forEach((l, i) => p.text(tx, f.y + 1 + i * 9, l, UI.dim));
    }
    const counts = new Map<string, number>();
    for (const pl of this.store.state.inventory.items) if (CURRENCY.has(pl.item.base)) counts.set(pl.item.base, (counts.get(pl.item.base) ?? 0) + (pl.item.quantity ?? 1));
    const cur = this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y));
    const hovered = cur?.kind === 'orb' ? cur.base : this.hoverOrb;
    CURRENCY.all().forEach((c, i) => {
      const o = this.orbRect(i);
      const n = counts.get(c.id) ?? 0;
      const blocked = target ? craftBlocker(c.action, target) : null;
      const hot = cur?.kind === 'orb' && cur.base === c.id;
      p.rect(o.x, o.y, o.w, o.h, hot ? UI.panelEdge : UI.cell);
      drawIcon(p, 'orb', o.x + 2, o.y + 1, o.w - 4, o.h - 4, n > 0 && !blocked ? PALETTE.orange : PALETTE.slate, c.short);
      outline(p, o.x, o.y, o.w, o.h, n > 0 && target && !blocked ? PALETTE.sand : UI.cellEdge);
      if (n > 0) shadowText(p, o.x + 1, o.y + 1, String(n), PALETTE.white);
    });
    // what the hovered orb does (and why it can't)
    const iy = this.orbRect(9).y + 26;
    if (hovered && CURRENCY.has(hovered)) {
      const c = CURRENCY.get(hovered);
      const lc = Math.floor((r.w - 10) / 6);
      const lines: { text: string; color: number }[] = [{ text: c.name.toUpperCase(), color: UI.title }, ...wrapChars(c.description.toUpperCase(), lc).map((t) => ({ text: t, color: PALETTE.mist }))];
      const why = target ? craftBlocker(c.action, target) : null;
      if (why) lines.push(...wrapChars(why.toUpperCase(), lc).map((t) => ({ text: t, color: PALETTE.red })));
      lines.slice(0, Math.floor((r.y + r.h - 4 - iy) / 9)).forEach((l, i) => p.text(r.x + 5, iy + i * 9, l.text, l.color));
    } else wrapChars(this.narrow ? 'TAP AN ORB TO USE IT' : 'CLICK AN ORB TO USE IT', Math.floor((r.w - 10) / 6)).forEach((l, i) => p.text(r.x + 5, iy + i * 9, l, UI.dim));
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
      const touchOk = !this.lastTouch || this.cursorMode === 'pad' || item?.uid === this.touchPick;
      if (item && touchOk) this.drawTip(p, item, t!, cx, cy);
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
    const price = forSale ? { label: 'Buy', gold: buyPrice(item), affordable: buyPrice(item) <= this.store.state.gold } : this.left === 'vendor' && inInventory ? { label: 'Sells for', gold: sellPrice(item) } : undefined;
    const right = this.lastTouch && this.cursorMode === 'pointer' ? 'Hold' : this.cursorMode === 'pad' ? 'X' : 'Right-click';
    const hint =
      inInventory && isEquipment(item)
        ? this.left === 'bench'
          ? undefined
          : `${right}: equip`
        : inInventory && isGem(item)
          ? this.left === 'skills'
            ? `${right}: socket in skill ${this.skillSlot + 1}`
            : 'Socket it in the skill panel (G)'
          : t.kind === 'slot'
            ? `${right}: unequip`
            : t.kind === 'socket'
              ? `${right}: take out`
              : undefined;
    let extra: { text: string; color: number }[] | undefined;
    if (t.kind === 'socket' && t.link < 0) extra = this.skillLines(this.numbers()[t.slot] ?? null, 30, item).slice(1);
    else if (t.kind === 'socket') {
      const ok = supportApplies(this.store.skills[t.slot]!, item);
      if (ok === false) extra = [{ text: `Doesn't support ${this.store.skills[t.slot]!.gem!.name}`, color: UI.bad }];
    }
    const chars = this.narrow ? Math.max(12, Math.floor((this.size.w - 12) / 6)) : TIP_CHARS;
    const lines = tooltipLines(item, { showTiers: this.altHeld, compare: t.kind === 'slot' ? [] : this.comparison(item), heroLevel: this.store.heroLevel, chars, ...(price ? { price } : {}), ...(hint ? { hint } : {}), ...(extra ? { extra } : {}) });
    const size = measureTooltip(lines);
    let x: number;
    let y: number;
    if (this.narrow) {
      // phones: across the screen, on the half away from the finger
      x = Math.max(1, Math.floor((this.size.w - size.w) / 2));
      y = cy > this.size.h / 2 ? Math.max(1, cy - size.h - 12) : Math.min(this.size.h - size.h - 1, cy + 12);
    } else {
      // beside the window the item is in (stash / vendor / bench / skills: to its right; the bag: to its left)
      const inside = (r: Rect) => cx >= r.x && cy >= r.y && cx < r.x + r.w && cy < r.y + r.h;
      const l = this.left ? this.leftRect() : null;
      const rr = this.inventoryOpen ? this.rightRect() : null;
      if (l && inside(l) && l.x + l.w + 3 + size.w <= this.size.w - 2) x = l.x + l.w + 3;
      else if (rr && inside(rr) && rr.x - 3 - size.w >= 2) x = rr.x - 3 - size.w;
      else {
        x = cx + 10;
        if (x + size.w > this.size.w - 2) x = cx - size.w - 6;
      }
      x = Math.max(2, Math.min(this.size.w - size.w - 2, x));
      y = Math.max(2, Math.min(this.size.h - size.h - 2, cy - Math.floor(size.h / 2)));
    }
    drawTooltip(p, x, y, lines);
  }
}

/** Numbers for the skill panel: 1234, 12.3, 0.62. */
function fmt(v: number): string {
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100).replace(/^0\./, '.');
}

/** Word-wrap uppercase text to `chars` characters per line. */
function wrapChars(text: string, chars: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= chars) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** The shell kit's 3×5 mini font (ui/kit.ts) through a Painter. */
function miniText(p: Painter, x: number, y: number, s: string, color: number): void {
  miniRows(s).forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) if (row[rx] === 'c') p.rect(x + rx, y + ry, 1, 1, color);
  });
}
