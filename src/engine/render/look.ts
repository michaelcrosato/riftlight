/**
 * Looks: which filters run on which part of the picture.
 *
 * A frame has two kinds of things in it: **actors** (characters and objects: the hero,
 * monsters, townsfolk, loot, chests; anything a game tags with `setLookLayer(obj, 'actors')`)
 * and the **environment** (everything else: floors, walls, buildings, trees). A `Look` gives
 * each of them its own source and filter stack, and then runs a third stack over the whole
 * composed frame:
 *
 *   actors      → pixel art (or clean) + actor filters   ─┐
 *                                                         ├─ composed by depth ─▶ scene filters ─▶ screen
 *   environment → pixel art (or clean) + world filters   ─┘
 *
 * So a clean, full-resolution world with pixel-art characters is
 * `{ actors: { pixel: crisp }, environment: { pixel: null } }`. When both layers are the
 * same (the default: pixel art everywhere, filters on the whole scene) the renderer draws
 * the scene once, exactly as before; only a look that differs per layer pays for a second
 * scene pass. Filter parameters are uniforms, so moving a slider never rebuilds a shader.
 *
 * Everything here is plain data (unit-tested in `look.test.ts`): the renderer turns a look
 * into a node graph (`PixelRenderer.setLook`).
 */
import { FILTERS, type FilterParam, FILTER_PRESETS, clampParam, defaultParams, filterParams, getFilter } from './filters';
import type { LookLayer } from './lookLayer';

export { LOOK_LAYER_KEY, lookLayerOf, setLookLayer, type LookLayer } from './lookLayer';
/** Where a filter stack applies: the whole composed frame, or one layer. */
export type LookTarget = 'scene' | LookLayer;

export const LOOK_TARGETS: readonly LookTarget[] = ['scene', 'actors', 'environment'];
export const LOOK_TARGET_LABELS: Readonly<Record<LookTarget, string>> = {
  scene: 'Whole scene',
  actors: 'Characters + objects',
  environment: 'Environment',
};

/** Pixel-art rendering of a layer: the scene at the art resolution with outlines. */
export interface PixelLook {
  /** Art pixels per rendered pixel: 1 = the native art resolution, 2+ = chunkier. */
  size: number;
  /** Silhouette (depth) outline darkening, 0..1. */
  outline: number;
  /** Internal crease highlight (normal edges), 0..1. Keep it weak. */
  crease: number;
}

/** One filter in a stack, with its parameter values (missing ones are the defaults). */
export interface LookFilter {
  id: string;
  params?: Record<string, number>;
}

/** A layer's own look: its source (pixel art or clean) and its filters. */
export interface LayerLook {
  /** Pixel-art settings, or null for clean full-resolution rendering. */
  pixel: PixelLook | null;
  filters: LookFilter[];
}

export interface Look {
  /** Filters on the composed frame (both layers). */
  scene: LookFilter[];
  actors: LayerLook;
  environment: LayerLook;
}

export const PIXEL_PARAMS: readonly FilterParam[] = [
  {
    key: 'size',
    label: 'Pixel size',
    min: 1,
    max: 6,
    step: 1,
    default: 1,
    unit: 'x',
  },
  {
    key: 'outline',
    label: 'Outline',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    unit: '%',
  },
  {
    key: 'crease',
    label: 'Creases',
    min: 0,
    max: 0.5,
    step: 0.02,
    default: 0.08,
    unit: '%',
  },
];

export const PIXEL_PRESETS: Readonly<Record<string, Readonly<PixelLook>>> = {
  crisp: { size: 1, outline: 0.45, crease: 0.08 },
  'no lines': { size: 1, outline: 0, crease: 0 },
  inked: { size: 1, outline: 0.85, crease: 0.2 },
  chunky: { size: 2, outline: 0.5, crease: 0.1 },
  blocky: { size: 3, outline: 0.55, crease: 0.12 },
  mosaic: { size: 5, outline: 0.3, crease: 0 },
};

export const DEFAULT_PIXEL: Readonly<PixelLook> = PIXEL_PRESETS.crisp!;

/** The engine default: pixel art everywhere, no filters. */
export function defaultLook(): Look {
  return {
    scene: [],
    actors: { pixel: { ...DEFAULT_PIXEL }, filters: [] },
    environment: { pixel: { ...DEFAULT_PIXEL }, filters: [] },
  };
}

/** A plain stack of filters on the whole scene (what `setFilters(ids)` means), keeping `base`'s layers. */
export function lookFromFilters(ids: readonly string[], base: Look = defaultLook()): Look {
  const look = cloneLook(base);
  look.scene = ids.map((id) => ({
    id,
    params: { ...(base.scene.find((f) => f.id === id)?.params ?? {}) },
  }));
  return normalizeLook(look);
}

