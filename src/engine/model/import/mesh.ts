/**
 * Imported triangles → parts (docs/assets/importing.md). Vertices are welded on a
 * millimetre grid and degenerate triangles dropped. A connected piece becomes a primitive only
 * where the test is exact: re-emitted as a `box` or a `cyl` (an n-gon prism, regular or
 * stretched per axis exactly as the compiler stretches one), it must give back the same
 * vertices within a millimetre and a half, the same triangle count, surface area and volume.
 * Everything else in the group stays one `mesh` part, its faces listed per slot.
 */
import { Euler, Matrix4, Vector3 } from 'three/webgpu';
import { compileParts } from '../compile';
import { ring } from '../prims';
import type { MeshData, Prim, Slot, Vec3 } from '../types';

/** How far (mm) a re-emitted primitive's vertex may sit from the source's. */
const TOL = 1.5;
const DEG = 180 / Math.PI;

type V = readonly [number, number, number];
type Tri = readonly [number, number, number];

interface Piece {
  /** Vertex indices into the welded list, per triangle. */
  readonly tris: Tri[];
  readonly slots: Slot[];
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const add = (...vs: V[]): V => vs.reduce<V>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const unit = (a: V): V => scale(a, 1 / (len(a) || 1));
/** Metres, to the millimetre (and no −0). */
const mm = (v: number) => Math.round(v) / 1000 + 0;
const deg = (v: number) => Math.round(v * DEG * 1000) / 1000 + 0;

/** Area and signed volume (outward winding: positive) of triangles. */
function measure(vs: readonly V[], tris: readonly Tri[]): { area: number; volume: number } {
  let area = 0;
  let volume = 0;
  for (const [a, b, c] of tris) {
    const n = cross(sub(vs[b]!, vs[a]!), sub(vs[c]!, vs[a]!));
    area += len(n) / 2;
    volume += dot(vs[a]!, cross(vs[b]!, vs[c]!)) / 6;
  }
  return { area, volume };
}

/** For each point of `a`, its nearest in `b` within `tol` (one to one), or null if one has none. */
function pairs(a: readonly V[], b: readonly V[], tol = TOL): number[] | null {
  if (a.length !== b.length) return null;
  const free = new Set(b.map((_, i) => i));
  const out: number[] = [];
  for (const p of a) {
    let hit = -1;
    let best = tol;
    for (const i of free) {
      const dist = len(sub(p, b[i]!));
      if (dist <= best) [best, hit] = [dist, i];
    }
    if (hit < 0) return null;
    free.delete(hit);
    out.push(hit);
  }
  return out;
}

const samePoints = (a: readonly V[], b: readonly V[], tol = TOL) => pairs(a, b, tol) !== null;

/** A primitive's welded vertices (mm) and triangles, as the compiler builds it. */
function compiled(part: Prim): { vs: V[]; tris: Tri[] } {
  const c = compileParts([part]);
  const p = c.parts[0];
  if (!p || c.problems.length) return { vs: [], tris: [] };
  const vs: V[] = [];
  const index = new Map<string, number>();
  const tris: Tri[] = [];
  const v = new Vector3();
  const at = (k: number) => {
    v.set(p.tris[k]!, p.tris[k + 1]!, p.tris[k + 2]!).applyMatrix4(p.matrix).multiplyScalar(1000);
    const key = `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`;
    let i = index.get(key);
    if (i === undefined) index.set(key, (i = vs.push([v.x, v.y, v.z]) - 1));
    return i;
  };
  for (let k = 0; k < p.tris.length; k += 9) tris.push([at(k), at(k + 3), at(k + 6)]);
  return { vs, tris };
}

/** The exactness test: same vertices, triangle count, area and volume as the source piece. */
function matches(part: Prim, vs: readonly V[], tris: readonly Tri[]): boolean {
  const c = compiled(part);
  if (c.tris.length !== tris.length || !samePoints(vs, c.vs)) return false;
  const m = measure(vs, tris);
  const n = measure(c.vs, c.tris);
  return Math.abs(m.area - n.area) <= 0.005 * n.area + TOL * TOL && Math.abs(m.volume - n.volume) <= 0.01 * Math.abs(n.volume) + TOL ** 3;
}

/** Degrees XYZ (the compiler's order) of the frame with these unit axes as columns. */
function eulerOf(x: V, y: V, z: V): Vec3 {
  const e = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(...x), new Vector3(...y), new Vector3(...z)), 'XYZ');
  return [deg(e.x), deg(e.y), deg(e.z)];
}

