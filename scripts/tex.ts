// Texture workbench: how agents check, look at and find textures (TextureDefs, docs/ASSETS.md)
// without a browser. Run through tsx:  npm run tex -- <command> [...]
//
//   check [id...]        problems (exit 1) and warnings for every texture; a table of size,
//                        colours, single texels and the seam
//   sheet <id>           PNG → .scratch/tex/<id>.png: the texture at 1× and enlarged, a 3×3
//                        tiling when it tiles, its frames, palette and check
//        --palette slot=colour,...   (a PALETTE name or 0xrrggbb)
//   find [words|tags...] the catalog: id, size, tiles, frames, file (no words: all)
//   zoo [tag|all]        every texture (or those with the tag) at one scale, tiled 3×3 where it tiles
//                        → .scratch/tex/zoo-<name>.png
//
// Import (docs/ASSETS.md *Importing*; third-party content waits on the licence escalation, #49):
//   import <sheet.png> --grid 16x16 --licence <spdx> --source <url> [--as <prefix>] [--author a]
//        [--pack p] [--tile] [--frames] [--cells 0-3,8] [--names grass,,water] [--alpha 128]
//        [--palette slot=colour,...]
//                        a pixel-art sheet sliced on the grid → a draft, <out>/import/<prefix>.ts,
//                        one def per cell (<prefix>-<index>, or <prefix>-<name> by reading-order
//                        index; fully transparent cells skipped) or, with --frames, one def of
//                        frames (blank cells at either end dropped). Colours map to PALETTE once
//                        for the whole sheet; each source colour keeps a legend character. Prints
//                        and draws (<out>/import/<prefix>.png: source | mapped, every colour →
//                        slot → entry) the merges: source colours that bake as one entry. Alpha
//                        under --alpha is transparent; --palette re-binds slots in every def.
//                        Refuses what the checks refuse: our own work (LicenseRef-own, its
//                        --source a path in this repo) is allowed; anyone else's, CC0 included,
//                        only from a pack (--pack) whose PACK_SOURCES entry is approved
//
// An <id> can also be a draft file: `check my/wall.ts` (every def it exports), `sheet my/wall.ts`
// (its default export, or the first) or `sheet my/wall.ts wall-3` (that one). Options for every
// command: --json, --out <dir> (default .scratch/tex).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import type { SheetImage } from '../src/engine/animation/raster';
import { licenceProblem, PACK_ID } from '../src/engine/model/packs/licences';
import { fileId, hexString, IMPORT_ID, ImportError } from '../src/engine/model/import';
import { isPaletteName, type PaletteColor } from '../src/engine/palette';
import { decodePng, PngError } from '../src/engine/png';
import { bakeTexture, importSheet, TEXTURE_LIBRARY, TextureCatalog, validateTexture, type SheetImport, type TextureDef } from '../src/engine/texture';
import { renderImportSheet, renderTextureSheet, texelImage, tiled } from '../src/engine/texture/sheet';
import { column, row, textBox, titleBar } from '../src/engine/inspect/render';
import { upscale } from '../src/engine/model/sheet';
import { encodePng } from './png';
import { textureDefsSource } from './ts-value';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = 'src/engine/texture/library';
const argv = process.argv.slice(2);

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const VALUED = ['palette', 'out', 'grid', 'as', 'licence', 'source', 'author', 'pack', 'cells', 'names', 'alpha'];
const SWITCHES = ['json', 'tile', 'frames'];
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (!a.startsWith('--')) {
    args.push(a);
    continue;
  }
  const k = a.slice(2);
  if (SWITCHES.includes(k)) flags.set(k, true);
  else if (VALUED.includes(k)) {
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) fail(`--${k} needs a value`);
    flags.set(k, v);
  } else fail(`unknown option --${k} (options: ${[...VALUED, ...SWITCHES].map((o) => `--${o}`).join(' ')})`);
}
const json = flags.has('json');
const OUT = resolve(ROOT, String(flags.get('out') ?? '.scratch/tex'));
const rel = (f: string) => relative(ROOT, f);

function write(name: string, img: SheetImage): string {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name.replace(/[^\w.-]+/g, '_'));
  writeFileSync(file, encodePng(img));
  return file;
}

function palette(): Record<string, PaletteColor | number> | undefined {
  const p = flags.get('palette');
  if (typeof p !== 'string') return undefined;
  const out: Record<string, PaletteColor | number> = {};
  for (const pair of p.split(',')) {
    const [slot, colour] = pair.split('=');
    if (!slot || !colour) fail(`--palette takes slot=colour pairs (got "${pair}")`);
    if (/^0x[0-9a-f]{6}$/i.test(colour)) out[slot] = Number(colour);
    else if (isPaletteName(colour)) out[slot] = colour;
    else fail(`--palette ${slot}=${colour}: use a PALETTE name or 0xrrggbb`);
  }
  return out;
}

