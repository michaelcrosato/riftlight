/**
 * Texture patterns: seeded generators that fill a `w × h` field with values on the layer's ramp
 * of slots (0 = the first slot, 1 = the last) or `NaN` where they leave the texel alone. When the
 * texture tiles, every pattern but `gradient` is periodic over its size by construction: value
 * noise on a wrapping lattice, Voronoi distances and scattered shapes that wrap, and layouts
 * (bricks, tiles, planks, stripes, checker) that fit a whole number of cells, spreading any
 * remainder over them a texel at a time, so no sliver of a cell lands on the wrap.
 */
export interface PatternParams {
  readonly [k: string]: number | string;
}

export interface FieldInput {
  readonly w: number;
  readonly h: number;
  readonly tile: boolean;
  /** Ramp length (slots in `colors`). */
  readonly n: number;
  readonly seed: number;
  readonly p: PatternParams;
}

/**
 * A numeric param `[default, min, max]` (with `'whole'` when it counts texels or things), or a
 * list of choices (the first is the default).
 */
export type ParamSpec = readonly [number, number, number] | readonly [number, number, number, 'whole'] | readonly string[];

export interface PatternSpec {
  readonly about: string;
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** Whether it wraps without a seam when the texture tiles (all but `gradient`). */
  readonly periodic: boolean;
  readonly field: (f: FieldInput) => Float32Array;
}

/** A hash of integers to [0, 1): the same inputs give the same value, on every platform. */
export function hash01(seed: number, a: number, b = 0, c = 0): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f) ^ Math.imul(b + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b) ^ Math.imul(c + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;
const num = (p: PatternParams, k: string) => p[k] as number;
const str = (p: PatternParams, k: string) => p[k] as string;
/** Ramp position of discrete step `i` of `n`. */
const step = (i: number, n: number) => (n > 1 ? Math.min(i, n - 1) / (n - 1) : 0);
/** A random step from 1 to n − 1 (the first slot is joints and gaps). */
const face = (r: number, n: number) => step(n > 1 ? 1 + Math.floor(r * (n - 1)) : 0, n);

interface Cells {
  /** Cells across the size (when tiling; else as many as start inside it). */
  readonly count: number;
  /** The cell a coordinate falls in (tiling: a coordinate inside the size). */
  readonly index: (t: number) => number;
  /** Where cell `i` starts. */
  readonly start: (i: number) => number;
}

/**
 * Cells of `cell` texels along `size`. Tiling: a whole number of them (an even number when
 * `even`, for courses that alternate), each `size / count` texels give or take one, so the last
 * ends exactly on the wrap. Otherwise every `cell` texels from 0.
 */
function cellsOf(size: number, cell: number, tile: boolean, even = false): Cells {
  if (!tile) return { count: Math.ceil(size / cell), index: (t) => Math.floor(t / cell), start: (i) => i * cell };
  const count = even ? 2 * Math.max(1, Math.round(size / (2 * cell))) : Math.max(1, Math.round(size / cell));
  const start = (i: number) => Math.floor((i * size) / count);
  const index = new Int32Array(size);
  for (let i = 0; i < count; i++) for (let t = start(i); t < start(i + 1); t++) index[t] = i;
  return { count, index: (t) => index[mod(t, size)]!, start };
}

/** Periodic value noise in fractal octaves, stretched to 0..1. */
function noiseField({ w, h, tile, seed, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h);
  const scale = num(p, 'scale');
  const octaves = num(p, 'octaves');
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let o = 0; o < octaves; o++) {
    const cx = Math.max(1, Math.round(scale * 2 ** o));
    const cy = Math.max(1, Math.round((scale * 2 ** o * h) / w));
    const amp = 0.5 ** o;
    const lattice = (ix: number, iy: number) => hash01(seed + o * 101, tile ? mod(ix, cx) : ix, tile ? mod(iy, cy) : iy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cx;
        const fy = (y / h) * cy;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = smooth(fx - ix);
        const ty = smooth(fy - iy);
        const top = lattice(ix, iy) + (lattice(ix + 1, iy) - lattice(ix, iy)) * tx;
        const bottom = lattice(ix, iy + 1) + (lattice(ix + 1, iy + 1) - lattice(ix, iy + 1)) * tx;
        out[y * w + x] = out[y * w + x]! + amp * (top + (bottom - top) * ty);
      }
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let k = 0; k < out.length; k++) out[k] = hi > lo ? (out[k]! - lo) / (hi - lo) : 0.5;
  return out;
}

