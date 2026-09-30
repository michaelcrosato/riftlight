// End-to-end verification in real Chromium, against the production build.
//
//   npm run build && npm run test:e2e      (wraps this in xvfb-run)
//
//   npm run test:e2e -- <suite>   run one suite: webgpu | webgl-fallback | webgl-forced |
//                                 cameras | camera-swap | filters-webgpu | filters-webgl | touch | moves | lab
//
// Core suites (one per backend path):
//   webgpu          native WebGPU (SwiftShader adapter in headless; real GPU elsewhere)
//   webgl-fallback  navigator.gpu disabled -> WebGPURenderer's built-in WebGL 2 backend
//   webgl-forced    ?backend=webgl debug override
// Each asserts: expected backend in state + debug UI, zero GPU errors, zero console
// errors/warnings, gameplay responds to input, Raw 3D toggle keeps the same renderer/
// canvas/camera/character, pixel mode is blocky while raw mode is not, 320x180 keeps framing.
//
// camera-swap     live preset swaps keep the player, coins and renderer (WebGPU + WebGL 2);
//                 a swapped-to fixed view survives reload.
// cameras         every camera preset renders, zooms (except first person), moves the
//                 character in its own basis; side locks the lane; free → fix → reload as fixed.
// filters-*       every post filter compiles and changes the frame on WebGPU and WebGL 2,
//                 with zero errors; Raw 3D mode bypasses filters.
// touch           phone-sized viewport: joystick, action buttons, drag-to-orbit, ⚙ panel.
// moves           the whole PlatformerCharacter moveset (scripts/e2e-moves.mjs).
// lab             Animation Lab (/lab.html): every clip plays with clean metrics, views,
//                 scrubbing, contact sheets and the agent API; frames of a few clips saved.
//
// Frames land in .scratch/e2e/.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { MOVES, PAGE_HELPERS } from './e2e-moves.mjs';

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const OUT = new URL('../.scratch/e2e/', import.meta.url);
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

const only = process.argv[2];
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
  const { readdir } = await import('node:fs/promises');
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
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('vite preview did not start');
}

const state = (page) => page.evaluate(() => window.__PIXEL_ENGINE__?.state());

async function waitFrames(page, n) {
  const start = (await state(page)).frame;
  await page.waitForFunction((target) => window.__PIXEL_ENGINE__.frame >= target, start + n, { timeout: 60000 });
}

