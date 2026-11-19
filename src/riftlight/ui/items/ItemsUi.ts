/**
 * The item windows: inventory + paper doll (right), and on the left the stash, a vendor
 * (wares and gems tabs), the crafting bench or the skill panel (gems in the four skill
 * slots); tooltips and the item on the cursor. One 2D canvas at the art resolution, laid
 * over the game canvas with the engine's integer framing (the same approach as the engine
 * Hud), so one UI pixel is one art pixel at every size. Windows wear the shell's chrome
 * (ui/kit.ts: bevelled frame, navy title bar, close box).
 *
 * Input: mouse (click to pick up / drop, drag and drop, right-click to equip, socket or use,
 * Ctrl-click to stash / sell / buy, Alt for affix tiers, the wheel over an item scrolls its tooltip
 * taller than the screen), touch (a tap picks an item: its
 * tooltip and, under it, a row of buttons a thumb can hit for what it can do there, Equip / Use /
 * Socket / Sell / To stash / Move...: `touchActions`; a second tap still acts, a long-press is still
 * the right-click; a drag on a tooltip taller than the screen scrolls it; a swipe down or sideways
 * from a window's title bar closes the windows) and keys or a gamepad (a focus that steps
 * between cells and slots, in the window that last gained focus: confirm = click, X = right-click,
 * Y / V = Ctrl-click, tab = the next tab, back = put the held item back / close; the right stick
 * scrolls a tooltip taller than the screen). Every change is a pure
 * `loot/inventory` or `loot/sockets` operation committed to the ItemsStore.
 *
 * The mouse and touch come from `ctx.input`: the canvas takes no pointer events itself, so a
 * recording of the game replays what was done here. Hosted, the shell's pointer events
 * (`handle`, while the windows are the top panel: never the press that opened them); standalone,
 * `update(dt)` reads the engine's (`buttonEvents`, where the pointer is). Ctrl / Shift / Alt are
 * the keys held.
 *
 * Standalone (`/?game=lootlab`): call `update(dt)` every frame; the view polls the pad and
 * Escape itself. Hosted by the game shell (`{ hosted: true }`, wire/loot.ts): the shell
 * routes UiEvents to `handle(e)` and closes it; the view neither polls the pad nor closes on Escape.
 *
 * Narrow screens (a phone in portrait: 124 art pixels wide) stack the left window above a
 * compact bag (no paper doll) and wrap tooltips to the screen; a short one (a phone held sideways,
 * 180 rows) closes the inventory's gaps up. At ten feet (no touch controls, a wide screen) text is in
 * the normal font, never the mini one (the skill panel wider for it).
 */
import type { GameContext, LineValues } from '../../../engine';
import { padName } from '../../../engine/controls';
import type { PadGlyphs } from '../../../engine/settings';
import { surfaceScale } from '../../../engine/hud/deviceText';
import { noteText } from '../../../engine/animation/font';
import { PALETTE } from '../../../engine/palette';
import type { StatSheet } from '../../core/mods';
import type { Item } from '../../core/types';
import { compareEquip, type StatDelta } from '../../loot/compare';
import { lang, t } from '../../lang';
import { CURRENCY } from '../../loot/content';
import { applyCurrency, craftBlocker } from '../../loot/craft';
import { LOOT_SOUNDS } from '../../loot/data/sounds';
import { itemClass, itemColour } from '../../loot/filter';
import { addItem, dropAt, emptyGrid, equip, equipItem, findItem, type Grid, gridOf, itemAt, itemSize, type LootState, removeItem, replaceItem, setGrid, STASH_TABS, transfer, unequip } from '../../loot/inventory';
import { baseOf, EQUIP_SLOTS, type EquipSlot, isEquipment, requiredLevel } from '../../loot/itemMods';
import { currencyDescription, currencyName, currencyShort, damageName, goldLabel, itemName, rarityName, type Reason, reasonText } from '../../loot/names';
import { autoSocket, gemAt, gemProgress, isGem, setSocket, SKILL_SLOTS, skillNumbers, socketBlocker, SUPPORT_LINKS, supportApplies, type SkillNumbers } from '../../loot/sockets';
import { buy, buyPrice, sell, sellPrice, type VendorKind } from '../../loot/vendor';
import { SKILLS } from '../../skills/actives';
import { clip, inside, miniCovers, miniRows, miniWidth, type UiEvent } from '../kit';
import { overlaps } from '../layout';
import { tapArt } from '../layer';
import { gemIcon } from '../../skills/icons';
import { drawGemIcon, drawIcon } from './icons';
import { canvasPainter, outline, type Painter, panel, shadowText, textWidth, UI, wrap } from './paint';
import type { ItemsStore } from './store';
import { drawTooltip, measureTooltip, TIP_W, type TipLine, tooltipLines, tooltipView } from './tooltip';

export const CELL = 10;
const PANEL_W = 128;
/** Title bar height: content starts this far below a window's top. */
export const HEADER = 16;
const INV_H = 182;
/** The bag's top, below the paper doll (art rows from the inventory window's top). */
const BAG_Y = 108;
/**
 * The inventory on a screen too short for INV_H (a phone held sideways, 180 rows): the gaps close
 * up, the bag 4 rows nearer the paper doll and the gold 6 nearer the bag.
 */
const INV_SHORT_H = 172;
const SHORT_BAG_Y = 104;
const INV_COMPACT_H = 84;
const STASH_H = 156;
const VENDOR_H = 148;
const BENCH_H = 156;
const SKILLS_H = 164;
/** The skill panel at ten feet: wide enough for its rows' names and costs in the normal font. */
const SKILLS_WIDE_W = 176;
const VENDOR_SIZE = { w: 12, h: 10 };
/** Screens narrower than this stack the windows (phones in portrait). */
const WIDE = PANEL_W * 2 + 12;
/**
 * The pad's focus: a double frame of white (ink between its lines), read from the couch. Its shape
 * sets it apart, not its colour: an item's frame is one pixel (a rarity's colour, rare: sand; a
 * skill gem's look colour, white for some; a normal item's dark), never a double one.
 */
export const FOCUS = PALETTE.white;
/** A pad's or a mouse's tooltip taller than the screen: art rows a wheel tick scrolls it (two lines), and a second at the right stick's full tilt. */
const TIP_WHEEL = 18;
const TIP_STICK = 150;

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

/** Vendor tabs, in order (a kind without stock is not shown); `label` is a line id. */
const VENDOR_TABS: readonly { kind: VendorKind; label: string }[] = [
  { kind: 'smith', label: 'item.vendor.tab.smith' },
  { kind: 'gems', label: 'item.vendor.tab.gems' },
  { kind: 'gamble', label: 'item.vendor.tab.gamble' },
];

/** A message under the windows: a line id and its blanks, shown in the player's language. */
export interface ItemsMessage {
  readonly id: string;
  readonly values?: LineValues;
  /** A pad button (`PadA`) whose name fills the line's `{button}`, in the player's style when drawn. */
  readonly pad?: string;
  /** An older snapshot's finished words (before messages were ids): shown as they are. */
  readonly text?: string;
}

/**
 * A window's hint for the device that drives it: with the pad `<id>_pad`, its `{button}` the pad
 * button that does it in the player's style (`PadY` → Triangle or Y); on a phone `<id>_touch`; else
 * the mouse's `<id>` ("Ctrl-click: buy / sell").
 */
export function windowHint(id: string, padButton: string, mode: 'pad' | 'touch' | 'mouse', style: PadGlyphs): string {
  if (mode === 'pad') return t(`${id}_pad`, { button: padName(padButton, style, lang()) });
  return t(mode === 'touch' ? `${id}_touch` : id);
}

/** An orb's tooltip with the pad cursor: Square (X) picks the orb, then Cross (A) on an item uses it. */
export function padOrbHint(style: PadGlyphs): string {
  return t('item.tip.use_orb_pad', { button: padName('PadX', style, lang()), button2: padName('PadA', style, lang()) });
}

/** A message's words in the player's language, a pad button in its style (`PadA` → Cross or A). */
export function messageText(m: ItemsMessage, style: PadGlyphs): string {
  return t(m.id, m.pad ? { ...m.values, button: padName(m.pad, style, lang()) } : m.values);
}

/** A reason a loot action can't be done, as a message. */
const why = (r: Reason): ItemsMessage => ({ id: `item.reason.${r.id}`, ...(r.values ? { values: r.values } : {}) });

/** What the item windows keep while closed (`ItemsUi.viewState`): tabs, the cursor, the last message. */
export interface ItemsViewState {
  readonly stashTab: number;
  readonly skillSlot: number;
  readonly cursor: { readonly x: number; readonly y: number };
  readonly cursorMode: 'pointer' | 'pad';
  readonly message: ItemsMessage | null;
  readonly messageTime: number;
  readonly time: number;
  readonly pointerAt: { readonly x: number; readonly y: number };
  readonly lastTouch: boolean;
  readonly longPressed: boolean;
  readonly hoverOrb: string | null;
}

