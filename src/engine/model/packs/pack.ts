/**
 * The pack file: one JSON file per pack (`public/packs/<pack>.json`, written by
 * `npm run model -- import-pack` and `npm run tex -- import-pack`), holding its imported ModelDefs
 * and TextureDefs as plain data. Games load it with `loadPack(url)` (src/engine/assets.ts), never
 * import it: the engine kit bundles code only. `public/packs/index.json` lists every pack
 * (`PackIndex`, `loadPackIndex`), so a game or a tool can find them without knowing their names.
 */
import { TextureCatalog } from '../../texture/catalog';
import type { TextureDef } from '../../texture/types';
import { ModelCatalog } from '../catalog';
import type { ModelDef } from '../types';
import { licenceProblem, PACK_ID } from './licences';
import { PACK_SOURCES, type PackSource } from './sources';

export interface ModelPack {
  readonly pack: string;
  readonly about: string;
  /** The pack's name as people know it ("Kenney Nature Kit 2.1"). */
  readonly title?: string;
  /** Where the pack came from (each model's own `source` says it too). */
  readonly source: { readonly url: string; readonly licence: string; readonly author?: string; readonly sha256?: string; readonly homepage?: string };
  readonly models: readonly ModelDef[];
  /** Textures sliced from the pack's pixel-art sheets (`npm run tex -- import-pack`). */
  readonly textures?: readonly TextureDef[];
}

/** One line of `public/packs/index.json`: a pack, what it holds and where it came from. */
export interface PackIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly about: string;
  /** The pack file, relative to the index ("kenney-nature.json"). */
  readonly file: string;
  readonly models: number;
  readonly textures: number;
  readonly licence: string;
  readonly author?: string;
  readonly homepage?: string;
  readonly url: string;
}

export interface PackIndex {
  readonly packs: readonly PackIndexEntry[];
}

/** Check a pack file's shape (the models' and textures' own checks are `validateModel`'s and `validateTexture`'s). */
export function parsePack(data: unknown, where = 'pack'): ModelPack {
  const p = data as Partial<ModelPack> | null;
  if (!p || typeof p !== 'object') throw new Error(`${where}: not a pack (a JSON object with pack, source and models)`);
  if (typeof p.pack !== 'string' || !p.pack) throw new Error(`${where}: no \`pack\` id`);
  if (!p.source || typeof p.source.url !== 'string' || typeof p.source.licence !== 'string') throw new Error(`${where}: no \`source\` with url and licence`);
  if (!Array.isArray(p.models)) throw new Error(`${where}: no \`models\` list`);
  p.models.forEach((m, i) => {
    if (!m || typeof m.id !== 'string' || !m.palette || typeof m.palette !== 'object' || !Array.isArray(m.parts)) throw new Error(`${where}: models[${i}] is not a ModelDef (id, palette, parts)`);
  });
  if (p.textures !== undefined && !Array.isArray(p.textures)) throw new Error(`${where}: \`textures\` is not a list`);
  (p.textures ?? []).forEach((t, i) => {
    if (!t || typeof t.id !== 'string' || !t.palette || typeof t.palette !== 'object' || !Array.isArray(t.layers) || !Array.isArray(t.size)) throw new Error(`${where}: textures[${i}] is not a TextureDef (id, size, palette, layers)`);
  });
  return {
    pack: p.pack,
    about: typeof p.about === 'string' ? p.about : '',
    ...(typeof p.title === 'string' ? { title: p.title } : {}),
    source: p.source,
    models: p.models,
    ...(p.textures?.length ? { textures: p.textures } : {}),
  };
}

/** Check `public/packs/index.json`'s shape. */
export function parsePackIndex(data: unknown, where = 'pack index'): PackIndex {
  const x = data as Partial<PackIndex> | null;
  if (!x || typeof x !== 'object' || !Array.isArray(x.packs)) throw new Error(`${where}: not a pack index (a JSON object with a \`packs\` list)`);
  x.packs.forEach((e, i) => {
    if (!e || typeof e.id !== 'string' || typeof e.file !== 'string') throw new Error(`${where}: packs[${i}] has no id and file`);
  });
  return { packs: x.packs };
}

/** A pack's line in the index. */
export function packIndexEntry(pack: ModelPack, file = `${pack.pack}.json`): PackIndexEntry {
  return {
    id: pack.pack,
    title: pack.title ?? pack.pack,
    about: pack.about,
    file,
    models: pack.models.length,
    textures: pack.textures?.length ?? 0,
    licence: pack.source.licence,
    ...(pack.source.author ? { author: pack.source.author } : {}),
    ...(pack.source.homepage ? { homepage: pack.source.homepage } : {}),
    url: pack.source.url,
  };
}

/**
 * A pack file's own problems, beside each model's (`validateModel`) and texture's
 * (`validateTexture`): its id, its licence as a pack (someone else's pack needs its approved
 * `PACK_SOURCES` entry), and models or textures that don't say they come from it (each one's
 * own licence check must see the pack).
 */
export function packProblems(pack: ModelPack, sources: readonly PackSource[] = PACK_SOURCES): string[] {
  const out: string[] = [];
  if (!PACK_ID.test(pack.pack)) out.push(`pack '${pack.pack}': its id must match ${PACK_ID}`);
  const why = licenceProblem({ ...pack.source, pack: pack.pack }, sources);
  if (why) out.push(`pack '${pack.pack}': ${why}`);
  for (const m of [...pack.models, ...(pack.textures ?? [])]) {
    const from = m.source?.pack;
    if (from !== pack.pack) out.push(`'${m.id}' says it comes from ${from ? `pack '${from}'` : 'no pack'}, not '${pack.pack}': its source.pack must name the pack it is in`);
  }
  return out;
}

/** A pack's models as a catalog of their own. */
export function packCatalog(pack: ModelPack): ModelCatalog {
  return new ModelCatalog(pack.models);
}

/** A pack's textures as a catalog of their own (empty for a pack of models only). */
export function packTextures(pack: ModelPack): TextureCatalog {
  return new TextureCatalog(pack.textures ?? []);
}