export function cloneLook(look: Look): Look {
  const filters = (fs: readonly LookFilter[]) => fs.map((f) => ({ id: f.id, params: { ...(f.params ?? {}) } }));
  const layer = (l: LayerLook): LayerLook => ({
    pixel: l.pixel ? { ...l.pixel } : null,
    filters: filters(l.filters),
  });
  return {
    scene: filters(look.scene),
    actors: layer(look.actors),
    environment: layer(look.environment),
  };
}

/** The filters of one target (scene stack or a layer's). */
export function lookFilters(look: Look, target: LookTarget): LookFilter[] {
  return target === 'scene' ? look.scene : look[target].filters;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function normalizeFilters(raw: unknown): LookFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: LookFilter[] = [];
  for (const item of raw) {
    const id = typeof item === 'string' ? item : isRecord(item) && typeof item.id === 'string' ? item.id : null;
    const def = id ? getFilter(id) : undefined;
    if (!def || out.some((f) => f.id === def.id)) continue; // unknown or duplicate
    const given = isRecord(item) && isRecord(item.params) ? item.params : {};
    const params: Record<string, number> = {};
    for (const p of filterParams(def)) params[p.key] = clampParam(p, typeof given[p.key] === 'number' ? (given[p.key] as number) : p.default);
    out.push({ id: def.id, params });
  }
  return out;
}

export function normalizePixel(raw: unknown): PixelLook | null {
  if (raw === null || raw === false) return null;
  const given = isRecord(raw) ? raw : {};
  const out = { ...DEFAULT_PIXEL };
  for (const p of PIXEL_PARAMS) {
    const v = given[p.key];
    (out as Record<string, number>)[p.key] = clampParam(p, typeof v === 'number' ? v : p.default);
  }
  return out;
}

/**
 * A complete, valid look from anything (storage, the URL, an agent): unknown filters and
 * duplicates dropped, every parameter present and clamped to its range, layers defaulted.
 */
export function normalizeLook(raw: unknown): Look {
  const r = isRecord(raw) ? raw : {};
  const layer = (v: unknown): LayerLook => {
    const l = isRecord(v) ? v : {};
    return {
      pixel: 'pixel' in l ? normalizePixel(l.pixel) : { ...DEFAULT_PIXEL },
      filters: normalizeFilters(l.filters),
    };
  };
  return {
    scene: normalizeFilters(r.scene),
    actors: layer(r.actors),
    environment: layer(r.environment),
  };
}

export function looksEqual(a: Look, b: Look): boolean {
  return JSON.stringify(normalizeLook(a)) === JSON.stringify(normalizeLook(b));
}

export function pixelsEqual(a: PixelLook | null, b: PixelLook | null): boolean {
  if (!a || !b) return a === b;
  return a.size === b.size && a.outline === b.outline && a.crease === b.crease;
}

/** The layers' pixel settings when they are the same (what "whole scene" pixel art means), else undefined. */
export function scenePixel(look: Look): PixelLook | null | undefined {
  return pixelsEqual(look.actors.pixel, look.environment.pixel) ? look.actors.pixel : undefined;
}

/** One scene render the renderer needs: the whole scene, or one layer. */
export interface LookSource {
  layer: 'all' | LookLayer;
  pixel: PixelLook | null;
  /** Filters of this source before composing (empty for `all`). */
  filters: LookFilter[];
}

export interface LookPlan {
  /** Two scene passes (actors and environment) composed by depth. */
  split: boolean;
  sources: LookSource[];
  /** Filters on the composed frame. */
  scene: LookFilter[];
  /**
   * What decides the node graph: pixel on/off per source and the filter ids in order.
   * Parameter values and pixel sizes are uniforms and stay out of it.
   */
  key: string;
}

/**
 * What a look needs from the renderer. One scene pass when both layers look the same
 * (same pixel settings, no per-layer filters), two otherwise.
 */
export function planLook(look: Look): LookPlan {
  const ids = (fs: readonly LookFilter[]) => fs.map((f) => f.id).join(',');
  const { actors, environment } = look;
  const split = !pixelsEqual(actors.pixel, environment.pixel) || actors.filters.length > 0 || environment.filters.length > 0;
  if (!split) {
    return {
      split,
      sources: [{ layer: 'all', pixel: actors.pixel, filters: [] }],
      scene: look.scene,
      key: `one:${actors.pixel ? 'pixel' : 'clean'}|${ids(look.scene)}`,
    };
  }
  const src = (layer: LookLayer): LookSource => ({
    layer,
    pixel: look[layer].pixel,
    filters: look[layer].filters,
  });
  const part = (s: LookSource) => `${s.pixel ? 'pixel' : 'clean'}:${ids(s.filters)}`;
  const sources = [src('actors'), src('environment')];
  return {
    split,
    sources,
    scene: look.scene,
    key: `two:${part(sources[0]!)}|${part(sources[1]!)}|${ids(look.scene)}`,
  };
}

