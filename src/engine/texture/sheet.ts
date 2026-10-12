/**
 * Texture sheets (`npm run tex -- sheet`): the texture at 1× and ×4, a 3×3 tiling when it tiles,
 * its frames one by one, its palette and its check. Transparent texels show over a dim checker.
 * Software-drawn, like the model sheets; the Asset Lab is the truth.
 */
import type { RGB, SheetImage } from '../animation/raster';
import { column, row, textBox, titleBar, type Line } from '../inspect/render';
import { swatches, upscale } from '../model/sheet';
import type { PaletteColor } from '../palette';
import type { BakedTexture } from './bake';
import type { TextureDef } from './types';
import type { TextureCheck } from './validate';

const DIM: RGB = [150, 156, 180];
const TEXT: RGB = [230, 232, 240];
const WARN: RGB = [255, 205, 117];
const BAD: RGB = [255, 110, 120];
const GOOD: RGB = [56, 183, 100];

/** Texels as an image, transparent ones over a 2-texel dim checker; `x0`/`w` crop a frame. */
export function texelImage(b: BakedTexture, x0 = 0, w = b.width): SheetImage {
  const data = new Uint8ClampedArray(w * b.height * 4);
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * b.width + x0 + x) * 4;
      const o = (y * w + x) * 4;
      if (b.rgba[k + 3]) data.set([b.rgba[k]!, b.rgba[k + 1]!, b.rgba[k + 2]!, 255], o);
      else {
        const c = ((x >> 1) + (y >> 1)) % 2 ? 52 : 44;
        data.set([c, c + 4, c + 16, 255], o);
      }
    }
  }
  return { width: w, height: b.height, data };
}

/** The image repeated `nx × ny` times. */
export function tiled(img: SheetImage, nx: number, ny: number): SheetImage {
  const W = img.width * nx;
  const H = img.height * ny;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(img.data.subarray(((y % img.height) * img.width + (x % img.width)) * 4, ((y % img.height) * img.width + (x % img.width)) * 4 + 4), (y * W + x) * 4);
  return { width: W, height: H, data };
}

const labelled = (img: SheetImage, label: string) => column([img, textBox([{ text: label, color: DIM }], Math.max(img.width, 60))]);

/** The sheet; `palette` is the bake's re-binding, so the swatches show the colours drawn. */
export function renderTextureSheet(def: TextureDef, b: BakedTexture, check: TextureCheck, palette?: Readonly<Record<string, PaletteColor | number>>): SheetImage {
  const base = texelImage(b);
  const k = Math.max(2, Math.min(8, Math.floor(256 / Math.max(b.width, b.height))));
  const views: SheetImage[] = [labelled(base, '1X'), labelled(upscale(base, k), `X${k}`)];
  if (def.tile) views.push(labelled(upscale(tiled(base, 3, 3), Math.max(1, Math.floor(k / 2))), `3X3 TILED, X${Math.max(1, Math.floor(k / 2))}`));
  const frames = def.frames ?? 1;
  const strip: SheetImage[] = [];
  if (frames > 1 && b.width % frames === 0) for (let f = 0; f < frames; f++) strip.push(labelled(upscale(texelImage(b, (f * b.width) / frames, b.width / frames), k), `FRAME ${f}`));
  const used = new Set<string>();
  for (const v of b.indices) if (v) used.add(b.slots[v - 1]!);
  const lines: Line[] = [];
  const m = check.metrics;
  if (m) lines.push({ text: `${m.width} x ${m.height} texels  ${m.colours} colours  ${Math.round(m.isolated * 100)}% single texels${m.seam ? `  seam ${Math.round(m.seam.wrap * 100)}% vs ${Math.round(m.seam.inside * 100)}% inside` : ''}`, color: TEXT });
  for (const p of check.problems) lines.push({ text: `x ${p}`, color: BAD });
  for (const w of check.warnings) lines.push({ text: `! ${w}`, color: WARN });
  if (!check.problems.length && !check.warnings.length) lines.push({ text: 'NO PROBLEMS, NO WARNINGS', color: GOOD });
  const body = column([row(views), ...(strip.length ? [row(strip)] : []), row([swatches({ ...def.palette, ...palette }, 220, used), textBox(lines.map((l) => ({ ...l, text: l.text.replace(/×/g, 'x').replace(/…/g, '...') })), 640, 0, 'CHECK')])]);
  const sub = `${def.tile ? 'tiles  ' : ''}${frames > 1 ? `${frames} frames  ` : ''}${def.tags.length ? `tags ${def.tags.join(' ')}` : ''}`;
  return column([titleBar(`${def.id}: ${def.about}`, body.width, sub), body]);
}
