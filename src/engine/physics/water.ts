/**
 * Water you can disturb: the height of a water surface at any point and time, as the sum of
 * a few travelling waves (analytic, the same function the water shader uses, so floating
 * things bob exactly with the drawn surface) plus a ripple field: a 2D wave equation on a
 * grid that anything crossing the surface dents (a wading hero, a crate splashing in, rain).
 * Pure; `render/water.ts` draws it, `Buoyancy` floats bodies on it. Unit-tested.
 *
 *   const ripples = new RippleField({ size: [12, 8], cells: [96, 64], center: [0, 0] });
 *   ripples.splash(x, z, 0.3, 0.6);       // radius, strength (m)
 *   ripples.step(dt);                      // per fixed step
 *   const h = waterHeight(WAVES_CALM, x, z, t) + ripples.heightAt(x, z);
 */

/** One travelling wave: direction (unit x, z), wavelength (m), amplitude (m), speed (m/s). */
export interface Wave {
  readonly dir: readonly [number, number];
  readonly length: number;
  readonly amplitude: number;
  readonly speed: number;
}

/** A pond on a still day. */
export const WAVES_CALM: readonly Wave[] = [
  { dir: [0.8, 0.6], length: 6, amplitude: 0.035, speed: 0.9 },
  { dir: [-0.3, 0.95], length: 3.3, amplitude: 0.02, speed: 0.7 },
  { dir: [0.95, -0.3], length: 1.9, amplitude: 0.01, speed: 0.6 },
];

/** A choppy lake. */
export const WAVES_CHOPPY: readonly Wave[] = [
  { dir: [0.8, 0.6], length: 7, amplitude: 0.16, speed: 2.1 },
  { dir: [-0.4, 0.92], length: 4.1, amplitude: 0.09, speed: 1.6 },
  { dir: [0.97, -0.24], length: 2.3, amplitude: 0.05, speed: 1.2 },
];

/** Height of the waves above the water's rest level at (x, z), time t. */
export function waterHeight(waves: readonly Wave[], x: number, z: number, t: number): number {
  let h = 0;
  for (const w of waves) {
    const k = (2 * Math.PI) / w.length;
    h += w.amplitude * Math.sin(k * (w.dir[0] * x + w.dir[1] * z - w.speed * t));
  }
  return h;
}

export interface RippleOptions {
  /** Width and depth of the water (m). */
  size: readonly [number, number];
  /** Grid cells across and down (more: finer ripples, more cost). */
  cells: readonly [number, number];
  /** World x, z of the water's middle. */
  center?: readonly [number, number];
  /** Wave speed (m/s). Default 2.2. */
  speed?: number;
  /** Energy kept per second (0..1). Default 0.35. */
  damping?: number;
}

/**
 * The 2D wave equation on a grid (two height buffers, leapfrog): each cell is pulled toward
 * the average of its neighbours, so a dent spreads out as rings, bounces off the edges and
 * dies away. Stable for speed × dt / cell < 0.7; `step` substeps when it has to.
 */
export class RippleField {
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly depth: number;
  readonly cx: number;
  readonly cz: number;
  speed: number;
  damping: number;
  /** Heights now and one step ago. */
  h: Float32Array;
  private prev: Float32Array;
  private next: Float32Array;

  constructor(o: RippleOptions) {
    this.cols = o.cells[0];
    this.rows = o.cells[1];
    this.width = o.size[0];
    this.depth = o.size[1];
    this.cx = o.center?.[0] ?? 0;
    this.cz = o.center?.[1] ?? 0;
    this.speed = o.speed ?? 2.2;
    this.damping = o.damping ?? 0.35;
    const n = this.cols * this.rows;
    this.h = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
  }

  get cell(): number {
    return Math.min(this.width / this.cols, this.depth / this.rows);
  }

  /** Grid coordinates (fractional) of a world point; null outside. */
  private toGrid(x: number, z: number): [number, number] | null {
    const u = ((x - this.cx) / this.width + 0.5) * this.cols - 0.5;
    const v = ((z - this.cz) / this.depth + 0.5) * this.rows - 0.5;
    if (u < -0.5 || v < -0.5 || u > this.cols - 0.5 || v > this.rows - 0.5) return null;
    return [u, v];
  }

  /** Is (x, z) over this water? */
  contains(x: number, z: number): boolean {
    return this.toGrid(x, z) !== null;
  }

  /** Ripple height at a world point (bilinear between cells; 0 outside). */
  heightAt(x: number, z: number): number {
    const g = this.toGrid(x, z);
    if (!g) return 0;
    const u = Math.min(this.cols - 1, Math.max(0, g[0]));
    const v = Math.min(this.rows - 1, Math.max(0, g[1]));
    const c0 = Math.floor(u);
    const r0 = Math.floor(v);
    const c1 = Math.min(this.cols - 1, c0 + 1);
    const r1 = Math.min(this.rows - 1, r0 + 1);
    const fu = u - c0;
    const fv = v - r0;
    const h = this.h;
    const W = this.cols;
    return (h[r0 * W + c0]! * (1 - fu) + h[r0 * W + c1]! * fu) * (1 - fv) + (h[r1 * W + c0]! * (1 - fu) + h[r1 * W + c1]! * fu) * fv;
  }

  /** Push the surface down (strength > 0) in a disc: a splash, a footstep, a raindrop. */
  splash(x: number, z: number, radius: number, strength: number): void {
    const g = this.toGrid(x, z);
    if (!g) return;
    const rc = (radius / this.width) * this.cols;
    const rr = (radius / this.depth) * this.rows;
    const c0 = Math.max(0, Math.floor(g[0] - rc));
    const c1 = Math.min(this.cols - 1, Math.ceil(g[0] + rc));
    const r0 = Math.max(0, Math.floor(g[1] - rr));
    const r1 = Math.min(this.rows - 1, Math.ceil(g[1] + rr));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot((c - g[0]) / Math.max(rc, 1e-6), (r - g[1]) / Math.max(rr, 1e-6));
        if (d > 1) continue;
        const k = 0.5 + 0.5 * Math.cos(d * Math.PI); // smooth dent
        this.h[r * this.cols + c] = this.h[r * this.cols + c]! - strength * k;
      }
  }

  /** Total |height| (tests: ripples spread and die away). */
  energy(): number {
    let e = 0;
    for (let i = 0; i < this.h.length; i++) e += Math.abs(this.h[i]!);
    return e;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    const cell = this.cell;
    const sub = Math.max(1, Math.ceil((this.speed * dt) / (cell * 0.6)));
    const h = dt / sub;
    const c2 = (this.speed * h) / cell;
    const k = c2 * c2;
    const keep = Math.pow(this.damping, h);
    const W = this.cols;
    const H = this.rows;
    for (let s = 0; s < sub; s++) {
      const cur = this.h;
      const old = this.prev;
      const nxt = this.next;
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const i = r * W + c;
          // reflecting edges: a missing neighbour is the cell itself
          const l = c > 0 ? cur[i - 1]! : cur[i]!;
          const rt = c < W - 1 ? cur[i + 1]! : cur[i]!;
          const u = r > 0 ? cur[i - W]! : cur[i]!;
          const d = r < H - 1 ? cur[i + W]! : cur[i]!;
          const lap = l + rt + u + d - 4 * cur[i]!;
          nxt[i] = (2 * cur[i]! - old[i]! + k * lap) * keep;
        }
      // rotate buffers: prev ← cur, cur ← next
      this.prev = cur;
      this.h = nxt;
      this.next = old;
    }
  }
}
