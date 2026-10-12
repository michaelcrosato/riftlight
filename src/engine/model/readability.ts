/**
 * Readability checks (docs/plans/asset-system.md §4.3, the Phase 2a warnings): a part hidden
 * inside another, coplanar faces of different colours (z-fighting), and touching large masses
 * too close in lightness to read apart at 480×270. `validateModel` adds them to its warnings;
 * each kind is one line per container, colour pair or slot pair, so a big model stays readable.
 */
import { Vector3 } from 'three/webgpu';
import { PALETTE } from '../palette';
import { bindingHex } from './build';
import type { CompiledPart } from './compile';
import type { ExpandedModel } from './expand';
import { oklab } from './oklab';

/** Kinds whose solid is convex: a part entirely inside one never shows. */
const CONVEX = new Set(['box', 'cyl', 'cone', 'ball', 'wedge']);
/** Lightness (OKLab L) two touching large masses need between them to read apart. */
export const MIN_LIGHTNESS_STEP = 0.08;
/** A mass is large when its two biggest extents are at least this (m): ~5 art pixels. */
const LARGE = 0.25;
/** Faces this close (m) and this parallel are one plane. */
const PLANE = 0.001;

const r2 = (v: number) => Math.round(v * 100) / 100;
const colourName = (hex: number) => Object.entries(PALETTE).find(([, v]) => v === hex)?.[0] ?? `#${hex.toString(16).padStart(6, '0')}`;
const list = (labels: readonly string[]) => `${labels.slice(0, 4).join(', ')}${labels.length > 4 ? ', …' : ''}`;

interface World {
  readonly part: CompiledPart;
  readonly pts: Vector3[];
  readonly min: Vector3;
  readonly max: Vector3;
  readonly hex: number;
  /** A mirrored part's triangles wind the other way. */
  readonly flip: boolean;
}

interface Face {
  readonly i: number;
  readonly a: Vector3;
  readonly b: Vector3;
  readonly c: Vector3;
  readonly n: Vector3;
  readonly d: number;
  readonly min: Vector3;
  readonly max: Vector3;
}

function worldOf(parts: readonly CompiledPart[], palette: ExpandedModel['palette']): World[] {
  return parts.map((part) => {
    const pts: Vector3[] = [];
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < part.tris.length; i += 3) {
      const v = new Vector3(part.tris[i]!, part.tris[i + 1]!, part.tris[i + 2]!).applyMatrix4(part.matrix);
      pts.push(v);
      min.min(v);
      max.max(v);
    }
    const b = palette[part.slot];
    return { part, pts, min, max, hex: b === undefined ? 0xff00ff : bindingHex(b), flip: part.matrix.determinant() < 0 };
  });
}

function facesOf(w: readonly World[]): Face[] {
  const out: Face[] = [];
  w.forEach((x, i) => {
    for (let k = 0; k + 2 < x.pts.length; k += 3) {
      const [a, b, c] = [x.pts[k]!, x.pts[k + 1]!, x.pts[k + 2]!];
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      if (n.lengthSq() < 1e-18) continue;
      n.normalize();
      if (x.flip) n.negate();
      out.push({ i, a, b, c, n, d: n.dot(a), min: a.clone().min(b).min(c), max: a.clone().max(b).max(c) });
    }
  });
  return out;
}

