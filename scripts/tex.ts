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
// An <id> can also be a draft file: `check my/wall.ts` (every def it exports), `sheet my/wall.ts`
// (its default export, or the first). Options for every command: --json, --out <dir>
// (default .scratch/tex).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SheetImage } from '../src/engine/animation/raster';
import { isPaletteName, type PaletteColor } from '../src/engine/palette';
import { bakeTexture, TEXTURE_LIBRARY, TextureCatalog, validateTexture, type TextureDef } from '../src/engine/texture';
import { renderTextureSheet, texelImage, tiled } from '../src/engine/texture/sheet';
import { column, row, textBox, titleBar } from '../src/engine/inspect/render';
import { upscale } from '../src/engine/model/sheet';
import { encodePng } from './png';

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

const VALUED = ['palette', 'out'];
const SWITCHES = ['json'];
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
  const target = args[0] ?? fail('usage: npm run tex -- sheet <id|file.ts>');
  const { defs, file } = await targets(target);
  const def = defs[0]!;
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

function help(): void {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(text.slice(0, text.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

const cmd = args.shift();
if (cmd === 'check') await check();
else if (cmd === 'sheet') await sheet();
else if (cmd === 'find') find();
else if (cmd === 'zoo') zoo();
else if (!cmd || cmd === 'help') help();
else fail(`unknown command "${cmd}" (check, sheet, find, zoo, help)`);
