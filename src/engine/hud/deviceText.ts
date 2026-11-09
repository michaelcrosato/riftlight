/**
 * Text the pixel font can't draw (Cyrillic, Chinese, Arabic, Hindi...: `pixelCovers` is false)
 * is drawn with the device's own font, which has every writing system, joins Arabic and builds
 * Devanagari letters, and runs right to left by itself (AI Hub Languages v1, *Drawing text*).
 * A pixel surface that holds such text is painted `k` device pixels per art pixel (`surfaceScale`),
 * so the device's letters are drawn at the screen's own resolution in the same 8-pixel cell
 * as a pixel-font line: a Chinese line stays readable without changing any layout.
 */
import { clusters, fontCase, GLYPH_H, GLYPH_W, pixelCovers, textCells } from '../animation/font';

/** The device's font, at `px` pixels: a sans-serif stack every system has, bold so it reads small. */
export function deviceFont(px: number): string {
  return `600 ${px}px system-ui, "Segoe UI", "Noto Sans", "Helvetica Neue", Arial, sans-serif`;
}

/** The em size of device text in art pixels at scale 1: the pixel font's cell height. */
const EM = GLYPH_H;
/** Measured once at this size, then scaled: small sizes measure coarsely. */
const MEASURE_PX = 64;

const RTL_TEXT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

/** Isolated runs (a name filled into a line): they don't decide the line's direction. */
const ISOLATED = /[\u2066-\u2068][^\u2069]*\u2069?/g;

/**
 * Does this text run right to left (Arabic, Hebrew, Urdu...)? As Unicode's rule for a paragraph:
 * its first strong letter decides, isolated runs skipped (an English line holding an Arabic name
 * stays left to right).
 */
export function runsRtl(text: string): boolean {
  const first = /\p{L}/u.exec(text.replace(ISOLATED, ''));
  return !!first && RTL_TEXT.test(first[0]);
}

let measurer: CanvasRenderingContext2D | null | undefined;

function measureContext(): CanvasRenderingContext2D | null {
  if (measurer !== undefined) return measurer;
  measurer = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') measurer = new OffscreenCanvas(8, 8).getContext('2d') as unknown as CanvasRenderingContext2D | null;
    else if (typeof document !== 'undefined') measurer = document.createElement('canvas').getContext('2d');
  } catch {
    measurer = null;
  }
  if (measurer) measurer.font = deviceFont(MEASURE_PX);
  return measurer;
}

const widths = new Map<string, number>();

/**
 * Width of `text` in art pixels at `scale` as the device font draws it (its capitals), rounded
 * up. Without a canvas (Node) it is counted like the pixel font, so layouts still run headless.
 */
export function deviceTextWidth(text: string, scale = 1): number {
  const shown = fontCase(text);
  let w = widths.get(shown);
  if (w === undefined) {
    const g = measureContext();
    w = g ? (g.measureText(shown).width * EM) / MEASURE_PX : Math.max(0, clusters(shown).length * GLYPH_W - 1);
    if (widths.size > 4000) widths.clear();
    widths.set(shown, w);
  }
  return Math.ceil(w * scale);
}

/** Width of `text` in art pixels at `scale`, in whichever font draws it (no trailing gap). */
export function textWidthPx(text: string, scale = 1): number {
  return pixelCovers(text) ? Math.max(0, textCells(text) * GLYPH_W - 1) * scale : deviceTextWidth(text, scale);
}

/**
 * Draw `text` with the device font on a 2D context with an identity transform, `k` device
 * pixels per art pixel; (x, y) is the top-left of the text's art-pixel box, as for the pixel font.
 */
export function drawDeviceText(g: CanvasRenderingContext2D, text: string, x: number, y: number, k: number, scale: number, color: string): void {
  const shown = fontCase(text);
  const rtl = runsRtl(shown);
  const width = deviceTextWidth(text, scale);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.font = deviceFont(EM * scale * k);
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.direction = rtl ? 'rtl' : 'ltr';
  g.textAlign = rtl ? 'right' : 'left';
  const cy = (y + ((GLYPH_H - 1) * scale) / 2) * k;
  g.fillText(shown, (rtl ? x + width : x) * k, cy);
  g.restore();
}

/**
 * Device pixels per art pixel for a pixel surface: the framing's integer scale when the surface
 * holds device text, else 1 (a plain pixel surface stays at art size). Capped so a 4K screen
 * doesn't repaint a huge canvas.
 */
export function surfaceScale(framingScale: number, needsDevice: boolean): number {
  return needsDevice ? Math.max(1, Math.min(6, Math.round(framingScale))) : 1;
}
