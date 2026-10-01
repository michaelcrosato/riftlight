/**
 * Grid navigation over any `LayoutLike` (the stub levels and the real ones): shortest
 * 4-connected floor paths. Used by the stub layout (critical path) and the playtest bot.
 */
import type { LayoutLike } from '../core/types';

/** Shortest 4-connected floor path, inclusive of both ends. */
export function bfs(L: LayoutLike, from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const w = L.width;
  const prev = new Int32Array(w * L.height).fill(-1);
  const startI = from.z * w + from.x;
  prev[startI] = startI;
  const queue = [startI];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    const x = i % w;
    const z = Math.floor(i / w);
    if (x === to.x && z === to.z) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (L.cell(nx, nz) !== 1) continue;
      const ni = nz * w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = i;
      queue.push(ni);
    }
  }
  const out: { x: number; z: number }[] = [];
  let i = to.z * w + to.x;
  if (prev[i] === -1) return out;
  while (i !== startI) {
    out.push({ x: i % w, z: Math.floor(i / w) });
    i = prev[i]!;
  }
  out.push({ x: from.x, z: from.z });
  return out.reverse();
}
