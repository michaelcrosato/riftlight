import { drawText, GLYPH_H, GLYPH_W } from '../animation/font';
import type { Framing, Resolution } from '../framing';
import { PALETTE, type PaletteColor } from '../palette';

/** Where an element is attached on screen; it is also aligned that way (right-anchored text grows left). */
export type HudAnchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export type HudColor = PaletteColor | number;

export interface HudOptions {
  /** Default 'white'. */
  color?: HudColor;
  /** 1-pixel drop shadow color, or false. Default 'ink'. */
  shadow?: HudColor | false;
  /** Integer art-pixel scale (2 = double-size glyphs). Default 1. */
  scale?: number;
  /** Default 'top-left': x/y are offsets from that screen corner/edge, in art pixels. */
  anchor?: HudAnchor;
}

type Item =
  | { kind: 'text'; x: number; y: number; text: string; o: HudOptions }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: HudColor; anchor: HudAnchor }
  | { kind: 'sprite'; x: number; y: number; rows: readonly string[]; colors: Record<string, HudColor>; o: HudOptions };

/**
 * Pixel HUD: crisp text and icons drawn in art pixels on top of the game, never through
 * the post filters. It is a 2D canvas at the internal resolution (480×270 / 320×180),
 * laid over the game canvas with the same integer scale and letterbox offset
 * (`framing.ts`), so one HUD pixel is exactly one art pixel at every resolution.
 *
 * Retained: what you add stays on screen until `clear()`. Redraw everything each frame
 * (clear + add) or only when something changes; the canvas repaints only when the content,
 * resolution or framing changed. Available as `ctx.hud`.
 *
 *   ctx.hud.clear();
 *   ctx.hud.text(4, 4, `COINS ${n}/12`, { color: 'sand' });
 *   ctx.hud.text(4, 4, 'PAUSED', { anchor: 'center', scale: 2 });
 */
export class Hud {
  /** The overlay canvas (created on the first draw; null when nothing was ever drawn). */
  canvas: HTMLCanvasElement | null = null;
  visible = true;
  private items: Item[] = [];
  private drawn = '';
  private size: Resolution = { width: 480, height: 270 };
  private layoutKey = '';

  constructor(private readonly container: HTMLElement | null) {}

  /** HUD width/height in art pixels (the internal resolution). */
  get width(): number {
    return this.size.width;
  }

  get height(): number {
    return this.size.height;
  }

  /** Text in the 5×7 bitmap font (uppercase; digits and common punctuation). */
  text(x: number, y: number, text: string, options: HudOptions = {}): void {
    this.items.push({ kind: 'text', x, y, text, o: options });
  }

  /** A filled rectangle (panels, bars). */
  rect(x: number, y: number, w: number, h: number, color: HudColor, anchor: HudAnchor = 'top-left'): void {
    this.items.push({ kind: 'rect', x, y, w, h, color, anchor });
  }

  /**
   * A tiny pixel-art icon as data: one string per row, one character per pixel, mapped
   * through `colors` ('.' or ' ' = transparent).
   *
   *   hud.sprite(4, 4, ['.yy.', 'ywyy', 'yyyy', '.yy.'], { y: 'sand', w: 'white' });
   */
  sprite(x: number, y: number, rows: readonly string[], colors: Record<string, HudColor>, options: HudOptions = {}): void {
    this.items.push({ kind: 'sprite', x, y, rows, colors, o: options });
  }

  /** Remove everything. */
  clear(): void {
    this.items = [];
  }

  /** Size of `text` in art pixels at `scale`. */
  measure(text: string, scale = 1): { width: number; height: number } {
    return { width: Math.max(0, text.length * GLYPH_W - 1) * scale, height: (GLYPH_H - 1) * scale };
  }

