/**
 * Trace (docs/assets/tracing.md): an agent redraws a source mesh in primitives with the
 * library, so it comes out editable (params, seeds, themes), and this module measures the source
 * for it and judges the result. The LLM decompiles; the tool judges. Pure (no Node, no GPU), so
 * the CLI (`npm run model -- trace`) and the tests share it.
 *
 * - `traceReference(source)`: what to author from. The bounds; an axis-aligned box per node and
 *   per material; per connected component (welded to the millimetre) its box, turned when a turned
 *   box is clearly tighter, how much of that box it fills, and the primitive it is, exactly or
 *   closely (a `box`, a `cyl` with `top`, a `cone`), ready to paste; boxes fitted to convex hulls
 *   (a decomposition the caller computes, e.g. Rapier's V-HACD) as hints only; the source colours
 *   clustered onto PALETTE names by the importer's mapper (docs/assets/importing.md *Colours*).
 * - `traceVerdict(score)`: a fidelity score (`scoreFidelity`) against `TRACE_THRESHOLDS`;
 *   `paletteFloor(source)`: the best colour score a trace in PALETTE colours can reach.
 * - `renderTraceReference`, `renderTraceSheet`: the PNGs (front / side / top on a 0.1 m grid; the
 *   source's outline drawn over the trace per view, with the numbers).
 * - `sourceFromObject`, `sourceFromModel`: code-built content (an Object3D, a ModelDef) as a
 *   source mesh, one group per node (or part) and colour, so it can be traced and exported.
 */
import { Box3, Euler, Matrix4, Vector3, type Mesh, type Object3D } from 'three/webgpu';
import { Canvas, type RGB, type SheetImage } from '../animation/raster';
import { column, row, textBox, titleBar, worldTriangles, type Line } from '../inspect/render';
import { PALETTE, type PaletteColor } from '../palette';
import { TEXTURE_LIBRARY } from '../texture/library';
import { modelDef, prepareModel } from './build';
import type { ModelOptions } from './expand';
import { compileParts } from './compile';
import { fidelityDifference, fidelityRaster, fidelityShaded, fidelityViews, scoreFidelity, type ColouredTris, type FidelityScore } from './fidelity';
import type { SourceGroup, SourceMesh } from './import/gltf';
import { colourSamples } from './import/index';
import { hexString, mapColours, type ColourMap } from './import/colours';
import { groupParts } from './import/mesh';
import { MODEL_LIBRARY } from './library';
import { oklab, oklabDistance } from './oklab';
import { flatTriangles, renderOrtho, upscale, type FlatTri } from './sheet';
import type { ModelDef, Prim, Slot, Vec3 } from './types';
import { DEFAULT_TEXEL } from './uv';
import { MAX_MATERIALS } from './validate';
import { GAME_VIEW, gamePxPerMetre } from './view';

/**
 * When a trace passes (docs/assets/tracing.md *What the score says*): its worst game-scale view's silhouette IoU, its worst close view's,
 * and the mean OKLab distance where both cover a pixel, over the source's palette floor
 * (`paletteFloor`: 0 for a source in palette colours, so there the colour limit is `colour`).
 * Tuned on Phase 6's ten traces (docs/assets/tracing.md): they started at 0.85 / 0.75 / 0.08
 * absolute, which every trace of a primitive source cleared at the first scoring while a monster in
 * its own colours was out of reach in practice (floors 0.074 and 0.082).
 */
export const TRACE_THRESHOLDS = { iou: 0.85, iouClose: 0.85, colour: 0.04 } as const;
export type TraceThresholds = { readonly [K in keyof typeof TRACE_THRESHOLDS]: number };

/** What a traced def's `source.tool` records. */
export const TRACE_TOOL = 'trace';

// ---------------------------------------------------------------- the verdict

export interface TraceCheck {
  readonly name: 'iou' | 'iouClose' | 'colour';
  readonly value: number;
  readonly limit: number;
  /** `min`: the value must reach the limit; `max`: it must stay under it. */
  readonly kind: 'min' | 'max';
  readonly pass: boolean;
  /** Colour only: the source's palette floor, part of the limit. */
  readonly floor?: number;
}

export interface TraceVerdict {
  readonly pass: boolean;
  readonly checks: readonly TraceCheck[];
}

