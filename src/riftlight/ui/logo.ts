/**
 * The RIFTLIGHT pixel logo: the 5×7 font rasterised at 4× into a bitmap, shaded top to
 * bottom (white → sand → orange → red), outlined in ink, with a plum drop shadow and a
 * glint that sweeps across now and then. Drawn as one `hud.sprite`.
 */
import { drawText } from '../../engine/animation/font';
import type { UiCanvas } from './kit';

const SCALE = 4;
let cache: { text: string; w: number; h: number; on: Uint8Array } | null = null;

function bitmap(text: string) {
  if (cache?.text === text) return cache;
  const w = text.length * 6 * SCALE + 2;
  const h = 7 * SCALE + 2;
  const on = new Uint8Array(w * h);
  drawText(text, 1, 1, (x, y) => {
    if (x >= 0 && y >= 0 && x < w && y < h) on[y * w + x] = 1;
  }, SCALE);
  cache = { text, w, h, on };
  return cache;
}

const BANDS = ['w', 'w', 's', 's', 's', 'o', 'o', 'r'];

/** Draw the logo centred at (cx, y). `t` drives the glint. */
export function drawLogo(ui: UiCanvas, cx: number, y: number, t: number, text = 'RIFTLIGHT'): { w: number; h: number } {
  const b = bitmap(text);
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
