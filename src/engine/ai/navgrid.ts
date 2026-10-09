/**
 * Navigation on a grid: which cells can be walked, the shortest path between two points
 * (A*, 8-connected, no corner cutting, smoothed by line of sight), a flow field toward one
 * target (one Dijkstra fill, then any number of agents read a direction per cell for free),
 * and line-of-sight tests (vision cones, stealth). Pure and allocation-light; unit-tested.
 *
 *   const nav = NavGrid.fromRows(['#########', '#...#...#', '#.#...#.#', '#########'], { cell: 1, origin: [-4.5, 0, -2] });
 *   const path = nav.path([-3, 0, -1], [3, 0, -1]);       // world points, corners only
 *   nav.flowTo(hero.x, hero.z);                            // once when the target changes cell
 *   nav.flowDirection(x, z, out);                          // per agent per step
 *   nav.lineOfSight(ax, az, bx, bz);                       // walls block, open cells don't
 */

export interface NavGridOptions {
  /** Metres per cell. Default 1. */
  cell?: number;
  /** World x, z of the top-left cell's corner (column 0, row 0). Default: centred on the origin. */
  origin?: readonly [number, number, number];
}

/** A binary min-heap of cell ids keyed by cost. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  /** The smallest key (what `pop` returns next). */
  topKey(): number {
    return this.keys[0]!;
  }
  clear(): void {
    this.ids.length = 0;
    this.keys.length = 0;
  }
  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      ids[i] = ids[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastKey) break;
        ids[i] = ids[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  /** World x, z of cell (0, 0)'s corner. */
  readonly ox: number;
  readonly oz: number;
  /** 1 = walkable. */
  readonly open: Uint8Array;
  /** Bumped by `setOpen`: flow fields rebuild. */
  version = 0;
  // float64 on purpose: float32 rounding makes equal paths look shorter and re-expands cells
  private readonly g: Float64Array;
  private readonly from: Int32Array;
  private readonly flow: Float64Array;
  private readonly heap = new Heap();
  private flowTarget = -1;
  private flowVersion = -1;
  /** How many times a flow field was built (tools: should be one per target cell change). */
  flowBuilds = 0;

  constructor(width: number, height: number, o: NavGridOptions = {}) {
    this.width = width;
    this.height = height;
    this.cell = o.cell ?? 1;
    this.ox = o.origin?.[0] ?? (-width * this.cell) / 2;
    this.oz = o.origin?.[2] ?? (-height * this.cell) / 2;
    this.open = new Uint8Array(width * height).fill(1);
    this.g = new Float64Array(width * height);
    this.from = new Int32Array(width * height);
    this.flow = new Float64Array(width * height).fill(Infinity);
  }

  /**
   * From an ASCII map: `blocked` characters are closed, everything else open. Default '# ': walls
   * and pits (a ' ' has no floor in RoomKit's maps); past the end of a short row is a wall.
   */
  static fromRows(rows: readonly string[], o: NavGridOptions & { blocked?: string } = {}): NavGrid {
    const w = Math.max(...rows.map((r) => r.length));
    const nav = new NavGrid(w, rows.length, o);
    const blocked = o.blocked ?? '# ';
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < w; c++) nav.open[r * w + c] = blocked.includes(rows[r]![c] ?? '#') ? 0 : 1;
    return nav;
  }

  // ------------------------------------------------------------------ cells

  col(x: number): number {
    return Math.floor((x - this.ox) / this.cell);
  }

  row(z: number): number {
    return Math.floor((z - this.oz) / this.cell);
  }

  /** World x, z of a cell's centre. */
  centerX(col: number): number {
    return this.ox + (col + 0.5) * this.cell;
  }

  centerZ(row: number): number {
    return this.oz + (row + 0.5) * this.cell;
  }

  isOpen(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.width && row < this.height && this.open[row * this.width + col] === 1;
  }

  /** Is the world point on a walkable cell? */
  walkable(x: number, z: number): boolean {
    return this.isOpen(this.col(x), this.row(z));
  }

  setOpen(col: number, row: number, open: boolean): void {
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return;
    this.open[row * this.width + col] = open ? 1 : 0;
    this.version++;
  }

  // ------------------------------------------------------------------ paths

  /**
   * Shortest path between two world points (x, z used; y kept from `from`): A* over cells,
   * no corner cutting, then smoothed so it only turns where a wall is in the way. Null when
   * there is no way. The first point is `from`, the last `to` (snapped into its cell).
   */
  path(from: readonly [number, number, number], to: readonly [number, number, number]): [number, number, number][] | null {
    const start = this.openNear(this.col(from[0]), this.row(from[2]))[0];
    if (start === undefined) return null;
    // a target in a wall: the open cells nearest it, the first one that can be reached
    for (const goal of this.openNear(this.col(to[0]), this.row(to[2]))) {
      const cells = this.search(start, goal);
      if (!cells) continue;
      const W = this.width;
      const y = from[1];
      if (cells.length === 1) return [[from[0], y, from[2]], [to[0], y, to[2]]]; // the same cell: straight there
      const pts: [number, number, number][] = cells.map((c) => [this.centerX(c % W), y, this.centerZ(Math.floor(c / W))]);
      pts[0] = [from[0], y, from[2]];
      pts[pts.length - 1] = this.walkable(to[0], to[2]) ? [to[0], y, to[2]] : [this.centerX(goal % W), y, this.centerZ(Math.floor(goal / W))];
      return this.smooth(pts);
    }
    return null;
  }

  /** A* from cell `start` to cell `goal`: the cells of a shortest way, or null. */
  private search(start: number, goal: number): number[] | null {
    const W = this.width;
    const gx = goal % W;
    const gy = Math.floor(goal / W);
    const g = this.g;
    g.fill(Infinity);
    this.from.fill(-1);
    const heap = this.heap;
    heap.clear();
    g[start] = 0;
    const h = (i: number) => {
      const dx = Math.abs((i % W) - gx);
      const dy = Math.abs(Math.floor(i / W) - gy);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); // octile distance
    };
    heap.push(start, h(start));
    const closed = new Uint8Array(W * this.height);
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W;
      const cy = Math.floor(cur / W);
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.isOpen(nx, ny)) continue;
        // diagonals only past two open sides (no squeezing between corners)
        if (dx !== 0 && dy !== 0 && (!this.isOpen(cx + dx, cy) || !this.isOpen(cx, cy + dy))) continue;
        const n = ny * W + nx;
        const ng = g[cur]! + cost;
        if (ng < g[n]!) {
          g[n] = ng;
          this.from[n] = cur;
          heap.push(n, ng + h(n));
        }
      }
    }
    if (g[goal] === Infinity) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.from[c]!) cells.push(c);
    return cells.reverse();
  }

  /** Drop every point the path can skip in a straight line. */
  smooth(pts: [number, number, number][]): [number, number, number][] {
    if (pts.length <= 2) return pts;
    const out = [pts[0]!];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineOfSight(pts[i]![0], pts[i]![2], pts[j]![0], pts[j]![2], 0.3)) j--;
      out.push(pts[j]!);
      i = j;
    }
    return out;
  }

  /** Open cells near (col, row), nearest first (itself if open; else within 4 cells, straight neighbours before diagonals). */
  private openNear(col: number, row: number): number[] {
    if (this.isOpen(col, row)) return [row * this.width + col];
    const found: [number, number][] = [];
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) if (this.isOpen(col + dx, row + dy)) found.push([(row + dy) * this.width + col + dx, dx * dx + dy * dy]);
    found.sort((a, b) => a[1] - b[1]);
    return found.slice(0, 8).map((f) => f[0]);
  }

  // ------------------------------------------------------------------ line of sight

  /**
   * Can you see (or walk straight) from a to b? Walks the cells under the segment (a DDA);
   * `radius` > 0 also tests two lines offset sideways (a body that wide fits).
   */
  lineOfSight(ax: number, az: number, bx: number, bz: number, radius = 0): boolean {
    if (radius > 0) {
      const dx = bx - ax;
      const dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const px = (-dz / l) * radius;
      const pz = (dx / l) * radius;
      return this.ray(ax + px, az + pz, bx + px, bz + pz) && this.ray(ax - px, az - pz, bx - px, bz - pz);
    }
    return this.ray(ax, az, bx, bz);
  }

  /**
   * Distance from a along a direction to the first closed cell (at most `max`): the same cell
   * walk as `lineOfSight`, so a vision cone drawn with it shows exactly what a guard can see.
   */
  castWall(ax: number, az: number, dx: number, dz: number, max: number): number {
    const l = Math.hypot(dx, dz) || 1;
    return this.walk(ax, az, (dx / l) * max, (dz / l) * max) * max;
  }

  /** Grid DDA: true if every cell the segment crosses is open. */
  private ray(ax: number, az: number, bx: number, bz: number): boolean {
    return this.walk(ax, az, bx - ax, bz - az) >= 1;
  }

  /**
   * Walk the cells along a + t·d for t in 0..1 (a DDA): where the first closed cell begins, as
   * a fraction of d (0 when a is in one), or 1 when there is none.
   */
  private walk(ax: number, az: number, dx: number, dz: number): number {
    let col = this.col(ax);
    let row = this.row(az);
    const stepC = Math.sign(dx);
    const stepR = Math.sign(dz);
    const tDeltaC = dx !== 0 ? Math.abs(this.cell / dx) : Infinity;
    const tDeltaR = dz !== 0 ? Math.abs(this.cell / dz) : Infinity;
    let tMaxC = dx !== 0 ? Math.abs((this.ox + (col + (stepC > 0 ? 1 : 0)) * this.cell - ax) / dx) : Infinity;
    let tMaxR = dz !== 0 ? Math.abs((this.oz + (row + (stepR > 0 ? 1 : 0)) * this.cell - az) / dz) : Infinity;
    let t = 0; // where the current cell begins along the segment
    for (let guard = 0; guard < this.width + this.height + 4; guard++) {
      if (!this.isOpen(col, row)) return t;
      if (Math.min(tMaxC, tMaxR) > 1) return 1; // the segment ends in this cell
      if (tMaxC < tMaxR) {
        t = tMaxC;
        tMaxC += tDeltaC;
        col += stepC;
      } else {
        t = tMaxR;
        tMaxR += tDeltaR;
        row += stepR;
      }
    }
    return 1;
  }

  // ------------------------------------------------------------------ flow fields

  /**
   * A flow field toward the world point (x, z): the walking distance from every cell to it.
   * Rebuilt only when the target changes cell or the grid changed (`version`). Returns
   * whether it was rebuilt.
   */
  flowTo(x: number, z: number): boolean {
    const target = this.openNear(this.col(x), this.row(z))[0];
    if (target === undefined) return false;
    if (target === this.flowTarget && this.flowVersion === this.version) return false;
    this.flowTarget = target;
    this.flowVersion = this.version;
    this.flowBuilds++;
    const W = this.width;
    const d = this.flow;
    d.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    d[target] = 0;
    heap.push(target, 0);
    while (heap.size) {
      const key = heap.topKey();
      const cur = heap.pop();
      const base = d[cur]!;
      if (key > base) continue; // a stale entry: this cell was reached by a shorter way since
      const cx = cur % W;
      const cy = Math.floor(cur / W);
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.isOpen(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!this.isOpen(cx + dx, cy) || !this.isOpen(cx, cy + dy))) continue;
        const n = ny * W + nx;
        if (base + cost < d[n]!) {
          d[n] = base + cost;
          heap.push(n, base + cost);
        }
      }
    }
    return true;
  }

  /** Walking distance to the flow target from a world point (Infinity: no way). */
  flowDistance(x: number, z: number): number {
    const c = this.col(x);
    const r = this.row(z);
    return this.isOpen(c, r) ? this.flow[r * this.width + c]! : Infinity;
  }

  /**
   * Which way to go from (x, z) toward the flow target: the unit direction to the
   * lowest-distance neighbour (into `out` [x, z]). Returns false at the target or with no way.
   */
  flowDirection(x: number, z: number, out: [number, number]): boolean {
    const col = this.col(x);
    const row = this.row(z);
    if (!this.isOpen(col, row)) return false;
    const W = this.width;
    let best = this.flow[row * W + col]!;
    if (best === 0 || best === Infinity) return false;
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of DIRS) {
      const nx = col + dx;
      const ny = row + dy;
      if (!this.isOpen(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!this.isOpen(col + dx, row) || !this.isOpen(col, row + dy))) continue;
      const d = this.flow[ny * W + nx]!;
      if (d < best) {
        best = d;
        bx = dx;
        by = dy;
      }
    }
    if (bx === 0 && by === 0) return false;
    // steer toward the next cell's centre (cuts corners less than a raw 8-way step)
    const tx = this.centerX(col + bx) - x;
    const tz = this.centerZ(row + by) - z;
    const l = Math.hypot(tx, tz) || 1;
    out[0] = tx / l;
    out[1] = tz / l;
    return true;
  }
}