export class ItemsUi {
  /** The overlay canvas (art resolution); null without a page (headless: the windows keep their state and layout, nothing is painted). */
  readonly canvas: HTMLCanvasElement | null;
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
  /** Last input device that moved the cursor (the pad's while the pad is in use: `followDevice`). */
  cursorMode: 'pointer' | 'pad' = 'pointer';
  /** The device in use when the windows last looked (`followDevice`). */
  private deviceSeen: string | null = null;
  altHeld = false;
  message: ItemsMessage | null = null;
  /** Touch: the item whose tooltip a first tap opened (a second tap acts on it). */
  private touchPick: string | null = null;
  /** Where the item a finger picked was tapped (its tooltip and action buttons stay while the finger goes to them). */
  private touchAt: { x: number; y: number } | null = null;
  /** How far (art rows) a finger scrolled the picked item's tooltip that is taller than the screen (`pickLayout`'s `max` at most). */
  private tipScroll = 0;
  /**
   * How far (art rows) the right stick or the wheel scrolled the pad's or the mouse's tooltip taller
   * than the screen, and whose it is (`cursorTipLayout`'s `key`): another item's shows from its top.
   */
  private tipRead = { key: '', scroll: 0 };
  private lastTouch = false;
  private hoverOrb: string | null = null;
  private messageTime = 0;
  /** Where the pointer was at the last `update`. */
  private pointerAt = { x: -1, y: -1 };
  /** The press now: where and when, a touch's, moved, picked an item up; `scroll` the tooltip's scroll when it landed on a picked item's tooltip taller than the screen (a drag scrolls it). */
  private downAt: { x: number; y: number; t: number; touch: boolean; moved: boolean; picked: boolean; scroll?: number } | null = null;
  private longPressed = false;
  private time = 0;
  private compareCache = { key: '', deltas: [] as StatDelta[] };
  private skillCache = { key: '', numbers: [] as (SkillNumbers | null)[] };
  /** The vendor's hint laid out, by its words and width. */
  private readonly hintCache = new Map<string, { mini: boolean; rows: string[] }>();
  private vendorCache: { stock: readonly Item[]; grid: Grid } = { stock: [], grid: emptyGrid(VENDOR_SIZE.w, VENDOR_SIZE.h) };
  private size = { w: 480, h: 270 };
  private drawnKey = '';
  /** A townsperson's line drawn over the windows (`talkOver`), or null. */
  private said: { readonly box: Rect; readonly rows: readonly string[] } | null = null;

  /**
   * A townsperson's line over the windows, where the screen has no free space for it (a phone held
   * upright: `talkPlace`'s `over`); the shell's HUD is under this canvas. Null: none.
   */
  talkOver(talk: { readonly box: Rect; readonly rows: readonly string[] } | null): void {
    this.said = talk;
  }
  /** The last paint drew text in the device's font: the canvas is painted at the screen's resolution. */
  private deviceText = false;

  constructor(
    private readonly ctx: GameContext,
    readonly store: ItemsStore,
    private readonly opts: ItemsUiOptions = {},
  ) {
    const container = ctx.engine.renderer.container;
    this.canvas = null;
    if (container) {
      const c = document.createElement('canvas');
      c.dataset.itemsUi = 'true';
      c.dataset.hud = 'true'; // a 2D overlay, not a rendering canvas (the e2e canvas count)
      c.className = 'riftlight-items';
      // the pointer goes through to the game canvas: the engine's input reads it (and records it)
      Object.assign(c.style, { position: 'absolute', imageRendering: 'pixelated', zIndex: '6', display: 'none', pointerEvents: 'none' });
      container.appendChild(c);
      this.canvas = c;
    }
    for (const [id, def] of Object.entries(LOOT_SOUNDS)) ctx.audio.register(id, def);
    ctx.input.preventKeys.add('AltLeft').add('AltRight'); // Alt shows affix tiers, not the browser's menu bar
  }

  /** What stays when the windows close, as data (save-states: a snapshot is taken with them closed). */
  viewState(): ItemsViewState {
    if (this.isOpen) throw new Error('the item windows are open');
    return { stashTab: this.stashTab, skillSlot: this.skillSlot, cursor: { ...this.cursor }, cursorMode: this.cursorMode, message: this.message ? { ...this.message } : null, messageTime: this.messageTime, time: this.time, pointerAt: { ...this.pointerAt }, lastTouch: this.lastTouch, longPressed: this.longPressed, hoverOrb: this.hoverOrb };
  }

  setViewState(s: ItemsViewState): void {
    this.closeAll();
    this.stashTab = s.stashTab;
    this.skillSlot = s.skillSlot;
    this.cursor = { ...s.cursor };
    this.cursorMode = s.cursorMode;
    const m = s.message as ItemsMessage | string | null | undefined;
    this.message = typeof m === 'string' ? { id: '', text: m } : (m ?? null); // an older snapshot kept the text
    this.messageTime = s.messageTime;
    this.time = s.time;
    this.pointerAt = { ...s.pointerAt };
    this.lastTouch = s.lastTouch;
    this.longPressed = s.longPressed;
    this.hoverOrb = s.hoverOrb;
    this.downAt = null;
  }

  get isOpen(): boolean {
    return this.inventoryOpen || this.left !== null;
  }

  /** Narrow screen: windows stack and the bag goes compact under a left window. */
  get narrow(): boolean {
    return this.size.w < WIDE;
  }

  /**
   * Text read from the couch (docs/game/ui.md *At ten feet*): the normal font, never the 3×5 mini
   * one, everywhere but a phone's compact layouts (a narrow screen, a page with touch controls: the
   * recorded density, so a replay lays out the same).
   */
  tenFoot(): boolean {
    return !this.narrow && this.ctx.engine.renderer.touchDensity === 0;
  }

  /** A wide screen too short for the whole inventory (a phone held sideways, 180 rows): its gaps close up (`INV_SHORT_H`). */
  private short(): boolean {
    return !this.narrow && this.size.h < INV_H + 4;
  }

  // ---------------------------------------------------------------- windows

  openInventory(): void {
    this.inventoryOpen = true;
    this.opened('right');
  }

  openStash(): void {
    this.left = 'stash';
    this.inventoryOpen = true;
    this.opened('left');
  }

  openVendor(): void {
    this.left = 'vendor';
    this.inventoryOpen = true;
    this.opened('left');
  }

  /** The crafting bench: pick an item, then an orb. */
  openBench(): void {
    this.left = 'bench';
    this.inventoryOpen = true;
    this.opened('left');
  }

  /** The skill panel: gems in the four skill slots, beside the bag. */
  openSkills(): void {
    this.left = 'skills';
    this.inventoryOpen = true;
    this.opened('left');
  }

  /**
   * A window gained focus (it opened, or the shell's page changed to it): the view follows the
   * device in use (`followDevice`) and the pad's focus goes into that window (`padInto`).
   */
  private opened(side: 'left' | 'right'): void {
    this.refreshSize();
    this.followDevice();
    this.padInto(side);
  }

  /**
   * With the pad's focus (the keys' too), put it in the window on `side` (a left window, or the
   * inventory) unless it is on something there already: that window's first stop (`padHome`). So
   * when a window gains focus (it opens, the page changes to it, Tab or the Gems button shows it, the
   * one it was in closes) no other window keeps a focus mark, nor its tooltip over this one. The
   * mouse's cursor stays where the mouse is.
   */
  private padInto(side: 'left' | 'right'): void {
    if (this.cursorMode !== 'pad') return;
    const win = side === 'left' ? (this.left ? this.leftRect() : null) : this.inventoryOpen ? this.rightRect() : null;
    if (!win) return;
    const x = Math.floor(this.cursor.x);
    const y = Math.floor(this.cursor.y);
    const on = this.hit(x, y);
    if (on && on.kind !== 'panel' && inside(win, x, y)) return;
    this.cursor = this.padHome(side);
  }

  /** The first stop of the window on `side` (default: the left window when one is open): the selected skill's socket, the bench, the first cell. */
  private padHome(side: 'left' | 'right' = this.left ? 'left' : 'right'): { x: number; y: number } {
    if (side === 'left' && this.left) return this.left === 'skills' ? this.socketCenter(this.skillSlot, -1) : this.left === 'bench' ? this.centre(this.benchFrame()) : this.cellCenter('left', 0, 0);
    return this.cellCenter('inventory', 0, 0);
  }

  /** The bag's Gems button or Tab: the skill panel shown beside the bag (the focus goes into it), or hidden (back into the bag). */
  private toggleSkills(): void {
    this.left = this.left === 'skills' ? null : 'skills';
    this.padInto(this.left ? 'left' : 'right');
  }

  /** Close one side (or everything); the item on the cursor goes back. */
  close(which: 'inventory' | 'stash' | 'vendor' | 'bench' | 'skills' | 'all' = 'all'): void {
    if (which === 'all' || which === 'inventory') {
      this.inventoryOpen = false;
      this.left = null;
    } else if (this.left === which) {
      this.left = null;
      this.padInto('right');
    }
    if (!this.inventoryOpen && !this.left) {
      this.returnHeld();
      this.applying = null;
      this.benchItem = null;
      this.touchPick = null;
      this.touchAt = null;
      this.tipScroll = 0;
      this.tipRead = { key: '', scroll: 0 };
      this.downAt = null;
      this.longPressed = false;
      this.said = null; // a townsperson's line goes with the windows (the next to open never shows it)
      this.paint(); // hide the canvas now: a hosted view gets no more updates once closed
    }
  }

  closeAll(): void {
    this.close('all');
  }

  dispose(): void {
    this.ctx.input.preventKeys.delete('AltLeft');
    this.ctx.input.preventKeys.delete('AltRight');
    this.canvas?.remove();
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
    if (this.left === 'vendor') {
      // the window holds the hint in rows: the pad's; on a page with touch controls the taller of a
      // finger's and the mouse's (the layout never changes between them: a tap lands where it was
      // aimed); elsewhere the hint's own (a mouse's and a pad's screen keep their layout)
      const extra = (hint: { mini: boolean; rows: string[] }) => (hint.mini ? 0 : (hint.rows.length - 1) * 9 + 1);
      const mode = this.hintMode();
      const modes = mode !== 'pad' && this.ctx.engine.renderer.touchDensity > 0 ? (['touch', 'mouse'] as const) : [mode];
      return VENDOR_H + Math.max(...modes.map((m) => extra(this.vendorHint(m))));
    }
    return this.left === 'bench' ? BENCH_H : this.left === 'skills' ? SKILLS_H : STASH_H;
  }

