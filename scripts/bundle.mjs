// npm run bundle: the engine as a kit for games that live outside this repo (docs/GUIDE.md).
//
//   node scripts/bundle.mjs                   bundle/pixel-engine/ + bundle/pixel-engine.zip
//   node scripts/bundle.mjs --out dist/engine  (npm run build does this: the site serves /engine/)
//
// The kit: pixel-engine.js (one self-contained ES module: engine, three.js, Rapier + wasm,
// hero kit, built-in models, CSS), GUIDE.md (docs/GUIDE.md), API.md (generated from the
// TypeScript), pixel-engine.d.ts + types/, CHANGELOG.md, a starter game (index.html +
// game.js, the guide's quick start), examples/ (the guide's other named code blocks), check.mjs
// (plays a page in a browser and reports errors and screenshots) and manifest.json.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import ts from 'typescript';
import { build } from 'vite';
import { generateApi } from './bundle/api.mjs';
import { guideBlocks } from './bundle/guide.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const outArg = args[args.indexOf('--out') + 1];
const out = resolve(root, args.includes('--out') && outArg ? outArg : 'bundle/pixel-engine');
const zipFile = `${out}.zip`;
const t0 = performance.now();

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
})();
const buildId = `${new Date().toISOString().slice(0, 10)} ${commit}`;