/** Filter ids active in a target (setActive side effects such as the PS1 wobble). */
export function activeIds(look: Look, target: LookTarget): string[] {
  return lookFilters(look, target).map((f) => f.id);
}

// ------------------------------------------------------------------ presets

const stack = (...ids: string[]): LookFilter[] => ids.map((id) => ({ id }));
const layer = (pixel: PixelLook | null, ...ids: string[]): LayerLook => ({
  pixel,
  filters: stack(...ids),
});
const crisp = (): PixelLook => ({ ...DEFAULT_PIXEL });
const clean = null;
const withParams = (id: string, params: Record<string, number>): LookFilter => ({ id, params });

/**
 * Named looks. Every plain filter stack (`FILTER_PRESETS`) is here as a whole-scene look,
 * followed by looks that mix layers.
 */
export const LOOK_PRESETS: Readonly<Record<string, Look>> = Object.fromEntries(
  Object.entries({
    ...Object.fromEntries(Object.entries(FILTER_PRESETS).map(([name, ids]) => [name, lookFromFilters(ids)])),
    hd_clean: { scene: [], actors: layer(clean), environment: layer(clean) },
    pixel_heroes: {
      scene: [],
      actors: layer(crisp()),
      environment: layer(clean),
    },
    pixel_world: {
      scene: [],
      actors: layer(clean),
      environment: layer(crisp()),
    },
    chunky_world: {
      scene: [],
      actors: layer(crisp()),
      environment: layer({ ...PIXEL_PRESETS.blocky! }),
    },
    cel_cartoon: {
      scene: stack('cel'),
      actors: layer(clean),
      environment: layer(clean),
    },
    cel_heroes: {
      scene: [],
      actors: {
        pixel: clean,
        filters: [withParams('cel', { bands: 3, ink: 1, width: 2, saturation: 1.3 })],
      },
      environment: layer(crisp()),
    },
    retro_heroes: {
      scene: stack('vignette'),
      actors: layer({ ...PIXEL_PRESETS.chunky! }, 'nes'),
      environment: layer(clean, 'bloom'),
    },
    spotlight: {
      scene: stack('vignette'),
      actors: layer(crisp()),
      environment: layer(crisp(), 'moonlight'),
    },
    sketchbook: {
      scene: [],
      actors: layer(crisp(), 'cel'),
      environment: layer(clean, 'sketch'),
    },
    dream_world: {
      scene: [],
      actors: layer(crisp()),
      environment: layer(crisp(), 'bloom', 'sunset'),
    },
    handheld_heroes: {
      scene: [],
      actors: layer(crisp(), 'gameboy'),
      environment: layer(crisp(), 'grayscale'),
    },
  }).map(([name, look]) => [name, normalizeLook(look)]),
);

/** The preset name a look matches, or null (custom). */
export function lookPresetOf(look: Look): string | null {
  const key = JSON.stringify(normalizeLook(look));
  return Object.keys(LOOK_PRESETS).find((n) => JSON.stringify(LOOK_PRESETS[n]) === key) ?? null;
}

/**
 * The parameter preset a filter's values match, or null (custom). A preset sets its own
 * keys and the defaults for the rest; strength (`amount`) only counts when the preset sets it,
 * so a half-strength "heavy" is still "heavy".
 */
export function filterPresetOf(
  presets: Readonly<Record<string, Readonly<Record<string, number>>>>,
  defaults: Record<string, number>,
  values: Record<string, number>,
): string | null {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return (
    Object.keys(presets).find((n) => {
      const preset = presets[n]!;
      return Object.entries(defaults).every(([k, d]) => (k === 'amount' && !(k in preset) ? true : same(values[k] ?? d, preset[k] ?? d)));
    }) ?? null
  );
}

/** Parameter values of a filter in a look (defaults filled in). */
export function paramsOf(f: LookFilter): Record<string, number> {
  const def = getFilter(f.id);
  return def ? { ...defaultParams(def), ...(f.params ?? {}) } : { ...(f.params ?? {}) };
}

/** Canonical position of a filter (the order of FILTERS), so stacks edited by a UI stay in a sensible order. */
export function filterOrder(id: string): number {
  const i = FILTERS.findIndex((f) => f.id === id);
  return i < 0 ? FILTERS.length : i;
}
