/**
 * Breaking a box into pieces: cut planes along each axis at jittered positions, so the
 * chunks tile the box exactly (nothing missing, nothing overlapping) but look hand-broken,
 * not like a grid. Pure and seeded (the same box breaks the same way every time).
 *
 *   const chunks = fractureBox([2, 3, 0.4], { cuts: [3, 4, 1], jitter: 0.35, seed: 7 });
 *   // [{ center: [x, y, z], size: [w, h, d] }, ...] in the box's own space
 */

export interface Chunk {
  /** Centre in the box's local space (the box is centred on the origin). */
  readonly center: [number, number, number];
  readonly size: [number, number, number];
}

export interface FractureOptions {
  /** Pieces along x, y and z (default [3, 3, 1]). */
  cuts?: readonly [number, number, number];
  /** How far a cut may wander from even spacing, as a share of a piece (0..0.45). Default 0.3. */
  jitter?: number;
  seed?: number;
}

/** A small seeded random number generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cut positions from −half to +half into `n` jittered pieces. */
function cutsAlong(length: number, n: number, jitter: number, rand: () => number): number[] {
  const out = [-length / 2];
  const piece = length / n;
  for (let i = 1; i < n; i++) out.push(-length / 2 + i * piece + (rand() * 2 - 1) * jitter * piece);
  out.push(length / 2);
  return out;
}

export function fractureBox(size: readonly [number, number, number], o: FractureOptions = {}): Chunk[] {
  const [nx, ny, nz] = (o.cuts ?? [3, 3, 1]).map((n) => Math.max(1, Math.round(n))) as [number, number, number];
  const jitter = Math.min(0.45, Math.max(0, o.jitter ?? 0.3));
  const rand = seeded(o.seed ?? 1);
  const xs = cutsAlong(size[0], nx, jitter, rand);
  const zs = cutsAlong(size[2], nz, jitter, rand);
  const out: Chunk[] = [];
  // each column (x, z) gets its own horizontal cuts: bricks, not a grid
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++) {
      const ys = cutsAlong(size[1], ny, jitter, rand);
      for (let j = 0; j < ny; j++) {
        const x0 = xs[i]!;
        const x1 = xs[i + 1]!;
        const y0 = ys[j]!;
        const y1 = ys[j + 1]!;
        const z0 = zs[k]!;
        const z1 = zs[k + 1]!;
        out.push({ center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0] });
      }
    }
  return out;
}
