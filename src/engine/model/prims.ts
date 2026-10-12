/**
 * Triangles for each primitive kind, in the part's own frame (docs/plans/asset-system.md §4).
 * Box-filled kinds come out filling `[w, h, d]` exactly, centred on the origin; profile kinds
 * (`lathe`, `slab`, `tube`, `mesh`) in their own coordinates. Faces point outward (each
 * triangle is oriented against the direction its shape says is out), zero-area triangles
 * are dropped, and the result is a flat list of positions (9 numbers per triangle): normals
 * are faceted.
 */
import { ExtrudeGeometry, IcosahedronGeometry, Shape, Vector2 } from 'three/webgpu';
import { Rng } from '../random';
import type { MeshData, Prim, Slot, Vec3 } from './types';

export type PrimKind = 'box' | 'cyl' | 'cone' | 'ball' | 'lump' | 'wedge' | 'torus' | 'lathe' | 'slab' | 'tube' | 'mesh';
export const PRIM_KINDS: readonly PrimKind[] = ['box', 'cyl', 'cone', 'ball', 'lump', 'wedge', 'torus', 'lathe', 'slab', 'tube', 'mesh'];
/** Kinds whose first value is the box `[w, h, d]` they fill. */
export const BOX_KINDS: ReadonlySet<PrimKind> = new Set(['box', 'cyl', 'cone', 'ball', 'lump', 'wedge', 'torus']);

export function primKind(p: object): PrimKind | null {
  for (const k of PRIM_KINDS) if (k in p) return k;
  return null;
}

/** Sides a round kind may have (the checks report a `seg` outside this). */
export const SEG_RANGE = [3, 64] as const;
const clampSeg = (n: number) => (Number.isFinite(n) ? Math.min(SEG_RANGE[1], Math.max(SEG_RANGE[0], Math.round(n))) : SEG_RANGE[0]);

/** Sides of a round kind with no `seg`: 6 under 0.3 m across, 8 under 1 m, else 10. */
export function defaultSeg(across: number): number {
  return across < 0.3 ? 6 : across < 1 ? 8 : 10;
}

type P3 = [number, number, number];

/** Collects triangles, oriented so each one's normal agrees with an "outward" direction. */
class Tris {
  readonly out: number[] = [];

  /** Add (a, b, c), flipped if its normal points against `out`. Zero-area triangles are dropped. */
  add(a: P3, b: P3, c: P3, outward: P3): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-20) return;
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) this.out.push(...a, ...c, ...b);
    else this.out.push(...a, ...b, ...c);
  }

  /** A convex polygon (fan from its first corner), facing `outward`. */
  poly(pts: readonly P3[], outward: P3): void {
    for (let i = 1; i + 1 < pts.length; i++) this.add(pts[0]!, pts[i]!, pts[i + 1]!, outward);
  }

  /** Add a triangle pointing away from a centre (convex shapes). */
  away(a: P3, b: P3, c: P3, centre: P3): void {
    this.add(a, b, c, [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]]);
  }
}

/**
 * An n-sided ring starting at +X (angle from +X toward +Z), its bounding box scaled to
 * [-0.5, 0.5]² and centred: a regular polygon's corners when n is even, shifted slightly when
 * odd so the bounds stay centred on the axis.
 */
export function ring(n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return pts.map(([x, z]) => [(x - (x0 + x1) / 2) / (x1 - x0), (z - (z0 + z1) / 2) / (z1 - z0)]);
}

/** Scale positions so their bounds fill `[w, h, d]`, centred on the origin. */
function fill(pos: number[], [w, h, d]: Vec3): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    lo[k] = Math.min(lo[k]!, pos[i]!);
    hi[k] = Math.max(hi[k]!, pos[i]!);
  }
  const size = [w, h, d];
  return pos.map((v, i) => {
    const k = i % 3;
    const span = hi[k]! - lo[k]!;
    return span > 0 ? ((v - (lo[k]! + hi[k]!) / 2) / span) * size[k]! : 0;
  });
}

