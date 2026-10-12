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
// Imports (docs/ASSETS.md *Importing*; licences wait on the escalation, #49):
//   import <file.glb|.gltf> --as <id> --licence <spdx> --source <url> [--author a] [--scale s]
//        [--front +z|-z|+x|-x] [--pack p]
//                              a glTF or GLB → a draft def, .scratch/model/import/<id>.ts (check,
//                              sheet and diff take it; fix a colour in its palette, one line), and a
//                              fidelity sheet, .scratch/model/fidelity/<id>.png (source | def |
//                              difference at 4 yaws, game scale and close; source → palette
//                              swatches). --pack p also adds it to public/packs/<p>.json. Ids are
//                              like chair or kit/chair; only files beside the glTF are read.
//                              Refuses provenance the checks refuse: our own work (LicenseRef-own,
//                              --source a path in this repo or its GitHub URL) anywhere; anyone
//                              else's, CC0 included, only with --pack naming an approved
//                              PACK_SOURCES entry (the owner's comment on #49)
//   import-pack <pack>         an approved pack (src/engine/model/packs/sources.ts): download, verify
//                              its sha256 (cached in .scratch/import-cache/), check its licence files,
//                              import every model with one colour map → public/packs/<pack>.json,
//                              a summary (<out>/packs/<pack>.json) and a zoo
//   credits                    the attribution list from every model's and texture's `source`
//                              (libraries and packs) → <out>/credits.md
//
// Traces (docs/ASSETS.md *Tracing*): redraw a source in primitives, so it comes out editable.
//   trace <id> --against <source> --reference
//                              what to author from: bounds; boxes per node, per material and per
//                              connected piece (turned when tighter, how full, and the box,
//                              cyl or cone it is when it is one: paste it); boxes fitted to a
//                              convex decomposition (V-HACD, hints only); the colours clustered
//                              onto PALETTE names; → .scratch/model/trace/<id>-reference.png: front
//                              / side / top on a 0.1 m grid, pieces labelled p1…, the source at 4
//                              yaws and at game scale (+ .json, every number); pieces alike print
//                              under one line, the first 60 (--all: every one)
//   trace <id|draft.ts> --against <source>
//                              scores the def against the source: silhouette IoU per view at game
//                              and close scale, mean OKLab distance where both cover a pixel,
//                              bounds delta; → .scratch/model/trace/<id>-trace.png (the source's
//                              outline over the trace, per view, and front / side / top), and the
//                              `source` to record in the def. Exit 1 under TRACE_THRESHOLDS
//                              (src/engine/model/trace.ts: game IoU >= 0.85, close >= 0.85,
//                              colour <= the palette floor + 0.04) or on problems. Both print the
//                              palette floor of a source off the palette: the colour score its
//                              nearest PALETTE entries reach, the best a trace can do, which the
//                              colour limit sits on
//        sources: a .glb/.gltf file, pack:<pack>/<model>, gate-a:<file> (docs/plans/gate-a/),
//        town:<building> (smithy, market, tent, stash, obelisk, plaza, house, lantern),
//        monster:<seed|boss id>, asset:<name> (public/assets/: tree, coin, hero). The source is
//        normalized as imports are: base on y = 0, footprint centred (--scale s, --front +z|-z|+x|-x).
//        A file outside the repo says whose it is: --licence, --source, --author, --pack
//   export-glb <source> [--out .scratch/trace-src/<name>.glb]
//                              a source as a GLB (one mesh per node and colour; its provenance in
//                              the scene's extras, trusted in .scratch/**/trace-src/ only), for
//                              other tools; it writes there only
//
// An <id> can also be a draft file: `check my/stall.ts` (every def it exports), `sheet my/stall.ts`
// (its default export, or the first) or `sheet my/stall.ts crate` (that one), `zoo my/stall.ts`.
// Its models join the library for `use`; its PNGs and history go to .scratch/model/<file name>/.
// A pack file (public/packs/<pack>.json) works the same way, and `check` with no ids checks every
// pack there as well as the library.
//
// Options for every command: --json (machine-readable output), --out <dir> (default
// .scratch/model). Every sheet records the model in <out>/history/<id>/, so --compare and diff
// see the last *different* version you drew.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { Box3, Vector3 } from 'three/webgpu';
import type { SheetImage } from '../src/engine/animation';
import { column, renderView, row, titleBar, worldTriangles } from '../src/engine/inspect';
import { PALETTE, type PaletteColor } from '../src/engine/palette';
import { buildModel, checkModel, compileParts, expandModel, scoreFidelity, isLicenceFile, licenceFileProblem, licenceProblem, packSourceProblems, ModelCatalog, MODEL_LIBRARY, modelTriangles, PACK_ID, PACK_SOURCES, packCatalog, packProblems, parsePack, renderFidelity, type Binding, type ExpandedModel, type ModelDef, type ModelOptions, type ModelPack, type PackSource } from '../src/engine/model';
import { diffLines, diffModels, modelFingerprint, type ModelVersion } from '../src/engine/model/diff';
import { FRONTS, hexString, importGltf, importPack, IMPORT_ID, normalizeSource, unzip, type Front, type Imported } from '../src/engine/model/import';
import { flatTriangles, GAME_VIEW, gamePxPerMetre, modelSheet, renderGameScale, type FlatTri } from '../src/engine/model/sheet';
import { creditEntries, creditLines } from '../src/engine/model/packs/credits';
import { TEXTURE_LIBRARY } from '../src/engine/texture';
import { encodePng } from './png';
import { tsValue } from './ts-value';
import { kindOf, paletteFloor, pieceColours, primBox, renderTraceReference, renderTraceSheet, traceOffset, traceReference, traceVerdict, TRACE_THRESHOLDS, TRACE_TOOL, verdictLines, type ConvexHull, type TraceBox, type TraceComponent, type TraceReference } from '../src/engine/model/trace';
import { registerEngineHooks } from './trace/hooks';
import type { SourceProvenance, TraceSource } from './trace/sources';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Where model sources live (for `find` paths, `tokens` and zoo families). */
const SOURCES = ['src/engine/model/library'];
/** Pack files (`loadPack` fetches them), and where downloads wait (never committed). */
const PACKS = join(ROOT, 'public/packs');
const CACHE = join(ROOT, '.scratch/import-cache');
const ESCALATION = 'the licence escalation, #49 (https://github.com/michaelcrosato/riftlight/issues/49)';
let CATALOG: ModelCatalog = MODEL_LIBRARY;
/** A pack file named as the target (`check public/packs/<pack>.json`): its own problems are checked too. */
let PACK_TARGET: ModelPack | null = null;

