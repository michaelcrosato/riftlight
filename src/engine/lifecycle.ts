import type { BufferGeometry, Material, Mesh, Object3D, Scene, Texture } from 'three/webgpu';

/**
 * Level lifecycle helpers. Objects marked `userData.engineOwned` (lights, the particle
 * group) survive a level unload; resources marked `userData.shared` (cached toon
 * materials, GLB geometry shared by every clone) are never disposed.
 */

/** Free the GPU resources (geometry, materials, their textures) of `root` and its children. */
export function disposeObject(root: Object3D): void {
  const seen = new Set<object>();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    const geometry = mesh.geometry as BufferGeometry | undefined;
    if (geometry && !seen.has(geometry) && !geometry.userData?.shared) {
      seen.add(geometry);
      geometry.dispose();
    }
    const material = mesh.material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (seen.has(m) || m.userData?.shared) continue;
      seen.add(m);
      for (const value of Object.values(m)) {
        const tex = value as Texture | null;
        if (tex && (tex as { isTexture?: boolean }).isTexture && !seen.has(tex) && !tex.userData?.shared) {
          seen.add(tex);
          tex.dispose();
        }
      }
      m.dispose();
    }
  });
}

/** Remove (and dispose) every scene child that is not engine-owned. Returns how many went. */
export function clearScene(scene: Scene): number {
  const doomed = scene.children.filter((c) => !c.userData.engineOwned);
  for (const obj of doomed) {
    scene.remove(obj);
    disposeObject(obj);
  }
  return doomed.length;
}

/** Number of objects in the tree under `root` (inclusive): a leak probe for tests. */
export function countObjects(root: Object3D): number {
  let n = 0;
  root.traverse(() => n++);
  return n;
}
