// End-to-end verification in real Chromium, against the production build.
//
//   npm run build && npm run test:e2e      (wraps this in xvfb-run)
//
//   npm run test:e2e -- <suite|@group> ...   run some suites (CI runs the groups in parallel):
//     webgpu | webgl-fallback | webgl-forced | cameras | camera-swap | filters-webgpu |
//     filters-webgl | touch | phone | moves | lab | tools | systems;  groups: @core | @cameras | @filters
//   E2E_PORT=4301 npm run test:e2e         serve on another port (several runs on one machine)
//
// Core suites (one per backend path):
//   webgpu          native WebGPU (SwiftShader adapter in headless; real GPU elsewhere)
//   webgl-fallback  navigator.gpu disabled -> WebGPURenderer's built-in WebGL 2 backend
//   Both assert: expected backend in state + debug UI, zero GPU errors, zero console
//   errors/warnings, one canvas, gameplay responds to input, Raw 3D toggle keeps the same
//   renderer/canvas/camera/character, pixel mode is blocky while raw mode is not, 320x180
//   keeps framing.
//   webgl-forced    ?backend=webgl debug override: the forced backend is picked and reported,
//                   and it renders cleanly (the rest is the same backend as webgl-fallback).
//
// camera-swap     live preset swaps keep the player, coins and renderer (WebGPU + WebGL 2);
//                 a swapped-to fixed view survives reload.
// cameras         every camera preset renders, zooms (except first person), moves the
//                 character in its own basis; side locks the lane; free → fix → reload as fixed.
// filters-*       every post filter compiles and changes the frame on WebGPU and WebGL 2,
//                 with zero errors; Raw 3D mode bypasses filters.
// touch           phone-sized viewport: joystick, action buttons, drag-to-orbit, ⚙ panel.
// phone           portrait viewport fills the screen (adaptive aspect, integer blocks); a lost
//                 GPU device (WebGPU) / WebGL context is recovered with a working renderer.
// moves           the whole PlatformerCharacter moveset (scripts/e2e-moves.mjs).
// lab             Animation Lab (/lab.html): clips, metrics API, views, scrubbing, contact
//                 sheets, curves and the agent API; frames of a few clips saved. (Every clip's
//                 metrics are checked by the unit tests: src/engine/animation/animation.test.ts.)
// tools           agent tooling smoke tests: `npm run build:single` gives one self-contained
//                 HTML file that runs from file:// with zero errors and no network requests;
//                 `npm run film` films a short script and writes its PNG + JSON.
// systems         game systems (scripts/e2e-systems.mjs), WebGPU + WebGL 2: pixel HUD, audio,
//                 particles, coin triggers, gamepad, pause, hotkeys, engine.loadGame without
//                 leaks, textured toon materials, engine.dispose().
//
// The debug panel is off by default in production builds: every page gets ?debug=1 unless
// the suite asks for ?debug=0 (urlFor). "One canvas" means one rendering canvas: the pixel
// HUD is a 2D overlay canvas (data-hud) on top of it.
//
// Waiting: pages are ready once the engine has presented 2 frames. Software rendering in CI
// runs at a few frames per second, so the suites wait for conditions (`until`), game time or
// manual frames (`Engine.step`) rather than fixed frame counts wherever they can.
//
// Frames land in .scratch/e2e/.
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { MOVES, PAGE_HELPERS } from './e2e-moves.mjs';
import { runSystems } from './e2e-systems.mjs';

const PORT = Number(process.env.E2E_PORT) || 4179;
const BASE = `http://localhost:${PORT}/`;
const ROOT = new URL('../', import.meta.url);
const OUT = new URL('.scratch/e2e/', ROOT);
const EXE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const SCENARIOS = [
  {
    name: 'webgpu',
    url: BASE,
    // Vulkan SwiftShader adapter. In headless mode Chromium loses the WebGPU device as soon
    // as a canvas context presents, so the suite runs headful under Xvfb (see test:e2e).
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-vulkan=swiftshader',
      '--use-webgpu-adapter=swiftshader',
      '--disable-vulkan-fallback-to-gl-for-testing',
    ],
    backend: 'WebGPU',
  },
  {
    name: 'webgl-fallback',
    url: BASE,
    args: ['--disable-features=WebGPU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    backend: 'WebGL 2 fallback',
    // Expected when WebGPU is unavailable: Chrome and three.js each announce the fallback.
    expectedWarnings: [/Failed to create WebGPU Context Provider/, /WebGPU is not available, running under WebGL2 backend/],
  },
  {
    name: 'webgl-forced',
    url: `${BASE}?backend=webgl`,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    backend: 'WebGL 2 fallback',
  },
];

