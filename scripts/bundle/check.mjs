#!/usr/bin/env node
// check.mjs: play a Pixel Engine game in a real browser and report what happened.
// Ships in the engine kit; run it before you hand a game back.
//
//   node check.mjs                       index.html in the current folder
//   node check.mjs examples/looks.html   any page (served from the folder that holds pixel-engine.js)
//   node check.mjs "index.html?look=noir&camera=side"   with URL flags
//   node check.mjs http://localhost:5173/
//
// Options:
//   --keys KeyD*60,Space*4,KeyW*30   hold each key for that many frames, in order (default: 90 idle frames)
//   --backend webgl|webgpu           webgl (default, works headless) or webgpu (needs a display, e.g. xvfb-run)
//   --cameras                        also shoot the iso, topdown, side and third camera presets
//   --looks pixel_heroes,noir        also shoot these looks (names from engine.lookPresets)
//   --out check                      folder for the PNGs and report.json (default: ./check)
//   --size 960x540                   viewport in CSS pixels
//   --help                           this text
//
// It needs Node 20.15+ (or 22.2+) and Playwright (`npm i -D playwright` then
// `npx playwright install chromium`), or `playwright-core` with CHROMIUM_PATH set to a
// Chromium/Chrome binary. Exit code 0 means the game started, ran the frames with no errors
// (page, console, engine or GPU) and drew a picture; 1 means it didn't; 2 means the tool
// couldn't run (bad arguments, no page, no browser).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as zlib from 'node:zlib';

