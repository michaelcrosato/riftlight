// Pack files on disk (public/packs/, docs/assets/importing.md *Packs*), shared by `npm run model` and
// `npm run tex`: reading them, writing one file per pack (its models and its textures), the index
// every pack is listed in (public/packs/index.json), and the approved downloads they come from
// (fetched once, checked against the sha256 the owner approved on #49, cached in
// .scratch/import-cache/, never committed).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { isLicenceFile, licenceFileProblem, licenceProblem, packIndexEntry, packSourceProblems, PACK_SOURCES, parsePack, parsePackIndex, type ModelDef, type ModelPack, type PackIndex, type PackSource } from '../src/engine/model';
import { unzip } from '../src/engine/model/import';
import type { TextureDef } from '../src/engine/texture';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Pack files (`loadPack` fetches them) and their index. */
export const PACKS = join(ROOT, 'public/packs');
export const PACK_INDEX = join(PACKS, 'index.json');
/** Where downloads wait (never committed). */
export const CACHE = join(ROOT, '.scratch/import-cache');
export const ESCALATION = 'the licence escalation, #49 (https://github.com/michaelcrosato/riftlight/issues/49)';

const rel = (f: string) => relative(ROOT, f);

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

export function readPack(file: string): ModelPack {
  return parsePack(JSON.parse(readFileSync(file, 'utf8')) as unknown, rel(file));
}

/** Every pack file in public/packs/ (not the index), by name. */
export function packFiles(): string[] {
  return existsSync(PACKS) ? readdirSync(PACKS).filter((f) => f.endsWith('.json') && f !== 'index.json').sort().map((f) => join(PACKS, f)) : [];
}

export function packs(): ModelPack[] {
  return packFiles().map(readPack);
}

/** Every pack's models and textures, for a catalog that spans the library and the packs. */
export const packModels = (): ModelDef[] => packs().flatMap((p) => p.models);
export const packTextureDefs = (): TextureDef[] => packs().flatMap((p) => p.textures ?? []);

/** The index the pack files make: one entry each, in name order. */
export function packIndex(): PackIndex {
  return { packs: packFiles().map((f) => packIndexEntry(readPack(f), basename(f))) };
}

/** Write public/packs/index.json from the pack files there. */
export function writePackIndex(): string {
  mkdirSync(PACKS, { recursive: true });
  writeFileSync(PACK_INDEX, `${JSON.stringify(packIndex(), null, 2)}\n`);
  return PACK_INDEX;
}

/** What is wrong with public/packs/index.json: missing, unreadable, or not what the pack files make. */
export function packIndexProblems(): string[] {
  if (!existsSync(PACK_INDEX)) return [`${rel(PACK_INDEX)} is missing: \`npm run model -- import-pack\` writes it (an empty one is { "packs": [] })`];
  let index: PackIndex;
  try {
    index = parsePackIndex(JSON.parse(readFileSync(PACK_INDEX, 'utf8')) as unknown, rel(PACK_INDEX));
  } catch (e) {
    return [(e as Error).message];
  }
  return JSON.stringify(index) === JSON.stringify(packIndex()) ? [] : [`${rel(PACK_INDEX)} doesn't list the pack files as they are: the importers write it; after a pack file is added, changed or removed by hand, rewrite it with \`npm run model -- pack-index\``];
}

export interface PackWrite {
  readonly models?: readonly ModelDef[];
  readonly textures?: readonly TextureDef[];
  /** Replace the pack's models (or textures) with these instead of adding to them: a whole pack's re-import. */
  readonly replace?: boolean;
}

/**
 * Write models and textures into public/packs/<pack>.json (adding to what it holds, by id, or
 * replacing it) and rewrite the index. `meta` is used for a new file and for a whole re-import.
 */
export function writePack(pack: string, add: PackWrite, meta: { source: ModelPack['source']; about: string; title?: string }): string {
  const file = join(PACKS, `${pack}.json`);
  const had = existsSync(file) ? readPack(file) : null;
  const merge = <T extends { id: string }>(old: readonly T[] | undefined, now: readonly T[] | undefined): T[] => {
    if (!now) return [...(old ?? [])];
    if (add.replace) return [...now];
    const ids = new Set(now.map((d) => d.id));
    return [...(old ?? []).filter((d) => !ids.has(d.id)), ...now];
  };
  const models = merge(had?.models, add.models);
  const textures = merge(had?.textures, add.textures);
  const title = add.replace ? (meta.title ?? had?.title) : (had?.title ?? meta.title);
  const out: ModelPack = {
    pack,
    about: add.replace ? meta.about : had?.about || meta.about,
    ...(title ? { title } : {}),
    source: add.replace ? meta.source : (had?.source ?? meta.source),
    models,
    ...(textures.length ? { textures } : {}),
  };
  mkdirSync(PACKS, { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  writePackIndex();
  return file;
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** An approved pack by id, checked: its entry is well formed and its licence allowed as a pack. */
export function approvedPack(id: string): PackSource {
  const p = PACK_SOURCES.find((s) => s.id === id);
  if (!p) fail(`no approved pack "${id}": src/engine/model/packs/sources.ts lists ${PACK_SOURCES.length ? PACK_SOURCES.map((s) => s.id).join(', ') : 'none'}. A pack joins it only once the repository owner approves its licence with a comment on ${ESCALATION}; an agent never writes or links an approval. Until then, import our own files with \`import\``);
  const malformed = packSourceProblems([p]);
  if (malformed.length) fail(`refused: ${malformed.join('; ')}`);
  const refused = licenceProblem({ url: p.url, licence: p.licence, pack: p.id });
  if (refused) fail(`refused: ${refused}`);
  return p;
}

/** A pack's download: from the cache when its hash matches, else fetched and checked. */
export async function download(p: PackSource): Promise<Uint8Array> {
  const cached = join(CACHE, `${p.id}-${p.sha256.slice(0, 12)}${extname(new URL(p.url).pathname) || '.bin'}`);
  if (existsSync(cached)) {
    const bytes = new Uint8Array(readFileSync(cached));
    if (sha256(bytes) === p.sha256) return bytes;
  }
  console.error(`downloading ${p.url}`);
  const res = await fetch(p.url);
  if (!res.ok) fail(`download of ${p.url} failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = sha256(bytes);
  if (got !== p.sha256) fail(`refused: ${p.url} has sha256 ${got}, not the approved ${p.sha256}. The download changed; check it and its licence again, then the owner approves the new hash on ${ESCALATION}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, bytes);
  return bytes;
}

/** An approved pack's files (unzipped), once its licence files show its licence (docs/assets/importing.md *Packs*). */
export async function packDownload(p: PackSource): Promise<Map<string, Uint8Array>> {
  const bytes = await download(p);
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const files = zipped ? unzip(bytes, (b) => new Uint8Array(inflateRawSync(b))) : new Map([[basename(new URL(p.url).pathname), bytes]]);
  const licenceFiles = [...files].filter(([name]) => isLicenceFile(name)).map(([name, b]) => ({ name, text: new TextDecoder().decode(b) }));
  const unlicensed = licenceFileProblem(p.licence, licenceFiles);
  if (unlicensed) fail(`refused: ${unlicensed}: check the pack and ${ESCALATION}`);
  return files;
}

/** The `source` a pack file records for its pack. */
export const packSource = (p: PackSource): ModelPack['source'] => ({ url: p.url, licence: p.licence, author: p.author, sha256: p.sha256, homepage: p.homepage });
