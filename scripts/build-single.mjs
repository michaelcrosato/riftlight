// npm run build:single: builds dist-single/pixel-engine.html, the whole game in one self-contained
// file (JS, Rapier's .wasm, CSS, favicon, GLB assets and the pack models it uses as data URIs).
// Runs offline, from file://. No options.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'vite';
import { helpExit } from './manual.mjs';

helpExit(import.meta.url);

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

html = html.replace(/<link rel="icon" href="\/favicon.svg"[^>]*>/, () =>
  `<link rel="icon" href="data:image/svg+xml;base64,${''}__FAVICON__">`);
html = html.replace('__FAVICON__', await b64(`${root}public/favicon.svg`));

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
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/pixel-engine.html`, html);
await rm(tmp, { recursive: true, force: true });
console.log(`dist-single/pixel-engine.html  ${(html.length / 1024 / 1024).toFixed(2)} MB`);