const argv = process.argv.slice(2);

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const VALUED = ['params', 'seed', 'palette', 'out', 'as', 'licence', 'source', 'author', 'scale', 'front', 'pack', 'against'];
const SWITCHES = ['json', 'compare', 'labels', 'rig', 'reference', 'all'];
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
/** Where traces write: <out>/trace/, whatever folder a draft file picks for its other outputs. */
const TRACE_OUT = join(OUT, 'trace');

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
  if (!/\.(ts|mts|js|mjs|json)$/.test(file) || !existsSync(file)) return null;
  let defs: ModelDef[];
  if (file.endsWith('.json')) {
    PACK_TARGET = readPack(file);
    defs = [...PACK_TARGET.models];
  }
  else {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    const isDef = (v: unknown): v is ModelDef => !!v && typeof v === 'object' && 'id' in v && 'parts' in v && 'palette' in v;
    // the default export first (a module namespace lists its names alphabetically)
    defs = [...new Set([mod.default, ...Object.values(mod)].filter(isDef))];
  }
  if (!defs.length) fail(`${target} exports no ModelDef`);
  CATALOG = new ModelCatalog([...MODEL_LIBRARY.all().filter((d) => !defs.some((x) => x.id === d.id)), ...defs]);
  if (!flags.has('out')) OUT = join(ROOT, '.scratch/model', basename(file).replace(/\.[^.]+$/, ''));
  return defs.map((d) => d.id);
}

function readPack(file: string): ModelPack {
  return parsePack(JSON.parse(readFileSync(file, 'utf8')) as unknown, rel(file));
}

/** Every pack file in public/packs/. */
function packs(): ModelPack[] {
  return existsSync(PACKS) ? readdirSync(PACKS).filter((f) => f.endsWith('.json')).sort().map((f) => readPack(join(PACKS, f))) : [];
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
  // no ids: the library and every pack (each pack's models in a catalog of their own); a pack
  // file's own problems (its licence as a pack, models that don't name it) come first
  const packList = ids.length ? (PACK_TARGET ? [PACK_TARGET] : []) : packs();
  const targets = ids.length ? ids.map((id) => ({ def: CATALOG.get(id), catalog: CATALOG })) : [...CATALOG.all().map((def) => ({ def, catalog: CATALOG })), ...packList.flatMap((p) => {
    const catalog = packCatalog(p);
    return p.models.map((def) => ({ def, catalog }));
  })];
  const o = parseOptions();
  const results = targets.map((t) => checkModel(t.def, { ...(ids.length ? o : {}), catalog: t.catalog }));
  const packChecks = packList.map((p) => ({ pack: p.pack, models: p.models.length, problems: packProblems(p) }));
  const ms = performance.now() - t0; // real time: the check's own duration
  if (json) {
    console.log(JSON.stringify({ ms: Math.round(ms), models: results, packs: packChecks }, null, 2));
  } else {
    console.log(`${'model'.padEnd(16)} ${'tris'.padStart(5)} ${'draws'.padStart(5)} ${'mats'.padStart(4)}  size (m)            status`);
    for (const r of results) {
      const m = r.metrics;
      const status = r.problems.length ? `${r.problems.length} problem(s)` : r.warnings.length ? `${r.warnings.length} warning(s)` : 'ok';
      console.log(`${r.id.padEnd(16)} ${String(m?.tris ?? '-').padStart(5)} ${String(m?.draws ?? '-').padStart(5)} ${String(m?.materials ?? '-').padStart(4)}  ${(m ? m.bounds.size.map(fmt).join(' x ') : '-').padEnd(19)} ${status}`);
      for (const p of r.problems) console.log(`  x ${p}`);
      for (const w of r.warnings) console.log(`  ! ${w}`);
    }
    // pack files: their own problems (licence as a pack, models naming it), apart from the models'
    for (const p of packChecks) {
      console.log(`pack ${p.pack} (${p.models} model(s)): ${p.problems.length ? `${p.problems.length} problem(s)` : 'ok'}`);
      for (const x of p.problems) console.log(`  x ${x}`);
    }
    const bad = results.filter((r) => r.problems.length).length;
    const packLine = packChecks.length ? `; ${packChecks.length} pack(s), ${packChecks.filter((p) => p.problems.length).length} with problems` : '';
    console.log(`\n${results.length} model(s), ${bad} with problems, ${results.filter((r) => r.warnings.length).length} with warnings${packLine} (${Math.round(ms)} ms)`);
  }
  if (results.some((r) => r.problems.length) || packChecks.some((p) => p.problems.length)) process.exitCode = 1;
}

