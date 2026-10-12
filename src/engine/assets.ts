import type { AnimationClip, Material, Mesh, Object3D, Texture } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { ModelCatalog } from './model/catalog';
import { packCatalog, parsePack } from './model/packs/pack';
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
      .then((gltf) => ({ scene: markShared(gltf.scene), animations: gltf.animations }))
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

const packs = new Map<string, Promise<ModelCatalog>>();

/**
 * Load a pack of imported models (`public/packs/<pack>.json`, docs/ASSETS.md *Importing*) once,
 * the way `loadModel` loads a GLB: the URL resolved the same way (under the base URL; a page may
 * put a data URL for it in `__PIXEL_ASSETS__`, though single-file builds embed only
 * `public/assets/*.glb`), counted by `assetProgress`. Resolves to a catalog of the pack's
 * ModelDefs, to build from with `buildModel(id, { catalog })`; `into` also adds them to a catalog
 * of yours (e.g. `MODEL_LIBRARY`, so `use` finds them).
 */
export function loadPack(url: string, opts: { readonly into?: ModelCatalog } = {}): Promise<ModelCatalog> {
  let pending = packs.get(url);
  if (!pending) {
    const p = { loaded: 0, total: 0, done: false };
    progress.set(url, p);
    pending = fetch(resolveAsset(url))
      .then((r) => {
        if (!r.ok) throw new Error(`pack ${url}: HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((json) => packCatalog(parsePack(json, `pack ${url}`)))
      .finally(() => (p.done = true));
    packs.set(url, pending);
  }
  return pending.then((catalog) => {
    opts.into?.add(...catalog.all());
    return catalog;
  });
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