/** Hidden parts, z-fighting faces and touching masses too close in lightness. */
export function readabilityWarnings(parts: readonly CompiledPart[], palette: ExpandedModel['palette'], floats = false): string[] {
  const out: string[] = [];
  const w = worldOf(parts, palette);
  const faces = facesOf(w);
  const eps = 1e-4;

  // ---- hidden: every vertex of A inside convex B (same pivot: a moving part may come out)
  const planes = w.map((b, j) => (CONVEX.has(b.part.kind) ? faces.filter((f) => f.i === j).map((f) => ({ n: f.n, d: f.d })) : null));
  const inside = (i: number, j: number) => {
    const a = w[i]!;
    const b = w[j]!;
    if (a.min.x < b.min.x - eps || a.min.y < b.min.y - eps || a.min.z < b.min.z - eps || a.max.x > b.max.x + eps || a.max.y > b.max.y + eps || a.max.z > b.max.z + eps) return false;
    return a.pts.every((p) => planes[j]!.every((pl) => pl.n.dot(p) - pl.d <= eps));
  };
  const hiddenIn = new Map<number, Set<string>>();
  w.forEach((a, i) => {
    for (let j = 0; j < w.length; j++) {
      const b = w[j]!;
      if (i === j || !planes[j] || a.part.matrix === b.part.matrix || a.part.pivot !== b.part.pivot) continue;
      if (!inside(i, j)) continue;
      // two parts filling the same space: report the later one, once
      if (planes[i] && inside(j, i) && j > i) continue;
      const set = hiddenIn.get(j) ?? new Set<string>();
      set.add(a.part.label);
      hiddenIn.set(j, set);
      break;
    }
  });
  for (const [j, set] of hiddenIn) {
    const labels = [...set];
    const who = labels.length > 1 ? `${labels.length} parts (${list(labels)}) are` : `${labels[0]} is`;
    out.push(`${who} inside ${w[j]!.part.label}: at most a face flush with it shows; remove ${labels.length > 1 ? 'them' : 'it'} or move ${labels.length > 1 ? 'them' : 'it'} out`);
  }

  // ---- z-fighting: coplanar, same-facing, overlapping faces of different materials. Faces
  // that face the same way are sorted by plane offset and swept within 1 mm, so no plane is
  // split at a bucket edge. One line per colour pair: its part pairs and the planes they share.
  interface Fight {
    readonly pairs: Set<string>;
    readonly labels: string[];
    readonly planes: Map<string, number>;
  }
  const fights = new Map<string, Fight>();
  const byNormal = new Map<string, Face[]>();
  for (const f of faces) {
    const key = `${Math.round(f.n.x * 100)},${Math.round(f.n.y * 100)},${Math.round(f.n.z * 100)}`;
    const group = byNormal.get(key);
    if (group) group.push(f);
    else byNormal.set(key, [f]);
  }
  const sweep = (sorted: Face[]) => {
    for (let x = 0; x < sorted.length; x++) {
      const p = sorted[x]!;
      for (let y = x + 1; y < sorted.length && sorted[y]!.d - p.d <= PLANE; y++) {
        const q = sorted[y]!;
        if (p.i === q.i) continue;
        const pa = w[p.i]!;
        const qa = w[q.i]!;
        if ((pa.hex === qa.hex && pa.part.glow === qa.part.glow) || pa.part.matrix === qa.part.matrix) continue;
        if (p.n.dot(q.n) < 0.9999) continue;
        if (!floats && p.n.y < -0.999 && Math.abs(p.d) < PLANE) continue; // bottoms on the floor never show
        const t = PLANE; // the planes may be up to 1 mm apart
        if (p.max.x < q.min.x - t || q.max.x < p.min.x - t || p.max.y < q.min.y - t || q.max.y < p.min.y - t || p.max.z < q.min.z - t || q.max.z < p.min.z - t) continue;
        const [lo, hi] = p.i < q.i ? [p.i, q.i] : [q.i, p.i];
        const colours = [w[lo]!.hex, w[hi]!.hex].sort().join('|');
        const g = fights.get(colours) ?? { pairs: new Set<string>(), labels: [], planes: new Map<string, number>() };
        fights.set(colours, g);
        const pair = `${lo}|${hi}`;
        if (g.pairs.has(pair) || overlapArea(p, q) < 1e-6) continue;
        g.pairs.add(pair);
        if (g.labels.length < 4) g.labels.push(`${w[lo]!.part.label} (${colourName(w[lo]!.hex)}) and ${w[hi]!.part.label} (${colourName(w[hi]!.hex)})`);
        const plane = planeName(p);
        g.planes.set(plane, (g.planes.get(plane) ?? 0) + 1);
      }
    }
  };
  for (const group of byNormal.values()) sweep(group.sort((p, q) => p.d - q.d));
  for (const g of fights.values()) {
    if (!g.pairs.size) continue;
    const at = g.planes.size > 1 ? `on ${g.planes.size} planes` : `at ${[...g.planes.keys()][0]}`;
    const who = g.pairs.size > 1 ? `${g.pairs.size} pairs of parts (${g.labels.join(', ')}${g.pairs.size > 4 ? ', …' : ''}) share faces` : `${g.labels[0]} share a face`;
    out.push(`${who} ${at} (z-fighting): move one 2 mm or more, or give them one colour`);
  }

  // ---- touching large masses that won't read apart: one line per colour pair
  const ext = (x: World) => [x.max.x - x.min.x, x.max.y - x.min.y, x.max.z - x.min.z].sort((a, b) => a - b);
  const pairs = new Set<string>();
  w.forEach((a, i) => {
    w.forEach((b, j) => {
      if (j <= i || a.hex === b.hex || a.part.glow || b.part.glow) return;
      if (ext(a)[1]! < LARGE || ext(b)[1]! < LARGE) return;
      const gap = Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));
      if (gap > 0.01) return;
      const dl = Math.abs(oklab(a.hex).L - oklab(b.hex).L);
      const key = [a.hex, b.hex].sort().join('|');
      if (dl >= MIN_LIGHTNESS_STEP || pairs.has(key)) return;
      pairs.add(key);
      out.push(`${a.part.label} (${colourName(a.hex)}) and ${b.part.label} (${colourName(b.hex)}) touch but differ by only ${r2(dl)} in lightness (under ${MIN_LIGHTNESS_STEP}): they won't read apart at 480×270; pick colours further apart in lightness`);
    });
  });
  return out;
}

