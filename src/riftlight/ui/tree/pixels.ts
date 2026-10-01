/**
 * A tiny 32-bit pixel buffer the tree view paints into at art resolution, then blits with
 * one putImageData. Every primitive lands on whole pixels in palette colours, so the view
 * stays crisp at any integer scale. DOM-free (unit-testable); the view wraps `bytes` in an
 * ImageData.
 */
import { drawText, GLYPH_W } from '../../../engine/animation/font';
import { PALETTE, type PaletteColor } from '../../../engine/palette';

/** A palette colour packed for a little-endian RGBA Uint32 view. */
export function pack(c: PaletteColor | number): number {
  const hex = typeof c === 'number' ? c : PALETTE[c];
  return ((255 << 24) | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;
}

/** Characters the bitmap font lacks, mapped to ones it has. */
export function fontSafe(s: string): string {
  return s.replace(/[–—]/g, '-').replace(/[·•]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/"/g, "'");
}

/** Greedy word wrap to `chars` columns. */
export function wrap(text: string, chars: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (line && line.length + 1 + word.length > chars) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word.length > chars ? word.slice(0, chars) : word;
  }
  if (line) out.push(line);
  return out;
}

const masks = new Map<number, number[]>();
/** Half-widths per row of a pixel disc of radius r (rows -r..r). */
function discMask(r: number): number[] {
  let m = masks.get(r);
  if (!m) {
    m = [];
    for (let dy = -r; dy <= r; dy++) m.push(Math.floor(Math.sqrt(Math.max(0, r * r + r * 0.8 - dy * dy))));
    masks.set(r, m);
  }
  return m;
}

export class PixelBuffer {
  readonly bytes: Uint8ClampedArray<ArrayBuffer>;
  readonly px: Uint32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.bytes = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
    this.px = new Uint32Array(this.bytes.buffer);
  }

  clear(c: number): void {
    this.px.fill(c);
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = c;
  }

  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? 0 : this.px[y * this.width + x]!;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.width + x0, yy * this.width + Math.max(x0, x1));
  }

  /** Every other pixel of a rect (a 50% "transparent" panel that stays in the palette). */
  dither(x: number, y: number, w: number, h: number, c: number): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) if ((xx + yy) & 1) this.px[yy * this.width + xx] = c;
  }

  frame(x: number, y: number, w: number, h: number, c: number): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  /** Bresenham line between whole pixels (clipped). */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 >= this.width && x1 >= this.width) || (y0 >= this.height && y1 >= this.height)) return;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    // Long lines far outside the screen: bail after enough steps.
    for (let i = 0; i < 4096; i++) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** A thick line: the line plus copies one pixel across its minor axis. */
  thickLine(x0: number, y0: number, x1: number, y1: number, c: number, glow?: number): void {
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    const [ox, oy] = steep ? [1, 0] : [0, 1];
    if (glow !== undefined) {
      this.line(x0 - ox, y0 - oy, x1 - ox, y1 - oy, glow);
      this.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, glow);
    }
    this.line(x0, y0, x1, y1, c);
  }

  disc(cx: number, cy: number, r: number, c: number): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    if (r <= 0) return this.set(cx, cy, c);
    const m = discMask(r);
    for (let i = 0; i < m.length; i++) this.rect(cx - m[i]!, cy - r + i, 2 * m[i]! + 1, 1, c);
  }

  ring(cx: number, cy: number, r: number, c: number): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    const outer = discMask(r);
    const inner = r > 1 ? discMask(r - 1) : [];
    for (let i = 0; i < outer.length; i++) {
      const dy = i - r;
      const w = outer[i]!;
      const wi = Math.abs(dy) <= r - 1 ? (inner[dy + r - 1] ?? -1) : -1;
      for (let x = -w; x <= w; x++) if (Math.abs(x) > wi) this.set(cx + x, cy + dy, c);
    }
  }

  diamond(cx: number, cy: number, r: number, c: number): void {
    for (let dy = -r; dy <= r; dy++) {
      const w = r - Math.abs(dy);
      this.rect(Math.round(cx) - w, Math.round(cy) + dy, 2 * w + 1, 1, c);
    }
  }

  /** 5×7 font text; returns its width in pixels. `shadow` draws a 1-px drop shadow first. */
  text(s: string, x: number, y: number, c: number, scale = 1, shadow?: number): number {
    const t = fontSafe(s);
    if (shadow !== undefined) drawText(t, Math.round(x) + scale, Math.round(y) + scale, (px, py) => this.set(px, py, shadow), scale);
    return drawText(t, Math.round(x), Math.round(y), (px, py) => this.set(px, py, c), scale) - scale;
  }
}

export const textWidth = (s: string, scale = 1) => Math.max(0, fontSafe(s).length * GLYPH_W - 1) * scale;
