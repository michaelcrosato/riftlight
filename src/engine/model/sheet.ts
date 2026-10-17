/**
 * Model sheets for agents (`npm run model -- sheet`, docs/ASSETS.md): a model drawn the ways
 * that answer "is it right?": an 8-angle turntable, front / side / top orthographic views on a
 * 0.1 m grid with its dimensions, game-scale previews (Riftlight's iso camera at the level and
 * town zooms, one art pixel per pixel, then ×4), its palette, part labels, anchors and
 * colliders, the warnings, and the previous version in magenta. Built on the inspect renderer
 * and the software canvas (no GPU, no DOM), so it runs in Node and in the browser.
 */
import { Box3, type Object3D, Vector3 } from 'three/webgpu';
import { Canvas, texelSampler, texturedShader, type Rect, type RGB, type SheetImage, type TexelSampler } from '../animation/raster';
import { INSPECT_BG, column, renderTurntable, renderView, row, textBox, titleBar, worldTriangles, type Line } from '../inspect/render';
import { bindingHex, buildModel, expandModel, ModelError, modelDef, type ModelBuild, type ModelReport } from './build';
import { boundsOf, compileParts, type Bounds, type Compiled } from './compile';
import type { ExpandedModel, ModelOptions } from './expand';
import { bakeTexture } from '../texture/bake';
import type { TextureCatalog } from '../texture/catalog';
import { TextureError } from '../texture/convert';
import { TEXTURE_LIBRARY } from '../texture/library';
import { MODEL_LIBRARY } from './library';
import type { ModelDef } from './types';
import { DEFAULT_TEXEL, partUVs } from './uv';
import { checkModel, type ModelCheck } from './validate';
import { GAME_VIEW, gamePxPerMetre } from './view';

export { GAME_VIEW, gamePxPerMetre } from './view';

const PANEL: RGB = [36, 40, 56];
const GRID_FINE: RGB = [46, 52, 72];
const GRID: RGB = [62, 72, 100];
const FLOOR: RGB = [150, 156, 180];
const TEXT: RGB = [230, 232, 240];
const DIM: RGB = [150, 156, 180];
const WARN: RGB = [255, 205, 117];
const BAD: RGB = [255, 110, 120];
const GOOD: RGB = [56, 183, 100];
const MAGENTA: RGB = [255, 60, 220];
const ANCHOR: RGB = [115, 239, 247];
const COLLIDER: RGB = [56, 183, 100];

/** 0xrrggbb as [r, g, b]. */
export const rgbOf = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const fmt = (v: number) => `${+v.toFixed(2)}`;

/** Model-space triangles of compiled parts, with their slot colour (for the ortho views and compare). */
export interface FlatTri {
  readonly p: readonly [Vector3, Vector3, Vector3];
  readonly color: RGB;
  readonly unlit: boolean;
  readonly part: number;
  /** A textured part's triangle: its UVs (a, b, c) and its texture's sampler. */
  readonly tex?: { readonly uv: ArrayLike<number>; readonly sample: TexelSampler };
}

/** Where textured parts' textures come from, and at what density (the build's own). */
export interface SheetTextures {
  readonly texel: number;
  readonly textures: TextureCatalog;
}