// --out is emptied first, so it must be a kit (or nothing): never the repo, a folder above it,
// or a game folder someone points it at by mistake.
const isKit = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).name === 'pixel-engine';
  } catch {
    return false;
  }
};
if (root === out || !relative(out, root).startsWith('..')) throw new Error(`bundle: --out ${out} is the repo or a folder above it`);
if (existsSync(out) && readdirSync(out).length && !isKit(out)) throw new Error(`bundle: --out ${out} is not empty and holds no kit (manifest.json); pick another folder`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. pixel-engine.js: Vite library build of src/bundle.ts, every byte inlined (the wasm via
// `?url`, the CSS via `?inline`, the built-in models through __PIXEL_BUILTINS__).
const builtins = Object.fromEntries(
  readdirSync(join(root, 'public/assets'))
    .filter((f) => f.endsWith('.glb'))
    .sort()
    .map((f) => [`assets/${f}`, `data:model/gltf-binary;base64,${readFileSync(join(root, 'public/assets', f)).toString('base64')}`]),
);
const tmp = join(root, `.scratch/bundle-build-${process.pid}`); // one per run: runs can overlap
await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  logLevel: 'warn',
  publicDir: false,
  base: './',
  define: { __PIXEL_BUILTINS__: JSON.stringify(builtins) },
  build: {
    outDir: tmp,
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 8000,
    lib: { entry: join(root, 'src/bundle.ts'), formats: ['es'], fileName: () => 'pixel-engine.js' },
    rolldownOptions: { input: join(root, 'src/bundle.ts'), output: { codeSplitting: false, minify: true } },
  },
});
const built = readdirSync(tmp);
if (built.join() !== 'pixel-engine.js') throw new Error(`bundle: expected one file, got ${built.join(', ')}`);
const engineJs = readFileSync(join(tmp, 'pixel-engine.js'), 'utf8');
if (/new URL\(["'`][^"'`]*\.(wasm|glb)["'`]/.test(engineJs)) throw new Error('bundle: a file reference was left outside the bundle');
const banner =
  `/*! Pixel Engine ${version} (build ${buildId}). One self-contained ES module: import it from game.js, ` +
  'see GUIDE.md. Includes three.js r186 (MIT) and Rapier 0.20 (Apache-2.0). */\n';
writeFileSync(join(out, 'pixel-engine.js'), banner + engineJs);
rmSync(tmp, { recursive: true, force: true });

// 2. Types and API.md from one TypeScript program rooted at src/bundle.ts.
const config = ts.getParsedCommandLineOfConfigFile(join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
// rapier-wasm.d.ts types the wasm glue import; node types cover a dev-only `process` check.
const program = ts.createProgram([join(root, 'src/bundle.ts'), join(root, 'src/engine/physics/rapier-wasm.d.ts')], {
  ...config.options,
  types: ['vite/client', 'node'],
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  stripInternal: true,
  rootDir: join(root, 'src'),
  outDir: join(out, 'types'),
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
const emitted = program.emit();
if (emitted.emitSkipped) throw new Error(`bundle: the TypeScript declarations were not emitted\n${ts.formatDiagnostics(emitted.diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' })}`);
writeFileSync(
  join(out, 'pixel-engine.d.ts'),
  `// Types for pixel-engine.js (TypeScript, or // @ts-check in an editor). THREE's types need\n// @types/three@0.186.0 and Rapier's @dimforge/rapier3d@0.20.0 (types only; the bundle has the code).\nexport * from './types/bundle';\n`,
);
const api = generateApi(program, join(root, 'src/bundle.ts'), join(root, 'src'), { version, build: buildId });
writeFileSync(join(out, 'API.md'), api.markdown);

// 3. The guide, its code blocks as runnable pages, the changelog and the check tool.
const guide = readFileSync(join(root, 'docs/GUIDE.md'), 'utf8');
const stamp = `> Pixel Engine **${version}**, build ${buildId}. The kit: \`README.md\` (what is where), this guide, \`API.md\`, \`pixel-engine.js\`.\n`;
writeFileSync(join(out, 'GUIDE.md'), guide.replace(/^(# .*\n)/, `$1\n${stamp}`));
cpSync(join(root, 'CHANGELOG.md'), join(out, 'CHANGELOG.md'));
cpSync(join(root, 'scripts/bundle/check.mjs'), join(out, 'check.mjs'));

const page = (title, script) =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <link rel="icon" href="data:," />
    <title>${title}</title>
    <style>html, body { margin: 0; height: 100%; background: #0d0b14; } #app { position: fixed; inset: 0; }</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./${script}"></script>
  </body>
</html>
`;
const blocks = guideBlocks(guide);
const quick = blocks.find((b) => b.name === 'quickstart');
if (!quick) throw new Error('bundle: docs/GUIDE.md has no ```js quickstart block');
writeFileSync(join(out, 'game.js'), quick.code);
writeFileSync(join(out, 'index.html'), page('Pixel Engine game', 'game.js'));
const examples = blocks.filter((b) => b.name !== 'quickstart');
if (examples.length) mkdirSync(join(out, 'examples'));
for (const b of examples) {
  writeFileSync(join(out, 'examples', `${b.name}.js`), b.code.replaceAll(`from './pixel-engine.js'`, `from '../pixel-engine.js'`));
  writeFileSync(join(out, 'examples', `${b.name}.html`), page(`Pixel Engine: ${b.name}`, `${b.name}.js`));
}

// 4. README (the kit's front door) and manifest.json.
const files = () => {
  const list = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else list.push(p);
    }
  };
  walk(out);
  return list;
};
const tokens = (file) => Math.round(readFileSync(file, 'utf8').length / 4);
const kb = (file) => `${Math.round(statSync(file).size / 1024)} KB`;
const readme = `# Pixel Engine ${version}

A WebGPU-first engine that renders 3D scenes as authentic pixel art (WebGL 2 fallback), with
Rapier physics, a platformer character with a full animation set, pixel HUD, audio, particles
and a look system (filters per layer). This folder is everything a game needs.

Read in this order:

1. \`GUIDE.md\` (~${Math.round(tokens(join(out, 'GUIDE.md')) / 1000)}k tokens): how to host a game, the mental model, a complete game, recipes, the rules and common mistakes. Read it whole.
2. \`API.md\` (~${Math.round(tokens(join(out, 'API.md')) / 1000)}k tokens): every export with its signature and doc. Search it; don't read it whole.
3. \`game.js\`: the guide's quick start, a complete game. Edit it into yours.

| File | What |
| --- | --- |
| \`pixel-engine.js\` | The engine, ${kb(join(out, 'pixel-engine.js'))}: one ES module with three.js (\`THREE\`, \`TSL\`), Rapier and its wasm, the hero kit, the built-in models (${Object.keys(builtins).map((k) => `\`${k}\``).join(', ')}) and the engine CSS. Never edit it. |
| \`index.html\`, \`game.js\` | A game to start from: serve this folder over HTTP and open \`index.html\` |
| \`examples/\` | The guide's other recipes as pages (${examples.map((b) => `\`${b.name}\``).join(', ')}) |
| \`check.mjs\` | \`node check.mjs [page] [--keys KeyD*60,Space*4] [--cameras] [--looks a,b]\`: plays the page in a real browser, saves screenshots, fails on any error. Run it before you hand a game back |
| \`pixel-engine.d.ts\`, \`types/\` | TypeScript declarations (optional) |
| \`CHANGELOG.md\` | What changed between engine versions |
| \`manifest.json\` | Version, build and every file with its size |

Serve it: \`npx serve .\` or \`python3 -m http.server\` here, then open http://localhost:3000/ (or :8000).
ES modules don't load from \`file://\`.
`;
writeFileSync(join(out, 'README.md'), readme);
const manifest = {
  name: 'pixel-engine',
  version,
  build: buildId,
  entry: 'pixel-engine.js',
  readFirst: ['README.md', 'GUIDE.md'],
  starter: { page: 'index.html', script: 'game.js' },
  examples: examples.map((b) => `examples/${b.name}.html`),
  builtinModels: Object.keys(builtins),
  exports: api.names.length,
  files: [
    ...files().map((p) => {
      const path = relative(out, p).split('\\').join('/');
      const bytes = statSync(p).size;
      return /\.(md|js|mjs|html|ts)$/.test(p) && !path.startsWith('types/') ? { path, bytes, tokens: tokens(p) } : { path, bytes };
    }),
    { path: 'manifest.json' }, // this file (its own size can't be in it)
  ],
};
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 5. The zip (stored + deflated entries, no dependencies).
function zip(dir, prefix) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const p of files()) {
    const name = Buffer.from(`${prefix}/${relative(dir, p).split('\\').join('/')}`);
    const data = readFileSync(p);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const header = (central) => {
      const b = Buffer.alloc(central ? 46 : 30);
      let o = 0;
      const u32 = (v) => (o = b.writeUInt32LE(v, o));
      const u16 = (v) => (o = b.writeUInt16LE(v, o));
      u32(central ? 0x02014b50 : 0x04034b50);
      if (central) u16(20);
      u16(20); // version needed
      u16(0x0800); // utf-8 names
      u16(8); // deflate
      u16(0); // time
      u16(0x21); // date: 1980-01-01
      u32(crc);
      u32(packed.length);
      u32(data.length);
      u16(name.length);
      u16(0); // extra
      if (central) {
        u16(0); // comment
        u16(0); // disk
        u16(0); // internal attributes
        u32(0); // external attributes
        u32(offset);
      }
      return b;
    };
    centrals.push(Buffer.concat([header(true), name]));
    const local = Buffer.concat([header(false), name, packed]);
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
mkdirSync(dirname(zipFile), { recursive: true });
writeFileSync(zipFile, zip(out, basename(out)));

const rel = (p) => relative(process.cwd(), p) || '.';
console.log(
  `${rel(out)}/  Pixel Engine ${version}: pixel-engine.js ${kb(join(out, 'pixel-engine.js'))}, ${api.names.length} exports, ` +
    `${examples.length} examples, ${files().length} files; ${rel(zipFile)} ${kb(zipFile)} (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
);
