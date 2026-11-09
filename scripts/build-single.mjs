// npm run build:single: builds dist-single/riftlight.html, the game page (index.html: Riftlight,
// and every `?game=`) in one self-contained file (JS, Rapier's .wasm, CSS, favicon, GLB assets and
// the pack models it uses as data URIs). Runs offline, from file://. CI publishes it from each
// green main (the riftlight-html job): how we hand the game out and play-test it.
//
// The page is ready for the AI Hub (docs/game/session.md): its head carries the hub's session
// client and catalogue tags (scripts/hub/riftlight.mjs) and the game's `game-lines` block (every
// line a player reads, docs/game/lang.md). The translations stay out: the hand-over build adds
// them (`npm run hub`).
//
//   --mode <shared-world|ghost|parallel>   the session mode the page declares (default: scripts/hub/riftlight.mjs DEFAULT_MODE)
//   --translations                         carry the game-translations block (src/riftlight/lang/translations/)
//   --model <name> --effort <level>        what built it (hub:model, hub:effort; the hand-over build)
//   --out <file>                           where to write it (default dist-single/riftlight.html)
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { build } from 'vite';
import { CATALOGUE, DEFAULT_MODE, MODES, riftlightTags } from './hub/riftlight.mjs';
import { hubHead, hubPage } from './hub/head.mjs';
import { helpExit } from './manual.mjs';

helpExit(import.meta.url);

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const mode = opt('mode') ?? DEFAULT_MODE;
if (!MODES.includes(mode)) throw new Error(`--mode is one of ${MODES.join(', ')}`);
const withTranslations = argv.includes('--translations');

const root = new URL('..', import.meta.url).pathname;
const tmp = `${root}.scratch/single-build`;
const outDir = `${root}dist-single`;

await rm(tmp, { recursive: true, force: true });
await build({
  root,
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: tmp,
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 8000,
    // Game page only (vite.config.ts also builds the Animation Lab); one chunk.
    rolldownOptions: { input: `${root}index.html`, output: { codeSplitting: false } },
  },
});

let html = await readFile(`${tmp}/index.html`, 'utf8');
const files = await readdir(`${tmp}/assets`);

const b64 = async (p) => (await readFile(p)).toString('base64');
const assets = {};
for (const f of await readdir(`${root}public/assets`)) {
  if (f.endsWith('.glb')) assets[`assets/${f}`] = `data:model/gltf-binary;base64,${await b64(`${root}public/assets/${f}`)}`;
}

// Imported packs the game loads (`loadPack('packs/<id>.json')`, src/riftlight/packs.ts): every pack
// path the built code names, cut down to the models and textures it names (`<pack>/<id>`, and what
// those `use` in turn), so a game that places forty of a pack's three hundred models embeds forty.
const jsFile = (await readdir(`${tmp}/assets`)).find((f) => f.endsWith('.js'));
const code = jsFile ? await readFile(`${tmp}/assets/${jsFile}`, 'utf8') : '';
const packBytes = { full: 0, embedded: 0 };
for (const url of new Set(code.match(/packs\/[a-z0-9-]+\.json/g) ?? [])) {
  if (url === 'packs/index.json') continue;
  const pack = JSON.parse(await readFile(`${root}public/${url}`, 'utf8'));
  const named = (text) => new Set(text.match(new RegExp(`${pack.pack}/[a-z0-9-]+`, 'g')) ?? []);
  const keep = named(code);
  const defs = new Map([...(pack.models ?? []), ...(pack.textures ?? [])].map((d) => [d.id, d]));
  for (const id of keep) for (const dep of named(JSON.stringify(defs.get(id) ?? {}))) keep.add(dep); // a Set iterates what it gains
  const cut = { ...pack, models: (pack.models ?? []).filter((m) => keep.has(m.id)), ...(pack.textures ? { textures: pack.textures.filter((t) => keep.has(t.id)) } : {}) };
  const json = JSON.stringify(cut);
  packBytes.full += JSON.stringify(pack).length;
  packBytes.embedded += json.length;
  assets[url] = `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
  console.log(`  ${url}: ${cut.models.length} of ${pack.models.length} models, ${(json.length / 1024).toFixed(0)} KB`);
}
if (packBytes.full) console.log(`  packs: ${(packBytes.embedded / 1024).toFixed(0)} KB of ${(packBytes.full / 1024).toFixed(0)} KB embedded`);

// The hub's head: the session client first, the catalogue and session tags, the game's lines.
// The line list is the game's own code: load it as the other tools load the engine (after Vite's build).
const { registerEngineHooks } = await import('./trace/hooks.ts');
registerEngineHooks();
const { riftlightLines } = await import('../src/riftlight/lang/index.ts');
const { riftlightTranslations } = await import('../src/riftlight/lang/translations.ts');
const { tags, session } = riftlightTags(mode, { model: opt('model'), effort: opt('effort') });
const head = hubHead({
  client: true,
  title: `${CATALOGUE.name} — ${CATALOGUE.tagline}`,
  description: CATALOGUE.description,
  themeColor: CATALOGUE.themeColor,
  icon: `data:image/svg+xml;base64,${await b64(`${root}public/favicon.svg`)}`,
  tags,
  session,
  lines: riftlightLines(),
  translations: withTranslations ? riftlightTranslations() : null,
});
html = hubPage(html, head, 'en');

for (const f of files.filter((f) => f.endsWith('.css'))) {
  const css = await readFile(`${tmp}/assets/${f}`, 'utf8');
  html = html.replace(new RegExp(`<link rel="stylesheet"[^>]*${f}[^>]*>`), () => `<style>${css}</style>`);
}
const jsFiles = files.filter((f) => f.endsWith('.js'));
if (jsFiles.length !== 1) throw new Error(`expected one JS chunk, got ${jsFiles.join(', ')}`);
const js = (await readFile(`${tmp}/assets/${jsFiles[0]}`, 'utf8')).replaceAll('</script', '<\\/script');
const assetScript = `<script>window.__PIXEL_ASSETS__=${JSON.stringify(assets)};</script>`;
html = html.replace(new RegExp(`<script type="module"[^>]*${jsFiles[0]}[^>]*></script>`), () => `${assetScript}\n<script type="module">${js}</script>`);

if (/(src|href)="\/(assets|favicon)/.test(html)) throw new Error('unresolved external reference left in HTML');
const out = opt('out');
if (out) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html);
} else {
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/riftlight.html`, html);
}
await rm(tmp, { recursive: true, force: true });
console.log(`${out ?? 'dist-single/riftlight.html'}  ${(html.length / 1024 / 1024).toFixed(2)} MB (session mode ${mode}${withTranslations ? ', with translations' : ''})`);
// a module that imported the engine (the line list) keeps Node running: we are done
process.exit(0);
