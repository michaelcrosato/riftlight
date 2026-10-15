/**
 * Walking in Emberfall as data: a grid over the town (half-metre cells) of the points where an
 * actor of `agent` radius stands clear of every blocker and inside the walkable circle, the
 * same test `Town.collide` applies (minus the townsfolk, who move). Agents route on it
 * (`__RIFTLIGHT__.moveTo` in town), `Town.collide` sets an actor shut in where nobody can walk
 * from back on ground that can be walked to (`nearReachable`, `nearestReachable`), and the tests
 * flood it from the spawn to prove every interactable, every NPC path point and every district is
 * reachable and the water is not. Built on demand from the town's blockers (static once the town
 * and its extensions are built).
 */
import { type Blocker, overlapsBlocker } from './kit';

export interface TownNavOptions {
  /** Radius of the walkable circle around the plaza (m). */
  readonly radius: number;
  /** Radius of the actor (m); the hero's mover uses 0.35. */
  readonly agent?: number;
  /** Cell size (m). */
  readonly cell?: number;
}

export interface NavPoint {
  readonly x: number;
  readonly z: number;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

export class TownNav {
  readonly cell: number;
  /** Cells per side; cell (i, j) is centred on (origin + (i + 0.5) cell, origin + (j + 0.5) cell). */
  readonly size: number;
  readonly origin: number;
  readonly agent: number;
  private readonly open: Uint8Array;

  constructor(
    blockers: readonly Blocker[],
    readonly options: TownNavOptions,
  ) {
    this.cell = options.cell ?? 0.5;
    this.agent = options.agent ?? 0.35;
    const R = options.radius;
    this.size = Math.ceil((2 * R) / this.cell);
    this.origin = -(this.size * this.cell) / 2;
    this.open = new Uint8Array(this.size * this.size);
    // each blocker in the 2 m buckets it can reach an actor in, so a cell tests only its neighbours
    const B = 2;
    const buckets = new Map<number, Blocker[]>();
    const key = (i: number, j: number) => (i + 512) * 1024 + j + 512;
    for (const b of blockers) {
      const r = (b.kind === 'box' ? Math.hypot(b.hw, b.hd) : b.r) + this.agent;
      for (let i = Math.floor((b.x - r) / B); i <= Math.floor((b.x + r) / B); i++)
        for (let j = Math.floor((b.z - r) / B); j <= Math.floor((b.z + r) / B); j++) {
          const list = buckets.get(key(i, j));
          if (list) list.push(b);
          else buckets.set(key(i, j), [b]);
        }
    }
    for (let j = 0; j < this.size; j++)
      for (let i = 0; i < this.size; i++) {
        const x = this.origin + (i + 0.5) * this.cell;
        const z = this.origin + (j + 0.5) * this.cell;
        if (Math.hypot(x, z) > R - this.agent * 0.25) continue;
        const near = buckets.get(key(Math.floor(x / B), Math.floor(z / B)));
        if (!near?.some((b) => overlapsBlocker(x, z, this.agent, b))) this.open[j * this.size + i] = 1;
      }
  }

  private index(x: number, z: number): number {
    const i = Math.floor((x - this.origin) / this.cell);
    const j = Math.floor((z - this.origin) / this.cell);
    return i < 0 || j < 0 || i >= this.size || j >= this.size ? -1 : j * this.size + i;
  }

  private centre(k: number): NavPoint {
    return { x: this.origin + ((k % this.size) + 0.5) * this.cell, z: this.origin + (Math.floor(k / this.size) + 0.5) * this.cell };
  }

  /** The actor can stand at (x, z) (its cell is open). */
  walkable(x: number, z: number): boolean {
    const k = this.index(x, z);
    return k >= 0 && this.open[k] === 1;
  }

  /** The open cell nearest (x, z) within `max` m (an interactable's spot may sit by a blocker), or -1. */
  private nearestOpen(x: number, z: number, max = 1.5): number {
    const k = this.index(x, z);
    if (k >= 0 && this.open[k]) return k;
    const n = Math.ceil(max / this.cell);
    let best = -1;
    let bd = Infinity;
    const ci = Math.floor((x - this.origin) / this.cell);
    const cj = Math.floor((z - this.origin) / this.cell);
    for (let dj = -n; dj <= n; dj++)
      for (let di = -n; di <= n; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.size || j >= this.size || !this.open[j * this.size + i]) continue;
        const c = this.centre(j * this.size + i);
        const d = Math.hypot(c.x - x, c.z - z);
        if (d <= max && d < bd) {
          bd = d;
          best = j * this.size + i;
        }
      }
    return best;
  }