function cmdSheet(id: string): void {
  const o = { ...parseOptions(), catalog: CATALOG };
  const now = version(id, o);
  const before = flags.has('compare') ? baseline(now) : null;
  const previous: FlatTri[] | undefined = before ? flatTriangles(before.compiled, before.model.palette) : undefined;
  const note = flags.has('compare') ? (before ? 'magenta: the previous version' : 'no different earlier version recorded') : undefined;
  const sheet = modelSheet(id, { ...o, previous, labels: flags.has('labels'), rig: flags.has('rig'), note });
  const file = write(`${id}.png`, sheet.image);
  const report = sheet.report!; // `version` threw already if it can't be built
  const out = { file: rel(file), id, ...report, bounds: sheet.bounds, problems: sheet.problems, warnings: sheet.warnings, compared: !!before };
  writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(out, null, 2));
  record(now);
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${id}: ${report.tris} tris, ${report.draws} draws, ${report.materials} materials, ${sheet.bounds!.size.map(fmt).join(' x ')} m`);
    for (const p of sheet.problems) console.log(`  x ${p}`);
    for (const w of sheet.warnings) console.log(`  ! ${w}`);
    console.log(`  wrote ${rel(file)} (+ .json)`);
  }
  if (sheet.problems.length) process.exitCode = 1;
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

// ---------------------------------------------------------------- imports

/** The draft an import writes: the def as source, which check, sheet and diff take as a file. */
function draftSource(def: ModelDef, file: string): string {
  let lib = relative(dirname(file), join(ROOT, 'src/engine/model')).split(sep).join('/');
  if (!lib.startsWith('.')) lib = `./${lib}`;
  const s = def.source!;
  return [
    `// Imported by \`npm run model -- import\` from ${s.file ?? s.url} (${s.licence}, ${s.url}).`,
    `// Check: npm run model -- check ${rel(file)}   Look: npm run model -- sheet ${rel(file)}`,
    `// A slot reads wrong? Re-bind it in \`palette\` (\`source.colours\` keeps each slot's source colour).`,
    `import { model } from '${lib}';`,
    '',
    `export default model(${tsValue(def)});`,
    '',
  ].join('\n');
}

