// Model workbench: how agents check, look at and compare models (ModelDefs, docs/ASSETS.md)
// without a browser. Run through tsx:  npm run model -- <command> [...]
//
//   check [id...]              problems (exit 1) and warnings for every model, at every param's
//                              min and max and 3 seeds; a table of tris, draws, materials, size
//   sheet <id> [opts]          PNG → .scratch/model/<id>.png: 8-angle turntable, front / side / top
//                              on a 0.1 m grid with dimensions, the game-scale previews (Riftlight's
//                              iso camera at the level and town zooms, x4), palette, warnings
//        --params k=v,k2=v  --seed n  --palette slot=colour,...  (a PALETTE name or 0xrrggbb)
//        --compare          the previous different version as a magenta outline
//        --labels           named parts' names on the views
//        --rig              anchors (cyan) and colliders (green)
//   diff <id>                  in words, what changed since the previous version: parts added,
//                              removed, moved, resized, recoloured; bounds, tris, draws
//   find [words|tags...]       the catalog: id, size, params, ~tokens, file (no words: all)
//   zoo <family|tag|all>       every model of a library family (file) or tag at one scale
//                              → .scratch/model/zoo-<name>.png
//   tokens <id|file>           what writing it costs: characters ÷ 4 (the repo's estimate)
//
// An <id> can also be a draft file: `check my/stall.ts` (every def it exports), `sheet my/stall.ts`
// (its default export, or the first) or `sheet my/stall.ts crate` (that one), `zoo my/stall.ts`.
// Its models join the library for `use`; its PNGs and history go to .scratch/model/<file name>/.
//
// Options for every command: --json (machine-readable output), --out <dir> (default
// .scratch/model). Every sheet records the model in <out>/history/<id>/, so --compare and diff
// see the last *different* version you drew.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Box3, Vector3 } from 'three/webgpu';
import type { SheetImage } from '../src/engine/animation';
import { column, renderView, row, titleBar, worldTriangles } from '../src/engine/inspect';
import type { PaletteColor } from '../src/engine/palette';
import { buildModel, checkModel, compileParts, expandModel, ModelCatalog, MODEL_LIBRARY, type Binding, type ExpandedModel, type ModelDef, type ModelOptions } from '../src/engine/model';
import { diffLines, diffModels, modelFingerprint, type ModelVersion } from '../src/engine/model/diff';
import { flatTriangles, GAME_VIEW, gamePxPerMetre, renderGameScale, renderModelSheet, type FlatTri } from '../src/engine/model/sheet';
import { encodePng } from './png';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Where model sources live (for `find` paths, `tokens` and zoo families). */
const SOURCES = ['src/engine/model/library'];
let CATALOG: ModelCatalog = MODEL_LIBRARY;

const argv = process.argv.slice(2);

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const VALUED = ['params', 'seed', 'palette', 'out'];
const SWITCHES = ['json', 'compare', 'labels', 'rig'];
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
if (flags.has('seed') && !Number.isInteger(Number(flags.get('seed')))) fail(`--seed takes a whole number (got "${flags.get('seed')}")`);
const json = flags.has('json');
let OUT = resolve(ROOT, String(flags.get('out') ?? '.scratch/model'));

function write(name: string, img: SheetImage): string {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name.replace(/[^\w.-]+/g, '_'));
  writeFileSync(file, encodePng(img));
  return file;
}

const rel = (f: string) => relative(ROOT, f);
const fmt = (v: number) => `${+v.toFixed(2)}`;

// ---------------------------------------------------------------- sources (paths, tokens, families)

interface Source {
  file: string;
  family: string;
  text: string;
}

/** Each model's source text: its `model({ ... })` call, found by id in the source folders. */
function sources(): Map<string, Source> {
  const out = new Map<string, Source>();
  for (const dir of SOURCES) {
    for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'index.ts')) {
      const file = join(ROOT, dir, f);
      const text = readFileSync(file, 'utf8');
      for (let at = text.indexOf('model({'); at >= 0; at = text.indexOf('model({', at + 1)) {
        let depth = 0;
        let end = at + 'model('.length;
        for (; end < text.length; end++) {
          const ch = text[end];
          if (ch === '(' || ch === '{' || ch === '[') depth++;
          else if (ch === ')' || ch === '}' || ch === ']') {
            depth--;
            if (depth < 0) break;
          }
        }
        const call = text.slice(at, end + 1);
        const id = /id:\s*'([^']+)'/.exec(call)?.[1];
        if (id) out.set(id, { file, family: basename(f, '.ts'), text: call });
      }
    }
  }
  return out;
}

