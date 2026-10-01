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
/** Bytes loaded / expected per URL, for the loading indicator. */
const progress = new Map<string, { loaded: number; total: number; done: boolean }>();

function fetchModel(url: string): Promise<Model> {
  let pending = cache.get(url);
  if (!pending) {
    const p = { loaded: 0, total: 0, done: false };
    progress.set(url, p);
    pending = loader
      .loadAsync(resolveAsset(url), (e) => {
        p.loaded = e.loaded;
        if (e.lengthComputable) p.total = e.total;
      })
      .then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }))
      .finally(() => (p.done = true));
    cache.set(url, pending);
  }
  return pending;
}

/**
 * Load a local GLB (e.g. `assets/hero.glb` from /public) once; every call returns a fresh
 * clone whose materials are converted to the engine's toon materials.
 */
export async function loadModel(url: string, options?: ToonifyOptions): Promise<Model> {
  const model = await fetchModel(url);
  const scene = clone(model.scene); // skeleton-aware: cloned SkinnedMeshes get their own bones
  toonify(scene, options);
  return { scene, animations: model.animations };
}

/**
 * Start downloading (and parsing) models now, without waiting for them. Later
 * `loadModel` calls for the same URLs reuse the in-flight requests. The engine calls this
 * with `Game.assets` before the renderer and physics initialise.
 */
export function preloadModels(urls: readonly string[]): void {
  for (const url of urls) fetchModel(url).catch(() => {}); // the game's loadModel reports errors
}

/** Progress of every model requested so far: 0..1 (bytes where known, else files). */
export function assetProgress(): number {
  if (!progress.size) return 1;
  let sum = 0;
  for (const p of progress.values()) sum += p.done ? 1 : p.total > 0 ? Math.min(0.99, p.loaded / p.total) : 0;
  return sum / progress.size;
}

function resolveAsset(url: string): string {
  // Single-file builds (npm run build:single) embed assets as data URIs in this map.
  const embedded = (globalThis as { __PIXEL_ASSETS__?: Record<string, string> }).__PIXEL_ASSETS__?.[url];
  if (embedded) return embedded;
  if (/^(https?:|data:|blob:|\/)/.test(url)) return url;
  return `${import.meta.env.BASE_URL}${url}`;
}
