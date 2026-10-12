/**
 * `buildModel`: a def (or a library id) → one merged, faceted mesh per material, plus named
 * pivot groups left movable, its bounds, anchors, collider data and light request. Models whose
 * parts don't read the rng are cached per (params, palette): their geometry is shared
 * (`userData.shared`, kept by level unloads) and each build gets fresh Object3Ds.
 *
 *   const lamp = buildModel('lamp-post');
 *   scene.add(lamp.object);
 *   if (lamp.light) ctx.lights.request({ ...lamp.light, position: lamp.light.at });
 *   const stall = buildModel('market-stall', { palette: { cloth: 'blue' } });
 */
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { PALETTE } from '../palette';
import type { FlickerPreset } from '../render/lights';
import { glowMaterial, toonMaterial } from '../render/toon';
import type { TextureCatalog } from '../texture/catalog';
import { textureMap } from '../texture/convert';
import { TEXTURE_LIBRARY } from '../texture/library';
import type { ModelCatalog } from './catalog';
import { boundsOf, compileParts, type Bounds, type Compiled } from './compile';
import { expandDef, type Binding, type ExpandedModel, type Expansion, type ModelOptions } from './expand';
import { MODEL_LIBRARY } from './library';
import type { Anchor, ModelDef, Slot, Vec3 } from './types';
import { DEFAULT_TEXEL, partUVs } from './uv';

export type ColliderData =
  | { readonly kind: 'box'; readonly center: Vec3; readonly half: Vec3 }
  | { readonly kind: 'cyl'; readonly center: Vec3; readonly radius: number; readonly halfHeight: number }
  | { readonly kind: 'hull'; readonly points: readonly number[] };

/** What to hand `ctx.lights.request` (positions are model space: add the placement). */
export interface ModelLightRequest {
  readonly at: Vec3;
  readonly color: number;
  readonly intensity: number;
  readonly radius: number;
  readonly flicker?: FlickerPreset;
}

export interface ModelReport {
  readonly tris: number;
  readonly draws: number;
  /** Distinct materials (toon or glow per colour). */
  readonly materials: number;
  /** Placed primitives (one per slot for imported meshes). */
  readonly parts: number;
  /** Whether the parts read the rng (then each seed builds its own geometry). */
  readonly seeded: boolean;
  /** Whether this build reused cached geometry. */
  readonly cached: boolean;
}

export interface ModelBuild {
  readonly id: string;
  /** Named after the model; pivots are named Groups inside it. */
  readonly object: Group;
  readonly bounds: Bounds;
  readonly anchors: Readonly<Record<string, { readonly at: Vec3; readonly rot: Vec3 }>>;
  readonly colliders: readonly ColliderData[];
  readonly light: ModelLightRequest | null;
  readonly report: ModelReport;
}

/** A model that can't be built; `problems` says why and how to fix each one. */
export class ModelError extends Error {
  constructor(
    readonly id: string,
    readonly problems: readonly string[],
  ) {
    super(`model '${id}': ${problems.join('; ')}`);
    this.name = 'ModelError';
  }
}

/** One mesh of a build: a material's triangles inside one pivot (or the root). */
export interface MeshLayout {
  readonly pivot: number;
  readonly slot: Slot;
  readonly glow: boolean;
  /** The slot's colour; white under a texture (the texture brings its own colours). */
  readonly hex: number;
  /** The TextureDef id its parts name, if textured. */
  readonly tex?: string;
  /** Positions in the pivot's frame, 9 per triangle, wound outward. */
  readonly positions: Float32Array;
  /** Textured meshes, when laid out with `uv`: 6 per triangle, in texture repeats. */
  readonly uvs?: Float32Array;
}

/** What `layoutModel` needs to give textured parts their UVs. */
export interface UvLayout {
  /** Texels per metre (the def's `texel`, else `DEFAULT_TEXEL`). */
  readonly texel: number;
  readonly textures: TextureCatalog;
}

export interface Layout {
  readonly meshes: readonly MeshLayout[];
  /** Each pivot's name, parent and transform relative to its parent. */
  readonly pivots: readonly { readonly name: string; readonly parent: number; readonly local: Matrix4 }[];
  readonly bounds: Bounds;
  readonly tris: number;
}

const isVec3 = (a: Anchor): a is Vec3 => Array.isArray(a);

export const bindingHex = (b: Binding): number => (typeof b === 'number' ? b : PALETTE[b]);

/**
 * Compiled parts → meshes: one per (pivot, material), triangles baked into the pivot's frame. A
 * textured part's material is its texture (on white), and with `uv` its mesh carries UVs.
 */