function box([w, h, d]: Vec3): number[] {
  const t = new Tris();
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const c = (sx: number, sy: number, sz: number): P3 => [sx * x, sy * y, sz * z];
  t.poly([c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)], [1, 0, 0]);
  t.poly([c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)], [-1, 0, 0]);
  t.poly([c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)], [0, 1, 0]);
  t.poly([c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)], [0, -1, 0]);
  t.poly([c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)], [0, 0, 1]);
  t.poly([c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)], [0, 0, -1]);
  return t.out;
}

/** A frustum: rings scaled by `fb` (bottom) and `ft` (top) of the box, either may be 0 (a point). */
function frustum([w, h, d]: Vec3, seg: number, fb: number, ft: number): number[] {
  const t = new Tris();
  const r = ring(seg);
  const at = (k: number, f: number, y: number): P3 => [r[k]![0] * w * f, y, r[k]![1] * d * f];
  const y0 = -h / 2;
  const y1 = h / 2;
  const centre: P3 = [0, 0, 0];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const a = at(i, fb, y0);
    const b = at(j, fb, y0);
    const c = at(j, ft, y1);
    const e = at(i, ft, y1);
    t.away(a, b, c, centre);
    t.away(a, c, e, centre);
  }
  if (fb > 0) t.poly(r.map((_, k) => at(k, fb, y0)), [0, -1, 0]);
  if (ft > 0) t.poly(r.map((_, k) => at(k, ft, y1)), [0, 1, 0]);
  return t.out;
}

function cyl(size: Vec3, seg: number, top: number | undefined): number[] {
  if (top === undefined || top === 1) return frustum(size, seg, 1, 1);
  const t = Math.max(0, top);
  return t <= 1 ? frustum(size, seg, 1, t) : frustum(size, seg, 1 / t, 1);
}

function ball(size: Vec3, seg: number, half: boolean): number[] {
  const t = new Tris();
  const r = ring(seg);
  const bands = half ? Math.max(1, Math.round(seg / 4)) : Math.max(2, Math.round(seg / 2));
  const span = half ? Math.PI / 2 : Math.PI;
  // latitude rings from the top pole down (sin φ: ring scale, cos φ: height)
  const lat = (k: number) => (k / bands) * span;
  const at = (i: number, k: number): P3 => {
    const s = Math.sin(lat(k));
    return [r[i % seg]![0] * s, Math.cos(lat(k)) / 2, r[i % seg]![1] * s];
  };
  const centre: P3 = [0, 0, 0];
  for (let k = 0; k < bands; k++) {
    for (let i = 0; i < seg; i++) {
      const a = at(i, k);
      const b = at(i + 1, k);
      const c = at(i + 1, k + 1);
      const e = at(i, k + 1);
      t.away(a, c, b, centre);
      t.away(a, e, c, centre);
    }
  }
  if (half) t.poly(r.map((_, i) => at(i, bands)), [0, -1, 0]);
  return fill(t.out, size);
}

function lump(size: Vec3, seed: number): number[] {
  const g = new IcosahedronGeometry(0.5, 1);
  const pos = g.getAttribute('position');
  const rng = new Rng(`lump:${seed}`);
  const jitter = new Map<string, number>();
  const out: number[] = [];
  const t = new Tris();
  const v = (i: number): P3 => {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let k = jitter.get(key);
    if (k === undefined) jitter.set(key, (k = 1 + rng.range(-0.16, 0.16)));
    return [x * k, y * k, z * k];
  };
  for (let i = 0; i < pos.count; i += 3) t.away(v(i), v(i + 1), v(i + 2), [0, 0, 0]);
  g.dispose();
  out.push(...t.out);
  return fill(out, size);
}

/** A ramp: full height at the back (−Z), sloping down to the front edge (+Z). */
function wedge([w, h, d]: Vec3): number[] {
  const t = new Tris();
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  t.poly([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0]);
  t.poly([[-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z]], [0, 0, -1]);
  t.poly([[-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, -z]], [0, d, h]);
  t.poly([[x, -y, -z], [x, y, -z], [x, -y, z]], [1, 0, 0]);
  t.poly([[-x, -y, -z], [-x, -y, z], [-x, y, -z]], [-1, 0, 0]);
  return t.out;
}

