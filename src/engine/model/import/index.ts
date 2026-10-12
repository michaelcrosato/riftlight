/**
 * Mesh import (docs/plans/asset-system.md §7.2): a glTF or GLB file → a ModelDef of `mesh` parts
 * (and the `box` and `cyl` parts its pieces exactly are), palette-mapped, with its provenance and
 * fidelity in `source`. Faithful, not editable: an agent traces what a game will vary.
 *
 * 1. `readGltf`: every triangle in the scene, coloured (material, vertex colours, texture atlas).
 * 2. `normalizeSource`: metres (`scale`), the front turned to +Z (`front`), the base on y = 0,
 *    the footprint centred.
 * 3. `mapColours`: per-face colours → 2–6 slots on PALETTE entries, for the model or a whole pack.
 * 4. One part per source node and material (its exact boxes and cyls apart), named after the
 *    node, welded to the millimetre; a material without light (KHR_materials_unlit) glows.
 * 5. `scoreFidelity`: the def drawn against the source; scores into `source.fidelity`.
 *
 *   const { def, fidelity } = await importGltf(readFileSync('chair.glb'), {
 *     id: 'chair', source: { url: 'models/chair.glb', licence: 'LicenseRef-own' }, inflate: inflateSync,
 *   });
 */
import { scoreFidelity, modelTriangles, type FidelityScore } from '../fidelity';
import type { ModelDef, Part, Provenance, Slot } from '../types';
import { hexString, mapColours, type ColourMap, type ColourSample } from './colours';
import { readGltf, ImportError, type ReadFile, type ReadOptions, type SourceMesh } from './gltf';
import { groupParts } from './mesh';

export { mapColours, slotName, hexString, MERGE_DISTANCE, REUSE_PENALTY, SWAP_PENALTY, type ColourMap, type ColourSample, type ColourSlot, type MapOptions } from './colours';
export { readGltf, ImportError, type ReadFile, type ReadOptions, type SourceGroup, type SourceMesh } from './gltf';
export { groupParts, type GroupParts } from './mesh';
export { unzip, type Inflate as InflateRaw } from './zip';

/** Which way the source's front faces; the import turns it to +Z. */
export type Front = '+z' | '-z' | '+x' | '-x';
export const FRONTS: readonly Front[] = ['+z', '-z', '+x', '-x'];
/** Ids an import may take (`chair`, `kit/chair`): they name files, so nothing else. */
export const IMPORT_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/;
/** What `source.tool` records. */
export const IMPORT_TOOL = 'npm run model -- import';

export interface Normalize {
  /** Source units → metres (default 1: glTF is in metres). */
  readonly scale?: number;
  /** Which way the source's front faces (default '+z', glTF's convention). */
  readonly front?: Front;
}

/** Provenance the caller knows; the import adds `tool`, `colours` and `fidelity`. */
export type ImportSource = Omit<Provenance, 'tool' | 'colours' | 'fidelity'>;

export interface ImportOptions extends ReadOptions, Normalize {
  readonly id: string;
  readonly source: ImportSource;
  readonly about?: string;
  readonly tags?: readonly string[];
  /** A mapping shared by a pack (default: the model's own, `mapColours` over its faces). */
  readonly colours?: ColourMap;
}

export interface ImportReport {
  /** Triangles in the source. */
  readonly triangles: number;
  /** Triangles dropped as degenerate once welded to the millimetre. */
  readonly dropped: number;
  /** Source groups (node and material). */
  readonly groups: number;
  readonly parts: Readonly<Record<'mesh' | 'box' | 'cyl', number>>;
  /** Distinct source colours. */
  readonly colours: number;
}

export interface Imported {
  readonly def: ModelDef;
  /** The source as the def was made from it (normalized): what fidelity is scored against. */
  readonly source: SourceMesh;
  readonly colours: ColourMap;
  readonly fidelity: FidelityScore;
  readonly report: ImportReport;
}

/** Scale, turn the front to +Z, then put the base on y = 0 and centre the footprint. */
export function normalizeSource(src: SourceMesh, o: Normalize = {}): SourceMesh {
  const s = o.scale ?? 1;
  if (!(s > 0 && Number.isFinite(s))) throw new ImportError(`scale ${o.scale} must be a number above 0`);
  const front = o.front ?? '+z';
  if (!FRONTS.includes(front)) throw new ImportError(`front '${front}' is not one of ${FRONTS.join(', ')}`);
  // a quarter turn about Y that takes the source's front to +Z (no mirror: windings stay outward)
  const turn: Record<Front, (x: number, z: number) => [number, number]> = { '+z': (x, z) => [x, z], '-z': (x, z) => [-x, -z], '+x': (x, z) => [-z, x], '-x': (x, z) => [z, -x] };
  const p = new Float64Array(src.positions.length);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    const [x, z] = turn[front](src.positions[i]! * s, src.positions[i + 2]! * s);
    p[i] = x;
    p[i + 1] = src.positions[i + 1]! * s;
    p[i + 2] = z;
    for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k]!, p[i + k]!), Math.max(hi[k]!, p[i + k]!)];
  }
  const shift = [-(lo[0]! + hi[0]!) / 2, -lo[1]!, -(lo[2]! + hi[2]!) / 2];
  for (let i = 0; i < p.length; i++) p[i] = p[i]! + shift[i % 3]!;
  return { ...src, positions: p };
}

function triArea(p: ArrayLike<number>, t: number): number {
  const k = t * 9;
  const u = [p[k + 3]! - p[k]!, p[k + 4]! - p[k + 1]!, p[k + 5]! - p[k + 2]!];
  const v = [p[k + 6]! - p[k]!, p[k + 7]! - p[k + 1]!, p[k + 8]! - p[k + 2]!];
  return Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
}

