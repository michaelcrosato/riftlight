// Builds dist-single/pixel-engine.html: the whole game in one self-contained file
// (JS incl. inlined Rapier wasm, CSS, favicon and GLB assets as data URIs). Runs offline.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const tmp = `${root}.scratch/single-build`;
const outDir = `${root}dist-single`;

await rm(tmp, { recursive: true, force: true });
await build({
  root,
  // Game page only (vite.config.ts also builds the Animation Lab, which needs code splitting).
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: tmp,
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 8000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});

let html = await readFile(`${tmp}/index.html`, 'utf8');
const files = await readdir(`${tmp}/assets`);

const b64 = async (p) => (await readFile(p)).toString('base64');
const assets = {};
for (const f of await readdir(`${root}public/assets`)) {
  if (f.endsWith('.glb')) assets[`assets/${f}`] = `data:model/gltf-binary;base64,${await b64(`${root}public/assets/${f}`)}`;
}

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
