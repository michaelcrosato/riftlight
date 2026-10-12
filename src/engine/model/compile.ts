/**
 * Expanded parts → placed triangles. Every primitive becomes one `CompiledPart` per slot: its
 * own triangles and the matrix that puts them in model space. Groups, mirrors and pivots are
 * frames; `on` parts are placed after the rest, on top of what they name. Pure (three's math
 * only), so the checks, the sheets and `buildModel` share it.
 */
import { Euler, Matrix4, Vector3 } from 'three/webgpu';
import { partLabel } from './expand';
import { BOX_KINDS, primKind, primTriangles, type PrimKind } from './prims';
import type { Part, Prim, Slot, Vec3 } from './types';

export interface CompiledPart {
  /** For messages: the part's name, or its kind and path. */
  readonly label: string;
  readonly name?: string;
  readonly kind: PrimKind;
  readonly slot: Slot;
  readonly glow: boolean;
  readonly tex?: string;
  /** Own-frame triangles (9 numbers each). */
  readonly tris: readonly number[];
  /** Own frame → model space. */
  readonly matrix: Matrix4;
  /** Index into `pivots`, or −1 for the model's root. */
  readonly pivot: number;
  /** Size of the part's own box (box kinds) or of its own-frame bounds (profile kinds). */
  readonly extent: Vec3;
}

export interface CompiledPivot {
  readonly name: string;
  /** The pivot's frame in model space. */
  readonly matrix: Matrix4;
  readonly parent: number;
}

export interface Compiled {
  readonly parts: CompiledPart[];
  readonly pivots: CompiledPivot[];
  readonly problems: string[];
  /** Every named part or group: the parts it covers, `parts.slice(start, end)`. */
  readonly named: readonly { readonly name: string; readonly start: number; readonly end: number }[];
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly size: Vec3;
}

const DEG = Math.PI / 180;
const MIRROR = '.mirror';

interface Range {
  start: number;
  end: number;
  pivotStart: number;
  pivotEnd: number;
}

interface OnNode extends Range {
  readonly label: string;
  readonly target: string;
  readonly suffix: string;
  /** `at`, in model axes. */
  readonly offset: Vector3;
  done: boolean;
}

function frameOf(at: Vec3 | undefined, rot: Vec3 | undefined, scale?: number | Vec3): Matrix4 {
  const m = new Matrix4();
  if (at) m.makeTranslation(at[0], at[1], at[2]);
  if (rot && (rot[0] || rot[1] || rot[2])) m.multiply(new Matrix4().makeRotationFromEuler(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ')));
  if (scale !== undefined) {
    const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    m.multiply(new Matrix4().makeScale(s[0]!, s[1]!, s[2]!));
  }
  return m;
}

function ownBounds(tris: readonly number[]): Vec3 {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, tris[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, tris[i]!);
  }
  return tris.length ? [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!] : [0, 0, 0];
}

/** Model-space bounds of some compiled parts (empty: all zero). */
export function boundsOf(parts: readonly CompiledPart[]): Bounds {
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  for (const p of parts) {
    for (let i = 0; i < p.tris.length; i += 3) {
      v.set(p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!).applyMatrix4(p.matrix);
      lo.min(v);
      hi.max(v);
    }
  }
  if (lo.x > hi.x) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min: [lo.x, lo.y, lo.z], max: [hi.x, hi.y, hi.z], size: [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z] };
}

