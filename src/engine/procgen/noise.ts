/**
 * Seeded gradient noise (simplex, Perlin's faster successor): smooth random hills that are the
 * same every time for the same seed and position. 2D and 3D, plus the fractal sums that make
 * terrain out of it: fBm (octaves of finer, fainter noise added up) and ridged noise (sharp
 * crests, mountain ridges).
 *
 *   const noise = createNoise(7);
 *   noise.n2(x, z);                                   // about -1..1
 *   noise.fbm2(x * 0.05, z * 0.05, { octaves: 5 });   // about -1..1, rough
 *   noise.ridged2(x * 0.05, z * 0.05);                // 0..1, ridges
 */
import { seeded } from '../physics/fracture';

export interface FbmOptions {
  /** How many layers of noise (default 5). Each adds detail at twice the frequency. */
  octaves?: number;
  /** Frequency step per octave (default 2). */
  lacunarity?: number;
  /** Amplitude step per octave, the roughness (default 0.5). */
  gain?: number;
}

export interface Noise {
  readonly seed: number;
  /** Simplex noise in 2D, about -1..1. */
  n2(x: number, y: number): number;
  /** Simplex noise in 3D, about -1..1 (a 2D field that changes over time: n3(x, y, t)). */
  n3(x: number, y: number, z: number): number;
  /** Fractal Brownian motion: octaves of 2D noise added up, normalised to about -1..1. */
  fbm2(x: number, y: number, o?: FbmOptions): number;
  /** Ridged noise: 1 − |noise| per octave, squared, so creases become sharp crests; 0..1. */
  ridged2(x: number, y: number, o?: FbmOptions): number;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;
/** The 12 edge midpoints of a cube: gradient directions (2D uses their x, y). */
const GRAD = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];

export function createNoise(seed = 1): Noise {
  // a permutation of 0..255 shuffled by the seed, doubled so lookups never wrap
  const rand = seeded(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  const perm = new Uint8Array(512);
  const grad = new Uint8Array(512); // perm % 12, the gradient index
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    grad[i] = perm[i]! % 12;
  }

  const n2 = (xin: number, yin: number): number => {
    // skew to the simplex grid, find the triangle, unskew
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    // each corner: a falloff (0.5 − r²)⁴ times the gradient's dot with the offset
    let c = 0.5 - x0 * x0 - y0 * y0;
    if (c > 0) {
      const g = grad[ii + perm[jj]!]! * 3;
      n += c * c * c * c * (GRAD[g]! * x0 + GRAD[g + 1]! * y0);
    }
    c = 0.5 - x1 * x1 - y1 * y1;
    if (c > 0) {
      const g = grad[ii + i1 + perm[jj + j1]!]! * 3;
      n += c * c * c * c * (GRAD[g]! * x1 + GRAD[g + 1]! * y1);
    }
    c = 0.5 - x2 * x2 - y2 * y2;
    if (c > 0) {
      const g = grad[ii + 1 + perm[jj + 1]!]! * 3;
      n += c * c * c * c * (GRAD[g]! * x2 + GRAD[g + 1]! * y2);
    }
    return 70 * n;
  };

  const n3 = (xin: number, yin: number, zin: number): number => {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    // which of the six tetrahedra
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    const corners = [
      [x0, y0, z0, 0, 0, 0],
      [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, i1, j1, k1],
      [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, i2, j2, k2],
      [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, 1, 1, 1],
    ] as const;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;
    for (const [x, y, z, di, dj, dk] of corners) {
      const c = 0.6 - x * x - y * y - z * z;
      if (c <= 0) continue;
      const g = grad[ii + di + perm[jj + dj + perm[kk + dk]!]!]! * 3;
      n += c * c * c * c * (GRAD[g]! * x + GRAD[g + 1]! * y + GRAD[g + 2]! * z);
    }
    return 32 * n;
  };

  const fbm2 = (x: number, y: number, o: FbmOptions = {}): number => {
    const octaves = o.octaves ?? 5;
    const lacunarity = o.lacunarity ?? 2;
    const gain = o.gain ?? 0.5;
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let k = 0; k < octaves; k++) {
      // each octave shifted, so their zero crossings don't line up at the origin
      sum += amp * n2(x * f + k * 17.31, y * f - k * 9.73);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  };

  const ridged2 = (x: number, y: number, o: FbmOptions = {}): number => {
    const octaves = o.octaves ?? 5;
    const lacunarity = o.lacunarity ?? 2;
    const gain = o.gain ?? 0.5;
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let k = 0; k < octaves; k++) {
      const r = 1 - Math.abs(n2(x * f + k * 17.31, y * f - k * 9.73));
      sum += amp * r * r;
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  };

  return { seed, n2, n3, fbm2, ridged2 };
}
