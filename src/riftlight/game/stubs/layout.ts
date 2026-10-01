/**
 * STUB layout generator (the levels workstream ships room templates + a graph): a chain of
 * rectangular rooms joined by 3-wide corridors on a grid of 1 m cells, walls around every
 * floor cell, and the critical path from start to exit (BFS). Seeded and pure.
 */
import type { Rng } from '../../core/rng';
import type { LayoutLike } from '../../core/types';
import { bfs } from '../nav';

export interface Room {
  id: number;
  x: number;
  z: number;
  w: number;
  h: number;
  tags: string[];
}

export class GridLayout implements LayoutLike {
  readonly cells: Uint8Array;
  rooms: Room[] = [];
  start = { x: 0, z: 0 };
  exit = { x: 0, z: 0 };
  path: { x: number; z: number }[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = new Uint8Array(width * height);
  }

  cell(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return 0;
    return this.cells[z * this.width + x]!;
  }

  set(x: number, z: number, v: number): void {
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return;
    this.cells[z * this.width + x] = v;
  }
}

/** Rooms in a meandering chain. `rooms` ≥ 2; the first is the start, the last the boss/exit. */
export function generateLayout(rng: Rng, rooms: number, size = 48): GridLayout {
  const L = new GridLayout(size, size);
  const placed: Room[] = [];
  let cx = 6 + rng.int(0, 4);
  let cz = size - 8;
  for (let i = 0; i < rooms; i++) {
    const last = i === rooms - 1;
    const w = last ? 11 : rng.int(7, 10);
    const h = last ? 11 : rng.int(7, 9);
    const x = Math.max(2, Math.min(size - w - 2, cx - Math.floor(w / 2)));
    const z = Math.max(2, Math.min(size - h - 2, cz - Math.floor(h / 2)));
    const room: Room = { id: i, x, z, w, h, tags: i === 0 ? ['start'] : last ? ['boss', 'exit'] : ['combat'] };
    placed.push(room);
    for (let zz = z; zz < z + h; zz++) for (let xx = x; xx < x + w; xx++) L.set(xx, zz, 1);
    // next centre: mostly "up" the map, swinging left or right
    const dir = rng.chance(0.5) ? -1 : 1;
    const nx = cx + dir * rng.int(6, 12);
    const nz = cz - rng.int(9, 12);
    cx = Math.max(7, Math.min(size - 8, nx));
    cz = Math.max(7, nz);
  }
  // corridors between consecutive room centres (L-shaped, 3 wide)
  for (let i = 1; i < placed.length; i++) {
    const a = centre(placed[i - 1]!);
    const b = centre(placed[i]!);
    const horizFirst = rng.chance(0.5);
    const corner = horizFirst ? { x: b.x, z: a.z } : { x: a.x, z: b.z };
    carve(L, a, corner);
    carve(L, corner, b);
  }
  // walls: void cells touching floor
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      if (L.cell(x, z) !== 0) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) if (L.cell(x + dx, z + dz) === 1) near = true;
      if (near) L.set(x, z, 2);
    }
  L.rooms = placed;
  L.start = centre(placed[0]!);
  L.exit = centre(placed[placed.length - 1]!);
  L.path = bfs(L, L.start, L.exit);
  return L;
}

function centre(r: Room): { x: number; z: number } {
  return { x: r.x + Math.floor(r.w / 2), z: r.z + Math.floor(r.h / 2) };
}

function carve(L: GridLayout, a: { x: number; z: number }, b: { x: number; z: number }): void {
  const sx = Math.sign(b.x - a.x);
  const sz = Math.sign(b.z - a.z);
  let x = a.x;
  let z = a.z;
  for (;;) {
    for (let d = -1; d <= 1; d++) {
      if (sx !== 0) L.set(x, z + d, 1);
      else L.set(x + d, z, 1);
    }
    if (x === b.x && z === b.z) break;
    if (x !== b.x) x += sx;
    else z += sz;
  }
}

export { bfs } from '../nav';