/** A ring in XZ whose outside fills the box; its tube (square, flat top) is the box height thick. */
function torus([w, h, d]: Vec3, seg: number): number[] {
  const t = new Tris();
  const r = ring(seg);
  const iw = Math.max(0, w - 2 * h);
  const id = Math.max(0, d - 2 * h);
  const o = (k: number, y: number): P3 => [r[k % seg]![0] * w, y, r[k % seg]![1] * d];
  const n = (k: number, y: number): P3 => [r[k % seg]![0] * iw, y, r[k % seg]![1] * id];
  const y0 = -h / 2;
  const y1 = h / 2;
  for (let i = 0; i < seg; i++) {
    const j = i + 1;
    const mid: P3 = [(r[i]![0] + r[j % seg]![0]) / 2, 0, (r[i]![1] + r[j % seg]![1]) / 2];
    t.poly([o(i, y1), o(j, y1), n(j, y1), n(i, y1)], [0, 1, 0]);
    t.poly([o(i, y0), o(j, y0), n(j, y0), n(i, y0)], [0, -1, 0]);
    t.poly([o(i, y0), o(j, y0), o(j, y1), o(i, y1)], mid);
    t.poly([n(i, y0), n(j, y0), n(j, y1), n(i, y1)], [-mid[0], 0, -mid[2]]);
  }
  return t.out;
}

/** (radius, height) points turned about Y. Either direction works; a point on the axis closes it. */
function lathe(profile: readonly (readonly [number, number])[], seg: number): number[] {
  // Shoelace over the profile closed through the axis (last point → axis → first point):
  // negative means it runs top to bottom, so turn it round.
  let area = 0;
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, y0] = profile[k]!;
    const [r1, y1] = profile[k + 1]!;
    area += r0 * y1 - r1 * y0;
  }
  const [rf, yf] = profile[0]!;
  const [rl, yl] = profile[profile.length - 1]!;
  area += rl * yl - rf * yf;
  const pts = area < 0 ? [...profile].reverse() : profile;
  const t = new Tris();
  // a true radius (own coordinates, not stretched to a box), starting at +X like the rings
  const r = Array.from({ length: seg }, (_, i) => [Math.cos((2 * Math.PI * i) / seg), Math.sin((2 * Math.PI * i) / seg)] as const);
  const at = (i: number, k: number): P3 => [r[i % seg]![0] * pts[k]![0], pts[k]![1], r[i % seg]![1] * pts[k]![0]];
  for (let k = 0; k + 1 < pts.length; k++) {
    const dr = pts[k + 1]![0] - pts[k]![0];
    const dy = pts[k + 1]![1] - pts[k]![1];
    for (let i = 0; i < seg; i++) {
      const m = r[i]!;
      const n = r[(i + 1) % seg]!;
      const out: P3 = [dy * (m[0] + n[0]), -dr * 2, dy * (m[1] + n[1])];
      t.add(at(i, k), at(i + 1, k), at(i + 1, k + 1), out);
      t.add(at(i, k), at(i + 1, k + 1), at(i, k + 1), out);
    }
  }
  return t.out;
}

/**
 * A subset of SVG path syntax (M L H V C Q Z, absolute and relative) as closed outlines, in
 * the slab's XY (y up, not SVG's y down). Each subpath is its own solid: no holes.
 */
