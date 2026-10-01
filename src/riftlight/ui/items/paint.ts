/**
 * The tiny drawing surface the item UI paints through: filled rects and 5×7 pixel text in
 * art pixels. The game implements it on a 2D canvas (`canvasPainter`); the loot CLI
 * implements it on the engine's software raster to render tooltip PNGs headlessly.
 */
import { drawText, GLYPH_W } from '../../../engine/animation/font';
import { PALETTE } from '../../../engine/palette';

export interface Painter {
  rect(x: number, y: number, w: number, h: number, color: number): void;
  /** Uppercase 5×7 text; returns its width in pixels. */
  text(x: number, y: number, text: string, color: number): number;
}

export const CHAR_W = GLYPH_W;
export const LINE_H = 9;
export const textWidth = (s: string): number => Math.max(0, s.length * CHAR_W - 1);

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

export function canvasPainter(g: CanvasRenderingContext2D): Painter {
  const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  return {
    rect(x, y, w, h, color) {
      g.fillStyle = css(color);
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    },
    text(x, y, text, color) {
      g.fillStyle = css(color);
      return drawText(text, Math.round(x), Math.round(y), (px, py) => g.fillRect(px, py, 1, 1));
    },
  };
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

/** Word-wrap to at most `chars` characters per line. */
export function wrap(text: string, chars: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= chars) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    while (line.length > chars) {
      out.push(line.slice(0, chars));
      line = line.slice(chars);
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
