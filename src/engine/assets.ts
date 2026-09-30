import type { AnimationClip, Object3D } from 'three/webgpu';
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
    pending = loader.loadAsync(resolveAsset(url)).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
    cache.set(url, pending);
  }
  const model = await pending;
  const scene = clone(model.scene); // skeleton-aware: cloned SkinnedMeshes get their own bones
  toonify(scene, options);
  return { scene, animations: model.animations };
}

function resolveAsset(url: string): string {
  if (/^(https?:|data:|blob:|\/)/.test(url)) return url;
  return `${import.meta.env.BASE_URL}${url}`;
}