/** Textured parts get their texels when `tex` is given (the ortho views), else their slot colour (compare). */
export function flatTriangles(compiled: Compiled, palette: ExpandedModel['palette'], tex?: SheetTextures): FlatTri[] {
  const out: FlatTri[] = [];
  const samplers = new Map<string, TexelSampler | null>();
  const samplerOf = (id: string): TexelSampler | null => {
    if (!samplers.has(id)) {
      const def = tex?.textures.has(id) ? tex.textures.get(id) : null;
      const b = def ? bakeTexture(def) : null;
      samplers.set(id, b && !b.problems.length ? texelSampler(b.rgba, b.width, b.height, { repeat: def!.tile === true, bottomFirst: false }) : null);
    }
    return samplers.get(id)!;
  };
  compiled.parts.forEach((p, i) => {
    const sample = p.tex && !p.glow && tex ? samplerOf(p.tex) : null;
    const uvs = sample ? partUVs(p, tex!.texel, tex!.textures.get(p.tex!).size) : null;
    const color: RGB = sample ? [255, 255, 255] : rgbOf(palette[p.slot] === undefined ? 0xff00ff : bindingHex(palette[p.slot]!));
    const order = p.matrix.determinant() < 0 ? [0, 2, 1] : [0, 1, 2]; // mirrored: keep faces outward, as layoutModel does
    for (let k = 0; k < p.tris.length; k += 9) {
      const v = order.map((o) => new Vector3(p.tris[k + o * 3]!, p.tris[k + o * 3 + 1]!, p.tris[k + o * 3 + 2]!).applyMatrix4(p.matrix)) as [Vector3, Vector3, Vector3];
      const uv = uvs ? order.flatMap((o) => [uvs[(k / 3 + o) * 2]!, uvs[(k / 3 + o) * 2 + 1]!]) : null;
      out.push({ p: v, color, unlit: p.glow, part: i + 1, ...(uv && sample ? { tex: { uv, sample } } : {}) });
    }
  });
  return out;
}

type Axis = 'front' | 'side' | 'top';

/** Screen axes of an orthographic view: right, up, and toward the viewer. */
function orthoAxes(axis: Axis): { r: Vector3; u: Vector3; f: Vector3 } {
  if (axis === 'front') return { r: new Vector3(1, 0, 0), u: new Vector3(0, 1, 0), f: new Vector3(0, 0, 1) };
  if (axis === 'side') return { r: new Vector3(0, 0, -1), u: new Vector3(0, 1, 0), f: new Vector3(1, 0, 0) };
  return { r: new Vector3(1, 0, 0), u: new Vector3(0, 0, -1), f: new Vector3(0, 1, 0) };
}

export interface OrthoOptions {
  readonly size?: number;
  /** Pixels per metre (shared by the three views so they compare). */
  readonly scale: number;
  /** The frame (model space) the views are centred on. */
  readonly frame: Box3;
  /** The previous version, drawn as a magenta outline. */
  readonly previous?: readonly FlatTri[];
  /** Write part names at their centres. */
  readonly labels?: readonly { text: string; at: Vector3 }[];
  readonly anchors?: ModelBuild['anchors'];
  readonly colliders?: ModelBuild['colliders'];
}