function planeName(p: Face): string {
  if (Math.abs(p.n.y) > 0.99) return `y = ${r2(p.d * Math.sign(p.n.y))}`;
  if (Math.abs(p.n.x) > 0.99) return `x = ${r2(p.d * Math.sign(p.n.x))}`;
  if (Math.abs(p.n.z) > 0.99) return `z = ${r2(p.d * Math.sign(p.n.z))}`;
  return 'a slanted plane';
}

/** Area shared by two coplanar triangles (clipped in the plane's 2D coordinates). */
function overlapArea(p: Face, q: Face): number {
  const u = Math.abs(p.n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const e1 = u.cross(p.n).normalize();
  const e2 = p.n.clone().cross(e1);
  const to2 = (v: Vector3): [number, number] => [v.dot(e1), v.dot(e2)];
  let poly = [p.a, p.b, p.c].map(to2);
  const clip = [q.a, q.b, q.c].map(to2);
  const area2 = (t: [number, number][]) => t.reduce((s, v, i) => s + v[0] * t[(i + 1) % t.length]![1] - t[(i + 1) % t.length]![0] * v[1], 0);
  if (area2(clip) < 0) clip.reverse();
  for (let i = 0; i < 3 && poly.length; i++) {
    const [ax, ay] = clip[i]!;
    const [bx, by] = clip[(i + 1) % 3]!;
    const side = (v: [number, number]) => (bx - ax) * (v[1] - ay) - (by - ay) * (v[0] - ax);
    const next: [number, number][] = [];
    for (let k = 0; k < poly.length; k++) {
      const c = poly[k]!;
      const d = poly[(k + 1) % poly.length]!;
      const sc = side(c);
      const sd = side(d);
      if (sc >= 0) next.push(c);
      if (sc >= 0 !== sd >= 0) {
        const t = sc / (sc - sd);
        next.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]);
      }
    }
    poly = next;
  }
  return poly.length >= 3 ? Math.abs(area2(poly)) / 2 : 0;
}
