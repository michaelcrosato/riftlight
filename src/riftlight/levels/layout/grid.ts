import type { LayoutLike } from '../../core/types';

/**
 * The level grid: cells of 1 m. Cell (x, z) covers world [x, x+1] × [z, z+1]; its centre is
 * (x + 0.5, z + 0.5). Values follow `LayoutLike`: 0 void/pit, 1 floor, 2 wall.
 */
export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;

export type LayoutStyle = 'dungeon' | 'caves' | 'ruins' | 'arena' | 'bridges' | 'town';
export const LAYOUT_STYLES: readonly LayoutStyle[] = ['dungeon', 'caves', 'ruins', 'arena', 'bridges', 'town'];

/** Tagged cells from room templates (and generators). */
export type SpotTag = 'spawn' | 'treasure' | 'shrine' | 'mechanic' | 'boss' | 'entrance' | 'exit' | 'prop';

export interface Spot {
  readonly x: number;
  readonly z: number;
  readonly tag: SpotTag;
  readonly room: number;
}

export interface Room {
  readonly id: number;
  /** Bounding box in cells. */
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  /** Graph role + template tags: 'start' | 'combat' | 'treasure' | 'shrine' | 'boss' | 'hall'... */
  readonly tags: readonly string[];
  readonly template: string;
  /** On the start → boss chain. */
  readonly critical: boolean;
  /** Graph distance from the start room. */
  readonly depth: number;
}

export interface Cell {
  x: number;
  z: number;
}

export const key = (x: number, z: number, w: number) => z * w + x;

/** A generated layout: the grid plus rooms, the room graph, spots and the critical path. */
export class Layout implements LayoutLike {
  readonly cells: Uint8Array;
  /** Room id per cell (-1: corridor / outside). */
  readonly roomOf: Int16Array;
  rooms: Room[] = [];
  /** Room graph edges (corridors). */
  edges: [number, number][] = [];
  /** Room ids from start to boss. */
  critical: number[] = [];
  spots: Spot[] = [];
  start: Cell = { x: 0, z: 0 };
  exit: Cell = { x: 0, z: 0 };
  path: Cell[] = [];
  /** Bumps whenever a cell changes at runtime (Collapse): caches (nav) rebuild. */
  version = 0;
  /** Generation attempts it took (retries after failed placement). */
  attempts = 1;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly style: LayoutStyle,
    readonly seed: number,
  ) {
    this.cells = new Uint8Array(width * height);
    this.roomOf = new Int16Array(width * height).fill(-1);
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  cell(x: number, z: number): number {
    return this.inBounds(x, z) ? this.cells[z * this.width + x]! : VOID;
  }

  set(x: number, z: number, v: number): void {
    if (!this.inBounds(x, z)) return;
    const i = z * this.width + x;
    if (this.cells[i] !== v) {
      this.cells[i] = v;
      this.version++;
    }
  }

  isFloor(x: number, z: number): boolean {
    return this.cell(x, z) === FLOOR;
  }

  /** Room containing a cell, or null (corridor / outside). */
  roomAt(x: number, z: number): Room | null {
    if (!this.inBounds(x, z)) return null;
    const id = this.roomOf[z * this.width + x]!;
    return id >= 0 ? (this.rooms[id] ?? null) : null;
  }

  room(id: number): Room {
    const r = this.rooms[id];
    if (!r) throw new Error(`layout: no room ${id}`);
    return r;
  }

  /** Floor cells of a room. */
  roomCells(id: number): Cell[] {
    const r = this.room(id);
    const out: Cell[] = [];
    for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) if (this.roomOf[z * this.width + x] === id && this.isFloor(x, z)) out.push({ x, z });
    return out;
  }

  spotsOf(tag: SpotTag, room?: number): Spot[] {
    return this.spots.filter((s) => s.tag === tag && (room === undefined || s.room === room));
  }

  count(v: number): number {
    let n = 0;
    for (const c of this.cells) if (c === v) n++;
    return n;
  }

  /** Copy (a fresh grid for runtime changes, keeping the generated one intact). */
  clone(): Layout {
    const l = new Layout(this.width, this.height, this.style, this.seed);
    l.cells.set(this.cells);
    l.roomOf.set(this.roomOf);
    l.rooms = this.rooms;
    l.edges = this.edges;
    l.critical = this.critical;
    l.spots = this.spots;
    l.start = this.start;
    l.exit = this.exit;
    l.path = this.path;
    l.attempts = this.attempts;
    return l;
  }
}

