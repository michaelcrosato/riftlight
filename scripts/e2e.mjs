// End-to-end verification in real Chromium, against the production build.
//
//   npm run build && npm run test:e2e      (wraps this in xvfb-run)
//
// Scenarios:
//   webgpu          native WebGPU (SwiftShader adapter in headless; real GPU elsewhere)
//   webgl-fallback  navigator.gpu disabled -> WebGPURenderer's built-in WebGL 2 backend
//   webgl-forced    ?backend=webgl debug override
//
// Each scenario asserts: expected backend in state + debug UI, zero GPU errors, zero
// console errors/warnings, gameplay responds to input (move, jump, coin pickup),
// Raw 3D toggle keeps the same renderer/canvas/camera/character, pixel mode really is
// blocky (scale x scale uniform blocks) while raw mode is not, and 320x180 keeps framing.
// Screenshots land in .scratch/e2e/.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

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

async function runScenario(browserExe, s) {
  console.log(`\n▶ ${s.name}`);
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

  try {
    await page.goto(s.url);
    await page.waitForFunction(() => window.__PIXEL_ENGINE__?.frame > 30, null, { timeout: 90000 });
    let st = await state(page);

    check(st.backend === s.backend, `backend is "${st.backend}" (expected "${s.backend}")`);
    const uiBackend = await page.locator('[data-f="backend"]').textContent();
    check(uiBackend.startsWith(s.backend), `debug UI shows "${uiBackend}"`);
    check(st.mode === 'pixel', 'starts in Pixel mode');
    check(st.resolution.width === 480 && st.resolution.height === 270, 'default internal resolution 480×270');
    check(st.framing.integer && st.framing.scale === 2 && st.framing.canvasWidth === 960, `integer scale ${st.framing.scale}× at 960×540`);

    // Idle → let physics settle.
    await waitFrames(page, 30);
    const renderer0 = await page.evaluate(() => {
      window.__rendererRef = window.__PIXEL_ENGINE__.renderer.renderer;
      window.__canvasRef = document.querySelector('canvas[data-engine-canvas]');
      return document.querySelectorAll('canvas').length;
    });
    check(renderer0 === 1, 'exactly one canvas');

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
    const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    check(dist(before.camera, raw.camera) < 1e-6, 'camera unchanged by mode toggle');
    check(dist(before.target, raw.target) < 1e-3, 'character unchanged by mode toggle');
    check(raw.framing.canvasWidth === before.framing.canvasWidth, 'framing unchanged by mode toggle');
    const rawShot = await capture(page, `${s.name}-raw.png`);
    const rawBlocks = blockUniformity(rawShot, 2);
    // Flat areas are uniform in any mode; raw mode shows up as many more mixed blocks at edges.
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

    // Gameplay: move, jump, coins.
    const p0 = (await state(page)).target;
    await hold(page, 'KeyA', 700);
    await waitFrames(page, 10);
    const p1 = (await state(page)).target;
    check(dist(p0, p1) > 1, `character moves with input (${dist(p0, p1).toFixed(2)} units)`);

    const yBefore = (await state(page)).target[1];
    await page.evaluate(() => window.__PIXEL_ENGINE__.input.setKey('Space', true));
    let peak = yBefore;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(40);
      peak = Math.max(peak, (await state(page)).target[1]);
    }
    await page.evaluate(() => window.__PIXEL_ENGINE__.input.setKey('Space', false));
    check(peak - yBefore > 0.8, `character jumps (peak +${(peak - yBefore).toFixed(2)})`);

    // Walk to the coin at (-2, 0, 2) from spawn area and check pickup counter moves.
    const coinsBefore = (await state(page)).status;
    await page.evaluate(() => {
      const g = window.__PIXEL_ENGINE__.game;
      g.hero.teleport([-2, 0, 2.6]);
    });
    await hold(page, 'KeyW', 400);
    await waitFrames(page, 10);
    const coinsAfter = (await state(page)).status;
    check(coinsAfter !== coinsBefore, `coin pickup updates status (${coinsBefore} → ${coinsAfter})`);

    // Regression: teleporting next to a wall must not let the next step tunnel into it.
    // Mist block spans x ∈ [-2.5, 0.5] at z = -7; capsule radius 0.3.
    await page.evaluate(() => {
      const hero = window.__PIXEL_ENGINE__.game.hero;
      hero.teleport([0.85, 0, -7]);
      hero.velocity.x = -60;
    });
    await waitFrames(page, 10);
    const wallX = await page.evaluate(() => window.__PIXEL_ENGINE__.game.hero.feet.x);
    check(wallX > 0.7, `teleport next to a wall doesn't penetrate it (feet x = ${wallX.toFixed(3)})`);

    await capture(page, `${s.name}-after-play.png`);
    st = await state(page);
    check(st.gpuErrors.length === 0, `zero GPU errors${st.gpuErrors.length ? ': ' + JSON.stringify(st.gpuErrors) : ''}`);
    check(logs.length === 0, `zero console errors/warnings${logs.length ? ':\n    ' + logs.join('\n    ') : ''}`);
    await writeFile(new URL(`${s.name}-state.json`, OUT), JSON.stringify(st, null, 2));
  } catch (e) {
    check(false, `scenario crashed: ${e.message}\n    ${logs.join('\n    ')}`);
  } finally {
    await browser.close();
  }
}

await mkdir(OUT, { recursive: true });
const exe = await resolveExecutable();
const server = await startServer();
try {
  for (const s of SCENARIOS) if (!only || s.name === only) await runScenario(exe, s);
} finally {
  server.kill();
}
console.log(failures ? `\n✘ ${failures} check(s) failed` : '\n✔ all e2e checks passed');
process.exit(failures ? 1 : 0);