/** One orthographic view: 0.1 m grid (0.5 m lines brighter), the model, its dimensions. */
export function renderOrtho(tris: readonly FlatTri[], axis: Axis, o: OrthoOptions): SheetImage {
  const W = o.size ?? 240;
  const H = W;
  const labelH = 12;
  const { r, u, f } = orthoAxes(axis);
  const centre = o.frame.getCenter(new Vector3());
  const s = o.scale;
  const proj = (p: Vector3): [number, number, number] => {
    const d = p.clone().sub(centre);
    return [W / 2 + d.dot(r) * s, (H - labelH) / 2 - d.dot(u) * s, d.dot(f)];
  };
  const cv = new Canvas(W, H);
  cv.rect(0, 0, W, H, PANEL);
  const rect: Rect = { x: 0, y: 0, w: W, h: H - labelH };
  // grid lines every 0.1 m in the view plane, through model-space multiples of 0.1 m
  const toWorld = (sx: number, sy: number) => ({ x: (sx - W / 2) / s + centre.dot(r), y: ((H - labelH) / 2 - sy) / s + centre.dot(u) });
  const lo = toWorld(0, H - labelH);
  const hi = toWorld(W, 0);
  for (let k = Math.ceil(lo.x * 10); k <= Math.floor(hi.x * 10); k++) {
    const x = Math.round(W / 2 + (k / 10 - centre.dot(r)) * s);
    cv.line(x, 0, x, H - labelH - 1, k % 5 === 0 ? GRID : GRID_FINE);
  }
  for (let k = Math.ceil(lo.y * 10); k <= Math.floor(hi.y * 10); k++) {
    const y = Math.round((H - labelH) / 2 - (k / 10 - centre.dot(u)) * s);
    cv.line(0, y, W - 1, y, k % 5 === 0 ? GRID : GRID_FINE);
  }
  if (axis !== 'top') {
    const y = Math.round((H - labelH) / 2 - (0 - centre.dot(u)) * s);
    cv.line(0, y, W - 1, y, FLOOR); // the floor, y = 0
  }
  drawTris(cv, tris, proj, { r, u, f }, rect);
  if (o.previous) outlineOf(cv, o.previous, proj, rect, MAGENTA);
  // anchors (a dot and the name) and colliders (a box's outline, a cylinder's or hull's bounds)
  for (const c of o.colliders ?? []) {
    if (c.kind === 'box') boxLines(cv, proj, new Vector3(...c.center), new Vector3(...c.half), COLLIDER);
    else if (c.kind === 'cyl') boxLines(cv, proj, new Vector3(...c.center), new Vector3(c.radius, c.halfHeight, c.radius), COLLIDER);
    else if (c.points.length) {
      const b = new Box3().setFromArray(c.points as number[]);
      boxLines(cv, proj, b.getCenter(new Vector3()), b.getSize(new Vector3()).multiplyScalar(0.5), COLLIDER);
    }
  }
  for (const [name, a] of Object.entries(o.anchors ?? {})) {
    const p = proj(new Vector3(...a.at));
    cv.rect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 3, 3, ANCHOR);
    cv.text(name, Math.round(p[0]) + 4, Math.round(p[1]) - 3, ANCHOR);
  }
  for (const l of o.labels ?? []) {
    const p = proj(l.at);
    const x = Math.round(p[0]) - l.text.length * 3;
    cv.rect(x - 1, Math.round(p[1]) - 4, l.text.length * 6 + 1, 9, INSPECT_BG, 0.7);
    cv.text(l.text, x, Math.round(p[1]) - 3, TEXT);
  }
  // dimensions along the bottom and the right edge
  const b = boxOf(tris);
  if (b) {
    const w = (axis === 'side' ? b.max.z - b.min.z : b.max.x - b.min.x);
    const h = axis === 'top' ? b.max.z - b.min.z : b.max.y - b.min.y;
    cv.text(`${fmt(w)} M`, 4, H - labelH - 10, TEXT);
    cv.text(`${fmt(h)} M`, W - 6 * `${fmt(h)} M`.length - 4, 4, TEXT);
  }
  cv.text(`${axis.toUpperCase()}  GRID 0.1 M`, 4, H - labelH + 3, DIM);
  return { width: W, height: H, data: cv.data };
}

function boxOf(tris: readonly FlatTri[]): Box3 | null {
  if (!tris.length) return null;
  const b = new Box3();
  for (const t of tris) for (const v of t.p) b.expandByPoint(v);
  return b;
}

/**
 * Shaded triangles with cel outlines (the inspect look, on our own projection), lit from over
 * the viewer's left shoulder so the faces each view looks at are in the light band.
 */
function drawTris(cv: Canvas, tris: readonly FlatTri[], proj: (p: Vector3) => [number, number, number], view: { r: Vector3; u: Vector3; f: Vector3 }, rect: Rect): void {
  const { f } = view;
  const L = f.clone().multiplyScalar(0.8).addScaledVector(view.u, 0.5).addScaledVector(view.r, -0.3).normalize();
  const n = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  for (const t of tris) {
    e1.subVectors(t.p[1], t.p[0]);
    e2.subVectors(t.p[2], t.p[0]);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-18) continue;
    n.normalize();
    if (n.dot(f) < 0) n.negate();
    const d = Math.max(0, n.dot(L));
    const shade = t.unlit ? 1 : d > 0.55 ? 1 : d > 0.2 ? 0.72 : 0.42;
    const col = t.color.map((c) => c * shade) as RGB;
    const [a, b2, c] = t.p.map(proj) as [[number, number, number], [number, number, number], [number, number, number]];
    cv.tri(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2], t.tex ? texturedShader(t.tex.uv, t.tex.sample, col) : col, t.part, rect);
  }
  cv.outline(rect);
}

