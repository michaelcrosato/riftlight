/**
 * Helpers for writing models. Each one only returns parts (plain data), so a def stays data
 * and `expandModel` can print it. Domain helpers are rare on purpose: `boxFrame` sets the bar.
 */
import { Rng } from '../random';
import type { GroupPart, ModelDef, Part, Slot, Vec3 } from './types';

/** Returns the def as written, typed, so tuples and literals don't widen. */
export function model<const T extends ModelDef>(def: T): T {
  return def;
}

type Each<A extends unknown[]> = Part | ((...args: A) => Part);
const make = <A extends unknown[]>(p: Each<A>, ...args: A): Part => (typeof p === 'function' ? p(...args) : p);

/**
 * `n` copies turned about Y, `360 / n` degrees apart from `phase`. `r` first pushes each copy
 * out along its own +Z; with the default 0 the part's own `at` places it.
 */
export function around(n: number, part: Each<[i: number]>, o: { r?: number; phase?: number } = {}): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const p = make(part, i);
    const rot: Vec3 = [0, (o.phase ?? 0) + (360 * i) / n, 0];
    out.push({ rot, group: [o.r ? { at: [0, 0, o.r], group: [p] } : p] });
  }
  return out;
}

/** `n` copies, copy `i` offset by `i × step`. */
export function rowOf(n: number, step: Vec3, part: Each<[i: number]>): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) out.push({ at: [step[0] * i, step[1] * i, step[2] * i], group: [make(part, i)] });
  return out;
}

/** `nx × nz` copies on the floor plane, copy (ix, iz) offset by `(ix × sx, 0, iz × sz)`. */
export function gridOf(nx: number, nz: number, step: number | readonly [number, number], part: Each<[ix: number, iz: number]>): Part[] {
  const [sx, sz] = typeof step === 'number' ? [step, step] : step;
  const out: Part[] = [];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) out.push({ at: [ix * sx, 0, iz * sz], group: [make(part, ix, iz)] });
  return out;
}

/**
 * `n` copies scattered over a `w × d` area centred on the origin, from their own `seed` (so the
 * result does not depend on the build's seed); `part(i, rng)` may draw from the same stream.
 */
export function scatterOf(n: number, [w, d]: readonly [number, number], seed: number, part: Each<[i: number, rng: Rng]>): Part[] {
  const rng = new Rng(`scatter:${seed}`);
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const at: Vec3 = [rng.range(-w / 2, w / 2), 0, rng.range(-d / 2, d / 2)];
    out.push({ at, group: [make(part, i, rng)] });
  }
  return out;
}

/**
 * The 12 beams along the edges of a box of outer size `size` centred on `at`: crates, cages,
 * windows.
 */
export function boxFrame(o: { size: Vec3; beam: number; at?: Vec3; c?: Slot; name?: string }): GroupPart {
  const [w, h, d] = o.size;
  const b = o.beam;
  const x = w / 2 - b / 2;
  const y = h / 2 - b / 2;
  const z = d / 2 - b / 2;
  const beams: Part[] = [];
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) beams.push({ box: [w, b, b], at: [0, sy * y, sz * z] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) beams.push({ box: [b, h - 2 * b, b], at: [sx * x, 0, sz * z] });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) beams.push({ box: [b, b, d - 2 * b], at: [sx * x, sy * y, 0] });
  // the group's slot is the beams' slot
  return { ...(o.at ? { at: o.at } : {}), ...(o.name ? { name: o.name } : {}), ...(o.c ? { c: o.c } : {}), group: beams };
}