/** A fidelity score against the thresholds: every check must pass. `floor`: the source's `paletteFloor`, which the colour limit sits on. */
export function traceVerdict(score: FidelityScore, t: TraceThresholds = TRACE_THRESHOLDS, floor = 0): TraceVerdict {
  const colour = Math.round((floor + t.colour) * 1e4) / 1e4;
  const checks: TraceCheck[] = [
    { name: 'iou', value: score.iou, limit: t.iou, kind: 'min', pass: score.iou >= t.iou },
    { name: 'iouClose', value: score.iouClose, limit: t.iouClose, kind: 'min', pass: score.iouClose >= t.iouClose },
    { name: 'colour', value: score.colour, limit: colour, kind: 'max', pass: score.colour <= colour, ...(floor > 0 ? { floor } : {}) },
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

// ---------------------------------------------------------------- vectors

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => scale(a, 1 / (len(a) || 1));
/** Metres to the centimetre, and to the millimetre (no −0 either way). */
const cm = (v: number) => Math.round(v * 100) / 100 + 0;
const mm = (v: number) => Math.round(v * 1000) / 1000 + 0;
const AXES: readonly [V, V, V] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** How far (m) a re-emitted primitive's vertex may sit from the source's to be exact (the importer's). */
const EXACT = 0.0015;

// ---------------------------------------------------------------- boxes

export interface TraceBox {
  /** Centre (m). */
  readonly at: Vec3;
  /** Along the box's own axes (m). */
  readonly size: Vec3;
  /** Degrees, XYZ, as a part's `rot`; absent when the box is axis-aligned. */
  readonly rot?: Vec3;
}

interface Fit {
  readonly axes: readonly [V, V, V];
  readonly size: V;
  readonly centre: V;
  readonly volume: number;
}

/** The box along `axes` around `points`. */
function boxAlong(points: readonly V[], axes: readonly [V, V, V]): Fit {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      const d = dot(p, axes[k]!);
      lo[k] = Math.min(lo[k]!, d);
      hi[k] = Math.max(hi[k]!, d);
    }
  }
  const size: V = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
  let centre: V = [0, 0, 0];
  for (let k = 0; k < 3; k++) centre = add(centre, scale(axes[k]!, (lo[k]! + hi[k]!) / 2));
  // a flat piece still has a volume to compare: its thickness counts as a millimetre
  return { axes, size, centre, volume: Math.max(size[0], 0.001) * Math.max(size[1], 0.001) * Math.max(size[2], 0.001) };
}

/** Convex hull of 2D points (Andrew's monotone chain), counter-clockwise. */
function hull2(pts: readonly [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Distinct face directions (a normal and its opposite are one), biggest area first. */
function directions(normals: readonly { n: V; area: number }[], max = 24): V[] {
  const out: { n: V; area: number }[] = [];
  for (const { n, area } of normals) {
    const hit = out.find((o) => Math.abs(dot(o.n, n)) > 0.9998);
    if (hit) hit.area += area;
    else out.push({ n, area });
  }
  return out.sort((a, b) => b.area - a.area).slice(0, max).map((o) => o.n);
}

/**
 * The tightest box around `points`: axis-aligned, or along a face direction with the smallest
 * rectangle across it (exact for boxes and prisms however they are turned). A turn has to earn
 * its place: half the volume (a slanted rod, a spike), or 5% less when the piece fills 60% or more
 * of the turned box (by `volume`, what it encloses), so the box describes the piece (a turned
 * plank, a log). A round or pointed piece (a ball, two cones on one ring) keeps its axis-aligned
 * box rather than a turn along one of its facets.
 */
function fitBox(points: readonly V[], normals: readonly { n: V; area: number }[], volume = 0): { aabb: Fit; best: Fit } {
  const aabb = boxAlong(points, AXES);
  let best = aabb;
  for (const n of directions(normals)) {
    const helper: V = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = unit(cross(n, helper));
    const w = cross(n, u);
    const flat = hull2(points.map((p) => [dot(p, u), dot(p, w)] as [number, number]));
    for (let i = 0; i < flat.length; i++) {
      const a = flat[i]!;
      const b = flat[(i + 1) % flat.length]!;
      const e = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (e < 1e-9) continue;
      const [c, s] = [(b[0] - a[0]) / e, (b[1] - a[1]) / e];
      const e3 = unit(add(scale(u, c), scale(w, s)));
      const fit = boxAlong(points, [n, e3, cross(n, e3)]);
      if (fit.volume < best.volume - 1e-12) best = fit;
    }
  }
  const clearly = best.volume <= aabb.volume * 0.5 || (best.volume < aabb.volume * 0.95 && volume >= 0.6 * best.volume);
  return { aabb, best: clearly ? best : aabb };
}

/** Of the ways to give a frame's axes to X, Y and Z (each pointing its positive way), the one nearest no turn. */
function nearestAxes(axes: readonly [V, V, V], size: V): { axes: [V, V, V]; size: V } {
  let best: { axes: [V, V, V]; size: V; score: number } | null = null;
  for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const) {
    const a = perm.map((p, w) => scale(axes[p]!, Math.sign(axes[p]![w]!) || 1)) as [V, V, V];
    if (dot(cross(a[0], a[1]), a[2]) < 0) a[2] = scale(a[2], -1); // a box is symmetric
    const score = a[0][0] + a[1][1] + a[2][2];
    if (!best || score > best.score + 1e-9) best = { axes: a, size: perm.map((p) => size[p]!) as V, score };
  }
  return best!;
}

/** Degrees XYZ (the compiler's order) of the frame with these unit axes as columns, to 0.1°; null when unturned. */
function eulerOf(axes: readonly [V, V, V]): Vec3 | null {
  const e = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(...axes[0]), new Vector3(...axes[1]), new Vector3(...axes[2])), 'XYZ');
  const deg = [e.x, e.y, e.z].map((r) => Math.round((r * 1800) / Math.PI) / 10 + 0) as [number, number, number];
  return deg.every((d) => d === 0) ? null : deg;
}

function asTraceBox(f: Fit): TraceBox {
  const { axes, size } = nearestAxes(f.axes, f.size);
  const rot = f.axes === AXES ? null : eulerOf(axes);
  return { at: [cm(f.centre[0]), cm(f.centre[1]), cm(f.centre[2])], size: [cm(size[0]), cm(size[1]), cm(size[2])], ...(rot ? { rot } : {}) };
}

// ---------------------------------------------------------------- welding, components, volume

interface Welded {
  /** Vertices (m), welded to the millimetre. */
  readonly vs: V[];
  /** Per kept triangle: its vertices, and the source triangle it was. */
  readonly tris: [number, number, number][];
  readonly from: number[];
}

function weld(positions: ArrayLike<number>): Welded {
  const vs: V[] = [];
  const index = new Map<string, number>();
  const at = (k: number) => {
    const p: V = [Math.round(positions[k]! * 1000), Math.round(positions[k + 1]! * 1000), Math.round(positions[k + 2]! * 1000)];
    const key = p.join();
    let i = index.get(key);
    if (i === undefined) index.set(key, (i = vs.push(scale(p, 0.001)) - 1));
    return i;
  };
  const tris: [number, number, number][] = [];
  const from: number[] = [];
  for (let t = 0; t * 9 + 8 < positions.length; t++) {
    const tri: [number, number, number] = [at(t * 9), at(t * 9 + 3), at(t * 9 + 6)];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    tris.push(tri);
    from.push(t);
  }
  return { vs, tris, from };
}

