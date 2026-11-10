/**
 * Control hints for the showcase's screens (the arcade, the Hall of Beasts, photo mode): each hint
 * is its own line (`showcase.hint.<name>`, lang/showcase.ts: `{key:<action>}` and what it does),
 * shown in a row like a list.
 */
import { type HudColor, wrapText } from '../../engine';
import { t } from '../lang';
import type { HintName } from '../lang/showcase';
import { miniCovers, miniWidth, type UiCanvas } from '../ui/kit';

/** A row of hints in the player's language ("WASD move · Esc leave"). */
export function hints(names: readonly HintName[], separator = ' · '): string {
  return names.map((n) => t(`showcase.hint.${n}`)).join(separator);
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
