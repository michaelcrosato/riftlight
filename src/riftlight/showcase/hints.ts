/**
 * Control hints for the showcase's screens (the arcade, the Hall of Beasts, photo mode): each hint
 * is its own line (`showcase.hint.<name>`, lang/showcase.ts: `{key:<action>}` and what it does),
 * shown in a row like a list.
 */
import { type ControlTable, type Engine, type HudColor, wrapText } from '../../engine';
import { CONTROLS } from '../game/controls';
import type { Riftlight } from '../game/Riftlight';
import { t } from '../lang';
import type { HintName } from '../lang/showcase';
import { miniCovers, miniWidth, type UiCanvas, wrapRow } from '../ui/kit';
import type { Box } from '../ui/layout';

/**
 * The controls while a showcase screen is up (the arcade, the Hall of Beasts, photo mode): the
 * game's (`CONTROLS`), with what these screens do on a pad and a phone where it differs from the
 * town's, so each hint names a button that does it here. `Showcase` puts it in `engine.controls`
 * while it owns the frame and gives the game's back when it lets go.
 *
 *   zoom        the wheel · R1 in, L1 out · a pinch          (the Hall's card; photo mode's field of view, where R1 steps it)
 *   photo_hide  H · L1 (Create too) · a sideways swipe from the panel (photo mode's panel)
 *   show        H · L1 (Create too) · a tap on the hint      (photo mode's panel back: no swipe shows it)
 *   rise        Q / E · R2 up, L2 down                       (photo mode's free camera)
 *   next_wing   N · R1 (L1 back) · the < > at the sides      (the Hall)
 *   photo_save  P · Square · a tap on Save                   (photo mode)
 *   card_back   Esc · Circle · a sideways swipe from the card (the Hall's card: a phone's ≡ is hidden under it)
 *
 * A swipe acts only where it starts on what it moves (the card, the panel): a drag elsewhere looks
 * or orbits, and a quick one is a swipe too.
 */
export const SHOWCASE_CONTROLS: ControlTable = {
  ...CONTROLS,
  zoom: { key: 'Wheel', pad: 'PadRB', touch: 'TouchPinch' },
  photo_hide: { key: 'KeyH', pad: 'PadLB', touch: 'TouchSwipe' },
  show: { key: 'KeyH', pad: 'PadLB', touch: 'TouchTap' },
  rise: { key: 'QE', pad: 'PadRT' },
  next_wing: { key: 'KeyN', pad: 'PadRB', touch: '< >' },
  photo_save: { key: 'KeyP', pad: 'PadX', touch: 'TouchTap' },
  card_back: { key: 'Escape', pad: 'PadB', touch: 'TouchSwipe' },
};

/** A row of hints in the player's language ("WASD move · Esc leave"). */
export function hints(names: readonly HintName[], separator = ' · '): string {
  return names.map((n) => t(`showcase.hint.${n}`)).join(separator);
}

/** The row of hints in lines no wider than `width` art pixels (the HUD's font): whole hints on each line, as many as fit. */
export function hintRows(names: readonly HintName[], width: number, separator = '   '): string[] {
  return wrapRow(names.map((n) => t(`showcase.hint.${n}`)), width, separator);
}

/**
 * Hints in the mini font, centred on `x`, their last row at `y`: a row wider than the screen
 * wraps upward (a longer language), never off the edges. Returns the top row's y.
 */
export function miniHints(ui: UiCanvas, x: number, y: number, text: string, color: HudColor, shadow: HudColor | false = false): number {
  const rows = wrapText(text, ui.w - 8, miniWidth);
  const step = rows.every(miniCovers) ? 7 : 9; // the mini font can't draw every language: then a text row's height
  rows.forEach((row, i) => ui.mini(x, y - (rows.length - 1 - i) * step, row, color, 'center', shadow));
  return y - (rows.length - 1) * step;
}

/**
 * The phone's controls on screen in art pixels, for a showcase screen's HUD: where the page lays
 * them out, or without a page where their data puts them (headless, a replay of a phone's
 * recording: `TouchPad.zones`); none while they step aside for a pad or the keyboard.
 */
export function controlBoxes(game: Riftlight): Box[] {
  return game.touchPad.zones((x, y) => game.pointer.toArt(x, y));
}

/** A row of mini hints placed (`hintsAt`): its rows, centred on `x`, the last at `y`, `step` apart. */
export interface HintSpot {
  readonly x: number;
  readonly y: number;
  readonly rows: readonly string[];
  readonly step: number;
}

/**
 * Where a row of hints in the mini font goes, as low on the screen as it can, clear of a phone's
 * controls (`boxes`, art pixels: `controlBoxes`): along the bottom in a gap between them where one
 * holds it in at most three rows (centred on the screen when the gap reaches the middle, else in
 * the gap: a phone held sideways has room between its stick and its buttons), else over them.
 * Without controls: on `bottom` (its last row; default the screen's eighth row from the bottom),
 * centred, wrapped to the screen.
 */
