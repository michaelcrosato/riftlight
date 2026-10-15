/* global window, document -- page.evaluate callbacks run in the browser */
// e2e suite "bundle": the engine kit that `npm run build` puts in dist/engine (scripts/bundle.mjs),
// used the way an agent outside this repo uses it:
//
//   files     README, GUIDE, ASSETS, LIBRARY, CREDITS, API, CHANGELOG, the engine with its types,
//             the starter game, one page per named game block of docs/GUIDE.md and
//             docs/GUIDE-ASSETS.md (its models module beside them, with no page), check.mjs;
//             manifest.json lists every file with its size; the zip holds them all; the handoff
//             page (/handoff/) links only files the kit ships.
//   types     a TypeScript game typechecks against pixel-engine.d.ts (strict, no skipLibCheck).
//   check     the kit's own check.mjs plays every page on WebGPU and the WebGL 2 fallback: exit
//             0, the expected backend, a picture; with --keys, --cameras and --looks it saves
//             every shot.
//   play      every recipe does what the guide says (WebGL 2): Coin Garden's coins, Cliff Run's
//             stomp, flag and next level, Lantern Night's crates, pads and gate, Look Lab's keys,
//             Market Corner's models, light and textured floor.
//   sheets    check.mjs --sheets draws the market's own models module and library ids (defs grouped
//             in arrays and objects too; ids from outside the kit), and fails, naming the problem,
//             on a broken def, a module with no defs or one that never loads, an unknown id.
//   errors    a game that throws in update() keeps rendering, shows the error box and fills
//             engine.errors; one whose setup() throws shows "Failed to start"; check.mjs exits 1
//             for both, fast.
//
// Shots land in .scratch/e2e/bundle/. Self-contained: e2e.mjs passes its helpers in.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

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
  const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

  console.log('\n▶ bundle: kit files');
  let manifest = { files: [], examples: [] };
  try {
    manifest = JSON.parse(await readFile(new URL('manifest.json', kit), 'utf8'));
    check(manifest.version === version, `manifest version ${manifest.version} is package.json's (${version})`);
    const need = ['README.md', 'GUIDE.md', 'ASSETS.md', 'LIBRARY.md', 'library.json', 'packs/index.json', 'CREDITS.md', 'API.md', 'CHANGELOG.md', 'LICENSE', 'pixel-engine.js', 'pixel-engine.d.ts', 'types/bundle.d.ts', 'index.html', 'game.js', 'check.mjs', 'manifest.json'];
    const listed = new Map(manifest.files.map((f) => [f.path, f.bytes]));
    check(need.every((f) => listed.has(f)), `the kit has ${need.join(', ')}`);
    check(manifest.examples.length >= 4 && manifest.examples.includes('examples/market.html'), `one page per guide recipe: ${manifest.examples.join(', ')}`);
    check(listed.has('examples/market-models.js') && !listed.has('examples/market-models.html'), "ASSETS.md's models module ships beside its game, with no page of its own");
    // every file but manifest.json itself carries its size
    const sizes = await Promise.all(manifest.files.map(async (f) => (f.path === 'manifest.json' ? undefined : (await stat(new URL(f.path, kit))).size)));
    check(manifest.files.every((f, i) => sizes[i] === f.bytes), `every listed file exists with its size (${manifest.files.length} files)`);
    const engine = await readFile(new URL('pixel-engine.js', kit), 'utf8');
    check(engine.startsWith(`/*! Pixel Engine ${version} `) && engine.length > 3e6 && !/new URL\(["'`][^"'`]*\.wasm/.test(engine), `pixel-engine.js is one self-contained module (${(engine.length / 1e6).toFixed(1)} MB, version banner, wasm inlined)`);
    const guide = await readFile(new URL('GUIDE.md', kit), 'utf8');
    check(guide.includes(`Pixel Engine **${version}**`), 'GUIDE.md is stamped with the version');
    const assets = await readFile(new URL('ASSETS.md', kit), 'utf8');
    check(assets.includes(`Pixel Engine **${version}**`) && assets.includes('```js market-models'), 'ASSETS.md (docs/GUIDE-ASSETS.md) is stamped with the version and holds the example');
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
    // The handoff page (public/handoff/index.html, served at /handoff/) is the link people give
    // agents. Its links are root-absolute (the site serves /handoff without the slash too), and
    // every way it points into the kit (an href, or the site's URL in its commands) names
    // engine.zip, the kit's folder or a file the kit ships.
    const handoff = await readFile(new URL('dist/handoff/index.html', root), 'utf8');
    const relative = [...handoff.matchAll(/\bhref\s*=\s*["']?([^"'\s>]*)/gi)].map((m) => m[1]).filter((h) => !/^(\/|https?:\/\/)/.test(h));
    const links = [...handoff.matchAll(/(?:\bhref\s*=\s*["']?|https:\/\/riftlight\.vercel\.app)\/(engine[^"'\s<>&]*)/gi)].map((m) => m[1]);
    const missing = links.filter((l) => (l === 'engine.zip' || l === 'engine/' ? !existsSync(new URL(`dist/${l}`, root)) : !(l.startsWith('engine/') && listed.has(l.slice('engine/'.length)))));
    check(
      /curl [^<]*https:\/\/riftlight\.vercel\.app\/engine\.zip\b/.test(handoff) && links.includes('engine/README.md') && links.includes('engine/GUIDE.md') && !missing.length && !relative.length,
      `handoff/index.html: its curl line fetches engine.zip, it links README.md and GUIDE.md, and its ${links.length} kit links are all kit files, root-absolute${missing.length ? `; missing: ${missing.join(', ')}` : ''}${relative.length ? `; relative: ${relative.join(', ')}` : ''}`,
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
  for (const [backend, expected] of [['webgpu', 'WebGPU'], ['webgl', 'WebGL 2 fallback']]) {
    for (const page of pages) {
      const name = `${backend}-${page.replace(/^examples\//, '').replace(/\.html$/, '')}`;
      try {
        const res = await checkTool(join(kitPath, page), ['--backend', backend, '--out', fileURLToPath(new URL(name, out))]);
        const r = await report(name);
        const colours = r.shots[0]?.colors ?? 0;
        check(res.code === 0 && r.ok && r.state?.backend === expected && colours >= 8, `${page} on ${expected}: ok, ${colours} colours, "${r.state?.status}"${res.code ? ':\n    ' + tail(res.out) : ''}`);
      } catch (e) {
        check(false, `${page} on ${backend}: ${e.message}`);
      }
    }
  }
  try {
    const res = await checkTool(join(kitPath, 'index.html'), ['--keys', 'KeyD*30,Space*2', '--cameras', '--looks', 'noir,handheld', '--out', fileURLToPath(new URL('flags', out))]);
    const r = await report('flags');
    // (handheld is a 4-shade palette: few colours, but not blank)
    check(res.code === 0 && r.shots.length === 7 && r.shots.every((s) => s.colors >= 4), `--keys --cameras --looks: 7 shots (${r.shots.map((s) => `${s.name} ${s.colors}`).join(', ')})${res.code ? ':\n    ' + tail(res.out) : ''}`);
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
  } catch (e) {
    check(false, `check.mjs flags: ${e.message}`);
  }

  console.log('\n▶ bundle: the recipes play as the guide says (WebGL 2)');
  const s = scenarios[1];
  const play = async (path, fn, label) => {
    let ctx;
    try {
      ctx = await launch(exe, s);
      await ctx.page.goto(`${base}engine/${path}`);
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
        press('Digit2');
        press('KeyT');
        seen.push(e.look.actors.pixel.size, e.look.environment.pixel);
        return seen;
      });
      check(JSON.stringify(r) === JSON.stringify(['look storybook heroes', 'look noir', true, 3, null]), `Look Lab: 4 picks noir, 2 the custom look, T makes its characters chunky (${JSON.stringify(r)})`);
    },
    'Look Lab',
  );

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
}
