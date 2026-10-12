/**
 * Texture sheets (`npm run tex -- sheet`): the texture at 1× and ×4, a 3×3 tiling when it tiles,
 * on a cube and a cylinder at game scale (the level and town zooms, at the default texel
 * density), its frames one by one, its palette and its check. Transparent texels show over a dim
 * checker. Software-drawn, like the model sheets; the Asset Lab is the truth. The import sheet
 * (`npm run tex -- import`) puts a source sheet and its imported defs side by side.
 */
import { Canvas, type RGB, type SheetImage } from '../animation/raster';
import { column, row, textBox, titleBar, type Line } from '../inspect/render';
import { buildModel } from '../model/build';
import { GAME_VIEW, renderGameScale, swatches, upscale } from '../model/sheet';
import { hexString } from '../model/import/colours';
import { DEFAULT_TEXEL } from '../model/uv';
import { PALETTE, type PaletteColor } from '../palette';
import type { RgbaImage } from '../png';
import { bakeTexture, type BakedTexture } from './bake';
import { TextureCatalog } from './catalog';
import type { SheetImport } from './import';
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

/** A 1 m cube and a cylinder wearing the texture, through Riftlight's camera at the level and town zooms. */
export function onShapes(def: TextureDef, texel = DEFAULT_TEXEL): SheetImage {
  const shapes = buildModel(
    {
      id: `tex:${def.id}`,
      about: 'texture preview',
      tags: [],
      texel,
      palette: { a: 'white' },
      parts: [
        { box: [1, 1, 1], at: [-0.75, 0.5, 0], tex: def.id },
        { cyl: [0.8, 1.2, 0.8], seg: 10, at: [0.75, 0.6, 0], tex: def.id },
      ],
    },
    { textures: new TextureCatalog([def]) },
  );
  const zooms = [GAME_VIEW.zooms.level, GAME_VIEW.zooms.town];
  return row(zooms.map((z, i) => renderGameScale(shapes.object, z, { label: `${i ? 'TOWN' : 'LEVEL'} ZOOM ${z}, ${texel} TEXELS/M, X4` })));
}

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
  const shapes = def.tile && !b.problems.length ? [onShapes(def)] : [];
  const body = column([row(views), ...shapes, ...(strip.length ? [row(strip)] : []), row([swatches({ ...def.palette, ...palette }, 220, used), textBox(lines.map((l) => ({ ...l, text: l.text.replace(/×/g, 'x').replace(/…/g, '...') })), 640, 0, 'CHECK')])]);
  const sub = `${def.tile ? 'tiles  ' : ''}${frames > 1 ? `${frames} frames  ` : ''}${def.tags.length ? `tags ${def.tags.join(' ')}` : ''}`;
  return column([titleBar(`${def.id}: ${def.about}`, body.width, sub), body]);
}

const PANEL: RGB = [36, 40, 56];
const rgbOf = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
/** The dim checker transparent texels show over (as `texelImage` draws it). */
const checker = (x: number, y: number): RGB => {
  const c = ((x >> 1) + (y >> 1)) % 2 ? 52 : 44;
  return [c, c + 4, c + 16];
};

/** Cells on their grid, ×`k`, 2 pixels apart; `cell(i)` draws cell `i` (gw × gh). */
function cellGrid(columns: number, rows: number, gw: number, gh: number, k: number, cell: (i: number) => SheetImage): SheetImage {
  const gap = 2;
  const W = columns * gw * k + (columns + 1) * gap;
  const H = rows * gh * k + (rows + 1) * gap;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...PANEL, 255], i * 4);
  for (let i = 0; i < columns * rows; i++) {
    const img = upscale(cell(i), k);
    const x0 = gap + (i % columns) * (gw * k + gap);
    const y0 = gap + Math.floor(i / columns) * (gh * k + gap);
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y0 + y) * W + x0) * 4);
  }
  return { width: W, height: H, data };
}

/** A legend character as the sheet's capitals-only font can show it. */
const keyOf = (ch: string) => (/[A-Z]/.test(ch) ? `'${ch}' (upper case)` : `'${ch}'`);

export interface ImportSheetOptions {
  readonly title: string;
  readonly subtitle?: string;
  /** The cell size the sheet was sliced on. */
  readonly grid: readonly [w: number, h: number];
  /** Each def's check, for the summary. */
  readonly checks?: readonly TextureCheck[];
}

/**
 * The import sheet: the source (alpha over the dim checker) and the imported defs, baked, side
 * by side on the same grid (cells not imported dark); every source colour with its legend
 * character, slot and PALETTE entry; the merges (source colours that bake as one entry); the
 * checks.
 */