export function svgOutlines(path: string): [number, number][][] {
  const tokens = path.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const shapes: [number, number][][] = [];
  let cur: [number, number][] = [];
  let x = 0;
  let y = 0;
  let start: [number, number] = [0, 0];
  let cmd = '';
  let i = 0;
  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`bad number in path "${path}"`);
    return v;
  };
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!);
  const close = () => {
    if (cur.length >= 3) shapes.push(cur);
    cur = [];
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++]!;
    // drawing on after a Z (no M) starts from where the last outline began
    if (!cur.length && cmd.toUpperCase() !== 'M' && cmd.toUpperCase() !== 'Z') cur.push([x, y]);
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        close();
        x = ox + num();
        y = oy + num();
        start = [x, y];
        cur.push([x, y]);
        cmd = rel ? 'l' : 'L';
        break;
      case 'L':
        x = ox + num();
        y = oy + num();
        cur.push([x, y]);
        break;
      case 'H':
        x = ox + num();
        cur.push([x, y]);
        break;
      case 'V':
        y = oy + num();
        cur.push([x, y]);
        break;
      case 'C':
      case 'Q': {
        const cubic = cmd.toUpperCase() === 'C';
        const c1: [number, number] = [ox + num(), oy + num()];
        const c2: [number, number] = cubic ? [ox + num(), oy + num()] : c1;
        const end: [number, number] = [ox + num(), oy + num()];
        const s: [number, number] = [x, y];
        for (let k = 1; k <= 4; k++) {
          const u = k / 4;
          const v = 1 - u;
          const p = cubic
            ? [v * v * v * s[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * end[0], v * v * v * s[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * end[1]]
            : [v * v * s[0] + 2 * v * u * c1[0] + u * u * end[0], v * v * s[1] + 2 * v * u * c1[1] + u * u * end[1]];
          cur.push([p[0]!, p[1]!]);
        }
        [x, y] = end;
        break;
      }
      case 'Z':
        if (isNum()) throw new Error(`numbers after Z in path "${path}": start the next outline with M`);
        close();
        [x, y] = start;
        break;
      default:
        throw new Error(`path command "${cmd}" is not supported (M L H V C Q Z)`);
    }
  }
  close();
  return shapes;
}

/** An XY outline extruded `depth` along Z, centred on z = 0. */
function slab(outline: readonly (readonly [number, number])[] | string, depth: number): number[] {
  const shapes = typeof outline === 'string' ? svgOutlines(outline) : [outline];
  const out: number[] = [];
  for (const pts of shapes) {
    const g = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), { depth, bevelEnabled: false, steps: 1 });
    const p = g.getAttribute('position');
    const idx = g.getIndex();
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i++) {
      const v = idx ? idx.getX(i) : i;
      out.push(p.getX(v), p.getY(v), p.getZ(v) - depth / 2);
    }
    g.dispose();
  }
  // ExtrudeGeometry winds both outline directions outward; drop its zero-area triangles
  const t = new Tris();
  for (let i = 0; i < out.length; i += 9) {
    const a: P3 = [out[i]!, out[i + 1]!, out[i + 2]!];
    const b: P3 = [out[i + 3]!, out[i + 4]!, out[i + 5]!];
    const c: P3 = [out[i + 6]!, out[i + 7]!, out[i + 8]!];
    const n = cross(sub(b, a), sub(c, a));
    t.add(a, b, c, n);
  }
  return t.out;
}

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: P3): P3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A tube of `seg` sides swept along points, radius tapering from r0 to r1, capped at both ends. */
function tube(points: readonly Vec3[], r: number | readonly [number, number], seg: number): number[] {
  const t = new Tris();
  const [r0, r1] = typeof r === 'number' ? [r, r] : r;
  const n = points.length;
  if (n < 2) return [];
  const p = points.map((v) => [...v] as P3);
  const lengths = [0];
  for (let k = 1; k < n; k++) lengths.push(lengths[k - 1]! + Math.hypot(...sub(p[k]!, p[k - 1]!)));
  const total = lengths[n - 1]! || 1;
  // tangents, then frames by parallel transport (no twist along the path)
  const tan = p.map((_, k) => norm(sub(p[Math.min(n - 1, k + 1)]!, p[Math.max(0, k - 1)]!)));
  const t0 = tan[0]!;
  let normal = norm(cross(t0, Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rings: P3[][] = [];
  for (let k = 0; k < n; k++) {
    const tk = tan[k]!;
    // remove the tangent component, keeping the frame continuous
    const d = normal[0] * tk[0] + normal[1] * tk[1] + normal[2] * tk[2];
    normal = norm([normal[0] - d * tk[0], normal[1] - d * tk[1], normal[2] - d * tk[2]]);
    const bi = cross(tk, normal);
    const rad = r0 + ((r1 - r0) * lengths[k]!) / total;
    const ringK: P3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (2 * Math.PI * i) / seg;
      const c = Math.cos(a) * rad;
      const s = Math.sin(a) * rad;
      ringK.push([p[k]![0] + normal[0] * c + bi[0] * s, p[k]![1] + normal[1] * c + bi[1] * s, p[k]![2] + normal[2] * c + bi[2] * s]);
    }
    rings.push(ringK);
  }
  for (let k = 0; k + 1 < n; k++) {
    const mid: P3 = [(p[k]![0] + p[k + 1]![0]) / 2, (p[k]![1] + p[k + 1]![1]) / 2, (p[k]![2] + p[k + 1]![2]) / 2];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = rings[k]![i]!;
      const b = rings[k]![j]!;
      const c = rings[k + 1]![j]!;
      const e = rings[k + 1]![i]!;
      t.away(a, b, c, mid);
      t.away(a, c, e, mid);
    }
  }
  const back = tan[0]!;
  const front = tan[n - 1]!;
  t.poly(rings[0]!, [-back[0], -back[1], -back[2]]);
  t.poly(rings[n - 1]!, front);
  return t.out;
}

