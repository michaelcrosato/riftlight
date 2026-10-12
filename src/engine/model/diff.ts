/**
 * What changed between two versions of a model, in words: parts added, removed, moved,
 * resized, turned and recoloured (matched by name, else by kind and the nearest centre and
 * size), plus the bounds, triangles, draws and materials. `npm run model -- diff` prints it.
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { PALETTE } from '../palette';
import { bindingHex, layoutModel } from './build';
import { boundsOf, type Compiled, type CompiledPart } from './compile';
import type { ExpandedModel } from './expand';

export interface ModelVersion {
  readonly model: ExpandedModel;
  readonly compiled: Compiled;
}

export interface ModelDiff {
  /** Numbers: [before, after, after − before]. */
  readonly counts: Readonly<Record<string, readonly [number, number, number]>>;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly moved: readonly string[];
  readonly resized: readonly string[];
  readonly rotated: readonly string[];
  readonly recoloured: readonly string[];
  readonly same: boolean;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const fmt = (v: number) => `${+v.toFixed(3)}`;
const colourName = (hex: number) => (Object.entries(PALETTE).find(([, v]) => v === hex)?.[0] ?? `#${hex.toString(16).padStart(6, '0')}`);

/** A stable hash of a model's geometry and colours (1e-4 m), for history and `same`. */
export function modelFingerprint(v: ModelVersion): string {
  let h = 2166136261;
  const mix = (x: number) => (h = Math.imul(h ^ (Math.round(x * 1e4) | 0), 16777619) >>> 0);
  for (const p of v.compiled.parts) {
    const e = p.matrix.elements;
    for (const x of e) mix(x);
    for (const x of p.tris) mix(x);
    const b = v.model.palette[p.slot];
    mix(b === undefined ? -1 : bindingHex(b));
    mix(p.glow ? 1 : 0);
  }
  return h.toString(16).padStart(8, '0');
}

/** Parts as the diff sees them: one per primitive (an imported mesh's slots are one part). */
interface Piece {
  readonly label: string;
  readonly named: boolean;
  readonly kind: string;
  readonly parts: CompiledPart[];
  readonly centre: Vector3;
  /** Its own box times its frame's scale: unchanged by rotation. */
  readonly size: Vector3;
  readonly rot: Matrix4;
}

function pieces(parts: readonly CompiledPart[]): Piece[] {
  const out: Piece[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.parts[0]!.matrix === p.matrix && last.label === p.label) {
      last.parts.push(p);
      continue;
    }
    const b = boundsOf([p]);
    const scale = new Vector3();
    const rot = new Matrix4().extractRotation(p.matrix);
    p.matrix.decompose(new Vector3(), new Quaternion(), scale);
    out.push({
      label: p.label,
      named: p.label.startsWith("'"),
      kind: p.kind,
      parts: [p],
      centre: new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2),
      size: new Vector3(...p.extent).multiply(scale.set(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))),
      rot,
    });
  }
  return out;
}

/**
 * Pairs before → after: named parts by name (and occurrence), the rest by kind and the nearest
 * centre and size, so inserting a part doesn't make every later one "removed and added".
 */
function match(a: Piece[], b: Piece[]): { pairs: [Piece, Piece][]; removed: Piece[]; added: Piece[] } {
  const pairs: [Piece, Piece][] = [];
  const left = new Set(a);
  const right = new Set(b);
  const occurrence = (list: Piece[]) => {
    const seen = new Map<string, number>();
    return new Map(list.filter((p) => p.named).map((p) => {
      const n = (seen.get(p.label) ?? 0) + 1;
      seen.set(p.label, n);
      return [`${p.label}#${n}`, p] as const;
    }));
  };
  const na = occurrence(a);
  const nb = occurrence(b);
  for (const [k, p] of na) {
    const q = nb.get(k);
    if (q && q.kind === p.kind) {
      pairs.push([p, q]);
      left.delete(p);
      right.delete(q);
    }
  }
  const cost = (p: Piece, q: Piece) => p.centre.distanceTo(q.centre) + p.size.distanceTo(q.size) + (p.parts[0]!.slot === q.parts[0]!.slot ? 0 : 0.05);
  const candidates: [number, Piece, Piece][] = [];
  for (const p of left) for (const q of right) if (p.kind === q.kind && !p.named && !q.named) candidates.push([cost(p, q), p, q]);
  candidates.sort((x, y) => x[0] - y[0]);
  for (const [c, p, q] of candidates) {
    if (c > 1 || !left.has(p) || !right.has(q)) continue; // further than a metre apart: a new part
    pairs.push([p, q]);
    left.delete(p);
    right.delete(q);
  }
  return { pairs, removed: [...left], added: [...right] };
}