/** The fidelity sheet: .scratch/model/fidelity/<id>.png (or <out>/fidelity/). */
function fidelitySheet(r: Imported): string {
  const f = r.fidelity;
  const img = renderFidelity(r.source, modelTriangles(r.def), f, {
    title: `${r.def.id}: fidelity`,
    subtitle: `${r.def.source!.file ?? r.def.source!.url}  ${r.def.source!.licence}  ${r.report.triangles} tris -> ${r.report.parts.mesh} mesh, ${r.report.parts.box} box, ${r.report.parts.cyl} cyl`,
    threshold: 0.98,
    swatches: Object.entries(r.def.palette).map(([slot, name]) => ({ slot, source: parseInt(r.def.source!.colours![slot]!.slice(1), 16), mapped: PALETTE[name], name })),
    notes: r.report.dropped ? [`${r.report.dropped} degenerate triangles dropped (welded to the millimetre)`] : [],
  });
  const dir = join(OUT, 'fidelity');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.def.id.replace(/[^\w.-]+/g, '_')}.png`);
  writeFileSync(file, encodePng(img));
  return file;
}

/** Add (or replace by id) models in public/packs/<pack>.json. */
function writePack(pack: string, models: readonly ModelDef[], source: ModelPack['source'], about: string): string {
  const file = join(PACKS, `${pack}.json`);
  const had = existsSync(file) ? readPack(file) : null;
  const ids = new Set(models.map((m) => m.id));
  const out: ModelPack = { pack, about: had?.about || about, source: had?.source ?? source, models: [...(had?.models ?? []).filter((m) => !ids.has(m.id)), ...models] };
  mkdirSync(PACKS, { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  return file;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function importLines(r: Imported): string[] {
  const f = r.fidelity;
  return [
    `${r.def.id}: ${r.report.triangles} tris in ${r.report.groups} node/material group(s) -> ${r.def.parts.length} parts (${r.report.parts.mesh} mesh, ${r.report.parts.box} box, ${r.report.parts.cyl} cyl)${r.report.dropped ? `, ${r.report.dropped} degenerate dropped` : ''}`,
    `  colours: ${r.report.colours} source -> ${Object.entries(r.def.palette).map(([s, c]) => `${s} ${r.def.source!.colours![s]} -> ${c}`).join(', ')}`,
    `  fidelity: game iou ${f.iou}, close iou ${f.iouClose}, colour dE ${f.colour}, bounds delta ${f.bounds.join(' x ')} m${f.iou < 0.98 ? '  (under 0.98: an importer bug, report it)' : ''}`,
  ];
}

/** A file a glTF names, only if it lies in the glTF's own folder (no '..', no absolute path). */
function beside(file: string, uri: string): string {
  const dir = dirname(file);
  const path = resolve(dir, uri);
  if (isAbsolute(uri) || uri.split(/[\\/]/).includes('..') || !path.startsWith(dir + sep)) throw new Error(`'${uri}' is outside the glTF's folder: only files beside it are read`);
  return path;
}

async function cmdImport(target: string): Promise<void> {
  const need = (k: string, what: string) => (flags.get(k) as string | undefined) ?? fail(`import needs --${k} <${what}> (npm run model -- help)`);
  const id = need('as', 'id');
  const licence = need('licence', 'spdx');
  const url = need('source', 'url');
  const scale = Number(flags.get('scale') ?? 1);
  if (!(scale > 0)) fail(`--scale takes a number above 0 (got "${flags.get('scale')}")`);
  const front = String(flags.get('front') ?? '+z') as Front;
  if (!FRONTS.includes(front)) fail(`--front takes ${FRONTS.join(', ')} (got "${front}")`);
  const pack = flags.get('pack') as string | undefined;
  if (!IMPORT_ID.test(id)) fail(`--as takes an id like chair or kit/chair (${IMPORT_ID}): it names files (got "${id}")`);
  if (pack !== undefined && !PACK_ID.test(pack)) fail(`--pack takes an id like kit (${PACK_ID}): it names public/packs/<pack>.json (got "${pack}")`);
  const file = resolve(target);
  if (!existsSync(file)) fail(`no file "${target}"`);
  const bytes = new Uint8Array(readFileSync(file));
  const source = { url, licence, ...(pack ? { pack } : {}), file: basename(file), ...(flags.has('author') ? { author: String(flags.get('author')) } : {}), sha256: sha256(bytes) };
  const refused = licenceProblem(source);
  if (refused) fail(`refused: ${refused}`);
  const r = await importGltf(bytes, { id, source, scale, front, inflate: (b) => new Uint8Array(inflateSync(b)), readFile: (uri) => new Uint8Array(readFileSync(beside(file, uri))) });
  const draft = join(OUT, 'import', `${id.replace(/[^\w.-]+/g, '_')}.ts`);
  mkdirSync(dirname(draft), { recursive: true });
  writeFileSync(draft, draftSource(r.def, draft));
  const packFile = pack ? writePack(pack, [r.def], { url, licence, ...(source.author ? { author: source.author } : {}) }, `Imported models (${pack})`) : null;
  const sheet = fidelitySheet(r);
  const check = checkModel(r.def, { catalog: new ModelCatalog([...MODEL_LIBRARY.all().filter((d) => d.id !== id), r.def]) });
  const out = { id, draft: rel(draft), pack: packFile && rel(packFile), sheet: rel(sheet), report: r.report, palette: r.def.palette, colours: r.def.source!.colours, fidelity: r.fidelity, problems: check.problems, warnings: check.warnings };
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    for (const l of importLines(r)) console.log(l);
    for (const p of check.problems) console.log(`  x ${p}`);
    for (const w of check.warnings) console.log(`  ! ${w}`);
    console.log(`  wrote ${out.draft}${out.pack ? `, ${out.pack}` : ''} and ${out.sheet}`);
  }
  if (check.problems.length || r.fidelity.iou < 0.98) process.exitCode = 1;
}