export function renderImportSheet(img: RgbaImage, r: SheetImport, o: ImportSheetOptions): SheetImage {
  const [gw, gh] = o.grid;
  const k = Math.max(1, Math.min(8, Math.floor(384 / Math.max(img.width, img.height))));
  const source = cellGrid(r.columns, r.rows, gw, gh, k, (i) => {
    const x0 = (i % r.columns) * gw;
    const y0 = Math.floor(i / r.columns) * gh;
    const data = new Uint8ClampedArray(gw * gh * 4);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const s = ((y0 + y) * img.width + x0 + x) * 4;
        const a = img.data[s + 3]! / 255;
        const bg = checker(x, y);
        data.set([...[0, 1, 2].map((c) => Math.round(img.data[s + c]! * a + bg[c]! * (1 - a))), 255], (y * gw + x) * 4);
      }
    }
    return { width: gw, height: gh, data };
  });
  // the defs baked, each frame of a strip back on its cell
  const baked = new Map(r.defs.map((d) => [d.id, bakeTexture(d)]));
  const strips = new Map<string, number[]>();
  for (const c of r.cells) if (c.id) strips.set(c.id, [...(strips.get(c.id) ?? []), c.index]);
  const mapped = cellGrid(r.columns, r.rows, gw, gh, k, (i) => {
    const id = r.cells[i]!.id;
    const b = id ? baked.get(id) : undefined;
    const f = id ? strips.get(id)!.indexOf(i) : 0;
    const data = new Uint8ClampedArray(gw * gh * 4);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const t = (y * (b?.width ?? 0) + f * gw + x) * 4;
        const bg = checker(x, y);
        data.set(b && b.rgba[t + 3] ? [b.rgba[t]!, b.rgba[t + 1]!, b.rgba[t + 2]!, 255] : b ? [...bg, 255] : [bg[0] - 24, bg[1] - 24, bg[2] - 24, 255], (y * gw + x) * 4);
      }
    }
    return { width: gw, height: gh, data };
  });
  const views = row([column([source, textBox([{ text: 'SOURCE (ALPHA OVER THE CHECKER)' }], source.width)]), column([mapped, textBox([{ text: 'MAPPED: THE DEFS, BAKED (NOT IMPORTED: DARK)' }], mapped.width)])]);
  const W = Math.max(views.width, 640);

  // every source colour: source and mapped chips, its character, hex, slot, entry and pixels
  const merged = new Set(r.merges.flatMap((m) => m.sources.map((c) => c.hex)));
  const colW = 310;
  const nCols = Math.max(1, Math.min(Math.ceil(r.colours.length / 24), Math.floor((W - 8) / colW)));
  const perColumn = Math.ceil(r.colours.length / nCols);
  const table = new Canvas(W, 22 + perColumn * 14 + 6);
  table.rect(0, 0, W, table.height, PANEL);
  table.text(`SOURCE -> SLOT -> PALETTE: ${r.colours.length} COLOURS, ${new Set(r.colours.map((c) => c.slot)).size} SLOTS. MERGED IN YELLOW; KEYS LOWER CASE UNLESS MARKED`, 8, 8, TEXT);
  r.colours.forEach((c, i) => {
    const x = 8 + Math.floor(i / perColumn) * colW;
    const y = 22 + (i % perColumn) * 14;
    table.rect(x, y, 20, 10, rgbOf(c.hex));
    table.rect(x + 22, y, 20, 10, rgbOf(PALETTE[c.colour]));
    table.text(`${keyOf(c.char)} ${hexString(c.hex)} -> ${c.slot} ${c.colour} ${c.pixels} PX`, x + 48, y + 1, merged.has(c.hex) ? WARN : TEXT);
  });
  const lines: Line[] = r.merges.length
    ? r.merges.map((m) => ({ text: `${m.colour} <- ${m.sources.map((c) => `${hexString(c.hex)} ${keyOf(c.char)} ${c.slot} (${c.pixels} px)`).join(', ')}`, color: WARN }))
    : [{ text: 'none: every source colour has a PALETTE entry of its own', color: GOOD }];
  if (r.merges.length) lines.push({ text: 'one that should not be: point its character at a slot of its own in the legend, and bind that slot in the palette', color: DIM });
  const checks = o.checks ?? [];
  const bad = checks.filter((c) => c.problems.length);
  const warned = checks.filter((c) => c.warnings.length);
  const checkLines: Line[] = [{ text: `${r.defs.length} def(s): ${bad.length} with problems, ${warned.length} with warnings`, color: bad.length ? BAD : warned.length ? WARN : GOOD }];
  for (const c of [...bad, ...warned.filter((w) => !bad.includes(w))]) {
    for (const p of c.problems) checkLines.push({ text: `${c.id}: x ${p}`, color: BAD });
    for (const w of c.warnings) checkLines.push({ text: `${c.id}: ! ${w}`, color: WARN });
  }
  const body = column([views, { width: W, height: table.height, data: table.data }, textBox(lines, W, 0, `MERGES (${r.merges.length}): SOURCE COLOURS THAT BAKE AS ONE PALETTE ENTRY`), textBox(checkLines.slice(0, 24), W, 0, 'CHECK')]);
  return column([titleBar(o.title, body.width, o.subtitle ?? ''), body]);
}