/** The silhouette edge of some triangles, drawn over the canvas. */
function outlineOf(cv: Canvas, tris: readonly FlatTri[], proj: (p: Vector3) => [number, number, number], rect: Rect, color: RGB): void {
  const mask = new Canvas(cv.width, cv.height);
  for (const t of tris) {
    const [a, b, c] = t.p.map(proj) as [[number, number, number], [number, number, number], [number, number, number]];
    mask.tri(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0, color, 1, rect);
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const k = y * cv.width + x;
      if (!mask.ids[k]) continue;
      const edge = [k - 1, k + 1, k - cv.width, k + cv.width].some((q) => !mask.ids[q]);
      if (edge) cv.set(x, y, color);
    }
  }
}

function boxLines(cv: Canvas, proj: (p: Vector3) => [number, number, number], c: Vector3, h: Vector3, color: RGB): void {
  const corners: [number, number, number][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(proj(new Vector3(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z)));
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [i, j] of edges) cv.line(corners[i!]![0], corners[i!]![1], corners[j!]![0], corners[j!]![1], color, 0.8);
}

/** Nearest-neighbour upscale (game-scale previews are blown up ×4 so single art pixels show). */
export function upscale(img: SheetImage, k: number): SheetImage {
  const W = img.width * k;
  const H = img.height * k;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(img.data.subarray(((Math.floor(y / k) * img.width + Math.floor(x / k)) * 4), (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4 + 4), (y * W + x) * 4);
  return { width: W, height: H, data };
}

/**
 * The model as it reads in the game: Riftlight's iso view at `zoom`, one art pixel per pixel,
 * blown up ×`k` (default 4).
 */
export function renderGameScale(object: Object3D, zoom: number, o: { k?: number; label?: string; tris?: ReturnType<typeof worldTriangles> } = {}): SheetImage {
  const k = o.k ?? 4;
  const frame = new Box3().setFromObject(object, true);
  const size = frame.isEmpty() ? new Vector3(1, 1, 1) : frame.getSize(new Vector3());
  const ppm = gamePxPerMetre(zoom);
  const side = Math.max(16, Math.ceil(Math.hypot(size.x, size.z, size.y) * ppm) + 6);
  const img = renderView(object, { width: side, height: side, yaw: GAME_VIEW.yaw, pitch: GAME_VIEW.pitch, scale: ppm, frame }, o.tris ?? worldTriangles(object));
  const big = upscale(img, k);
  if (!o.label) return big;
  return column([big, textBox([{ text: o.label, color: DIM }], big.width, 0)]);
}

/**
 * What Gate A's judge sees (docs/ASSETS.md *Gate A*): the turntable and the game-scale
 * previews, with no swatches, labels or check results, so models made either way look alike.
 */
export function renderJudge(object: Object3D): SheetImage {
  const turn = row(renderTurntable(object, { angles: 8, size: 150 }));
  const tris = worldTriangles(object);
  const game = row([renderGameScale(object, GAME_VIEW.zooms.level, { tris }), renderGameScale(object, GAME_VIEW.zooms.town, { tris })]);
  return column([turn, game]);
}

/** Palette swatches: slot, colour name (or hex) and a chip; then each texture's id and a corner of it at 1×. */
export function swatches(palette: ExpandedModel['palette'], width: number, used?: ReadonlySet<string>, textures: readonly { id: string; rgba: Uint8Array; width: number; height: number }[] = []): SheetImage {
  const entries = Object.entries(palette);
  const rowH = 14;
  const H = 22 + (entries.length + textures.length) * rowH + 6;
  const cv = new Canvas(width, H);
  cv.rect(0, 0, width, H, PANEL);
  cv.text('PALETTE', 8, 8, TEXT);
  entries.forEach(([slot, b], i) => {
    const y = 22 + i * rowH;
    cv.rect(8, y, 20, 10, rgbOf(bindingHex(b)));
    const name = typeof b === 'number' ? `#${b.toString(16).padStart(6, '0')}` : b;
    cv.text(`${slot} ${name}${used && !used.has(slot) ? ' (unused)' : ''}`, 34, y + 1, used && !used.has(slot) ? DIM : TEXT);
  });
  textures.forEach((t, i) => {
    const y = 22 + (entries.length + i) * rowH;
    for (let ty = 0; ty < 10; ty++) {
      for (let tx = 0; tx < 20; tx++) {
        const k = ((ty % t.height) * t.width + (tx % t.width)) * 4;
        cv.set(8 + tx, y + ty, [t.rgba[k]!, t.rgba[k + 1]!, t.rgba[k + 2]!]);
      }
    }
    cv.text(`tex ${t.id} ${t.width}x${t.height}`, 34, y + 1, TEXT);
  });
  return { width, height: H, data: cv.data };
}

export interface SheetInput {
  readonly model: ExpandedModel;
  readonly compiled: Compiled;
  readonly build: ModelBuild;
  readonly check: ModelCheck;
  /** The previous version's triangles (magenta). */
  readonly previous?: readonly FlatTri[];
  readonly labels?: boolean;
  readonly rig?: boolean;
  /** Extra lines under the title (params, seed, source). */
  readonly subtitle?: string;
  /** Where the parts' `tex` ids resolve (default `TEXTURE_LIBRARY`, as `buildModel`). */
  readonly textures?: TextureCatalog;
}

/** The model sheet (see the file comment). */
export function renderModelSheet(s: SheetInput): SheetImage {
  const { model, compiled, build, check } = s;
  const textures = s.textures ?? TEXTURE_LIBRARY;
  const tris = flatTriangles(compiled, model.palette, { texel: model.texel ?? DEFAULT_TEXEL, textures });
  const texIds = [...new Set(compiled.parts.flatMap((p) => (p.tex && !p.glow && textures.has(p.tex) ? [p.tex] : [])))];
  const baked = texIds.map((id) => bakeTexture(textures.get(id)));
  const object = build.object;
  // turntable (8 angles, one scale) and the game-scale previews
  const turn = row(renderTurntable(object, { angles: 8, size: 150 }));
  const wt = worldTriangles(object);
  const game = row([
    renderGameScale(object, GAME_VIEW.zooms.level, { label: `level zoom ${GAME_VIEW.zooms.level}: ${fmt(gamePxPerMetre(GAME_VIEW.zooms.level))} px/m, x4`, tris: wt }),
    renderGameScale(object, GAME_VIEW.zooms.town, { label: `town zoom ${GAME_VIEW.zooms.town}: ${fmt(gamePxPerMetre(GAME_VIEW.zooms.town))} px/m, x4`, tris: wt }),
  ]);
  // three orthographic views at one scale on the union of now and before
  const frame = new Box3();
  for (const t of [...tris, ...(s.previous ?? [])]) for (const v of t.p) frame.expandByPoint(v);
  if (frame.isEmpty()) frame.set(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
  const size = 240;
  const span = frame.getSize(new Vector3());
  const scale = (size - 40) / Math.max(0.2, span.x, span.y, span.z);
  const labels = s.labels ? partLabels(compiled) : undefined;
  const rig = s.rig ? { anchors: build.anchors, colliders: build.colliders } : {};
  const ortho = row((['front', 'side', 'top'] as const).map((axis) => renderOrtho(tris, axis, { size, scale, frame, previous: s.previous, labels, ...rig })));
  const used = new Set(compiled.parts.filter((p) => !p.tex || p.glow).map((p) => p.slot)); // a texture brings its own colours
  const right = Math.max(turn.width, ortho.width + 200) - ortho.width - 16;
  const info = column([swatches(model.palette, right, used, baked), textBox(checkLines(check, build), right, 0, 'CHECK')]);
  const lower = row([ortho, info]);
  const w = Math.max(turn.width, lower.width, game.width);
  const head = titleBar(`${model.id}: ${model.about}`, w, s.subtitle ?? '');
  return column([head, turn, lower, game]);
}

/**
 * `modelSheet`'s options: `buildModel`'s (`params`, `seed`, `palette`, `light`, `catalog` where
 * ids and `use` resolve, `textures` where `tex` resolves), plus what the sheet draws.
 */
export interface ModelSheetOptions extends ModelOptions {
  /** Named parts' and groups' names on the views. */
  readonly labels?: boolean;
  /** Anchors (cyan) and colliders (green) on the views. */
  readonly rig?: boolean;
  /** @internal The previous version's triangles (`flatTriangles`), drawn as a magenta outline (`npm run model -- sheet --compare`). */
  readonly previous?: readonly FlatTri[];
  /** One more line under the title. */
  readonly note?: string;
}

/** A model's sheet (`image`: width, height and RGBA `data`) and the check it shows. */
export interface ModelSheet {
  readonly image: SheetImage;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  /** Tris, draws, materials, parts (null when it can't be built). */
  readonly report: ModelReport | null;
  /** Its bounds in metres: min, max and size (null when it can't be built). */
  readonly bounds: Bounds | null;
}

/**
 * The model sheet `npm run model -- sheet` draws, for a library id or any def (a game's own):
 * the turntable, front / side / top on a 0.1 m grid with the size, the game-scale previews, the
 * palette and `checkModel`'s problems and warnings over every param's range. Software-drawn: no
 * GPU, no DOM, so it runs in Node and in a browser (the kit's `check.mjs --sheets`). A def that
 * can't be built (an unknown slot, `use` or texture) gets a sheet of its problems alone.
 *
 *   const { image, problems } = modelSheet(myStall, { catalog: myModels }); // image: RGBA pixels
 */
export function modelSheet(idOrDef: string | ModelDef, opts: ModelSheetOptions = {}): ModelSheet {
  const { labels, rig, previous, note, ...o } = opts;
  const def = modelDef(idOrDef, o.catalog ?? MODEL_LIBRARY);
  const check = checkModel(def, o);
  let model: ExpandedModel;
  let build: ModelBuild;
  try {
    model = expandModel(def, o);
    build = buildModel(def, o);
  } catch (e) {
    if (!(e instanceof ModelError || e instanceof TextureError)) throw e;
    const problems = check.problems.length ? check.problems : e.problems;
    const box = textBox(problems.map((p) => ({ text: `x ${ascii(p)}`, color: BAD })), 640, 0, 'CHECK: IT CANNOT BE BUILT');
    return { image: column([titleBar(`${def.id}: ${def.about ?? ''}`, box.width, note ?? ''), box]), problems, warnings: check.warnings, report: null, bounds: null };
  }
  const sub = [
    Object.keys(model.params).length ? `params ${Object.entries(model.params).map(([k, v]) => `${k}=${v}`).join(' ')}` : '',
    build.report.seeded ? `seed ${model.seed}` : '',
    note ?? '',
    model.tags.length ? `tags ${model.tags.join(' ')}` : '',
  ].filter(Boolean).join('   ');
  const image = renderModelSheet({ model, compiled: compileParts(model.parts), build, check, previous, labels, rig, subtitle: sub, textures: o.textures });
  return { image, problems: check.problems, warnings: check.warnings, report: build.report, bounds: build.bounds };
}

function partLabels(compiled: Compiled): { text: string; at: Vector3 }[] {
  return compiled.named
    .filter((n) => n.end > n.start)
    .map((n) => {
      const b = boundsOf(compiled.parts.slice(n.start, n.end));
      return { text: n.name, at: new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2) };
    });
}

/** The pixel font has no ×, → or ÷: spell them so messages read on the sheet. */
const ascii = (s: string) => s.replace(/×/g, 'x').replace(/→/g, '->').replace(/÷/g, '/').replace(/…/g, '...');

function checkLines(c: ModelCheck, build: ModelBuild): Line[] {
  const r = build.report;
  const lines: Line[] = [
    { text: `${r.tris} tris  ${r.draws} draws  ${r.materials} materials  ${r.parts} parts`, color: TEXT },
    { text: `bounds ${build.bounds.size.map(fmt).join(' x ')} m`, color: TEXT },
    { text: '' },
  ];
  for (const p of c.problems) lines.push({ text: `x ${ascii(p)}`, color: BAD });
  for (const w of c.warnings) lines.push({ text: `! ${ascii(w)}`, color: WARN });
  if (!c.problems.length && !c.warnings.length) lines.push({ text: 'no problems, no warnings', color: GOOD });
  return lines;
}