const turned = (r: Vec3) => r[0] !== 0 || r[1] !== 0 || r[2] !== 0;

/** Of the six ways to give a frame's axes to X, Y and Z (each pointing its positive way), the one nearest no turn. */
function nearestAxes(frame: readonly V[], sizes: readonly number[]): { axes: V[]; size: number[] } {
  let best: { axes: V[]; size: number[]; score: number } | null = null;
  for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const axes = perm.map((p, w) => scale(frame[p]!, Math.sign(frame[p]![w]!) || 1));
    if (dot(cross(axes[0]!, axes[1]!), axes[2]!) < 0) axes[2] = scale(axes[2]!, -1); // a box is symmetric
    const score = axes[0]![0]! + axes[1]![1]! + axes[2]![2]!;
    if (!best || score > best.score + 1e-9) best = { axes, size: perm.map((p) => sizes[p]!), score };
  }
  return best!;
}

/**
 * An oriented box: 8 vertices, 12 triangles, three orthogonal edges from a corner. Its frame
 * comes from the longest edge (least rounding), its centre and sizes from all 8 corners.
 */
function asBox(vs: readonly V[], tris: readonly Tri[]): Prim | null {
  if (vs.length !== 8 || tris.length !== 12) return null;
  const p0 = vs[0]!;
  const d = vs.slice(1).map((v) => sub(v, p0));
  const loose = 2 * TOL; // edges and their sums carry two corners' rounding
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      for (let k = j + 1; k < 7; k++) {
        const e = [d[i]!, d[j]!, d[k]!];
        const ortho = (a: V, b: V) => Math.abs(dot(a, b)) <= loose * (len(a) + len(b));
        if (!ortho(e[0]!, e[1]!) || !ortho(e[0]!, e[2]!) || !ortho(e[1]!, e[2]!)) continue;
        const want = [add(e[0]!, e[1]!), add(e[0]!, e[2]!), add(e[1]!, e[2]!), add(e[0]!, e[1]!, e[2]!)];
        const rest = d.filter((_, q) => q !== i && q !== j && q !== k);
        const m = pairs(want, rest, loose);
        if (!m) continue;
        // corners by their bits along the three edges; each edge the mean of its four copies
        const corner: V[] = [[0, 0, 0], e[0]!, e[1]!, rest[m[0]!]!, e[2]!, rest[m[1]!]!, rest[m[2]!]!, rest[m[3]!]!];
        const edges = [1, 2, 4].map((bit) => scale(add(...[0, 1, 2, 3, 4, 5, 6, 7].filter((c) => !(c & bit)).map((c) => sub(corner[c | bit]!, corner[c]!))), 1 / 4));
        const byLen = edges.sort((a, b) => len(b) - len(a));
        const f0 = unit(byLen[0]!);
        const f1 = unit(sub(byLen[1]!, scale(f0, dot(byLen[1]!, f0))));
        const frame = [f0, f1, cross(f0, f1)];
        const centre = scale(add(...vs), 1 / 8);
        const sizes = frame.map((f) => (2 * vs.reduce((s, v) => s + Math.abs(dot(sub(v, centre), f)), 0)) / 8);
        const { axes, size } = nearestAxes(frame, sizes);
        const rot = eulerOf(axes[0]!, axes[1]!, axes[2]!);
        const part: Prim = { box: [mm(size[0]!), mm(size[1]!), mm(size[2]!)], at: [mm(centre[0]), mm(centre[1]), mm(centre[2])], ...(turned(rot) ? { rot } : {}) };
        return matches(part, vs, tris) ? part : null;
      }
    }
  }
  return null;
}

