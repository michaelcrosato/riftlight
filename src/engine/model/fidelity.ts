/**
 * Fidelity scoring (docs/assets/importing.md *Scores*): how faithfully one set of coloured
 * triangles (a translation: an import's ModelDef, later an agent's trace) draws another (its
 * source). Both are drawn by the software rasterizer the model sheets use, at 4 yaws, at game
 * scale (Riftlight's camera at the level zoom) and close up. Per view: the silhouette IoU
 * (pixels either covers, the background left out) and the mean OKLab distance between their
 * flat colours where both cover a pixel; overall, the bounds delta. Pure, so tools and tests
 * share it.
 *
 *   const score = scoreFidelity(imported.source, modelTriangles(def));
 *   score.iou       // the worst game-scale view; an import below 0.98 is an importer bug
 */
import { Box3, Group, Vector3 } from 'three/webgpu';
import { Canvas, type RGB, type SheetImage } from '../animation/raster';
import { column, renderView, row, textBox, titleBar, viewBasis, worldTriangles, type Line } from '../inspect/render';
import { TEXTURE_LIBRARY } from '../texture/library';
import { modelDef, prepareModel } from './build';
import type { ModelOptions } from './expand';
import { MODEL_LIBRARY } from './library';
import { oklab, oklabDistance, type OkLab } from './oklab';
import { flatTriangles, upscale } from './sheet';
import { DEFAULT_TEXEL } from './uv';
import type { ModelDef, Vec3 } from './types';
import { GAME_VIEW, gamePxPerMetre } from './view';

/** Triangles with a colour each: any source, any translation. */
export interface ColouredTris {
  /** 9 numbers a triangle, metres, model space. */
  readonly positions: ArrayLike<number>;
  /** sRGB per triangle (0xrrggbb). */
  readonly colours: ArrayLike<number>;
}

/** The yaws both scales are drawn at: the game's own and the other three diagonals. */
export const FIDELITY_YAWS = [45, 135, 225, 315] as const;
/** Pixels across the frame's diagonal at close scale. */
export const CLOSE_PX = 240;
/** Close views look down less than the game's camera, as the sheets' turntable does. */
const CLOSE_PITCH = 20;
/** The longest side a view may take (a stray part far away stays cheap). */
const MAX_SIDE = 1024;

export interface FidelityView {
  readonly yaw: number;
  readonly scale: 'game' | 'close';
  /** Pixels per metre. */
  readonly ppm: number;
  readonly iou: number;
  /** Mean OKLab distance where both cover a pixel (null when nothing overlaps). */
  readonly colour: number | null;
  readonly pixels: { readonly source: number; readonly translation: number; readonly both: number };
}

export interface FidelityScore {
  /** The worst game-scale IoU. */
  readonly iou: number;
  /** The worst close-scale IoU. */
  readonly iouClose: number;
  /** Mean OKLab distance over every overlapping pixel of every view. */
  readonly colour: number;
  /** Translation's size minus source's (m). */
  readonly bounds: Vec3;
  readonly views: readonly FidelityView[];
}

function boundsOf(t: ColouredTris): Box3 {
  const b = new Box3();
  const v = new Vector3();
  for (let i = 0; i + 2 < t.positions.length; i += 3) b.expandByPoint(v.set(t.positions[i]!, t.positions[i + 1]!, t.positions[i + 2]!));
  return b;
}

export interface FidelityRaster {
  readonly side: number;
  readonly ids: Uint16Array;
  readonly data: Uint8ClampedArray;
}

/** One view of `fidelityViews`: square, `side` pixels, `ppm` pixels a metre, centred on `frame`. */
export interface FidelityViewFrame {
  readonly yaw: number;
  readonly scale: 'game' | 'close';
  readonly pitch: number;
  readonly ppm: number;
  readonly side: number;
  readonly frame: Box3;
}

/** Flat colours through one view (ids mark coverage): what the scores count. */
export function fidelityRaster(t: ColouredTris, yaw: number, pitch: number, ppm: number, frame: Box3, side: number): FidelityRaster {
  const { f, r, u } = viewBasis(yaw, pitch);
  const centre = frame.getCenter(new Vector3());
  const cv = new Canvas(side, side);
  const d = new Vector3();
  const p = t.positions;
  const proj = (i: number): [number, number, number] => {
    d.set(p[i]! - centre.x, p[i + 1]! - centre.y, p[i + 2]! - centre.z);
    return [side / 2 + d.dot(r) * ppm, side / 2 - d.dot(u) * ppm, -d.dot(f)];
  };
  const rect = { x: 0, y: 0, w: side, h: side };
  for (let k = 0; k * 9 + 8 < p.length; k++) {
    const [a, b, c] = [proj(k * 9), proj(k * 9 + 3), proj(k * 9 + 6)];
    const hex = t.colours[k]!;
    cv.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255], 1, rect);
  }
  return { side, ids: cv.ids, data: cv.data };
}

