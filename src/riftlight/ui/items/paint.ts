/**
 * The tiny drawing surface the item UI paints through: filled rects and text in art pixels. Text
 * is the game's font (capitals; accented capitals composed) or, for letters it lacks (Cyrillic,
 * Chinese, Arabic...), the device's font at the screen's resolution, as the engine's Hud does
 * (docs/engine/lang.md *Drawing text*). The game implements it on a 2D canvas (`canvasPainter`);
 * the loot CLI implements it on the engine's software raster to render tooltip PNGs headlessly.
 */
import { drawText, noteText, pixelCovers } from '../../../engine/animation/font';
import { drawDeviceText, textWidthPx } from '../../../engine/hud/deviceText';
import { wrapText } from '../../../engine/hud/wrap';
import { PALETTE } from '../../../engine/palette';

export interface Painter {
  rect(x: number, y: number, w: number, h: number, color: number): void;
  /** Text in the game's font (its capitals) with its top-left at (x, y); returns its width in art pixels. */
  text(x: number, y: number, text: string, color: number): number;
}

export const LINE_H = 9;
/** Width of `text` in art pixels as it is drawn (the pixel font, or the device's font). */
export const textWidth = (s: string): number => textWidthPx(s);

/** UI colours (PALETTE only). */
export const UI = {
  panel: PALETTE.ink,
  panelEdge: PALETTE.slate,
  panelHi: PALETTE.mist,
  cell: PALETTE.night,
  cellEdge: 0x262b44,
  title: PALETTE.sand,
  text: PALETTE.white,
  dim: PALETTE.mist,
  implicit: PALETTE.mist,
  explicit: PALETTE.sky,
  better: PALETTE.lime,
  worse: PALETTE.red,
  bad: PALETTE.red,
  gold: PALETTE.sand,
  flavour: PALETTE.orange,
  hover: PALETTE.white,
  valid: PALETTE.green,
  invalid: PALETTE.red,
} as const;

/**
 * A Painter on a 2D canvas painted `k` device pixels per art pixel (the caller sets that transform):
 * rects and pixel glyphs fill k×k blocks, device text is drawn at the screen's resolution
 * (`drawDeviceText`). `device` turns true once a text needed the device's font (the surface then
 * needs `k` above 1: `surfaceScale`).
 */
export function canvasPainter(g: CanvasRenderingContext2D, k = 1): Painter & { device: boolean } {
  const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  const p = {
    device: false,
    rect(x: number, y: number, w: number, h: number, color: number) {
      g.fillStyle = css(color);
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    },
    text(x: number, y: number, text: string, color: number) {
      if (!pixelCovers(text)) {
        p.device = true;
        drawDeviceText(g, text, Math.round(x), Math.round(y), k, 1, css(color));
      } else {
        g.fillStyle = css(color);
        drawText(text, Math.round(x), Math.round(y), (px, py) => g.fillRect(px, py, 1, 1));
      }
      return textWidthPx(text);
    },
  };
  return p;
}

/** A framed panel: dark fill, 1-px edge with a lighter top-left (bevelled pixel look). */
export function panel(p: Painter, x: number, y: number, w: number, h: number, edge: number = UI.panelEdge): void {
  p.rect(x, y, w, h, UI.panel);
  p.rect(x, y, w, 1, edge);
  p.rect(x, y + h - 1, w, 1, edge);
  p.rect(x, y, 1, h, edge);
  p.rect(x + w - 1, y, 1, h, edge);
}

/** A 1-px outline. */
export function outline(p: Painter, x: number, y: number, w: number, h: number, color: number): void {
  p.rect(x, y, w, 1, color);
  p.rect(x, y + h - 1, w, 1, color);
  p.rect(x, y, 1, h, color);
  p.rect(x + w - 1, y, 1, h, color);
}

/** Text with a 1-px ink shadow. */
export function shadowText(p: Painter, x: number, y: number, s: string, color: number): void {
  p.text(x + 1, y + 1, s, PALETTE.ink);
  p.text(x, y, s, color);
}

/**
 * `text` in lines no wider than `width` art pixels, measured as drawn, broken where the language
 * breaks words (`wrapText`). A text that wraps is noted whole, so tools that look for words that
 * aren't lines see the line it came from (docs/engine/lang.md).
 */
export function wrap(text: string, width: number): string[] {
  const lines = wrapText(text, Math.max(1, width), textWidthPx);
  if (lines.length > 1) noteText(text);
  return lines;
}