  /** Breadth-first from `from` (8-connected, no corner cutting): each cell's predecessor, -1 where not reached. */
  private flood(from: number): Int32Array {
    const n = this.size;
    const prev = new Int32Array(n * n).fill(-1);
    if (from < 0) return prev;
    prev[from] = from;
    const queue = [from];
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q]!;
      const i = k % n;
      const j = Math.floor(k / n);
      for (const [di, dj] of NEIGHBOURS) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const nk = b * n + a;
        if (!this.open[nk] || prev[nk] !== -1) continue;
        if (di && dj && (!this.open[j * n + a] || !this.open[b * n + i])) continue;
        prev[nk] = k;
        queue.push(nk);
      }
    }
    return prev;
  }

  /**
   * Which of `points` can be walked to from `from` (each may stand up to `slack` m from an open
   * cell: an interactable's spot is where the hero stops, beside what it uses).
   */
  reachable(from: NavPoint, points: readonly NavPoint[], slack = 1.5): boolean[] {
    const prev = this.flood(this.nearestOpen(from.x, from.z, slack));
    return points.map((p) => {
      const k = this.nearestOpen(p.x, p.z, slack);
      return k >= 0 && prev[k] !== -1;
    });
  }

  /** Cell centres from `from` to `to` (both ends near open cells), or [] when there is no way. */
  route(from: NavPoint, to: NavPoint, slack = 1.5): NavPoint[] {
    const start = this.nearestOpen(from.x, from.z, slack);
    const goal = this.nearestOpen(to.x, to.z, slack);
    if (start < 0 || goal < 0) return [];
    const prev = this.flood(start);
    if (prev[goal] === -1) return [];
    const out: NavPoint[] = [];
    for (let k = goal; ; k = prev[k]!) {
      out.push(this.centre(k));
      if (k === start) break;
    }
    return out.reverse();
  }

  private reached: { from: number; prev: Int32Array } | null = null;

  /** The flood from `from`'s cell, kept for the next call from the same cell. */
  private floodFrom(from: NavPoint): Int32Array {
    const start = this.nearestOpen(from.x, from.z, 1.5);
    if (this.reached?.from !== start) this.reached = { from: start, prev: this.flood(start) };
    return this.reached.prev;
  }

  /**
   * (x, z) is on ground that can be walked to from `from`: its cell or one beside it is (the grid
   * keeps half a cell or more off every blocker, so ground right by a wall counts too).
   */
  nearReachable(from: NavPoint, x: number, z: number): boolean {
    const prev = this.floodFrom(from);
    const ci = Math.floor((x - this.origin) / this.cell);
    const cj = Math.floor((z - this.origin) / this.cell);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i >= 0 && j >= 0 && i < this.size && j < this.size && prev[j * this.size + i] !== -1) return true;
      }
    return false;
  }

  /** The centre of the cell nearest (x, z), within `max` m, that can be walked to from `from`, or null. */
  nearestReachable(from: NavPoint, x: number, z: number, max = 3): NavPoint | null {
    const prev = this.floodFrom(from);
    const n = Math.ceil(max / this.cell);
    const ci = Math.floor((x - this.origin) / this.cell);
    const cj = Math.floor((z - this.origin) / this.cell);
    let best: NavPoint | null = null;
    let bd = max;
    for (let dj = -n; dj <= n; dj++)
      for (let di = -n; di <= n; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.size || j >= this.size || prev[j * this.size + i] === -1) continue;
        const c = this.centre(j * this.size + i);
        const d = Math.hypot(c.x - x, c.z - z);
        if (d <= bd) {
          bd = d;
          best = c;
        }
      }
    return best;
  }

  /** Open cells (for maps and tests). */
  openCells(): number {
    let n = 0;
    for (const v of this.open) n += v;
    return n;
  }
}
