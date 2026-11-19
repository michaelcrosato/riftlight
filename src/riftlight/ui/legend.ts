/**
 * What the controls do here, for the device in use, read from the couch: the button legend under a
 * framed panel or menu (✕ Select · ○ Back · L1 R1 Screens with a pad; Enter Select · Esc Back · Q E
 * Screens on the keyboard) and the character screens' strip ([L1] Inventory Skills Passive tree
 * Character Codex [R1]). Drawn with the kit's glyphs (`UiCanvas.glyph`), so a pad shows its buttons
 * in the player's style, and a DualSense whose touchpad swipes page the screens the swipes beside
 * L1 / R1 (`UiCanvas.touchpad`); hidden on a touch screen, whose buttons and taps say it.
 */
import type { ControlAction, Page } from '../game/controls';
import { PAGE_LINES, PAGES } from '../game/controls';
import { t } from '../lang';
import { clip, type Rect, type UiCanvas } from './kit';

/** One entry: the controls that do it (drawn side by side) and what it does. */
export interface LegendItem {
  readonly actions: readonly ControlAction[];
  /** A DualSense's touchpad gestures that do it too, drawn after `actions` while they do (`UiCanvas.touchpad`, a pad in use). */
  readonly touchpad?: readonly ControlAction[];
  readonly label: string;
}

/** The art rows a legend takes under a panel's frame (the layer keeps them free). */
export const LEGEND_ROOM = 11;
/** Art pixels between two entries. */
const GAP = 9;

/** Select and back: what every menu's legend starts with (no back where back does nothing: the death recap). */
export function menuLegend(back = true): LegendItem[] {
  return [{ actions: ['confirm'], label: t('legend.select') }, ...(back ? [{ actions: ['back'] as const, label: t('legend.back') }] : [])];
}

/** The character screens' entry: L1 R1 (Q E) page through them, and a swipe either way on a DualSense's touchpad. */
export const pagesLegend = (): LegendItem => ({ actions: ['page_prev', 'page_next'], touchpad: ['page_swipe_prev', 'page_swipe_next'], label: t('legend.screens') });

/** Whether the touchpad's gestures show: a pad in use, its swipes on (`UiCanvas.touchpad`). */
const swipes = (ui: UiCanvas): boolean => ui.device === 'pad' && ui.touchpad;

/** The glyphs `item` draws on the device in use. */
const glyphsOf = (ui: UiCanvas, item: LegendItem): readonly ControlAction[] => (swipes(ui) && item.touchpad ? [...item.actions, ...item.touchpad] : item.actions);

const glyphsWidth = (ui: UiCanvas, actions: readonly ControlAction[]): number => actions.reduce((w, a, i) => w + ui.glyphWidth(a) + (i ? 2 : 0), 0);

/** Draw `actions`' glyphs side by side from `x`; returns the x after them. */
function drawGlyphs(ui: UiCanvas, x: number, y: number, actions: readonly ControlAction[]): number {
  actions.forEach((a, i) => (x += ui.glyph(x, y, a) + (i < actions.length - 1 ? 2 : 0)));
  return x;
}

/** How wide `item` draws. */
const itemWidth = (ui: UiCanvas, item: LegendItem): number => glyphsWidth(ui, glyphsOf(ui, item)) + 3 + ui.measure(item.label);

/**
 * Draw `items` in one row centred on `cx` at `y` (the glyphs' row), at most `maxW` wide: entries
 * that don't fit are dropped from the end. Returns the row's width (0 on a touch screen: none).
 */
export function drawLegend(ui: UiCanvas, items: readonly LegendItem[], cx: number, y: number, maxW: number): number {
  const { shown, w } = fitLegend(ui, items, maxW);
  if (!shown.length) return 0;
  let x = Math.max(2, Math.min(ui.w - 2 - w, Math.round(cx - w / 2)));
  ui.rect(x - 3, y - 2, w + 6, 11, 'ink'); // a plate: it reads over the world and the HUD behind
  for (const item of shown) {
    x = drawGlyphs(ui, x, y, glyphsOf(ui, item)) + 3;
    x += ui.text(x, y, item.label, { color: 'mist' }) + GAP;
  }
  return w;
}

/** The entries of `items` that fit `maxW` (from the start) and their row's width; none on a touch screen. */
function fitLegend(ui: UiCanvas, items: readonly LegendItem[], maxW: number): { shown: LegendItem[]; w: number } {
  const shown: LegendItem[] = [];
  let w = 0;
  if (ui.device === 'touch') return { shown, w };
  for (const item of items) {
    const iw = itemWidth(ui, item) + (shown.length ? GAP : 0);
    if (w + iw > maxW) break;
    shown.push(item);
    w += iw;
  }
  return { shown, w };
}

/** How wide `drawLegend` draws `items` in at most `maxW`, its plate included (0: nothing to draw). */
export function legendWidth(ui: UiCanvas, items: readonly LegendItem[], maxW: number): number {
  const { shown, w } = fitLegend(ui, items, maxW);
  return shown.length ? w + 6 : 0;
}

/** The strip's rects by page, as last drawn (a click on one opens it). */
export interface PageStrip {
  readonly rects: readonly (Rect & { readonly page: Page })[];
}

/**
 * The character screens' strip across the top of the screen while one of them is open: the page
 * before's control, every page's name (the open one bright), the next's control (a DualSense whose
 * swipes page them: the swipe outside each button). On a screen too narrow for every name, the
 * open one alone between the controls. Nothing on a touch screen.
 */
export function drawPageStrip(ui: UiCanvas, open: Page): PageStrip {
  if (ui.device === 'touch') return { rects: [] };
  const names = PAGES.map((p) => ({ page: p, text: t(PAGE_LINES[p]) }));
  const prev: readonly ControlAction[] = swipes(ui) ? ['page_swipe_prev', 'page_prev'] : ['page_prev'];
  const next: readonly ControlAction[] = swipes(ui) ? ['page_next', 'page_swipe_next'] : ['page_next'];
  const gl = glyphsWidth(ui, prev);
  const gr = glyphsWidth(ui, next);
  const all = names.reduce((w, n, i) => w + ui.measure(n.text) + (i ? GAP : 0), 0);
  const room = ui.w - 8 - gl - gr - 12;
  const shown = all <= room ? names : names.filter((n) => n.page === open);
  const label = (n: { text: string }) => (shown.length > 1 ? n.text : clip(n.text, room, (s) => ui.measure(s)));
  const width = shown.reduce((w, n, i) => w + ui.measure(label(n)) + (i ? GAP : 0), 0);
  const total = gl + 6 + width + 6 + gr;
  let x = Math.round((ui.w - total) / 2);
  const y = 4;
  ui.rect(x - 4, y - 3, total + 8, 13, 'ink');
  ui.outline(x - 4, y - 3, total + 8, 13, 'night');
  drawGlyphs(ui, x, y, prev);
  x += gl + 6;
  const rects: (Rect & { page: Page })[] = [];
  for (const n of shown) {
    const text = label(n);
    const w = ui.measure(text);
    const here = n.page === open;
    const rect = { x: x - 2, y: y - 2, w: w + 4, h: 11, page: n.page };
    if (here) ui.rect(rect.x, rect.y, rect.w, rect.h, 'navy');
    ui.text(x, y, text, { color: here ? 'sand' : ui.hover(rect) ? 'white' : 'slate' });
    rects.push(rect);
    x += w + GAP;
  }
  drawGlyphs(ui, x - GAP + 6, y, next);
  return { rects };
}