/** Courses of bricks (or square tiles when `offset` is 0): joints on the first slot. */
function bricksField({ w, h, tile, n, seed, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h);
  const joint = num(p, 'mortar');
  const offset = num(p, 'offset');
  const bevel = num(p, 'bevel');
  const cols = cellsOf(w, num(p, 'w'), tile);
  // courses that shift alternate, so a tiling texture holds an even number of them
  const rows = cellsOf(h, num(p, 'h'), tile, offset > 0);
  const shift = Math.round(offset * (tile ? w / cols.count : num(p, 'w')));
  for (let y = 0; y < h; y++) {
    const row = rows.index(y);
    const ly = y - rows.start(row);
    const rowH = rows.start(row + 1) - rows.start(row);
    for (let x = 0; x < w; x++) {
      const xo = tile ? mod(x + (row % 2) * shift, w) : x + (row % 2) * shift;
      const col = cols.index(xo);
      const lx = xo - cols.start(col);
      if (lx < joint || ly < joint) {
        out[y * w + x] = 0;
        continue;
      }
      let i = n > 1 ? 1 + Math.floor(hash01(seed, row, col) * (n - 1)) : 0;
      if (bevel && n > 2) i = ly === joint ? Math.min(n - 1, i + 1) : ly === rowH - 1 ? Math.max(1, i - 1) : i;
      out[y * w + x] = step(i, n);
    }
  }
  return out;
}

/** Boards along x, `w` texels wide, with gaps and staggered butt joints; a grain of darker texels. */
function planksField({ w, h, tile, n, seed, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h);
  const gap = num(p, 'gap');
  const grain = num(p, 'grain');
  const rows = cellsOf(h, num(p, 'w'), tile);
  const segs = cellsOf(w, num(p, 'length'), tile);
  const length = tile ? w / segs.count : num(p, 'length');
  for (let y = 0; y < h; y++) {
    const row = rows.index(y);
    const ly = y - rows.start(row);
    const shift = Math.floor(hash01(seed, row, 7) * length);
    for (let x = 0; x < w; x++) {
      const xo = tile ? mod(x + shift, w) : x + shift;
      const seg = segs.index(xo);
      if (ly < gap || xo === segs.start(seg)) {
        out[y * w + x] = 0;
        continue;
      }
      let i = n > 1 ? 1 + Math.floor(hash01(seed, row, seg, 3) * (n - 1)) : 0;
      if (grain && n > 2 && hash01(seed, x >> 2, y, 11) < grain * 0.35) i = Math.max(1, i - 1);
      out[y * w + x] = step(i, n);
    }
  }
  return out;
}

/** Voronoi stones (`cells` across), joints between them on the first slot; distances wrap when tiling. */
function cobblesField({ w, h, tile, n, seed, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h);
  const cx = Math.max(1, Math.round(num(p, 'cells')));
  const cy = Math.max(1, Math.round((num(p, 'cells') * h) / w));
  const gap = num(p, 'gap');
  const pts: [number, number][] = [];
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) pts.push([((i + 0.2 + 0.6 * hash01(seed, i, j, 1)) * w) / cx, ((j + 0.2 + 0.6 * hash01(seed, i, j, 2)) * h) / cy]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let best = 0;
      pts.forEach(([px, py], k) => {
        let dx = Math.abs(x + 0.5 - px);
        let dy = Math.abs(y + 0.5 - py);
        if (tile) {
          dx = Math.min(dx, w - dx);
          dy = Math.min(dy, h - dy);
        }
        const d = Math.hypot(dx, dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = k;
        } else if (d < d2) d2 = d;
      });
      out[y * w + x] = d2 - d1 < gap ? 0 : face(hash01(seed, best, 5), n);
    }
  }
  return out;
}