const tokensOf = (text: string) => Math.round(text.length / 4);

// ---------------------------------------------------------------- options → a build

function parseOptions(): ModelOptions {
  const params: Record<string, number> = {};
  for (const kv of String(flags.get('params') ?? '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!k || v === undefined || !Number.isFinite(Number(v))) fail(`--params takes k=v,k2=v (got "${kv}")`);
    params[k] = Number(v);
  }
  const palette: Record<string, Binding> = {};
  for (const kv of String(flags.get('palette') ?? '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!k || !v) fail(`--palette takes slot=colour,... (got "${kv}")`);
    palette[k] = /^0x[0-9a-f]{6}$/i.test(v) ? Number(v) : (v as PaletteColor);
  }
  return { params, palette, ...(flags.has('seed') ? { seed: Number(flags.get('seed')) } : {}) };
}

/**
 * A draft file as a target: its exported ModelDefs join the library in a catalog of their own,
 * and its outputs go to .scratch/model/<file name>/. Returns the ids it holds, default first.
 */
async function loadFile(target: string): Promise<string[] | null> {
  const file = resolve(target);
  if (!/\.(ts|mts|js|mjs)$/.test(file) || !existsSync(file)) return null;
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const isDef = (v: unknown): v is ModelDef => !!v && typeof v === 'object' && 'id' in v && 'parts' in v && 'palette' in v;
  // the default export first (a module namespace lists its names alphabetically)
  const defs = [...new Set([mod.default, ...Object.values(mod)].filter(isDef))];
  if (!defs.length) fail(`${target} exports no ModelDef`);
  CATALOG = new ModelCatalog([...MODEL_LIBRARY.all().filter((d) => !defs.some((x) => x.id === d.id)), ...defs]);
  if (!flags.has('out')) OUT = join(ROOT, '.scratch/model', basename(file).replace(/\.[^.]+$/, ''));
  return defs.map((d) => d.id);
}

function version(id: string, o: ModelOptions): ModelVersion {
  const model = expandModel(id, { ...o, catalog: CATALOG });
  return { model, compiled: compileParts(model.parts) };
}

// ---------------------------------------------------------------- history (for --compare and diff)

interface Snapshot {
  fingerprint: string;
  model: ExpandedModel;
}
const histDir = (id: string) => join(OUT, 'history', id.replace(/[^\w.-]+/g, '_'));

function record(v: ModelVersion): void {
  const dir = histDir(v.model.id);
  mkdirSync(dir, { recursive: true });
  const last = join(dir, 'last.json');
  const fp = modelFingerprint(v);
  if (existsSync(last)) {
    const prev = JSON.parse(readFileSync(last, 'utf8')) as Snapshot;
    if (prev.fingerprint === fp) return;
    renameSync(last, join(dir, 'prev.json'));
  }
  writeFileSync(last, JSON.stringify({ fingerprint: fp, model: v.model } satisfies Snapshot));
}

/** The last recorded version that differs from `now`. */
function baseline(now: ModelVersion): ModelVersion | null {
  const fp = modelFingerprint(now);
  for (const name of ['last', 'prev']) {
    const f = join(histDir(now.model.id), `${name}.json`);
    if (!existsSync(f)) continue;
    const snap = JSON.parse(readFileSync(f, 'utf8')) as Snapshot;
    if (snap.fingerprint === fp) continue;
    return { model: snap.model, compiled: compileParts(snap.model.parts) };
  }
  return null;
}

// ---------------------------------------------------------------- commands

function cmdCheck(ids: string[]): void {
  const t0 = performance.now(); // real time: the check's own duration
  const defs = ids.length ? ids.map((id) => CATALOG.get(id)) : CATALOG.all();
  const o = parseOptions();
  const results = defs.map((d) => checkModel(d, { ...(ids.length ? o : {}), catalog: CATALOG }));
  const ms = performance.now() - t0; // real time: the check's own duration
  if (json) {
    console.log(JSON.stringify({ ms: Math.round(ms), models: results }, null, 2));
  } else {
    console.log(`${'model'.padEnd(16)} ${'tris'.padStart(5)} ${'draws'.padStart(5)} ${'mats'.padStart(4)}  size (m)            status`);
    for (const r of results) {
      const m = r.metrics;
      const status = r.problems.length ? `${r.problems.length} problem(s)` : r.warnings.length ? `${r.warnings.length} warning(s)` : 'ok';
      console.log(`${r.id.padEnd(16)} ${String(m?.tris ?? '-').padStart(5)} ${String(m?.draws ?? '-').padStart(5)} ${String(m?.materials ?? '-').padStart(4)}  ${(m ? m.bounds.size.map(fmt).join(' x ') : '-').padEnd(19)} ${status}`);
      for (const p of r.problems) console.log(`  x ${p}`);
      for (const w of r.warnings) console.log(`  ! ${w}`);
    }
    const bad = results.filter((r) => r.problems.length).length;
    console.log(`\n${results.length} model(s), ${bad} with problems, ${results.filter((r) => r.warnings.length).length} with warnings (${Math.round(ms)} ms)`);
  }
  if (results.some((r) => r.problems.length)) process.exitCode = 1;
}

function cmdSheet(id: string): void {
  const o = { ...parseOptions(), catalog: CATALOG };
  const now = version(id, o);
  const build = buildModel(id, o);
  const check = checkModel(id, o);
  const before = flags.has('compare') ? baseline(now) : null;
  const previous: FlatTri[] | undefined = before ? flatTriangles(before.compiled, before.model.palette) : undefined;
  const sub = [Object.keys(now.model.params).length ? `params ${Object.entries(now.model.params).map(([k, v]) => `${k}=${v}`).join(' ')}` : '', build.report.seeded ? `seed ${now.model.seed}` : '', flags.has('compare') ? (before ? 'magenta: the previous version' : 'no different earlier version recorded') : '', now.model.tags.length ? `tags ${now.model.tags.join(' ')}` : ''].filter(Boolean).join('   ');
  const img = renderModelSheet({ model: now.model, compiled: now.compiled, build, check, previous, labels: flags.has('labels'), rig: flags.has('rig'), subtitle: sub });
  const file = write(`${id}.png`, img);
  const out = { file: rel(file), id, ...build.report, bounds: build.bounds, problems: check.problems, warnings: check.warnings, compared: !!before };
  writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(out, null, 2));
  record(now);
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${id}: ${build.report.tris} tris, ${build.report.draws} draws, ${build.report.materials} materials, ${build.bounds.size.map(fmt).join(' x ')} m`);
    for (const p of check.problems) console.log(`  x ${p}`);
    for (const w of check.warnings) console.log(`  ! ${w}`);
    console.log(`  wrote ${rel(file)} (+ .json)`);
  }
  if (check.problems.length) process.exitCode = 1;
}

function cmdDiff(id: string): void {
  const now = version(id, { ...parseOptions(), catalog: CATALOG });
  const before = baseline(now);
  if (!before) {
    record(now);
    console.log(json ? JSON.stringify({ baseline: false, note: 'no different earlier version recorded' }) : `no different earlier version of ${id} recorded: draw it (sheet), change it, then diff`);
    return;
  }
  const d = diffModels(before, now);
  record(now);
  if (json) console.log(JSON.stringify(d, null, 2));
  else for (const l of diffLines(d)) console.log(`${l === 'changed' || l === 'identical' ? `${id}: ` : '  '}${l}`);
}

function cmdFind(words: string[]): void {
  const src = sources();
  const tags = words.filter((w) => CATALOG.all().some((d) => d.tags.includes(w)));
  const text = words.filter((w) => !tags.includes(w)).join(' ');
  const defs = CATALOG.find({ tags, text });
  const rows = defs.map((d) => {
    const b = buildModel(d, { catalog: CATALOG });
    const s = src.get(d.id);
    return { id: d.id, about: d.about, tags: d.tags, size: b.bounds.size.map(fmt), params: d.params ?? {}, tokens: s ? tokensOf(s.text) : null, file: s ? rel(s.file) : null };
  });
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const r of rows) {
      const params = Object.entries(r.params).map(([k, [v, lo, hi]]) => `${k}=${v} (${lo}..${hi})`).join(' ');
      console.log(`${r.id.padEnd(16)} ${r.size.join(' x ').padEnd(16)} ~${String(r.tokens ?? '?').padStart(4)} tok  ${r.file ?? ''}`);
      console.log(`  ${r.about}  [${r.tags.join(', ')}]${params ? `  params: ${params}` : ''}`);
    }
    if (!rows.length) console.log(`nothing matches "${words.join(' ')}"`);
  }
}

function cmdZoo(name: string, only?: readonly string[]): void {
  const src = sources();
  const defs = only ? only.map((id) => CATALOG.get(id)) : CATALOG.all().filter((d) => name === 'all' || src.get(d.id)?.family === name || d.tags.includes(name));
  if (!defs.length) fail(`no family or tag "${name}" (families: ${[...new Set([...src.values()].map((s) => s.family))].join(', ')})`);
  const builds = defs.map((d) => buildModel(d, { catalog: CATALOG }));
  // one scale for all: the largest model fits its cell
  const cell = 180;
  const frame = new Box3();
  for (const b of builds) frame.union(new Box3(new Vector3(...b.bounds.min), new Vector3(...b.bounds.max)).translate(new Vector3(-(b.bounds.min[0] + b.bounds.max[0]) / 2, 0, -(b.bounds.min[2] + b.bounds.max[2]) / 2)));
  const span = frame.getSize(new Vector3());
  const scale = (cell - 24) / Math.max(0.3, Math.hypot(span.x, span.z), span.y * 1.1);
  const cells = builds.map((b) => {
    const centre = new Vector3((b.bounds.min[0] + b.bounds.max[0]) / 2, 0, (b.bounds.min[2] + b.bounds.max[2]) / 2);
    const f = new Box3(centre.clone().add(new Vector3(-span.x / 2, 0, -span.z / 2)), centre.clone().add(new Vector3(span.x / 2, span.y, span.z / 2)));
    const view = renderView(b.object, { width: cell, height: cell, yaw: 30, pitch: 20, frame: f, scale, label: b.id }, worldTriangles(b.object));
    const game = renderGameScale(b.object, GAME_VIEW.zooms.level, { k: 3 });
    return column([view, game]);
  });
  const perRow = 6;
  const rows: SheetImage[] = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(row(cells.slice(i, i + perRow)));
  const body = column(rows);
  const img = column([titleBar(`zoo: ${name}`, body.width, `${defs.length} models at one scale; under each, the game scale (${fmt(gamePxPerMetre(GAME_VIEW.zooms.level))} px/m) x3`), body]);
  const file = write(`zoo-${name}.png`, img);
  if (json) console.log(JSON.stringify({ file: rel(file), models: defs.map((d) => d.id) }));
  else console.log(`${defs.length} model(s): ${defs.map((d) => d.id).join(', ')}\n  wrote ${rel(file)}`);
}

function cmdTokens(target: string): void {
  const src = sources();
  const path = resolve(ROOT, target);
  const text = src.get(target)?.text ?? (existsSync(path) ? readFileSync(path, 'utf8') : fail(`no model or file "${target}"`));
  const out = { target, chars: text.length, tokens: tokensOf(text) };
  console.log(json ? JSON.stringify(out) : `${target}: ${out.chars} chars, ~${out.tokens} tokens`);
}

async function main(): Promise<void> {
  const cmd = args[0] ?? 'help';
  let rest = args.slice(1);
  if (cmd === 'help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return;
  }
  if (cmd !== 'tokens' && cmd !== 'find' && rest[0]) {
    const ids = await loadFile(rest[0]);
    if (ids) {
      if (cmd === 'check') rest = [...ids, ...rest.slice(1)];
      else if (cmd === 'zoo') return cmdZoo(basename(rest[0]).replace(/\.[^.]+$/, ''), ids);
      else {
        const pick = rest[1] ?? ids[0]!;
        if (!ids.includes(pick)) fail(`${rest[0]} has no model "${pick}" (it exports ${ids.join(', ')})`);
        rest = [pick];
      }
    }
  }
  if (cmd === 'check') return cmdCheck(rest);
  if (cmd === 'find') return cmdFind(rest);
  if (!['sheet', 'diff', 'zoo', 'tokens'].includes(cmd)) fail(`unknown command "${cmd}" (npm run model -- help)`);
  const id = rest[0] ?? fail(cmd === 'zoo' ? 'zoo needs a family, a tag, all or a file' : `${cmd} needs an id (npm run model -- find)`);
  if (cmd === 'sheet') return cmdSheet(id);
  if (cmd === 'diff') return cmdDiff(id);
  if (cmd === 'zoo') return cmdZoo(id);
  if (cmd === 'tokens') return cmdTokens(id);
  fail(`unknown command "${cmd}" (npm run model -- help)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