/** Per-face colour samples (colour, area, material name) for `mapColours`. */
export function colourSamples(src: SourceMesh): ColourSample[] {
  return Array.from(src.colours, (hex, t) => ({ hex, area: triArea(src.positions, t), name: src.groups[src.group[t]!]!.material }));
}

/** A normalized source → its ModelDef, fidelity and report (`importGltf` without the reading). */
export function translateSource(src: SourceMesh, o: ImportOptions): Imported {
  const colours = o.colours ?? mapColours(colourSamples(src));
  const parts: Part[] = [];
  const names = new Set<string>();
  const unique = (base: string) => {
    let n = base;
    for (let k = 2; names.has(n); k++) n = `${base}.${k}`;
    names.add(n);
    return n;
  };
  const counts = { mesh: 0, box: 0, cyl: 0 };
  let dropped = 0;
  const used = new Set<Slot>();
  src.groups.forEach((g, gi) => {
    const pos: number[] = [];
    const slots: Slot[] = [];
    for (let t = 0; t < src.group.length; t++) {
      if (src.group[t] !== gi) continue;
      for (let k = 0; k < 9; k++) pos.push(src.positions[t * 9 + k]!);
      const slot = colours.of[hexString(src.colours[t]!)];
      if (slot === undefined) throw new ImportError(`colour ${hexString(src.colours[t]!)} of node '${g.node}' is not in the colour map: map the colours of every model in the pack`);
      slots.push(slot);
      used.add(slot);
    }
    const out = groupParts(pos, slots);
    dropped += out.dropped;
    for (const p of out.parts) {
      counts['mesh' in p ? 'mesh' : 'box' in p ? 'box' : 'cyl']++;
      parts.push({ ...p, ...(g.unlit ? { glow: true } : {}), name: unique(g.node) } as Part);
    }
  });
  const kept = colours.slots.filter((s) => used.has(s.slot));
  const base: ModelDef = {
    id: o.id,
    about: o.about ?? `Imported from ${o.source.file ?? o.source.url}${o.source.pack ? ` (${o.source.pack})` : ''}`,
    tags: o.tags ?? ['imported', ...(o.source.pack ? [o.source.pack] : [])],
    palette: Object.fromEntries(kept.map((s) => [s.slot, s.colour])),
    parts,
    source: { ...o.source, tool: IMPORT_TOOL, colours: Object.fromEntries(kept.map((s) => [s.slot, hexString(s.source)])) },
  };
  const fidelity = scoreFidelity(src, modelTriangles(base));
  const def: ModelDef = { ...base, source: { ...base.source!, fidelity: { iou: fidelity.iou, iouClose: fidelity.iouClose, colour: fidelity.colour, bounds: fidelity.bounds } } };
  return { def, source: src, colours, fidelity, report: { triangles: src.group.length, dropped, groups: src.groups.length, parts: counts, colours: new Set(src.colours).size } };
}

/** Import one glTF or GLB file (see the file comment). */
export async function importGltf(bytes: Uint8Array, o: ImportOptions): Promise<Imported> {
  return translateSource(normalizeSource(await readGltf(bytes, o), o), o);
}

export interface PackOptions extends Normalize {
  /** The pack's id: model ids are `<pack>/<file name>`. */
  readonly pack: string;
  readonly source: Omit<ImportSource, 'pack' | 'file'>;
  /** zlib inflate, for PNG textures. */
  readonly inflate?: ReadOptions['inflate'];
}

export interface PackImport {
  readonly models: readonly Imported[];
  /** The one colour map the pack shares, so a colour reads the same in every model. */
  readonly colours: ColourMap;
  /** Files that didn't import, and why. */
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
}

/** Paths in name order, case aside (then exactly, so the order is total). */
const byName = (a: string, b: string) => {
  const [p, q] = [a.toLowerCase(), b.toLowerCase()];
  return p < q ? -1 : p > q ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** `a/b/../c.png` → `a/c.png`. */
function joinPath(dir: string, rel: string): string {
  const out: string[] = [];
  for (const part of `${dir}/${rel}`.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

/** A model id from a file name: `Chair Desk.glb` → `chair-desk`. */
export const fileId = (file: string) =>
  (file.split('/').pop() ?? file)
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'model';

/**
 * Every glTF and GLB in a pack's files (paths → bytes, e.g. an unzipped archive): read them
 * all, map their colours together, then translate each. Files the importer can't read are
 * skipped with the reason.
 */
export async function importPack(files: ReadonlyMap<string, Uint8Array>, o: PackOptions): Promise<PackImport> {
  const sources: { file: string; src: SourceMesh }[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const file of [...files.keys()].filter((f) => /\.(glb|gltf)$/i.test(f)).sort(byName)) {
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const readFile: ReadFile = (uri) => {
      const bytes = files.get(joinPath(dir, uri));
      if (!bytes) throw new Error(`no file '${joinPath(dir, uri)}' in the pack`);
      return bytes;
    };
    try {
      sources.push({ file, src: normalizeSource(await readGltf(files.get(file)!, { readFile, inflate: o.inflate }), o) });
    } catch (e) {
      skipped.push({ file, reason: (e as Error).message });
    }
  }
  const colours = mapColours(sources.flatMap((s) => colourSamples(s.src)), { max: 16 });
  const ids = new Set<string>();
  const models = sources.map(({ file, src }) => {
    let id = `${o.pack}/${fileId(file)}`;
    for (let k = 2; ids.has(id); k++) id = `${o.pack}/${fileId(file)}-${k}`;
    ids.add(id);
    return translateSource(src, { id, source: { ...o.source, pack: o.pack, file }, colours });
  });
  return { models, colours, skipped };
}