/** Where each library texture is written: id → file. */
function sourceFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(join(ROOT, SOURCES)).filter((n) => n.endsWith('.ts') && n !== 'index.ts')) {
    const text = readFileSync(join(ROOT, SOURCES, f), 'utf8');
    for (const m of text.matchAll(/id:\s*'([^']+)'/g)) out.set(m[1]!, join(SOURCES, f));
  }
  return out;
}

const isDef = (v: unknown): v is TextureDef => typeof v === 'object' && v !== null && 'layers' in v && 'size' in v && 'id' in v;

/** Defs named by an id or a draft file's exports (its default export first). */
async function targets(target: string): Promise<{ defs: TextureDef[]; file: string | null }> {
  if (!/\.[cm]?ts$/.test(target)) {
    if (!TEXTURE_LIBRARY.has(target)) fail(`no texture "${target}" (npm run tex -- find lists them)`);
    return { defs: [TEXTURE_LIBRARY.get(target)], file: null };
  }
  const file = resolve(target);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const defs = [mod.default, ...Object.entries(mod).filter(([k]) => k !== 'default').map(([, v]) => v)].filter(isDef);
  if (!defs.length) fail(`${target} exports no TextureDef`);
  return { defs: [...new Set(defs)], file };
}

async function check(): Promise<void> {
  const defs = args.length ? (await Promise.all(args.map(targets))).flatMap((t) => t.defs) : TEXTURE_LIBRARY.all();
  const results = defs.map((d) => validateTexture(d));
  if (json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(`${'texture'.padEnd(16)} ${'size'.padEnd(8)} cols  single  seam        status`);
    for (const r of results) {
      const m = r.metrics;
      const status = r.problems.length ? `${r.problems.length} problem(s)` : r.warnings.length ? `${r.warnings.length} warning(s)` : 'ok';
      console.log(`${r.id.padEnd(16)} ${(m ? `${m.width}x${m.height}` : '-').padEnd(8)} ${String(m?.colours ?? '-').padStart(4)}  ${(m ? `${Math.round(m.isolated * 100)}%` : '-').padStart(6)}  ${(m?.seam ? `${Math.round(m.seam.wrap * 100)}/${Math.round(m.seam.inside * 100)}%` : '-').padEnd(10)}  ${status}`);
      for (const p of r.problems) console.log(`  x ${p}`);
      for (const w of r.warnings) console.log(`  ! ${w}`);
    }
    console.log(`\n${results.length} texture(s), ${results.filter((r) => r.problems.length).length} with problems, ${results.filter((r) => r.warnings.length).length} with warnings`);
  }
  if (results.some((r) => r.problems.length)) process.exit(1);
}

async function sheet(): Promise<void> {
  const target = args[0] ?? fail('usage: npm run tex -- sheet <id|file.ts> [id]');
  const { defs, file } = await targets(target);
  const def = args[1] ? (defs.find((d) => d.id === args[1]) ?? fail(`${target} has no texture "${args[1]}" (it has ${defs.map((d) => d.id).join(', ')})`)) : defs[0]!;
  const p = palette();
  const b = bakeTexture(def, p ? { palette: p } : {});
  const checked = validateTexture(def);
  // the re-bound bake's own problems too (a slot the palette lacks): the converters would refuse it
  const r = { ...checked, problems: [...new Set([...checked.problems, ...b.problems])] };
  const out = write(`${file ? `${basename(file).replace(/\.[cm]?ts$/, '')}-` : ''}${def.id}.png`, renderTextureSheet(def, b, r, p));
  if (json) console.log(JSON.stringify({ id: def.id, png: rel(out), problems: r.problems, warnings: r.warnings, metrics: r.metrics }));
  else {
    for (const x of r.problems) console.log(`  x ${x}`);
    for (const x of r.warnings) console.log(`  ! ${x}`);
    console.log(`  wrote ${rel(out)}`);
  }
  if (r.problems.length) process.exit(1);
}

function find(): void {
  const catalog = new TextureCatalog(TEXTURE_LIBRARY.all());
  const tags = args.filter((w) => catalog.all().some((d) => d.tags.includes(w)));
  const text = args.filter((w) => !tags.includes(w)).join(' ');
  const files = sourceFiles();
  const rows = catalog.find({ tags, text }).map((d) => ({ id: d.id, about: d.about, tags: d.tags, size: d.size, tile: d.tile === true, frames: d.frames ?? 1, file: files.get(d.id) ?? null }));
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const r of rows) {
      console.log(`${r.id}  ${r.size.join('x')}${r.tile ? '  tiles' : ''}${r.frames > 1 ? `  ${r.frames} frames` : ''}  ${r.file ?? ''}`);
      console.log(`  ${r.about}  [${r.tags.join(', ')}]`);
    }
    console.log(`\n${rows.length} texture(s)`);
  }
}