// Software-rasterizer driver chatter (ANGLE/SwiftShader performance notes), not app output.
const ENVIRONMENT_NOISE = [/GL Driver Message \(OpenGL, Performance/];

let failures = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  ✔ ${msg}`);
  } else {
    console.log(`  ✘ ${msg}`);
    failures++;
  }
}

async function resolveExecutable() {
  if (!EXE.endsWith('chromium')) return EXE;
  try {
    const dirs = (await readdir('/opt/pw-browsers')).filter((d) => /^chromium-\d+$/.test(d)).sort();
    const last = dirs.at(-1);
    if (last) return `/opt/pw-browsers/${last}/chrome-linux/chrome`;
  } catch {
    /* fall through */
  }
  return undefined; // let playwright find its own
}

async function startServer() {
  // Something already answering on the port would be tested instead of this build (e.g. a
  // leftover preview server from another checkout): refuse rather than test the wrong code.
  const taken = await fetch(BASE).then(() => true, () => false);
  if (taken) throw new Error(`port ${PORT} is already serving something; stop it or set E2E_PORT`);
  // detached: its own process group, so stopServer() ends npx *and* the vite it starts
  // (killing npx alone left vite running, holding the port).
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  let exited = false;
  proc.on('exit', () => (exited = true));
  for (let i = 0; i < 100 && !exited; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  stopServer(proc);
  throw new Error('vite preview did not start');
}

function stopServer(proc) {
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    proc.kill();
  }
}

const state = (page) => page.evaluate(() => window.__PIXEL_ENGINE__?.state());

/** The engine is up (window.__PIXEL_ENGINE__ exists) and has presented at least 2 frames. */
async function ready(page) {
  await page.waitForFunction(() => window.__PIXEL_ENGINE__?.frame >= 2, null, { timeout: 90000 });
}

async function waitFrames(page, n) {
  const start = (await state(page)).frame;
  await page.waitForFunction((target) => window.__PIXEL_ENGINE__.frame >= target, start + n, { timeout: 60000 });
}

/**
 * Wait, checking once per rendered frame, until `pred(engine, arg)` holds or `frames`
 * frames have been rendered. Resolves to whether it held: the caller asserts on that, so a
 * condition that is met early stops waiting early and one that is never met still fails.
 * `pred` runs in the page and must not close over Node variables (pass them as `arg`).
 */
async function until(page, pred, arg = null, frames = 30) {
  return page.evaluate(
    ([src, arg, frames]) =>
      new Promise((resolve) => {
        const e = window.__PIXEL_ENGINE__;
        const test = new Function(`return (${src})`)();
        const end = e.frame + frames;
        const timer = setTimeout(() => resolve(false), 60000);
        const poll = () => {
          if (test(e, arg)) {
            clearTimeout(timer);
            resolve(true);
          } else if (e.frame >= end) {
            clearTimeout(timer);
            resolve(false);
          } else requestAnimationFrame(poll);
        };
        poll();
      }),
    [pred.toString(), arg, frames],
  );
}

/** Wait until the game has advanced `ms` of game time (render loop running). */
async function gameTime(page, ms) {
  const t0 = await page.evaluate(() => window.__PIXEL_ENGINE__.time);
  await page.waitForFunction((t) => window.__PIXEL_ENGINE__.time >= t, t0 + ms / 1000, { timeout: 60000, polling: 16 });
}

/**
 * Hold a key for `ms` of *game* time. The real render loop keeps running, but on a slow
 * machine (software WebGPU in CI, < 10 fps) the game advances less than wall-clock time,
 * so waiting on the wall clock made movement checks flaky.
 */
async function hold(page, code, ms) {
  const t0 = await page.evaluate((c) => {
    window.__PIXEL_ENGINE__.input.setKey(c, true);
    return window.__PIXEL_ENGINE__.time;
  }, code);
  await page.waitForFunction((t) => window.__PIXEL_ENGINE__.time >= t, t0 + ms / 1000, { timeout: 60000, polling: 16 });
  await page.evaluate((c) => window.__PIXEL_ENGINE__.input.setKey(c, false), code);
}

/** Minimal RGBA8 PNG encoder for captured frames. */
function encodePng({ width, height, pixels }) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Fraction of aligned scale×scale blocks whose pixels are all identical. */
function blockUniformity(png, scale) {
  let uniform = 0, total = 0;
  const { width, height, pixels: data } = png;
  const channels = 4;
  for (let by = 0; by + scale <= height; by += scale) {
    for (let bx = 0; bx + scale <= width; bx += scale) {
      const o = (by * width + bx) * channels;
      let same = true;
      for (let y = 0; y < scale && same; y++) {
        for (let x = 0; x < scale; x++) {
          const i = ((by + y) * width + bx + x) * channels;
          if (data[i] !== data[o] || data[i + 1] !== data[o + 1] || data[i + 2] !== data[o + 2]) {
            same = false;
            break;
          }
        }
      }
      total++;
      if (same) uniform++;
    }
  }
  return uniform / total;
}

/** Read the presented frame back from the GPU (headless can't screenshot WebGPU canvases). */
async function capture(page, file) {
  const { width, height, b64 } = await page.evaluate(async () => {
    const f = await window.__PIXEL_ENGINE__.renderer.capture();
    let bin = '';
    for (let i = 0; i < f.pixels.length; i += 0x8000) bin += String.fromCharCode(...f.pixels.subarray(i, i + 0x8000));
    return { width: f.width, height: f.height, b64: btoa(bin) };
  });
  const frame = { width, height, pixels: new Uint8Array(Buffer.from(b64, 'base64')) };
  await writeFile(new URL(file, OUT), encodePng(frame));
  return frame;
}

/** Distinct colors in a frame (a flat/black frame means nothing rendered). */
function colorCount({ pixels }) {
  const set = new Set();
  for (let i = 0; i < pixels.length; i += 4) set.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  return set.size;
}

/**
 * Wait until the camera holds still: its position moves less than 1e-6 between rendered
 * frames for 3 frames in a row. A camera that never settles fails the run.
 */
async function stableCamera(page, label = '') {
  const settled = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const e = window.__PIXEL_ENGINE__;
        const prev = e.camera.camera.position.clone();
        let frame = e.frame;
        let still = 0;
        const end = frame + 300;
        const timer = setTimeout(() => resolve(-1), 60000);
        const poll = () => {
          if (e.frame !== frame) {
            frame = e.frame;
            const p = e.camera.camera.position;
            still = p.distanceTo(prev) < 1e-6 ? still + 1 : 0;
            prev.copy(p);
            if (still >= 3 || frame >= end) {
              clearTimeout(timer);
              resolve(still >= 3 ? frame : -1);
              return;
            }
          }
          requestAnimationFrame(poll);
        };
        poll();
      }),
  );
  check(settled >= 0, `${label}camera settles${settled >= 0 ? ` (frame ${settled})` : ' (still moving after 300 frames / 60 s)'}`);
}

/** Launch Chromium for a scenario; collect console errors/warnings and page errors in `logs`. */
async function launch(browserExe, s, pageOptions = {}) {
  const headless = !process.env.DISPLAY; // headful under xvfb-run; headless only as a last resort
  const browser = await chromium.launch({ executablePath: browserExe, args: s.args, headless });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, ...pageOptions });
  const logs = [];
  const allowed = [...ENVIRONMENT_NOISE, ...(s.expectedWarnings ?? [])];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (m.type() === 'warning' && allowed.some((re) => re.test(m.text()))) return;
    logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  return { browser, page, logs };
}

function urlFor(s, query = '') {
  // The debug panel is dev-only by default; the suites read it, so ask for it.
  if (!/(^|[?&])debug=/.test(`${s.url}&${query}`)) query = query ? `${query}&debug=1` : 'debug=1';
  const sep = s.url.includes('?') ? '&' : '?';
  return `${s.url}${sep}${query}`;
}

async function openPage(browserExe, s, query = '', pageOptions = {}) {
  const ctx = await launch(browserExe, s, pageOptions);
  await ctx.page.goto(urlFor(s, query));
  await ready(ctx.page);
  return ctx;
}

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

function checkClean(st, logs, label = '') {
  check(st.gpuErrors.length === 0, `${label}zero GPU errors${st.gpuErrors.length ? ': ' + JSON.stringify(st.gpuErrors) : ''}`);
  check(logs.length === 0, `${label}zero console errors/warnings${logs.length ? ':\n    ' + logs.join('\n    ') : ''}`);
}

/** Rendering canvases: the pixel HUD's 2D overlay (data-hud) has no GPU context and isn't counted. */
const canvasCount = (page) => page.evaluate(() => [...document.querySelectorAll('canvas')].filter((c) => !c.dataset.hud).length);

async function runCore(browserExe, s) {
  console.log(`\n▶ ${s.name}`);
  let ctx;
  try {
    ctx = await openPage(browserExe, s);
    const { page, logs } = ctx;
    let st = await state(page);

    check(st.backend === s.backend, `backend is "${st.backend}" (expected "${s.backend}")`);
    const uiBackend = await page.locator('[data-f="backend"]').textContent();
    check(uiBackend.startsWith(s.backend), `debug UI shows "${uiBackend}"`);
    check(st.mode === 'pixel', 'starts in Pixel mode');
    check(st.resolution.width === 480 && st.resolution.height === 270, 'default internal resolution 480×270');
    check(st.framing.integer && st.framing.scale === 2 && st.framing.canvasWidth === 960, `integer scale ${st.framing.scale}× at 960×540`);

    await page.evaluate(() => {
      window.__rendererRef = window.__PIXEL_ENGINE__.renderer.renderer;
      window.__canvasRef = document.querySelector('canvas[data-engine-canvas]');
    });
    check((await canvasCount(page)) === 1, 'exactly one canvas');

    await stableCamera(page);
    const pixelShot = await capture(page, `${s.name}-pixel-480.png`);
    const colors = colorCount(pixelShot);
    check(colors > 8, `frame has real content (${colors} distinct colors)`);
    const pixelBlocks = blockUniformity(pixelShot, 2);
    check(pixelBlocks > 0.995, `pixel mode is blocky: ${(pixelBlocks * 100).toFixed(1)}% uniform 2×2 blocks`);

    // Raw 3D mode: same renderer, same canvas, same camera + character.
    const before = await state(page);
    await page.keyboard.press('KeyP');
    await until(page, (e) => e.renderer.mode === 'raw');
    await waitFrames(page, 2); // and nothing drifts in the frames after the switch
    const raw = await state(page);
    check(raw.mode === 'raw', 'P toggles to Raw 3D mode');
    const same = await page.evaluate(
      () =>
        window.__PIXEL_ENGINE__.renderer.renderer === window.__rendererRef &&
        document.querySelector('canvas[data-engine-canvas]') === window.__canvasRef,
    );
    check(same, 'same WebGPURenderer instance and canvas after toggle');
    check(dist(before.camera, raw.camera) < 1e-6, 'camera unchanged by mode toggle');
    check(dist(before.target, raw.target) < 1e-3, 'character unchanged by mode toggle');
    check(raw.framing.canvasWidth === before.framing.canvasWidth, 'framing unchanged by mode toggle');
    const rawShot = await capture(page, `${s.name}-raw.png`);
    const rawBlocks = blockUniformity(rawShot, 2);
    check(1 - rawBlocks > 10 * (1 - pixelBlocks) && 1 - rawBlocks > 0.01, `raw mode is full-res: ${((1 - rawBlocks) * 100).toFixed(1)}% mixed 2×2 blocks vs ${((1 - pixelBlocks) * 100).toFixed(2)}% in pixel mode`);
    await page.keyboard.press('KeyP');
    check(await until(page, (e) => e.renderer.mode === 'pixel'), 'P toggles back to Pixel mode');

    // Comparison resolution keeps framing.
    await page.keyboard.press('KeyR');
    await until(page, (e) => e.renderer.resolution.width === 320);
    await waitFrames(page, 2); // layout settles (resize observer) before measuring framing
    st = await state(page);
    check(st.resolution.width === 320 && st.framing.scale === 3, `R switches to 320×180 at ${st.framing.scale}×`);
    check(JSON.stringify(st.view) === JSON.stringify(before.view), 'framing stable across resolutions (same visible world extents)');
    const shot320 = await capture(page, `${s.name}-pixel-320.png`);
    const blocks320 = blockUniformity(shot320, 3);
    check(blocks320 > 0.995, `320×180 is blocky at 3×: ${(blocks320 * 100).toFixed(1)}%`);
    await page.keyboard.press('KeyR');
    check(await until(page, (e) => e.renderer.resolution.width === 480), 'R switches back to 480×270');

    // Gameplay: move, jump, coin pickup.
    const p0 = (await state(page)).target;
    await hold(page, 'KeyA', 700);
    await until(page, (e, p0) => Math.hypot(...e.state().target.map((v, i) => v - p0[i])) > 1, p0, 10);
    const p1 = (await state(page)).target;
    check(dist(p0, p1) > 1, `character moves with input (${dist(p0, p1).toFixed(2)} units)`);

    // Jump: hold Space and sample the height on every frame for 1 s of game time (through the apex).
    const { y0, peak } = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const e = window.__PIXEL_ENGINE__;
          const y0 = e.state().target[1];
          const t0 = e.time;
          let peak = y0;
          let frame = e.frame;
          e.input.setKey('Space', true);
          const poll = () => {
            if (e.frame !== frame) {
              frame = e.frame;
              peak = Math.max(peak, e.state().target[1]);
            }
            if (e.time - t0 >= 1) {
              e.input.setKey('Space', false);
              resolve({ y0, peak });
            } else requestAnimationFrame(poll);
          };
          poll();
        }),
    );
    check(peak - y0 > 0.8, `character jumps (peak +${(peak - y0).toFixed(2)})`);

    const coinsBefore = await page.evaluate(() => window.__PIXEL_ENGINE__.game.collected);
    await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.teleport([0, 0, 6]));
    await until(page, (e, n) => e.game.collected > n, coinsBefore, 10);
    const coinsAfter = await page.evaluate(() => window.__PIXEL_ENGINE__.game.collected);
    check(coinsAfter === coinsBefore + 1, `coin pickup (${coinsBefore} → ${coinsAfter})`);

    // Regression: teleporting next to a wall must not let the next step tunnel into it.
    // Ledge block spans x ∈ [5.3, 7.7] at z = 0; capsule radius 0.3.
    await page.evaluate(() => {
      const hero = window.__PIXEL_ENGINE__.game.hero;
      hero.teleport([8.05, 0, 0]);
      hero.facing = -Math.PI / 2;
      hero.hvel.set(-60, 0, 0);
    });
    await waitFrames(page, 10);
    const wallX = await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.feet.x);
    check(wallX > 7.9, `teleport next to a wall doesn't penetrate it (feet x = ${wallX.toFixed(3)})`);

    await capture(page, `${s.name}-after-play.png`);
    check((await canvasCount(page)) === 1, 'still exactly one canvas after play');
    st = await state(page);
    checkClean(st, logs);
    await writeFile(new URL(`${s.name}-state.json`, OUT), JSON.stringify(st, null, 2));
  } catch (e) {
    check(false, `scenario crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

/** ?backend=webgl: only what differs from the natural fallback (same backend, covered by runCore). */
async function runForced(browserExe, s) {
  console.log(`\n▶ ${s.name}`);
  let ctx;
  try {
    ctx = await openPage(browserExe, s);
    const { page, logs } = ctx;
    const st = await state(page);
    check(st.backend === s.backend && st.fallbackReason === 'forced by ?backend=webgl', `backend is "${st.backend}" because "${st.fallbackReason}"`);
    const uiBackend = await page.locator('[data-f="backend"]').textContent();
    check(uiBackend === `${s.backend} (forced by ?backend=webgl)`, `debug UI shows "${uiBackend}"`);
    const shot = await capture(page, `${s.name}-pixel-480.png`);
    check(colorCount(shot) > 8, `renders (${colorCount(shot)} distinct colors)`);
    const blocks = blockUniformity(shot, 2);
    check(blocks > 0.995, `pixel mode is blocky: ${(blocks * 100).toFixed(1)}% uniform 2×2 blocks`);
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `scenario crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

/** Every preset, each from a fresh page load (?camera=), all in one browser. */
async function runCameras(browserExe) {
  const s = SCENARIOS[0];
  let ctx;
  try {
    ctx = await launch(browserExe, s);
    const { page } = ctx;
    for (const preset of ['iso', 'topdown', 'side', 'third', 'first', 'free']) {
      console.log(`\n▶ cameras: ${preset}`);
      const firstLog = ctx.logs.length;
      const logs = () => ctx.logs.slice(firstLog);
      try {
        await page.goto(urlFor(s, `camera=${preset}`));
        await ready(page);
        let st = await state(page);
        check(st.cameraRig.preset === preset, `rig preset is ${st.cameraRig.preset}`);
        const ui = await page.locator('[data-f="camera"]').textContent();
        check(ui.startsWith(preset), `debug UI shows camera "${ui}"`);
        const frame = await capture(page, `camera-${preset}.png`);
        check(colorCount(frame) > 8, `renders (${colorCount(frame)} colors)`);

        // Zoom: wheel up = zoom in, for every preset except first person.
        await page.evaluate(() => window.__PIXEL_ENGINE__.input.addPointer(0, 0, -4));
        await until(page, (e) => e.camera.describe().zoom > 1.4, null, 3);
        const zoomed = (await state(page)).cameraRig;
        if (preset === 'first') check(zoomed.zoom === 1 && zoomed.zoomable === false, 'first person does not zoom');
        else check(zoomed.zoom > 1.4, `wheel zooms in (zoom ${zoomed.zoom})`);
        if (preset !== 'first') {
          await page.evaluate(() => window.__PIXEL_ENGINE__.camera.setZoom(1));
        }

        if (preset === 'free') {
          const c0 = (await state(page)).camera;
          const t0 = (await state(page)).target;
          await hold(page, 'KeyW', 500);
          await waitFrames(page, 5);
          st = await state(page);
          check(dist(c0, st.camera) > 0.5, 'free camera flies with WASD');
          check(dist(t0, st.target) < 0.05, 'character stays put while the camera flies');
          await page.keyboard.press('Enter');
          await until(page, (e) => e.camera.describe().fixed === true, null, 3);
          st = await state(page);
          check(st.cameraRig.fixed === true, 'Enter fixes the camera');
          const config = st.cameraRig.config;
          const fixedCam = st.camera;
          await hold(page, 'KeyD', 600);
          await waitFrames(page, 5);
          st = await state(page);
          check(dist(fixedCam, st.camera) < 1e-6, 'fixed camera no longer moves');
          check(dist(t0, st.target) > 0.8, 'character moves once the camera is fixed');
          // Reload with the printed config as a 'fixed' preset.
          await page.goto(urlFor(s, `cam=${encodeURIComponent(JSON.stringify(config))}`));
          await ready(page);
          st = await state(page);
          check(st.cameraRig.preset === 'fixed' && dist(st.camera, config.position) < 0.02, `?cam= config restores the fixed view (${st.camera.map((v) => v.toFixed(2))})`);
          await capture(page, 'camera-fixed.png');
        } else {
          const t0 = (await state(page)).target;
          await hold(page, 'KeyD', 700);
          await until(page, (e, t0) => Math.hypot(...e.state().target.map((v, i) => v - t0[i])) > 0.8, t0, 10);
          st = await state(page);
          check(dist(t0, st.target) > 0.8, `D moves the character (${dist(t0, st.target).toFixed(2)})`);
          if (preset === 'side') {
            const z0 = st.target[2];
            await hold(page, 'KeyW', 500);
            await waitFrames(page, 10);
            check(Math.abs((await state(page)).target[2] - z0) < 0.05, 'side-scroller keeps the depth lane');
          }
          if (preset === 'third' || preset === 'first') {
            const yaw0 = st.cameraRig.yaw;
            await page.evaluate(() => window.__PIXEL_ENGINE__.input.addPointer(160, 0));
            await until(page, (e, yaw0) => Math.abs(e.camera.describe().yaw - yaw0) > 0.3, yaw0, 3);
            check(Math.abs((await state(page)).cameraRig.yaw - yaw0) > 0.3, 'mouse turns the camera');
          }
          if (preset === 'first') {
            check(await page.evaluate(() => window.__PIXEL_ENGINE__.game.heroModel.visible === false), 'player model hidden in first person');
          }
        }
        checkClean(await state(page), logs());
      } catch (e) {
        check(false, `camera ${preset} crashed: ${e.message}\n    ${logs().join('\n    ')}`);
      }
    }
  } catch (e) {
    check(false, `cameras crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
  }
}

/**
 * Swaps run on manual time (Engine.step): every swap gets exactly the same 8 game frames
 * however slowly the machine renders, and capture() draws what the player would see.
 */
async function runCameraSwap(browserExe, s) {
  console.log(`\n▶ camera hot-swap keeps the player (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(browserExe, s);
    const { page, logs } = ctx;
    // Move somewhere and pick up a coin so there is state to lose.
    await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      e.game.hero.teleport([-4, 0, 5]);
      e.step(10);
      e.input.setKey('KeyD', true);
      e.step(24); // 400 ms
      e.input.setKey('KeyD', false);
      e.step(180); // stop and settle on the ground (the capsule eases up ~1 cm for ~2 s)
    });
    const renderer0 = await page.evaluate(() => (window.__rendererRef = window.__PIXEL_ENGINE__.renderer.renderer, true));
    const before = await page.evaluate(() => ({ feet: window.__PIXEL_ENGINE__.game.hero.feet.toArray(), coins: window.__PIXEL_ENGINE__.game.collected, url: location.href }));
    check(renderer0 && before.coins >= 1, `setup: player at ${before.feet.map((v) => v.toFixed(2))}, ${before.coins} coin(s)`);
    for (const preset of ['topdown', 'side', 'third', 'first', 'free', 'fixed', 'iso']) {
      await page.selectOption('[data-a="camera"]', preset);
      await page.evaluate(() => window.__PIXEL_ENGINE__.step(8));
      const now = await page.evaluate(() => ({
        feet: window.__PIXEL_ENGINE__.game.hero.feet.toArray(),
        coins: window.__PIXEL_ENGINE__.game.collected,
        preset: window.__PIXEL_ENGINE__.camera.preset,
        sameRenderer: window.__PIXEL_ENGINE__.renderer.renderer === window.__rendererRef,
        visible: window.__PIXEL_ENGINE__.game.heroModel.visible,
        url: location.search,
      }));
      const frame = await capture(page, `swap-${s.name}-${preset}.png`);
      const moved = dist(before.feet, now.feet);
      check(
        now.preset === preset &&
          moved < 0.05 &&
          now.coins === before.coins &&
          now.sameRenderer &&
          colorCount(frame) > 8 &&
          (preset === 'free' || preset === 'fixed' ? decodeURIComponent(now.url).includes(`"preset":"${preset}"`) : now.url.includes(`camera=${preset}`)),
        `→ ${preset}: player stayed (moved ${moved.toFixed(3)}), coins ${now.coins}, same renderer, renders, URL synced`,
      );
      check(now.visible === (preset !== 'first'), `→ ${preset}: player model ${now.visible ? 'shown' : 'hidden'}`);
    }
    // A swapped-to fixed view survives a reload (its full config is in ?cam=).
    await page.selectOption('[data-a="camera"]', 'third');
    await page.evaluate(() => window.__PIXEL_ENGINE__.step(20));
    await page.selectOption('[data-a="camera"]', 'fixed');
    await page.evaluate(() => window.__PIXEL_ENGINE__.step(4));
    const fixedAt = await page.evaluate(() => window.__PIXEL_ENGINE__.camera.camera.position.toArray());
    checkClean(await state(page), logs);
    await page.reload();
    await ready(page);
    const reloaded = await page.evaluate(() => ({ preset: window.__PIXEL_ENGINE__.camera.preset, pos: window.__PIXEL_ENGINE__.camera.camera.position.toArray() }));
    check(reloaded.preset === 'fixed' && dist(fixedAt, reloaded.pos) < 0.01, `fixed view survives a reload (moved ${dist(fixedAt, reloaded.pos).toFixed(3)})`);
  } catch (e) {
    check(false, `camera swap crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

function meanDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    sum += Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]);
  }
  return sum / (a.pixels.length / 4) / 3;
}

/**
 * Manual time: one Engine.step stops the render loop from drawing or advancing the game,
 * so every capture() renders the identical scene and differs only by the filter.
 */
async function runFilters(browserExe, s, label) {
  console.log(`\n▶ ${label}`);
  let ctx;
  try {
    ctx = await openPage(browserExe, s, 'debug=0');
    const { page, logs } = ctx;
    await page.evaluate(() => window.__PIXEL_ENGINE__.step(1));
    const base = await capture(page, `${label}-none.png`);
    check(colorCount(base) > 8, `unfiltered frame has real content (${colorCount(base)} colors)`);
    const ids = await page.evaluate(() => [...window.__PIXEL_ENGINE__.availableFilters]);
    let ok = 0;
    for (const id of ids) {
      const before = logs.length;
      await page.evaluate((id) => window.__PIXEL_ENGINE__.setFilters([id]), id);
      const f = await capture(page, `${label}-${id}.png`);
      const d = meanDiff(base, f);
      const errs = (await state(page)).gpuErrors.length;
      const good = d > 0.5 && errs === 0 && logs.length === before && colorCount(f) >= 2;
      if (good) ok++;
      else check(false, `filter ${id}: diff ${d.toFixed(2)}, gpuErrors ${errs}, ${logs.slice(before).join(' | ')}`);
    }
    check(ok === ids.length, `${ok}/${ids.length} filters compile, render and change the frame`);

    // Stacks and raw-mode bypass (the P hotkey itself is covered by the core suites).
    await page.evaluate(() => window.__PIXEL_ENGINE__.setFilters(['gameboy', 'lcd', 'vignette']));
    check(meanDiff(base, await capture(page, `${label}-stack.png`)) > 0.5, 'a 3-filter stack renders');
    await page.evaluate(() => window.__PIXEL_ENGINE__.toggleMode());
    const rawFiltered = await capture(page, `${label}-raw-filtered.png`);
    await page.evaluate(() => window.__PIXEL_ENGINE__.setFilters([]));
    const rawPlain = await capture(page, `${label}-raw-plain.png`);
    check(meanDiff(rawFiltered, rawPlain) < 0.01, 'Raw 3D mode bypasses filters');
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `${label} crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

async function runTouch(browserExe) {
  console.log('\n▶ touch (phone-sized landscape, on-screen controls)');
  let ctx;
  try {
    ctx = await openPage(browserExe, SCENARIOS[0], 'touch=1&camera=third', { viewport: { width: 844, height: 390 }, hasTouch: true });
    const { page, logs } = ctx;
    check(await page.locator('.touch-ui .stick').isVisible(), 'joystick visible');
    check((await page.locator('.touch-ui .pad button').count()) >= 6, 'action buttons visible');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.debug-ui')).display === 'none'), 'debug panel starts hidden behind ⚙');

    // Joystick: drag up (forward) from its centre.
    const stick = await page.locator('.touch-ui .stick').boundingBox();
    const cx = stick.x + stick.width / 2;
    const cy = stick.y + stick.height / 2;
    const t0 = (await state(page)).target;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 60, { steps: 4 });
    await gameTime(page, 800);
    const mid = await page.evaluate(() => ({ ...window.__PIXEL_ENGINE__.input.analog }));
    await page.mouse.up();
    await waitFrames(page, 5);
    const t1 = (await state(page)).target;
    check(mid.y > 0.8, `joystick drives the analog axis (y = ${mid.y.toFixed(2)})`);
    check(dist(t0, t1) > 1, `joystick moves the character (${dist(t0, t1).toFixed(2)})`);
    check(await page.evaluate(() => window.__PIXEL_ENGINE__.input.analog.y === 0), 'joystick recentres on release');

    // A button = jump.
    const jumps0 = await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.stats.jumps);
    const a = await page.locator('.touch-ui .pad button').first().boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await waitFrames(page, 4);
    await page.mouse.up();
    await until(page, (e, n) => e.game.hero.stats.jumps > n, jumps0, 10);
    check((await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.stats.jumps)) > jumps0, 'A button jumps');

    // Drag on the game to orbit the camera.
    const yaw0 = (await state(page)).cameraRig.yaw;
    await page.mouse.move(420, 120);
    await page.mouse.down();
    await page.mouse.move(560, 120, { steps: 6 });
    await page.mouse.up();
    await until(page, (e, yaw0) => Math.abs(e.camera.describe().yaw - yaw0) > 0.3, yaw0, 3);
    check(Math.abs((await state(page)).cameraRig.yaw - yaw0) > 0.3, 'dragging the game orbits the camera');

    // ⚙ shows the debug panel.
    await page.locator('.touch-ui .bar button').first().dispatchEvent('pointerdown');
    await page.locator('.touch-ui .bar button').first().dispatchEvent('pointerup');
    await until(page, () => getComputedStyle(document.querySelector('.debug-ui')).display !== 'none', null, 3);
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.debug-ui')).display !== 'none'), '⚙ opens the debug panel');
    await capture(page, 'touch-landscape.png');
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `touch crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

async function runMoves(browserExe) {
  console.log('\n▶ moves (third-person camera)');
  let ctx;
  try {
    ctx = await openPage(browserExe, SCENARIOS[0], 'camera=third&debug=0');
    const { page, logs } = ctx;
    await page.evaluate(PAGE_HELPERS);
    for (const [name, body] of MOVES) {
      const r = await page
        .evaluate(`(async () => { const T = window.__T; ${body} })()`)
        .catch((e) => ({ ok: false, detail: e.message }));
      check(r.ok, `${name}${r.ok ? '' : ': ' + JSON.stringify(r.detail).slice(0, 300)}`);
    }
    // Engine.step (npm run film): frame-exact manual time, and capture still works in it
    const stepped = await page.evaluate(async () => {
      const e = window.__PIXEL_ENGINE__;
      await window.__T.place([0, 0, 4], Math.PI / 2);
      const f0 = e.frame;
      const x0 = e.game.hero.feet.x;
      e.input.setKey('KeyD', true);
      e.step(30);
      e.input.setKey('KeyD', false);
      const r = { frames: e.frame - f0, moved: +(e.game.hero.feet.x - x0).toFixed(2), manual: e.manual };
      const shot = await e.renderer.capture();
      e.manual = false;
      return { ...r, captured: shot.width > 0 };
    });
    check(stepped.frames === 30 && stepped.moved > 1 && stepped.manual && stepped.captured, `Engine.step advances exactly 30 frames and captures (${JSON.stringify(stepped)})`);
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `moves crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

async function runLab(browserExe) {
  console.log('\n▶ lab (Animation Lab)');
  let ctx;
  try {
    ctx = await openPage(browserExe, { ...SCENARIOS[0], url: `${BASE}lab.html` }, 'view=three&paused=1&debug=0');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__ANIM_LAB__, null, { timeout: 30000 });
    const clips = await page.evaluate(() => window.__ANIM_LAB__.clips());
    check(clips.length >= 50, `lab lists ${clips.length} clips`);
    // The lab's metrics API (every clip's metrics: src/engine/animation/animation.test.ts).
    const run = await page.evaluate(() => window.__ANIM_LAB__.metrics('Run'));
    check(Array.isArray(run.problems) && run.problems.length === 0, `metrics('Run') reports no problems${run.problems?.length ? ': ' + JSON.stringify(run.problems).slice(0, 300) : ''}`);
    await page.evaluate(() => {
      window.__ANIM_LAB__.select('Run');
      window.__ANIM_LAB__.seek(3);
    });
    await waitFrames(page, 3);
    const st = await page.evaluate(() => window.__ANIM_LAB__.state());
    check(st.clip === 'Run' && st.frame === 3 && !st.playing, `select + seek: ${JSON.stringify(st)}`);
    const pose = await page.evaluate(() => window.__ANIM_LAB__.pose());
    check(pose.Pelvis && pose.FootR && pose.Pelvis.world[1] > 0.3, 'pose() returns joint rotations and world positions');
    for (const [clip, frame, view] of [['Idle', 0, 'three'], ['Run', 3, 'side'], ['Backflip', 12, 'side'], ['Crawl', 9, 'three'], ['Punch', 4, 'front']]) {
      await page.click(`[data-v="${view}"]`);
      await page.evaluate(([c, f]) => {
        window.__ANIM_LAB__.select(c);
        window.__ANIM_LAB__.seek(f);
      }, [clip, frame]);
      await waitFrames(page, 4);
      const frameImg = await capture(page, `lab-${clip}-${view}.png`);
      check(colorCount(frameImg) > 8, `${clip} f${frame} renders in the ${view} view`);
    }
    const sheet = await page.evaluate(() => window.__ANIM_LAB__.sheet('Walk'));
    check(sheet.startsWith('data:image/png') && sheet.length > 10000, 'contact sheet renders in the browser');
    await writeFile(new URL('lab-sheet-Walk.png', OUT), Buffer.from(sheet.split(',')[1], 'base64'));
    const curves = await page.evaluate(() => window.__ANIM_LAB__.curves('Jump'));
    check(curves.startsWith('data:image/png') && curves.length > 10000, 'motion curves render in the browser');
    await page.click('[data-a="play"]');
    const f0 = (await page.evaluate(() => window.__ANIM_LAB__.state())).frame;
    await until(page, (e, f0) => window.__ANIM_LAB__.state().frame !== f0, f0, 10);
    const f1 = (await page.evaluate(() => window.__ANIM_LAB__.state())).frame;
    check(f1 !== f0, 'play button advances the clip');
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `lab crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

/** Run a command from the repo root; resolves to { code, out } (stdout + stderr). */
function run(cmd, args, { env = {}, timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      out += `\n(killed after ${timeout / 1000} s)`;
      proc.kill('SIGKILL');
    }, timeout);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

const tail = (out, n = 15) => out.trim().split('\n').slice(-n).join('\n    ');

/** Smoke tests for the agent tooling that the game suites don't touch. */
async function runTools(browserExe) {
  console.log('\n▶ tools: npm run build:single');
  let ctx;
  try {
    await rm(new URL('dist-single/', ROOT), { recursive: true, force: true });
    const built = await run('node', ['scripts/build-single.mjs']);
    check(built.code === 0, `build:single exits 0${built.code ? ':\n    ' + tail(built.out) : ''}`);
    const files = await readdir(new URL('dist-single/', ROOT), { recursive: true });
    check(files.length === 1 && files[0] === 'pixel-engine.html', `dist-single holds one HTML file (${files.join(', ')})`);
    const file = new URL('dist-single/pixel-engine.html', ROOT);
    // The natural WebGL 2 fallback: what most phones run.
    const s = SCENARIOS[1];
    ctx = await launch(browserExe, s);
    const { page, logs } = ctx;
    const external = [];
    page.on('request', (r) => !/^(file|data|blob):/.test(r.url()) && external.push(r.url()));
    await page.goto(pathToFileURL(file.pathname).href);
    await ready(page);
    const st = await state(page);
    check(st.backend === s.backend, `runs from file:// (backend "${st.backend}")`);
    const shot = await capture(page, 'single-file.png');
    check(colorCount(shot) > 8, `renders (${colorCount(shot)} distinct colors)`);
    check(external.length === 0, `self-contained: no network requests${external.length ? ': ' + external.slice(0, 5).join(', ') : ''}`);
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `build:single crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }

  console.log('\n▶ tools: npm run film');
  try {
    const out = new URL('film/', OUT);
    await rm(out, { recursive: true, force: true });
    const filmed = await run('npx', ['tsx', 'scripts/film.ts', '--out', '.scratch/e2e/film', '--name', 'smoke', 'place 0 0 4 90; wait 10'], {
      env: { FILM_PORT: String(PORT + 1) },
    });
    check(filmed.code === 0, `film exits 0${filmed.code ? ':\n    ' + tail(filmed.out) : ''}`);
    const png = await readFile(new URL('smoke.png', out));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    check(png.subarray(1, 4).toString() === 'PNG' && width > 100 && height > 100 && (await stat(new URL('smoke.png', out))).size > 2000, `writes a filmstrip PNG (${width}×${height})`);
    const log = JSON.parse(await readFile(new URL('smoke.json', out), 'utf8'));
    check(log.frames.length === 11 && log.frames.every((f) => f.grounded), `logs every frame (${log.frames.length}: the settled pose + 10)`);
  } catch (e) {
    check(false, `film crashed: ${e.message}`);
  }
}

async function runPhone(browserExe) {
  console.log('\n▶ phone (portrait adaptive aspect, GPU device loss)');
  const headless = !process.env.DISPLAY;
  // Portrait phone: the art keeps 270 rows and narrows to the screen instead of a 16:9 strip.
  {
    const browser = await chromium.launch({ executablePath: browserExe, args: SCENARIOS[0].args, headless });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
      const logs = [];
      page.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && !ENVIRONMENT_NOISE.some((re) => re.test(m.text())))) && logs.push(`${m.type()}: ${m.text()}`));
      page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
      await page.goto(`${BASE}?touch=1`);
      await ready(page);
      const st = await state(page);
      const f = st.framing;
      const cover = (f.cssWidth * f.cssHeight) / (390 * 844);
      check(st.aspect === 'adaptive' && f.integer && f.artHeight === 270 && f.artWidth < 200, `portrait art ${f.artWidth}×${f.artHeight} at ${f.scale}× (adaptive)`);
      check(cover > 0.85, `canvas covers ${(cover * 100).toFixed(0)}% of a portrait screen`);
      check(Math.abs((st.view.right - st.view.left) / (st.view.top - st.view.bottom) - f.artWidth / f.artHeight) < 1e-6, 'camera aspect follows the art');
      const shot = await capture(page, 'phone-portrait.png');
      check(colorCount(shot) > 8 && blockUniformity(shot, f.scale) > 0.995, `portrait frame renders with uniform ${f.scale}×${f.scale} blocks`);
      checkClean(await state(page), logs);
    } catch (e) {
      check(false, `portrait crashed: ${e.message}`);
    } finally {
      await browser.close();
    }
  }
  // Device loss: mobile browsers drop the GPU device after backgrounding / memory pressure.
  for (const s of [SCENARIOS[0], SCENARIOS[1]]) {
    let ctx;
    try {
      ctx = await openPage(browserExe, s, 'debug=0');
      const { page, logs } = ctx;
      await page.evaluate(() => {
        const r = window.__PIXEL_ENGINE__.renderer.renderer;
        window.__lostRenderer = r;
        if (r.backend.isWebGPUBackend) r.backend.device.destroy();
        else r.backend.gl.getExtension('WEBGL_lose_context').loseContext();
      });
      await page.waitForFunction(() => window.__PIXEL_ENGINE__.state().gpuRecoveries === 1, null, { timeout: 60000 });
      await waitFrames(page, 10);
      const st = await state(page);
      const fresh = await page.evaluate(() => ({
        replaced: window.__PIXEL_ENGINE__.renderer.renderer !== window.__lostRenderer,
        canvases: [...document.querySelectorAll('canvas')].filter((c) => !c.dataset.hud).length,
      }));
      check(st.backend === s.backend && fresh.replaced && fresh.canvases === 1, `${s.backend}: lost device → new renderer on ${st.backend}, one canvas`);
      const shot = await capture(page, `device-loss-${s.name}.png`);
      check(colorCount(shot) > 8 && blockUniformity(shot, 2) > 0.995, `${s.backend}: renders again after recovery (${colorCount(shot)} colors)`);
      const p0 = st.target;
      await hold(page, 'KeyA', 500);
      await waitFrames(page, 5);
      check(dist(p0, (await state(page)).target) > 0.5, `${s.backend}: game keeps running after recovery`);
      checkClean(await state(page), logs, `${s.backend}: `);
    } catch (e) {
      check(false, `device loss (${s.name}) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
    } finally {
      await ctx?.browser.close();
    }
  }
}

const SUITES = {
  webgpu: (exe) => runCore(exe, SCENARIOS[0]),
  'webgl-fallback': (exe) => runCore(exe, SCENARIOS[1]),
  'webgl-forced': (exe) => runForced(exe, SCENARIOS[2]),
  cameras: (exe) => runCameras(exe),
  'camera-swap': async (exe) => {
    await runCameraSwap(exe, SCENARIOS[0]);
    await runCameraSwap(exe, SCENARIOS[1]);
  },
  'filters-webgpu': (exe) => runFilters(exe, SCENARIOS[0], 'filters-webgpu'),
  'filters-webgl': (exe) => runFilters(exe, SCENARIOS[1], 'filters-webgl'),
  touch: (exe) => runTouch(exe),
  phone: (exe) => runPhone(exe),
  moves: (exe) => runMoves(exe),
  lab: (exe) => runLab(exe),
  tools: (exe) => runTools(exe),
  systems: async (exe) => {
    const helpers = { exe, openPage, ready, until, check, capture, state, waitFrames, colorCount, meanDiff, checkClean, encodePng, OUT };
    await runSystems({ ...helpers, scenario: SCENARIOS[0] });
    await runSystems({ ...helpers, scenario: SCENARIOS[1] });
  },
};

// CI runs one job per group, in parallel (.github/workflows/ci.yml: `test:e2e -- @core`).
// Every suite must be in exactly one group, or CI would silently skip it.
const GROUPS = {
  '@core': ['webgpu', 'webgl-fallback', 'webgl-forced', 'touch', 'phone', 'moves'],
  '@cameras': ['cameras', 'camera-swap', 'lab'],
  '@filters': ['filters-webgpu', 'filters-webgl', 'tools', 'systems'],
};
const grouped = Object.values(GROUPS).flat();
const misgrouped = Object.keys(SUITES).filter((n) => grouped.filter((g) => g === n).length !== 1);
if (misgrouped.length || grouped.length !== Object.keys(SUITES).length) {
  console.error(`every e2e suite must be in exactly one group (GROUPS in scripts/e2e.mjs): ${misgrouped.join(', ') || grouped.join(', ')}`);
  process.exit(2);
}
const wanted = process.argv.slice(2).flatMap((a) => GROUPS[a] ?? [a]);
const unknown = wanted.filter((n) => !SUITES[n]);
if (unknown.length) {
  console.error(`unknown e2e suite(s): ${unknown.join(', ')}\navailable: ${Object.keys(SUITES).join(', ')}, or a group: ${Object.keys(GROUPS).join(', ')}`);
  process.exit(2);
}

await mkdir(OUT, { recursive: true });
const exe = await resolveExecutable();
const server = await startServer();
const started = Date.now();
try {
  for (const [name, runSuite] of Object.entries(SUITES)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const t0 = Date.now();
    await runSuite(exe);
    console.log(`  ⏱ ${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  stopServer(server);
}
console.log(`\n⏱ total ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(failures ? `✘ ${failures} check(s) failed` : '✔ all e2e checks passed');
process.exit(failures ? 1 : 0);