/** Triangles that share a welded vertex, as lists of triangle indices. */
function connected(count: number, tris: readonly [number, number, number][]): number[][] {
  const root = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (root[i] !== i) i = root[i] = root[root[i]!]!;
    return i;
  };
  for (const [a, b, c] of tris) {
    root[find(b)] = find(a);
    root[find(c)] = find(a);
  }
  const groups = new Map<number, number[]>();
  tris.forEach((t, i) => {
    const r = find(t[0]);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()];
}

/** The volume a closed, outward-wound piece encloses (0 when it is open or wound inward). */
function enclosed(vs: readonly V[], tris: readonly (readonly [number, number, number])[]): number {
  let v = 0;
  for (const [a, b, c] of tris) v += dot(vs[a]!, cross(vs[b]!, vs[c]!)) / 6;
  return Math.max(0, v);
}

function normalsOf(vs: readonly V[], tris: readonly (readonly [number, number, number])[]): { n: V; area: number }[] {
  return tris.map(([a, b, c]) => {
    const n = cross(sub(vs[b]!, vs[a]!), sub(vs[c]!, vs[a]!));
    return { n: unit(n), area: len(n) / 2 };
  }).filter((x) => x.area > 1e-10);
}

// ---------------------------------------------------------------- the primitive a piece is