  /** Whose controls the windows' hints name: the device in use's (a pad's, a finger's, or the mouse's), never the screen's width. */
  hintMode(): 'pad' | 'touch' | 'mouse' {
    const device = this.ctx.engine.controls.device;
    return device === 'pad' ? 'pad' : device === 'touch' ? 'touch' : 'mouse';
  }

  /**
   * The windows opened, or the device in use changed while they are open: with a pad, its focus at
   * once (`padStart`: a frame on the item under the cursor, else the first cell), so the first press
   * moves it. The device is the engine's (recorded), so a replay does the same.
   */
  private followDevice(): void {
    const device = this.ctx.engine.controls.device;
    this.deviceSeen = device;
    if (device === 'pad' && this.cursorMode !== 'pad') this.padStart();
  }

  /** A window's hint for the device that drives it (`windowHint`, `hintMode`). */
  private hint(id: string, padButton: string, mode = this.hintMode()): string {
    return windowHint(id, padButton, mode, this.ctx.engine.controls.style);
  }

  /** The hint under the vendor's goods: a row of the mini font, or rows of the normal font (the window grows). */
  private vendorHint(mode = this.hintMode()): { mini: boolean; rows: string[] } {
    const text = this.hint('item.vendor.hint', 'PadY', mode); // Ctrl-click: buy / sell
    const w = this.panelW() - 10;
    const key = `${text}|${w}|${this.narrow}`;
    let hint = this.hintCache.get(key);
    // the normal font, read from the couch; a phone's narrow window: one row of the mini font when it fits
    if (!hint) this.hintCache.set(key, (hint = this.narrow && miniCovers(text) && miniWidth(text) <= w ? { mini: true, rows: [text] } : { mini: false, rows: wrap(text, w) }));
    return hint;
  }

  /** Inventory panel rect (art pixels). */
  rightRect(): Rect {
    const w = this.panelW();
    const h = this.compact() ? INV_COMPACT_H : this.short() ? INV_SHORT_H : INV_H;
    if (this.narrow) {
      const x = Math.floor((this.size.w - w) / 2);
      if (!this.left) return { x, y: Math.max(1, Math.floor((this.size.h - h) / 2)), w, h };
      const total = this.leftH() + 3 + h;
      return { x, y: Math.max(1, Math.floor((this.size.h - total) / 2)) + this.leftH() + 3, w, h };
    }
    return { x: Math.max(0, this.size.w - w - 4), y: Math.max(2, Math.floor((this.size.h - h) / 2)), w, h };
  }

  leftRect(): Rect {
    const h = this.leftH();
    if (this.narrow) {
      const w = this.panelW();
      const total = h + 3 + INV_COMPACT_H;
      return { x: Math.floor((this.size.w - w) / 2), y: Math.max(1, Math.floor((this.size.h - total) / 2)), w, h };
    }
    const w = this.leftW();
    const r = this.rightRect();
    return { x: Math.max(0, Math.min(4, r.x - w - 4)), y: r.y, w, h };
  }

  /** A left window's width on a wide screen: the skill panel's at ten feet as wide as the room beside the bag allows (its rows in the normal font), else the bag's. */
  private leftW(): number {
    const w = this.panelW();
    return this.left === 'skills' && this.tenFoot() ? Math.max(w, Math.min(SKILLS_WIDE_W, this.size.w - PANEL_W - 12)) : w;
  }

  /** Left edge of a 12-cell grid inside a window of width w. */
  private gridX(r: Rect): number {
    return r.x + Math.floor((r.w - 12 * CELL) / 2);
  }

  inventoryGridOrigin(): { x: number; y: number } {
    const r = this.rightRect();
    return { x: this.gridX(r), y: r.y + (this.compact() ? HEADER + 2 : this.short() ? SHORT_BAG_Y : BAG_Y) };
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

  /** The title bar's "Gems" button (as wide as its word needs), left of the close box. */
  private skillsButton(): Rect {
    const r = this.rightRect();
    const w = Math.max(32, textWidth(t('item.ui.gems')) + 4);
    return { x: r.x + r.w - 17 - w, y: r.y + 3, w, h: 11 };
  }

  /** The active socket (link −1) or a support link of a skill slot. */
  socketRect(slot: number, link: number): Rect {
    const r = this.leftRect();
    const y = r.y + HEADER + 2 + slot * 21;
    const x = r.x + this.skillInset();
    if (link < 0) return { x: x + 10, y: y + 1, w: 18, h: 18 };
    return { x: x + 31 + link * 13, y: y + 4, w: 12, h: 12 };
  }

  /** How far right the skill panel's sockets and text sit at ten feet (its wider window): the pad's focus round a skill's gem clear of its slot number. */
  private skillInset(): number {
    return this.left === 'skills' && this.leftW() > PANEL_W ? 3 : 0;
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
    const c = this.canvas;
    if (!c) return { x: -1, y: -1 }; // headless: no page
    const r = c.getBoundingClientRect();
    return { x: r.left + ((x + 0.5) / this.size.w) * r.width, y: r.top + ((y + 0.5) / this.size.h) * r.height };
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

  /** The left window has tabs to switch (the stash's, the vendor's when it sells more than one kind). */
  tabbed(): boolean {
    return this.left === 'stash' || (this.left === 'vendor' && this.vendorTabs().length > 1);
  }

  /**
   * Where the shell's button legend goes (ui/legend.ts: the row's centre and glyph row, art
   * pixels; `w` its width, plate included): under the windows, else over them, centred on them,
   * clear of `avoid` (the HUD's orbs, bar and minimap); slid along its row beside what is in the
   * way when centred it isn't; where nothing is clear (a small screen with a boss's bar and the
   * level's card up), over as little of the HUD as it can. Null without room for its row.
   */
  legendAt(w = 0, avoid: readonly (Rect & { readonly weight?: number })[] = []): { x: number; y: number } | null {
    const rs = this.rects();
    if (!rs.length) return null;
    const left = Math.min(...rs.map((r) => r.x));
    const right = Math.max(...rs.map((r) => r.x + r.w));
    const top = Math.min(...rs.map((r) => r.y));
    const bottom = Math.max(...rs.map((r) => r.y + r.h));
    const cx = Math.round((left + right) / 2);
    const rows: number[] = [];
    if (bottom + 4 + 9 <= this.size.h) rows.push(bottom + 4); // its plate: 2 rows above the glyphs, 9 below
    if (top - 11 >= 2) rows.push(top - 10);
    if (!rows.length) return null;
    const half = Math.ceil(w / 2);
    // the plate centred on x (drawLegend keeps it on screen); how much of the HUD it covers (a window: never)
    const plateX = (x: number) => Math.max(2, Math.min(this.size.w - 2 - w, x - half));
    const cover = (x: number, y: number): number => {
      const r = { x: plateX(x), y: y - 2, w, h: 11 };
      const area = (b: Rect) => Math.max(0, Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x)) * Math.max(0, Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y));
      return rs.some((b) => area(b) > 0) ? Infinity : avoid.reduce((sum, b) => sum + area(b) * (b.weight ?? 1), 0);
    };
    // centred first, then beside each thing in the way, the nearest the centre first; the first clear spot, else the least covered
    const xs = [cx, ...avoid.flatMap((b) => [b.x - 1 - half, b.x + b.w + 1 + half])].sort((a, b) => Math.abs(a - cx) - Math.abs(b - cx));
    let best: { x: number; y: number; cover: number } | null = null;
    for (const y of rows)
      for (const x of xs) {
        const c = cover(x, y);
        if (c === 0) return { x: plateX(x) + half, y };
        if (!best || c < best.cover) best = { x: plateX(x) + half, y, cover: c };
      }
    return best && best.cover < Infinity ? { x: best.x, y: best.y } : { x: cx, y: rows[0]! };
  }

  // ---------------------------------------------------------------- pointer input

  /**
   * The pointer this frame from `ctx.input`: each button pressed or let go where it was
   * (`buttonEvents`: a drag shorter than a frame still starts where it started), then where it
   * is now. In art pixels: the canvas is the art resolution.
   */
  private pollPointer(): void {
    if (this.opts.hosted) return; // the shell hands this view its pointer events (`handle`)
    const input = this.ctx.input;
    const toArt = (x: number, y: number) => ({ x: Math.min(this.size.w - 1, Math.max(0, Math.floor(((x + 1) / 2) * this.size.w))), y: Math.min(this.size.h - 1, Math.max(0, Math.floor(((1 - y) / 2) * this.size.h))) });
    const moveTo = (x: number, y: number, touch: boolean) => {
      const at = toArt(x, y);
      if (at.x === this.pointerAt.x && at.y === this.pointerAt.y) return;
      this.pointerAt = at;
      if (this.isOpen) this.onMove(at, touch);
    };
    const { ctrl, shift } = this.mods();
    for (const e of input.buttonEvents) {
      const button = e.code === 'MouseRight' ? 2 : e.code === 'MouseLeft' || e.code === 'Touch' ? 0 : -1;
      if (button < 0) continue;
      const touch = e.code === 'Touch';
      moveTo(e.x, e.y, touch);
      if (!e.down) this.onUp(this.pointerAt, button);
      else if (this.isOpen) this.onDown(this.pointerAt, { button, touch, ctrl, shift });
    }
    if (input.pointer.over) moveTo(input.pointer.x, input.pointer.y, input.pointer.touch);
  }

  /** Ctrl and Shift held, or pressed since the last frame: a Ctrl-click shorter than a frame keeps its Ctrl. */
  private mods(): { ctrl: boolean; shift: boolean } {
    const input = this.ctx.input;
    const mod = (...codes: string[]) => input.isDown(...codes) || input.wasPressed(...codes);
    return { ctrl: mod('ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight'), shift: mod('ShiftLeft', 'ShiftRight') };
  }

