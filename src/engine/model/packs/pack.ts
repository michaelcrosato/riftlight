/**
 * The pack file: one JSON file per pack (`public/packs/<pack>.json`, written by
 * `npm run model -- import-pack`), holding its imported ModelDefs as plain data. Games load it
 * with `loadPack(url)` (src/engine/assets.ts), never import it: the engine kit bundles code only.
 */
import { ModelCatalog } from '../catalog';
import type { ModelDef } from '../types';
import { licenceProblem, PACK_ID } from './licences';
import { PACK_SOURCES, type PackSource } from './sources';

export interface ModelPack {
  readonly pack: string;
  readonly about: string;
  /** Where the pack came from (each model's own `source` says it too). */
  readonly source: { readonly url: string; readonly licence: string; readonly author?: string; readonly sha256?: string; readonly homepage?: string };
  readonly models: readonly ModelDef[];
}

/** Check a pack file's shape (the models' own checks are `validateModel`'s). */
export function parsePack(data: unknown, where = 'pack'): ModelPack {
  const p = data as Partial<ModelPack> | null;
  if (!p || typeof p !== 'object') throw new Error(`${where}: not a pack (a JSON object with pack, source and models)`);
  if (typeof p.pack !== 'string' || !p.pack) throw new Error(`${where}: no \`pack\` id`);
  if (!p.source || typeof p.source.url !== 'string' || typeof p.source.licence !== 'string') throw new Error(`${where}: no \`source\` with url and licence`);
  if (!Array.isArray(p.models)) throw new Error(`${where}: no \`models\` list`);
  p.models.forEach((m, i) => {
    if (!m || typeof m.id !== 'string' || !m.palette || typeof m.palette !== 'object' || !Array.isArray(m.parts)) throw new Error(`${where}: models[${i}] is not a ModelDef (id, palette, parts)`);
  });
  return { pack: p.pack, about: typeof p.about === 'string' ? p.about : '', source: p.source, models: p.models };
}

/**
 * A pack file's own problems, beside each model's (`validateModel`): its id, its licence as a
 * pack (someone else's pack needs its approved `PACK_SOURCES` entry), and models that don't say
 * they come from it (each model's own licence check must see the pack).
 */
export function packProblems(pack: ModelPack, sources: readonly PackSource[] = PACK_SOURCES): string[] {
  const out: string[] = [];
  if (!PACK_ID.test(pack.pack)) out.push(`pack '${pack.pack}': its id must match ${PACK_ID}`);
  const why = licenceProblem({ ...pack.source, pack: pack.pack }, sources);
  if (why) out.push(`pack '${pack.pack}': ${why}`);
  for (const m of pack.models) {
    const from = m.source?.pack;
    if (from !== pack.pack) out.push(`'${m.id}' says it comes from ${from ? `pack '${from}'` : 'no pack'}, not '${pack.pack}': its source.pack must name the pack it is in`);
  }
  return out;
}

/** A pack's models as a catalog of their own. */
export function packCatalog(pack: ModelPack): ModelCatalog {
  return new ModelCatalog(pack.models);
}
