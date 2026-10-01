import type { BufferGeometry, Material, Mesh, Object3D, Scene, SkinnedMesh, Texture } from 'three/webgpu';

/**
 * Level lifecycle helpers. Objects marked `userData.engineOwned` (lights, the particle
 * group) survive a level unload; resources marked `userData.shared` (cached toon
 * materials, GLB geometry shared by every clone) are never disposed.
 */

/**
 * Free the GPU resources of `root` and its children: geometry, materials, the textures
 * they reference (as properties such as `map`, or inside TSL node graphs such as
 * `colorNode = texture(t)`), and skinned meshes' bone textures.
 */
export function disposeObject(root: Object3D): void {
  const seen = new Set<object>();
  const disposeTexture = (tex: Texture) => {
    if (seen.has(tex) || tex.userData?.shared) return;
    seen.add(tex);
    tex.dispose();
  };
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    const geometry = mesh.geometry as BufferGeometry | undefined;
    if (geometry && !seen.has(geometry) && !geometry.userData?.shared) {
      seen.add(geometry);
      geometry.dispose();
    }
    const skinned = obj as SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton && !seen.has(skinned.skeleton)) {
      seen.add(skinned.skeleton);
      skinned.skeleton.dispose(); // its bone texture, if one was made
    }
    const material = mesh.material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (seen.has(m) || m.userData?.shared) continue;
      seen.add(m);
      for (const value of Object.values(m)) {
        if (!value || typeof value !== 'object') continue;
        if ((value as Texture).isTexture) disposeTexture(value as Texture);
        else if ((value as { isNode?: boolean }).isNode) for (const t of nodeTextures(value as NodeLike, seen)) disposeTexture(t);
      }
      m.dispose();
    }
  });
}

interface NodeLike {
  isNode: true;
  isTextureNode?: boolean;
  value?: unknown;
  getChildren(): Iterable<NodeLike>;
}

/** Textures sampled anywhere in a TSL node graph (texture(), pass textures excluded: they're render targets). */
function* nodeTextures(root: NodeLike, seen: Set<object>): Generator<Texture> {
  const stack: NodeLike[] = [root];
  let budget = 10000; // node graphs are DAGs, but stay bounded
  while (stack.length && budget-- > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    const v = n.value as Texture | undefined;
    if (n.isTextureNode && v?.isTexture && !(v as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) yield v;
    for (const child of n.getChildren()) stack.push(child);
  }
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