  private onDown(p: { x: number; y: number }, e: { button: number; touch: boolean; ctrl: boolean; shift: boolean }): void {
    this.cursor = { ...p };
    this.cursorMode = 'pointer';
    const touch = e.touch;
    this.lastTouch = touch;
    this.downAt = { x: p.x, y: p.y, t: this.time, touch, moved: false, picked: false };
    this.longPressed = false;
    if (touch) {
      // on a picked item's tooltip taller than the screen: a drag scrolls it
      const laid = this.pickLayout();
      if (laid && laid.max > 0 && inside(laid.shown, p.x, p.y)) this.downAt.scroll = this.tipScroll;
      return; // taps resolve on pointerup (long-press = right-click)
    }
    if (e.button === 2) this.secondary(p.x, p.y);
    else if (e.button === 0) {
      const had = !!this.held;
      this.primary(p.x, p.y, { ctrl: e.ctrl, shift: e.shift });
      this.downAt.picked = !had && !!this.held;
    }
  }

  private onMove(p: { x: number; y: number }, touch: boolean): void {
    this.cursor = { ...p };
    this.cursorMode = 'pointer';
    this.lastTouch = touch;
    const d = this.downAt;
    if (d && Math.hypot(p.x - d.x, p.y - d.y) > 3) d.moved = true;
    // a finger's drag on a tall tooltip: its lines follow the finger (pulled up, the last ones come into view)
    if (d?.scroll !== undefined && d.moved) this.tipScroll = Math.max(0, Math.min(this.pickLayout()?.max ?? 0, d.scroll + d.y - p.y));
  }

  private onUp(p: { x: number; y: number }, button: number): void {
    const d = this.downAt;
    this.downAt = null;
    if (!d) return;
    this.cursor = { ...p };
    if (d.touch) {
      // a drag that scrolled the tooltip lets go: no tap where it ended
      if (!this.longPressed && !(d.scroll !== undefined && d.moved)) this.tap(p.x, p.y);
      return;
    }
    // Drag and drop: an item picked up on this press and released somewhere else lands there.
    if (button === 0 && d.picked && d.moved && this.held) this.primary(p.x, p.y, { ctrl: false, shift: false });
  }

  /** Touch tap: the first tap on an item shows its tooltip, a second tap acts (empty cells and buttons act at once). */
  tap(x: number, y: number): void {
    // a button of the picked item's action row does what it says, on the item where it was picked
    const act = this.touchActions().find((a) => inside(a.rect, x, y));
    if (act) return this.touchAct(act.id);
    const t = this.hit(x, y);
    const item = this.held || this.applying ? null : this.itemAtTarget(t);
    if (item && this.touchPick !== item.uid && t?.kind !== 'bench') {
      this.touchPick = item.uid;
      this.touchAt = { x, y };
      this.tipScroll = 0;
      this.ctx.audio.play('loot-pickup', { volume: 0.25 });
      return;
    }
    this.touchPick = null;
    this.touchAt = null;
    this.primary(x, y, { ctrl: false, shift: false });
  }

  /**
   * A finger's picked item, its target where it was tapped: null when nothing is picked (or an item
   * is carried, an orb is being applied, the pad drives the windows).
   */
  private picked(): { item: Item; at: Target; x: number; y: number } | null {
    if (!this.lastTouch || this.cursorMode === 'pad' || this.held || this.applying || !this.touchPick || !this.touchAt) return null;
    const { x, y } = this.touchAt;
    const at = this.hit(x, y);
    const item = at ? this.itemAtTarget(at) : null;
    return at && item && item.uid === this.touchPick ? { item, at, x, y } : null;
  }

  /**
   * What a finger can do with the item it picked, as buttons a thumb can hit (no hidden gestures):
   * `use` the right-click's (Equip, Unequip, Use, Socket, Take out, To bag, Buy), `quick` the
   * Ctrl-click's where it differs (To stash, Sell), `move` the click's (pick it up to put it
   * elsewhere), each as tall as a thumb's target (`tapArt`), placed with its tooltip (`pickLayout`).
   * Pure layout from the windows' state: a replay hits the same buttons.
   */
  touchActions(): { id: 'use' | 'quick' | 'move'; label: string; rect: Rect }[] {
    return this.pickLayout()?.actions ?? [];
  }

  /**
   * A finger's picked item laid out: its tooltip where it was tapped and its action buttons (in
   * rows on a narrow screen) under the tooltip, else over it; with room for neither (a tall
   * tooltip on a phone) the row at the top of the screen and the tooltip moved down under it, its
   * name in view rather than covered by the buttons. Never over each other, nor over a window's
   * title bar (its close box: a row slides beside it along its line, else goes under it). `tip` is
   * the whole tooltip, `shown` the part on screen: one taller than the screen shows what fits and
   * scrolls by `max` rows at most (a finger's drag on it: `tipScroll`).
   */
  private pickLayout(): { item: Item; at: Target; lines: TipLine[]; tip: Rect; shown: Rect; max: number; actions: { id: 'use' | 'quick' | 'move'; label: string; rect: Rect }[] } | null {
    const laid = this.pickPlace();
    if (!laid) return null;
    const { tip } = laid;
    const shown = { ...tip, h: Math.max(0, Math.min(tip.h, this.size.h - 1 - tip.y)) };
    return { ...laid, shown, max: tip.h - shown.h };
  }

  /** The picked item's tooltip and its buttons placed (`pickLayout` adds how much of the tooltip is on screen). */
  private pickPlace(): { item: Item; at: Target; lines: TipLine[]; tip: Rect; actions: { id: 'use' | 'quick' | 'move'; label: string; rect: Rect }[] } | null {
    const p = this.picked();
    if (!p) return null;
    const { item, at } = p;
    const lines = this.tipLines(item, at);
    const tip = this.tipRect(lines, p.x, p.y);
    const acts: { id: 'use' | 'quick' | 'move'; label: string }[] = [];
    const inBag = at.kind === 'grid' && at.where === 'inventory';
    const use =
      at.kind === 'slot'
        ? 'item.act.unequip'
        : at.kind === 'vendor'
          ? 'item.act.buy'
          : at.kind === 'socket'
            ? 'item.act.take_out'
            : at.kind === 'grid' && !inBag
              ? 'item.act.to_bag'
              : inBag && itemClass(item) === 'currency'
                ? 'item.act.use'
                : inBag && isGem(item)
                  ? this.left === 'skills'
                    ? 'item.act.socket'
                    : null
                  : inBag && isEquipment(item) && this.left !== 'bench'
                    ? 'item.act.equip'
                    : null;
    if (use) acts.push({ id: 'use', label: t(use) });
    if (inBag && this.left === 'stash') acts.push({ id: 'quick', label: t('item.act.to_stash') });
    if (inBag && this.left === 'vendor') acts.push({ id: 'quick', label: t('item.act.sell') });
    if (at.kind !== 'vendor' && this.left !== 'bench') acts.push({ id: 'move', label: t('item.act.move') });
    if (!acts.length) return { item, at, lines, tip, actions: [] };
    const h = Math.max(14, tapArt(this.ctx.engine.renderer));
    const gap = 3;
    const room = this.size.w - 2;
    // as wide as two thumbs each, else as wide as its word; rows of as many as fit (a phone in portrait)
    const roomy = acts.map((a) => Math.max(h * 2, textWidth(a.label) + 12));
    const widths = roomy.reduce((s, w) => s + w, 0) + gap * (acts.length - 1) <= room ? roomy : acts.map((a) => Math.min(room, textWidth(a.label) + 10));
    const rows: number[][] = [];
    let used = room + 1;
    widths.forEach((w, i) => {
      if (used + gap + w > room) {
        rows.push([]);
        used = -gap;
      }
      rows[rows.length - 1]!.push(i);
      used += gap + w;
    });
    const tall = rows.length * h + (rows.length - 1) * gap;
    const totals = rows.map((row) => row.reduce((s, i) => s + widths[i]!, 0) + gap * (row.length - 1));
    // never over a window's title bar either (its close box, the Gems button, where a swipe down
    // closes them): each row slides along its line beside the bars it would cover
    const bars = this.rects().map((b) => ({ x: b.x, y: b.y, w: b.w, h: HEADER }));
    /** Where a row `total` wide at `ry` goes along: centred on the tooltip, else the nearest spot beside the bars clear of them and of the tooltip; null with none. */
    const along = (total: number, ry: number, tipAt: Rect): number | null => {
      const centre = Math.max(1, Math.min(this.size.w - total - 1, Math.round(tipAt.x + tipAt.w / 2 - total / 2)));
      const xs = [centre, ...bars.flatMap((b) => [b.x - total - 1, b.x + b.w + 1])].filter((x) => x >= 1 && x + total <= this.size.w - 1);
      xs.sort((p, q) => Math.abs(p - centre) - Math.abs(q - centre));
      return xs.find((x) => ![...bars, tipAt].some((b) => overlaps({ x, y: ry, w: total, h }, b))) ?? null;
    };
    // the lines it may take, in order: under the tooltip; over it; with room for neither (a tall
    // tooltip on a phone) at the top, the tooltip under it; else under a title bar, the tooltip
    // under the row where they would meet
    const spots: { y: number; tipY: number }[] = [];
    const under = tip.y + tip.h + 2;
    if (under + tall <= this.size.h - 1) spots.push({ y: under, tipY: tip.y });
    else if (tip.y - tall - 2 >= 1) spots.push({ y: tip.y - tall - 2, tipY: tip.y });
    else spots.push({ y: 1, tipY: Math.max(tip.y, 1 + tall + 2) });
    for (const b of bars) {
      const y = b.y + b.h + 1;
      if (y + tall <= this.size.h - 1) spots.push({ y, tipY: y + tall + 2 > tip.y && y < tip.y + tip.h + 2 ? y + tall + 2 : tip.y });
    }
    let line = spots[0]!;
    let xs: (number | null)[] = [];
    for (const l of spots) {
      const tipAt = { ...tip, y: l.tipY };
      const found = totals.map((total, r) => along(total, l.y + r * (h + gap), tipAt));
      if (!found.includes(null)) {
        line = l;
        xs = found;
        break;
      }
    }
    const y = line.y;
    tip.y = line.tipY;
    const actions: { id: 'use' | 'quick' | 'move'; label: string; rect: Rect }[] = [];
    rows.forEach((row, r) => {
      const total = totals[r]!;
      let x = xs[r] ?? Math.max(1, Math.min(this.size.w - total - 1, Math.round(tip.x + tip.w / 2 - total / 2)));
      for (const i of row) {
        actions.push({ ...acts[i]!, rect: { x, y: y + r * (h + gap), w: widths[i]!, h } });
        x += widths[i]! + gap;
      }
    });
    return { item, at, lines, tip, actions };
  }