export function layoutModel(compiled: Compiled, palette: Readonly<Record<Slot, Binding>>, uv?: UvLayout): Layout {
  const inverse = compiled.pivots.map((p) => p.matrix.clone().invert());
  const buckets = new Map<string, { pivot: number; slot: Slot; glow: boolean; hex: number; tex?: string; data: number[]; uvs: number[] }>();
  const m = new Matrix4();
  const v = new Vector3();
  let tris = 0;
  for (const p of compiled.parts) {
    const binding = palette[p.slot];
    const tex = p.glow ? undefined : p.tex; // glow is flat colour (validate calls the pair a problem)
    const hex = tex ? 0xffffff : binding === undefined ? 0xff00ff : bindingHex(binding);
    const key = `${p.pivot}|${p.glow ? 'g' : 't'}|${hex}|${tex ?? ''}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { pivot: p.pivot, slot: p.slot, glow: p.glow, hex, ...(tex ? { tex } : {}), data: [], uvs: [] }));
    m.copy(p.matrix);
    if (p.pivot >= 0) m.premultiply(inverse[p.pivot]!);
    const flip = m.determinant() < 0; // mirrored: keep faces outward
    const uvs = tex && uv ? partUVs(p, uv.texel, uv.textures.get(tex).size) : null;
    for (let i = 0; i < p.tris.length; i += 9) {
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      for (const o of order) {
        v.set(p.tris[i + o * 3]!, p.tris[i + o * 3 + 1]!, p.tris[i + o * 3 + 2]!).applyMatrix4(m);
        b.data.push(v.x, v.y, v.z);
        if (uvs) b.uvs.push(uvs[(i / 3 + o) * 2]!, uvs[(i / 3 + o) * 2 + 1]!);
      }
      tris++;
    }
  }
  const pivots = compiled.pivots.map((p) => ({ name: p.name, parent: p.parent, local: p.parent >= 0 ? inverse[p.parent]!.clone().multiply(p.matrix) : p.matrix.clone() }));
  const meshes = [...buckets.values()].map((b) => ({ pivot: b.pivot, slot: b.slot, glow: b.glow, hex: b.hex, ...(b.tex ? { tex: b.tex } : {}), positions: new Float32Array(b.data), ...(b.uvs.length ? { uvs: new Float32Array(b.uvs) } : {}) }));
  return { meshes, pivots, bounds: boundsOf(compiled.parts), tris };
}

/** Collider data from the model's bounds (or its points, for `hull`). */
export function collidersOf(kind: ExpandedModel['collider'], compiled: Compiled, bounds: Bounds): ColliderData[] {
  const center: Vec3 = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
  const [sx, sy, sz] = bounds.size;
  if (kind === 'none' || !(sx > 0 || sy > 0 || sz > 0)) return [];
  if (kind === 'box') return [{ kind: 'box', center, half: [sx / 2, sy / 2, sz / 2] }];
  if (kind === 'cyl') return [{ kind: 'cyl', center, radius: Math.max(sx, sz) / 2, halfHeight: sy / 2 }];
  const seen = new Set<string>();
  const points: number[] = [];
  const v = new Vector3();
  for (const p of compiled.parts) {
    for (let i = 0; i < p.tris.length; i += 3) {
      v.set(p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!).applyMatrix4(p.matrix);
      const k = `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      points.push(v.x, v.y, v.z);
    }
  }
  return [{ kind: 'hull', points }];
}

interface Cached {
  readonly seeded: boolean;
  readonly expansion: Expansion;
  readonly layout: Layout;
  readonly geometries: readonly BufferGeometry[];
  readonly colliders: readonly ColliderData[];
  readonly parts: number;
}

/** Per def and (params, palette, catalog): a build to reuse, or a note that it is seeded. */
const cache = new WeakMap<ModelDef, Map<string, Cached | { readonly seeded: true }>>();
const catalogIds = new WeakMap<ModelCatalog | TextureCatalog, number>();
let catalogCount = 0;

function catalogId(c: ModelCatalog | TextureCatalog): number {
  let id = catalogIds.get(c);
  if (id === undefined) catalogIds.set(c, (id = ++catalogCount));
  return id;
}

const sorted = (o: Readonly<Record<string, unknown>> | undefined) => (o ? Object.keys(o).sort().map((k) => [k, o[k]]) : []);

/** Expand + compile, or throw a ModelError naming every problem. */
function prepare(def: ModelDef, opts: ModelOptions, catalog: ModelCatalog): { expansion: Expansion; compiled: Compiled } {
  const expansion = expandDef(def, opts, catalog);
  if (expansion.problems.length) throw new ModelError(def.id, expansion.problems);
  const compiled = compileParts(expansion.model.parts);
  if (compiled.problems.length) throw new ModelError(def.id, compiled.problems);
  return { expansion, compiled };
}

function geometryOf(m: MeshLayout, shared: boolean): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  if (m.uvs) g.setAttribute('uv', new BufferAttribute(m.uvs, 2));
  g.computeVertexNormals(); // non-indexed: one normal per face (faceted)
  g.computeBoundingBox();
  g.computeBoundingSphere();
  if (shared) g.userData.shared = true;
  return g;
}

