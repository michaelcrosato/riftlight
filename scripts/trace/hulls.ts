// Convex decomposition for `npm run model -- trace --reference` (docs/plans/asset-system.md §7.4):
// Rapier 0.20's V-HACD (`ColliderDesc.convexDecomposition`), headless. Hints only: the pieces
// V-HACD cuts follow volume, not how a model is built, so the reference prints their fitted
// boxes after the exact per-component ones. Needs the engine hooks (./hooks.ts) under tsx.
import type RAPIER_TYPE from '@dimforge/rapier3d';
import { Quaternion, Vector3 } from 'three/webgpu';
import type { SourceMesh } from '../../src/engine/model/import';
import type { ConvexHull } from '../../src/engine/model/trace';

/**
 * At most this many hulls, cut at this concavity (a fraction of the mesh's size), on a voxel grid
 * this fine. Chosen on the tree and the gate-a hand cart: the default (concavity 0.01, 1024 hulls)
 * cuts a two-box L into 8 slivers; these give the masses a modeller would start from.
 */
export const HULL_PARAMS = { maxConvexHulls: 12, concavity: 0.05, resolution: 64 } as const;

/** The mesh welded to the millimetre, as V-HACD takes it. */
function indexed(src: SourceMesh): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const index = new Map<string, number>();
  const indices: number[] = [];
  const p = src.positions;
  for (let k = 0; k + 2 < p.length; k += 3) {
    const q = [Math.round(p[k]! * 1000), Math.round(p[k + 1]! * 1000), Math.round(p[k + 2]! * 1000)];
    const key = q.join();
    let i = index.get(key);
    if (i === undefined) {
      index.set(key, (i = verts.length / 3));
      verts.push(q[0]! / 1000, q[1]! / 1000, q[2]! / 1000);
    }
    indices.push(i);
  }
  const kept: number[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    if (a !== b && b !== c && a !== c) kept.push(a, b, c);
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(kept) };
}

/** The mesh's convex pieces, in its own frame (empty when V-HACD finds none). */
export async function convexHulls(src: SourceMesh, params: Partial<typeof HULL_PARAMS> = {}): Promise<ConvexHull[]> {
  // the glue first (it installs the stub), then the real instance, as the engine's own order is
  const R = (await import('@dimforge/rapier3d')).default as typeof RAPIER_TYPE;
  const { initRapier } = await import('../../src/engine/physics/rapierWasm');
  await initRapier();
  const { vertices, indices } = indexed(src);
  if (!indices.length) return [];
  const desc = R.ColliderDesc.convexDecomposition(vertices, indices, { ...HULL_PARAMS, ...params });
  if (!desc) return [];
  const shape = desc.shape;
  const pieces: { shape: RAPIER_TYPE.Shape; at: RAPIER_TYPE.Vector; rot: RAPIER_TYPE.Rotation }[] =
    shape.type === R.ShapeType.Compound
      ? (shape as RAPIER_TYPE.Compound).shapes.map((s, i) => ({ shape: s, at: (shape as RAPIER_TYPE.Compound).positions[i]!, rot: (shape as RAPIER_TYPE.Compound).rotations[i]! }))
      : [{ shape, at: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } }];
  const out: ConvexHull[] = [];
  for (const p of pieces) {
    if (p.shape.type !== R.ShapeType.ConvexPolyhedron) continue;
    const poly = p.shape as RAPIER_TYPE.ConvexPolyhedron;
    const v = Float32Array.from(poly.vertices);
    // each piece's own transform (V-HACD's are the identity today; a later Rapier may not be)
    const q = new Quaternion(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
    const at = new Vector3(p.at.x, p.at.y, p.at.z);
    const t = new Vector3();
    for (let i = 0; i + 2 < v.length; i += 3) {
      t.set(v[i]!, v[i + 1]!, v[i + 2]!).applyQuaternion(q).add(at);
      [v[i], v[i + 1], v[i + 2]] = [t.x, t.y, t.z];
    }
    out.push({ vertices: v, indices: poly.indices ? Uint32Array.from(poly.indices) : null });
  }
  return out;
}
