import { drawText, GLYPH_H, noteText, pixelCovers } from '../animation/font';
import { drawDeviceText, surfaceScale, textWidthPx } from './deviceText';
import type { Framing, Resolution } from '../framing';
import { PALETTE, type PaletteColor } from '../palette';
import { type Controls, GLYPH_SIZE, type Glyph } from '../controls';

/** Where an element is attached on screen; it is also aligned that way (right-anchored text grows left). */
export type HudAnchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

/** One button of a legend (`hud.legend`): what does it (an action of `Game.controls`, or a code: `PadB`) and its words. */
export type LegendItem = readonly [action: string, label: string];

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
  /** The size the canvas was last painted at (`sync`). */
  private size: Resolution = { width: 480, height: 270 };
  private layoutKey = '';
  /** Device pixels per art pixel the canvas is painted at: above 1 only while it holds device text. */
  private k = 1;

  /**
   * `view` is the art resolution now (the engine passes its view's): `width` / `height` follow it
   * at every moment, in `setup`, live frames, `step()` and replays alike, so a layout always
   * agrees with where the pointer maps. Without one they are the size `sync` was last given.
   */
  constructor(
    private readonly container: HTMLElement | null,
    private readonly view: (() => Resolution) | null = null,
  ) {}

  /** HUD width/height in art pixels (the internal resolution). */
  get width(): number {
    return (this.view?.() ?? this.size).width;
  }

  get height(): number {
    return (this.view?.() ?? this.size).height;
  }

  /**
   * Text in the 5×7 bitmap font (capitals; digits, punctuation, accented Latin capitals). A line
   * with letters the font lacks (Cyrillic, Chinese, Arabic...) is drawn in the device's font in the
   * same box, at the screen's resolution (`deviceText.ts`).
   */
  text(x: number, y: number, text: string, options: HudOptions = {}): void {
    noteText(text); // tools see it now, not only when the canvas repaints (docs/engine/lang.md)
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

  /** @internal The engine's controls (`engine.controls`): what `glyph` and `prompt` draw. */
  controls: Controls | null = null;

  /**
   * The glyph of what does `action` (an action of the game's `Game.controls`, or a code: `PadA`,
   * `KeyF`, `MouseLeft`) on the device in use, its top-left at (x, y) in art pixels, as tall as a
   * line of text there: PlayStation's ✕ ○ □ △ (or Xbox's A B X Y, `settings.padGlyphs`) as round
   * buttons in their colours, L1 / Options... as round caps, keys as key caps, the mouse's buttons
   * drawn. Returns its width (0 when the action has no control).
   */
  glyph(x: number, y: number, action: string, scale = 1): number {
    const g = this.controls?.glyph(action);
    if (!g) return 0;
    const k = Math.max(1, Math.round(scale));
    if (g.kind === 'sprite') {
      this.sprite(x, y, g.rows, g.colors as Record<string, HudColor>, { scale: k });
      return GLYPH_SIZE * k;
    }
    const w = this.glyphWidth(action, k);
    if (g.round) {
      this.rect(x + k, y - k, w - 2 * k, 9 * k, 'ink');
      this.rect(x, y, w, 7 * k, 'ink');
      this.rect(x + k, y, w - 2 * k, 7 * k, 'night');
      this.text(x + 2 * k, y, g.text, { color: 'white', shadow: false, scale: k });
    } else {
      this.rect(x, y - k, w, 9 * k, 'mist'); // the cap's rim, its shadow below
      this.rect(x, y + 7 * k, w, k, 'slate');
      this.rect(x + k, y, w - 2 * k, 7 * k, 'white');
      this.text(x + 2 * k, y, g.text, { color: 'ink', shadow: false, scale: k });
    }
    return w;
  }

  /** The width `glyph` draws `action` at (0 when it has no control). */
  glyphWidth(action: string, scale = 1): number {
    const g: Glyph | null | undefined = this.controls?.glyph(action);
    if (!g) return 0;
    const k = Math.max(1, Math.round(scale));
    return g.kind === 'sprite' ? GLYPH_SIZE * k : this.measure(g.text, k).width + 4 * k;
  }

  /**
   * A prompt: the glyph of `action` (`glyph`), then `label` as text. `align` places it around x
   * (`center`, `right`); the text takes the other options (`color`, `shadow`, `scale`). Returns
   * its width. On a pad it shows ✕ JUMP, on the keyboard SPACE JUMP, in the player's language.
   */
  prompt(x: number, y: number, action: string, label: string, options: Omit<HudOptions, 'anchor'> & { align?: 'left' | 'center' | 'right' } = {}): number {
    const k = Math.max(1, Math.round(options.scale ?? 1));
    const gw = this.glyphWidth(action, k);
    const gap = gw ? 3 * k : 0;
    const total = gw + gap + this.measure(label, k).width;
    const left = options.align === 'center' ? x - Math.floor(total / 2) : options.align === 'right' ? x - total : x;
    this.glyph(left, y, action, k);
    this.text(left + gw + gap, y, label, { color: options.color, shadow: options.shadow, scale: k });
    return total;
  }

  /**
   * A legend of buttons: each item's glyph on the device in use (`glyph`) then its words, in one
   * row `gap` art pixels apart (default 8): ✕ SELECT ○ BACK on a DualSense (A B on Xbox's), ENTER
   * SELECT ESC BACK on the keyboard, TAP SELECT SWIPE BACK on a touch screen. An item whose control
   * the device has none of (no touch gesture for it) shows its words alone, a button the game can
   * place a tap on. `align` places the row around x. Returns its width (`legendWidth`).
   *
   *   ctx.hud.legend(ctx.hud.width / 2, ctx.hud.height - 10, [['confirm', 'SELECT'], ['back', 'BACK']], { align: 'center' });
   */
  legend(x: number, y: number, items: readonly LegendItem[], options: Omit<HudOptions, 'anchor'> & { align?: 'left' | 'center' | 'right'; gap?: number } = {}): number {
    const k = Math.max(1, Math.round(options.scale ?? 1));
    const total = this.legendWidth(items, options);
    let left = options.align === 'center' ? x - Math.floor(total / 2) : options.align === 'right' ? x - total : x;
    const text = { color: options.color, shadow: options.shadow, scale: k };
    for (const [action, label] of items) {
      const w = this.legendItemWidth(action, label, k);
      if (this.controls?.onDevice(action)) this.prompt(left, y, action, label, text);
      else this.text(left, y, label, text);
      left += w + (options.gap ?? 8) * k;
    }
    return total;
  }

  /** The width `legend` draws `items` at. */
  legendWidth(items: readonly LegendItem[], options: { scale?: number; gap?: number } = {}): number {
    const k = Math.max(1, Math.round(options.scale ?? 1));
    if (!items.length) return 0;
    return items.reduce((w, [action, label]) => w + this.legendItemWidth(action, label, k), 0) + (items.length - 1) * (options.gap ?? 8) * k;
  }

  private legendItemWidth(action: string, label: string, k: number): number {
    const gw = this.controls?.onDevice(action) ? this.glyphWidth(action, k) : 0;
    return gw + (gw ? 3 * k : 0) + this.measure(label, k).width;
  }

  /** Remove everything. */
  clear(): void {
    this.items = [];
  }

  /** Size of `text` in art pixels at `scale`. */
  measure(text: string, scale = 1): { width: number; height: number } {
    return { width: textWidthPx(text, scale), height: (GLYPH_H - 1) * scale };
  }

  /** Engine: follow the renderer's resolution and framing, and repaint if needed. */
  sync(resolution: Resolution, framing: Framing): void {
    this.size = resolution;
    if (!this.container) return;
    if (!this.canvas && this.items.length === 0) return;
    const canvas = (this.canvas ??= this.createCanvas(this.container));
    const k = surfaceScale(framing.scale, this.items.some((i) => i.kind === 'text' && !pixelCovers(i.text)));
    const layout = `${resolution.width}x${resolution.height}|${framing.cssWidth},${framing.cssHeight},${framing.offsetX},${framing.offsetY}|${this.visible}|${k}`;
    if (layout !== this.layoutKey) {
      this.layoutKey = layout;
      this.k = k;
      if (canvas.width !== resolution.width * k || canvas.height !== resolution.height * k) {
        canvas.width = resolution.width * k;
        canvas.height = resolution.height * k;
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
    const k = this.k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(k, 0, 0, k, 0, 0); // art pixels: k×k device pixels each
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
        if (!pixelCovers(item.text)) {
          if (shadow !== false) drawDeviceText(g, item.text, x + scale, y + scale, k, scale, css(shadow));
          drawDeviceText(g, item.text, x, y, k, scale, css(item.o.color ?? 'white'));
          continue;
        }
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