/**
 * An n-gon prism as `cyl` makes one: two rings of n vertices, 4n − 4 triangles, each ring
 * `ring(n)` stretched along two axes. The frame's X runs from the ring's centre through the
 * vertex that `ring` starts at (of the n candidates, the one nearest no turn wins); the
 * stretch is then fitted to every vertex.
 */
function asCyl(vs: readonly V[], tris: readonly Tri[]): Prim | null {
  const n = vs.length / 2;
  if (!Number.isInteger(n) || n < 3 || n > 64 || tris.length !== 4 * n - 4) return null;
  const normals = new Map<string, V>();
  for (const [a, b, c] of tris) {
    const nv = unit(cross(sub(vs[b]!, vs[a]!), sub(vs[c]!, vs[a]!)));
    const s = nv[0] < -1e-6 || (Math.abs(nv[0]) <= 1e-6 && (nv[1] < -1e-6 || (Math.abs(nv[1]) <= 1e-6 && nv[2] < 0))) ? -1 : 1;
    const key = nv.map((x) => Math.round(x * s * 100)).join();
    if (!normals.has(key)) normals.set(key, scale(nv, s));
  }
  const unitRing = ring(n);
  const mx = unitRing.reduce((s, p) => s + p[0], 0) / n;
  const mz = unitRing.reduce((s, p) => s + p[1], 0) / n;
  const zMax = Math.max(...unitRing.map((p) => Math.abs(p[1] - mz)));
  const shape = unitRing.map(([x, z]) => [x - mx, 0, z - mz] as V);
  for (const axis of normals.values()) {
    const order = vs.map((v, i) => [dot(v, axis), i] as const).sort((p, q) => p[0] - q[0]);
    const lo = order.slice(0, n);
    const hi = order.slice(n);
    if (lo[n - 1]![0] - lo[0]![0] > TOL || hi[n - 1]![0] - hi[0]![0] > TOL || hi[0]![0] - lo[n - 1]![0] <= TOL) continue;
    const bottom = lo.map(([, i]) => vs[i]!);
    const top = hi.map(([, i]) => vs[i]!);
    const cb = scale(add(...bottom), 1 / n);
    const up = sub(scale(add(...top), 1 / n), cb);
    const Y = unit(up);
    if (len(cross(Y, axis)) > 0.01 || !samePoints(top, bottom.map((v) => add(v, up)), 2 * TOL)) continue;
    const flat = [...bottom, ...top].map((v) => {
      const q = sub(v, cb);
      return sub(q, scale(Y, dot(q, Y)));
    });
    let found: { X: V; Z: V; w: number; d: number; score: number } | null = null;
    for (const p of flat.slice(0, n)) {
      if (len(p) <= TOL) continue;
      const X = unit(p);
      const Z = cross(X, Y);
      const local = flat.map((q) => [dot(q, X), 0, dot(q, Z)] as V);
      const w0 = len(p) / shape[0]![0];
      const d0 = Math.max(...local.map((q) => Math.abs(q[2]))) / zMax;
      if (!(w0 > 0 && d0 > 0)) continue;
      // both rings against the shape, then the stretch fitted to every vertex (least squares)
      const want = [...shape, ...shape].map(([x, , z]) => [x * w0, 0, z * d0] as V);
      const m = pairs(local, want, 2 * TOL);
      if (!m) continue;
      const fit = (k: 0 | 2) => local.reduce((s, q, i) => s + q[k] * shape[m[i]! % n]![k], 0) / local.reduce((s, _, i) => s + shape[m[i]! % n]![k] ** 2, 0);
      const score = X[0] + Y[1] + Z[2];
      if (!found || score > found.score + 1e-9) found = { X, Z, w: fit(0), d: Math.abs(fit(2)), score };
    }
    if (!found) continue;
    const { X, Z, w, d } = found;
    const at = add(cb, scale(up, 0.5), scale(X, -mx * w), scale(Z, -mz * d));
    const rot = eulerOf(X, Y, Z);
    const part: Prim = { cyl: [mm(w), mm(len(up)), mm(d)], seg: n, at: [mm(at[0]), mm(at[1]), mm(at[2])], ...(turned(rot) ? { rot } : {}) };
    if (matches(part, vs, tris)) return part;
  }
  return null;
}

