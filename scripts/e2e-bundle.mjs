/* global window, document, location, requestAnimationFrame -- page.evaluate callbacks run in the browser */
// e2e suite "bundle": the engine kit that `npm run build` puts in dist/engine (scripts/bundle.mjs),
// used the way an agent outside this repo uses it:
//
//   files     README, GUIDE, CONTROLS, RECIPES, ASSETS, LIBRARY, CREDITS, API, CHANGELOG, the engine
//             with its types, the starter game, one page per named game block of docs/GUIDE.md,
//             docs/GUIDE-CONTROLS.md, docs/GUIDE-RECIPES.md and docs/GUIDE-ASSETS.md (its models
//             module beside them, with no page; Gem Rush's with 52in1's session client and its head
//             tags), check.mjs;
//             manifest.json lists every file with its size; the kit says where newer versions are
//             (manifest.json's latest, releases and source, README.md's build line, all from
//             package.json's repository); the zip holds them all; the repository README's download
//             and build lines are the newest release's and the repository's.
//   types     a TypeScript game typechecks against pixel-engine.d.ts (strict, no skipLibCheck).
//   check     the kit's own check.mjs plays every page (WebGPU, headless): exit
//             0, the expected backend, a picture; with --keys, --cameras and --looks it saves
//             every shot; --keys holds a Pad* code on a fake pad; "page.html?touch=1" plays as on a
//             phone (touch in use, its controls in the report, a shot of the page); copied away
//             from any node_modules, it plays with a global Playwright.
//   play      every recipe does what the guide says: Coin Garden's coins, Cliff Run's
//             stomp, flag and next level, Lantern Night's crates, pads and gate, Look Lab's keys,
//             Beacon Yard on a pad (its prompts, Options' menu), Gem Rush alone, Market Corner's
//             models, light and textured floor.
//   phone     on a touch screen held upright and sideways (real taps) and on a TV with a pad, every
//             game page of the kit in every state a player reaches (playing, a menu, the settings,
//             won and lost, a 52in1 round's start, Look Lab's looks): the touch buttons their guide
//             gives them (Beacon Yard's LIGHT only by a dark beacon, nothing but its menu while it
//             shows, none at all on Market Corner), the pad's legend on a TV, every HUD text inside
//             the HUD and clear of the controls (the stick, its zone, a button, the ⚙), every tap
//             target reachable, a phone held sideways at two CSS pixels a pixel at least;
//             phone-*.png and tv-*.png show each state as the player sees it. Gem
//             Rush's own page in a LocalHub round (window.AIHub): it joins from its head, no ⚙,
//             and neither Esc nor Options pauses the round; the page as shipped (52in1's session
//             client first, then its tags) passes 52in1's own session harness in a parallel round.
//   sheets    check.mjs --sheets draws the market's own models module and library ids (defs grouped
//             in arrays and objects too; ids from outside the kit), and fails, naming the problem,
//             on a broken def, a module with no defs or one that never loads, an unknown id.
//   errors    a game that throws in update() keeps rendering, shows the error box and fills
//             engine.errors; one whose setup() throws shows "Failed to start"; check.mjs exits 1
//             for both, fast.
//   headless  the kit in Node from a copy of dist/engine/ alone: check.mjs --headless plays the
//             starter and replays it to the same fingerprint, GUIDE.md's own test.mjs prints the
//             same; a game that throws, one a replay can't repeat and one that touches `document`
//             fail (exit 1), a page or a module without createGame() is refused (exit 2).
//
// Shots land in .scratch/e2e/bundle/. Self-contained: e2e.mjs passes its helpers in.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { harness, HARNESS_FILES } from './e2e-hub.mjs';
import { readHead, SESSION_CLIENT } from './hub/head.mjs';

