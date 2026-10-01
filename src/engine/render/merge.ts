import { BufferAttribute, BufferGeometry, type Material, Mesh, type Object3D } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface MergeOptions {
  /** Override castShadow on every merged mesh (default: keep each source mesh's flag). */
  castShadow?: boolean;
  /** Override receiveShadow on every merged mesh (default: keep each source mesh's flag). */
  receiveShadow?: boolean;
}

/**
 * Merge static meshes into one mesh per (material, shadow flags): N blocks with M
 * materials become ≤ M draw calls instead of N × groups (a BoxGeometry with 6 material
 * groups is 6 draws, plus 6 more in the shadow pass).
 *
 * World transforms are baked into the vertices, multi-material geometry is split by its
 * groups, and only `position` + `normal` are kept (all the toon materials need). The
 * sources are left untouched (don't add them to the scene). Physics is separate: keep
 * one collider per block. Merged meshes are culled as a whole, so merge things that are
 * on screen together (a level, a room), and keep anything that moves separate.
 */
export function mergeStaticMeshes(sources: readonly Object3D[], options: MergeOptions = {}): Mesh[] {
  const buckets = new Map<string, { material: Material; cast: boolean; receive: boolean; parts: BufferGeometry[] }>();
  const materialIds = new Map<Material, number>();

  const add = (mesh: Mesh) => {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const count = geo.index ? geo.index.count : geo.getAttribute('position').count;
    const groups = Array.isArray(mesh.material) && geo.groups.length ? geo.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const g of groups) {
      const material = materials[g.materialIndex ?? 0];
      if (!material) continue;
      const part = extract(geo, g.start, Math.min(g.count, count - g.start));
      part.applyMatrix4(mesh.matrixWorld);
      const cast = options.castShadow ?? mesh.castShadow;
      const receive = options.receiveShadow ?? mesh.receiveShadow;
      if (!materialIds.has(material)) materialIds.set(material, materialIds.size);
      const key = `${materialIds.get(material)}|${cast}|${receive}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { material, cast, receive, parts: [] }));
      bucket.parts.push(part);
    }
  };
  for (const root of sources) {
    root.traverse((o) => {
      if ((o as Mesh).isMesh) add(o as Mesh);
    });
  }

  const merged: Mesh[] = [];
  for (const b of buckets.values()) {
    const geometry = mergeGeometries(b.parts, false);
    for (const p of b.parts) p.dispose();
    if (!geometry) throw new Error('mergeStaticMeshes: incompatible geometry');
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, b.material);
    mesh.name = `merged:${b.material.name || b.material.type}`;
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.matrixAutoUpdate = false; // vertices are already in world space
    merged.push(mesh);
  }
  return merged;
}

/** Vertices `[start, start + count)` (of the index, if any) as non-indexed position + normal. */
function extract(geo: BufferGeometry, start: number, count: number): BufferGeometry {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const out = new BufferGeometry();
  const index = geo.index;
  for (const name of ['position', 'normal'] as const) {
    const a = geo.getAttribute(name);
    const n = a.itemSize;
    const arr = new Float32Array(count * n);
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(start + i) : start + i;
      for (let k = 0; k < n; k++) arr[i * n + k] = a.getComponent(v, k);
    }
    out.setAttribute(name, new BufferAttribute(arr, n));
  }
  return out;
}
