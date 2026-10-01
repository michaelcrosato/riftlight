import type { AnimationClip, Material, Mesh, Object3D, Texture } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { toonify, type ToonifyOptions } from './render/toon';

export interface Model {
  scene: Object3D;
  animations: AnimationClip[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Model>>();

/**
 * Load a local GLB (e.g. `assets/hero.glb` from /public) once; every call returns a fresh
 * clone whose materials are converted to the engine's toon materials.
 */
export async function loadModel(url: string, options?: ToonifyOptions): Promise<Model> {
  let pending = cache.get(url);
  if (!pending) {
    pending = loader.loadAsync(resolveAsset(url)).then((gltf) => ({ scene: markShared(gltf.scene), animations: gltf.animations }));
    cache.set(url, pending);
  }
  const model = await pending;
  const scene = clone(model.scene); // skeleton-aware: cloned SkinnedMeshes get their own bones
  toonify(scene, options);
  return { scene, animations: model.animations };
}

/**
 * Clones share the cached model's geometry and textures: mark them so a level unload
 * (engine.loadGame) never disposes what the next clone still needs.
 */
function markShared(root: Object3D): Object3D {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.userData.shared = true;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (m as Material & { map?: Texture | null }).map;
      if (map) map.userData.shared = true;
    }
  });
  return root;
}

function resolveAsset(url: string): string {
  // Single-file builds (npm run build:single) embed assets as data URIs in this map.
  const embedded = (globalThis as { __PIXEL_ASSETS__?: Record<string, string> }).__PIXEL_ASSETS__?.[url];
  if (embedded) return embedded;
  if (/^(https?:|data:|blob:|\/)/.test(url)) return url;
  return `${import.meta.env.BASE_URL}${url}`;
}