  /** A button of the picked item's action row (`touchActions`), on the item where it was picked. */
  private touchAct(id: 'use' | 'quick' | 'move'): void {
    const p = this.picked();
    this.touchPick = null;
    this.touchAt = null;
    if (!p) return;
    if (id === 'use') this.secondary(p.x, p.y);
    else if (id === 'quick') this.quick(p.at);
    else this.primary(p.x, p.y, { ctrl: false, shift: false });
  }

  /**
   * A swipe (the shell's) closes the windows when it starts on a window's title bar, sideways or
   * down as every framed panel's does (where no item can be dragged), and not on a picked item's
   * tooltip over the bar (a drag there scrolls it); elsewhere a quick drag moves an item, never
   * closes them.
   */
  swipeCloses(dir: 'left' | 'right' | 'up' | 'down', x: number, y: number): boolean {
    if (dir === 'up') return false;
    const tip = this.pickLayout()?.shown;
    if (tip && inside(tip, x, y)) return false;
    return this.rects().some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + HEADER);
  }

  // ---------------------------------------------------------------- keys / pad (hosted)

  /**
   * A UiEvent from the shell (keys, pad, the pointer: hosted, these drive it). Returns true when
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
        // X / Square and V / Triangle are the windows' own (a page key, H: the shell's)
        if (!['KeyX', 'PadX', 'KeyV', 'PadY'].includes(e.code)) return false;
        const cx = Math.floor(this.cursor.x);
        const cy = Math.floor(this.cursor.y);
        if (this.cursorMode !== 'pad') this.padStart();
        else if (e.code === 'KeyX' || e.code === 'PadX') this.secondary(cx, cy);
        else if (e.code === 'KeyV' || e.code === 'PadY') this.primary(cx, cy, { ctrl: true, shift: false });
        return true;
      }
      case 'pointer': {
        const at = { x: e.x, y: e.y };
        const touch = !!e.touch;
        if (e.type === 'move') this.onMove(at, touch);
        else if (e.type === 'down') this.onDown(at, { button: e.button ?? 0, touch, ...this.mods() });
        else this.onUp(at, e.button ?? 0);
        return this.covers(e.x, e.y);
      }
      case 'wheel':
        // over the item whose tooltip is taller than the screen (the tooltip beside its window): it scrolls
        return this.scrollTip(e.dy * TIP_WHEEL) || this.covers(this.cursor.x, this.cursor.y);
      case 'swipe':
        return false; // dragging items: a quick drag is not a dismissal
    }
  }

  /** Keys / pad take over: the cursor lands on something useful. */
  private padStart(): void {
    this.cursorMode = 'pad';
    if (this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y))?.kind !== 'panel' && this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y))) return;
    this.cursor = this.padHome();
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
    } else if (this.left === 'skills' || this.left === null) this.toggleSkills();
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
    this.altHeld = input.isDown('AltLeft', 'AltRight');
    if (this.isOpen && this.ctx.engine.controls.device !== this.deviceSeen) this.followDevice();
    this.pollPointer();
    if (!this.opts.hosted && this.isOpen && input.wasPressed('Escape')) this.closeAll();
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
        // the pad's buttons (`GAMEPAD_BUTTONS`): A (Cross) clicks, X (Square) right-clicks, Y (Triangle) Ctrl-clicks, B (Circle) closes
        if (input.wasPressed('PadA')) this.primary(cx, cy, { ctrl: false, shift: false });
        if (input.wasPressed('PadX')) this.secondary(cx, cy);
        if (input.wasPressed('PadY')) this.primary(cx, cy, { ctrl: true, shift: false });
        if (input.wasPressed('PadB')) this.closeAll();
      }
    }
    // the right stick scrolls a pad's or a mouse's tooltip taller than the screen (tilted down: its
    // last lines come up), the wheel too standalone (hosted: the shell's `wheel` events, `handle`),
    // its tick then the tooltip's alone (the camera's zoom reads it after); both recorded input
    // (`look`, `wheel`), so a replay scrolls the same
    // (a tooltip shows from its top each time: the focus or the mouse left the item it scrolled)
    if (this.tipRead.key && this.tipRead.key !== this.cursorTipAt()?.key) this.tipRead = { key: '', scroll: 0 };
    if (this.isOpen && input.lookAxis.y) this.scrollTip(-input.lookAxis.y * TIP_STICK * dt);
    if (this.isOpen && !this.opts.hosted && input.wheel && this.scrollTip(input.wheel * TIP_WHEEL)) input.wheel = 0;
    // a finger let go where these windows didn't hear it (another panel over them): no long-press
    if (this.downAt?.touch && !input.isDown('Touch')) this.downAt = null;
    const d = this.downAt;
    // (a finger held on a tall tooltip is reading or about to scroll it: no long-press on what is under it)
    if (d?.touch && !d.moved && d.scroll === undefined && !this.longPressed && this.time - d.t > 0.45) {
      this.longPressed = true;
      this.touchPick = null;
      this.touchAt = null;
      this.secondary(d.x, d.y);
    }
    if (this.message && this.time - this.messageTime > 2.5) this.message = null;
    this.paint();
  }

  // ---------------------------------------------------------------- actions

  private say(message: ItemsMessage, sound: 'loot-deny' | null = 'loot-deny'): void {
    this.message = message;
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
      this.toggleSkills();
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
      } else if (item) this.say(itemClass(item) === 'currency' ? { id: 'item.say.pick_orb' } : why({ id: 'equipment_only' }));
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
      else this.say(why(r.reason));
    } else if (t.kind === 'vendor') this.buyAt(t);
    else if (t.kind === 'socket') this.unsocket(t);
    else if (t.kind === 'grid' && t.where !== 'inventory') {
      const r = transfer(s, item.uid, t.where, 'inventory');
      if (r.ok) this.commit(r.value);
      else this.say(why(r.reason));
    } else if (t.kind === 'grid') {
      if (itemClass(item) === 'currency') {
        if (this.left === 'bench' && this.benchTarget()) return this.benchOrb(item.base);
        this.applying = item.uid;
        // the next item clicked gets it: with the pad cursor, Cross (A) on it
        this.say(this.cursorMode === 'pad' ? { id: 'item.say.apply_orb_pad', values: { orb: itemName(item) }, pad: 'PadA' } : { id: 'item.say.apply_orb', values: { orb: itemName(item) } }, null);
      } else if (isGem(item)) {
        if (this.left !== 'skills') return this.say({ id: 'item.say.open_skills' });
        const ref = autoSocket(this.store.skills, item, this.skillSlot);
        if (!ref) return this.say({ id: 'item.say.no_free_link', values: { slot: this.skillSlot + 1 } });
        this.socketFromBag(item, ref);
      } else if (isEquipment(item)) {
        const r = equip(s, item.uid, this.store.heroLevel);
        if (r.ok) this.commit(r.value);
        else this.say(why(r.reason));
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
        else this.say(why(r.reason));
      } else if (this.left === 'vendor') {
        const r = sell(s, item.uid);
        if (r.ok) this.commit(r.value.state, 'loot-gold');
        else this.say(why(r.reason));
      } else if (this.left === 'skills' && isGem(item)) {
        const ref = autoSocket(this.store.skills, item, this.skillSlot);
        if (ref) this.socketFromBag(item, ref);
      }
    } else if (t.kind === 'grid') {
      const r = transfer(s, item.uid, t.where, 'inventory');
      if (r.ok) this.commit(r.value);
      else this.say(why(r.reason));
    } else if (t.kind === 'vendor') this.buyAt(t);
    else if (t.kind === 'slot') {
      const r = unequip(s, t.slot);
      if (r.ok) this.commit(r.value);
      else this.say(why(r.reason));
    } else if (t.kind === 'socket') this.unsocket(t);
  }

  private buyAt(t: Target): void {
    const item = this.itemAtTarget(t);
    if (!item) return;
    const r = buy(this.store.state, this.store.vendor.stock, item.uid);
    if (!r.ok) return this.say(why(r.reason));
    this.store.vendor = { ...this.store.vendor, stock: r.value.stock };
    this.commit(r.value.state, 'loot-gold');
  }

  /** A gem from the bag into a socket; whatever was there goes back into the bag. */
  private socketFromBag(item: Item, ref: { slot: number; link: number }): void {
    const blocked = socketBlocker(item, ref);
    if (blocked) return this.say(why(blocked));
    const need = requiredLevel(item);
    if (need > this.store.heroLevel) return this.say(why({ id: 'requires_level', values: { level: need } }));
    const s = this.store.state;
    const r = setSocket(this.store.skills, ref, item);
    let inv = removeItem(s.inventory, item.uid);
    if (r.displaced) {
      const a = addItem(inv, r.displaced);
      if (a.rest) return this.say(why({ id: 'inventory_full' }));
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
    if (a.rest) return this.say(why({ id: 'inventory_full' }));
    const r = setSocket(this.store.skills, t, null);
    this.store.setSkills(r.sockets, { ...this.store.state, inventory: a.grid });
    this.ctx.audio.play('loot-pickup');
  }

  private noteSupport(socket: (typeof this.store.skills)[number], item: Item): void {
    if (item.gem?.support && supportApplies(socket, item) === false)
      this.say(socket.gem ? { id: 'item.say.not_supported', values: { support: itemName(item), skill: itemName(socket.gem) } } : { id: 'item.say.not_supported_here', values: { support: itemName(item) } }, null);
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
      if (!r.ok) return this.say(why(r.reason));
      const swapped = r.value.swapped;
      this.held = swapped ? { item: swapped, origin: held.origin } : null;
      this.commit(setGrid(s, t.where, r.value.grid));
    } else if (t.kind === 'slot') {
      const r = equipItem(s.equipment, held.item, t.slot, this.store.heroLevel);
      if (!r.ok) return this.say(why(r.reason));
      const [first, ...rest] = r.value.displaced;
      let inv = s.inventory;
      for (const d of rest) {
        const a = addItem(inv, d);
        if (a.rest) return this.say(why({ id: 'inventory_full' }));
        inv = a.grid;
      }
      this.held = first ? { item: first, origin: { kind: 'slot', slot: t.slot } } : null;
      this.commit({ ...s, inventory: inv, equipment: r.value.equipment });
    } else if (t.kind === 'socket') {
      const blocked = socketBlocker(held.item, t);
      if (blocked) return this.say(why(blocked));
      const need = requiredLevel(held.item);
      if (need > this.store.heroLevel) return this.say(why({ id: 'requires_level', values: { level: need } }));
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
    if (!target) return this.say({ id: 'item.say.bench_first' });
    const orb = this.store.state.inventory.items.find((p) => p.item.base === base)?.item;
    if (!orb) return this.say({ id: 'item.say.no_orb', values: { orb: currencyName(base) } });
    this.useOrb(orb, target);
  }

  /** Apply one `orb` (an inventory stack) to `target` (in the bag or equipped). True when it worked. */
  private useOrb(orb: Item, target: Item): boolean {
    const r = applyCurrency(this.store.rng, orb.base, target);
    if (!r.ok) {
      this.say(why(r.reason));
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
    this.say(r.note ? { id: `item.craft.${r.note}` } : { id: 'item.say.orb_used', values: { orb: currencyName(orb.base) } }, null);
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
      if (c && c.style.display !== 'none') c.style.display = 'none';
      this.drawnKey = '';
      return;
    }
    this.size = { w: res.width, h: res.height };
    if (!c) return; // headless: the layout follows the view; nothing to paint
    // device pixels per art pixel: the screen's resolution while device text shows (as the engine's Hud)
    const k = surfaceScale(f.scale, this.deviceText);
    if (c.width !== res.width * k || c.height !== res.height * k) {
      c.width = res.width * k;
      c.height = res.height * k;
      this.drawnKey = '';
    }
    Object.assign(c.style, { display: '', width: `${f.cssWidth}px`, height: `${f.cssHeight}px`, left: `${f.offsetX}px`, top: `${f.offsetY}px` });
    const sheet = this.sheet();
    const key = `${this.store.version}|${this.inventoryOpen}|${this.left}|${this.stashTab}|${this.store.vendor.kind}|${Math.floor(this.cursor.x)},${Math.floor(this.cursor.y)}|${this.held?.item.uid}|${this.applying}|${this.benchItem}|${this.skillSlot}|${this.touchPick}|${this.tipScroll}|${this.tipRead.key}:${Math.floor(this.tipRead.scroll)}|${this.hoverOrb}|${this.altHeld}|${this.message ? JSON.stringify(this.message) : ''}|${this.said ? JSON.stringify(this.said) : ''}|${this.cursorMode}|${this.ctx.engine.controls.style}|${this.ctx.engine.controls.device}|${this.store.heroLevel}|${sheet?.version}|${c.width}x${c.height}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(k, 0, 0, k, 0, 0); // art pixels: k×k device pixels each
    const p = canvasPainter(g, k);
    this.drawOn(p);
    // text in the device's font came (or went): paint again at the resolution it needs
    if (p.device !== this.deviceText) {
      this.deviceText = p.device;
      if (surfaceScale(f.scale, p.device) !== k) {
        this.drawnKey = '';
        this.paint();
      }
    }
  }

  /**
   * The open windows, the focus, a tooltip and the message drawn on any Painter, in art pixels: the
   * page's canvas (`paint`), or a tool's or a test's (headless nothing is painted).
   */
  drawOn(p: Painter): void {
    if (!this.isOpen) return;
    if (this.inventoryOpen) this.drawInventory(p);
    if (this.left) this.drawLeft(p);
    this.drawCursor(p);
    if (this.message) {
      const lines = wrap(this.message.text ?? messageText(this.message, this.ctx.engine.controls.style), this.size.w - 10);
      const w = Math.max(...lines.map(textWidth)) + 8;
      const h = lines.length * 9 + 4;
      const x = Math.floor((this.size.w - w) / 2);
      const y = this.size.h - h - 3;
      panel(p, x, y, w, h, UI.panelEdge);
      lines.forEach((l, i) => p.text(x + 4, y + 3 + i * 9, l, UI.text));
    }
    // a townsperson's line on top (the shell lays it out: `talkPlace`)
    if (this.said) {
      const { x, y, w, h } = this.said.box;
      panel(p, x, y, w, h, UI.panelEdge);
      this.said.rows.forEach((l, i) => p.text(x + 5, y + 4 + i * 9, l, UI.text));
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
    shadowText(p, x + 6, y + 5, title, UI.title);
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
    const gi = item.gem ? gemIcon(item.gem.id, item.gem.support) : null;
    if (gi) drawGemIcon(p, gi, x + 1, y + 1, w - 2, h - 2);
    else drawIcon(p, baseOf(item).look ?? baseOf(item).slot, x + 1, y + 1, w - 2, h - 2, colour, CURRENCY.has(item.base) ? currencyShort(item.base) : undefined);
    outline(p, x, y, w, h, item.rarity === 'normal' && itemClass(item) === item.rarity ? UI.cellEdge : colour);
    if ((item.quantity ?? 1) > 1) shadowText(p, x + 1, y + 1, lang().formatNumber(item.quantity ?? 1), PALETTE.white);
    if (item.gem && h >= 16) shadowText(p, x + 1, y + h - 8, lang().formatNumber(item.gem.level), PALETTE.white);
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
    this.frame(p, r, t(compact ? 'item.window.bag' : 'item.window.inventory'));
    if (!compact) {
      if (this.left === null || this.left === 'skills') {
        const b = this.skillsButton();
        const on = this.left === 'skills';
        const label = t('item.ui.gems');
        p.rect(b.x, b.y, b.w, b.h, on ? PALETTE.sand : PALETTE.slate);
        p.text(b.x + Math.floor((b.w - textWidth(label)) / 2), b.y + 2, label, on ? PALETTE.ink : PALETTE.white);
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
    const gold = goldLabel(this.store.state.gold);
    shadowText(p, r.x + 5, by, gold, UI.gold);
    const lvl = t('item.ui.level', { level: this.store.heroLevel });
    // the level gives way to the gold when a language's words leave no room for both (the HUD shows it too)
    if (textWidth(gold) + 6 + textWidth(lvl) <= r.w - 10) p.text(r.x + r.w - 5 - textWidth(lvl), by, lvl, UI.dim);
  }

  private drawLeft(p: Painter): void {
    const r = this.leftRect();
    const titles = this.opts.titles ?? {};
    const title =
      this.left === 'stash'
        ? (titles.stash ?? t('item.window.stash'))
        : this.left === 'vendor'
          ? (titles.vendor ?? t(this.store.vendor.kind === 'gems' ? 'item.window.gem_vendor' : 'item.window.smith'))
          : this.left === 'bench'
            ? (titles.bench ?? t('item.window.bench'))
            : (titles.skills ?? t('item.window.skills'));
    this.frame(p, r, title);
    if (this.left === 'skills') return this.drawSkills(p, r);
    if (this.left === 'bench') return this.drawBench(p, r);
    if (this.left === 'stash') {
      for (let i = 0; i < STASH_TABS; i++) {
        const tr = this.tabRect(i);
        p.rect(tr.x, tr.y, tr.w, tr.h, i === this.stashTab ? UI.panelEdge : UI.cell);
        p.text(tr.x + 4, tr.y + 3, lang().formatNumber(i + 1), i === this.stashTab ? UI.title : UI.dim);
      }
    } else {
      this.vendorTabs().forEach((tab, i) => {
        const tr = this.tabRect(i);
        const on = tab.kind === this.store.vendor.kind;
        const label = t(tab.label);
        p.rect(tr.x, tr.y, tr.w, tr.h, on ? UI.panelEdge : UI.cell);
        p.text(tr.x + Math.floor((tr.w - textWidth(label)) / 2), tr.y + 3, label, on ? UI.title : UI.dim);
      });
      const hint = this.vendorHint();
      if (hint.mini) miniText(p, r.x + 5, r.y + r.h - 10, hint.rows[0]!, PALETTE.mist);
      else hint.rows.forEach((l, i) => p.text(r.x + 5, r.y + VENDOR_H - 11 + i * 9, l, PALETTE.mist));
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
      const tx = r.x + 72 + this.skillInset();
      const tw = r.x + r.w - 3 - tx;
      // the mini font only in a phone's compact layouts: at ten feet the normal font (a wider window)
      const mini = !this.tenFoot();
      if (n) {
        const cost = n.channel ? t('item.skill.row_channel', { cost: num(n.cost) }) : t(n.cooldown > 0 ? 'item.skill.row_cost_cooldown' : 'item.skill.row_cost', { cost: num(n.cost), cooldown: num(n.cooldown) });
        rowText(p, tx, row.y, tw, mini, n.name, on ? PALETTE.white : PALETTE.mist, cost, PALETTE.sky);
        if (n.unsupported.length) p.rect(r.x + r.w - 5, row.y + 11, 2, 5, PALETTE.red);
      } else rowText(p, tx, row.y, tw, mini, t('item.skill.empty'), PALETTE.slate);
    }
    // details of the selected slot: a pocket `npm run combat -- dps`
    const top = r.y + HEADER + 2 + SKILL_SLOTS * 21 + 1;
    p.rect(r.x + 4, top, r.w - 8, 1, PALETTE.slate);
    const lines = this.skillLines(nums[this.skillSlot] ?? null, r.w - 10, this.store.skills[this.skillSlot]?.gem ?? null).flatMap((l) => wrap(l.text, r.w - 10).map((text) => ({ text, color: l.color })));
    lines.slice(0, 6).forEach((l, i) => p.text(r.x + 5, top + 4 + i * 9, l.text, l.color));
  }

  /**
   * The detail lines for one slot (also the skill panel's test surface), whole: the panel wraps
   * them. `width` (art pixels) decides whether the gem's XP fits on the title line.
   */
  skillLines(n: SkillNumbers | null, width = 118, gem: Item | null = null): { text: string; color: number }[] {
    if (!n) return [{ text: t('item.skill.slot_empty', { slot: this.skillSlot + 1 }), color: UI.dim }, { text: this.hint('item.skill.hint', 'PadX'), color: PALETTE.slate }];
    // the gem's XP toward its next level when it fits on the title line
    const prog = gem ? gemProgress(gem, this.store.heroLevel) : null;
    const name = { name: n.name, level: n.level };
    const title = t('item.skill.title', name);
    const withXp = !prog
      ? title
      : prog.max
        ? t('item.skill.title_max', name)
        : prog.waiting
          ? t('item.skill.title_waits', { ...name, hero: prog.nextReq ?? 0 })
          : t('item.skill.title_xp', { ...name, percent: lang().formatNumber(Math.floor(prog.fraction * 100) / 100, { style: 'percent' }) });
    const out: { text: string; color: number }[] = [{ text: textWidth(withXp) <= width ? withXp : title, color: UI.title }];
    if (n.hit > 0) {
      out.push({ text: t('item.skill.hit', { hit: num(n.hit), type: n.types[0] ? damageName(n.types[0]) : '' }).trim(), color: PALETTE.white });
      out.push({ text: t('item.skill.dps', { dps: num(n.dps), rate: num(n.hitsPerSecond) }), color: PALETTE.lime });
    } else out.push({ text: t('item.skill.no_damage'), color: UI.dim });
    out.push({ text: n.channel ? t('item.skill.cost_channel', { cost: num(n.cost) }) : t(n.cooldown > 0 ? 'item.skill.cost_cooldown' : 'item.skill.cost', { cost: num(n.cost), cooldown: num(n.cooldown) }), color: PALETTE.sky });
    const time = num(n.castTime);
    const shape =
      n.projectiles > 1
        ? t('item.skill.cast_projectiles', { time, count: n.projectiles })
        : n.area !== 1
          ? t('item.skill.cast_area', { time, area: lang().formatNumber(Math.round(n.area * 100) / 100, { style: 'percent' }) })
          : t('item.skill.cast', { time });
    out.push({ text: shape, color: PALETTE.mist });
    if (n.unsupported.length) out.push({ text: t('item.skill.unfit', { count: n.unsupported.length }), color: PALETTE.red });
    else if (n.supports.length) out.push({ text: t('item.skill.supports', { count: n.supports.length }), color: PALETTE.green });
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
    const tw = r.x + r.w - 4 - tx;
    if (target) {
      const s = itemSize(target);
      const scale = Math.min(1, (f.w - 2) / (s.w * CELL), (f.h - 2) / (s.h * CELL));
      const w = Math.max(8, Math.floor(s.w * CELL * scale));
      const h = Math.max(8, Math.floor(s.h * CELL * scale));
      this.drawItem(p, target, f.x + Math.floor((f.w - w) / 2), f.y + Math.floor((f.h - h) / 2), w, h);
      wrap(itemName(target), tw)
        .slice(0, 3)
        .forEach((l, i) => p.text(tx, f.y + 1 + i * 9, l, itemColour(target)));
      // its rarity and affixes, under the name (two rows of the normal font fit above the orbs)
      const summary = t('item.bench.summary', { rarity: rarityName(target.rarity), count: target.affixes.length });
      if (this.narrow && miniCovers(summary) && miniWidth(summary) <= tw) miniText(p, tx, f.y + 30, summary, PALETTE.mist);
      else wrap(summary, tw).slice(0, 2).forEach((l, i) => p.text(tx, f.y + 29 + i * 9, l, PALETTE.mist));
    } else {
      wrap(this.hint('item.bench.hint', 'PadA'), tw)
        .slice(0, 5)
        .forEach((l, i) => p.text(tx, f.y + 1 + i * 9, l, UI.dim));
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
      drawIcon(p, 'orb', o.x + 2, o.y + 1, o.w - 4, o.h - 4, n > 0 && !blocked ? PALETTE.orange : PALETTE.slate, currencyShort(c.id));
      outline(p, o.x, o.y, o.w, o.h, n > 0 && target && !blocked ? PALETTE.sand : UI.cellEdge);
      if (n > 0) shadowText(p, o.x + 1, o.y + 1, lang().formatNumber(n), PALETTE.white);
    });
    // what the hovered orb does (and why it can't)
    const iy = this.orbRect(9).y + 26;
    const lw = r.w - 10;
    if (hovered && CURRENCY.has(hovered)) {
      const c = CURRENCY.get(hovered);
      const lines: { text: string; color: number }[] = [...wrap(currencyName(c.id), lw).map((text) => ({ text, color: UI.title })), ...wrap(currencyDescription(c.id), lw).map((text) => ({ text, color: PALETTE.mist }))];
      const blocked = target ? craftBlocker(c.action, target) : null;
      if (blocked) lines.push(...wrap(reasonText(blocked), lw).map((text) => ({ text, color: PALETTE.red })));
      lines.slice(0, Math.floor((r.y + r.h - 4 - iy) / 9)).forEach((l, i) => p.text(r.x + 5, iy + i * 9, l.text, l.color));
    } else wrap(this.hint('item.bench.orb_hint', 'PadA'), lw).forEach((l, i) => p.text(r.x + 5, iy + i * 9, l, UI.dim));
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
      // a finger's picked item: its tooltip where it was tapped, and its row of action buttons clear of it
      // (else the pad's or the mouse's tooltip); one taller than the screen shows the part on screen,
      // scrolled where a finger's drag left it, or the right stick or the wheel
      const picked = this.pickLayout();
      const at = picked ? null : this.cursorTipLayout();
      const tip = picked ?? at;
      if (tip) drawTooltip(p, tip.tip.x, tip.tip.y, tip.lines, undefined, tip.max > 0 ? { h: tip.shown.h, scroll: at ? this.cursorTipScroll(at) : Math.min(this.tipScroll, tip.max) } : undefined);
      for (const a of picked?.actions ?? []) {
        panel(p, a.rect.x, a.rect.y, a.rect.w, a.rect.h, UI.title);
        shadowText(p, a.rect.x + Math.floor((a.rect.w - textWidth(a.label)) / 2), a.rect.y + Math.floor((a.rect.h - 7) / 2), a.label, PALETTE.white);
      }
    }
    if (this.applying) {
      drawIcon(p, 'orb', cx + 3, cy + 3, 7, 7, UI.dim);
    }
    if (this.cursorMode === 'pad') {
      // the pad's focus, read from the couch: a double white frame round what Cross would press
      // (the item's whole footprint, a slot, a socket, an orb), ink between its lines (`FOCUS`: no
      // item's frame is double, though some skill gems' are white); as wide as the old one, so it
      // covers no more of a socket's slot number or the items beside it
      const r = this.held ? null : this.targetRect(t);
      if (r) {
        outline(p, r.x - 3, r.y - 3, r.w + 6, r.h + 6, FOCUS);
        outline(p, r.x - 2, r.y - 2, r.w + 4, r.h + 4, PALETTE.ink);
        outline(p, r.x - 1, r.y - 1, r.w + 2, r.h + 2, FOCUS);
      } else {
        p.rect(cx - 4, cy - 1, 9, 3, PALETTE.ink);
        p.rect(cx - 1, cy - 4, 3, 9, PALETTE.ink);
        p.rect(cx - 3, cy, 7, 1, FOCUS);
        p.rect(cx, cy - 3, 1, 7, FOCUS);
      }
    }
  }

  /** The box of what the pad cursor is on (an item's whole footprint in a grid), or null where there is nothing to press. */
  focusRect(): Rect | null {
    return this.targetRect(this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y)));
  }

  private targetRect(t: Target | null): Rect | null {
    if (!t) return null;
    const cell = (o: { x: number; y: number }, grid: Grid | null, x: number, y: number): Rect => {
      const placed = grid ? itemAt(grid, x, y) : undefined;
      const s = placed ? itemSize(placed.item) : { w: 1, h: 1 };
      const at = placed ?? { x, y };
      return { x: o.x + at.x * CELL, y: o.y + at.y * CELL, w: s.w * CELL - 1, h: s.h * CELL - 1 };
    };
    switch (t.kind) {
      case 'grid':
        return t.where === 'inventory' ? cell(this.inventoryGridOrigin(), this.store.state.inventory, t.cx, t.cy) : cell(this.leftGridOrigin(), this.leftGrid(), t.cx, t.cy);
      case 'vendor':
        return cell(this.leftGridOrigin(), this.leftGrid(), t.cx, t.cy);
      case 'slot':
        return this.slotRect(t.slot);
      case 'socket':
        return this.socketRect(t.slot, t.link);
      case 'skillrow':
        return this.skillRowRect(t.slot);
      case 'orb':
        return this.orbRect(CURRENCY.all().findIndex((c) => c.id === t.base));
      case 'bench':
        return this.benchFrame();
      case 'button':
        return this.skillsButton();
      case 'tab':
        return this.tabRect(t.index);
      case 'close':
        return this.closeRect(t.panel === 'right' ? this.rightRect() : this.leftRect());
      case 'panel':
        return null;
    }
  }

  /** The item whose tooltip shows at the cursor's target `t` (none while an item is carried; on a touch screen only the one picked). */
  private tipTarget(t: Target | null): { item: Item; at: Target } | null {
    if (this.held || !t) return null;
    const item = this.itemAtTarget(t);
    const touchOk = !this.lastTouch || this.cursorMode === 'pad' || item?.uid === this.touchPick;
    return item && touchOk ? { item, at: t } : null;
  }

  /** The tooltip the cursor shows now, line by line (tools and tests: headless nothing is painted), or null. */
  tipText(): string[] | null {
    const shown = this.tipTarget(this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y)));
    return shown ? this.tipLines(shown.item, shown.at).filter((l) => !l.sep).map((l) => l.text) : null;
  }

  /** A finger's picked item's tooltip as it shows (tools and tests): the lines in view, how far it is scrolled and can be (0: it fits), or null. */
  pickedTip(): { lines: string[]; scroll: number; max: number } | null {
    const laid = this.pickLayout();
    return laid ? tipShown(laid, Math.min(this.tipScroll, laid.max)) : null;
  }

  /** The pad's or the mouse's tooltip as it shows (tools and tests): where on screen, the lines in view, how far it is scrolled and can be (0: it fits), or null. */
  cursorTip(): { rect: Rect; lines: string[]; scroll: number; max: number } | null {
    const laid = this.cursorTipLayout();
    return laid ? { rect: { ...laid.shown }, ...tipShown(laid, this.cursorTipScroll(laid)) } : null;
  }

  /**
   * The tooltip of the item at the pad's focus or under the mouse (none while a finger's picked one
   * shows: `pickLayout`), placed (`tipRect`): `shown` the part on screen, one taller than the screen
   * scrolling by `max` rows at most (the right stick, the wheel: `tipRead`, by `key`, its item's).
   */
  private cursorTipLayout(): { lines: TipLine[]; tip: Rect; shown: Rect; max: number; key: string } | null {
    const at = this.cursorTipAt();
    if (!at) return null;
    const lines = this.tipLines(at.item, at.at);
    const tip = this.tipRect(lines, Math.floor(this.cursor.x), Math.floor(this.cursor.y));
    const shown = { ...tip, h: Math.max(0, Math.min(tip.h, this.size.h - 2 - tip.y)) };
    return { lines, tip, shown, max: tip.h - shown.h, key: at.key };
  }

  /** The item whose tooltip the pad's focus or the mouse shows, where, and its `key` (`tipRead`'s): none while a finger's picked one shows. */
  private cursorTipAt(): { item: Item; at: Target; key: string } | null {
    if (this.picked()) return null;
    const at = this.tipTarget(this.hit(Math.floor(this.cursor.x), Math.floor(this.cursor.y)));
    return at ? { ...at, key: `${at.item.uid}|${at.at.kind}` } : null;
  }

  /** How far the pad's or the mouse's tooltip is scrolled: where the right stick or the wheel left it, if it is that item's (whole rows). */
  private cursorTipScroll(laid: { max: number; key: string }): number {
    return this.tipRead.key === laid.key ? Math.floor(Math.min(this.tipRead.scroll, laid.max)) : 0;
  }

  /** Scroll the pad's or the mouse's tooltip taller than the screen by `rows` (down: its last lines come up). False when none shows. */
  private scrollTip(rows: number): boolean {
    const laid = this.cursorTipLayout();
    if (!laid || laid.max <= 0) return false;
    const from = this.tipRead.key === laid.key ? Math.min(this.tipRead.scroll, laid.max) : 0;
    this.tipRead = { key: laid.key, scroll: Math.max(0, Math.min(laid.max, from + rows)) };
    return true;
  }

  /** An item's tooltip at `at`: its lines, with the price and the hint for the device that drives the windows. */
  private tipLines(item: Item, at: Target): TipLine[] {
    const forSale = at.kind === 'vendor';
    const inInventory = at.kind === 'grid' && at.where === 'inventory';
    const price = forSale ? { kind: 'buy' as const, gold: buyPrice(item), affordable: buyPrice(item) <= this.store.state.gold } : this.left === 'vendor' && inInventory ? { kind: 'sell' as const, gold: sellPrice(item) } : undefined;
    // the control that does it: on a touch screen hold, on a pad Square (X), else the right mouse button
    const button = this.lastTouch && this.cursorMode === 'pointer' ? t('item.button.hold') : this.cursorMode === 'pad' ? padName('PadX', this.ctx.engine.controls.style, lang()) : t('item.button.right_click');
    const hint =
      inInventory && isEquipment(item)
        ? this.left === 'bench'
          ? undefined
          : t('item.hint.equip', { button })
        : inInventory && isGem(item)
          ? this.left === 'skills'
            ? t('item.hint.socket', { button, slot: this.skillSlot + 1 })
            : t('item.hint.socket_panel')
          : at.kind === 'slot'
            ? t('item.hint.unequip', { button })
            : at.kind === 'socket'
              ? t('item.hint.take_out', { button })
              : undefined;
    const width = this.narrow ? Math.max(72, this.size.w - 12) : TIP_W;
    let extra: { text: string; color: number }[] | undefined;
    if (at.kind === 'socket' && at.link < 0) extra = this.skillLines(this.numbers()[at.slot] ?? null, width, item).slice(1);
    else if (at.kind === 'socket') {
      const ok = supportApplies(this.store.skills[at.slot]!, item);
      if (ok === false) extra = [{ text: t('item.tip.not_supported', { skill: itemName(this.store.skills[at.slot]!.gem!) }), color: UI.bad }];
    }
    const orbHint = this.cursorMode === 'pad' ? padOrbHint(this.ctx.engine.controls.style) : undefined;
    return tooltipLines(item, { showTiers: this.altHeld, compare: at.kind === 'slot' ? [] : this.comparison(item), heroLevel: this.store.heroLevel, width, ...(price ? { price } : {}), ...(hint ? { hint } : {}), ...(orbHint ? { orbHint } : {}), ...(extra ? { extra } : {}) });
  }

  /**
   * Where a tooltip of `lines` goes for the cursor at (`cx`, `cy`) (pure: the action row goes under
   * it). On a wide screen beside the item's window, and under the title bar (its name, close box and
   * Gems button) of another window it lies over, where it fits there: a skill gem's tooltip beside
   * the wide skill panel reaches over the bag.
   */
  private tipRect(lines: readonly TipLine[], cx: number, cy: number): Rect {
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
      // off the title bars of the windows it lies over (not the item's own): as far down as it fits
      const over = [l, rr].filter((r): r is Rect => !!r && !inside(r) && x < r.x + r.w && x + size.w > r.x);
      const below = Math.max(0, ...over.map((r) => r.y + HEADER + 1));
      y = Math.max(y, Math.min(below, this.size.h - size.h - 2));
    }
    return { x, y, w: size.w, h: size.h };
  }
}

/** A tooltip laid out (`pickLayout`, `cursorTipLayout`) as it shows scrolled `scroll` rows: the text lines in view (tools and tests). */
function tipShown(laid: { lines: readonly TipLine[]; shown: Rect; max: number }, scroll: number): { lines: string[]; scroll: number; max: number } {
  const view = laid.max > 0 ? { h: laid.shown.h, scroll } : undefined;
  return { lines: tooltipView(laid.lines, view).flatMap((v) => (v.line.sep ? [] : [v.line.text])), scroll, max: laid.max };
}

/** Numbers for the skill panel in the language's way: 1,234 · 12.3 · 0.62. */
function num(v: number): string {
  return lang().formatNumber(v, { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 });
}

/**
 * The shell kit's 3×5 mini font (ui/kit.ts) through a Painter; text it can't draw (accents, other
 * writing systems) in the normal font, a row higher, as `UiCanvas.mini` does.
 */
function miniText(p: Painter, x: number, y: number, s: string, color: number): void {
  if (!miniCovers(s)) {
    if (s) p.text(x, y - 1, s, color);
    return;
  }
  noteText(s); // tools see the mini font's text too (docs/engine/lang.md)
  miniRows(s).forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) if (row[rx] === 'c') p.rect(x + rx, y + ry, 1, 1, color);
  });
}

/**
 * A skill slot's row of text, `w` art pixels wide and 20 high: its name and, under it, a second
 * line (the cost). With `mini` (a phone's compact layouts) each in the mini font when it draws it
 * and it fits, else (and always at ten feet) the normal font; a name that needs two rows of the
 * normal font takes the second line's place.
 */
function rowText(p: Painter, x: number, y: number, w: number, mini: boolean, first: string, c1: number, second?: string, c2: number = c1): void {
  const small = (s: string) => mini && miniCovers(s) && miniWidth(s) <= w;
  if (small(first)) miniText(p, x, second ? y + 4 : y + 7, first, c1);
  else {
    const rows = wrap(first, w);
    if (rows.length > 1 || !second) {
      if (rows.length === 1) return void p.text(x, y + 6, rows[0]!, c1);
      p.text(x, y + 2, rows[0]!, c1);
      p.text(x, y + 11, clip(rows.slice(1).join(' '), w, textWidth), c1);
      return;
    }
    p.text(x, y + 2, rows[0]!, c1);
  }
  if (!second) return;
  if (small(second)) miniText(p, x, y + 11, second, c2);
  else p.text(x, y + 11, clip(second, w, textWidth), c2);
}
