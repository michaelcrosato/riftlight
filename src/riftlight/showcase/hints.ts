/**
 * Control hints for the showcase's screens (the arcade, the Hall of Beasts, photo mode): each hint
 * is its own line (`showcase.hint.<name>`, lang/showcase.ts: `{key:<action>}` and what it does),
 * shown in a row like a list.
 */
import { type ControlTable, type Engine, type HudColor, wrapText } from '../../engine';
import { CONTROLS } from '../game/controls';
import { t } from '../lang';
import type { HintName } from '../lang/showcase';
import { miniCovers, miniWidth, type UiCanvas, wrapRow } from '../ui/kit';

/**
 * The controls while a showcase screen is up (the arcade, the Hall of Beasts, photo mode): the
 * game's (`CONTROLS`), with what these screens do on a pad and a phone where it differs from the
 * town's, so each hint names a button that does it here. `Showcase` puts it in `engine.controls`
 * while it owns the frame and gives the game's back when it lets go.
 *
 *   zoom        the wheel · R1 in, L1 out · a pinch          (the Hall's card; photo mode's field of view, where R1 steps it)
 *   photo_hide  H · L1 (Create too) · a sideways swipe       (photo mode's panel)
 *   rise        Q / E · R2 up, L2 down                       (photo mode's free camera)
 *   next_wing   N · R1 (L1 back) · a swipe                   (the Hall)
 *   photo_save  P · Square · a tap on Save                   (photo mode)
 */
export const SHOWCASE_CONTROLS: ControlTable = {
  ...CONTROLS,
  zoom: { key: 'Wheel', pad: 'PadRB', touch: 'TouchPinch' },
  photo_hide: { key: 'KeyH', pad: 'PadLB', touch: 'TouchSwipe' },
  rise: { key: 'QE', pad: 'PadRT' },
  next_wing: { key: 'KeyN', pad: 'PadRB', touch: 'TouchSwipe' },
  photo_save: { key: 'KeyP', pad: 'PadX', touch: 'TouchTap' },
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