async function hold(page, code, ms) {
  await page.evaluate((c) => window.__PIXEL_ENGINE__.input.setKey(c, true), code);
  await page.waitForTimeout(ms);
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

async function stableCamera(page) {
  let prev = null;
  for (let i = 0; i < 100; i++) {
    const cam = (await state(page)).camera.join(',');
    if (cam === prev) return;
    prev = cam;
    await page.waitForTimeout(100);
  }
}


async function openPage(browserExe, s, query = '') {
  const headless = !process.env.DISPLAY; // headful under xvfb-run; headless only as a last resort
  const browser = await chromium.launch({ executablePath: browserExe, args: s.args, headless });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const logs = [];
  const allowed = [...ENVIRONMENT_NOISE, ...(s.expectedWarnings ?? [])];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (m.type() === 'warning' && allowed.some((re) => re.test(m.text()))) return;
    logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const sep = s.url.includes('?') ? '&' : '?';
  await page.goto(query ? `${s.url}${sep}${query}` : s.url);
  await page.waitForFunction(() => window.__PIXEL_ENGINE__?.frame > 30, null, { timeout: 90000 });
  return { browser, page, logs };
}

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

function checkClean(st, logs, label = '') {
  check(st.gpuErrors.length === 0, `${label}zero GPU errors${st.gpuErrors.length ? ': ' + JSON.stringify(st.gpuErrors) : ''}`);
  check(logs.length === 0, `${label}zero console errors/warnings${logs.length ? ':\n    ' + logs.join('\n    ') : ''}`);
}

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

    await waitFrames(page, 30);
    const canvases = await page.evaluate(() => {
      window.__rendererRef = window.__PIXEL_ENGINE__.renderer.renderer;
      window.__canvasRef = document.querySelector('canvas[data-engine-canvas]');
      return document.querySelectorAll('canvas').length;
    });
    check(canvases === 1, 'exactly one canvas');

    await stableCamera(page);
    const pixelShot = await capture(page, `${s.name}-pixel-480.png`);
    const colors = colorCount(pixelShot);
    check(colors > 8, `frame has real content (${colors} distinct colors)`);
    const pixelBlocks = blockUniformity(pixelShot, 2);
    check(pixelBlocks > 0.995, `pixel mode is blocky: ${(pixelBlocks * 100).toFixed(1)}% uniform 2×2 blocks`);

    // Raw 3D mode: same renderer, same canvas, same camera + character.
    const before = await state(page);
    await page.keyboard.press('KeyP');
    await waitFrames(page, 5);
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
    await waitFrames(page, 3);
    check((await state(page)).mode === 'pixel', 'P toggles back to Pixel mode');

    // Comparison resolution keeps framing.
    await page.keyboard.press('KeyR');
    await waitFrames(page, 5);
    st = await state(page);
    check(st.resolution.width === 320 && st.framing.scale === 3, `R switches to 320×180 at ${st.framing.scale}×`);
    check(JSON.stringify(st.view) === JSON.stringify(before.view), 'framing stable across resolutions (same visible world extents)');
    const shot320 = await capture(page, `${s.name}-pixel-320.png`);
    const blocks320 = blockUniformity(shot320, 3);
    check(blocks320 > 0.995, `320×180 is blocky at 3×: ${(blocks320 * 100).toFixed(1)}%`);
    await page.keyboard.press('KeyR');
    await waitFrames(page, 3);

    // Gameplay: move, jump, coin pickup.
    const p0 = (await state(page)).target;
    await hold(page, 'KeyA', 700);
    await waitFrames(page, 10);
    const p1 = (await state(page)).target;
    check(dist(p0, p1) > 1, `character moves with input (${dist(p0, p1).toFixed(2)} units)`);

    const yBefore = (await state(page)).target[1];
    await page.evaluate(() => window.__PIXEL_ENGINE__.input.setKey('Space', true));
    let peak = yBefore;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(40);
      peak = Math.max(peak, (await state(page)).target[1]);
    }
    await page.evaluate(() => window.__PIXEL_ENGINE__.input.setKey('Space', false));
    check(peak - yBefore > 0.8, `character jumps (peak +${(peak - yBefore).toFixed(2)})`);

    const coinsBefore = await page.evaluate(() => window.__PIXEL_ENGINE__.game.collected);
    await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.teleport([0, 0, 6]));
    await waitFrames(page, 10);
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
    st = await state(page);
    checkClean(st, logs);
    await writeFile(new URL(`${s.name}-state.json`, OUT), JSON.stringify(st, null, 2));
  } catch (e) {
    check(false, `scenario crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

async function runCameras(browserExe) {
  const s = SCENARIOS[0];
  for (const preset of ['iso', 'topdown', 'side', 'third', 'first', 'free']) {
    console.log(`\n▶ cameras: ${preset}`);
    let ctx;
    try {
      ctx = await openPage(browserExe, s, `camera=${preset}`);
      const { page, logs } = ctx;
      await waitFrames(page, 20);
      let st = await state(page);
      check(st.cameraRig.preset === preset, `rig preset is ${st.cameraRig.preset}`);
      const ui = await page.locator('[data-f="camera"]').textContent();
      check(ui.startsWith(preset), `debug UI shows camera "${ui}"`);
      const frame = await capture(page, `camera-${preset}.png`);
      check(colorCount(frame) > 8, `renders (${colorCount(frame)} colors)`);

      // Zoom: wheel up = zoom in, for every preset except first person.
      await page.evaluate(() => window.__PIXEL_ENGINE__.input.addPointer(0, 0, -4));
      await waitFrames(page, 3);
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
        await waitFrames(page, 3);
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
        await page.goto(`${s.url}?cam=${encodeURIComponent(JSON.stringify(config))}`);
        await page.waitForFunction(() => window.__PIXEL_ENGINE__?.frame > 30, null, { timeout: 90000 });
        st = await state(page);
        check(st.cameraRig.preset === 'fixed' && dist(st.camera, config.position) < 0.02, `?cam= config restores the fixed view (${st.camera.map((v) => v.toFixed(2))})`);
        await capture(page, 'camera-fixed.png');
      } else {
        const t0 = (await state(page)).target;
        await hold(page, 'KeyD', 700);
        await waitFrames(page, 10);
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
          await waitFrames(page, 3);
          check(Math.abs((await state(page)).cameraRig.yaw - yaw0) > 0.3, 'mouse turns the camera');
        }
        if (preset === 'first') {
          check(await page.evaluate(() => window.__PIXEL_ENGINE__.game.heroModel.visible === false), 'player model hidden in first person');
        }
      }
      checkClean(await state(page), logs);
    } catch (e) {
      check(false, `camera ${preset} crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
    } finally {
      await ctx?.browser.close();
    }
  }
}