/** Parse an imported mesh: positions (m) and, per slot, its triangles. Throws on malformed data. */
export function parseMesh(m: MeshData): { v: number[]; f: Map<Slot, number[]> } {
  const v: number[] = [];
  for (const item of m.v.split(',')) {
    const xyz = item.trim().split(/\s+/).map(Number);
    if (xyz.length !== 3 || !xyz.every(Number.isFinite)) throw new Error(`mesh vertex "${item.trim()}" is not "x y z" in millimetres`);
    v.push(xyz[0]! / 1000, xyz[1]! / 1000, xyz[2]! / 1000);
  }
  const count = v.length / 3;
  const f = new Map<Slot, number[]>();
  for (const [slot, faces] of Object.entries(m.f)) {
    const list: number[] = [];
    for (const item of faces.split(',')) {
      const abc = item.trim().split(/\s+/).map(Number);
      if (abc.length !== 3 || !abc.every((i) => Number.isInteger(i) && i >= 0 && i < count)) throw new Error(`mesh face "${item.trim()}" (slot ${slot}) is not three vertex indices below ${count}`);
      list.push(...abc);
    }
    f.set(slot, list);
  }
  return { v, f };
}

function meshTris(m: MeshData): Map<Slot, number[]> {
  const { v, f } = parseMesh(m);
  const out = new Map<Slot, number[]>();
  for (const [slot, idx] of f) {
    const list: number[] = [];
    for (const i of idx) list.push(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
    out.set(slot, list);
  }
  return out;
}

/**
 * The triangles of one primitive in its own frame, per slot: `slot` for every kind but
 * `mesh`, whose faces name their own slots. Throws on malformed input (a bad mesh or path).
 */
export function primTriangles(p: Prim, slot: Slot): Map<Slot, number[]> {
  const kind = primKind(p);
  const q = p as unknown as Record<string, unknown>;
  const size = q[kind ?? ''] as Vec3;
  const seg = (across: number) => clampSeg(p.seg ?? defaultSeg(across));
  let tris: number[];
  switch (kind) {
    case 'box':
      tris = box(size);
      break;
    case 'cyl':
      tris = cyl(size, seg(Math.max(size[0], size[2])), q.top as number | undefined);
      break;
    case 'cone':
      tris = frustum(size, seg(Math.max(size[0], size[2])), 1, 0);
      break;
    case 'ball':
      tris = ball(size, seg(Math.max(size[0], size[2])), q.half === true);
      break;
    case 'lump':
      tris = lump(size, (q.seed as number | undefined) ?? 1);
      break;
    case 'wedge':
      tris = wedge(size);
      break;
    case 'torus':
      tris = torus(size, seg(Math.max(size[0], size[2])));
      break;
    case 'lathe': {
      const prof = q.lathe as readonly (readonly [number, number])[];
      tris = lathe(prof, seg(2 * Math.max(...prof.map((v) => v[0]))));
      break;
    }
    case 'slab':
      tris = slab(q.slab as readonly (readonly [number, number])[] | string, q.depth as number);
      break;
    case 'tube': {
      const r = q.r as number | readonly [number, number];
      tris = tube(q.tube as readonly Vec3[], r, clampSeg(p.seg ?? 6));
      break;
    }
    case 'mesh':
      return meshTris(q.mesh as MeshData);
    default:
      throw new Error(`unknown part kind (keys: ${Object.keys(p).join(', ')})`);
  }
  return new Map([[slot, tris]]);
}