/** A pack's download: from the cache when its hash matches, else fetched and checked. */
async function download(p: PackSource): Promise<Uint8Array> {
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

async function cmdImportPack(id: string): Promise<void> {
  const p = PACK_SOURCES.find((s) => s.id === id);
  if (!p) fail(`no approved pack "${id}": src/engine/model/packs/sources.ts lists ${PACK_SOURCES.length ? PACK_SOURCES.map((s) => s.id).join(', ') : 'none'}. A pack joins it only once the repository owner approves its licence with a comment on ${ESCALATION}; an agent never writes or links an approval. Until then, import our own files with \`import\``);
  const malformed = packSourceProblems([p]);
  if (malformed.length) fail(`refused: ${malformed.join('; ')}`);
  const refused = licenceProblem({ url: p.url, licence: p.licence, pack: p.id });
  if (refused) fail(`refused: ${refused}`);
  const bytes = await download(p);
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const files = zipped ? unzip(bytes, (b) => new Uint8Array(inflateRawSync(b))) : new Map([[basename(new URL(p.url).pathname), bytes]]);
  // the licence is checked pack by pack, from the licence files in the download (§7.1)
  const licenceFiles = [...files].filter(([name]) => isLicenceFile(name)).map(([name, b]) => ({ name, text: new TextDecoder().decode(b) }));
  const unlicensed = licenceFileProblem(p.licence, licenceFiles);
  if (unlicensed) fail(`refused: ${unlicensed}: check the pack and ${ESCALATION}`);
  const scale = Number(flags.get('scale') ?? 1);
  const front = String(flags.get('front') ?? '+z') as Front;
  const res = await importPack(files, { pack: p.id, source: { url: p.url, licence: p.licence, author: p.author, sha256: p.sha256 }, scale, front, inflate: (b) => new Uint8Array(inflateSync(b)) });
  const defs = res.models.map((m) => m.def);
  const packFile = writePack(p.id, defs, { url: p.url, licence: p.licence, author: p.author, sha256: p.sha256, homepage: p.homepage }, `${p.author}: ${p.id}`);
  CATALOG = new ModelCatalog(defs);
  const rows = res.models.map((m) => {
    const c = checkModel(m.def, { catalog: CATALOG });
    fidelitySheet(m);
    return { id: m.def.id, file: m.def.source!.file, tris: m.report.triangles, parts: m.report.parts, palette: m.def.palette, fidelity: { iou: m.fidelity.iou, iouClose: m.fidelity.iouClose, colour: m.fidelity.colour }, problems: c.problems, warnings: c.warnings };
  });
  const summary = join(OUT, 'packs', `${p.id}.json`);
  mkdirSync(dirname(summary), { recursive: true });
  writeFileSync(summary, JSON.stringify({ pack: p.id, colours: res.colours.slots.map((s) => ({ slot: s.slot, source: hexString(s.source), colour: s.colour, members: s.members.length })), models: rows, skipped: res.skipped }, null, 2));
  if (json) console.log(JSON.stringify({ pack: rel(packFile), summary: rel(summary), models: rows.length, skipped: res.skipped }, null, 2));
  else {
    for (const m of res.models) for (const l of importLines(m)) console.log(l);
    for (const s of res.skipped) console.log(`  skipped ${s.file}: ${s.reason}`);
    console.log(`${rows.length} model(s), ${rows.filter((r) => r.problems.length).length} with problems, ${rows.filter((r) => r.fidelity.iou < 0.98).length} under 0.98 IoU\n  wrote ${rel(packFile)} and ${rel(summary)}`);
  }
  if (defs.length) cmdZoo(p.id, defs.map((d) => d.id));
  if (rows.some((r) => r.problems.length || r.fidelity.iou < 0.98)) process.exitCode = 1;
}

/** The attribution list: every model with a `source`, grouped by pack (or url). */
function cmdCredits(): void {
  // imported textures (`npm run tex -- import`) carry the same `source`
  const entries = creditEntries([...MODEL_LIBRARY.all(), ...packs().flatMap((p) => p.models)], TEXTURE_LIBRARY.all());
  const lines = creditLines(entries);
  const file = join(OUT, 'credits.md');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(file, `${lines.join('\n')}\n`);
  if (json) console.log(JSON.stringify({ file: rel(file), credits: entries }, null, 2));
  else console.log(`${lines.join('\n')}\n\nwrote ${rel(file)}`);
}

// ---------------------------------------------------------------- traces

/** Provenance from the command line, for a file the GLB doesn't describe. */
function provenanceFlags(): Partial<SourceProvenance> {
  const o: Partial<Record<keyof SourceProvenance, string>> = {};
  for (const [flag, key] of [['licence', 'licence'], ['source', 'url'], ['author', 'author'], ['pack', 'pack']] as const) if (flags.has(flag)) o[key] = String(flags.get(flag));
  return o;
}

/** `--against` resolved (the town and Rapier need the engine hooks), and normalized as imports are. */
async function traceSource(): Promise<{ src: TraceSource; mesh: TraceSource['mesh']; how: string; tool: string }> {
  const spec = (flags.get('against') as string | undefined) ?? fail('trace needs --against <source>: a .glb/.gltf file, pack:<pack>/<model>, gate-a:<file>, town:<building>, monster:<seed|boss id> or asset:<name> (npm run model -- help)');
  registerEngineHooks();
  const { resolveSource } = await import('./trace/sources');
  const src = await resolveSource(spec, { root: ROOT, provenance: provenanceFlags() }).catch((e: Error) => fail(e.message));
  const scale = Number(flags.get('scale') ?? 1);
  if (!(scale > 0)) fail(`--scale takes a number above 0 (got "${flags.get('scale')}")`);
  const front = String(flags.get('front') ?? '+z') as Front;
  if (!FRONTS.includes(front)) fail(`--front takes ${FRONTS.join(', ')} (got "${front}")`);
  const how = `normalized as imports are: base on y = 0, footprint centred, front ${front}${scale !== 1 ? `, scale ${scale}` : ''}`;
  // the source.tool a trace records: with the normalization it was scored in, so the score reproduces
  const tool = [TRACE_TOOL, ...(front !== '+z' ? [`--front ${front}`] : []), ...(scale !== 1 ? [`--scale ${scale}`] : [])].join(' ');
  return { src, mesh: normalizeSource(src.mesh, { scale, front }), how, tool };
}

/** The palette floor, said once: what the best PALETTE colours score, and whether a trace can pass. */
function floorLine(floor: number): string | null {
  if (floor < 0.005) return null;
  return `the source is off the palette: its colours in the nearest PALETTE entries score dE ${floor} at best, so the colour limit is that floor + ${TRACE_THRESHOLDS.colour}: ${Math.round((floor + TRACE_THRESHOLDS.colour) * 1e4) / 1e4} (pick each slot's nearest entry by eye; the reference's \`palette:\` line keeps 8)`;
}

const vec = (v: readonly number[]) => `[${v.join(', ')}]`;
const boxLine = (b: TraceBox) => `at ${vec(b.at)} size ${vec(b.size)}${b.rot ? ` rot ${vec(b.rot)}` : ''}`;

/** One piece's shape: the part to paste when it is one, else its box. */
function pieceShape(c: TraceComponent, place = true): string {
  if (c.shape) {
    const prim = { ...c.shape.prim, c: c.slot } as Record<string, unknown>;
    if (!place) {
      delete prim.at;
      delete prim.rot;
    }
    return `${c.shape.match} ${kindOf(c.shape.prim)}: ${tsValue(prim, '', true)}`;
  }
  const b = c.turned ?? c.box;
  return place ? `box ${boxLine(b)}${c.turned ? ` (axis-aligned: ${boxLine(c.box)})` : ''}` : `box size ${vec(b.size)}`;
}

const omitPlace = (p: object) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'at' && k !== 'rot'));