async function runCameraSwap(browserExe, s) {
  console.log(`\n▶ camera hot-swap keeps the player (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(browserExe, s);
    const { page, logs } = ctx;
    // Move somewhere and pick up a coin so there is state to lose.
    await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.teleport([-4, 0, 5]));
    await waitFrames(page, 10);
    await hold(page, 'KeyD', 400);
    await waitFrames(page, 20);
    const renderer0 = await page.evaluate(() => (window.__rendererRef = window.__PIXEL_ENGINE__.renderer.renderer, true));
    const before = await page.evaluate(() => ({ feet: window.__PIXEL_ENGINE__.game.hero.feet.toArray(), coins: window.__PIXEL_ENGINE__.game.collected, url: location.href }));
    check(renderer0 && before.coins >= 1, `setup: player at ${before.feet.map((v) => v.toFixed(2))}, ${before.coins} coin(s)`);
    for (const preset of ['topdown', 'side', 'third', 'first', 'free', 'fixed', 'iso']) {
      await page.selectOption('[data-a="camera"]', preset);
      await waitFrames(page, 8);
      const now = await page.evaluate(() => ({
        feet: window.__PIXEL_ENGINE__.game.hero.feet.toArray(),
        coins: window.__PIXEL_ENGINE__.game.collected,
        preset: window.__PIXEL_ENGINE__.camera.preset,
        sameRenderer: window.__PIXEL_ENGINE__.renderer.renderer === window.__rendererRef,
        visible: window.__PIXEL_ENGINE__.game.heroModel.visible,
        url: location.search,
      }));
      const frame = await capture(page, `swap-${preset}.png`);
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
    await waitFrames(page, 20);
    await page.selectOption('[data-a="camera"]', 'fixed');
    await waitFrames(page, 4);
    const fixedAt = await page.evaluate(() => window.__PIXEL_ENGINE__.camera.camera.position.toArray());
    checkClean(await state(page), logs);
    await page.reload();
    await page.waitForFunction(() => window.__PIXEL_ENGINE__?.frame > 30, null, { timeout: 90000 });
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

async function runFilters(browserExe, s, label) {
  console.log(`\n▶ ${label}`);
  let ctx;
  try {
    ctx = await openPage(browserExe, s, 'debug=0');
    const { page, logs } = ctx;
    await page.evaluate(() => (window.__PIXEL_ENGINE__.paused = true)); // identical frames apart from the filter
    await waitFrames(page, 3);
    const base = await capture(page, `${label}-none.png`);
    check(colorCount(base) > 8, `unfiltered frame has real content (${colorCount(base)} colors)`);
    const ids = await page.evaluate(() => [...window.__PIXEL_ENGINE__.availableFilters]);
    let ok = 0;
    for (const id of ids) {
      const before = logs.length;
      await page.evaluate((id) => window.__PIXEL_ENGINE__.setFilters([id]), id);
      await waitFrames(page, 3);
      const f = await capture(page, `${label}-${id}.png`);
      const d = meanDiff(base, f);
      const errs = (await state(page)).gpuErrors.length;
      const good = d > 0.5 && errs === 0 && logs.length === before && colorCount(f) >= 2;
      if (good) ok++;
      else check(false, `filter ${id}: diff ${d.toFixed(2)}, gpuErrors ${errs}, ${logs.slice(before).join(' | ')}`);
    }
    check(ok === ids.length, `${ok}/${ids.length} filters compile, render and change the frame`);

    // Stacks and raw-mode bypass.
    await page.evaluate(() => window.__PIXEL_ENGINE__.setFilters(['gameboy', 'lcd', 'vignette']));
    await waitFrames(page, 3);
    check(meanDiff(base, await capture(page, `${label}-stack.png`)) > 0.5, 'a 3-filter stack renders');
    await page.keyboard.press('KeyP');
    await waitFrames(page, 3);
    const rawFiltered = await capture(page, `${label}-raw-filtered.png`);
    await page.evaluate(() => window.__PIXEL_ENGINE__.setFilters([]));
    await waitFrames(page, 3);
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
  const s = SCENARIOS[0];
  const headless = !process.env.DISPLAY;
  const browser = await chromium.launch({ executablePath: browserExe, args: s.args, headless });
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true });
    const logs = [];
    page.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && !ENVIRONMENT_NOISE.some((re) => re.test(m.text())))) && logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`${s.url}?touch=1&camera=third`);
    await page.waitForFunction(() => window.__PIXEL_ENGINE__?.frame > 30, null, { timeout: 90000 });
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
    await page.waitForTimeout(800);
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
    await waitFrames(page, 10);
    check((await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.stats.jumps)) > jumps0, 'A button jumps');

    // Drag on the game to orbit the camera.
    const yaw0 = (await state(page)).cameraRig.yaw;
    await page.mouse.move(420, 120);
    await page.mouse.down();
    await page.mouse.move(560, 120, { steps: 6 });
    await page.mouse.up();
    await waitFrames(page, 3);
    check(Math.abs((await state(page)).cameraRig.yaw - yaw0) > 0.3, 'dragging the game orbits the camera');

    // ⚙ shows the debug panel.
    await page.locator('.touch-ui .bar button').first().dispatchEvent('pointerdown');
    await page.locator('.touch-ui .bar button').first().dispatchEvent('pointerup');
    await waitFrames(page, 3);
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.debug-ui')).display !== 'none'), '⚙ opens the debug panel');
    await capture(page, 'touch-landscape.png');
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `touch crashed: ${e.message}`);
  } finally {
    await browser.close();
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
    const bad = await page.evaluate(() =>
      window.__ANIM_LAB__
        .clips()
        .map((n) => [n, window.__ANIM_LAB__.metrics(n).problems])
        .filter(([, p]) => p.length),
    );
    check(bad.length === 0, `every clip passes its metrics${bad.length ? ': ' + JSON.stringify(bad).slice(0, 400) : ''}`);
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
    await page.click('[data-a="play"]');
    const f0 = (await page.evaluate(() => window.__ANIM_LAB__.state())).frame;
    await waitFrames(page, 10);
    const f1 = (await page.evaluate(() => window.__ANIM_LAB__.state())).frame;
    check(f1 !== f0, 'play button advances the clip');
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `lab crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

await mkdir(OUT, { recursive: true });
const exe = await resolveExecutable();
const server = await startServer();
const suites = {
  webgpu: () => runCore(exe, SCENARIOS[0]),
  'webgl-fallback': () => runCore(exe, SCENARIOS[1]),
  'webgl-forced': () => runCore(exe, SCENARIOS[2]),
  cameras: () => runCameras(exe),
  'camera-swap': async () => {
    await runCameraSwap(exe, SCENARIOS[0]);
    await runCameraSwap(exe, SCENARIOS[1]);
  },
  'filters-webgpu': () => runFilters(exe, SCENARIOS[0], 'filters-webgpu'),
  'filters-webgl': () => runFilters(exe, SCENARIOS[1], 'filters-webgl'),
  touch: () => runTouch(exe),
  moves: () => runMoves(exe),
  lab: () => runLab(exe),
};
try {
  for (const [name, run] of Object.entries(suites)) if (!only || name === only) await run();
} finally {
  server.kill();
}
console.log(failures ? `\n✘ ${failures} check(s) failed` : '\n✔ all e2e checks passed');
process.exit(failures ? 1 : 0);