  /** Engine: follow the renderer's resolution and framing, and repaint if needed. */
  sync(resolution: Resolution, framing: Framing): void {
    if (!this.container) return;
    if (!this.canvas && this.items.length === 0) return;
    const canvas = (this.canvas ??= this.createCanvas(this.container));
    this.size = resolution;
    const layout = `${resolution.width}x${resolution.height}|${framing.cssWidth},${framing.cssHeight},${framing.offsetX},${framing.offsetY}|${this.visible}`;
    if (layout !== this.layoutKey) {
      this.layoutKey = layout;
      if (canvas.width !== resolution.width || canvas.height !== resolution.height) {
        canvas.width = resolution.width;
        canvas.height = resolution.height;
        this.drawn = '';
      }
      const s = canvas.style;
      s.width = `${framing.cssWidth}px`;
      s.height = `${framing.cssHeight}px`;
      s.left = `${framing.offsetX}px`;
      s.top = `${framing.offsetY}px`;
      s.display = this.visible ? '' : 'none';
    }
    const content = JSON.stringify(this.items);
    if (content === this.drawn) return;
    this.drawn = content;
    this.paint(canvas);
  }

  dispose(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.items = [];
    this.drawn = this.layoutKey = '';
  }

  private createCanvas(container: HTMLElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.dataset.hud = 'true';
    c.className = 'pixel-hud';
    Object.assign(c.style, { position: 'absolute', imageRendering: 'pixelated', pointerEvents: 'none', zIndex: '5' });
    container.appendChild(c);
    return c;
  }

  private paint(canvas: HTMLCanvasElement): void {
    // CPU-backed: tiny, redrawn with fillRect, and cheap for tools to read back.
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const item of this.items) {
      if (item.kind === 'rect') {
        const [x, y] = this.place(item.x, item.y, item.w, item.h, item.anchor);
        g.fillStyle = css(item.color);
        g.fillRect(x, y, Math.round(item.w), Math.round(item.h));
      } else if (item.kind === 'text') {
        const scale = Math.max(1, Math.round(item.o.scale ?? 1));
        const m = this.measure(item.text, scale);
        const [x, y] = this.place(item.x, item.y, m.width, m.height, item.o.anchor);
        const shadow = item.o.shadow ?? 'ink';
        if (shadow !== false) this.glyphs(g, item.text, x + scale, y + scale, scale, css(shadow));
        this.glyphs(g, item.text, x, y, scale, css(item.o.color ?? 'white'));
      } else {
        const scale = Math.max(1, Math.round(item.o.scale ?? 1));
        const w = Math.max(...item.rows.map((r) => r.length)) * scale;
        const [x, y] = this.place(item.x, item.y, w, item.rows.length * scale, item.o.anchor);
        item.rows.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            const color = item.colors[row[rx]!];
            if (color === undefined) continue;
            g.fillStyle = css(color);
            g.fillRect(x + rx * scale, y + ry * scale, scale, scale);
          }
        });
      }
    }
  }

  private glyphs(g: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string): void {
    g.fillStyle = color;
    drawText(text, x, y, (px, py) => g.fillRect(px, py, 1, 1), scale);
  }

  private place(x: number, y: number, w: number, h: number, anchor: HudAnchor = 'top-left'): [number, number] {
    return hudPlace(x, y, w, h, anchor, this.size);
  }
}

/**
 * Top-left corner, in whole art pixels, of a w×h element placed at offset (x, y) from
 * `anchor` on a screen of `size` art pixels. Pure (unit-tested).
 */
export function hudPlace(x: number, y: number, w: number, h: number, anchor: HudAnchor, size: Resolution): [number, number] {
  const { width: W, height: H } = size;
  const col = anchor === 'left' || anchor.endsWith('-left') ? 0 : anchor === 'right' || anchor.endsWith('-right') ? 2 : 1;
  const row = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 2 : 1;
  const px = col === 0 ? x : col === 2 ? W - x - w : Math.floor((W - w) / 2) + x;
  const py = row === 0 ? y : row === 2 ? H - y - h : Math.floor((H - h) / 2) + y;
  return [Math.round(px), Math.round(py)];
}

function css(color: HudColor): string {
  const hex = typeof color === 'number' ? color : PALETTE[color];
  return `#${hex.toString(16).padStart(6, '0')}`;
}
