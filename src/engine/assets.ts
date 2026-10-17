import type { AnimationClip, Material, Mesh, Object3D, Texture } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { ModelCatalog } from './model/catalog';
import { packCatalog, packTextures, parsePack, parsePackIndex, type ModelPack, type PackIndex } from './model/packs/pack';
import type { TextureCatalog } from './texture/catalog';
import { toonify, type ToonifyOptions } from './render/toon';

export interface Model {
  scene: Object3D;
  animations: AnimationClip[];
}

/**
 * Reads an asset's bytes by its path (`assets/hero.glb`, `packs/kenney-nature.json`). Set one with
 * `setAssetReader` where there is no page to fetch from: `nodeAssets()` (src/engine/node.ts) reads
 * `public/` in Node, and `Engine.headless` installs the one it is given.
 */
export type AssetReader = (path: string) => Promise<ArrayBuffer>;

let reader: AssetReader | null = null;

/**
 * Where models and packs come from, for the whole process (`loadModel` and `loadPack` share one
 * cache): a reader, or null for the page's way (fetch under the base URL). Loads already made stay cached.
 */
export function setAssetReader(read: AssetReader | null): void {
  reader = read;
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
    // with a reader the bytes are parsed here (three's FileLoader needs the page's ProgressEvent)
    const gltf = reader
      ? reader(url).then((bytes) => loader.parseAsync(bytes, ''))
      : loader.loadAsync(resolveAsset(url), (e) => {
          p.loaded = e.loaded;
          if (e.lengthComputable) p.total = e.total;
        });
    pending = gltf
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

interface LoadedPack {
  pack: ModelPack;
  models: ModelCatalog;
  textures: TextureCatalog;
}
const packs = new Map<string, Promise<LoadedPack>>();
/** The packs parsed so far: `loadPack` and Node's `loadPacksSync` hand out the same defs. */
const parsedPacks = new Map<string, LoadedPack>();

/**
 * A pack's parsed defs, once per URL: the first parse is kept and every later one (another load,
 * Node's `loadPacksSync`) gets it, so a catalog given the same pack twice holds the same defs.
 */
export function settlePack(url: string, json: unknown): LoadedPack {
  let entry = parsedPacks.get(url);
  if (!entry) {
    const pack = parsePack(json, `pack ${url}`);
    entry = { pack, models: packCatalog(pack), textures: packTextures(pack) };
    parsedPacks.set(url, entry);
    packs.set(url, Promise.resolve(entry));
  }
  return entry;
}

/** A pack parsed already (by `loadPack` or `settlePack`), if any. */
export function parsedPack(url: string): LoadedPack | undefined {
  return parsedPacks.get(url);
}

/** JSON by path: through the reader, or fetched from the page's base URL. */
async function readJson(url: string, what: string): Promise<unknown> {
  if (reader) return JSON.parse(new TextDecoder().decode(await reader(url))) as unknown;
  const r = await fetch(resolveAsset(url));
  if (!r.ok) throw new Error(`${what} ${url}: HTTP ${r.status}`);
  return r.json() as Promise<unknown>;
}

/**
 * Load a pack of imported models and textures (`public/packs/<pack>.json`, docs/assets/importing.md
 * *Packs*) once, the way `loadModel` loads a GLB: the URL resolved the same way (under the
 * base URL; a page may put a data URL for it in `__PIXEL_ASSETS__`, as single-file builds do for
 * every `packs/<id>.json` path the built code names, cut to the models it names), counted by
 * `assetProgress`. Resolves to a catalog of the
 * pack's ModelDefs, to build from with `buildModel(id, { catalog })`; `into` also adds them to a
 * catalog of yours (e.g. `MODEL_LIBRARY`, so `use` finds them), and `textures` gets the pack's
 * TextureDefs (e.g. `TEXTURE_LIBRARY`, so `textureMap(id)` and `hudSprite(id)` find them).
 */
export function loadPack(url: string, opts: { readonly into?: ModelCatalog; readonly textures?: TextureCatalog } = {}): Promise<ModelCatalog> {
  let pending = packs.get(url);
  if (!pending) {
    const p = { loaded: 0, total: 0, done: false };
    progress.set(url, p);
    pending = readJson(url, 'pack')
      .then((json) => settlePack(url, json))
      .finally(() => (p.done = true));
    packs.set(url, pending);
  }
  return pending.then(({ models, textures }) => {
    opts.into?.add(...models.all());
    opts.textures?.add(...textures.all());
    return models;
  });
}

/**
 * The packs a site carries (`public/packs/index.json`, written by the importers): each pack's
 * id, title, file (relative to the index), how many models and textures it holds, its licence
 * and author. Load one with `loadPack(new URL(entry.file, indexUrl))`, or `packs/<file>`.
 */
export async function loadPackIndex(url = 'packs/index.json'): Promise<PackIndex> {
  return parsePackIndex(await readJson(url, 'pack index'), `pack index ${url}`);
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