const usage = () => readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0].replace(/^#!.*\n/, '').replace(/^\/\/ ?/gm, '');
const fail = (message) => {
  console.error(`check.mjs: ${message}\n\n${usage()}`);
  process.exit(2);
};
if (typeof zlib.crc32 !== 'function') fail(`needs Node 20.15+ or 22.2+ (this is ${process.version})`);

// --name value flags, --name flags, then one positional page
const VALUE = new Set(['keys', 'backend', 'looks', 'out', 'size']);
const FLAG = new Set(['cameras', 'help']);
const opts = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const name = a.slice(2);
  if (!a.startsWith('--')) positional.push(a);
  else if (VALUE.has(name)) {
    const v = process.argv[++i];
    if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`);
    opts[name] = v;
  } else if (FLAG.has(name)) opts[name] = true;
  else fail(`unknown option ${a}`);
}
if (opts.help) {
  console.log(usage());
  process.exit(0);
}
if (positional.length > 1) fail(`one page at a time (got ${positional.join(' ')})`);
const target = positional[0] ?? 'index.html';
const backend = opts.backend ?? 'webgl';
if (backend !== 'webgl' && backend !== 'webgpu') fail(`--backend is webgl or webgpu, not ${backend}`);
const out = resolve(opts.out ?? 'check');
const [vw, vh] = String(opts.size ?? '960x540').split('x').map(Number);
if (!(vw > 0 && vh > 0)) fail('--size is WIDTHxHEIGHT, e.g. 960x540');
const keys = String(opts.keys ?? '*90')
  .split(',')
  .filter(Boolean)
  .map((s) => {
    const [code, n] = s.split('*');
    if (code && !/^[A-Za-z][A-Za-z0-9]*$/.test(code)) fail(`--keys: "${code}" is not a key code (KeyD, Space, ArrowUp, Digit1, ...)`);
    return { code: code || null, frames: Math.max(1, Number(n) || 1) };
  });
const looks = opts.looks ? String(opts.looks).split(',').filter(Boolean) : [];
const cameras = opts.cameras === true;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.md': 'text/plain',
  '.txt': 'text/plain',
};

/** Serve a folder over HTTP (ES modules don't load from file://), and nothing outside it. */
function serve(dir) {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      let path;
      try {
        path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      } catch {
        res.writeHead(400).end('bad path');
        return;
      }
      if (path === '/favicon.ico') {
        res.writeHead(204).end(); // browsers ask for one; not the game's problem
        return;
      }
      let file = join(dir, path);
      const rel = relative(dir, file);
      if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

function png({ width, height, pixels }) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * row + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return (await import(name)).chromium;
    } catch {
      /* try the next */
    }
  }
  console.error('check.mjs needs Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const ARGS = {
  webgl: ['--disable-features=WebGPU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  webgpu: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-fallback-to-gl-for-testing'],
};
// Chromium's own notices about the fallback and software GL are not the game's problem.
const NOISE = [/GL Driver Message/, /Failed to create WebGPU Context Provider/, /WebGPU is not available, running under WebGL2 backend/];

const chromium = await loadPlaywright();
let server = null;
let url = target;
if (!/^https?:/.test(target)) {
  // A local page, maybe with URL flags: "index.html?look=noir"
  const [path, query = ''] = target.split(/\?(.*)/s);
  const file = resolve(path);
  if (!existsSync(file) || statSync(file).isDirectory()) fail(`no such page: ${file}`);
  // Serve from the folder that holds pixel-engine.js (so examples/x.html can import
  // '../pixel-engine.js'), else the page's own folder.
  let dir = dirname(file);
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, 'pixel-engine.js'))) {
      dir = d;
      break;
    }
    if (dirname(d) === d) break;
  }
  server = await serve(dir);
  url = `http://127.0.0.1:${server.address().port}/${relative(dir, file).split(sep).join('/')}${query ? `?${query}` : ''}`;
}

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ARGS[backend], headless: backend === 'webgpu' ? !process.env.DISPLAY : true });
} catch (e) {
  server?.close();
  console.error(`check.mjs: could not start Chromium: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  console.error('Install it (npx playwright install chromium) or set CHROMIUM_PATH.');
  process.exit(2);
}

const report = { page: target, url, backend, ok: false, errors: [], warnings: [], shots: [], state: null };
try {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    const text = m.text();
    if (NOISE.some((re) => re.test(text))) return;
    if (m.type() === 'error') report.errors.push(`console: ${text}`);
    else if (m.type() === 'warning') report.warnings.push(text);
  });
  page.on('pageerror', (e) => report.errors.push(`page: ${e.message}`));
  await page.goto(url);
  // Wait for the second frame or a start-up failure. An error before the engine runs (a
  // missing module, a syntax error) means it never will: give it 5 s, then stop waiting.
  const t0 = Date.now();
  let firstError = 0;
  for (;;) {
    const s = await page.evaluate(() => ({ frame: window.__PIXEL_ENGINE__?.frame ?? -1, fatal: document.querySelector('.fatal')?.textContent ?? null }));
    if (s.fatal) throw new Error(s.fatal);
    if (s.frame >= 2) break;
    if (report.errors.length && !firstError) firstError = Date.now();
    if (firstError && Date.now() - firstError > 5000) throw new Error('the game never started (see the errors above)');
    if (Date.now() - t0 > 120000) throw new Error('the game did not start within 120 s');
    await new Promise((r) => setTimeout(r, 250));
  }

  // Play: hold each key for its frames (frame-exact manual time). A hook that throws during
  // step() throws here: report it as the game's error, stop playing, still take the shots.
  for (const k of keys) {
    const thrown = await page.evaluate(({ code, frames }) => {
      const e = window.__PIXEL_ENGINE__;
      try {
        if (code) e.input.setKey(code, true);
        e.step(frames);
        if (code) e.input.setKey(code, false);
        e.step(1);
        return null;
      } catch (err) {
        if (code) e.input.setKey(code, false);
        return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
    }, k);
    if (thrown) {
      report.errors.push(`game: ${thrown} (while holding ${k.code ?? 'nothing'})`);
      break;
    }
  }

  const shoot = async (name) => {
    const f = await page.evaluate(async () => {
      const e = window.__PIXEL_ENGINE__;
      const frame = await e.renderer.capture();
      // the pixel HUD is its own canvas: put it on top, as the player sees it
      const hud = e.hud.canvas;
      let over = null;
      if (hud?.width) over = { w: hud.width, h: hud.height, data: Array.from(hud.getContext('2d').getImageData(0, 0, hud.width, hud.height).data) };
      let bin = '';
      for (let i = 0; i < frame.pixels.length; i += 0x8000) bin += String.fromCharCode(...frame.pixels.subarray(i, i + 0x8000));
      return { width: frame.width, height: frame.height, b64: btoa(bin), over };
    });
    const pixels = new Uint8Array(Buffer.from(f.b64, 'base64'));
    if (f.over) {
      const sx = f.width / f.over.w;
      const sy = f.height / f.over.h;
      for (let y = 0; y < f.height; y++)
        for (let x = 0; x < f.width; x++) {
          const i = (Math.floor(y / sy) * f.over.w + Math.floor(x / sx)) * 4;
          if (f.over.data[i + 3]) pixels.set(f.over.data.slice(i, i + 3), (y * f.width + x) * 4);
        }
    }
    // colours over a sample of pixels, and how much of the frame the commonest one covers
    const counts = new Map();
    let sampled = 0;
    for (let i = 0; i < pixels.length; i += 16, sampled++) {
      const c = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let most = 0;
    for (const n of counts.values()) most = Math.max(most, n);
    const top = most / Math.max(1, sampled);
    mkdirSync(out, { recursive: true });
    const file = join(out, `${name}.png`);
    writeFileSync(file, png({ width: f.width, height: f.height, pixels }));
    report.shots.push({ name, file, colors: counts.size, topColorShare: Number(top.toFixed(3)) });
    return { colors: counts.size, top };
  };

  const first = await shoot(basename(target.split('?')[0]).replace(/\.html?$/, '') || 'page');
  // Blank: one colour (nearly) everywhere. Low-colour looks (gameboy, onebit) have few
  // colours but are not blank.
  if (first.colors <= 2 || first.top > 0.99) report.errors.push(`blank frame: ${first.colors} colours, the commonest covers ${(first.top * 100).toFixed(1)}%`);
  for (const preset of cameras ? ['iso', 'topdown', 'side', 'third'] : []) {
    await page.evaluate((p) => {
      window.__PIXEL_ENGINE__.setCamera({ preset: p }, { syncUrl: false });
      window.__PIXEL_ENGINE__.step(20);
    }, preset);
    await shoot(`camera-${preset}`);
  }
  for (const look of looks) {
    const known = await page.evaluate((l) => {
      const e = window.__PIXEL_ENGINE__;
      if (!e.lookPresets[l]) return false;
      e.setLook(e.lookPresets[l]);
      e.step(2);
      return true;
    }, look);
    if (known) await shoot(`look-${look}`);
    else report.errors.push(`unknown look "${look}"`);
  }
  report.state = await page.evaluate(() => window.__PIXEL_ENGINE__.state());
  for (const e of report.state.errors ?? []) if (!report.errors.some((r) => r.startsWith(`game: ${e}`))) report.errors.push(`game: ${e}`);
  for (const e of report.state.gpuErrors ?? []) report.errors.push(`gpu: ${e.type} ${e.message}`);
  report.ok = report.errors.length === 0;
} catch (e) {
  report.errors.push(`check: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server?.close();
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const s = report.state;
console.log(`${report.ok ? 'OK' : 'FAILED'}  ${report.page}  (${backend}${s ? `, ${s.backend}, engine ${s.version}, ${s.frame} frames, "${s.status}"` : ''})`);
for (const shot of report.shots) console.log(`  shot ${shot.file}  (${shot.colors} colours)`);
for (const w of report.warnings.slice(0, 10)) console.log(`  warning: ${w}`);
for (const e of report.errors) console.log(`  error: ${e}`);
console.log(`  report ${join(out, 'report.json')}`);
process.exit(report.ok ? 0 : 1);
