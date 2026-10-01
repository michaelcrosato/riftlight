/**
 * The RIFTLIGHT pixel logo: the 5×7 font rasterised at 4× into a bitmap, shaded top to
 * bottom (white → sand → orange → red), outlined in ink, with a plum drop shadow and a
 * glint that sweeps across now and then. Drawn as one `hud.sprite`.
 */
import { drawText } from '../../engine/animation/font';
import type { UiCanvas } from './kit';

const cache = new Map<string, { w: number; h: number; on: Uint8Array }>();

function bitmap(text: string, scale: number) {
  const key = `${text}@${scale}`;
  let b = cache.get(key);
  if (b) return b;
  const w = text.length * 6 * scale + 2;
  const h = 7 * scale + 2;
  const on = new Uint8Array(w * h);
  drawText(text, 1, 1, (x, y) => {
    if (x >= 0 && y >= 0 && x < w && y < h) on[y * w + x] = 1;
  }, scale);
  b = { w, h, on };
  cache.set(key, b);
  return b;
}

/** The biggest logo scale (4, 3 or 2) that fits `width` art pixels with a margin. */
export function logoScale(width: number, text = 'RIFTLIGHT'): number {
  for (const s of [4, 3, 2]) if (text.length * 6 * s + 12 <= width) return s;
  return 1;
}

const BANDS = ['w', 'w', 's', 's', 's', 'o', 'o', 'r'];

/** Draw the logo centred at (cx, y). `t` drives the glint; `scale` the letter size (4 = 218 px wide). */
export function drawLogo(ui: UiCanvas, cx: number, y: number, t: number, text = 'RIFTLIGHT', scale = 4): { w: number; h: number } {
  const b = bitmap(text, scale);
  const W = b.w + 2;
  const H = b.h + 3;
  const glint = ((t * 0.45) % 2.2) * (W + H) - H; // a diagonal sweep every ~5 s
  const rows: string[] = [];
  for (let y = -1; y < b.h + 2; y++) {
    let row = '';
    for (let x = -1; x < b.w + 1; x++) {
      const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < b.w && yy < b.h && b.on[yy * b.w + xx] === 1;
      if (at(x, y)) {
        const band = BANDS[Math.min(BANDS.length - 1, Math.floor(((y - 1) / (b.h - 2)) * BANDS.length))]!;
        const d = x + y - glint;
        row += d >= 0 && d < 3 ? 'g' : (x + y) % 9 === 0 && band === 's' ? 'w' : band;
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) || at(x - 1, y - 1) || at(x + 1, y + 1) || at(x - 1, y + 1) || at(x + 1, y - 1)) row += 'k';
      else if (at(x - 2, y - 2) || at(x - 2, y - 1) || at(x - 1, y - 2)) row += 'p';
      else row += '.';
    }
    rows.push(row);
  }
  ui.sprite(Math.round(cx - W / 2), y, rows, { w: 'white', s: 'sand', o: 'orange', r: 'red', k: 'ink', p: 'plum', g: 'white' });
  return { w: W, h: H };
}

/**
 * The rift behind the logo: a jagged tear of light across the screen that breathes, with
 * sparks drifting up out of it. Deterministic in `t` (films and captures repeat), drawn in
 * whole art pixels from the palette.
 */
export function drawRift(ui: UiCanvas, cx: number, cy: number, width: number, t: number): void {
  const half = Math.floor(width / 2);
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.7);
  for (let x = -half; x <= half; x++) {
    const edge = 1 - Math.abs(x) / half; // 1 at the centre, 0 at the ends
    const jag = Math.round(Math.sin(x * 0.37 + t * 2.3) * 1.4 + Math.sin(x * 0.11 - t * 0.9) * 2);
    const glow = Math.max(0, Math.round(edge * (4 + 3 * breathe)));
    if (glow <= 0) continue;
    const y = cy + jag;
    // outer glow: a dithered navy/blue halo, then the bright core
    for (let k = glow + 3; k > glow; k--) if ((x + k) % 2 === 0) {
      ui.rect(cx + x, y - k, 1, 1, 'navy');
      ui.rect(cx + x, y + k, 1, 1, 'navy');
    }
    ui.rect(cx + x, y - glow, 1, glow * 2 + 1, 'blue');
    const core = Math.max(0, glow - 2);
    ui.rect(cx + x, y - core, 1, core * 2 + 1, 'cyan');
    if (core > 1) ui.rect(cx + x, y - 1, 1, 3, 'white');
  }
  // sparks: each rises from the tear, sways and fades
  for (let i = 0; i < 26; i++) {
    const seed = Math.sin(i * 91.7) * 43758.5453;
    const r = seed - Math.floor(seed);
    const life = 1.6 + r * 1.4;
    const age = (t * 0.8 + r * 7) % life;
    const sx = cx + Math.round((r - 0.5) * width * 0.9 + Math.sin(age * 3 + i) * 3);
    const sy = cy - Math.round(age * (12 + r * 14));
    const c = age < life * 0.35 ? 'white' : age < life * 0.7 ? 'cyan' : 'sky';
    ui.rect(sx, sy, 1, 1, c);
  }
}