/** The 8 views both are drawn in (4 yaws at game scale, then close), framed on both. */
export function fidelityViews(source: ColouredTris, translation: ColouredTris): FidelityViewFrame[] {
  const frame = boundsOf(source).union(boundsOf(translation));
  if (frame.isEmpty()) frame.set(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
  const diag = Math.max(0.05, frame.getSize(new Vector3()).length());
  const game = gamePxPerMetre(GAME_VIEW.zooms.level);
  const scales = [
    { scale: 'game' as const, pitch: GAME_VIEW.pitch, ppm: Math.min(game, (MAX_SIDE - 4) / diag) },
    { scale: 'close' as const, pitch: CLOSE_PITCH, ppm: Math.min(Math.max(game, CLOSE_PX / diag), (MAX_SIDE - 4) / diag) },
  ];
  return scales.flatMap((s) => FIDELITY_YAWS.map((yaw) => ({ yaw, ...s, side: Math.ceil(diag * s.ppm) + 4, frame })));
}

const round = (v: number, k = 4) => Math.round(v * 10 ** k) / 10 ** k;

/** Score a translation against its source (see the file comment). */
export function scoreFidelity(source: ColouredTris, translation: ColouredTris): FidelityScore {
  const labs = new Map<number, OkLab>();
  const lab = (d: Uint8ClampedArray, i: number) => {
    const hex = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    let c = labs.get(hex);
    if (!c) labs.set(hex, (c = oklab(hex)));
    return c;
  };
  let colourSum = 0;
  let colourN = 0;
  const views: FidelityView[] = fidelityViews(source, translation).map((v) => {
    const s = fidelityRaster(source, v.yaw, v.pitch, v.ppm, v.frame, v.side);
    const t = fidelityRaster(translation, v.yaw, v.pitch, v.ppm, v.frame, v.side);
    let ns = 0;
    let nt = 0;
    let both = 0;
    let sum = 0;
    for (let k = 0; k < s.ids.length; k++) {
      const a = s.ids[k] !== 0;
      const b = t.ids[k] !== 0;
      if (a) ns++;
      if (b) nt++;
      if (a && b) {
        both++;
        sum += oklabDistance(lab(s.data, k * 4), lab(t.data, k * 4));
      }
    }
    colourSum += sum;
    colourN += both;
    const union = ns + nt - both;
    return { yaw: v.yaw, scale: v.scale, ppm: round(v.ppm, 2), iou: union ? round(both / union) : 1, colour: both ? round(sum / both) : null, pixels: { source: ns, translation: nt, both } };
  });
  const sb = boundsOf(source).getSize(new Vector3());
  const tb = boundsOf(translation).getSize(new Vector3());
  const worst = (scale: string) => Math.min(...views.filter((v) => v.scale === scale).map((v) => v.iou));
  return {
    iou: worst('game'),
    iouClose: worst('close'),
    colour: colourN ? round(colourSum / colourN) : 0,
    bounds: [round(tb.x - sb.x, 3), round(tb.y - sb.y, 3), round(tb.z - sb.z, 3)],
    views,
  };
}

/**
 * A ModelDef's triangles as the sheets draw them (`flatTriangles`), wound outward, with their
 * bound colours; a textured face takes its texel at the face's UV centroid, as the importer
 * samples an atlas.
 */
export function modelTriangles(idOrDef: string | ModelDef, opts: ModelOptions = {}): ColouredTris {
  const catalog = opts.catalog ?? MODEL_LIBRARY;
  const { expansion, compiled } = prepareModel(modelDef(idOrDef, catalog), opts, catalog);
  const tris = flatTriangles(compiled, expansion.model.palette, { texel: expansion.model.texel ?? DEFAULT_TEXEL, textures: opts.textures ?? TEXTURE_LIBRARY });
  const centre = (uv: ArrayLike<number>, k: number) => (uv[k]! + uv[k + 2]! + uv[k + 4]!) / 3;
  return {
    positions: tris.flatMap((t) => t.p.flatMap((v) => [v.x, v.y, v.z])),
    colours: tris.map((t) => {
      const [r, g, b] = t.tex ? t.tex.sample(centre(t.tex.uv, 0), centre(t.tex.uv, 1)) : t.color;
      return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    }),
  };
}

const MAGENTA: RGB = [255, 60, 220];
const CYAN: RGB = [115, 239, 247];
const TEXT: RGB = [230, 232, 240];
const DIM: RGB = [150, 156, 180];
const GOOD: RGB = [56, 183, 100];
const BAD: RGB = [255, 110, 120];
const PANEL: RGB = [36, 40, 56];

/** Shaded, the sheets' look: the inspect renderer over triangles of our own. */
export function fidelityShaded(t: ColouredTris, v: FidelityViewFrame): SheetImage {
  const tris: ReturnType<typeof worldTriangles> = [];
  const p = t.positions;
  for (let k = 0; k * 9 + 8 < p.length; k++) {
    const hex = t.colours[k]!;
    const at = (i: number) => new Vector3(p[k * 9 + i]!, p[k * 9 + i + 1]!, p[k * 9 + i + 2]!);
    tris.push({ a: at(0), b: at(3), c: at(6), color: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255], unlit: false, id: 1 });
  }
  return renderView(new Group(), { width: v.side, height: v.side, yaw: v.yaw, pitch: v.pitch, frame: v.frame, scale: v.ppm }, tris);
}