/** Union-find pieces: triangles that share a welded vertex. */
function pieces(count: number, tris: readonly Tri[]): number[][] {
  const root = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
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

/** A mesh part's data: vertices (mm) relative to `at` (the bounds centre, to the millimetre). */
function meshPart(vs: readonly V[], piece: Piece): Prim & { mesh: MeshData } {
  const used: number[] = [];
  const local = new Map<number, number>();
  for (const t of piece.tris) for (const i of t) if (!local.has(i)) local.set(i, used.push(i) - 1);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const i of used) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k]!, vs[i]![k]!), Math.max(hi[k]!, vs[i]![k]!)];
  const c = [0, 1, 2].map((k) => Math.round((lo[k]! + hi[k]!) / 2));
  const v = used.map((i) => vs[i]!.map((x, k) => x - c[k]! + 0).join(' ')).join(',');
  // a Map, not an object: a slot may be called 'constructor' or 'toString'
  const f = new Map<Slot, string[]>();
  piece.tris.forEach((t, k) => {
    const face = t.map((i) => local.get(i)!).join(' ');
    const list = f.get(piece.slots[k]!);
    if (list) list.push(face);
    else f.set(piece.slots[k]!, [face]);
  });
  return { mesh: { v, f: Object.fromEntries([...f].map(([s, list]) => [s, list.join(',')])) }, at: [c[0]! / 1000 + 0, c[1]! / 1000 + 0, c[2]! / 1000 + 0] };
}

export interface GroupParts {
  readonly parts: Prim[];
  /** Triangles dropped as degenerate once welded to the millimetre. */
  readonly dropped: number;
}

/**
 * One source group (a node and a material) → parts: its pieces that are exactly a box or a
 * cyl, then one mesh with the rest. `positions` are metres, 9 a triangle; `slots` one a triangle.
 */
export function groupParts(positions: ArrayLike<number>, slots: readonly Slot[]): GroupParts {
  const vs: V[] = [];
  const index = new Map<string, number>();
  const weld = (k: number): number => {
    const p: V = [Math.round(positions[k]! * 1000), Math.round(positions[k + 1]! * 1000), Math.round(positions[k + 2]! * 1000)];
    const key = p.join();
    let i = index.get(key);
    if (i === undefined) index.set(key, (i = vs.push(p) - 1));
    return i;
  };
  const tris: Tri[] = [];
  const triSlots: Slot[] = [];
  let dropped = 0;
  for (let t = 0; t * 9 < positions.length; t++) {
    const tri: Tri = [weld(t * 9), weld(t * 9 + 3), weld(t * 9 + 6)];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2] || len(cross(sub(vs[tri[1]]!, vs[tri[0]]!), sub(vs[tri[2]]!, vs[tri[0]]!))) === 0) {
      dropped++;
      continue;
    }
    tris.push(tri);
    triSlots.push(slots[t]!);
  }
  const parts: Prim[] = [];
  const rest: Piece = { tris: [], slots: [] };
  for (const members of pieces(vs.length, tris)) {
    const ptris = members.map((i) => tris[i]!);
    const pslots = members.map((i) => triSlots[i]!);
    const ids = [...new Set(ptris.flat())];
    const remap = new Map(ids.map((id, k) => [id, k]));
    const pvs = ids.map((i) => vs[i]!);
    const ltris = ptris.map((t) => t.map((i) => remap.get(i)!) as unknown as Tri);
    const prim = new Set(pslots).size === 1 ? (asBox(pvs, ltris) ?? asCyl(pvs, ltris)) : null;
    if (prim) parts.push({ ...prim, c: pslots[0]! } as Prim);
    else {
      rest.tris.push(...ptris);
      rest.slots.push(...pslots);
    }
  }
  if (rest.tris.length) parts.push(meshPart(vs, rest));
  return { parts, dropped };
}