/** World centre of a cell. */
export function cellCenter(c: Cell): [number, number] {
  return [c.x + 0.5, c.z + 0.5];
}

const N4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const N8: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];
export { N4, N8 };

/**
 * Chebyshev distance from every cell to the nearest non-walkable cell (0 on blocked cells).
 * Used to keep paths in the middle of rooms and to find open spots.
 */
export function clearance(w: number, h: number, walkable: (i: number) => boolean): Uint8Array {
  const d = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < w * h; i++) {
    if (!walkable(i)) {
      d[i] = 0;
      queue[tail++] = i;
    } else d[i] = 255;
  }
  // Cells on the border count as next to the outside.
  for (let x = 0; x < w; x++)
    for (const z of [0, h - 1]) {
      const i = z * w + x;
      if (d[i] === 255) {
        d[i] = 1;
        queue[tail++] = i;
      }
    }
  for (let z = 0; z < h; z++)
    for (const x of [0, w - 1]) {
      const i = z * w + x;
      if (d[i] === 255) {
        d[i] = 1;
        queue[tail++] = i;
      }
    }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    const z = (i - x) / w;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const j = nz * w + nx;
        if (d[j]! > d[i]! + 1) {
          d[j] = d[i]! + 1;
          queue[tail++] = j;
        }
      }
  }
  return d;
}

/**
 * Shortest 8-connected path (no corner cutting) over `walkable` cells, Dijkstra with an
 * optional extra per-cell cost (e.g. hugging walls costs more). Returns [] if unreachable.
 */
export function findPath(
  w: number,
  h: number,
  from: Cell,
  to: Cell,
  walkable: (i: number) => boolean,
  extraCost?: (i: number) => number,
): Cell[] {
  const n = w * h;
  const start = from.z * w + from.x;
  const goal = to.z * w + to.x;
  if (!walkable(start) || !walkable(goal)) return [];
  const dist = new Float64Array(n).fill(Infinity); // f64: the heap keys are f64 too
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const [i, d] = heap.pop();
    if (d > dist[i]!) continue;
    if (i === goal) break;
    const x = i % w;
    const z = (i - x) / w;
    for (const [dx, dz, c] of N8) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      const j = nz * w + nx;
      if (!walkable(j)) continue;
      if (dx && dz && (!walkable(z * w + nx) || !walkable(nz * w + x))) continue; // no corner cutting
      const nd = d + c + (extraCost ? extraCost(j) : 0);
      if (nd < dist[j]!) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(j, nd);
      }
    }
  }
  if (dist[goal] === Infinity) return [];
  const out: Cell[] = [];
  for (let i = goal; i >= 0; i = prev[i]!) {
    const x = i % w;
    out.push({ x, z: (i - x) / w });
    if (i === start) break;
  }
  return out.reverse();
}

/** Cells reachable from `from` (4-connected flood fill). */
export function flood(w: number, h: number, from: Cell, walkable: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(w * h);
  const s = from.z * w + from.x;
  if (!walkable(s)) return seen;
  const queue = [s];
  seen[s] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const z = (i - x) / w;
    for (const [dx, dz] of N4) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      const j = nz * w + nx;
      if (seen[j] || !walkable(j)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

/** Binary min-heap of (index, priority). */
export class MinHeap {
  private readonly ids: number[] = [];
  private readonly pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent]! <= p) break;
      ids[i] = ids[parent]!;
      pri[i] = pri[parent]!;
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  }

  pop(): [number, number] {
    const ids = this.ids;
    const pri = this.pri;
    const top: [number, number] = [ids[0]!, pri[0]!];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mp = lastP;
        if (l < n && pri[l]! < mp) {
          m = l;
          mp = pri[l]!;
        }
        if (r < n && pri[r]! < mp) m = r;
        if (m === i) break;
        ids[i] = ids[m]!;
        pri[i] = pri[m]!;
        i = m;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }

  clear(): void {
    this.ids.length = 0;
    this.pri.length = 0;
  }
}