export function compileParts(parts: readonly Part[]): Compiled {
  const out: CompiledPart[] = [];
  const pivots: CompiledPivot[] = [];
  const problems: string[] = [];
  const names = new Map<string, Range[]>();
  const ons: OnNode[] = [];

  const walk = (list: readonly Part[], frame: Matrix4, pivot: number, path: string, suffix: string): void => {
    list.forEach((p, i) => {
      const at = `${path}[${i}]`;
      const start: Range = { start: out.length, end: 0, pivotStart: pivots.length, pivotEnd: 0 };
      const named = 'name' in p && p.name ? p.name + suffix : null;
      const onRef = 'on' in p && p.on ? p.on : null;
      // an `on` part is built at the origin of its frame, then moved onto its target
      const base = 'at' in p ? p.at : undefined;
      const local = onRef ? undefined : base;
      if ('mirror' in p) {
        walk(p.mirror, frame, pivot, `${at}.mirror`, suffix);
        const flip = p.axis === 'z' ? new Matrix4().makeScale(1, 1, -1) : new Matrix4().makeScale(-1, 1, 1);
        walk(p.mirror, frame.clone().multiply(flip), pivot, `${at}.mirror`, suffix + MIRROR);
      } else if ('group' in p) {
        const m = frame.clone().multiply(frameOf(local, p.rot, p.scale));
        let inner = pivot;
        if (p.pivot) {
          if (!named) problems.push(`${partLabel(p, at)} is a pivot without a name: give it one (the runtime finds it by name)`);
          else if (pivots.some((q) => q.name === named)) problems.push(`two pivots are named '${named}': pivot names must be unique`);
          pivots.push({ name: named ?? `pivot${pivots.length}`, matrix: m.clone(), parent: pivot });
          inner = pivots.length - 1;
        }
        walk(p.group, m, inner, `${at}.group`, suffix);
      } else if ('use' in p) {
        problems.push(`${partLabel(p, at)}: \`use\` must be expanded before compiling (expandModel)`);
      } else {
        const kind = primKind(p);
        if (!kind) return;
        const prim = p as Prim;
        const m = frame.clone().multiply(frameOf(local, prim.rot));
        let tris: Map<Slot, number[]>;
        try {
          tris = primTriangles(prim, prim.c ?? '');
        } catch (e) {
          problems.push(`${partLabel(p, at)}: ${(e as Error).message}`);
          return;
        }
        const label = partLabel(p, at) + (suffix ? ` (mirrored)` : '');
        const box = BOX_KINDS.has(kind) ? ((prim as unknown as Record<string, unknown>)[kind] as Vec3) : null;
        for (const [slot, t] of tris) {
          out.push({ label, ...(named ? { name: named } : {}), kind, slot, glow: prim.glow === true, ...(prim.tex ? { tex: prim.tex } : {}), tris: t, matrix: m, pivot, extent: box ?? ownBounds(t) });
        }
      }
      const range = { ...start, end: out.length, pivotEnd: pivots.length };
      if (named) {
        const list2 = names.get(named);
        if (list2) list2.push(range);
        else names.set(named, [range]);
      }
      if (onRef) {
        // the offset through the parent frame's rotation, scale and mirror (not its translation)
        const off = new Vector3(...(base ?? [0, 0, 0])).applyMatrix4(frame).sub(new Vector3().applyMatrix4(frame));
        ons.push({ ...range, label: partLabel(p, at), target: onRef, suffix, offset: off, done: false });
      }
    });
  };
  walk(parts, new Matrix4(), -1, 'parts', '');

  // ---- `on`: inner ones first, and whatever a target holds before measuring the target
  const lookup = (node: OnNode): Range | null => {
    // inside a mirrored copy, a name declared in the same copy means its mirrored twin
    for (let s = node.suffix; ; s = s.slice(0, s.lastIndexOf(MIRROR))) {
      const hits = names.get(node.target + s);
      if (hits) {
        if (hits.length > 1) {
          problems.push(`${node.label} sits on '${node.target}', but ${hits.length} parts have that name: make the names unique`);
          return null;
        }
        return hits[0]!;
      }
      if (!s) break;
    }
    problems.push(`${node.label} sits on '${node.target}', which no part is named: name that part or fix \`on\``);
    return null;
  };
  const inside = (r: Range, n: OnNode) => n.start >= r.start && n.end <= r.end && n.start < n.end;
  const visiting = new Set<OnNode>();
  const resolve = (node: OnNode): void => {
    if (node.done) return;
    if (visiting.has(node)) {
      problems.push(`${node.label} sits on '${node.target}' in a loop of \`on\` parts: break the loop`);
      node.done = true;
      return;
    }
    visiting.add(node);
    for (const n of ons) if (n !== node && inside(node, n)) resolve(n);
    const target = lookup(node);
    if (target && target.start === target.end) problems.push(`${node.label} sits on '${node.target}', which has no triangles: sit on a part with a top`);
    else if (target) {
      if (target.start <= node.start && target.end >= node.end) problems.push(`${node.label} sits on '${node.target}', which contains it: sit on a sibling instead`);
      else if (target.start >= node.start && target.end <= node.end) problems.push(`${node.label} sits on '${node.target}', one of its own parts: sit on a sibling instead`);
      else {
        for (const n of ons) if (n !== node && inside(target, n)) resolve(n);
        const tb = boundsOf(out.slice(target.start, target.end));
        const ob = boundsOf(out.slice(node.start, node.end));
        const d = new Vector3((tb.min[0] + tb.max[0]) / 2 - (ob.min[0] + ob.max[0]) / 2, tb.max[1] - ob.min[1], (tb.min[2] + tb.max[2]) / 2 - (ob.min[2] + ob.max[2]) / 2).add(node.offset);
        const t = new Matrix4().makeTranslation(d.x, d.y, d.z);
        const moved = new Set<Matrix4>();
        for (let k = node.start; k < node.end; k++) {
          const m = out[k]!.matrix;
          if (!moved.has(m)) m.premultiply(t);
          moved.add(m);
        }
        for (let k = node.pivotStart; k < node.pivotEnd; k++) pivots[k]!.matrix.premultiply(t);
      }
    }
    visiting.delete(node);
    node.done = true;
  };
  for (const n of ons) resolve(n);
  const named = [...names].flatMap(([name, rs]) => rs.map((r) => ({ name, start: r.start, end: r.end })));
  return { parts: out, pivots, problems, named };
}