/** The zip's entries (name and inflated bytes), read through its central directory. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    const size = buf.readUInt32LE(p + 20);
    const local = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    entries.push({ name, bytes: inflateRawSync(buf.subarray(local, local + size)) });
    p += 46 + nameLen + extra + comment;
  }
  return entries;
}

/** A static server for a folder (the error pages live outside dist). */
function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript' };
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const file = join(dir, new URL(req.url, 'http://x').pathname);
      if (!existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

/**
 * @param {object} h helpers from e2e.mjs: { exe, root, out, base, scenarios, launch, ready, check, run, tail }
 */
export async function runBundle(h) {
  const { exe, root, base, scenarios, launch, ready, check, run, tail } = h;
  const kit = new URL('dist/engine/', root);
  const out = new URL('bundle/', h.out);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const kitPath = fileURLToPath(kit);
  const meta = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const { version } = meta;
  // where the kit comes from (scripts/bundle.mjs reads the same two fields, the same way)
  const repo = String(meta.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
  const buildLine = `git clone --depth 1 ${repo} && cd ${repo.split('/').pop()} && npm ci && npm run bundle`;

  console.log('\n▶ bundle: kit files');
  let manifest = { files: [], examples: [] };
  try {
    manifest = JSON.parse(await readFile(new URL('manifest.json', kit), 'utf8'));
    check(manifest.version === version, `manifest version ${manifest.version} is package.json's (${version})`);
    // a game built on the kit finds its upgrades: the newest kit's URL and the repository that builds it
    const readme = await readFile(new URL('README.md', kit), 'utf8');
    check(
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo) &&
        manifest.source === repo && manifest.releases === `${repo}/releases` && manifest.latest === `${repo}/releases/latest/download/pixel-engine.zip` &&
        readme.includes(manifest.latest) && readme.includes(manifest.releases) && readme.includes(`\`${buildLine}\``),
      `the kit says where newer versions are: manifest.json's latest (${manifest.latest}), releases and source, and README.md's build line`,
    );
    const need = ['README.md', 'GUIDE.md', 'CONTROLS.md', 'RECIPES.md', 'ASSETS.md', 'LIBRARY.md', 'library.json', 'packs/index.json', 'CREDITS.md', 'API.md', 'CHANGELOG.md', 'LICENSE', 'pixel-engine.js', 'pixel-engine.d.ts', 'types/bundle.d.ts', 'index.html', 'game.js', 'check.mjs', 'manifest.json'];
    const listed = new Map(manifest.files.map((f) => [f.path, f.bytes]));
    check(need.every((f) => listed.has(f)), `the kit has ${need.join(', ')}`);
    check(
      manifest.examples.length >= 6 && ['market', 'beacon-yard', 'gem-rush', 'top-down', 'looks'].every((n) => manifest.examples.includes(`examples/${n}.html`)) && manifest.readFirst.includes('CONTROLS.md'),
      `one page per guide recipe: ${manifest.examples.join(', ')}; CONTROLS.md is read first`,
    );
    check(listed.has('examples/market-models.js') && !listed.has('examples/market-models.html'), "ASSETS.md's models module ships beside its game, with no page of its own");
    // every file but manifest.json itself carries its size
    const sizes = await Promise.all(manifest.files.map(async (f) => (f.path === 'manifest.json' ? undefined : (await stat(new URL(f.path, kit))).size)));
    check(manifest.files.every((f, i) => sizes[i] === f.bytes), `every listed file exists with its size (${manifest.files.length} files)`);
    const engine = await readFile(new URL('pixel-engine.js', kit), 'utf8');
    check(engine.startsWith(`/*! Pixel Engine ${version} `) && engine.length > 3e6 && !/new URL\(["'`][^"'`]*\.wasm/.test(engine), `pixel-engine.js is one self-contained module (${(engine.length / 1e6).toFixed(1)} MB, version banner, wasm inlined)`);
    const guide = await readFile(new URL('GUIDE.md', kit), 'utf8');
    check(guide.includes(`Pixel Engine **${version}**`), 'GUIDE.md is stamped with the version');
    const controls = await readFile(new URL('CONTROLS.md', kit), 'utf8');
    check(
      controls.includes(`Pixel Engine **${version}**`) && controls.includes('```js beacon-yard') && readme.includes('`CONTROLS.md`') && readme.includes('`--keys PadA*10`') && readme.includes('`"index.html?touch=1" --size 390x844`'),
      'CONTROLS.md (docs/GUIDE-CONTROLS.md) is stamped with the version, holds its games, and README.md sends readers to it and says how check.mjs plays its checklist’s devices (a fake pad, a phone)',
    );
    const recipes = await readFile(new URL('RECIPES.md', kit), 'utf8');
    check(
      recipes.includes(`Pixel Engine **${version}**`) && recipes.includes('```js top-down') && recipes.includes('```js looks') && readme.includes('`RECIPES.md`'),
      'RECIPES.md (docs/GUIDE-RECIPES.md) is stamped with the version and holds its games, and README.md names it',
    );
    const assets = await readFile(new URL('ASSETS.md', kit), 'utf8');
    check(assets.includes(`Pixel Engine **${version}**`) && assets.includes('```js market-models'), 'ASSETS.md (docs/GUIDE-ASSETS.md) is stamped with the version and holds the example');
    // Gem Rush's page as handed out joins a 52in1 round: the hub's client, byte for byte, its first
    // script right after <meta charset>, then its tags (hub:session 1, its modes and moments); no
    // other page carries the client
    const pages = Object.fromEntries(await Promise.all(manifest.examples.map(async (p) => [p, await readFile(new URL(p, kit), 'utf8')])));
    const gem = readHead(pages['examples/gem-rush.html'] ?? '');
    check(
      (pages['examples/gem-rush.html'] ?? '').includes(`<meta charset="utf-8" />\n    <script>${SESSION_CLIENT}</script>\n    <meta name="hub:`) &&
        gem.one('hub:session') === '1' && gem.one('hub:multiplayer') === 'parallel 1-4, moments 1-4' && gem.all('hub:moment').length === 3 &&
        Object.entries(pages).every(([p, html]) => p === 'examples/gem-rush.html' || !html.includes('aihub-session')),
      `examples/gem-rush.html carries 52in1's session client (unmodified, its first script) and its head tags (hub:session ${gem.one('hub:session')}, ${gem.all('hub:moment').length} moments); no other page has the client`,
    );
    // LIBRARY.md: a row per model and texture (variants share one), the library's by family, then each pack's.
    // CREDITS.md: every one of them either our own work (counted) or imported (listed by id under
    // its source), the palettes, the code's licences. library.json: the same assets as data.
    const library = await readFile(new URL('LIBRARY.md', kit), 'utf8');
    const [, modelPart = '', texturePart = '', packPart = ''] = library.split(/^## (?:Models|Textures|Packs)$/m);
    // a row's ids: one, or a model and its variants (`rock-large-a` `rock-large-b` …)
    const rowIds = (part) => [...part.matchAll(/^\| ((?:`[^`]+` ?)+) \|/gm)].flatMap((m) => [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
    const ids = [rowIds(modelPart), rowIds(texturePart)];
    const packIds = rowIds(packPart);
    const [models, textures] = ids.map((list) => list.length);
    const credits = await readFile(new URL('CREDITS.md', kit), 'utf8');
    const own = credits.match(/(\d+) of the (\d+) library models .*?, (\d+) of the (\d+) textures/s);
    const assetCredits = credits.split(/^## /m).find((part) => part.startsWith('Models and textures')) ?? '';
    const creditedIds = (kind) => [...assetCredits.matchAll(new RegExp(` ${kind}: ([^.]+)\\.`, 'g'))].flatMap((m) => m[1].split(', '));
    const [importedModels, importedTextures] = [creditedIds('Models'), creditedIds('Textures')];
    const inLibrary = (list, lib) => list.filter((id) => lib.includes(id)).length;
    check(
      models > 40 && textures > 20 && own && +own[2] === models && +own[4] === textures &&
        +own[1] + inLibrary(importedModels, ids[0]) === models && +own[3] + inLibrary(importedTextures, ids[1]) === textures &&
        [...importedModels, ...importedTextures].every((id) => ids[0].includes(id) || ids[1].includes(id) || packIds.includes(id)) &&
        packIds.every((id) => importedModels.includes(id) || importedTextures.includes(id)),
      `LIBRARY.md lists ${models} models and ${textures} textures by family and ${packIds.length} from packs; CREDITS.md accounts for each: ${own?.[1]} models and ${own?.[3]} textures our own, ${importedModels.length} and ${importedTextures.length} imported and listed`,
    );
    const index = JSON.parse(await readFile(new URL('library.json', kit), 'utf8'));
    const packIndex = JSON.parse(await readFile(new URL('packs/index.json', kit), 'utf8'));
    const assetIds = index.assets.map((a) => a.id);
    check(
      index.engine === version && assetIds.length === models + textures + packIds.length && [...ids[0], ...ids[1], ...packIds].every((id) => assetIds.includes(id)) &&
        index.assets.every((a) => a.id && (a.kind === 'model' || a.kind === 'texture') && a.family && Array.isArray(a.tags) && a.about && a.licence && (a.pack === null || listed.has(a.pack))) &&
        index.packs.length === packIndex.packs.length && index.packs.every((p) => listed.has(p.file)),
      `library.json holds every asset in LIBRARY.md as data (${assetIds.length}), each pack's file in the kit (${index.packs.length} pack(s))`,
    );
    check(
      /\*\*Sweetie 16\*\* by GrafxKid/.test(credits) && /\*\*PICO-8\*\*/.test(credits) && /The MIT License/.test(credits) && /Apache License/.test(credits),
      "CREDITS.md credits the Sweetie 16 and PICO-8 palettes and carries three.js's and Rapier's licences",
    );
    const entries = unzip(await readFile(new URL('dist/engine.zip', root)));
    const zipped = new Map(entries.map((e) => [e.name.replace(/^engine\//, ''), e.bytes]));
    const same = manifest.files.every((f) => zipped.has(f.path) && (f.bytes === undefined || zipped.get(f.path).length === f.bytes));
    check(entries.length === manifest.files.length && same, `engine.zip holds every file, intact (${entries.length} entries)`);
    // the release's download line, whole: the zip unpacks to pixel-engine/ (CI's release job checks the zip)
    const releaseLine = `curl -fLO ${manifest.latest} && unzip pixel-engine.zip && cd pixel-engine`;
    // The repository's own README is where an agent given the repo URL lands: its kit download
    // is the newest release and its build line the repository's.
    const repoReadme = await readFile(new URL('README.md', root), 'utf8');
    check(
      repoReadme.includes(`\`${releaseLine}\``) && repoReadme.includes(`\`${buildLine}\``),
      "README.md sends game-making agents to the newest release's pixel-engine.zip and the repository's build line",
    );
  } catch (e) {
    check(false, `kit files: ${e.message}`);
  }

  console.log('\n▶ bundle: types');
  try {
    const dir = new URL('types/', out);
    await mkdir(dir, { recursive: true });
    await symlink(join(kitPath, 'pixel-engine.d.ts'), fileURLToPath(new URL('pixel-engine.d.ts', dir)));
    await symlink(join(kitPath, 'types'), fileURLToPath(new URL('types', dir)));
    await writeFile(
      new URL('game.ts', dir),
      `import { Engine, LOOK_PRESETS, PlatformerCharacter, THREE, readMoveInput, type Game } from './pixel-engine.js';
const target = new THREE.Vector3();
let hero: PlatformerCharacter | null = null;
const game: Game = {
  name: 'Typed',
  setup(ctx) { hero = new PlatformerCharacter(ctx.physics, { position: [0, 0, 0], lockDepth: ctx.camera.lockDepth }); },
  fixedUpdate(ctx, dt) { if (hero) hero.fixedUpdate(dt, readMoveInput(ctx, hero)); },
  cameraTarget: () => target,
};
void Engine.start(game, { look: LOOK_PRESETS.noir, camera: { preset: 'side' } });
// @ts-expect-error not a camera preset: the types catch it
void Engine.start(game, { camera: { preset: 'sideways' } });
`,
    );
    const tsc = await run('npx', ['tsc', '--ignoreConfig', '--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'esnext,dom', fileURLToPath(new URL('game.ts', dir))]);
    check(tsc.code === 0, `a TypeScript game typechecks against pixel-engine.d.ts${tsc.code ? ':\n    ' + tail(tsc.out) : ''}`);
  } catch (e) {
    check(false, `types: ${e.message}`);
  }

  const checkTool = (page, args, env = {}) => run('node', [join(kitPath, 'check.mjs'), ...(page ? [page] : []), ...args], { env: { CHROMIUM_PATH: exe ?? '', ...env } });
  const report = async (dir) => JSON.parse(await readFile(new URL(`${dir}/report.json`, out), 'utf8'));
  // --sheets runs: a run that wrote no report (it exited 2) reads as one that drew nothing
  const sheetsReport = async (dir) => (existsSync(new URL(`${dir}/report.json`, out)) ? report(dir) : { sheets: [], errors: [], ok: false });

  console.log('\n▶ bundle: check.mjs on every page');
  const pages = ['index.html', ...manifest.examples];
  for (const page of pages) {
    const name = `webgpu-${page.replace(/^examples\//, '').replace(/\.html$/, '')}`;
    try {
      const res = await checkTool(join(kitPath, page), ['--out', fileURLToPath(new URL(name, out))]);
      const r = await report(name);
      const colours = r.shots[0]?.colors ?? 0;
      check(res.code === 0 && r.ok && r.state?.backend === 'WebGPU' && colours >= 8, `${page} on WebGPU: ok, ${colours} colours, "${r.state?.status}"${res.code ? ':\n    ' + tail(res.out) : ''}`);
    } catch (e) {
      check(false, `${page}: ${e.message}`);
    }
  }
  try {
    const res = await checkTool(join(kitPath, 'index.html'), ['--keys', 'KeyD*30,Space*2', '--cameras', '--looks', 'noir,handheld', '--out', fileURLToPath(new URL('flags', out))]);
    const r = await report('flags');
    // (handheld is a 4-shade palette: few colours, but not blank)
    check(res.code === 0 && r.shots.length === 7 && r.shots.every((s) => s.colors >= 4), `--keys --cameras --looks: 7 shots (${r.shots.map((s) => `${s.name} ${s.colors}`).join(', ')})${res.code ? ':\n    ' + tail(res.out) : ''}`);
    // a Pad* code is held on a fake standard pad: the device turns pad, in the page and in Node
    const onPad = await checkTool(join(kitPath, 'examples/beacon-yard.html'), ['--keys', 'KeyD*10,PadA*3', '--out', fileURLToPath(new URL('flags-pad', out))]);
    const padReport = await report('flags-pad');
    const padNode = await checkTool('', ['--headless', join(kitPath, 'examples/beacon-yard.js'), '--keys', 'KeyD*10,PadA*3', '--out', fileURLToPath(new URL('flags-pad-node', out))]);
    const padNodeReport = await report('flags-pad-node');
    check(
      onPad.code === 0 && padReport.state?.status === 'beacons 0/4, pad' && padNode.code === 0 && padNodeReport.status === 'beacons 0/4, pad',
      `--keys PadA*3 presses Cross on a fake pad: the device is the pad in the page ("${padReport.state?.status}") and headless ("${padNodeReport.status}", replayed)${onPad.code || padNode.code ? ':\n    ' + tail(onPad.out + padNode.out) : ''}`,
    );
    // "page.html?touch=1": a phone's touch screen, so touch is the device in use (its prompts), the
    // report says where each touch control is, and a shot of the page shows them
    const onTouch = await checkTool(`${join(kitPath, 'examples/beacon-yard.html')}?touch=1`, ['--size', '390x844', '--out', fileURLToPath(new URL('flags-touch', out))]);
    const touchReport = await report('flags-touch');
    const pageShot = touchReport.shots.find((x) => x.name === 'beacon-yard-page');
    const touchButtons = touchReport.touch?.buttons.map((b) => `${b.label} ${b.code}${b.hidden ? ' hidden' : ''}`);
    check(
      onTouch.code === 0 && touchReport.state?.status === 'beacons 0/4, touch' && JSON.stringify(touchButtons) === '["LIGHT KeyE hidden","≡ Escape"]' && !!touchReport.touch?.stick && !!pageShot && existsSync(pageShot.file),
      `"beacon-yard.html?touch=1" --size 390x844 plays as on a phone: touch in use ("${touchReport.state?.status}"), its controls in report.json (${JSON.stringify(touchButtons)}), the page shot (${pageShot?.file})${onTouch.code ? ':\n    ' + tail(onTouch.out) : ''}`,
    );
    const bad = await checkTool(join(kitPath, 'index.html'), ['--looks', 'nope', '--out', fileURLToPath(new URL('flags-bad', out))]);
    check(bad.code === 1 && /unknown look "nope"/.test(bad.out), 'an unknown look fails the check');
    // URL flags on a local page; withUrlOptions keeps the game's own camera preset under ?zoom=
    const flagged = await checkTool(`${join(kitPath, 'examples/side-scroller.html')}?zoom=1.5&look=handheld`, ['--out', fileURLToPath(new URL('flags-url', out))]);
    const fr = await report('flags-url');
    const rig = fr.state?.cameraRig ?? {};
    check(flagged.code === 0 && rig.preset === 'side' && rig.zoom === 1.5 && fr.state.look === 'handheld', `"page.html?zoom=1.5&look=handheld": side camera kept at zoom 1.5, a 4-shade look passes (${fr.shots[0]?.colors} colours)${flagged.code ? ':\n    ' + tail(flagged.out) : ''}`);
    const typo = await checkTool(join(kitPath, 'index.html'), ['--key', 'KeyD*10']);
    const noBrowser = await checkTool(join(kitPath, 'index.html'), ['--out', fileURLToPath(new URL('flags-nobrowser', out))], { CHROMIUM_PATH: '/nonexistent/chrome' });
    check(typo.code === 2 && /unknown option --key/.test(typo.out) && noBrowser.code === 2 && /could not start Chromium/.test(noBrowser.out), `the tool says when it can't run: an unknown option, no browser (exit ${typo.code}, ${noBrowser.code})`);
    // a Chromium without WebGPU (the same browser, its WebGPU flags dropped and WebGPU turned off
    // by a wrapper): no game can start in it, which is the environment's fault, not the game's
    const wrapper = fileURLToPath(new URL('no-webgpu-chromium.sh', out));
    const drop = '--enable-unsafe-webgpu|--use-webgpu-adapter=*|--enable-features=Vulkan|--use-vulkan=*';
    await writeFile(wrapper, `#!/bin/sh\nfor a; do shift; case "$a" in ${drop}) ;; *) set -- "$@" "$a" ;; esac; done\nexec "${exe}" "$@" --disable-features=WebGPU\n`, { mode: 0o755 });
    const noGpu = await checkTool(join(kitPath, 'index.html'), ['--out', fileURLToPath(new URL('flags-nowebgpu', out))], { CHROMIUM_PATH: wrapper });
    check(!!exe && noGpu.code === 2 && /WebGPU unavailable/.test(noGpu.out) && /has no WebGPU, so no game can start/.test(noGpu.out), `a browser without WebGPU: exit 2, saying so (exit ${noGpu.code})${noGpu.code !== 2 ? ':\n    ' + tail(noGpu.out) : ''}`);
  } catch (e) {
    check(false, `check.mjs flags: ${e.message}`);
  }

  // Playwright installed globally (npm i -g; Claude Code cloud sessions come with one) and none
  // beside the game: an import from check.mjs never finds it, so check.mjs asks `npm root -g`.
  // The kit is copied away from this repo's node_modules, and npm's prefix points at a global
  // folder holding this repo's playwright-core, or at an empty one.
  console.log('\n▶ bundle: check.mjs with a global Playwright');
  const away = await mkdtemp(join(tmpdir(), 'pixel-kit-'));
  try {
    await cp(kitPath, join(away, 'engine'), { recursive: true });
    // both spellings of npm's prefix (an inherited uppercase one would win), and no update notice
    // in `npm root -g`'s output
    const env = (prefix) => ({ CHROMIUM_PATH: exe ?? '', npm_config_prefix: join(away, prefix), NPM_CONFIG_PREFIX: join(away, prefix), npm_config_update_notifier: 'false' });
    const globalRoot = (await run('npm', ['root', '-g'], { env: env('global') })).out.trim().split('\n').pop();
    if (!globalRoot.startsWith(away + sep)) throw new Error(`npm root -g gave ${globalRoot}, outside ${away}`);
    await mkdir(globalRoot, { recursive: true });
    await symlink(fileURLToPath(new URL('node_modules/playwright-core', root)), join(globalRoot, 'playwright-core'), 'dir');
    const play = (prefix) => run('node', [join(away, 'engine/check.mjs'), join(away, 'engine/index.html'), '--out', fileURLToPath(new URL(`playwright-${prefix}`, out))], { env: env(prefix) });
    const found = await play('global');
    const none = await play('empty');
    check(
      found.code === 0 && none.code === 2 && /needs Playwright/.test(none.out),
      `a kit away from any node_modules plays with a global Playwright (npm root -g; exit ${found.code}) and says when there is none (exit ${none.code})${found.code ? ':\n    ' + tail(found.out) : ''}`,
    );
  } catch (e) {
    check(false, `check.mjs with a global Playwright: ${e.message}`);
  } finally {
    await rm(away, { recursive: true, force: true });
  }

  console.log('\n▶ bundle: the recipes play as the guide says');
  const s = scenarios[0];
  const play = async (path, fn, label, pageOptions = {}) => {
    let ctx;
    try {
      ctx = await launch(exe, s, pageOptions);
      await ctx.page.goto(/^https?:/.test(path) ? path : `${base}engine/${path}`);
      await ready(ctx.page);
      await fn(ctx.page);
      const st = await ctx.page.evaluate(() => window.__PIXEL_ENGINE__.state());
      check(st.errors.length === 0 && st.gpuErrors.length === 0 && ctx.logs.length === 0, `${label}: no errors${ctx.logs.length ? ':\n    ' + ctx.logs.join('\n    ') : ''}`);
    } catch (e) {
      check(false, `${label} crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
    } finally {
      await ctx?.browser.close();
    }
  };
  await play(
    'index.html',
    async (page) => {
      const r = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        // stand on each coin's spot: the block under it (the feet), then a few frames
        for (const at of [[4, 1, -2], [7, 2.5, -2], [-5, 1.5, 4], [-2, 0, -5]]) {
          e.game.hero.teleport(at);
          e.step(10);
        }
        e.step(20);
        return { status: e.state().status, coin: e.audio.counts.coin, fanfare: e.audio.counts.fanfare, sparkles: e.particles.alive };
      });
      check(r.status === 'coins 4/4' && r.coin === 4 && r.fanfare === 1, `Coin Garden: every coin collected, the win fanfare (${JSON.stringify(r)})`);
    },
    'Coin Garden',
  );
  await play(
    'examples/side-scroller.html',
    async (page) => {
      const run = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const x0 = e.game.hero.feet.x;
        e.input.setKey('KeyD', true);
        e.step(60);
        e.input.setKey('KeyD', false);
        e.step(1);
        return { dx: e.game.hero.feet.x - x0, z: e.game.hero.feet.z, lane: e.camera.lockDepth };
      });
      check(run.dx > 3 && Math.abs(run.z) < 1e-3 && run.lane, `Cliff Run: D runs right on the side camera's lane (+${run.dx.toFixed(1)} m, z ${run.z.toFixed(3)})`);
      const stomp = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const g = e.game;
        const slime = g.slimes[0];
        slime.range = 0; // hold it still, then drop onto it
        e.step(1);
        g.hero.teleport([slime.mesh.position.x + 0.2, 2.5, 0]);
        let bounced = false;
        for (let i = 0; i < 60; i++) {
          e.step(1);
          if (g.stomps && g.hero.vy > 3) bounced = true;
        }
        return { stomps: g.stomps, bounced, hurts: g.hero.stats.hurts, gone: !slime.mesh.visible };
      });
      check(stomp.stomps === 1 && stomp.bounced && stomp.gone && stomp.hurts === 0, `Cliff Run: landing on a slime stomps it and bounces (${JSON.stringify(stomp)})`);
      const hurt = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const g = e.game;
        const slime = g.slimes[1];
        slime.range = 0;
        g.hero.teleport([slime.mesh.position.x - 3, 0, 0]);
        e.input.setKey('KeyD', true);
        for (let i = 0; i < 150 && !g.hero.stats.hurts; i++) e.step(1);
        e.input.setKey('KeyD', false);
        e.step(1);
        return { hurts: g.hero.stats.hurts, alive: g.slimes[1].mesh.visible, sound: e.audio.counts.hurt ?? 0 };
      });
      check(hurt.hurts === 1 && hurt.alive && hurt.sound === 1, `Cliff Run: running into a slime hurts (${JSON.stringify(hurt)})`);
      await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        e.game.hero.teleport([e.game.data.flag - 1.5, 0, 0]);
        e.input.setKey('KeyD', true);
        e.step(30);
        e.input.setKey('KeyD', false);
        e.step(170); // 2.5 s after the flag, the next level loads
      });
      await page.waitForFunction(() => window.__PIXEL_ENGINE__.game.level === 1 && window.__PIXEL_ENGINE__.state().ready, null, { timeout: 60000 });
      const next = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        e.step(2);
        return { status: e.state().status, fanfare: e.audio.counts.fanfare, bodies: e.physics.counts().bodies };
      });
      check(/^level 2/.test(next.status) && next.fanfare === 1, `Cliff Run: the flag clears level 1 and loads level 2 (${JSON.stringify(next)})`);
      const fall = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        e.game.hero.teleport([7, -20, 0]); // in a gap, far below
        e.step(5);
        return { falls: e.game.falls, x: e.game.hero.feet.x };
      });
      check(fall.falls === 1 && Math.abs(fall.x + 2) < 0.01, `Cliff Run: falling respawns at the start (${JSON.stringify(fall)})`);
    },
    'Cliff Run',
  );
  await play(
    'examples/top-down.html',
    async (page) => {
      const r = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const g = e.game;
        const pushes = [];
        for (const x of [-3, 3]) {
          g.hero.teleport([x, 0, 2.6]); // behind the crate, then walk north into it
          e.step(5);
          e.input.setKey('KeyW', true);
          e.step(240);
          e.input.setKey('KeyW', false);
          e.step(10);
          pushes.push(e.state().status);
        }
        const gateOpen = !g.gate.visible;
        g.hero.teleport([0, 0, -6.5]);
        e.step(5);
        e.input.setKey('KeyW', true);
        e.step(60);
        e.input.setKey('KeyW', false);
        e.step(5);
        return { pushes, gateOpen, end: e.state().status, chime: e.audio.counts.chime, lights: e.lights.stats().requests };
      });
      check(r.pushes.join() === 'pads 1/2,pads 2/2' && r.chime === 2, `Lantern Night: pushing each crate onto its pad lights it (${r.pushes.join(', ')})`);
      check(r.gateOpen && r.end === 'escaped', `Lantern Night: both pads open the gate, walking through it wins (${r.end})`);
    },
    'Lantern Night',
  );
  await play(
    'examples/looks.html',
    async (page) => {
      const r = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const press = (code) => {
          e.input.setKey(code, true);
          e.step(1);
          e.input.setKey(code, false);
          e.step(1);
        };
        const seen = [e.state().status];
        press('Digit4');
        seen.push(e.state().status, JSON.stringify(e.look) === JSON.stringify(e.lookPresets.noir));
        press('KeyE');
        seen.push(e.state().status);
        press('KeyQ');
        press('KeyQ');
        seen.push(e.state().status);
        press('Digit1');
        press('KeyQ');
        seen.push(e.state().status);
        press('Digit2');
        press('KeyT');
        seen.push(e.look.actors.pixel.size, e.look.environment.pixel);
        return seen;
      });
      check(
        JSON.stringify(r) === JSON.stringify(['look storybook heroes', 'look noir', true, 'look sin city', 'look pixel heroes', 'look handheld', 3, null]),
        `Look Lab: 4 picks noir, E the next look and Q the one before (round from the first to the last), 2 the custom look, T makes its characters chunky (${JSON.stringify(r)})`,
      );
    },
    'Look Lab',
  );

  await play(
    'examples/beacon-yard.html',
    async (page) => {
      const r = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const g = e.game;
        const pad = (...on) => e.input.setGamepads([{ connected: true, mapping: 'standard', index: 0, id: 'fake', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: on.includes(i), value: on.includes(i) ? 1 : 0 })) }]);
        const tap = (button) => {
          pad(button);
          e.step(1);
          pad();
          e.step(2);
        };
        const seen = [e.state().status];
        g.at.set(-6, 0.6, -4);
        tap(0); // Cross by the first beacon
        seen.push(e.state().status, e.controls.label('use'), e.controls.label('pause'));
        tap(9); // Options: the pause menu, as it is let go
        seen.push(e.state().status);
        tap(1); // Circle closes it
        seen.push(e.state().status);
        e.input.setGamepads(null);
        return seen;
      });
      check(
        JSON.stringify(r.slice(1)) === JSON.stringify(['beacons 1/4, pad', 'Cross', 'Options', 'beacons 1/4, pad, menu', 'beacons 1/4, pad']),
        `Beacon Yard on a pad: Cross lights a beacon, the prompts name the pad's buttons, Options opens the menu, Circle closes it (${r.join(' | ')})`,
      );
    },
    'Beacon Yard',
  );
  await play(
    'examples/gem-rush.html',
    async (page) => {
      const r = await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const g = e.game;
        const x0 = g.at.x;
        e.input.setKey('KeyD', true);
        e.step(30);
        e.input.setKey('KeyD', false);
        const before = g.got; // the walk may have crossed one already
        g.at.copy(g.gems.find((gem) => gem.visible).position);
        e.step(2);
        return { moved: g.at.x !== x0, before, got: g.got, status: e.state().status, session: g.session, coin: e.audio.counts.coin };
      });
      // (a gem lying beside it is grabbed too)
      check(r.moved && r.got > r.before && r.status === `gems ${r.got}/12` && r.session === null && r.coin === r.got, `Gem Rush alone (no 52in1): it plays at once, a gem is grabbed (${JSON.stringify(r)})`);
    },
    'Gem Rush',
  );

  // On a phone (a touch screen held upright and sideways, real taps) and on a TV (1920x1080, a fake
  // standard pad), the starter, Beacon Yard and Gem Rush in every state a player reaches: playing, a
  // menu, the settings, won and lost, a 52in1 round's start. In each, every HUD text and glyph lies
  // inside the HUD, none under a touch control on screen (the stick, its zone, a button, the ⚙), no
  // text over another, every tap target reachable (nothing over a touch button, the ⚙, a menu row
  // or a settings row; real taps on ≡, a menu row's edge, the ⚙, the settings' Close). Each game has
  // the touch buttons its guide gives it (Beacon Yard's LIGHT only by a dark beacon), and a phone
  // held sideways shows the art at two CSS pixels a pixel at least. phone-<page>-<state>-<w>x<h>.png
  // and tv-<page>-<state>.png show each state as the player sees it.
  const phone = (width, height) => ({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const PHONES = [
    [390, 844],
    [844, 390],
  ];
  const TV = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
  /** Page helpers: live frames, a fake standard pad and a press on it (Options acts as it is let go, so live frames). */
  const helpers = (page) =>
    page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const frames = (n) => new Promise((done) => requestAnimationFrame(() => (n > 1 ? frames(n - 1).then(done) : done())));
      const pad = (...on) => e.input.setGamepads([{ connected: true, mapping: 'standard', index: 0, id: 'fake', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: on.includes(i), value: on.includes(i) ? 1 : 0 })) }]);
      window.__kit = {
        frames,
        pad,
        async press(button) {
          e.manual = false;
          pad(button);
          await frames(3);
          pad();
          await frames(4);
        },
      };
    });
  /**
   * The screen after a few live frames: the device in use, the touch controls, the HUD's texts, the
   * framing scale, the settings panel, and what is wrong: a text or glyph outside the HUD, under a
   * control on screen or a text over another; something over a touch button, the ⚙, a settings row
   * (at its left, middle and right) or a row of the game's menu (`rows`: the HUD's bars `rowHeight`
   * art pixels high). A shot of the page in `<shot>.png`.
   */
  const look = async (page, shot, rowHeight = 0) => {
    const r = await page.evaluate(async (rowHeight) => {
      const e = window.__PIXEL_ENGINE__;
      e.manual = false;
      await window.__kit.frames(3);
      const { hud } = e;
      const size = { width: hud.width, height: hud.height };
      const at = hud.canvas.getBoundingClientRect();
      const kx = at.width / size.width;
      const ky = at.height / size.height;
      const onScreen = (px, py, w, h) => ({ left: at.left + px * kx, top: at.top + py * ky, right: at.left + (px + w) * kx, bottom: at.top + (py + h) * ky });
      // each text's and glyph's box: in art pixels, then on screen (CSS pixels, as the controls' rects are)
      const boxes = hud.items
        .filter((i) => i.kind !== 'rect')
        .map((i) => {
          const k = Math.max(1, Math.round(i.o.scale ?? 1));
          const { width, height } = i.kind === 'text' ? hud.measure(i.text, k) : { width: Math.max(...i.rows.map((row) => row.length)) * k, height: i.rows.length * k };
          const [px, py] = hud.place(i.x, i.y, width, height, i.o.anchor);
          return { s: i.kind === 'text' ? i.text : 'a glyph', text: i.kind === 'text', inside: px >= 0 && py >= 0 && px + width <= size.width && py + height <= size.height, ...onScreen(px, py, width, height) };
        });
      const r = e.touch?.rects();
      const gear = document.querySelector('.settings-button');
      const gearOn = !!gear && !gear.hidden && !gear.classList.contains('idle') && gear.getBoundingClientRect().width > 0;
      const controls = [...(r?.stick ? [['the stick', r.stick]] : []), ...(r?.zone ? [["the stick's zone", r.zone]] : []), ...(r?.buttons ?? []).filter((b) => !b.hidden).map((b) => [b.label, b.rect]), ...(gearOn ? [['⚙', gear.getBoundingClientRect()]] : [])];
      const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const texts = boxes.filter((b) => b.text);
      const settings = e.settings.isOpen;
      const wrong = [
        ...boxes.filter((t) => !t.inside).map((t) => `${t.s} outside the ${size.width}x${size.height} HUD`),
        ...(settings ? [] : boxes.flatMap((t) => controls.filter(([, c]) => hits(t, c)).map(([name]) => `${t.s} under ${name}`))),
        ...texts.flatMap((t, i) => texts.slice(i + 1).filter((u) => hits(t, u)).map((u) => `${t.s} over ${u.s}`)),
      ];
      // tap targets: what a finger lands on at the left, the middle and the right of each
      const lands = (box, ok, name) => {
        for (const f of [0.04, 0.5, 0.96]) {
          const el = document.elementFromPoint(box.left + (box.right - box.left) * f, (box.top + box.bottom) / 2);
          if (el && !ok(el)) wrong.push(`${el.className || el.tagName} over ${name}`);
        }
      };
      if (!settings) {
        for (const el of e.touch?.root.querySelectorAll('button') ?? []) {
          const b = el.getBoundingClientRect();
          if (b.width && !el.classList.contains('hidden') && e.touch.visible) lands({ left: b.left, top: b.top, right: b.right, bottom: b.bottom }, (top) => el.contains(top), `the ${el.textContent.trim()} button`);
        }
        if (gearOn) lands(gear.getBoundingClientRect(), (top) => gear.contains(top), 'the ⚙');
      }
      const rows = settings || !rowHeight ? [] : hud.items.filter((i) => i.kind === 'rect' && i.h === rowHeight).map((i) => onScreen(...hud.place(i.x, i.y, i.w, i.h, i.anchor), i.w, i.h));
      rows.forEach((row, i) => lands(row, (top) => !top.closest('.touch-ui, .settings-button, .settings-ui'), `the menu's row ${i}`));
      if (settings)
        for (const el of document.querySelectorAll('.settings-ui [data-row], .settings-ui [data-page], .settings-ui [data-act]')) {
          const b = el.getBoundingClientRect();
          if (b.width && b.height) lands(b, (top) => !top.closest('.touch-ui, .settings-button') && !!top.closest('.settings-ui'), `the settings' ${el.textContent.trim()}`);
        }
      return {
        status: e.state().status,
        device: e.input.device,
        settings,
        scale: e.renderer.framing.scale,
        visible: !!e.touch?.visible,
        zone: !!r?.zone,
        buttons: (r?.buttons ?? []).map((b) => `${b.label} ${b.code}${b.hidden ? ' hidden' : ''}`),
        texts: texts.map((t) => t.s),
        rows: rows.map((b) => ({ x: b.left, y: (b.top + b.bottom) / 2, w: b.right - b.left })),
        wrong,
      };
    }, rowHeight);
    await page.screenshot({ path: fileURLToPath(new URL(`${shot}.png`, out)) });
    return r;
  };
  /** A real tap at the centre of the element `selector` matches (on a page, not in it). */
  const tapOn = async (page, selector) => {
    const b = await page.evaluate((selector) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
    if (b) await page.touchscreen.tap(b.x, b.y);
    return !!b;
  };
  /** Every state seen clean: `states` maps a state's name to what `look` saw. */
  const clean = (states) => Object.entries(states).flatMap(([name, r]) => r.wrong.map((w) => `${name}: ${w}`));
  const say = (states) => JSON.stringify(Object.fromEntries(Object.entries(states).map(([name, r]) => [name, { status: r.status, device: r.device, scale: r.scale, visible: r.visible, buttons: r.buttons, texts: r.texts }])));
  // Beacon Yard's menu rows are the HUD's 22-pixel bars; Coin Garden walks onto each coin (the block under it)
  const ROW = 22;
  const COINS = [
    [4, 1, -2],
    [7, 2.5, -2],
    [-5, 1.5, 4],
    [-2, 0, -5],
  ];
  const collectCoins = (page) =>
    page.evaluate((spots) => {
      const e = window.__PIXEL_ENGINE__;
      for (const at of spots) {
        e.game.hero.teleport(at);
        e.step(10);
      }
      e.step(20);
    }, COINS);
  /** Gem Rush in a 52in1 round of moments (a LocalHub in the page): loaded, readied up, still until the start. */
  const gemRound = (page) =>
    page.evaluate(async () => {
      const e = window.__PIXEL_ENGINE__;
      const { HubSession, LocalHub } = await import(new URL('../pixel-engine.js', location.href).href);
      const { createGame, MOMENTS } = await import(new URL('./gem-rush.js', location.href).href);
      const hub = new LocalHub({ mode: 'moments', moment: { id: 'gem-dash', seconds: MOMENTS['gem-dash'].seconds }, players: 1, seed: 5 });
      const session = await HubSession.join({ mode: ['parallel', 'moments'], seats: [1, 4], client: hub.client(0), clock: () => hub.now });
      window.__kit.hub = hub;
      await e.loadGame(createGame(session));
      e.manual = false;
      await window.__kit.frames(3);
      return hub.allReady;
    });
  /** The round starts: the hub's start reaches the game, which counts down. */
  const gemStart = (page) =>
    page.evaluate(async () => {
      const e = window.__PIXEL_ENGINE__;
      window.__kit.hub.start();
      window.__kit.hub.advance(1);
      for (let i = 0; i < 30 && !(e.game.countdown < Infinity); i++) await window.__kit.frames(1);
      return e.game.countdown;
    });
  const gemEnd = (page, won) =>
    page.evaluate(async (won) => {
      const e = window.__PIXEL_ENGINE__;
      const { createGame } = await import(new URL('./gem-rush.js', location.href).href);
      await e.loadGame(createGame(null));
      e.game.finish(e.context, won);
    }, won);

  for (const [w, h] of PHONES) {
    const shot = (page, state) => `phone-${page}-${state}-${w}x${h}`;
    await play(
      'index.html',
      async (page) => {
        await helpers(page);
        const states = { playing: await look(page, shot('coin-garden', 'playing')) };
        const tapped = await tapOn(page, '.settings-button'); // a real tap on the ⚙
        states.settings = await look(page, shot('coin-garden', 'settings'));
        await tapOn(page, '.settings-ui [data-act="close"]');
        states.closed = await look(page, shot('coin-garden', 'closed'));
        await collectCoins(page);
        states.won = await look(page, shot('coin-garden', 'won'));
        const s = states.playing;
        check(
          s.device === 'touch' && s.visible && JSON.stringify(s.buttons) === '["A Space"]' && !s.texts.includes('WALK') && s.scale >= 2 && tapped && states.settings.settings && !states.closed.settings && states.won.texts.includes('YOU WIN!') && !clean(states).length,
          `Coin Garden on a ${w}x${h} phone: two CSS pixels a pixel at least, the A button (jump) alone and no legend, the ⚙ opens the settings and Close closes them (real taps), won; every text inside the HUD and clear of the controls, every tap target reachable (${clean(states).join('; ') || say(states)})`,
        );
      },
      `Coin Garden on a ${w}x${h} phone`,
      phone(w, h),
    );
    await play(
      'examples/beacon-yard.html',
      async (page) => {
        await helpers(page);
        const states = { far: await look(page, shot('beacon-yard', 'far')) };
        await page.evaluate(() => window.__PIXEL_ENGINE__.game.at.set(-6, 0.6, -4));
        states.near = await look(page, shot('beacon-yard', 'near'));
        // a real tap on ≡: the pause menu, the touch controls out of its way
        const paused = await tapOn(page, '.touch-ui > button[data-i="1"]');
        states.menu = await look(page, shot('beacon-yard', 'menu'), ROW);
        const [resume, settings] = states.menu.rows;
        // a real tap on the left edge of Settings opens the engine's settings; their Close goes back to the menu
        if (settings) await page.touchscreen.tap(settings.x + settings.w * 0.04, settings.y);
        states.settings = await look(page, shot('beacon-yard', 'settings'));
        await tapOn(page, '.settings-ui [data-act="close"]');
        states.back = await look(page, shot('beacon-yard', 'back'), ROW);
        // a real tap on the right edge of Resume: playing again, the controls back
        if (resume) await page.touchscreen.tap(resume.x + resume.w * 0.96, resume.y);
        states.resumed = await look(page, shot('beacon-yard', 'resumed'));
        await page.evaluate(() => {
          const e = window.__PIXEL_ENGINE__;
          for (const beacon of e.game.beacons) e.game.light(e.context, beacon);
        });
        states.lit = await look(page, shot('beacon-yard', 'lit'));
        const { far, near, menu } = states;
        check(
          far.device === 'touch' &&
            JSON.stringify([far.buttons, near.buttons, states.lit.buttons]) === JSON.stringify([['LIGHT KeyE hidden', '≡ Escape'], ['LIGHT KeyE', '≡ Escape'], ['LIGHT KeyE hidden', '≡ Escape']]) &&
            /light a beacon/i.test(far.texts.join(' ')) &&
            paused &&
            menu.status.endsWith(', menu') &&
            !menu.visible &&
            !menu.zone &&
            menu.rows.length === 3 &&
            menu.texts.includes('SELECT') &&
            states.settings.settings &&
            !states.back.settings &&
            states.back.status.endsWith(', menu') &&
            !states.resumed.status.endsWith(', menu') &&
            states.resumed.visible &&
            states.lit.status.startsWith('beacons 4/4') &&
            states.lit.texts.length >= 2 &&
            !clean(states).length,
          `Beacon Yard on a ${w}x${h} phone: LIGHT only by a dark beacon, ≡ (a real tap) opens the menu with no stick, zone or button over its rows or legend, a tap on a row's left edge opens the settings and on its right edge resumes, the controls come back; all lit, every text inside the HUD and clear of the controls, every tap target reachable (${clean(states).join('; ') || say(states)})`,
        );
      },
      `Beacon Yard on a ${w}x${h} phone`,
      phone(w, h),
    );
    await play(
      'examples/gem-rush.html',
      async (page) => {
        await helpers(page);
        const states = { playing: await look(page, shot('gem-rush', 'playing')) };
        const tapped = await tapOn(page, '.settings-button');
        states.settings = await look(page, shot('gem-rush', 'settings'));
        await tapOn(page, '.settings-ui [data-act="close"]');
        await gemEnd(page, true);
        states.cleared = await look(page, shot('gem-rush', 'cleared'));
        await gemEnd(page, false);
        states.failed = await look(page, shot('gem-rush', 'failed'));
        const ready = await gemRound(page);
        states.waiting = await look(page, shot('gem-rush', 'waiting'));
        const countdown = await gemStart(page);
        states.countdown = await look(page, shot('gem-rush', 'countdown'));
        const p = states.playing;
        check(
          p.device === 'touch' &&
            p.visible &&
            p.zone &&
            p.buttons.length === 0 &&
            tapped &&
            states.settings.settings &&
            states.cleared.texts.includes('CLEARED!') &&
            states.failed.texts.includes('TIME!') &&
            ready &&
            countdown > 0 &&
            countdown < Infinity &&
            !states.countdown.visible &&
            !clean(states).length,
          `Gem Rush on a ${w}x${h} phone: a floating stick and no buttons, the ⚙ opens the settings, cleared and failed, a moment's round readied up and counting down with the stick away; every text inside the HUD and clear of the controls (its time clear of the ⚙), every tap target reachable (${clean(states).join('; ') || say({ ...states, countdown: { ...states.countdown, status: `${states.countdown.status} (${countdown})` } })})`,
        );
      },
      `Gem Rush on a ${w}x${h} phone`,
      phone(w, h),
    );
  }

  // on a TV with a pad: the prompts and legends are the pad's, Options opens the menu or the settings
  const tvShot = (page, state) => `tv-${page}-${state}`;
  await play(
    'index.html',
    async (page) => {
      await helpers(page);
      await page.evaluate(() => window.__kit.press(0)); // Cross: the pad is the device in use
      const states = { playing: await look(page, tvShot('coin-garden', 'playing')) };
      await page.evaluate(() => window.__kit.press(9)); // Options, let go
      states.settings = await look(page, tvShot('coin-garden', 'settings'));
      await page.evaluate(() => window.__kit.press(1)); // Circle
      states.closed = await look(page, tvShot('coin-garden', 'closed'));
      await collectCoins(page);
      states.won = await look(page, tvShot('coin-garden', 'won'));
      await page.evaluate(() => window.__PIXEL_ENGINE__.input.setGamepads(null));
      const s = states.playing;
      check(
        s.device === 'pad' && !s.visible && ['WALK', 'JUMP', 'SETTINGS'].every((t) => s.texts.includes(t)) && states.settings.settings && !states.closed.settings && states.won.texts.includes('YOU WIN!') && !clean(states).length,
        `Coin Garden on a TV with a pad: the pad's legend, Options opens the settings and Circle closes them, won; every text inside the HUD (${clean(states).join('; ') || say(states)})`,
      );
    },
    'Coin Garden on a TV with a pad',
    TV,
  );
  await play(
    'examples/beacon-yard.html',
    async (page) => {
      await helpers(page);
      await page.evaluate(() => window.__kit.press(0));
      const states = { far: await look(page, tvShot('beacon-yard', 'far')) };
      await page.evaluate(() => window.__PIXEL_ENGINE__.game.at.set(-6, 0.6, -4));
      states.near = await look(page, tvShot('beacon-yard', 'near'));
      await page.evaluate(() => window.__kit.press(9)); // Options: the menu
      states.menu = await look(page, tvShot('beacon-yard', 'menu'), ROW);
      await page.evaluate(async () => {
        await window.__kit.press(13); // the d-pad down: Settings
        await window.__kit.press(0); // Cross
      });
      states.settings = await look(page, tvShot('beacon-yard', 'settings'));
      for (let i = 0; i < 3 && (await page.evaluate(() => window.__PIXEL_ENGINE__.settings.isOpen || window.__PIXEL_ENGINE__.game.menu)); i++) await page.evaluate(() => window.__kit.press(1)); // Circle, Circle
      states.resumed = await look(page, tvShot('beacon-yard', 'resumed'));
      await page.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        for (const beacon of e.game.beacons) e.game.light(e.context, beacon);
        e.input.setGamepads(null);
      });
      states.lit = await look(page, tvShot('beacon-yard', 'lit'));
      const { far, near, menu } = states;
      check(
        far.device === 'pad' &&
          far.texts.includes('MENU') &&
          near.texts.includes('LIGHT') &&
          menu.status.endsWith(', menu') &&
          menu.texts.includes('SELECT') &&
          states.settings.settings &&
          !states.resumed.settings &&
          !states.resumed.status.endsWith(', menu') &&
          states.lit.status.startsWith('beacons 4/4') &&
          !clean(states).length,
        `Beacon Yard on a TV with a pad: MENU and LIGHT prompts, Options opens the menu, the d-pad and Cross its Settings, Circle back out; all lit; every text inside the HUD (${clean(states).join('; ') || say(states)})`,
      );
    },
    'Beacon Yard on a TV with a pad',
    TV,
  );
  await play(
    'examples/gem-rush.html',
    async (page) => {
      await helpers(page);
      await page.evaluate(() => window.__kit.press(0));
      const states = { playing: await look(page, tvShot('gem-rush', 'playing')) };
      await page.evaluate(() => window.__kit.press(9)); // alone, Options opens the settings as it is let go
      states.settings = await look(page, tvShot('gem-rush', 'settings'));
      await page.evaluate(() => window.__kit.press(1));
      states.closed = await look(page, tvShot('gem-rush', 'closed'));
      await gemEnd(page, true);
      states.cleared = await look(page, tvShot('gem-rush', 'cleared'));
      await gemEnd(page, false);
      states.failed = await look(page, tvShot('gem-rush', 'failed'));
      const ready = await gemRound(page);
      states.waiting = await look(page, tvShot('gem-rush', 'waiting'));
      const countdown = await gemStart(page);
      states.countdown = await look(page, tvShot('gem-rush', 'countdown'));
      await page.evaluate(() => window.__PIXEL_ENGINE__.input.setGamepads(null));
      check(
        states.playing.device === 'pad' &&
          states.settings.settings &&
          !states.closed.settings &&
          states.cleared.texts.includes('CLEARED!') &&
          states.failed.texts.includes('TIME!') &&
          ready &&
          countdown > 0 &&
          countdown < Infinity &&
          !clean(states).length,
        `Gem Rush on a TV with a pad: alone, Options opens the settings and Circle closes them; cleared, failed, a moment's round counting down; every text inside the HUD (${clean(states).join('; ') || say(states)})`,
      );
    },
    'Gem Rush on a TV with a pad',
    TV,
  );

  // The kit's other recipes (GUIDE.md's Cliff Run, RECIPES.md's Lantern Night and Look Lab,
  // ASSETS.md's Market Corner) on the same phones and TV: the touch buttons their guide gives them
  // (none where walking does it all; Market Corner, with nothing to press, keeps the stick away too),
  // no legend while the touch controls show and the pad's on a TV, the ⚙ (a real tap) or Options
  // opening the settings, and each one's own states (Look Lab's looks picked by real taps on > < PX
  // and by R1 L1 Triangle, the hero standing through them); every HUD text inside the HUD and clear
  // of the controls, every tap target reachable, two CSS pixels a pixel at least on a phone.
  const RECIPES = [
    {
      page: 'examples/side-scroller.html',
      name: 'Cliff Run',
      buttons: ['A Space'],
      legend: ['RUN', 'JUMP', 'SETTINGS'],
      /** A real tap on A (Cross on a pad) jumps; the flag reached, LEVEL CLEAR! in the middle. */
      async more(page, at, device) {
        const jumps = () => page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.stats.jumps);
        const before = await jumps();
        if (device === 'touch') await tapOn(page, '.touch-ui button[data-i="0"]'); // in the buttons' grid
        else await page.evaluate(() => window.__kit.press(0));
        await at('jumped');
        const jumped = (await jumps()) > before;
        await page.evaluate(() => {
          const e = window.__PIXEL_ENGINE__;
          e.game.clear(e.context);
        });
        const clear = await at('clear');
        return [jumped && clear.texts.includes('LEVEL CLEAR!'), `${device === 'touch' ? 'a tap on A' : 'Cross'} jumps (${jumped}), LEVEL CLEAR!`];
      },
    },
    {
      page: 'examples/top-down.html',
      name: 'Lantern Night',
      buttons: [],
      legend: ['WALK', 'SETTINGS'],
      /** The goal on screen, then both pads lit (the gate open) and out through it. */
      async more(page, at) {
        const goal = /CRATES ONTO PADS/.test((await at('goal')).texts.join(' '));
        await page.evaluate(() => window.__PIXEL_ENGINE__.game.pads.forEach((p) => (p.lit = true)));
        const open = await at('open');
        await page.evaluate(() => {
          const e = window.__PIXEL_ENGINE__;
          e.game.escape(e.context);
        });
        const escaped = await at('escaped');
        return [goal && open.texts.includes('GATE OPEN') && escaped.texts.includes('YOU ESCAPED!'), 'the goal, the gate open, escaped'];
      },
    },
    {
      page: 'examples/looks.html',
      name: 'Look Lab',
      buttons: ['> KeyE', '< KeyQ', 'PX KeyT'],
      legend: ['PREV', 'NEXT', 'CHUNKY', 'WALK', 'SETTINGS'],
      /** The next look, the one before, chunky pixels: real taps on > < PX, or R1 L1 Triangle (the hero's lie, prone and grab, taken off it here). */
      async more(page, at, device) {
        const seen = [];
        for (const [state, button, i] of [['next', 5, 0], ['prev', 4, 1], ['chunky', 3, 2]]) {
          if (device === 'touch') await tapOn(page, `.touch-ui button[data-i="${i}"]`);
          else await page.evaluate((b) => window.__kit.press(b), button);
          seen.push((await at(state)).status);
        }
        const r = await page.evaluate(() => ({ size: window.__PIXEL_ENGINE__.look.actors.pixel?.size, hero: window.__PIXEL_ENGINE__.game.hero.state }));
        seen.push(r.size, /prone|crawl|lie|lying|grab/i.test(r.hero) ? r.hero : 'standing');
        return [JSON.stringify(seen) === JSON.stringify(['look pixel heroes', 'look storybook heroes', 'look storybook heroes', 3, 'standing']), seen.join(', ')];
      },
    },
    {
      page: 'examples/market.html',
      name: 'Market Corner',
      buttons: [],
      legend: ['SETTINGS'],
      away: true, // nothing to press: no stick either
      more: async () => [true, 'nothing to press'],
    },
  ];
  for (const r of RECIPES) {
    const id = r.page.replace(/^examples\/|\.html$/g, '');
    for (const [w, h] of PHONES) {
      await play(
        r.page,
        async (page) => {
          await helpers(page);
          const states = {};
          const at = async (state) => (states[state] = await look(page, `phone-${id}-${state}-${w}x${h}`));
          const s = await at('playing');
          const tapped = await tapOn(page, '.settings-button'); // a real tap on the ⚙, then on Close
          const settings = (await at('settings')).settings;
          await tapOn(page, '.settings-ui [data-act="close"]');
          const closed = !(await at('closed')).settings;
          const [ok, did] = await r.more(page, at, 'touch');
          check(
            s.device === 'touch' && s.visible === !r.away && JSON.stringify(s.buttons) === JSON.stringify(r.buttons) && !r.legend.some((t) => s.texts.includes(t)) && s.scale >= 2 && tapped && settings && closed && ok && !clean(states).length,
            `${r.name} on a ${w}x${h} phone: two CSS pixels a pixel at least, ${r.away ? 'no touch controls' : `the stick and ${r.buttons.length ? r.buttons.join(', ') : 'no buttons'}`} and no legend, the ⚙ opens the settings and Close closes them (real taps), ${did}; every text inside the HUD and clear of the controls, every tap target reachable (${clean(states).join('; ') || say(states)})`,
          );
        },
        `${r.name} on a ${w}x${h} phone`,
        phone(w, h),
      );
    }
    await play(
      r.page,
      async (page) => {
        await helpers(page);
        const states = {};
        const at = async (state) => (states[state] = await look(page, tvShot(id, state)));
        await page.evaluate(() => window.__kit.press(0)); // Cross: the pad is the device in use
        const s = await at('playing');
        await page.evaluate(() => window.__kit.press(9)); // Options, let go
        const settings = (await at('settings')).settings;
        await page.evaluate(() => window.__kit.press(1)); // Circle
        const closed = !(await at('closed')).settings;
        const [ok, did] = await r.more(page, at, 'pad');
        await page.evaluate(() => window.__PIXEL_ENGINE__.input.setGamepads(null));
        check(
          s.device === 'pad' && !s.visible && r.legend.every((t) => s.texts.includes(t)) && settings && closed && ok && !clean(states).length,
          `${r.name} on a TV with a pad: the pad's legend (${r.legend.join(' ')}), Options opens the settings and Circle closes them, ${did}; every text inside the HUD (${clean(states).join('; ') || say(states)})`,
        );
      },
      `${r.name} on a TV with a pad`,
      TV,
    );
  }

  // Gem Rush's own page in a 52in1 round of moments: the head's tags (headSession) and the hub's
  // client as window.AIHub (a LocalHub here, its clock moved by real time) make HubSession.join find
  // the round, as in 52in1. The game readies up by itself and plays the round; there is no ⚙, and
  // neither Esc nor Options opens the settings or pauses: the round's clock never stops.
  const roundDir = new URL('round/', out);
  await mkdir(new URL('examples/', roundDir), { recursive: true });
  await symlink(join(kitPath, 'pixel-engine.js'), fileURLToPath(new URL('pixel-engine.js', roundDir)));
  await symlink(join(kitPath, 'examples/gem-rush.js'), fileURLToPath(new URL('examples/gem-rush.js', roundDir)));
  // its tags as the kit's page has them
  const tags = [...(await readFile(new URL('examples/gem-rush.html', kit), 'utf8')).matchAll(/^ *<meta name="hub:[^>]*>$/gm)].map((m) => m[0].trim()).join('\n');
  await writeFile(
    new URL('examples/round.html', roundDir),
    `<!doctype html><html><head><meta charset="utf-8">${tags}<link rel="icon" href="data:,"><style>html, body { margin: 0; height: 100%; } #app { position: fixed; inset: 0; }</style></head><body><div id="app"></div>
<script type="module">
import { LocalHub } from '../pixel-engine.js';
const hub = (window.__hub = new LocalHub({ mode: 'moments', moment: { id: 'gem-hunt', seconds: 15 }, players: 1, seed: 3 }));
window.AIHub = hub.client(0);
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  hub.advance(now - last);
  last = now;
}, 20);
await import('./gem-rush.js');
</script></body></html>`,
  );
  const roundServer = await serve(fileURLToPath(roundDir));
  try {
    for (const [where, options] of [
      ['a phone', phone(390, 844)],
      ['a TV with a pad', TV],
    ]) {
      await play(
        `http://127.0.0.1:${roundServer.address().port}/examples/round.html`,
        async (page) => {
          await helpers(page);
          const r = await page.evaluate(async () => {
            const e = window.__PIXEL_ENGINE__;
            const hub = window.__hub;
            e.manual = false;
            for (let i = 0; i < 120 && !hub.allReady; i++) await window.__kit.frames(1);
            const ready = hub.allReady;
            hub.start();
            for (let i = 0; i < 400 && e.game.countdown > 0; i++) await window.__kit.frames(1);
            const playing = e.game.countdown <= 0 && !e.game.over;
            // Esc, then Options (let go), while the round plays
            e.input.setKey('Escape', true);
            await window.__kit.frames(2);
            e.input.setKey('Escape', false);
            await window.__kit.press(9);
            return { ready, playing, mode: e.game.session?.info.mode, moment: e.game.moment, gear: !!document.querySelector('.settings-button'), settings: e.settings.isOpen, paused: e.paused };
          });
          check(
            r.ready && r.playing && r.mode === 'moments' && r.moment === 'gem-hunt' && !r.gear && !r.settings && !r.paused,
            `Gem Rush's page in a 52in1 round on ${where}: it joins the round from its head (window.AIHub), readies up by itself and plays it; no ⚙, and Esc and Options neither open the settings nor pause (${JSON.stringify(r)})`,
          );
          await page.evaluate(() => window.__PIXEL_ENGINE__.input.setGamepads(null));
        },
        `Gem Rush in a round on ${where}`,
        options,
      );
    }
  } finally {
    roundServer.close();
  }

  // Gem Rush's page as the kit hands it out in 52in1's own session harness (scripts/hub/harness/,
  // vendored unmodified), as 52in1 checks a game joining its library: a parallel round of two, cut
  // short by the hub's clock (each copy reports its score at time-up)
  const harnessDir = new URL('harness/', out);
  await mkdir(new URL('examples/', harnessDir), { recursive: true });
  for (const f of HARNESS_FILES) await symlink(fileURLToPath(new URL(`scripts/hub/harness/${f}`, root)), fileURLToPath(new URL(f, harnessDir)));
  await symlink(join(kitPath, 'pixel-engine.js'), fileURLToPath(new URL('pixel-engine.js', harnessDir)));
  for (const f of ['gem-rush.html', 'gem-rush.js']) await symlink(join(kitPath, 'examples', f), fileURLToPath(new URL(`examples/${f}`, harnessDir)));
  const harnessServer = await serve(fileURLToPath(harnessDir));
  let hub;
  try {
    hub = await launch(exe, s);
    const q = 'mode=parallel&players=2&limit=12';
    const r = await harness(hub.browser, `http://127.0.0.1:${harnessServer.address().port}/harness.html?game=examples/gem-rush.html&${q}&auto=1`);
    check(r.pass, `Gem Rush's page in 52in1's session harness (${q}): ${r.error ? `the harness ran (${r.error})` : `the hub's checks pass (${r.checks})${r.bad.length ? '\n    ' + r.bad.join('\n    ') : ''}`}`);
  } catch (e) {
    check(false, `Gem Rush in 52in1's session harness crashed: ${e.message}`);
  } finally {
    await hub?.browser.close();
    harnessServer.close();
  }

  await play(
    'examples/market.html',
    async (page) => {
      const r = await page.evaluate(async () => {
        const e = window.__PIXEL_ENGINE__;
        const g = e.game;
        e.step(10);
        const floor = e.scene.children.find((o) => o.isMesh && o.material?.map);
        const frame = await e.renderer.capture();
        const counts = new Map();
        for (let i = 0; i < frame.pixels.length; i += 4) {
          const c = (frame.pixels[i] << 16) | (frame.pixels[i + 1] << 8) | frame.pixels[i + 2];
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        return {
          status: e.state().status,
          models: g.placed.map((m) => m.id),
          inScene: g.placed.every((m) => m.object.parent === e.scene && m.object.children.length > 0),
          ownStall: !!e.scene.getObjectByName('fruit-stall'),
          lights: e.lights.stats().requests,
          lit: g.lights.every((l) => l.alive),
          floor: floor?.material.map.name ?? null,
          colliders: e.physics.counts().colliders,
          colours: counts.size,
          top: Math.max(...counts.values()) / (frame.pixels.length / 4),
        };
      });
      check(
        r.status === 'market: 9 models, 1 light' && r.models.length === 9 && r.inScene && r.ownStall && r.lights >= 1 && r.lit && r.floor === 'tex:cobbles' && r.colliders >= 10,
        `Market Corner: 9 models built and placed (the game's own fruit-stall among them), the lamp's light requested, the floor's map is cobbles, ${r.colliders} colliders (${r.status})`,
      );
      check(r.colours >= 24 && r.top < 0.6, `Market Corner draws a picture: ${r.colours} colours, the commonest covers ${(r.top * 100).toFixed(0)}%`);
    },
    'Market Corner',
  );

  console.log('\n▶ bundle: check.mjs --sheets');
  try {
    const pngSize = async (file) => {
      const b = await readFile(file);
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    const ok = await checkTool('', ['--sheets', `${join(kitPath, 'examples/market-models.js')},market-stall,cobbles`, '--out', fileURLToPath(new URL('sheets', out))]);
    const r = await report('sheets');
    const ids = r.sheets.map((x) => `${x.kind} ${x.id}`);
    const sizes = await Promise.all(r.sheets.map((x) => (x.file ? pngSize(x.file) : [0, 0])));
    check(
      ok.code === 0 && r.ok && ids.join() === 'model fruit-stall,model market-stall,texture cobbles' && r.sheets.every((x) => !x.problems.length) && sizes.every(([w, h]) => w >= 600 && h >= 300),
      `the market's own stall and two library ids, one sheet each (${ids.join(', ')}; ${sizes.map((x) => x.join('x')).join(', ')})${ok.code ? ':\n    ' + tail(ok.out) : ''}`,
    );
    // a broken def, a module with no defs, an unknown id: exit 1, saying what is wrong
    const bad = new URL('sheets-bad/', out);
    await mkdir(bad, { recursive: true });
    await symlink(join(kitPath, 'pixel-engine.js'), fileURLToPath(new URL('pixel-engine.js', bad)));
    await writeFile(
      new URL('models.js', bad),
      `import { model } from './pixel-engine.js';
export const broken = model({ id: 'broken', about: 'A def with two mistakes', tags: ['test'], palette: { wood: 'orange' }, parts: [{ box: [1, 1, 1], at: [0, 0.5, 0], c: 'nope' }, { use: 'no-such-model' }] });
export const pole = model({ id: 'pole', about: 'A pole too thin to read', tags: ['test'], palette: { wood: 'orange' }, parts: [{ box: [0.03, 1.5, 0.03], at: [0, 0.75, 0] }] });
`,
    );
    await writeFile(new URL('empty.js', bad), 'export const answer = 42;\n');
    // a def a module adds to the library, exporting nothing, is the game's own too
    await writeFile(
      new URL('added.js', bad),
      `import { model, MODEL_LIBRARY } from './pixel-engine.js';
MODEL_LIBRARY.add(model({ id: 'stool-pair', about: 'Two library stools side by side', tags: ['test'], palette: { wood: 'orange' }, parts: [{ use: 'stool', at: [-0.3, 0, 0] }, { use: 'stool', at: [0.3, 0, 0] }] }));
`,
    );
    const added = await checkTool('', ['--sheets', fileURLToPath(new URL('added.js', bad)), '--out', fileURLToPath(new URL('sheets-added', out))]);
    const ar = await report('sheets-added');
    check(added.code === 0 && ar.sheets.map((x) => x.id).join() === 'stool-pair' && ar.sheets[0].file, `a def a module adds to MODEL_LIBRARY gets its sheet (${ar.sheets.map((x) => x.id).join()})${added.code ? ':\n    ' + tail(added.out) : ''}`);
    const broken = await checkTool('', ['--sheets', fileURLToPath(new URL('models.js', bad)), '--out', fileURLToPath(new URL('sheets-broken', out))]);
    const br = await report('sheets-broken');
    const by = Object.fromEntries(br.sheets.map((x) => [x.id, x]));
    check(
      broken.code === 1 && /'nope'/.test(by.broken?.problems.join()) && /no-such-model/.test(by.broken?.problems.join()) && by.broken?.file && by.pole?.problems.length === 0 && /0\.06/.test(by.pole?.warnings.join()) && /x .*'nope'/.test(broken.out),
      `a def with problems fails the check, naming them, and still gets a sheet; a warning alone passes (${broken.code}: broken ${by.broken?.problems.length} problems, pole ${by.pole?.warnings.length} warning)`,
    );
    // defs in an exported array or plain object count too; ids alone work from outside the kit
    await writeFile(
      new URL('grouped.js', bad),
      `import { model } from './pixel-engine.js';
const box = (id) => model({ id, about: 'A crate-sized box', tags: ['test'], palette: { wood: 'orange' }, parts: [{ box: [0.6, 0.6, 0.6], at: [0, 0.3, 0] }] });
export default [box('in-array')];
export const ALL = { inObject: box('in-object'), speed: 3 };
`,
    );
    const grouped = await checkTool('', ['--sheets', fileURLToPath(new URL('grouped.js', bad)), '--out', fileURLToPath(new URL('sheets-grouped', out))]);
    const gr = await sheetsReport('sheets-grouped');
    check(grouped.code === 0 && gr.sheets.map((x) => x.id).sort().join() === 'in-array,in-object', `defs in an exported array and a plain object get sheets (${gr.sheets.map((x) => x.id).join() || 'none'}; exit ${grouped.code})${grouped.code ? ':\n    ' + tail(grouped.out) : ''}`);
    const outside = await checkTool('', ['--sheets', 'crate', '--out', fileURLToPath(new URL('sheets-outside', out))]);
    const or = await sheetsReport('sheets-outside');
    check(outside.code === 0 && or.sheets.map((x) => x.id).join() === 'crate', `\`--sheets crate\` run from outside the kit draws with the kit check.mjs lives in (exit ${outside.code})${outside.code ? ':\n    ' + tail(outside.out) : ''}`);
    // a module whose top level never settles: reported after 30 s, not a hang
    await writeFile(new URL('hangs.js', bad), `import { model } from './pixel-engine.js';\nawait new Promise(() => {});\nexport const never = model({ id: 'never', about: 'x', tags: [], palette: { a: 'red' }, parts: [] });\n`);
    const t0 = Date.now();
    const hangs = await checkTool('', ['--sheets', fileURLToPath(new URL('hangs.js', bad)), '--out', fileURLToPath(new URL('sheets-hangs', out))]);
    check(hangs.code === 1 && /did not finish loading in 30 s/.test(hangs.out), `a module that never finishes loading fails in ${((Date.now() - t0) / 1000).toFixed(0)} s, saying so (exit ${hangs.code})${hangs.code !== 1 ? ':\n    ' + tail(hangs.out) : ''}`);
    const empty = await checkTool('', ['--sheets', fileURLToPath(new URL('empty.js', bad)), '--out', fileURLToPath(new URL('sheets-empty', out))]);
    const unknown = await checkTool('', ['--sheets', `${join(kitPath, 'examples/market-models.js')},no-such-model`, '--out', fileURLToPath(new URL('sheets-unknown', out))]);
    const missing = await checkTool('', ['--sheets', fileURLToPath(new URL('nothing-here.js', bad))]);
    const both = await checkTool(join(kitPath, 'index.html'), ['--sheets', 'crate']);
    const blank = await checkTool('', ['--sheets', '', '--out', fileURLToPath(new URL('sheets-blank', out))]);
    check(
      empty.code === 1 && /exports no ModelDef/.test(empty.out) && unknown.code === 1 && /no model or texture "no-such-model"/.test(unknown.out) && missing.code === 2 && /no such module/.test(missing.out) && both.code === 2 && blank.code === 2 && /--sheets needs modules/.test(blank.out),
      `a module with no defs, an unknown id (exit 1), a missing module, a page with --sheets and an empty --sheets (exit 2) say so (${empty.code}, ${unknown.code}, ${missing.code}, ${both.code}, ${blank.code})`,
    );
  } catch (e) {
    check(false, `check.mjs --sheets: ${e.message}`);
  }

  console.log('\n▶ bundle: errors are reported');
  const errDir = new URL('errors/', out);
  await mkdir(errDir, { recursive: true });
  await symlink(join(kitPath, 'pixel-engine.js'), fileURLToPath(new URL('pixel-engine.js', errDir)));
  const page = (script) => `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="app"></div><script type="module" src="./${script}"></script></body></html>`;
  const game = (body) => `import { Engine, THREE } from './pixel-engine.js';
const v = new THREE.Vector3();
await Engine.start({ name: 'Broken', frames: 0, ${body}, cameraTarget: () => v, status() { return 'frame ' + this.frames; } }, { container: document.getElementById('app') });
`;
  await writeFile(new URL('update.html', errDir), page('update.js'));
  await writeFile(new URL('update.js', errDir), game(`setup() {}, update() { if (++this.frames === 10) throw new Error('boom at frame 10'); }`));
  await writeFile(new URL('setup.html', errDir), page('setup.js'));
  await writeFile(new URL('setup.js', errDir), game(`setup() { throw new Error('no level here'); }`));
  const server = await serve(fileURLToPath(errDir));
  let ctx;
  try {
    ctx = await launch(exe, s);
    await ctx.page.goto(`http://127.0.0.1:${server.address().port}/update.html`);
    await ready(ctx.page);
    // the render loop catches it (step() would throw it to its caller, for tools)
    await ctx.page.waitForFunction(() => window.__PIXEL_ENGINE__.game.frames > 20, null, { timeout: 90000 });
    const r = await ctx.page.evaluate(() => ({ errors: window.__PIXEL_ENGINE__.errors, frames: window.__PIXEL_ENGINE__.game.frames, box: document.querySelector('[data-engine-error]')?.textContent ?? '' }));
    check(r.errors.join() === 'Error: boom at frame 10' && r.box.includes('GAME ERROR: Error: boom at frame 10'), `a throwing update() is caught, logged once, shown on screen and the game runs on (${r.frames} frames, box "${r.box.slice(0, 48)}…")`);
    await ctx.browser.close();
    ctx = null;
    const t0 = Date.now();
    const res = await checkTool(fileURLToPath(new URL('update.html', errDir)), ['--out', fileURLToPath(new URL('errors/check-update', out))]);
    check(res.code === 1 && /error: game: Error: boom at frame 10/.test(res.out) && (await report('errors/check-update')).shots.length === 1, `check.mjs fails on it, naming the error, and still takes the shot${res.code !== 1 ? ':\n    ' + tail(res.out) : ''}`);
    const res2 = await checkTool(fileURLToPath(new URL('setup.html', errDir)), ['--out', fileURLToPath(new URL('errors/check-setup', out))]);
    const secs = (Date.now() - t0) / 1000;
    check(res2.code === 1 && /Failed to start: no level here/.test(res2.out), `a setup() that throws: "Failed to start", check.mjs exits 1 (both checks ${secs.toFixed(0)} s)${res2.code !== 1 ? ':\n    ' + tail(res2.out) : ''}`);
  } catch (e) {
    check(false, `errors: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
    server.close();
  }

  // the kit in Node (Engine.headless, check.mjs --headless): from a copy of dist/engine/ alone, with
  // no node_modules above it (Rapier's wasm and the built-in models come from pixel-engine.js)
  console.log('\n▶ bundle: check.mjs --headless (the kit in Node, no browser)');
  const node = await mkdtemp(join(tmpdir(), 'pixel-kit-node-'));
  try {
    await cp(kitPath, node, { recursive: true });
    const headless = (module, args = []) => run('node', [join(node, 'check.mjs'), '--headless', module, '--out', join(node, 'check'), ...args]);
    const t0 = Date.now();
    const res = await headless(join(node, 'game.js'), ['--keys', 'KeyD*40,Space*5,KeyW*60']);
    const r = existsSync(join(node, 'check/report.json')) ? JSON.parse(await readFile(join(node, 'check/report.json'), 'utf8')) : {};
    check(
      res.code === 0 && r.ok && r.frames === 105 && r.state?.backend === 'headless' && /^coins \d\/4$/.test(r.status ?? '') && r.fingerprint && r.replayed === r.fingerprint && r.errors.length === 0,
      `the starter boots, plays 105 frames and replays to the same fingerprint in Node from the kit alone (${r.status}, ${r.fingerprint}, ${((Date.now() - t0) / 1000).toFixed(1)} s)${res.code ? ':\n    ' + tail(res.out) : ''}`,
    );
    // a game that throws, and one a replay can't repeat (Math.random in play): both fail
    const broken = (body) => `import { THREE } from './pixel-engine.js';
const v = new THREE.Vector3();
export const createGame = () => ({ name: 'Broken', frames: 0, x: 0, setup() {}, ${body}, cameraTarget: () => v });
`;
    await writeFile(join(node, 'throws.js'), broken(`update() { if (++this.frames === 10) throw new Error('boom at frame 10'); }`));
    await writeFile(join(node, 'random.js'), broken(`fixedUpdate() { this.x += Math.random(); }, fingerprint() { return String(this.x); }`));
    const thrown = await headless(join(node, 'throws.js'));
    check(thrown.code === 1 && /error: .*boom at frame 10/.test(thrown.out), `a game that throws in update(): --headless names the error and exits 1${thrown.code !== 1 ? ':\n    ' + tail(thrown.out) : ''}`);
    const random = await headless(join(node, 'random.js'));
    check(random.code === 1 && /\(not the same\)/.test(random.out), `a game a replay can't repeat (Math.random): --headless says the replay ends elsewhere and exits 1${random.code !== 1 ? ':\n    ' + tail(random.out) : ''}`);
    await writeFile(join(node, 'plain.js'), `export const level = 1;\n`);
    // a module that touches the page at import fails to load: exit 1 with the hint, and a report of its own (not the last run's)
    await writeFile(join(node, 'page.js'), `document.title = 'x';\nexport const createGame = () => ({});\n`);
    const paged = await headless(join(node, 'page.js'));
    const pr = JSON.parse(await readFile(join(node, 'check/report.json'), 'utf8'));
    check(paged.code === 1 && /document is not defined.*guard it, export createGame\(\)/.test(paged.out) && /page\.js$/.test(pr.module) && !pr.ok && /not replayed/.test(paged.out), `a module that touches \`document\` at import: exit 1, saying to guard it, in a report of its own${paged.code !== 1 ? ':\n    ' + tail(paged.out) : ''}`);
    // GUIDE.md's own test.mjs (section 8), as written, beside game.js
    const guide = await readFile(new URL('docs/GUIDE.md', root), 'utf8');
    const block = /```js\n(\/\/ test\.mjs[^\n]*\n[\s\S]*?)```/.exec(guide)?.[1];
    if (!block) throw new Error("GUIDE.md has no test.mjs block in section 8");
    await writeFile(join(node, 'test.mjs'), block);
    const own = await run('node', [join(node, 'test.mjs')]);
    check(own.code === 0 && /coins \d\/4 true/.test(own.out), `GUIDE.md's test.mjs, as written, plays the starter in Node and replays it ("${own.out.trim().split('\n').pop()}")`);
    const none = await headless(join(node, 'plain.js'));
    const page = await headless(join(node, 'index.html'));
    check(none.code === 2 && /exports no createGame/.test(none.out) && page.code === 2 && /not .*index\.html: pages need the browser/.test(page.out), `a module without createGame() or a page: exit 2, saying what it needs${none.code !== 2 || page.code !== 2 ? ':\n    ' + tail(none.out + page.out) : ''}`);
  } catch (e) {
    check(false, `check.mjs --headless: ${e.message}`);
  } finally {
    await rm(node, { recursive: true, force: true });
  }
}