export function hintsAt(ui: UiCanvas, text: string, boxes: readonly Box[], bottom = ui.h - 8): HintSpot {
  const low = boxes.filter((b) => b.y + b.h > ui.h / 3);
  const place = (width: number) => {
    const rows = wrapText(text, width, miniWidth);
    return { rows, step: rows.every(miniCovers) ? 7 : 9, w: Math.max(0, ...rows.map((r) => miniWidth(r))) };
  };
  const clear = (x0: number, x1: number, y0: number, y1: number) => low.every((b) => b.x + b.w <= x0 || b.x >= x1 || b.y + b.h <= y0 || b.y >= y1);
  for (let y = bottom; y > ui.h / 3; y--) {
    // the gaps between the controls along the row at y (its text, a pixel of air around it)
    const band = low.filter((b) => b.y < y + 8 && b.y + b.h > y - 2).sort((a, b) => a.x - b.x);
    const gaps: [number, number][] = [];
    let from = 2;
    for (const b of band) {
      if (b.x > from) gaps.push([from, b.x]);
      from = Math.max(from, b.x + b.w);
    }
    if (ui.w - 2 > from) gaps.push([from, ui.w - 2]);
    const fits = gaps
      .map(([x0, x1]) => ({ x0, x1, ...place(Math.min(ui.w - 8, x1 - x0 - 4)) }))
      .filter((g) => g.rows.length <= 3 && g.w + 4 <= g.x1 - g.x0)
      .sort((a, b) => a.rows.length - b.rows.length || Math.abs((a.x0 + a.x1) / 2 - ui.w / 2) - Math.abs((b.x0 + b.x1) / 2 - ui.w / 2));
    for (const g of fits) {
      const x = Math.round(Math.min(g.x1 - 2 - g.w / 2, Math.max(g.x0 + 2 + g.w / 2, ui.w / 2)));
      const top = y - (g.rows.length - 1) * g.step - 2;
      if (clear(x - g.w / 2 - 2, x + g.w / 2 + 2, top, y + 8)) return { x, y, rows: g.rows, step: g.step };
    }
  }
  // no gap holds it: over every control along the bottom, wrapped to the screen
  const { rows, step } = place(ui.w - 8);
  return { x: ui.w / 2, y: Math.min(bottom, ...low.map((b) => b.y - 8)), rows, step };
}

/** Draw hints where `hintsAt` placed them. Returns the top row's y. */
export function drawHints(ui: UiCanvas, at: HintSpot, color: HudColor, shadow: HudColor | false = false): number {
  at.rows.forEach((row, i) => ui.mini(at.x, at.y - (at.rows.length - 1 - i) * at.step, row, color, 'center', shadow));
  return at.y - (at.rows.length - 1) * at.step;
}

/**
 * The top row a box `w` × `h` centred on `x` can take, as low as `bottom` (its last row) and clear
 * of a phone's controls (`boxes`) under its columns: the HUD's prompt over the hints.
 */
export function clearAbove(boxes: readonly Box[], x: number, w: number, bottom: number, h: number): number {
  let top = bottom - h;
  for (let i = 0; i < boxes.length + 1; i++) {
    const hit = boxes.find((b) => b.x < x + w / 2 && b.x + b.w > x - w / 2 && b.y < top + h + 1 && b.y + b.h > top - 1);
    if (!hit) break;
    top = hit.y - 2 - h;
  }
  return top;
}

/**
 * The lowest art row a HUD panel spanning columns `x0`..`x1` can reach without going under a
 * touch control (the joystick, a button): `hud.height` without touch controls on screen (and
 * headless, where nothing has a place on a page).
 */
export function touchFloor(engine: Engine, x0: number, x1: number): number {
  const h = engine.hud.height;
  const touch = engine.touch;
  const canvas = engine.hud.canvas;
  if (!touch?.visible || !canvas) return h;
  const r = canvas.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return h;
  const w = engine.hud.width;
  const c = touch.rects();
  let floor = h;
  for (const b of [c.stick, ...c.buttons.filter((x) => !x.hidden).map((x) => x.rect)]) {
    // the controls along the bottom (the top-left ≡ GO ? are over the HUD's top, not its floor)
    if (!b || b.top < r.top + r.height / 3) continue;
    const left = ((b.left - r.left) / r.width) * w;
    const right = ((b.right - r.left) / r.width) * w;
    if (right > x0 && left < x1) floor = Math.min(floor, Math.floor(((b.top - r.top) / r.height) * h) - 2);
  }
  return floor;
}

/**
 * How far right a phone's buttons in the top-left corner reach (≡), in art pixels, so a HUD row
 * along the top starts after them; 0 without touch controls (and headless).
 */
export function touchLeft(engine: Engine): number {
  const touch = engine.touch;
  const canvas = engine.hud.canvas;
  if (!touch?.visible || !canvas) return 0;
  const r = canvas.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return 0;
  let right = 0;
  for (const b of touch.rects().buttons) {
    if (b.hidden || b.rect.top > r.top + r.height / 4 || b.rect.left > r.left + r.width / 2) continue;
    right = Math.max(right, Math.ceil(((b.rect.right - r.left) / r.width) * engine.hud.width));
  }
  return right;
}
