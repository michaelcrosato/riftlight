// The kit's LIBRARY.md, library.json and CREDITS.md (scripts/bundle.mjs loads this module through
// tsx): what the built-in model and texture libraries and the imported packs (public/packs/) hold,
// and where everything the kit carries came from. Generated from the same data
// `npm run model -- find` and `npm run model -- credits` read: the defs themselves and each one's
// `source`.
import { buildModel, MODEL_FAMILIES, MODEL_LIBRARY, ModelCatalog, OWN_LICENCE, type ModelDef } from '../../src/engine/model';
import { groupVariants } from '../../src/engine/catalog';
import { creditEntries, creditLine } from '../../src/engine/model/packs/credits';
import { TEXTURE_FAMILIES, TEXTURE_LIBRARY, type TextureDef } from '../../src/engine/texture';
import { packIndex, packs } from '../packs';

const fmt = (v: number) => `${+v.toFixed(2)}`;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** One record per asset in library.json: what an agent searches and filters on. */
export interface LibraryRecord {
  readonly id: string;
  readonly kind: 'model' | 'texture';
  /** The library family (`MODEL_FAMILIES`, `TEXTURE_FAMILIES`), or the pack's id. */
  readonly family: string;
  /** The pack file to `loadPack`, or null for the built-in library (in pixel-engine.js). */
  readonly pack: string | null;
  readonly about: string;
  readonly tags: readonly string[];
  /** Models: metres, w × h × d. Textures: texels, w × h (all frames). */
  readonly size: readonly number[];
  readonly tris?: number;
  readonly params?: Readonly<Record<string, readonly number[]>>;
  readonly slots: Readonly<Record<string, unknown>>;
  readonly tile?: boolean;
  readonly frames?: number;
  readonly licence: string;
  readonly author?: string;
}

/** Every asset, the library first (family by family), then each pack: the rows of both files. */
export function libraryRecords(): LibraryRecord[] {
  const own = { licence: OWN_LICENCE };
  const model = (d: ModelDef, family: string, pack: string | null, catalog: ModelCatalog): LibraryRecord => {
    const b = buildModel(d, { catalog });
    return { id: d.id, kind: 'model', family, pack, about: d.about, tags: d.tags, size: b.bounds.size.map((v) => +v.toFixed(2)), tris: b.report.tris, ...(d.params ? { params: d.params } : {}), slots: d.palette, licence: (d.source ?? own).licence, ...(d.source?.author ? { author: d.source.author } : {}) };
  };
  const texture = (d: TextureDef, family: string, pack: string | null): LibraryRecord => ({ id: d.id, kind: 'texture', family, pack, about: d.about, tags: d.tags, size: [...d.size], slots: d.palette, ...(d.tile ? { tile: true } : {}), ...(d.frames && d.frames > 1 ? { frames: d.frames } : {}), licence: (d.source ?? own).licence, ...(d.source?.author ? { author: d.source.author } : {}) });
  const out: LibraryRecord[] = [];
  for (const [family, ids] of Object.entries(MODEL_FAMILIES)) for (const id of ids) out.push(model(MODEL_LIBRARY.get(id), family, null, MODEL_LIBRARY));
  for (const [family, ids] of Object.entries(TEXTURE_FAMILIES)) for (const id of ids) out.push(texture(TEXTURE_LIBRARY.get(id), family, null));
  for (const p of packs()) {
    const catalog = new ModelCatalog([...MODEL_LIBRARY.all(), ...p.models]);
    for (const d of p.models) out.push(model(d, p.pack, `packs/${p.pack}.json`, catalog));
    for (const d of p.textures ?? []) out.push(texture(d, p.pack, `packs/${p.pack}.json`));
  }
  return out;
}

/**
 * library.json: every asset as data (`LibraryRecord`), and the packs with their files. One record
 * a line, so a grep for a word returns whole records.
 */
export function libraryJson(version: string, records = libraryRecords()): string {
  const about =
    'Every model and texture the kit carries: the built-in library (MODEL_LIBRARY, TEXTURE_LIBRARY, in pixel-engine.js) and the imported packs (packs/<id>.json, load with loadPack). ' +
    'Filter on kind, family, pack and tags; search id, about and tags. Place a library model with buildModel(id); a pack model with buildModel(id, { catalog: await loadPack(pack) }).';
  const packs = packIndex().packs.map((e) => ({ ...e, file: `packs/${e.file}` }));
  const list = (xs: readonly unknown[]) => (xs.length ? `[\n${xs.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n ]` : '[]');
  return `{\n "engine": ${JSON.stringify(version)},\n "about": ${JSON.stringify(about)},\n "packs": ${list(packs)},\n "assets": ${list(records)}\n}\n`;
}