export function diffModels(a: ModelVersion, b: ModelVersion): ModelDiff {
  const la = layoutModel(a.compiled, a.model.palette);
  const lb = layoutModel(b.compiled, b.model.palette);
  const mats = (l: typeof la) => new Set(l.meshes.map((m) => `${m.glow}|${m.hex}`)).size;
  const num = (x: number, y: number): readonly [number, number, number] => [r3(x), r3(y), r3(y - x)];
  const counts = {
    triangles: num(la.tris, lb.tris),
    draws: num(la.meshes.length, lb.meshes.length),
    materials: num(mats(la), mats(lb)),
    parts: num(a.compiled.parts.length, b.compiled.parts.length),
    'size.x': num(la.bounds.size[0], lb.bounds.size[0]),
    'size.y': num(la.bounds.size[1], lb.bounds.size[1]),
    'size.z': num(la.bounds.size[2], lb.bounds.size[2]),
  };
  const m = match(pieces(a.compiled.parts), pieces(b.compiled.parts));
  const moved: string[] = [];
  const resized: string[] = [];
  const rotated: string[] = [];
  const recoloured: string[] = [];
  const colours = (v: ModelVersion, ps: CompiledPart[]) => ps.map((p) => (v.model.palette[p.slot] === undefined ? 0xff00ff : bindingHex(v.model.palette[p.slot]!)));
  const order = new Map(pieces(b.compiled.parts).map((p, i) => [p.label, i]));
  m.pairs.sort((x, y) => (order.get(x[1].label) ?? 0) - (order.get(y[1].label) ?? 0)); // in the def's order
  for (const [pa, pb] of m.pairs) {
    const k = pb.label === pa.label ? pb.label : `${pb.label} (was ${pa.label})`;
    const d = pb.centre.clone().sub(pa.centre);
    if (d.length() > 0.002) {
      const axes = d.toArray().map((v, i) => (Math.abs(v) > 0.002 ? `${v > 0 ? '+' : ''}${fmt(v)} ${'xyz'[i]}` : '')).filter(Boolean);
      moved.push(`${k} moved ${fmt(d.length())} m (${axes.join(', ')})`);
    }
    if (pa.size.distanceTo(pb.size) > 0.002) resized.push(`${k} ${pa.size.toArray().map(fmt).join(' × ')} → ${pb.size.toArray().map(fmt).join(' × ')} m`);
    const rel = pa.rot.clone().transpose().multiply(pb.rot).elements;
    const angle = (Math.acos(Math.min(1, Math.max(-1, (rel[0]! + rel[5]! + rel[10]! - 1) / 2))) * 180) / Math.PI;
    if (angle > 0.5) rotated.push(`${k} turned ${+angle.toFixed(1)}°`);
    const ha = colours(a, pa.parts);
    const hb = colours(b, pb.parts);
    if (ha.join() !== hb.join()) recoloured.push(`${k} ${ha.map(colourName).join('/')} → ${hb.map(colourName).join('/')}`);
  }
  const same = modelFingerprint(a) === modelFingerprint(b);
  return { counts, added: m.added.map((p) => p.label), removed: m.removed.map((p) => p.label), moved, resized, rotated, recoloured, same };
}

/** The diff as lines of text. */
export function diffLines(d: ModelDiff): string[] {
  const out: string[] = [d.same ? 'identical' : 'changed'];
  for (const [k, [x, y, dd]] of Object.entries(d.counts)) if (dd) out.push(`${k.padEnd(10)} ${String(x).padStart(8)} → ${String(y).padEnd(8)} ${dd > 0 ? '+' : ''}${dd}`);
  for (const [label, list] of [['+ added', d.added], ['- removed', d.removed], ['~ moved', d.moved], ['~ resized', d.resized], ['~ turned', d.rotated], ['~ recoloured', d.recoloured]] as const) for (const x of list) out.push(`${label}: ${x}`);
  return out;
}