/** Pieces alike (colour, kind, size, triangles) under one line each, their places below it. */
function pieceLines(pieces: readonly TraceComponent[], budget: number): string[] {
  const groups = new Map<string, TraceComponent[]>();
  for (const c of pieces) {
    const box = c.shape ? primBox(c.shape.prim) : (c.turned ?? c.box);
    const key = [pieceColours(c), c.shape ? `${kindOf(c.shape.prim)} ${c.shape.match} ${JSON.stringify(omitPlace(c.shape.prim))}` : 'box', [...box.size].sort().join(), c.tris].join('|');
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: string[] = [];
  let shown = 0;
  for (const g of groups.values()) {
    if (shown >= budget) break;
    const c = g[0]!;
    const head = `${pieceColours(c).padEnd(6)} ${String(c.tris).padStart(4)} tris  fill ${c.fill ?? '-'}`;
    if (g.length === 1) {
      out.push(`    ${c.name.padEnd(5)} ${head}  ${pieceShape(c)}${c.node ? `  [${c.node}]` : ''}`);
      shown++;
      continue;
    }
    out.push(`    ${`${g.length}x`.padEnd(5)} ${head}  ${pieceShape(c, false)}${c.node ? `  [${c.node}]` : ''}:`);
    for (const m of g) {
      const b = m.shape ? primBox(m.shape.prim) : (m.turned ?? m.box);
      out.push(`      ${m.name.padEnd(5)} at ${vec(b.at)}${b.rot ? ` rot ${vec(b.rot)}` : ''}`);
      shown++;
    }
  }
  if (shown < pieces.length) out.push(`    … ${pieces.length - shown} more (--all, --json, or the .json beside the PNG)`);
  return out;
}

function referenceLines(id: string, src: TraceSource, how: string, ref: TraceReference, hullNote: string): string[] {
  const all = flags.has('all');
  const cap = <T>(list: readonly T[], n: number) => (all ? list : list.slice(0, n));
  const more = (list: readonly unknown[], n: number) => (!all && list.length > n ? [`    … ${list.length - n} more (--all, --json, or the .json beside the PNG)`] : []);
  // merged meshes (a kit's, a build's) are one node per material: say so once
  const same = ref.nodes.length === ref.materials.length && ref.nodes.every((n) => ref.materials.some((m) => m.tris === n.tris && boxLine(m) === boxLine(n)));
  const lines = [
    `${id}: reference from ${src.spec} (${src.provenance.url || 'no url'}, ${src.provenance.licence || 'licence unknown'})`,
    `  ${how}`,
    `  bounds ${ref.bounds.size.join(' x ')} m: min ${vec(ref.bounds.min)} max ${vec(ref.bounds.max)}; ${ref.triangles} tris`,
    `  colours (clustered, slot -> PALETTE, share of the area): ${ref.colours.map((c) => `${c.slot} ${c.source} -> ${c.colour} ${Math.round(c.area * 100)}%`).join(', ')}`,
    `    palette: ${tsValue(Object.fromEntries(ref.colours.map((c) => [c.slot, c.colour])), '', true)}`,
    ...(same
      ? ['  nodes: one per material (merged meshes)']
      : [`  nodes (axis-aligned boxes, m; ${ref.nodes.length}):`, ...cap(ref.nodes, 20).map((g) => `    ${g.name.padEnd(18)} ${boxLine(g)}  ${g.tris} tris, ${Math.round(g.area * 100)}% of the area, ${g.colours.slice(0, 3).join(' ')}`), ...more(ref.nodes, 20)]),
    `  materials (axis-aligned boxes, m; ${ref.materials.length}):`,
    ...cap(ref.materials, 16).map((g) => `    ${g.name.padEnd(18)} ${boxLine(g)}  ${g.tris} tris, ${Math.round(g.area * 100)}% of the area`),
    ...more(ref.materials, 16),
    `  pieces (connected, welded to the mm; biggest first; ${ref.components.length}): a shape is a part to paste`,
    ...pieceLines(ref.components, all ? Infinity : 60),
    ref.hulls ? `  hull hints (V-HACD, ${ref.hulls.length} convex pieces; hints only, biggest first):` : `  hull hints: none (${hullNote})`,
    ...(ref.hulls ?? []).map((h, i) => `    h${String(i + 1).padEnd(4)} ${boxLine(h.box)}  fill ${h.fill ?? '-'}`),
    ...src.notes.map((n) => `  ! ${n}`),
  ];
  return lines;
}

async function cmdTraceReference(id: string): Promise<void> {
  const { src, mesh, how } = await traceSource();
  let hulls: ConvexHull[] | undefined;
  let hullNote = '';
  try {
    const { convexHulls } = await import('./trace/hulls');
    hulls = await convexHulls(mesh);
  } catch (e) {
    hullNote = `V-HACD failed: ${(e as Error).message}`;
  }
  const ref = traceReference(mesh, { hulls });
  const floor = paletteFloor(mesh);
  const img = renderTraceReference(mesh, ref, { title: `${id}: reference`, subtitle: `${src.spec}  (${src.provenance.url})  ${how}` });
  mkdirSync(TRACE_OUT, { recursive: true });
  const file = join(TRACE_OUT, `${id.replace(/[^\w.-]+/g, '_')}-reference.png`);
  writeFileSync(file, encodePng(img));
  const fl = floorLine(floor);
  // what the reference couldn't say goes with it, in JSON too (a lost hull run is not silent)
  const notes = [...src.notes, ...(hullNote ? [`no hull hints: ${hullNote}`] : []), ...(fl ? [fl] : [])];
  const out = { id, against: src.spec, provenance: src.provenance, normalized: how, file: rel(file), ...ref, paletteFloor: floor, notes };
  writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(out, null, 2));
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    for (const l of referenceLines(id, src, how, ref, hullNote)) console.log(l);
    if (fl) console.log(`  ! ${fl}`);
    console.log(`  wrote ${rel(file)} (+ .json)`);
    console.log(`  next: write the def with the library (npm run model -- find), then npm run model -- trace <draft.ts> --against ${src.spec}`);
  }
}