function zoo(): void {
  const name = args[0] ?? 'all';
  const defs = TEXTURE_LIBRARY.all().filter((d) => name === 'all' || d.tags.includes(name));
  if (!defs.length) fail(`no textures tagged "${name}"`);
  const cells = defs.map((d) => {
    const b = bakeTexture(d);
    const img = upscale(d.tile ? tiled(texelImage(b), 3, 3) : texelImage(b), 3);
    return column([img, textBox([{ text: d.id }], Math.max(img.width, 90))]);
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 6) rows.push(row(cells.slice(i, i + 6)));
  const body = column(rows);
  const out = write(`zoo-${name}.png`, column([titleBar(`zoo: ${name}`, body.width, `${defs.length} textures, tiled 3x3 where they tile, x3`), body]));
  console.log(json ? JSON.stringify({ png: rel(out), textures: defs.map((d) => d.id) }) : `  wrote ${rel(out)}`);
}

// ---------------------------------------------------------------- import

/** The draft an import writes: every def as source, which check and sheet take as a file. */
function draftSource(r: SheetImport, file: string, sheetPng: string, grid: readonly [number, number]): string {
  let lib = relative(dirname(file), join(ROOT, 'src/engine/texture')).split(sep).join('/');
  if (!lib.startsWith('.')) lib = `./${lib}`;
  const s = r.defs[0]!.source!;
  const merged = new Set(r.merges.flatMap((m) => m.sources.map((c) => c.hex)));
  return [
    `// Imported by \`npm run tex -- import\` from ${s.file ?? s.url} (${s.licence}, ${s.url}): ${r.columns} x ${r.rows} cells of ${grid.join(' x ')}, ${r.defs.length} def(s).`,
    `// Check: npm run tex -- check ${rel(file)}   Look: ${rel(sheetPng)}, npm run tex -- sheet ${rel(file)} ${r.defs[0]!.id}`,
    `// Each source colour has a legend character; \`legend\` maps it to a slot, \`palette\` binds the slot to a PALETTE entry.`,
    `// A slot reads wrong? Re-bind it in \`palette\` (or re-import with --palette ${r.colours[0]!.slot}=<colour> for every def).`,
    `// Two colours merged that shouldn't be? Point one's character at a new slot in \`legend\` and bind that slot in \`palette\`.`,
    ...r.colours.map((c) => `//   '${c.char}' ${hexString(c.hex)} -> ${c.slot} ${c.colour} (${c.pixels} px)${merged.has(c.hex) ? '  merged' : ''}`),
    textureDefsSource(r.defs, lib),
  ].join('\n');
}

/** `0-3,8` → [0, 1, 2, 3, 8]. */
function cellList(v: string): number[] {
  const out: number[] = [];
  for (const part of v.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) fail(`--cells takes indices and ranges, e.g. 0-3,8 (got "${part}")`);
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (b < a) fail(`--cells range ${part} runs backwards`);
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

async function cmdImport(): Promise<void> {
  const target = args[0] ?? fail('usage: npm run tex -- import <sheet.png> --grid 16x16 --licence <spdx> --source <url> [--as <prefix>]');
  const need = (k: string, what: string) => (flags.get(k) as string | undefined) ?? fail(`import needs --${k} <${what}> (npm run tex -- help)`);
  const g = /^(\d+)x(\d+)$/.exec(need('grid', 'WxH'));
  if (!g) fail(`--grid takes a cell size in pixels, e.g. 16x16 (got "${flags.get('grid')}")`);
  const grid = [Number(g[1]), Number(g[2])] as const;
  const licence = need('licence', 'spdx');
  const url = need('source', 'url');
  const file = resolve(target);
  if (!existsSync(file)) fail(`no file "${target}"`);
  const as = (flags.get('as') as string | undefined) ?? fileId(file);
  if (!IMPORT_ID.test(as)) fail(`--as takes an id like tiles or kit/tiles (${IMPORT_ID}): it names files (got "${as}")`);
  const pack = flags.get('pack') as string | undefined;
  if (pack !== undefined && !PACK_ID.test(pack)) fail(`--pack takes an id like kit (${PACK_ID}) (got "${pack}")`);
  const bytes = new Uint8Array(readFileSync(file));
  const source = { url, licence, ...(pack ? { pack } : {}), file: basename(file), ...(flags.has('author') ? { author: String(flags.get('author')) } : {}), sha256: createHash('sha256').update(bytes).digest('hex') };
  const refused = licenceProblem(source);
  if (refused) fail(`refused: ${refused}`);
  const rebind = palette();
  for (const [slot, c] of Object.entries(rebind ?? {})) if (typeof c !== 'string') fail(`import --palette binds slots to PALETTE names, not hex (${slot}=${hexString(c)})`);
  const alpha = flags.has('alpha') ? Number(flags.get('alpha')) : undefined;
  let img: ReturnType<typeof decodePng>;
  let r: SheetImport;
  try {
    img = decodePng(bytes, (b) => new Uint8Array(inflateSync(b)));
    r = importSheet(img, {
      as,
      grid,
      source,
      tile: flags.has('tile'),
      frames: flags.has('frames'),
      ...(flags.has('cells') ? { cells: cellList(String(flags.get('cells'))) } : {}),
      ...(flags.has('names') ? { names: String(flags.get('names')).split(',') } : {}),
      ...(alpha !== undefined ? { alpha } : {}),
      ...(rebind ? { palette: rebind as Record<string, PaletteColor> } : {}),
    });
  } catch (e) {
    if (e instanceof ImportError || e instanceof PngError) fail(`import ${target}: ${e.message}`);
    throw e;
  }
  const checks = r.defs.map((d) => validateTexture(d));
  const dir = join(OUT, 'import');
  mkdirSync(dir, { recursive: true });
  const name = as.replace(/[^\w.-]+/g, '_'); // kit/tiles → kit_tiles: every file stays in <out>/import
  const draft = join(dir, `${name}.ts`);
  const png = join(dir, `${name}.png`);
  writeFileSync(draft, draftSource(r, draft, png, grid));
  const skipped = r.cells.filter((c) => c.id === null && !c.opaque).map((c) => c.index);
  const subtitle = `${source.file}  ${licence}  ${r.columns} x ${r.rows} cells of ${grid.join(' x ')}  ${r.defs.length} def(s)${flags.has('frames') ? ` (${r.defs[0]!.frames} frames)` : ''}  ${skipped.length} transparent  ${r.colours.length} colours -> ${new Set(r.colours.map((c) => c.slot)).size} slots  ${r.merges.length} merge(s)`;
  writeFileSync(png, encodePng(renderImportSheet(img, r, { title: `${as}: import`, subtitle, grid, checks })));
  const merges = r.merges.map((m) => ({ colour: m.colour, sources: m.sources.map((c) => ({ hex: hexString(c.hex), char: c.char, slot: c.slot, pixels: c.pixels })) }));
  if (json) {
    const colours = r.colours.map((c) => ({ ...c, hex: hexString(c.hex) }));
    console.log(JSON.stringify({ prefix: as, draft: rel(draft), sheet: rel(png), defs: r.defs.map((d) => d.id), cells: r.cells, colours, merges, problems: checks.flatMap((c) => c.problems.map((p) => `${c.id}: ${p}`)), warnings: checks.flatMap((c) => c.warnings.map((w) => `${c.id}: ${w}`)) }, null, 2));
  } else {
    console.log(`${as}: ${r.columns} x ${r.rows} cells of ${grid.join(' x ')} from ${source.file} -> ${r.defs.length} def(s)${flags.has('frames') ? ` (${r.defs[0]!.id}, ${r.defs[0]!.frames} frames)` : `: ${r.defs.map((d) => d.id).join(', ')}`}${skipped.length ? `; transparent, skipped: cells ${skipped.join(', ')}` : ''}`);
    const slots = r.map.slots.map((s) => s.slot).filter((s) => r.colours.some((c) => c.slot === s));
    console.log(`  colours: ${r.colours.length} source -> ${slots.length} slots: ${slots.map((s) => `${s} ${r.colours.find((c) => c.slot === s)!.colour} (${r.colours.filter((c) => c.slot === s).map((c) => `'${c.char}' ${hexString(c.hex)}`).join(', ')})`).join('; ')}`);
    if (!r.merges.length) console.log('  merges: none (every source colour has a PALETTE entry of its own)');
    for (const m of r.merges) console.log(`  merged: ${m.colour} <- ${m.sources.map((c) => `${hexString(c.hex)} '${c.char}' ${c.slot} (${c.pixels} px)`).join(', ')}`);
    for (const c of checks) {
      for (const p of c.problems) console.log(`  x ${c.id}: ${p}`);
      for (const w of c.warnings) console.log(`  ! ${c.id}: ${w}`);
    }
    console.log(`  wrote ${rel(draft)} and ${rel(png)}`);
  }
  if (checks.some((c) => c.problems.length)) process.exitCode = 1;
}

function help(): void {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(text.slice(0, text.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

const cmd = args.shift();
if (cmd === 'check') await check();
else if (cmd === 'sheet') await sheet();
else if (cmd === 'find') find();
else if (cmd === 'zoo') zoo();
else if (cmd === 'import') await cmdImport();
else if (!cmd || cmd === 'help') help();
else fail(`unknown command "${cmd}" (check, sheet, find, zoo, import, help)`);