/** Resolve an id through the catalog, or take the def as given. */
export function modelDef(idOrDef: string | ModelDef, catalog: ModelCatalog = MODEL_LIBRARY): ModelDef {
  return typeof idOrDef === 'string' ? catalog.get(idOrDef) : idOrDef;
}

export function buildModel(idOrDef: string | ModelDef, opts: ModelOptions = {}): ModelBuild {
  const catalog = opts.catalog ?? MODEL_LIBRARY;
  const textures = opts.textures ?? TEXTURE_LIBRARY;
  const def = modelDef(idOrDef, catalog);
  const key = JSON.stringify([sorted(opts.params), sorted(opts.palette), catalogId(catalog), catalogId(textures)]);
  let perDef = cache.get(def);
  const known = perDef?.get(key);
  let entry = known && !known.seeded ? (known as Cached) : undefined;
  const hit = !!entry;
  if (!entry) {
    const { expansion, compiled } = prepare(def, opts, catalog);
    const missing = [...new Set(compiled.parts.flatMap((p) => (p.tex && !textures.has(p.tex) ? [p.tex] : [])))];
    if (missing.length) throw new ModelError(def.id, missing.map((t) => `a part names texture '${t}', which no TextureDef declares: add the texture or drop \`tex\``));
    const layout = layoutModel(compiled, expansion.model.palette, { texel: expansion.model.texel ?? DEFAULT_TEXEL, textures });
    const shared = !expansion.seeded;
    entry = {
      seeded: expansion.seeded,
      expansion,
      layout,
      geometries: layout.meshes.map((m) => geometryOf(m, shared)),
      colliders: collidersOf(expansion.model.collider, compiled, layout.bounds),
      parts: compiled.parts.length,
    };
    if (!perDef) cache.set(def, (perDef = new Map()));
    // seeded models aren't cached: the entry only remembers that they are seeded
    perDef.set(key, shared ? entry : { seeded: true });
  }
  const { layout, expansion } = entry;
  const model = expansion.model;

  const object = new Group();
  object.name = model.id;
  const pivots: Object3D[] = layout.pivots.map((p) => {
    const g = new Group();
    g.name = p.name;
    p.local.decompose(g.position, g.quaternion, g.scale);
    return g;
  });
  layout.pivots.forEach((p, i) => (p.parent >= 0 ? pivots[p.parent]! : object).add(pivots[i]!));
  layout.meshes.forEach((m, i) => {
    const material = m.glow ? glowMaterial(m.hex) : m.tex ? toonMaterial(m.hex, { map: textureMap(m.tex, { catalog: textures }) }) : toonMaterial(m.hex);
    const mesh = new Mesh(entry.geometries[i]!, material);
    mesh.name = `${model.id}:${m.tex ? `tex:${m.tex}` : m.slot}${m.glow ? ':glow' : ''}`;
    mesh.castShadow = !m.glow;
    mesh.receiveShadow = true;
    (m.pivot >= 0 ? pivots[m.pivot]! : object).add(mesh);
  });

  const anchors: Record<string, { at: Vec3; rot: Vec3 }> = {};
  for (const [name, a] of Object.entries(model.anchors ?? {})) anchors[name] = isVec3(a) ? { at: a, rot: [0, 0, 0] } : { at: a.at, rot: a.rot };

  let light: ModelLightRequest | null = null;
  if (model.light) {
    const o = opts.light ?? {};
    // the light isn't part of the cache key, so its override is checked on every build
    if (o.c !== undefined && !(o.c in model.palette)) throw new ModelError(model.id, [`the build's light names slot '${o.c}', which the model does not have: pass \`color\` for a colour`]);
    const slot = o.c ?? model.light.c;
    const flicker = o.flicker ?? model.light.flicker;
    light = {
      at: o.at ?? model.light.at,
      color: o.color ?? bindingHex(model.palette[slot] ?? 'white'),
      intensity: o.intensity ?? model.light.intensity,
      radius: o.radius ?? model.light.radius,
      ...(flicker ? { flicker } : {}),
    };
  }

  const materials = new Set(layout.meshes.map((m) => `${m.glow}|${m.hex}|${m.tex ?? ''}`)).size;
  return {
    id: model.id,
    object,
    bounds: layout.bounds,
    anchors,
    colliders: entry.colliders,
    light,
    report: { tris: layout.tris, draws: layout.meshes.length, materials, parts: entry.parts, seeded: entry.seeded, cached: hit },
  };
}

/** The plain-JSON form of a model: params applied, `use` resolved (throws a ModelError on problems). */
export function expandModel(idOrDef: string | ModelDef, opts: ModelOptions = {}): ExpandedModel {
  const catalog = opts.catalog ?? MODEL_LIBRARY;
  const def = modelDef(idOrDef, catalog);
  const e = expandDef(def, opts, catalog);
  if (e.problems.length) throw new ModelError(def.id, e.problems);
  return e.model;
}

export { prepare as prepareModel };