/** A primitive's vertices (m) as the compiler builds it, welded to the millimetre. */
function emitted(part: Prim): V[] {
  const c = compileParts([part]);
  const p = c.parts[0];
  if (!p || c.problems.length) return [];
  const v = new Vector3();
  const seen = new Map<string, V>();
  for (let k = 0; k < p.tris.length; k += 3) {
    v.set(p.tris[k]!, p.tris[k + 1]!, p.tris[k + 2]!).applyMatrix4(p.matrix);
    const key = `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
    if (!seen.has(key)) seen.set(key, [v.x, v.y, v.z]);
  }
  return [...seen.values()];
}

/** The furthest any point of either set is from the other set (m). */
function hausdorff(a: readonly V[], b: readonly V[]): number {
  const one = (p: readonly V[], q: readonly V[]) => Math.max(...p.map((x) => Math.min(...q.map((y) => len(sub(x, y))))));
  return a.length && b.length ? Math.max(one(a, b), one(b, a)) : Infinity;
}

export interface TraceShape {
  /** A part to paste (without `c`): its kind, box, `seg`, `top`, `at` and `rot`. */
  readonly prim: Prim;
  /** `exact`: re-emitted, every vertex lands within 1.5 mm of the source's; `close`: within 3% of its size. */
  readonly match: 'exact' | 'close';
}

/**
 * A ring-and-axis piece: two rings of n points round one axis (a prism or a frustum, caps with or
 * without a centre point), or a ring and an apex (a cone), as `cyl` (with `top`) or `cone`. The
 * ring starts at +X of the part's frame, so the frame turns to put a source vertex there. Each
 * candidate is re-emitted and compared with the source's vertices.
 */
function ringShape(vs: readonly V[], axes: readonly V[]): TraceShape | null {
  const extent = Math.max(...[0, 1, 2].map((k) => Math.max(...vs.map((v) => v[k]!)) - Math.min(...vs.map((v) => v[k]!))));
  const close = Math.max(0.005, 0.03 * extent);
  let best: { shape: TraceShape; d: number; turn: number } | null = null;
  for (const a0 of axes) {
    const heights = vs.map((v) => dot(v, a0));
    const order = [...heights].sort((p, q) => p - q);
    const levels: number[] = [order[0]!];
    for (const h of order) if (h - levels[levels.length - 1]! > EXACT) levels.push(h);
    if (levels.length !== 2) continue;
    const at = (lv: number) => vs.filter((_, i) => Math.abs(heights[i]! - levels[lv]!) <= EXACT);
    const ringOf = (pts: readonly V[]) => {
      const c = scale(pts.reduce<V>((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
      const radial = (p: V) => {
        const d = sub(p, c);
        return sub(d, scale(a0, dot(d, a0)));
      };
      const ring = pts.filter((p) => len(radial(p)) > EXACT);
      const r = ring.map((p) => len(radial(p)));
      return { c, ring, r: r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0, round: r.every((x) => Math.abs(x - (r[0] ?? 0)) <= Math.max(EXACT, 0.01 * x)) };
    };
    const lo = ringOf(at(0));
    const hi = ringOf(at(1));
    if (!lo.round || !hi.round) continue;
    const n = Math.max(lo.ring.length, hi.ring.length);
    if (n < 3 || n > 64 || (lo.ring.length && hi.ring.length && lo.ring.length !== hi.ring.length)) continue;
    if (!lo.ring.length && !hi.ring.length) continue;
    // the two centres on one axis
    const off = sub(hi.c, lo.c);
    if (len(sub(off, scale(a0, dot(off, a0)))) > Math.max(EXACT, 0.01 * Math.max(lo.r, hi.r))) continue;
    const cone = !lo.ring.length || !hi.ring.length;
    // the piece's up: towards the apex for a cone; either way for a frustum (both tried)
    const ups: V[] = cone ? [lo.ring.length ? a0 : scale(a0, -1)] : [a0, scale(a0, -1)];
    for (const Y of ups) {
      const [base, top] = dot(Y, a0) > 0 ? [lo, hi] : [hi, lo];
      const wide = base.r >= top.r ? base : top;
      const h = Math.abs(levels[1]! - levels[0]!);
      const mid = scale(add(lo.c, hi.c), 0.5);
      // ring(n) as the compiler normalizes it: bounds and their centre in unit-radius terms
      const angles = Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n);
      const cs = angles.map(Math.cos);
      const ss = angles.map(Math.sin);
      const [x0, x1, z0, z1] = [Math.min(...cs), Math.max(...cs), Math.min(...ss), Math.max(...ss)];
      for (const p of wide.ring) {
        const d = sub(p, wide.c);
        const X = unit(sub(d, scale(Y, dot(d, Y))));
        const Z = cross(X, Y);
        const r = wide.r;
        const centre = add(mid, add(scale(X, ((x0 + x1) / 2) * r), scale(Z, ((z0 + z1) / 2) * r)));
        const size: Vec3 = [mm((x1 - x0) * r), mm(h), mm((z1 - z0) * r)];
        const rot = eulerOf([X, Y, Z]);
        const ratio = base.r > 0 ? Math.round((top.r / base.r) * 1000) / 1000 : 0;
        const prim: Prim = cone
          ? { cone: size, seg: n, at: [mm(centre[0]), mm(centre[1]), mm(centre[2])], ...(rot ? { rot } : {}) }
          : { cyl: size, seg: n, ...(Math.abs(ratio - 1) > 0.002 ? { top: ratio } : {}), at: [mm(centre[0]), mm(centre[1]), mm(centre[2])], ...(rot ? { rot } : {}) };
        // compare with the source's vertices, the centres of ringed caps aside (ours have none)
        const own = vs.filter((v) => {
          const q = sub(v, mid);
          if (len(sub(q, scale(a0, dot(q, a0)))) > EXACT) return true;
          const level = Math.abs(dot(v, a0) - levels[0]!) <= EXACT ? lo : hi;
          return !level.ring.length; // an apex stays
        });
        const dist = hausdorff(own, emitted(prim));
        if (dist > close) continue;
        const turn = rot ? Math.abs(rot[0]) + Math.abs(rot[1]) + Math.abs(rot[2]) : 0;
        if (!best || dist < best.d - EXACT / 2 || (Math.abs(dist - best.d) <= EXACT / 2 && turn < best.turn)) best = { shape: { prim, match: dist <= EXACT ? 'exact' : 'close' }, d: dist, turn };
      }
    }
  }
  return best?.shape ?? null;
}

/** The primitive a piece is: the importer's exact box or prism, else a ring shape. */
function shapeOf(vs: readonly V[], tris: readonly (readonly [number, number, number])[], axes: readonly V[]): TraceShape | null {
  const pos = tris.flatMap((t) => t.flatMap((i) => vs[i]!));
  const exact = groupParts(pos, tris.map(() => 's')).parts;
  if (exact.length === 1 && !('mesh' in exact[0]!)) {
    const prim: Record<string, unknown> = { ...exact[0] };
    delete prim.c; // the caller picks the slot
    return { prim: prim as unknown as Prim, match: 'exact' };
  }
  return ringShape(vs, axes);
}

// ---------------------------------------------------------------- the reference

export interface TraceGroupBox extends TraceBox {
  readonly name: string;
  readonly tris: number;
  /** Its share of the surface area (0–1). */
  readonly area: number;
  /** Its source colours ('#rrggbb'), the biggest first. */
  readonly colours: readonly string[];
}

export interface TraceComponent {
  /** `p1`, `p2`… biggest box first (the sheet labels them). */
  readonly name: string;
  /** The node most of its triangles come from. */
  readonly node: string;
  /** Its main source colour, the slot the mapper puts it in (`colours`) and that slot's PALETTE entry. */
  readonly colour: string;
  readonly slot: Slot;
  readonly palette: PaletteColor;
  /** Every colour on it, the biggest first, with its share of the piece's area (a top, a tip in another colour). */
  readonly colours: readonly PieceColour[];
  readonly tris: number;
  /** Axis-aligned. */
  readonly box: TraceBox;
  /** A turned box, when it is clearly tighter than `box` (see `fitBox`). */
  readonly turned?: TraceBox;
  /** How much of its tightest box it fills (1 a box, ~0.79 a cylinder, ~0.52 a ball, ~0.33 a cone); null when open. */
  readonly fill: number | null;
  readonly shape?: TraceShape;
}

export interface PieceColour {
  readonly colour: string;
  readonly slot: Slot;
  readonly palette: PaletteColor;
  /** Its share of the piece's area (0–1). */
  readonly area: number;
}

/** A convex piece of a decomposition (V-HACD): its points, and its faces when known. */
export interface ConvexHull {
  readonly vertices: ArrayLike<number>;
  readonly indices?: ArrayLike<number> | null;
}

export interface TraceHull {
  readonly box: TraceBox;
  readonly fill: number | null;
}

export interface TraceColour {
  readonly slot: Slot;
  /** The cluster's centre, '#rrggbb'. */
  readonly source: string;
  readonly colour: PaletteColor;
  /** Its share of the surface area (0–1). */
  readonly area: number;
}

export interface TraceReference {
  readonly bounds: { readonly min: Vec3; readonly max: Vec3; readonly size: Vec3 };
  readonly triangles: number;
  readonly nodes: readonly TraceGroupBox[];
  readonly materials: readonly TraceGroupBox[];
  readonly components: readonly TraceComponent[];
  /** Null when no decomposition was given. */
  readonly hulls: readonly TraceHull[] | null;
  readonly colours: readonly TraceColour[];
}

function triArea(p: ArrayLike<number>, t: number): number {
  const k = t * 9;
  const u: V = [p[k + 3]! - p[k]!, p[k + 4]! - p[k + 1]!, p[k + 5]! - p[k + 2]!];
  const v: V = [p[k + 6]! - p[k]!, p[k + 7]! - p[k + 1]!, p[k + 8]! - p[k + 2]!];
  return len(cross(u, v)) / 2;
}

/** Axis-aligned boxes of triangle groups (by node or material name). */
function groupBoxes(src: SourceMesh, keyOf: (g: SourceGroup) => string, total: number): TraceGroupBox[] {
  const groups = new Map<string, { tris: number[]; area: number; colours: Map<number, number> }>();
  for (let t = 0; t < src.group.length; t++) {
    const key = keyOf(src.groups[src.group[t]!]!);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { tris: [], area: 0, colours: new Map() }));
    const a = triArea(src.positions, t);
    g.tris.push(t);
    g.area += a;
    g.colours.set(src.colours[t]!, (g.colours.get(src.colours[t]!) ?? 0) + a);
  }
  return [...groups].map(([name, g]) => {
    const pts = g.tris.flatMap((t) => [0, 1, 2].map((j) => [src.positions[t * 9 + j * 3]!, src.positions[t * 9 + j * 3 + 1]!, src.positions[t * 9 + j * 3 + 2]!] as V));
    return { name, ...asTraceBox(boxAlong(pts, AXES)), tris: g.tris.length, area: Math.round((g.area / (total || 1)) * 1000) / 1000, colours: [...g.colours].sort((a, b) => b[1] - a[1]).map(([c]) => hexString(c)) };
  }).sort((a, b) => b.area - a.area || (a.name < b.name ? -1 : 1));
}

/**
 * The source's colours clustered onto PALETTE entries, at most `max` slots: the reference's
 * `palette:` takes `MAX_MATERIALS` (more warns), joining the closest colours (the floor doesn't use
 * it: `paletteFloor` puts each colour on its nearest entry). A material named by its hex
 * names no slot.
 */
function referenceColours(src: SourceMesh, max: number): ColourMap {
  return mapColours(colourSamples(src).map((s) => (s.name && /^#?[0-9a-f]{6}$/i.test(s.name) ? { hex: s.hex, area: s.area } : s)), { max });
}

/** The PALETTE entry nearest a colour in OKLab. */
export function nearestEntry(hex: number): PaletteColor {
  const c = oklab(hex);
  let best: PaletteColor = 'ink';
  let d = Infinity;
  for (const [name, h] of Object.entries(PALETTE) as [PaletteColor, number][]) {
    const e = oklabDistance(c, oklab(h));
    if (e < d) [best, d] = [name, e];
  }
  return best;
}

/**
 * The best colour score a trace in PALETTE colours can reach: the source itself with every colour
 * on its nearest entry (not the reference's `palette:`, whose mapper keeps hues apart at a cost),
 * scored against the source. 0 for a source in palette colours; above 0 for one in its own (a
 * monster's). The colour threshold sits on it (`traceVerdict`).
 */
export function paletteFloor(src: SourceMesh): number {
  const near = new Map<number, number>();
  const colours = Array.from(src.colours, (c) => near.get(c) ?? near.set(c, PALETTE[nearestEntry(c)]).get(c)!);
  return scoreFidelity({ positions: src.positions, colours: src.colours }, { positions: src.positions, colours }).colour;
}

/** What to author a trace from (see the file comment). `hulls`: a convex decomposition of the same mesh. */
export function traceReference(src: SourceMesh, o: { hulls?: readonly ConvexHull[] } = {}): TraceReference {
  const n = src.group.length;
  const areas = Array.from({ length: n }, (_, t) => triArea(src.positions, t));
  const total = areas.reduce((s, a) => s + a, 0);
  const b = new Box3();
  const v = new Vector3();
  for (let i = 0; i + 2 < src.positions.length; i += 3) b.expandByPoint(v.set(src.positions[i]!, src.positions[i + 1]!, src.positions[i + 2]!));
  const r3 = (x: Vector3): Vec3 => [cm(x.x), cm(x.y), cm(x.z)];
  const bounds = b.isEmpty() ? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3, size: [0, 0, 0] as Vec3 } : { min: r3(b.min), max: r3(b.max), size: r3(b.getSize(new Vector3())) };

  // as many slots as a def takes before it warns: `palette:` pastes clean
  const map = referenceColours(src, MAX_MATERIALS);
  const slotOf = (hex: number) => map.slots.find((s) => s.slot === map.of[hexString(hex)]) ?? map.slots[0]!;

  const welded = weld(src.positions);
  const components = connected(welded.vs.length, welded.tris).map((members) => {
    const tris = members.map((i) => welded.tris[i]!);
    const ids = [...new Set(tris.flat())];
    const remap = new Map(ids.map((id, k) => [id, k]));
    const vs = ids.map((i) => welded.vs[i]!);
    const local = tris.map((t) => t.map((i) => remap.get(i)!) as [number, number, number]);
    const vol = enclosed(vs, local);
    const { aabb, best } = fitBox(vs, normalsOf(vs, local), vol);
    // the main colour and node, by area
    const byColour = new Map<number, number>();
    const byNode = new Map<string, number>();
    for (const i of members) {
      const t = welded.from[i]!;
      byColour.set(src.colours[t]!, (byColour.get(src.colours[t]!) ?? 0) + areas[t]!);
      const node = src.groups[src.group[t]!]!.node;
      byNode.set(node, (byNode.get(node) ?? 0) + areas[t]!);
    }
    const byArea = [...byColour].sort((p, q) => q[1] - p[1]);
    const colour = byArea[0]![0];
    const pieceArea = byArea.reduce((sum, [, a]) => sum + a, 0) || 1;
    const shape = shapeOf(vs, local, [...best.axes, ...(best === aabb ? [] : AXES)]);
    return {
      volume: best.volume,
      piece: {
      node: [...byNode].sort((p, q) => q[1] - p[1])[0]![0],
      colour: hexString(colour),
      slot: slotOf(colour).slot,
      palette: slotOf(colour).colour,
      colours: byArea.map(([hex, a]) => ({ colour: hexString(hex), slot: slotOf(hex).slot, palette: slotOf(hex).colour, area: Math.round((a / pieceArea) * 100) / 100 })),
      tris: members.length,
      box: asTraceBox(aabb),
      ...(best === aabb ? {} : { turned: asTraceBox(best) }),
      fill: vol > 0 ? Math.min(1, Math.round((vol / best.volume) * 100) / 100) : null,
      ...(shape ? { shape } : {}),
      },
    };
  });
  const at = (c: (typeof components)[number]) => c.piece.box.at;
  components.sort((p, q) => q.volume - p.volume || at(p)[0] - at(q)[0] || at(p)[1] - at(q)[1] || at(p)[2] - at(q)[2]);

  const hulls = o.hulls?.map((h) => {
    const pts: V[] = [];
    for (let i = 0; i + 2 < h.vertices.length; i += 3) pts.push([h.vertices[i]!, h.vertices[i + 1]!, h.vertices[i + 2]!]);
    const faces: [number, number, number][] = [];
    for (let i = 0; h.indices && i + 2 < h.indices.length; i += 3) faces.push([h.indices[i]!, h.indices[i + 1]!, h.indices[i + 2]!]);
    // hull faces give the directions; without them, the points' own axis-aligned box
    const vol = faces.length ? enclosed(pts, faces) : 0;
    const { best } = fitBox(pts, faces.length ? normalsOf(pts, faces) : [], vol);
    return { box: asTraceBox(best), fill: vol > 0 ? Math.min(1, Math.round((vol / best.volume) * 100) / 100) : null, volume: best.volume };
  }).sort((p, q) => q.volume - p.volume).map(({ box, fill }) => ({ box, fill })) ?? null;

  return {
    bounds,
    triangles: n,
    nodes: groupBoxes(src, (g) => g.node, total),
    materials: groupBoxes(src, (g) => g.material || '(none)', total),
    components: components.map((c, i) => ({ name: `p${i + 1}`, ...c.piece })),
    hulls,
    colours: map.slots.map((s) => ({ slot: s.slot, source: hexString(s.source), colour: s.colour, area: Math.round((s.area / (total || 1)) * 1000) / 1000 })),
  };
}

// ---------------------------------------------------------------- sources from code

const PALETTE_NAME = new Map<number, PaletteColor>(Object.entries(PALETTE).map(([k, hex]) => [hex, k as PaletteColor]));
/** A colour's PALETTE name, else its hex: what a code-built source's materials are called. */
export const colourName = (hex: number) => PALETTE_NAME.get(hex) ?? hexString(hex);

/** Collects triangles into groups keyed by node, material and colour. */
class SourceBuilder {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly group: number[] = [];
  private readonly groups: SourceGroup[] = [];
  private readonly index = new Map<string, number>();

  add(node: string, material: string, unlit: boolean, hex: number, p: readonly number[]): void {
    const key = `${node}\u0000${material}\u0000${unlit}\u0000${hex}`;
    let g = this.index.get(key);
    if (g === undefined) {
      this.index.set(key, (g = this.groups.length));
      this.groups.push({ node, material, unlit });
    }
    this.positions.push(...p);
    this.colours.push(hex);
    this.group.push(g);
  }

  build(): SourceMesh {
    return { positions: new Float64Array(this.positions), colours: new Uint32Array(this.colours), group: new Uint32Array(this.group), groups: this.groups };
  }
}

const hexOf = (c: readonly number[]) => (Math.round(c[0]!) << 16) | (Math.round(c[1]!) << 8) | Math.round(c[2]!);

/**
 * Every visible mesh of an Object3D, in world space, as a source mesh: one group per mesh (named
 * after it, or its nearest named ancestor) and colour, the material named after the colour (a
 * PALETTE name, else its hex). Skinned and instanced meshes, vertex colours and in-memory texture
 * maps resolve as the sheets draw them (`worldTriangles`).
 */
export function sourceFromObject(object: Object3D): SourceMesh {
  object.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  object.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const out = new SourceBuilder();
  meshes.forEach((mesh, i) => {
    let name = mesh.name;
    for (let p = mesh.parent; !name && p && p !== object; p = p.parent) name = p.name;
    name ||= `mesh${i + 1}`;
    // this mesh alone: worldTriangles walks the subtree, so hide the meshes under it for a moment
    const below = meshes.filter((m) => m !== mesh && m.visible && isBelow(m, mesh));
    for (const m of below) m.visible = false;
    try {
      for (const t of worldTriangles(mesh)) {
        const c = t.tex ? texelAtCentre(t.tex, t.color) : t.color;
        const hex = hexOf(c);
        out.add(name, colourName(hex), t.unlit, hex, [t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z, t.c.x, t.c.y, t.c.z]);
      }
    } finally {
      for (const m of below) m.visible = true;
    }
  });
  return out.build();
}

function isBelow(o: Object3D, ancestor: Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/** A textured triangle's colour: its texel at the UV centroid, tinted. */
function texelAtCentre(tex: { uv: ArrayLike<number>; sample: (u: number, v: number) => RGB }, tint: RGB): RGB {
  const c = tex.sample((tex.uv[0]! + tex.uv[2]! + tex.uv[4]!) / 3, (tex.uv[1]! + tex.uv[3]! + tex.uv[5]!) / 3);
  return [(c[0] * tint[0]) / 255, (c[1] * tint[1]) / 255, (c[2] * tint[2]) / 255];
}

/**
 * A ModelDef as a source mesh, as the sheets draw it: one group per part (its name, else its kind
 * and path) and slot. Imports (a pack's models) keep their source node names this way.
 */
export function sourceFromModel(idOrDef: string | ModelDef, opts: ModelOptions = {}): SourceMesh {
  const catalog = opts.catalog ?? MODEL_LIBRARY;
  const { expansion, compiled } = prepareModel(modelDef(idOrDef, catalog), opts, catalog);
  const tris = flatTriangles(compiled, expansion.model.palette, { texel: expansion.model.texel ?? DEFAULT_TEXEL, textures: opts.textures ?? TEXTURE_LIBRARY });
  const out = new SourceBuilder();
  for (const t of tris) {
    const part = compiled.parts[t.part - 1]!;
    const hex = hexOf(t.tex ? texelAtCentre(t.tex, t.color) : t.color);
    out.add(part.name ?? part.label, part.slot, t.unlit, hex, t.p.flatMap((v) => [v.x, v.y, v.z]));
  }
  return out.build();
}

// ---------------------------------------------------------------- the PNGs

const MAGENTA: RGB = [255, 60, 220];
const TEXT: RGB = [230, 232, 240];
const DIM: RGB = [150, 156, 180];
const GOOD: RGB = [56, 183, 100];
const BAD: RGB = [255, 110, 120];
const PANEL: RGB = [36, 40, 56];
const rgbOf = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

/** Triangles as the sheets' orthographic views take them. */
export function flatOf(t: ColouredTris): FlatTri[] {
  const out: FlatTri[] = [];
  const p = t.positions;
  for (let k = 0; k * 9 + 8 < p.length; k++) {
    const at = (i: number) => new Vector3(p[k * 9 + i]!, p[k * 9 + i + 1]!, p[k * 9 + i + 2]!);
    out.push({ p: [at(0), at(3), at(6)], color: rgbOf(t.colours[k]!), unlit: false, part: 1 });
  }
  return out;
}

/** Front, side and top on a 0.1 m grid, at one scale on `frame`; `outline` drawn over in magenta. */
function orthoRow(tris: readonly FlatTri[], frame: Box3, o: { size?: number; outline?: readonly FlatTri[]; labels?: { text: string; at: Vector3 }[] } = {}): SheetImage {
  const size = o.size ?? 300;
  const span = frame.getSize(new Vector3());
  const s = (size - 40) / Math.max(0.2, span.x, span.y, span.z);
  return row((['front', 'side', 'top'] as const).map((axis) => renderOrtho(tris, axis, { size, scale: s, frame, previous: o.outline, labels: o.labels })));
}

const boxText = (b: TraceBox) => `at [${b.at.join(', ')}] size [${b.size.join(', ')}]${b.rot ? ` rot [${b.rot.join(', ')}]` : ''}`;

/**
 * The reference sheet: front / side / top on a 0.1 m grid (components labelled when there are 30
 * or fewer), the source at 4 yaws close up and at game scale, and its colours mapped to PALETTE.
 */
export function renderTraceReference(src: SourceMesh, ref: TraceReference, o: { title: string; subtitle?: string }): SheetImage {
  const t: ColouredTris = { positions: src.positions, colours: src.colours };
  const tris = flatOf(t);
  const frame = new Box3(new Vector3(...ref.bounds.min), new Vector3(...ref.bounds.max));
  if (frame.isEmpty()) frame.set(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
  const labels = ref.components.length <= 30 ? ref.components.map((c) => ({ text: c.name, at: new Vector3(...c.box.at) })) : undefined;
  const ortho = orthoRow(tris, frame, { labels });
  const views = fidelityViews(t, t);
  const yaws = row(views.filter((v) => v.scale === 'close').map((v) => fidelityShaded(t, v)));
  const game = views.find((v) => v.scale === 'game' && v.yaw === GAME_VIEW.yaw)!;
  const k = Math.max(1, Math.min(4, Math.floor(300 / game.side))); // single art pixels show, big models stay on the page
  const gameImg = column([upscale(fidelityShaded(t, game), k), textBox([{ text: `game scale ${+gamePxPerMetre(GAME_VIEW.zooms.level).toFixed(2)} px/m, x${k}`, color: DIM }], Math.max(160, game.side * k))]);
  const w = Math.max(ortho.width, yaws.width + gameImg.width + 8);
  const sw = new Canvas(w, 22 + ref.colours.length * 14 + 6);
  sw.rect(0, 0, w, sw.height, PANEL);
  sw.text('COLOURS (CLUSTERED, MAPPED TO PALETTE)', 8, 8, TEXT);
  ref.colours.forEach((c, i) => {
    const y = 22 + i * 14;
    sw.rect(8, y, 20, 10, rgbOf(parseInt(c.source.slice(1), 16)));
    sw.rect(30, y, 20, 10, rgbOf(PALETTE[c.colour]));
    sw.text(`${c.slot}: ${c.source} -> ${c.colour}  ${Math.round(c.area * 100)}% of the area`, 58, y + 1, TEXT);
  });
  const lines: Line[] = [
    { text: `bounds ${ref.bounds.size.join(' x ')} m, ${ref.triangles} tris, ${ref.nodes.length} node(s), ${ref.materials.length} material(s), ${ref.components.length} piece(s)${ref.hulls ? `, ${ref.hulls.length} hull hint(s)` : ''}`, color: TEXT },
    ...ref.components.slice(0, 12).map((c) => ({ text: `${c.name} ${pieceColours(c)}: ${c.shape ? `${c.shape.match} ${kindOf(c.shape.prim)} ${boxText(primBox(c.shape.prim))}` : boxText(c.turned ?? c.box)}`, color: DIM })),
    ...(ref.components.length > 12 ? [{ text: `... ${ref.components.length - 12} more (the printed reference lists them)`, color: DIM }] : []),
  ];
  return column([titleBar(o.title, w, o.subtitle ?? ''), ortho, row([yaws, gameImg]), { width: w, height: sw.height, data: sw.data }, textBox(lines, w, 0, 'REFERENCE')]);
}

/** A piece's colours as PALETTE names: `orange`, or `orange 80% + sand 20%` when it has more. */
export function pieceColours(c: TraceComponent): string {
  return c.colours.length > 1 ? c.colours.map((x) => `${x.palette} ${Math.round(x.area * 100)}%`).join(' + ') : c.palette;
}

/** A primitive's kind (`box`, `cyl`…). */
export function kindOf(p: Prim): string {
  return ['box', 'cyl', 'cone', 'ball', 'lump', 'wedge', 'torus', 'lathe', 'slab', 'tube', 'mesh'].find((k) => k in p) ?? '?';
}

/** A box-kind primitive's box, as a TraceBox (for printing). */
export function primBox(p: Prim): TraceBox {
  const size = (p as unknown as Record<string, Vec3>)[kindOf(p)]!;
  return { at: p.at ?? [0, 0, 0], size, ...(p.rot ? { rot: p.rot } : {}) };
}

/** Where the source covers a pixel and a neighbour it doesn't: its outline. */
function outlineOver(img: SheetImage, s: { side: number; ids: Uint16Array }, color: RGB): SheetImage {
  const data = new Uint8ClampedArray(img.data);
  const n = s.side;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      if (!s.ids[k]) continue;
      const edge = x === 0 || y === 0 || x === n - 1 || y === n - 1 || !s.ids[k - 1] || !s.ids[k + 1] || !s.ids[k - n] || !s.ids[k + n];
      if (edge) data.set([color[0], color[1], color[2], 255], k * 4);
    }
  }
  return { width: img.width, height: img.height, data };
}

const LABEL: Record<TraceCheck['name'], string> = { iou: 'game IoU', iouClose: 'close IoU', colour: 'colour dE' };

/** One line per check: the value, the limit, pass or fail. */
export function verdictLines(score: FidelityScore, verdict: TraceVerdict, offset?: Vec3): string[] {
  const worst = (scale: 'game' | 'close') => {
    const vs = score.views.filter((v) => v.scale === scale);
    const w = vs.reduce((a, b) => (b.iou < a.iou ? b : a));
    return `worst yaw ${w.yaw}; ${vs.map((v) => `${v.yaw}: ${v.iou}`).join(', ')}`;
  };
  const signed = (v: Vec3) => v.map((d) => `${d > 0 ? '+' : ''}${d}`).join(' x ');
  // a trace drawn in the wrong frame scores like a wrong shape: say which it is
  const apart = offset ? Math.hypot(...offset) : 0;
  return [
    ...verdict.checks.map((c) => `${LABEL[c.name].padEnd(10)} ${c.value.toFixed(3)} ${c.kind === 'min' ? '>=' : '<='} ${c.limit}  ${c.pass ? 'pass' : 'FAIL'}${c.name === 'iou' ? `  (${worst('game')})` : c.name === 'iouClose' ? `  (${worst('close')})` : c.floor ? `  (the palette floor ${c.floor} + ${Math.round((c.limit - c.floor) * 1e4) / 1e4})` : ''}`),
    `bounds delta ${signed(score.bounds)} m (trace minus source)`,
    ...(offset ? [`centre offset ${signed(offset)} m (trace minus source)${apart > OFFSET ? ': the trace sits apart from the source; draw it in the reference\'s frame (base on y = 0, footprint centred), or give the source its --front and --scale' : ''}`] : []),
    verdict.pass ? 'PASS' : 'FAIL: under the thresholds',
  ];
}

/** How far apart two bounds' centres may sit before the verdict says so (m). */
const OFFSET = 0.02;

/** The translation's bounds centre minus the source's (m, to the mm): a frame error, not a shape one. */
export function traceOffset(source: ColouredTris, translation: ColouredTris): Vec3 {
  const centre = (t: ColouredTris) => {
    const b = new Box3();
    const v = new Vector3();
    for (let i = 0; i + 2 < t.positions.length; i += 3) b.expandByPoint(v.set(t.positions[i]!, t.positions[i + 1]!, t.positions[i + 2]!));
    return b.isEmpty() ? new Vector3() : b.getCenter(new Vector3());
  };
  const d = centre(translation).sub(centre(source));
  return [mm(d.x), mm(d.y), mm(d.z)];
}

/**
 * The trace sheet: per view (4 yaws at game scale ×4, then close), the trace with the source's
 * outline over it (magenta) and their difference (source only magenta, trace only cyan, both grey
 * to red by colour); front / side / top on a 0.1 m grid with the source's outline; the numbers.
 */
export function renderTraceSheet(source: ColouredTris, translation: ColouredTris, score: FidelityScore, verdict: TraceVerdict, o: { title: string; subtitle?: string; thresholds?: TraceThresholds }): SheetImage {
  const t = o.thresholds ?? TRACE_THRESHOLDS;
  const views = fidelityViews(source, translation);
  const cells = views.map((v, i) => {
    const k = v.scale === 'game' ? 4 : 1;
    const s = fidelityRaster(source, v.yaw, v.pitch, v.ppm, v.frame, v.side);
    const tr = fidelityRaster(translation, v.yaw, v.pitch, v.ppm, v.frame, v.side);
    const f = score.views[i]!;
    const ok = f.iou >= (v.scale === 'game' ? t.iou : t.iouClose);
    const label = textBox([{ text: `${v.scale} yaw ${v.yaw}: iou ${f.iou}${f.colour !== null ? `, dE ${f.colour}` : ''}`, color: ok ? TEXT : BAD }], Math.max(120, v.side * k * 2 + 12));
    return column([label, row([upscale(outlineOver(fidelityShaded(translation, v), s, MAGENTA), k), upscale(fidelityDifference(s, tr), k)])]);
  });
  const body = column([row(cells.slice(0, 4)), row(cells.slice(4))]);
  const frame = views[0]!.frame;
  const ortho = orthoRow(flatOf(translation), frame, { outline: flatOf(source) });
  const w = Math.max(body.width, ortho.width);
  const lines: Line[] = [
    ...verdictLines(score, verdict, traceOffset(source, translation)).map((text, i, all) => ({ text, color: i === all.length - 1 ? (verdict.pass ? GOOD : BAD) : verdict.checks[i] ? (verdict.checks[i]!.pass ? TEXT : BAD) : /apart/.test(text) ? BAD : DIM })),
    { text: 'each view: the trace with the source outline (magenta) | difference (source only magenta, trace only cyan, both grey to red by colour)', color: DIM },
    { text: 'front / side / top: the trace on a 0.1 m grid, the source outline in magenta', color: DIM },
  ];
  return column([titleBar(o.title, w, o.subtitle ?? ''), body, ortho, textBox(lines, w, 0, 'SCORES')]);
}