/** Where they differ: the source alone magenta, the translation alone cyan, both grey to red by colour distance. */
export function fidelityDifference(s: FidelityRaster, t: FidelityRaster): SheetImage {
  const cv = new Canvas(s.side, s.side);
  cv.rect(0, 0, s.side, s.side, PANEL);
  for (let k = 0; k < s.ids.length; k++) {
    const a = s.ids[k] !== 0;
    const b = t.ids[k] !== 0;
    if (!a && !b) continue;
    const x = k % s.side;
    const y = Math.floor(k / s.side);
    if (a && !b) cv.set(x, y, MAGENTA);
    else if (b && !a) cv.set(x, y, CYAN);
    else {
      const hex = (d: Uint8ClampedArray) => (d[k * 4]! << 16) | (d[k * 4 + 1]! << 8) | d[k * 4 + 2]!;
      const e = Math.min(1, oklabDistance(oklab(hex(s.data)), oklab(hex(t.data))) / 0.1);
      cv.set(x, y, [90 + 165 * e, 96 * (1 - e) + 40 * e, 110 * (1 - e) + 50 * e]);
    }
  }
  return { width: s.side, height: s.side, data: cv.data };
}

export interface FidelitySheetOptions {
  readonly title: string;
  readonly subtitle?: string;
  /** Source and mapped colours side by side, one row a slot. */
  readonly swatches?: readonly { readonly slot: string; readonly source: number; readonly mapped: number; readonly name: string }[];
  /** More lines under the scores (parts, notes). */
  readonly notes?: readonly string[];
  /** The IoU an import should reach (drawn green at or above, red below). */
  readonly threshold?: number;
}

/**
 * The fidelity sheet: per view (4 yaws, game scale ×4 and close), the source, the translation
 * and their difference; the scores; the colour swatches when given.
 */
export function renderFidelity(source: ColouredTris, translation: ColouredTris, score: FidelityScore, o: FidelitySheetOptions): SheetImage {
  const views = fidelityViews(source, translation);
  const cells = views.map((v, i) => {
    const k = v.scale === 'game' ? 4 : 1;
    const s = fidelityRaster(source, v.yaw, v.pitch, v.ppm, v.frame, v.side);
    const t = fidelityRaster(translation, v.yaw, v.pitch, v.ppm, v.frame, v.side);
    const f = score.views[i]!;
    const label = textBox([{ text: `${v.scale} yaw ${v.yaw}: iou ${f.iou}${f.colour !== null ? `, dE ${f.colour}` : ''}`, color: f.iou >= (o.threshold ?? 0) ? TEXT : BAD }], Math.max(120, v.side * k * 3 + 16));
    return column([label, row([upscale(fidelityShaded(source, v), k), upscale(fidelityShaded(translation, v), k), upscale(fidelityDifference(s, t), k)])]);
  });
  const body = column([row(cells.slice(0, 4)), row(cells.slice(4))]);
  const w = body.width;
  const lines: Line[] = [
    { text: `game-scale iou ${score.iou} (worst of 4)   close iou ${score.iouClose}   colour dE ${score.colour}   bounds delta ${score.bounds.join(' x ')} m`, color: score.iou >= (o.threshold ?? 0) ? GOOD : BAD },
    { text: 'each view: source | translation | difference (source only magenta, translation only cyan, both grey to red by colour)', color: DIM },
    ...(o.notes ?? []).map((text) => ({ text, color: DIM })),
  ];
  const parts: SheetImage[] = [titleBar(o.title, w, o.subtitle ?? ''), body, textBox(lines, w, 0, 'SCORES')];
  if (o.swatches?.length) {
    const sw = new Canvas(w, 22 + o.swatches.length * 14 + 6);
    sw.rect(0, 0, w, sw.height, PANEL);
    sw.text('SOURCE -> PALETTE', 8, 8, TEXT);
    o.swatches.forEach((s, i) => {
      const y = 22 + i * 14;
      const rgb = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
      sw.rect(8, y, 20, 10, rgb(s.source));
      sw.rect(30, y, 20, 10, rgb(s.mapped));
      sw.text(`${s.slot}: #${s.source.toString(16).padStart(6, '0')} -> ${s.name}`, 58, y + 1, TEXT);
    });
    parts.push({ width: w, height: sw.height, data: sw.data });
  }
  return column(parts);
}