/** Bands `width` texels wide cycling through the ramp; tiling, a whole number of cycles across. */
function stripesField({ w, h, tile, n, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h);
  const width = num(p, 'width');
  const dir = str(p, 'dir');
  // bands across each axis: tiling, a whole number of full cycles (n bands each, a texel or more wide)
  const across = (size: number) => (tile ? n * Math.max(1, Math.min(Math.floor(size / n), Math.round(size / (width * n)))) : size / width);
  const bx = dir === 'y' ? 0 : across(w);
  const by = dir === 'x' ? 0 : across(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = step(mod(Math.floor((x * bx) / w + 1e-9) + Math.floor((y * by) / h + 1e-9), n), n);
  return out;
}

/** A checker of the ramp's first and last slots; tiling, an even number of cells each way. */
function checkerField({ w, h, tile, n, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h);
  const cx = cellsOf(w, num(p, 'cell'), tile, true);
  const cy = cellsOf(h, num(p, 'cell'), tile, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = step((cx.index(x) + cy.index(y)) % 2 ? n - 1 : 0, n);
  return out;
}

/** Pebbles, grass blades or stars dropped at random: only their texels are painted. */
function scatterField({ w, h, tile, n, seed, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h).fill(Number.NaN);
  const count = Math.round(num(p, 'count'));
  const size = Math.round(num(p, 'size'));
  const shape = str(p, 'shape');
  const put = (x: number, y: number, v: number) => {
    if (tile) {
      x = mod(x, w);
      y = mod(y, h);
    }
    if (x >= 0 && y >= 0 && x < w && y < h) out[y * w + x] = v;
  };
  for (let i = 0; i < count; i++) {
    const x = Math.floor(hash01(seed, i, 1) * w);
    const y = Math.floor(hash01(seed, i, 2) * h);
    const v = step(Math.floor(hash01(seed, i, 3) * n), n);
    if (shape === 'blade') for (let k = 0; k <= size; k++) put(x, y - k, v);
    else if (shape === 'star') for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) put(x + dx * size, y + dy * size, v);
    else for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(x + dx, y + dy, v);
  }
  return out;
}

/** Random-walk cracks on the first slot: only their texels are painted. */
function cracksField({ w, h, tile, seed, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h).fill(Number.NaN);
  const count = Math.round(num(p, 'count'));
  const length = Math.round(num(p, 'length'));
  for (let i = 0; i < count; i++) {
    let x = Math.floor(hash01(seed, i, 1) * w);
    let y = Math.floor(hash01(seed, i, 2) * h);
    const dx = hash01(seed, i, 3) < 0.5 ? 1 : -1;
    for (let k = 0; k < length; k++) {
      if (tile) {
        x = mod(x, w);
        y = mod(y, h);
      }
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      out[y * w + x] = 0;
      if (hash01(seed, i, k, 4) < 0.55) x += dx;
      else y += hash01(seed, i, k, 5) < 0.5 ? 1 : -1;
    }
  }
  return out;
}

/** Light to dark down (`y`), left to right (`x`), or from the centre out (`radial`). Never periodic. */
function gradientField({ w, h, p }: FieldInput): Float32Array {
  const out = new Float32Array(w * h);
  const dir = str(p, 'dir');
  const r = Math.hypot(w / 2, h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = dir === 'x' ? 1 - x / Math.max(1, w - 1) : dir === 'radial' ? 1 - Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / r : 1 - y / Math.max(1, h - 1);
    }
  }
  return out;
}

export const PATTERNS: Readonly<Record<string, PatternSpec>> = {
  noise: { about: 'value noise in octaves, stretched over the ramp (dirt, stone, foliage)', params: { scale: [4, 1, 32], octaves: [3, 1, 5, 'whole'] }, periodic: true, field: noiseField },
  bricks: { about: 'brick courses; joints on the first slot, bricks drawn from the rest', params: { w: [8, 2, 64, 'whole'], h: [4, 2, 64, 'whole'], mortar: [1, 0, 4, 'whole'], offset: [0.5, 0, 1], bevel: [1, 0, 1, 'whole'] }, periodic: true, field: bricksField },
  tiles: { about: 'square tiles; joints on the first slot', params: { w: [8, 2, 64, 'whole'], h: [8, 2, 64, 'whole'], mortar: [1, 0, 4, 'whole'], offset: [0, 0, 1], bevel: [1, 0, 1, 'whole'] }, periodic: true, field: bricksField },
  planks: { about: 'boards along x with gaps and butt joints on the first slot, a darker grain', params: { w: [4, 2, 32, 'whole'], gap: [1, 0, 3, 'whole'], length: [16, 4, 128, 'whole'], grain: [0.3, 0, 1] }, periodic: true, field: planksField },
  cobbles: { about: 'Voronoi stones, joints on the first slot', params: { cells: [4, 1, 16, 'whole'], gap: [1, 0, 3] }, periodic: true, field: cobblesField },
  stripes: { about: 'bands cycling through the slots', params: { width: [2, 1, 64, 'whole'], dir: ['y', 'x', 'diag'] }, periodic: true, field: stripesField },
  checker: { about: 'a two-slot checker (first and last slot)', params: { cell: [1, 1, 64, 'whole'] }, periodic: true, field: checkerField },
  scatter: { about: 'dots, blades or stars dropped at random in the ramp\'s slots (an overlay)', params: { count: [12, 1, 256, 'whole'], size: [1, 1, 4, 'whole'], shape: ['dot', 'blade', 'star'] }, periodic: true, field: scatterField },
  cracks: { about: 'random-walk cracks in the first slot (an overlay)', params: { count: [3, 1, 32, 'whole'], length: [8, 2, 64, 'whole'] }, periodic: true, field: cracksField },
  gradient: { about: 'light to dark down the texture, across it, or from the centre (never tiles)', params: { dir: ['y', 'x', 'radial'] }, periodic: false, field: gradientField },
};
