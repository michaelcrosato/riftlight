#!/usr/bin/env node
// check.mjs: play a Pixel Engine game in a real browser and report what happened.
// Ships in the engine bundle; run it before you hand a game back.
//
//   node check.mjs                       index.html next to this file
//   node check.mjs examples/side.html    any page (served from its own folder)
//   node check.mjs http://localhost:5173/
//
// Options:
//   --keys KeyD*60,Space*4,KeyW*30   hold each key for that many frames, in order (default: 90 idle frames)
//   --backend webgl|webgpu           webgl (default, works headless) or webgpu (needs a display, e.g. xvfb-run)
//   --cameras                        also shoot the iso, topdown, side and third camera presets
//   --looks pixel_heroes,noir        also shoot these looks (names from engine.lookPresets)
//   --out check                      folder for the PNGs and report.json (default: ./check)
//   --size 960x540                   viewport in CSS pixels
//
// It needs Playwright (`npm i -D playwright` then `npx playwright install chromium`), or set
// CHROMIUM_PATH to a Chromium/Chrome binary with `playwright-core` installed. Exit code 0
// means the game started, ran the frames with no errors (page, console, engine or GPU) and drew
// a picture; 1 means it didn't; 2 means the tool couldn't run.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

// --name value flags, then one positional page
const VALUE = new Set(['keys', 'backend', 'looks', 'out', 'size']);
const opts = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) positional.push(a);
  else if (VALUE.has(a.slice(2))) opts[a.slice(2)] = process.argv[++i] ?? '';
  else opts[a.slice(2)] = true;
}
const target = positional[0] ?? 'index.html';
const backend = opts.backend ?? 'webgl';
const out = resolve(opts.out ?? 'check');
const [vw, vh] = String(opts.size ?? '960x540').split('x').map(Number);
const keys = String(opts.keys ?? '*90')
  .split(',')
  .filter(Boolean)
  .map((s) => {
    const [code, n] = s.split('*');
    return { code: code || null, frames: Math.max(1, Number(n) || 1) };
  });
const looks = opts.looks ? String(opts.looks).split(',').filter(Boolean) : [];
const cameras = opts.cameras === true;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.md': 'text/plain', '.txt': 'text/plain' };

/** Serve a folder over HTTP (ES modules don't load from file://). */
function serve(dir) {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path === '/favicon.ico') {
        res.writeHead(204).end(); // browsers ask for one; not the game's problem
        return;
      }
      let file = join(dir, path);
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!file.startsWith(dir) || !existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
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
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
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
  const file = resolve(target);
  if (!existsSync(file)) {
    console.error(`check.mjs: no such page: ${file}`);
    process.exit(2);
  }
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
  url = `http://127.0.0.1:${server.address().port}/${relative(dir, file).split(sep).join('/')}`;
}

const report = { page: target, url, backend, ok: false, errors: [], warnings: [], shots: [], state: null };
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ARGS[backend] ?? ARGS.webgl, headless: backend === 'webgpu' ? !process.env.DISPLAY : true });
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
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 16) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    mkdirSync(out, { recursive: true });
    const file = join(out, `${name}.png`);
    writeFileSync(file, png({ width: f.width, height: f.height, pixels }));
    report.shots.push({ name, file, colors: colors.size });
    return colors.size;
  };

  const colors = await shoot(basename(target).replace(/\.html?$/, '') || 'page');
  if (colors < 8) report.errors.push(`blank frame: only ${colors} colours on screen`);
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
  await browser?.close();
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