/**
 * LIBRARY.md: every model and texture by family, then each pack; one table row each, except that
 * a model's variants (`rock-large-a` … `-f`, `groupVariants`) share one: every id, the range of
 * their sizes, the slots and tags any of them use, the first's about. A sheet's lettered tiles
 * are pieces of a set (`forest-a` … `-i`), not variants: they keep a row each.
 */
export function libraryMarkdown(version: string, records = libraryRecords()): string {
  const slots = (rs: readonly LibraryRecord[]) => {
    const seen = new Map<string, string>();
    for (const r of rs) for (const [s, c] of Object.entries(r.slots)) if (!seen.has(s)) seen.set(s, String(c));
    return [...seen].map(([s, c]) => `${s} ${c}`).join(', ');
  };
  const tags = (rs: readonly LibraryRecord[]) => [...new Set(rs.flatMap((r) => r.tags))].join(', ');
  const span = (rs: readonly LibraryRecord[], axis: number) => {
    const vs = rs.map((r) => r.size[axis]!);
    const [lo, hi] = [Math.min(...vs), Math.max(...vs)];
    return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  };
  const modelRows = (records: readonly LibraryRecord[]) =>
    groupVariants(records).map(({ def: r, variants }) => {
      const rs = [r, ...variants];
      const params = Object.entries(r.params ?? {}).map(([k, [v, lo, hi]]) => `${k} ${v} (${lo}–${hi})`).join(', ');
      return `| ${rs.map((x) => `\`${x.id}\``).join(' ')} | ${[0, 1, 2].map((a) => span(rs, a)).join(' × ')} | ${params} | ${slots(rs)} | ${tags(rs)} | ${cell(r.about)}${variants.length ? ` (+${variants.length} variant${variants.length > 1 ? 's' : ''})` : ''} |`;
    });
  const textureRows = (records: readonly LibraryRecord[]) =>
    records.map((r) => {
      const kind = [r.tile ? 'tiles' : '', r.frames ? `${r.frames} frames` : ''].filter(Boolean).join(', ');
      return `| \`${r.id}\` | ${r.size[0]} × ${r.size[1]}${kind ? `, ${kind}` : ''} | ${slots([r])} | ${r.tags.join(', ')} | ${cell(r.about)} |`;
    });
  const MODEL_HEAD = ['| id | size (m, w × h × d) | params: default (min–max) | palette slots | tags | about |', '| --- | --- | --- | --- | --- | --- |'];
  const TEXTURE_HEAD = ['| id | texels | palette slots | tags | about |', '| --- | --- | --- | --- | --- |'];
  const lib = records.filter((r) => !r.pack);
  const section = (kind: LibraryRecord['kind'], head: string[], rows: (rs: readonly LibraryRecord[]) => string[]) =>
    [...new Set(lib.filter((r) => r.kind === kind).map((r) => r.family))].flatMap((family) => {
      const of = lib.filter((r) => r.kind === kind && r.family === family);
      return [`### ${family} (${of.length})`, '', ...head, ...rows(of), ''];
    });
  const packLines = packIndex().packs.flatMap((e) => {
    // the section names the pack: its rows leave out what says so again (library.json keeps it)
    const rows = records.filter((r) => r.pack === `packs/${e.file}`).map((r) => ({ ...r, about: r.about.replace(/ \(imported from [^)]*\)$/, ''), tags: r.tags.filter((t) => t !== 'imported' && t !== e.id) }));
    const models = rows.filter((r) => r.kind === 'model');
    const textures = rows.filter((r) => r.kind === 'texture');
    return [
      `### ${e.id}: ${e.title}`,
      '',
      `${e.models} models, ${e.textures} textures, ${e.licence} by ${e.author ?? 'unknown'} (${e.homepage ?? e.url}). Load it: \`const kit = await loadPack('packs/${e.file}'${textures.length ? ', { textures: TEXTURE_LIBRARY }' : ''})\`, then \`buildModel(id, { catalog: kit })\`${textures.length ? ' and `hudSprite(id)` / `textureMap(id)`' : ''}.`,
      '',
      ...(models.length ? [...MODEL_HEAD, ...modelRows(models), ''] : []),
      ...(textures.length ? [...TEXTURE_HEAD, ...textureRows(textures), ''] : []),
    ];
  });
  const count = (kind: LibraryRecord['kind'], pack: boolean) => records.filter((r) => r.kind === kind && !!r.pack === pack).length;
  return `${[
    `# The library (Pixel Engine ${version})`,
    '',
    `Every built-in model (\`MODEL_LIBRARY\`, ${count('model', false)}) and texture (\`TEXTURE_LIBRARY\`, ${count('texture', false)}) by family, then every imported pack (${count('model', true)} models, ${count('texture', true)} textures in \`packs/\`), generated from the defs. A model's variants (\`rock-large-a\` … \`-f\`) share a row. Search it; don't read it whole.`,
    '',
    '- **Find:** grep this file, filter `library.json` (one record per asset: id, kind, family, pack, tags, size, licence), or search in code: `MODEL_LIBRARY.search(\'wooden chair\')`, `TEXTURE_LIBRARY.search(\'stone floor\')` (ranked: id words, then tags, then about; plurals and parts of words count).',
    '- **Place:** `buildModel(id, { params, palette })`, or `use` it inside your own models; textures with `textureMap(id)`, `spriteSheet(id)`, `hudSprite(id)`. Look at it first: `node check.mjs --sheets <id>` (ASSETS.md).',
    "- **Packs** are someone else's work, imported into this format and palette: each section says how to load it, and CREDITS.md what its licence asks. Its rows leave out the pack's name and tags, which library.json keeps.",
    '',
    '## Models',
    '',
    ...section('model', MODEL_HEAD, modelRows),
    '## Textures',
    '',
    ...section('texture', TEXTURE_HEAD, textureRows),
    '## Packs',
    '',
    ...(packLines.length ? packLines : ['No imported packs in this kit.']),
  ].join('\n').trimEnd()}\n`;
}

/** A bundled package: its name, version, licence and url, and its licence file's text. */
export interface CodeCredit {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly url: string;
  readonly text: string;
}

/**
 * Palettes the engine carries that someone else made (src/engine/palette.ts, the filters in
 * src/engine/render/filters.ts): credited as their sources name them, with no licence claimed.
 */
const PALETTE_CREDITS = [
  { name: 'Sweetie 16', by: 'GrafxKid', where: "the engine's 16 colours (`PALETTE`) and the `sweetie16` filter" },
  { name: 'PICO-8', by: 'Lexaloffle Games (the PICO-8 fantasy console)', where: 'the `pico8` filter' },
];

/**
 * CREDITS.md: the models and textures (`creditEntries`, as `model -- credits`: the library's and
 * every pack's in packs/), the built-in GLBs, the palettes and the bundled code with its licence texts.
 */
export function creditsMarkdown(o: { version: string; builtins: readonly string[]; code: readonly CodeCredit[] }): string {
  const models = MODEL_LIBRARY.all();
  const textures = TEXTURE_LIBRARY.all();
  const own = (defs: readonly { source?: { licence: string } }[]) => defs.filter((d) => !d.source || d.source.licence === OWN_LICENCE).length;
  // the packs' models and textures (packs/, each with its `source`) are credited with the library's imports
  const all = packs();
  const imported = creditEntries([...models, ...all.flatMap((p) => p.models)], [...textures, ...all.flatMap((p) => p.textures ?? [])]).filter((e) => e.licence !== OWN_LICENCE);
  return `${[
    `# Credits (Pixel Engine ${o.version})`,
    '',
    'What this kit carries and where it came from, generated by `npm run bundle` from each built-in model\'s and texture\'s `source` ' +
      '(the data the engine repository\'s `npm run model -- credits` reads) and from the bundled packages\' own licence files. ' +
      'Ship this file with a game built on the kit.',
    '',
    '## Models and textures',
    '',
    `- **The engine's own work**, made in its repository: ${own(models)} of the ${models.length} library models (\`MODEL_LIBRARY\`), ` +
      `${own(textures)} of the ${textures.length} textures (\`TEXTURE_LIBRARY\`) and the built-in models (${o.builtins.map((b) => `\`${b}\``).join(', ')}). Nothing to credit.`,
    ...(imported.length ? imported.map(creditLine) : ['- **Imported from anyone else:** nothing.']),
    "- **Your own imports** carry a `source` too (url, licence, author): credit them as their licence asks. A pack loaded with `loadPack` carries its models' and textures' `source`s.",
    '',
    '## Palettes',
    '',
    ...PALETTE_CREDITS.map((p) => `- **${p.name}** by ${p.by}: ${p.where}.`),
    '',
    '## Code',
    '',
    ...o.code.map((c) => `- **${c.name}** ${c.version}, ${c.licence}: ${c.url}. Its licence follows.`),
    ...o.code.flatMap((c) => ['', `### ${c.name} licence`, '', '```text', c.text.trimEnd(), '```']),
  ].join('\n')}\n`;
}