async function cmdTrace(id: string): Promise<void> {
  if (!flags.has('against')) fail('trace needs --against <source>: a .glb/.gltf file, pack:<pack>/<model>, gate-a:<file>, town:<building>, monster:<seed|boss id> or asset:<name> (npm run model -- help)');
  if (flags.has('reference')) return cmdTraceReference(id);
  if (!CATALOG.has(id)) fail(`no model "${id}" to score: name a draft file (my/trace.ts) or a library id; for what to author from, add --reference`);
  const { src, mesh, how, tool } = await traceSource();
  const o = { ...parseOptions(), catalog: CATALOG };
  const def = CATALOG.get(id);
  const source = { positions: mesh.positions, colours: mesh.colours };
  const translation = modelTriangles(def, o);
  const score = scoreFidelity(source, translation);
  const floor = paletteFloor(mesh);
  const verdict = traceVerdict(score, TRACE_THRESHOLDS, floor);
  const offset = traceOffset(source, translation);
  const check = checkModel(def, o);
  const fidelity = { iou: score.iou, iouClose: score.iouClose, colour: score.colour, bounds: score.bounds };
  const recorded = { ...src.provenance, tool, fidelity };
  // what the def records now, against what it should
  const notes: string[] = [...src.notes, ...[floorLine(floor)].filter((l): l is string => !!l)];
  const had = def.source;
  if (!had) notes.push('the def records no `source`: paste the line above into it');
  else {
    if (had.url !== recorded.url || had.licence !== recorded.licence) notes.push(`its source says ${had.url} (${had.licence}); this source is ${recorded.url} (${recorded.licence})`);
    if (had.tool !== tool) notes.push(`its source.tool is '${had.tool ?? ''}', not '${tool}' (the tool and the normalization these scores need)`);
    if (JSON.stringify(had.fidelity) !== JSON.stringify(fidelity)) notes.push('its source.fidelity is not these scores: update it');
  }
  const img = renderTraceSheet(source, translation, score, verdict, { title: `${id}: trace of ${src.spec}`, subtitle: `${src.provenance.url}  ${how}  ${verdict.pass ? 'PASS' : 'FAIL'}` });
  mkdirSync(TRACE_OUT, { recursive: true });
  const file = join(TRACE_OUT, `${id.replace(/[^\w.-]+/g, '_')}-trace.png`);
  writeFileSync(file, encodePng(img));
  const out = { id, against: src.spec, file: rel(file), pass: verdict.pass, thresholds: TRACE_THRESHOLDS, colourLimit: verdict.checks.find((c) => c.name === 'colour')!.limit, checks: verdict.checks, score, offset, paletteFloor: floor, source: recorded, problems: check.problems, warnings: check.warnings, notes };
  writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(out, null, 2));
  record(version(id, o));
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${id}: trace of ${src.spec} (${how})`);
    for (const l of verdictLines(score, verdict, offset)) console.log(`  ${l}`);
    console.log(`  ${verdict.pass ? 'record in the def' : 'its source, once it passes'}: source: ${tsValue(recorded, '', true)},`);
    for (const p of check.problems) console.log(`  x ${p}`);
    for (const w of check.warnings) console.log(`  ! ${w}`);
    for (const n of notes) console.log(`  ! ${n}`);
    console.log(`  wrote ${rel(file)} (+ .json)`);
  }
  if (!verdict.pass || check.problems.length) process.exitCode = 1;
}

async function cmdExportGlb(spec: string): Promise<void> {
  registerEngineHooks();
  const { exportPath, realPath, resolveSource, rootRelative, sourceGlb } = await import('./trace/sources');
  const src = await resolveSource(spec, { root: ROOT, provenance: provenanceFlags() }).catch((e: Error) => fail(e.message));
  const file = realPath(resolve(ROOT, String(flags.get('out') ?? `.scratch/trace-src/${src.name}.glb`)));
  if (!exportPath(rootRelative(ROOT, file)) || !file.endsWith('.glb')) fail(`export-glb writes a .glb under .scratch/ only, in a trace-src/ folder, the one place a trace takes a file's provenance at its word (exports are never committed: doctrine principle 5); got ${rel(file)}`);
  // a dangling link resolves to nothing, so it would be written through to wherever it points
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) fail(`export-glb won't write through a symlink: ${rel(file)}`);
  const bytes = await sourceGlb(src);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  const b = new Box3();
  const v = new Vector3();
  for (let i = 0; i + 2 < src.mesh.positions.length; i += 3) b.expandByPoint(v.set(src.mesh.positions[i]!, src.mesh.positions[i + 1]!, src.mesh.positions[i + 2]!));
  const size = b.getSize(new Vector3()).toArray().map(fmt);
  const out = { spec, file: rel(file), bytes: bytes.length, triangles: src.mesh.group.length, groups: src.mesh.groups.length, size, provenance: src.provenance, notes: src.notes };
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${spec}: ${out.triangles} tris in ${out.groups} group(s), ${size.join(' x ')} m as built`);
    console.log(`  provenance: ${tsValue(src.provenance, '', true)}`);
    for (const n of src.notes) console.log(`  ! ${n}`);
    console.log(`  wrote ${out.file} (${bytes.length} bytes; never commit it)`);
  }
}

async function main(): Promise<void> {
  const cmd = args[0] ?? 'help';
  let rest = args.slice(1);
  if (cmd === 'help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return;
  }
  if (cmd === 'import') return cmdImport(rest[0] ?? fail('import needs a file: npm run model -- import <file.glb> --as <id> --licence <spdx> --source <url>'));
  if (cmd === 'import-pack') return cmdImportPack(rest[0] ?? fail('import-pack needs a pack id from src/engine/model/packs/sources.ts'));
  if (cmd === 'credits') return cmdCredits();
  if (cmd === 'export-glb') return cmdExportGlb(rest[0] ?? fail(`export-glb needs a source: npm run model -- export-glb gate-a:hand-cart-a`));
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
  if (cmd === 'trace') return cmdTrace(rest[0] ?? fail('trace needs an id: npm run model -- trace <id> --against <source> --reference, then trace <draft.ts> --against <source>'));
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
