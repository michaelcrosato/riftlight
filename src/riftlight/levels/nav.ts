import type { Vector3 } from 'three/webgpu';
import { type Cell, FLOOR, findPath, type Layout, MinHeap, N8, WALL } from './layout/grid';

/**
 * Navigation on the level grid, for monsters and tools:
 *
 *  - `isWalkable(x, z)`: world position on walkable floor;
 *  - `raycastWalls(from, dir, max)`: distance to the first wall along a ground ray (line of
 *    sight, projectiles); voids don't block unless asked;
 *  - a **flow field** to one target (the hero): one Dijkstra out to `radius` metres, rebuilt
 *    only when the target changes cell or the grid changes (Collapse), so any number of
 *    monsters read `direction(x, z)` for free each frame;
 *  - `path(from, to)`: A*-style shortest path (8-connected, no corner cutting) for anything
 *    the flow field doesn't cover.
 */
export class LevelNav {
  readonly width: number;
  readonly height: number;
  /** Flow-field reach (metres of path). */
  radius = 42;
  private readonly dist: Float32Array;
  private readonly heap = new MinHeap();
  private target = -1;
  private builtFor = -1;
  private version = -1;
  /** Flow-field rebuilds (inspectors: should be ≤ one per hero cell change). */
  rebuilds = 0;

  constructor(readonly layout: Layout) {
    this.width = layout.width;
    this.height = layout.height;
    this.dist = new Float32Array(layout.width * layout.height).fill(Infinity);
  }

  walkableCell(x: number, z: number): boolean {
    return this.layout.cell(x, z) === FLOOR;
  }

  isWalkable(x: number, z: number): boolean {
    return this.walkableCell(Math.floor(x), Math.floor(z));
  }

  /**
   * Distance along the ground from `from` in direction (dx, dz) to the first wall cell (or void
   * cell with `voidBlocks`), up to `max`. Null when nothing is hit. Grid DDA: exact per cell.
   */
  raycastWalls(from: { x: number; z: number }, dir: { x: number; z: number }, max: number, voidBlocks = false): number | null {
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-9) return null;
    const dx = dir.x / len;
    const dz = dir.z / len;
    let cx = Math.floor(from.x);
    let cz = Math.floor(from.z);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - from.x : from.x - cx) * tDeltaX : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? cz + 1 - from.z : from.z - cz) * tDeltaZ : Infinity;
    let t = 0;
    while (t <= max) {
      const c = this.layout.cell(cx, cz);
      if (c === WALL || (voidBlocks && c !== FLOOR)) return t;
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
    }
    return null;
  }

  /** Clear line of sight between two ground points (no wall between them). */
  lineOfSight(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    return this.raycastWalls(a, { x: b.x - a.x, z: b.z - a.z }, d) === null;
  }

  /** Point the flow field at a world position (cheap if it stays in the same cell). */
  setTarget(p: { x: number; z: number }): void {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (!this.layout.inBounds(x, z)) return;
    this.target = z * this.width + x;
  }

  /** Rebuild the field if the target cell or the grid changed. Call once per frame. */
  update(): void {
    if (this.target < 0 || (this.target === this.builtFor && this.version === this.layout.version)) return;
    this.build();
  }

  /** Path distance (metres) from a world position to the target; Infinity if unreachable/out of reach. */
  distance(x: number, z: number): number {
    this.update();
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    return this.layout.inBounds(cx, cz) ? this.dist[cz * this.width + cx]! : Infinity;
  }

  /**
   * Unit ground direction to walk from (x, z) toward the target, written into `out`
   * (y = 0). Zero when already at the target or out of reach.
   */
  direction(x: number, z: number, out: Vector3): Vector3 {
    this.update();
    out.set(0, 0, 0);
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (!this.layout.inBounds(cx, cz)) return out;
    const W = this.width;
    const here = this.dist[cz * W + cx]!;
    if (here === Infinity || here === 0) {
      if (here === 0 && this.target >= 0) {
        const tx = (this.target % W) + 0.5;
        const tz = Math.floor(this.target / W) + 0.5;
        out.set(tx - x, 0, tz - z);
        if (out.lengthSq() > 1e-6) out.normalize();
      }
      return out;
    }
    let best = here;
    let bx = 0;
    let bz = 0;
    for (const [dx, dz] of N8) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!this.layout.inBounds(nx, nz)) continue;
      if (dx && dz && (!this.walkableCell(nx, cz) || !this.walkableCell(cx, nz))) continue;
      const d = this.dist[nz * W + nx]!;
      if (d < best) {
        best = d;
        bx = dx;
        bz = dz;
      }
    }
    if (bx === 0 && bz === 0) return out;
    // Aim at the next cell's centre (smooth enough at 1 m cells, never into walls).
    out.set(cx + bx + 0.5 - x, 0, cz + bz + 0.5 - z);
    const l = out.length();
    return l > 1e-6 ? out.divideScalar(l) : out;
  }

  /** Shortest walkable path between two world positions (cells), [] if none. */
  path(from: { x: number; z: number }, to: { x: number; z: number }): Cell[] {
    return findPath(this.width, this.height, { x: Math.floor(from.x), z: Math.floor(from.z) }, { x: Math.floor(to.x), z: Math.floor(to.z) }, (i) => this.layout.cells[i] === FLOOR);
  }

  private build(): void {
    const W = this.width;
    const dist = this.dist;
    dist.fill(Infinity);
    this.builtFor = this.target;
    this.version = this.layout.version;
    this.rebuilds++;
    if (this.layout.cells[this.target] !== FLOOR) return;
    const heap = this.heap;
    heap.clear();
    dist[this.target] = 0;
    heap.push(this.target, 0);
    while (heap.size) {
      const [i, d] = heap.pop();
      if (d > dist[i]! + 1e-6 || d > this.radius) continue;
      const x = i % W;
      const z = (i - x) / W;
      for (const [dx, dz, c] of N8) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.layout.inBounds(nx, nz)) continue;
        const j = nz * W + nx;
        if (this.layout.cells[j] !== FLOOR) continue;
        if (dx && dz && (this.layout.cells[z * W + nx] !== FLOOR || this.layout.cells[nz * W + x] !== FLOOR)) continue;
        const nd = d + c;
        if (nd < dist[j]!) {
          dist[j] = nd;
          heap.push(j, nd);
        }
      }
    }
  }
}
