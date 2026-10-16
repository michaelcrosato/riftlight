// End-to-end verification in real Chromium, against the production build.
//
//   npm run build && npm run test:e2e      (headless: no display needed, scripts/browser.mjs)
//
//   npm run test:e2e -- <suite|@group> ...   run some suites (CI runs the groups in parallel);
//                                            `-- --help` lists them (SUITES and GROUPS below)
//   E2E_PORT=4301 npm run test:e2e         serve on another port (several runs on one machine)
//   E2E_VERBOSE=1 npm run test:e2e         print every check as it runs. By default a passing
//                                          check prints nothing and a suite one line
//                                          (`✔ <suite>: <n> checks, <t> s`); a failing suite
//                                          prints all it logged, its `✘` lines among it, first.
//
// The engine renders with WebGPU only (docs/DOCTRINE.md, principle 6); every suite runs on it.
//   webgpu          native WebGPU (SwiftShader's Vulkan adapter in Chromium's headless shell):
//                   the backend in state + debug UI, zero GPU errors, zero console
//                   errors/warnings, one canvas, gameplay responds to input, Raw 3D toggle keeps
//                   the same renderer/canvas/camera/character, pixel mode is blocky while raw
//                   mode is not, 320x180 keeps framing.
//   no-webgpu       a browser without WebGPU: the start fails and says why, no engine, no canvas.
//
// camera-swap     live preset swaps keep the player, coins and renderer;
//                 a swapped-to fixed view survives reload.
// cameras         every camera preset renders, zooms (except first person), moves the
//                 character in its own basis; side locks the lane; free → fix → reload as fixed.
// filters-webgpu  every post filter compiles and changes the frame,
//                 with zero errors; every look renders; per-layer looks change only their
//                 layer (pixel characters on a clean world, a grade on the environment only);
//                 sliders don't rebuild the graph; Raw 3D mode bypasses filters.
// touch           phone-sized viewport: joystick, action buttons, drag-to-orbit, ⓘ debug panel, and the
//                 runtime button API a game drives (touch.set, rects, show).
// phone           portrait viewport fills the screen (adaptive aspect, integer blocks); a lost
//                 GPU device is recovered with a working renderer;
//                 Riftlight as a player opens it on a phone, portrait and landscape,
//                 no ?debug (scripts/e2e-riftlight-phone.mjs): no engine tool bar,
//                 a touch button for every skill-bar slot that reaches the game, no HUD element
//                 under a control, controls off the menus, panels that fit with big targets.
// moves           the whole PlatformerCharacter moveset (scripts/e2e-moves.mjs).
// lab             Animation Lab (/lab.html): clips, metrics API, views, scrubbing, contact
//                 sheets, curves and the agent API; frames of a few clips saved. (Every clip's
//                 metrics are checked by the unit tests: src/engine/animation/animation.test.ts.)
// asset-lab       Asset Lab (/asset-lab.html): every library model renders over the empty floor,
//                 the close zoom, a light requested and released, bad ids/zooms/looks throw, a
//                 lineup, a look, capture, the ?model=&zoom= and ?lineup= URL params, and a
//                 few frames of Gate B's scene (npm run gate-b) scored.
// riftlight       the Riftlight game shell (scripts/e2e-riftlight.mjs): title,
//                 new run, town (a walk to every district and back), rift keeper, level 1 with the basic attack, gold, clear, loot
//                 window, portal, autosave, pause → Tuning (enemy life applies live), death
//                 recap, save → reload → Continue. Then the real loot, skills and tree
//                 (scripts/e2e-riftlight-items.mjs): drops, pickup, equip, sockets, the tree and
//                 its respec, vendor, crafting, the stash across a reload, a label click after a
//                 lost device, and every item window on a portrait phone.
// riftlight-tree  the passive tree page /tree.html (scripts/e2e-riftlight-tree.mjs).
// riftlight-loot  the Loot Lab (?game=lootlab): drops, pickup, filter, inventory, equip (scripts/e2e-riftlight-loot.mjs).
// tools           agent tooling smoke tests: `npm run build:single` gives one self-contained
//                 HTML file that runs from file:// with zero errors and no network requests;
//                 `npm run film` films a short script and writes its PNG + JSON; `npm run balance`
//                 (a small matrix) and `npm run inspect` (hero, a monster, a prop, a diff) write
//                 their JSON, CSV and PNGs; `npm run model` checks the library in under 10 s,
//                 draws a sheet, a compare sheet and a zoo, finds and diffs models, imports our own
//                 tree.glb (a clean draft, IoU ≥ 0.98), refuses a disallowed licence, a
//                 third-party file or pack nobody approved (import, import --pack, import-pack),
//                 own work with an outside source and an unsafe id, and writes the credits;
//                 `npm run tex` checks, draws a re-bound sheet and the zoo, finds, refuses an
//                 unknown id, imports the library's coin (baked to a PNG) back as 4 frames (no
//                 merges, a clean draft that bakes to the same texels), and refuses a disallowed
//                 licence, a third-party file or pack nobody approved, own work with an outside
//                 source, an unsafe id and a grid that doesn't fit.
// riftlight-combat  the Riftlight combat arena (scripts/e2e-riftlight-combat.mjs).
// riftlight-replay  a Riftlight session by input alone, recorded and replayed to the same state (scripts/e2e-riftlight-replay.mjs).
// riftlight-snapshot  Riftlight save-states: a moment in town restored (also from a level) plays on the same (scripts/e2e-riftlight-snapshot.mjs).
// riftlight-builds  charges, curses, totems, traps, aura reservation (arena) and a mechanic affix
//                 in level 1 (scripts/e2e-riftlight-builds.mjs).
// systems         game systems (scripts/e2e-systems.mjs): pixel HUD, audio,
//                 particles, coin triggers, gamepad, pause, hotkeys, engine.loadGame without
//                 leaks, textured toon materials and a textured model (built and merged),
//                 engine.dispose().
// settings        the player's settings (scripts/e2e-settings.mjs): no engine hotkeys without
//                 ?debug=1; the ⚙ panel pauses the game and every control changes the engine; the
//                 choices are saved per game, a URL review flag wins at start, Reset undoes them.
//
// riftlight-showcase  the showcase in Riftlight (scripts/e2e-riftlight-showcase.mjs):
//                 the arcade cabinet (swoop in, side camera + CRT, the scripted run to the flag,
//                 best time + gold in the save, Esc out with nothing left behind), the Hall of
//                 Beasts (first person, exhibits from killed genomes, inspect, a clip, breeding,
//                 free camera) and photo mode (gameboy PNG, raw, time of day, restore).
//
// riftlight-levels  Riftlight levels + the dynamic light pool (scripts/e2e-riftlight-levels.mjs),
//                 levels 1, 6, 12 and a rift build, render, keep 8 lights
//                 without recompiles, walk start → exit with Engine.step, open the portal.
//
// world           Engine World, the engine's tech demo (scripts/e2e-world.mjs):
//                 a door per room, walking into one (an iris, the room as its own Game), every
//                 room renders and its first pad works, hitstop / shake / flash / game speed,
//                 the panels, a mosaic transition, and the Atrium the same after every room.
//
// bundle          the engine kit in dist/engine (scripts/e2e-bundle.mjs): its files, manifest and
//                 zip, its types, its check.mjs on every page, every guide
//                 recipe played as the guide describes, and errors reported (box, engine.errors);
//                 the handoff page (/handoff/) links only files the kit ships.
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
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { format } from 'node:util';
import { chromium } from 'playwright-core';
import { headlessShell, WEBGL_ARGS, WEBGPU_ARGS } from './browser.mjs';
import { MOVES, PAGE_HELPERS } from './e2e-moves.mjs';
import { runRiftlight } from './e2e-riftlight.mjs';
import { runRiftlightItems } from './e2e-riftlight-items.mjs';
import { runRiftlightTree } from './e2e-riftlight-tree.mjs';
import { runSettings } from './e2e-settings.mjs';
import { runSystems } from './e2e-systems.mjs';
import { runRiftlightLoot } from './e2e-riftlight-loot.mjs';
import { runRiftlightLevels } from './e2e-riftlight-levels.mjs';
import { runRiftlightCombat } from './e2e-riftlight-combat.mjs';
import { runRiftlightReplay } from './e2e-riftlight-replay.mjs';
import { runRiftlightSnapshot } from './e2e-riftlight-snapshot.mjs';
import { runRiftlightMonsters } from './e2e-riftlight-monsters.mjs';
import { runRiftlightBuilds } from './e2e-riftlight-builds.mjs';
import { runRiftlightShowcase } from './e2e-riftlight-showcase.mjs';
import { runRiftlightPhone } from './e2e-riftlight-phone.mjs';
import { runBundle } from './e2e-bundle.mjs';
import { runWorld } from './e2e-world.mjs';

const PORT = Number(process.env.E2E_PORT) || 4179;
const BASE = `http://localhost:${PORT}/`;
const ROOT = new URL('../', import.meta.url);
const OUT = new URL('.scratch/e2e/', ROOT);

const SCENARIOS = [
  {
    name: 'webgpu',
    url: BASE,
    // SwiftShader's Vulkan adapter in Chromium's headless shell (scripts/browser.mjs)
    args: WEBGPU_ARGS,
    backend: 'WebGPU',
  },
  {
    // a browser without WebGPU: the start fails, saying so (the engine renders with WebGPU only)
    name: 'no-webgpu',
    url: BASE,
    args: WEBGL_ARGS,
    backend: null,
    // Chromium's own notice that it has no WebGPU to give
    expectedWarnings: [/Failed to create WebGPU Context Provider/],
  },
];

// Software-rasterizer driver chatter (ANGLE/SwiftShader performance notes), not app output.
const ENVIRONMENT_NOISE = [/GL Driver Message \(OpenGL, Performance/];

const VERBOSE = /^(1|true|yes)$/i.test(process.env.E2E_VERBOSE ?? '');
let failures = 0;
let checks = 0;

function check(cond, msg) {
  checks++;
  if (cond) {
    if (VERBOSE) console.log(`  ✔ ${msg}`);
  } else {
    console.log(`  ✘ ${msg}`);
    failures++;
  }
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
  const browser = await chromium.launch({ executablePath: browserExe, args: s.args, headless: true });
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
  // Riftlight is the page's default game; the engine suites test the movement playground,
  // so they ask for it unless a suite picks a game itself.
  if (!/(^|[?&])game=/.test(`${s.url}&${query}`)) query = query ? `${query}&game=playground` : 'game=playground';
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
 * A browser without WebGPU (scripts/browser.mjs WEBGL_ARGS), and one whose adapter gives no device
 * (three would fall back to WebGL 2): the engine renders with WebGPU only, so the start fails and
 * says why, on Riftlight and on the playground; no engine, no canvas, and no error but the one the
 * page logs.
 */
async function runNoWebGPU(browserExe, s) {
  console.log(`\n▶ ${s.name} (a browser without WebGPU is told so)`);
  const cases = [
    { label: 'no WebGPU', scenario: s, query: 'debug=0' },
    { label: 'no WebGPU', scenario: s, query: 'game=playground&debug=0' },
    // an adapter, but its device refuses: three falls back to WebGL 2, the engine refuses that
    { label: 'no device', scenario: { ...SCENARIOS[0], expectedWarnings: [/WebGPU is not available, running under WebGL2 backend/] }, query: 'debug=0', noDevice: true },
  ];
  for (const c of cases) {
    let ctx;
    try {
      ctx = await launch(browserExe, c.scenario);
      const { page, logs } = ctx;
      if (c.noDevice) await page.addInitScript(() => (GPUAdapter.prototype.requestDevice = () => Promise.reject(new Error('no device here'))));
      await page.goto(`${s.url}?${c.query}`);
      await page.waitForSelector('.fatal', { timeout: 30000 });
      const text = (await page.locator('.fatal').textContent()) ?? '';
      check(/^Failed to start: WebGPU unavailable: this browser has no WebGPU/.test(text), `${c.label}, ${c.query}: the page says "${text}"`);
      const left = await page.evaluate(() => ({ engine: !!window.__PIXEL_ENGINE__, canvases: document.querySelectorAll('canvas[data-engine-canvas]').length }));
      check(!left.engine && left.canvases === 0, 'no engine, no canvas');
      const others = logs.filter((l) => !/^error: Error: WebGPU unavailable/.test(l));
      check(others.length === 0 && logs.length === 1, `one error logged, the reason${others.length ? ':\n    ' + others.join('\n    ') : ''}`);
    } catch (e) {
      check(false, `no-webgpu (${c.label}, ${c.query}) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
    } finally {
      await ctx?.browser.close();
    }
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

    // Looks: characters & objects (the hero, crates, coins) and the environment render as
    // two passes with their own pixel art and filters, composed by depth.
    await page.evaluate(() => window.__PIXEL_ENGINE__.setFilters([]));
    const looks = await page.evaluate(() => Object.keys(window.__PIXEL_ENGINE__.lookPresets));
    const shotLook = (look, file) => page.evaluate((l) => window.__PIXEL_ENGINE__.setLook(typeof l === 'string' ? window.__PIXEL_ENGINE__.lookPresets[l] : l), look).then(() => capture(page, file));
    const changed = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 6) n++;
      return n / (a.pixels.length / 4);
    };
    let lookOk = 0;
    for (const name of looks) {
      const before = logs.length;
      const f = await shotLook(name, `${label}-look-${name}.png`);
      const st = await state(page);
      const good = st.gpuErrors.length === 0 && logs.length === before && colorCount(f) >= 2 && st.look === name && (name === 'none' || meanDiff(base, f) > 0.05);
      if (good) lookOk++;
      else check(false, `look ${name}: look ${st.look}, diff ${meanDiff(base, f).toFixed(2)}, gpuErrors ${st.gpuErrors.length}, ${logs.slice(before).join(' | ')}`);
    }
    check(lookOk === looks.length, `${lookOk}/${looks.length} looks render (${looks.length - 1} besides the default)`);
    const hd = await shotLook('no_filters', `${label}-look-hd.png`);
    const heroes = await shotLook('pixel_heroes', `${label}-look-heroes.png`);
    const split = (await state(page)).split;
    const onActors = changed(hd, heroes);
    check(split && onActors > 0.0005 && onActors < 0.03, `pixel-art characters on a clean world: two passes, only the characters change (${(onActors * 100).toFixed(2)}% of pixels)`);
    const grayAll = await shotLook({ scene: [{ id: 'grayscale' }] }, `${label}-look-gray.png`);
    const grayWorld = await shotLook({ scene: [], environment: { filters: [{ id: 'grayscale' }] } }, `${label}-look-gray-world.png`);
    const colour = changed(grayAll, grayWorld);
    check(colour > 0.0005 && colour < 0.05, `a grade on the environment only leaves the characters in colour (${(colour * 100).toFixed(2)}% of pixels differ from grading everything)`);
    const graph = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const node = e.renderer.pipeline.outputNode;
      const look = e.look;
      look.environment.filters[0].params.amount = 0.4;
      look.environment.pixel.size = 3;
      look.environment.pixel.outline = 0.9;
      e.setLook(look);
      return { same: e.renderer.pipeline.outputNode === node, amount: e.look.environment.filters[0].params.amount };
    });
    const tweaked = await capture(page, `${label}-look-tweaked.png`);
    const moved = meanDiff(grayWorld, tweaked);
    check(graph.same && graph.amount === 0.4 && moved > 0.5, `sliders (strength, pixel size, outline) change the frame (diff ${moved.toFixed(2)}) and only move uniforms: the graph is not rebuilt`);
    await page.evaluate(() => window.__PIXEL_ENGINE__.setLook(window.__PIXEL_ENGINE__.lookPresets.none));

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
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.debug-ui')).display === 'none'), 'debug panel starts hidden behind ⓘ');

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

    // ⓘ shows the debug panel.
    await page.locator('.touch-ui .bar button').first().dispatchEvent('pointerdown');
    await page.locator('.touch-ui .bar button').first().dispatchEvent('pointerup');
    await until(page, () => getComputedStyle(document.querySelector('.debug-ui')).display !== 'none', null, 3);
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.debug-ui')).display !== 'none'), 'ⓘ opens the debug panel');
    await capture(page, 'touch-landscape.png');

    // The runtime API a game drives its buttons with: state, rects, show/hide.
    const api = await page.evaluate(() => {
      const t = window.__PIXEL_ENGINE__.touch;
      const input = window.__PIXEL_ENGINE__.input;
      const b = document.querySelector('.touch-ui button[data-code="KeyJ"]');
      t.set('KeyJ', { cooldown: 0.5, timer: '2', badge: '5', disabled: true, label: 'Q' });
      const shown = { disabled: b.classList.contains('disabled'), shutter: b.querySelector('.shutter').style.height, timer: b.querySelector('.timer').textContent, badge: b.querySelector('.badge').textContent, label: b.querySelector('b').textContent };
      t.set('KeyJ', { hidden: true });
      const r = t.rects();
      const hidden = { kept: r.buttons.length, flagged: r.buttons.find((x) => x.code === 'KeyJ').hidden, visibility: getComputedStyle(b).visibility, stick: !!r.stick };
      t.set('KeyJ', { hidden: false, disabled: false, cooldown: 0, timer: '', badge: '', label: 'B' });
      // hiding the controls releases a held button and the stick
      b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true }));
      const held = input.isDown('KeyJ');
      t.show(false);
      const released = !input.isDown('KeyJ') && !t.visible && getComputedStyle(document.querySelector('.touch-ui .stick')).display === 'none' && t.rects().buttons.length === 0;
      t.show(true);
      return { shown, hidden, held, released, back: t.visible && t.rects().buttons.length === 6 };
    });
    check(api.shown.disabled && api.shown.shutter === '50%' && api.shown.timer === '2' && api.shown.badge === '5' && api.shown.label === 'Q', `touch.set shows a cooldown shutter, timer, badge, label and the disabled state (${JSON.stringify(api.shown)})`);
    check(api.hidden.kept === 6 && api.hidden.flagged && api.hidden.visibility === 'hidden' && api.hidden.stick, 'a hidden button keeps its place in touch.rects() (flagged hidden)');
    check(api.held && api.released && api.back, 'touch.show(false) hides the controls and releases a held button; show(true) brings them back');
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

async function runAssetLab(browserExe) {
  for (const s of [SCENARIOS[0]]) {
    console.log(`\n▶ asset-lab (Asset Lab, ${s.name})`);
    let ctx;
    try {
      ctx = await openPage(browserExe, { ...s, url: `${BASE}asset-lab.html` }, 'debug=0');
      const { page, logs } = ctx;
      await page.waitForFunction(() => window.__ASSET_LAB__, null, { timeout: 30000 });
      const st0 = await state(page);
      check(st0.backend === s.backend, `backend ${st0.backend}`);
      const ids = await page.evaluate(() => window.__ASSET_LAB__.list());
      check(ids.length >= 7, `lists ${ids.length} models`);
      const drawn = ids;
      // every model renders in the real pipeline (close up, so a 0.3 m rock fills enough
      // pixels): against the empty floor at the same camera, with its light off so a lit floor
      // can't pass for it
      const changed = (a, b) => {
        let n = 0;
        for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 24) n++;
        return n;
      };
      for (const id of drawn) {
        const r = await page.evaluate((m) => {
          const info = window.__ASSET_LAB__.show(m, { light: { intensity: 0 } });
          window.__ASSET_LAB__.zoom('close');
          return info;
        }, id);
        await stableCamera(page, `${id}: `);
        const img = await capture(page, `asset-lab-${s.name}-${id}.png`);
        await page.evaluate(() => window.__ASSET_LAB__.clear());
        await waitFrames(page, 3);
        const empty = await capture(page, `asset-lab-${s.name}-${id}-empty.png`);
        const px = changed(img, empty);
        check(r.tris > 0 && px > 300, `${id}: ${r.tris} tris, ${r.draws} draws, ${px} pixels over the empty floor`);
      }
      await page.evaluate(() => {
        window.__ASSET_LAB__.show('market-stall');
        window.__ASSET_LAB__.zoom('close');
      });
      await waitFrames(page, 3);
      const close = await capture(page, `asset-lab-${s.name}-market-stall-close.png`);
      check(colorCount(close) > 20 && (await page.evaluate(() => window.__ASSET_LAB__.state().zoom)) === 3, `zoom('close') shows the detail (${colorCount(close)} colours)`);
      // state().lights counts live requests: a released one fades out but is no longer live
      const lightsAfter = (id) =>
        page.evaluate((m) => {
          window.__ASSET_LAB__.show(m);
          return window.__ASSET_LAB__.state().lights;
        }, id);
      const lights = [await lightsAfter('lamp-post'), await lightsAfter('crate')];
      check(lights[0] === 1 && lights[1] === 0, `the lamp post requests its light, and showing the crate releases it (${lights.join(' → ')} requests)`);
      const bad = await page.evaluate(() => {
        const out = [];
        for (const f of [() => window.__ASSET_LAB__.show('nope'), () => window.__ASSET_LAB__.zoom('bogus'), () => window.__ASSET_LAB__.setLook('nope'), () => window.__ASSET_LAB__.lineup([])]) {
          try {
            f();
            out.push('no error');
          } catch {
            out.push('threw');
          }
        }
        return { out, shown: window.__ASSET_LAB__.state().shown, zoom: window.__ASSET_LAB__.state().zoom };
      });
      check(bad.out.every((o) => o === 'threw') && bad.shown.join() === 'crate' && bad.zoom > 0, `a bad id, zoom, look or an empty lineup throws and leaves the lab as it was (${bad.out.join(', ')}; ${bad.shown.join()})`);
      // Gate B's scene (npm run gate-b): a few frames of a zoom step (textured, then flat: the texels
      // must be what changes), a pan (the rig snaps to art pixels, so it shifts and barely changes)
      // and the sliding crate score
      const gate = await page.evaluate(async () => {
        const g = window.__ASSET_LAB__.gateB;
        const before = window.__ASSET_LAB__.state().zoom;
        const steps = [1, 1.03, 1.06, 1.08].map((z) => ({ zoom: z }));
        const settle = (f) => g.run(Array.from({ length: 20 }, () => f)); // the camera and the light settle
        const zoomOf = async (set) => {
          g.scene(set, 8);
          await settle({ zoom: 1 });
          return (await g.run(steps)).changed;
        };
        const flat = await zoomOf('flat');
        const scene = g.scene('library', 8);
        await settle({ zoom: 1 });
        const zoom = await g.run(steps);
        await settle({ zoom: 1.08, pan: 0 });
        const pan = await g.run(Array.from({ length: 24 }, (_, i) => ({ zoom: 1.08, pan: i / 60 })));
        await settle({ zoom: 1, crate: -1 });
        const crate = await g.run([0, 1, 2].map((i) => ({ zoom: 1, crate: -1 + i / 30 })), [2]);
        g.clear();
        const st = window.__ASSET_LAB__.state();
        return { scene, zoom: zoom.changed, flat, pan: pan.changed, snaps: pan.shift.filter(([dx, dy]) => dx || dy).length, crate: crate.changed, shot: crate.shots.length, size: [zoom.width, zoom.height], shown: st.shown, zoomBack: Math.abs(st.zoom - before) < 1e-6, live: !window.__PIXEL_ENGINE__.manual };
      });
      check(
        gate.scene.tris > 50 && gate.zoom.length === 4 && gate.zoom.slice(1).every((c, i) => c > 4 * gate.flat[i + 1] && c > 0.1) && gate.snaps > 0 && gate.pan.every((c) => c < 0.01) && gate.crate.slice(1).every((c) => c > 0 && c < 0.05) && gate.shot === 1 && gate.zoomBack && gate.live,
        `Gate B scene: zooming changes ${gate.zoom.slice(1).map((c) => (c * 100).toFixed(1)).join('/')}% textured, ${gate.flat.slice(1).map((c) => (c * 100).toFixed(1)).join('/')}% flat; a pan snaps ${gate.snaps} times and changes ≤ ${(Math.max(...gate.pan) * 100).toFixed(2)}%; the crate ${gate.crate.slice(1).map((c) => (c * 100).toFixed(2)).join('/')}% of ${gate.size.join('×')} pixels; the lab is back (${gate.shown.join()}, zoom ${gate.zoomBack ? 'restored' : 'NOT restored'})`,
      );
      await page.evaluate(() => window.__ASSET_LAB__.lineup());
      await waitFrames(page, 3);
      const all = await page.evaluate(() => window.__ASSET_LAB__.state());
      const lineup = await capture(page, `asset-lab-${s.name}-lineup.png`);
      check(all.shown.length === ids.length && all.zoom <= 1.08 + 1e-6 && colorCount(lineup) > 10, `lineup of ${all.shown.length} at zoom ${all.zoom.toFixed(2)}`);
      await page.evaluate(() => window.__ASSET_LAB__.setLook('handheld'));
      await waitFrames(page, 3);
      const gb = await capture(page, `asset-lab-${s.name}-handheld.png`);
      check(colorCount(gb) < colorCount(lineup), `setLook('handheld') re-renders the lineup (${colorCount(lineup)} → ${colorCount(gb)} colours)`);
      const png = await page.evaluate(() => window.__ASSET_LAB__.capture());
      check(png.startsWith('data:image/png') && png.length > 2000, 'capture() returns a PNG');
      checkClean(await state(page), logs.filter((l) => !(s.expectedWarnings ?? []).some((re) => re.test(l))));
    } catch (e) {
      check(false, `asset-lab crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
    } finally {
      await ctx?.browser.close();
    }
    // the URL: a model at a named zoom, then a lineup of two
    for (const [q, want] of [['model=well&zoom=town', (st) => st.shown.join() === 'well' && Math.abs(st.zoom - 1.22) < 1e-6], ['lineup=barrel,crate&cols=2', (st) => st.shown.join() === 'barrel,crate' && st.zoom <= 1.08 + 1e-6]]) {
      let c;
      try {
        c = await openPage(browserExe, { ...s, url: `${BASE}asset-lab.html` }, `debug=0&${q}`);
        await c.page.waitForFunction(() => window.__ASSET_LAB__, null, { timeout: 30000 });
        const st = await c.page.evaluate(() => window.__ASSET_LAB__.state());
        check(want(st), `?${q}: ${st.shown.join(', ')} at zoom ${st.zoom.toFixed(2)}`);
      } catch (e) {
        check(false, `asset-lab ?${q} crashed: ${e.message}`);
      } finally {
        await c?.browser.close();
      }
    }
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
    const s = SCENARIOS[0];
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

  const pngSize = async (url) => {
    const png = await readFile(url);
    return png.subarray(1, 4).toString() === 'PNG' ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length } : { width: 0, height: 0, bytes: 0 };
  };

  console.log('\n▶ tools: npm run balance');
  try {
    const out = new URL('balance/', OUT);
    await rm(out, { recursive: true, force: true });
    const t0 = Date.now();
    const ran = await run('npx', ['tsx', 'scripts/riftlight/balance.ts', '--depths', '1,13', '--max', '13', '--samples', '2', '--candidates', '2', '--out', '.scratch/e2e/balance', '--json']);
    check(ran.code === 0, `balance exits 0 in ${((Date.now() - t0) / 1000).toFixed(1)} s${ran.code ? ':\n    ' + tail(ran.out) : ''}`);
    const report = JSON.parse(await readFile(new URL('balance.json', out), 'utf8'));
    const rows = report.rows;
    check(rows.length === 16 && rows.every((r) => r.ttk.normal > 0 && r.ttk.boss > r.ttk.normal && r.clear.total > 0), `16 rows (4 builds × naked/geared × 2 depths) with TTK and clear times (${rows.length})`);
    check(report.xp.length === 13 && report.xp[12].levelAfter > report.xp[0].levelAfter, `XP curve over every depth (level ${report.xp[0].levelAfter} → ${report.xp[12]?.levelAfter})`);
    check(Array.isArray(report.outliers) && report.assumptions.lines.length > 5, `outliers (${report.outliers.length}) and the assumptions are in the JSON`);
    const csv = (await readFile(new URL('balance.csv', out), 'utf8')).trim().split('\n');
    check(csv.length === 17 && csv[0].startsWith('build,variant,depth'), `CSV has a header and 16 rows (${csv.length - 1})`);
    for (const name of ['ttk', 'survival', 'clear', 'balance']) {
      const p = await pngSize(new URL(`${name}.png`, out));
      check(p.width >= 900 && p.height >= 400 && p.bytes > 5000, `${name}.png ${p.width}×${p.height}`);
    }
  } catch (e) {
    check(false, `balance crashed: ${e.message}`);
  }

  console.log('\n▶ tools: npm run inspect');
  try {
    const out = new URL('inspect/', OUT);
    await rm(out, { recursive: true, force: true });
    const ran = await run('npx', ['tsx', 'scripts/inspect.ts', 'hero', 'monster:3', 'prop:brazier', '--out', '.scratch/e2e/inspect', '--json']);
    check(ran.code === 0, `inspect exits 0${ran.code ? ':\n    ' + tail(ran.out) : ''}`);
    const hero = JSON.parse(await readFile(new URL('hero.json', out), 'utf8'));
    check(hero.triangles > 100 && hero.joints.length === 15 && hero.clips.length > 20 && hero.bounds.size[1] > 1.5, `hero: ${hero.triangles} tris, ${hero.joints.length} joints, ${hero.clips.length} clips, ${hero.bounds.size[1]} m tall`);
    const monster = JSON.parse(await readFile(new URL('monster-3.json', out), 'utf8'));
    check(monster.joints.length > 2 && monster.clips.some((c) => c.name === 'Idle'), `monster:3: ${monster.joints.length} joints, clips ${monster.clips.map((c) => c.name).join(' ')}`);
    for (const name of ['hero', 'monster-3', 'prop-brazier-ember-forge']) {
      const p = await pngSize(new URL(`${name}.png`, out));
      check(p.width > 1000 && p.height > 400 && p.bytes > 10000, `${name}.png ${p.width}×${p.height}`);
    }
    const diff = await run('npx', ['tsx', 'scripts/inspect.ts', 'diff', 'coin', 'tree', '--out', '.scratch/e2e/inspect', '--json']);
    const d = JSON.parse(await readFile(new URL('diff-coin-vs-tree.json', out), 'utf8'));
    check(diff.code === 0 && !d.same && d.counts.meshes[2] === 1 && d.clips.removed.includes('Spin'), `diff coin tree: meshes +${d.counts.meshes[2]}, clips -${d.clips.removed.join(',')}`);
  } catch (e) {
    check(false, `inspect crashed: ${e.message}`);
  }

  console.log('\n▶ tools: npm run model');
  try {
    const out = new URL('model/', OUT);
    await rm(out, { recursive: true, force: true });
    const m = (...args) => run('npx', ['tsx', 'scripts/model.ts', ...args, '--out', '.scratch/e2e/model']);
    const t0 = Date.now(); // real time: the check's own budget
    const checked = await m('check');
    const secs = (Date.now() - t0) / 1000; // real time: the check's own budget
    check(checked.code === 0 && /\b0 with problems/.test(checked.out) && secs < 10, `check exits 0 in ${secs.toFixed(1)} s: ${checked.out.trim().split('\n').pop()}`);
    const sheet = await m('sheet', 'market-stall', '--labels', '--rig');
    const s = JSON.parse(await readFile(new URL('market-stall.json', out), 'utf8'));
    check(sheet.code === 0 && s.tris > 500 && s.draws === s.materials && s.problems.length === 0, `sheet market-stall: ${s.tris} tris, ${s.draws} draws`);
    const p = await pngSize(new URL('market-stall.png', out));
    check(p.width > 1000 && p.height > 500 && p.bytes > 10000, `market-stall.png ${p.width}×${p.height}`);
    // a re-bound slot is a new version: diff says what changed, --compare draws the old one
    const diff = await m('diff', 'market-stall', '--palette', 'cloth=blue', '--json');
    const dj = diff.code === 0 ? JSON.parse(diff.out) : { recoloured: [], moved: [] };
    check(dj.recoloured.length === 3 && dj.recoloured.every((r) => r.endsWith('red → blue')) && dj.moved.length === 0, `diff after a palette change names the 3 recoloured stripes: ${dj.recoloured.join('; ')}${diff.code ? `\n    ${tail(diff.out)}` : ''}`);
    const compared = await m('sheet', 'market-stall', '--palette', 'cloth=blue', '--compare', '--json');
    check(compared.code === 0 && JSON.parse(await readFile(new URL('market-stall.json', out), 'utf8')).compared === true, 'sheet --compare finds the previous version');
    const zoo = await m('zoo', 'containers');
    const z = await pngSize(new URL('zoo-containers.png', out));
    check(zoo.code === 0 && z.width > 300 && z.bytes > 5000, `zoo containers: ${z.width}×${z.height}`);
    const found = await m('find', 'container');
    check(found.code === 0 && /barrel/.test(found.out) && /crate/.test(found.out) && /tok/.test(found.out), 'find container lists the barrel and the crate with token estimates');
    // a model's variants share one entry; the rocks come before the cliffs of rock; 20 entries in
    // full and every other match by id after them, so a search is short and hides nothing
    const rocks = await m('find', 'rock');
    const rockEntries = [...rocks.out.matchAll(/^(\S+\/\S+|\S+) +\d/gm)].map((x) => x[1]);
    const rockAlso = rocks.out.match(/^also: (.*)$/m)?.[1] ?? '';
    check(
      rocks.code === 0 && /^ {2}\+ 5 variants: kenney-nature\/rock-large-b, -c, -d, -e, -f$/m.test(rocks.out) && rockEntries.length === 20 && rockEntries.indexOf('kenney-nature/rock-large-a') >= 0 &&
        rockEntries.findIndex((id) => /cliff/.test(id)) > rockEntries.indexOf('kenney-nature/rock-large-a') && !/rock-large-b/.test(rockEntries.join()) && rockAlso.includes('cliff') && /\(--limit \d+ for all\)$/m.test(rocks.out),
      `find rock: 20 entries in full, rock-large-a's 5 variants on one line, the rocks before the cliffs, the rest named (${rockEntries.slice(0, 6).join(', ')}…; also ${rockAlso.split(', ').length})${rocks.code ? `\n    ${tail(rocks.out)}` : ''}`,
    );
    const rockJson = await m('find', 'rock', '--json');
    const rockRows = rockJson.code === 0 ? JSON.parse(rockJson.out) : [];
    const rockIds = new Set(rockRows.flatMap((r) => [r.id, ...(r.variants ?? [])]));
    check(rockRows.find((r) => r.id === 'kenney-nature/rock-large-a')?.variants?.length === 5 && rockRows.length > 20 && rockIds.size === rockRows.reduce((n, r) => n + 1 + (r.variants?.length ?? 0), 0), `find rock --json: every entry (${rockRows.length}), each model once, its variants under it`);
    // import: our own generated tree (named flat materials) → a draft def and a fidelity sheet
    const own = ['--as', 'tree-import', '--licence', 'LicenseRef-own', '--source', 'scripts/generate-assets.mjs'];
    const imported = await m('import', 'public/assets/tree.glb', ...own, '--json');
    const ij = imported.code === 0 ? JSON.parse(imported.out) : { fidelity: { iou: 0 }, problems: ['crashed'] };
    const fid = await pngSize(new URL('fidelity/tree-import.png', out));
    check(imported.code === 0 && ij.fidelity.iou >= 0.98 && ij.problems.length === 0 && fid.width > 500 && Object.keys(ij.palette).join() === 'leavesLow,leavesHigh,trunk', `import tree.glb: game IoU ${ij.fidelity.iou}, slots ${Object.keys(ij.palette ?? {}).join(', ')}${imported.code ? `\n    ${tail(imported.out)}` : ''}`);
    const draft = await m('check', '.scratch/e2e/model/import/tree-import.ts');
    check(draft.code === 0 && /\b0 with problems/.test(draft.out), 'the imported draft checks clean as a file');
    const refused = await m('import', 'public/assets/tree.glb', ...own.slice(0, 2), '--licence', 'CC-BY-SA-4.0', '--source', 'x');
    check(refused.code === 2 && /refused: .*'CC-BY-SA-4.0' is not allowed/.test(refused.out), 'import refuses a licence the checks refuse');
    const unapproved = await m('import', 'public/assets/tree.glb', '--as', 'thirdparty/tree', '--licence', 'CC0-1.0', '--source', 'https://example.test/kit.zip', '--pack', 'thirdparty');
    const packWritten = await stat(new URL('public/packs/thirdparty.json', ROOT)).then(() => true, () => false);
    check(unapproved.code === 2 && /pack 'thirdparty', which is not approved/.test(unapproved.out) && !packWritten, 'import --pack refuses a third-party pack nobody approved, and writes no pack file');
    const lone = await m('import', 'public/assets/tree.glb', '--as', 'tree-cc0', '--licence', 'CC0-1.0', '--source', 'https://example.test/tree.glb');
    check(lone.code === 2 && /'CC0-1.0' is not allowed without an approved pack \(it names no pack/.test(lone.out), 'import refuses a single third-party file, CC0 included, that names no approved pack');
    const outside = await m('import', 'public/assets/tree.glb', '--as', 'tree-own', '--licence', 'LicenseRef-own', '--source', 'https://example.test/tree.glb');
    check(outside.code === 2 && /own work with an outside source/.test(outside.out), 'import refuses own work whose source is outside this repository');
    const unsafe = await m('import', 'public/assets/tree.glb', '--as', '../tree', ...own.slice(2));
    check(unsafe.code === 2 && /--as takes an id like chair/.test(unsafe.out), 'import refuses an id that would climb out of its folder');
    // an id no pack has (importing an approved one would download it)
    const pack = await m('import-pack', 'not-an-approved-pack');
    check(pack.code === 2 && /no approved pack "not-an-approved-pack"/.test(pack.out) && /#49/.test(pack.out), `import-pack refuses an unapproved pack, naming #49: ${pack.out.trim().split('\n')[0]}`);
    const credits = await m('credits');
    check(credits.code === 0 && /# Credits/.test(credits.out), 'credits writes the attribution list');
    // traces: the reference (V-HACD through Rapier under tsx), a passing trace, a failing one
    const ref = await m('trace', 'tree', '--against', 'asset:tree', '--reference', '--json');
    const rj = ref.code === 0 ? JSON.parse(ref.out) : { components: [], hulls: null };
    const rp = await pngSize(new URL('trace/tree-reference.png', out));
    check(ref.code === 0 && rj.components.length === 3 && rj.components.some((c) => c.shape?.match === 'exact') && rj.hulls?.length > 0 && rp.width > 800, `trace --reference asset:tree: ${rj.components.length} pieces, ${rj.hulls?.length ?? 0} hull hints, ${rp.width}×${rp.height}${ref.code ? `\n    ${tail(ref.out)}` : ''}`);
    const traced = await m('trace', 'docs/plans/trace/tree.ts', '--against', 'asset:tree', '--json');
    const tj = traced.code === 0 ? JSON.parse(traced.out) : { pass: false, score: {} };
    const tp = await pngSize(new URL('trace/tree-trace.png', out));
    check(traced.code === 0 && tj.pass && tj.source.tool === 'trace' && tp.width > 1000, `trace docs/plans/trace/tree.ts passes: game IoU ${tj.score.iou}, close ${tj.score.iouClose}, dE ${tj.score.colour}${traced.code ? `\n    ${tail(traced.out)}` : ''}`);
    const wrong = await m('trace', 'crate', '--against', 'asset:tree');
    check(wrong.code === 1 && /FAIL: under the thresholds/.test(wrong.out), 'a crate traced for the tree fails the thresholds (exit 1)');
    // export-glb: the town needs the engine index under tsx; nothing is written outside .scratch/
    const glb = await run('npx', ['tsx', 'scripts/model.ts', 'export-glb', 'town:smithy', '--out', '.scratch/e2e/model/trace-src/smithy.glb', '--json']);
    const gj = glb.code === 0 ? JSON.parse(glb.out) : { triangles: 0 };
    check(glb.code === 0 && gj.triangles > 300 && gj.provenance.url === 'src/riftlight/town/Town.ts', `export-glb town:smithy: ${gj.triangles} tris${glb.code ? `\n    ${tail(glb.out)}` : ''}`);
    const kept = await run('npx', ['tsx', 'scripts/model.ts', 'export-glb', 'asset:coin', '--out', 'public/assets/coin-copy.glb']);
    const leaked = await stat(new URL('public/assets/coin-copy.glb', ROOT)).then(() => true, () => false);
    check(kept.code === 2 && /under \.scratch\/ only/.test(kept.out) && !leaked, 'export-glb refuses to write outside .scratch/');
    // nor through a link in trace-src/ that points out of it (dangling, so it resolves to nothing)
    await mkdir(new URL('.scratch/e2e/model/trace-src/', ROOT), { recursive: true });
    await rm(new URL('.scratch/e2e/model/trace-src/link.glb', ROOT), { force: true });
    await symlink('../../../../public/assets/coin-link.glb', new URL('.scratch/e2e/model/trace-src/link.glb', ROOT));
    const linked = await run('npx', ['tsx', 'scripts/model.ts', 'export-glb', 'asset:coin', '--out', '.scratch/e2e/model/trace-src/link.glb']);
    const through = await stat(new URL('public/assets/coin-link.glb', ROOT)).then(() => true, () => false);
    if (through) await rm(new URL('public/assets/coin-link.glb', ROOT));
    check(linked.code === 2 && /through a symlink/.test(linked.out) && !through, 'export-glb refuses to write through a symlink out of trace-src/');
  } catch (e) {
    check(false, `model crashed: ${e.message}`);
  }

  console.log('\n▶ tools: npm run tex');
  try {
    const out = new URL('tex/', OUT);
    await rm(out, { recursive: true, force: true });
    const t = (...args) => run('npx', ['tsx', 'scripts/tex.ts', ...args, '--out', '.scratch/e2e/tex']);
    const checked = await t('check');
    check(checked.code === 0 && /\b0 with problems/.test(checked.out), `tex check exits 0: ${checked.out.trim().split('\n').pop()}`);
    const sheet = await t('sheet', 'bricks', '--palette', 'stone=red', '--json');
    const sj = sheet.code === 0 ? JSON.parse(sheet.out) : { problems: ['crashed'] };
    const p = await pngSize(new URL('bricks.png', out));
    check(sheet.code === 0 && sj.problems.length === 0 && p.width > 400 && p.height > 300, `tex sheet bricks (re-bound): ${p.width}×${p.height}`);
    const zoo = await t('zoo', 'all');
    const z = await pngSize(new URL('zoo-all.png', out));
    check(zoo.code === 0 && z.width > 300 && z.bytes > 5000, `tex zoo all: ${z.width}×${z.height}`);
    const found = await t('find', 'stone');
    check(found.code === 0 && /bricks/.test(found.out) && /cobbles/.test(found.out), 'tex find stone lists the bricks and the cobbles');
    // a sheet's lettered tiles are pieces of a set (a 3×3 forest), not variants: each its own entry
    const forest = await t('find', 'forest', '--limit', '30');
    check(forest.code === 0 && /^kenney-tiny-town\/forest-a /m.test(forest.out) && /^kenney-tiny-town\/forest-b /m.test(forest.out) && !/variant/.test(forest.out), 'tex find forest lists the forest tiles one by one');
    const missing = await t('sheet', 'nope');
    check(missing.code === 2 && missing.out.trim().split('\n').length === 1 && /no texture "nope"/.test(missing.out), `tex sheet nope: one line, exit ${missing.code}`);
    // import: our own coin (the library's, baked to a PNG here) back in as a strip of 4 frames
    const tsx = (code) => run('npx', ['tsx', '-e', code]);
    const png = '.scratch/e2e/tex/coin-spin-source.png';
    const made = await tsx(`import { mkdirSync, writeFileSync } from 'node:fs'; import { encodePng } from './scripts/png.ts'; import { bakeTexture, TEXTURE_LIBRARY } from './src/engine/texture/index.ts'; const b = bakeTexture(TEXTURE_LIBRARY.get('coin-spin')); mkdirSync('.scratch/e2e/tex', { recursive: true }); writeFileSync('${png}', encodePng({ width: b.width, height: b.height, data: new Uint8ClampedArray(b.rgba) }));`);
    check(made.code === 0, `the coin's source PNG is written${made.code ? `\n    ${tail(made.out)}` : ''}`);
    const own = ['--licence', 'LicenseRef-own', '--source', 'src/engine/texture/library/sprites.ts'];
    const imported = await t('import', png, '--grid', '8x8', '--frames', '--as', 'coin-import', ...own, '--json');
    const ij = imported.code === 0 ? JSON.parse(imported.out) : { defs: [], merges: ['crashed'], problems: ['crashed'] };
    const isz = await pngSize(new URL('import/coin-import.png', out));
    check(imported.code === 0 && ij.defs.join() === 'coin-import' && ij.merges.length === 0 && ij.problems.length === 0 && isz.width > 300, `tex import coin-spin --frames: ${ij.defs.join()}, ${ij.merges.length} merges, sheet ${isz.width}×${isz.height}${imported.code ? `\n    ${tail(imported.out)}` : ''}`);
    const draft = await t('check', '.scratch/e2e/tex/import/coin-import.ts');
    check(draft.code === 0 && /\b0 with problems/.test(draft.out), 'the imported draft checks clean as a file');
    const same = await tsx(`import { bakeTexture, TEXTURE_LIBRARY } from './src/engine/texture/index.ts'; import { coinImport } from './.scratch/e2e/tex/import/coin-import.ts'; const a = bakeTexture(TEXTURE_LIBRARY.get('coin-spin')).rgba; const b = bakeTexture(coinImport).rgba; console.log(coinImport.frames, a.length === b.length && a.every((v, i) => v === b[i]) ? 'same' : 'differs');`);
    check(same.code === 0 && /^4 same/m.test(same.out), `the draft bakes to the library coin's texels, 4 frames: ${same.out.trim().split('\n').pop()}`);
    const refused = await t('import', png, '--grid', '8x8', '--licence', 'CC-BY-SA-4.0', '--source', 'x');
    check(refused.code === 2 && /refused: .*'CC-BY-SA-4.0' is not allowed/.test(refused.out), 'tex import refuses a licence the checks refuse');
    const unapproved = await t('import', png, '--grid', '8x8', '--as', 'thirdparty/coin', '--licence', 'CC0-1.0', '--source', 'https://example.test/kit.zip', '--pack', 'thirdparty');
    check(unapproved.code === 2 && /pack 'thirdparty', which is not approved/.test(unapproved.out), 'tex import --pack refuses a third-party pack nobody approved');
    const lone = await t('import', png, '--grid', '8x8', '--as', 'coin-cc0', '--licence', 'CC0-1.0', '--source', 'https://example.test/coin.png');
    check(lone.code === 2 && /'CC0-1.0' is not allowed without an approved pack \(it names no pack/.test(lone.out), 'tex import refuses a single third-party sheet, CC0 included, that names no approved pack');
    const outside = await t('import', png, '--grid', '8x8', '--as', 'coin-own', '--licence', 'LicenseRef-own', '--source', 'https://example.test/coin.png');
    check(outside.code === 2 && /own work with an outside source/.test(outside.out), 'tex import refuses own work whose source is outside this repository');
    const unsafe = await t('import', png, '--grid', '8x8', '--as', '../coin', ...own);
    check(unsafe.code === 2 && /--as takes an id like tiles/.test(unsafe.out), 'tex import refuses an id that would climb out of its folder');
    const ragged = await t('import', png, '--grid', '7x8', ...own);
    check(ragged.code === 2 && /not whole 7 x 8 cells/.test(ragged.out), `tex import refuses a grid the sheet is not whole cells of: ${ragged.out.trim().split('\n')[0]}`);
  } catch (e) {
    check(false, `tex crashed: ${e.message}`);
  }
}

async function runPhone(browserExe) {
  await runEnginePhone(browserExe);
  const helpers = { exe: browserExe, launch, ready, check, checkClean, state, BASE, OUT };
  await runRiftlightPhone({ ...helpers, scenario: SCENARIOS[0] }, 'portrait');
  await runRiftlightPhone({ ...helpers, scenario: SCENARIOS[0] }, 'landscape');
}

async function runEnginePhone(browserExe) {
  console.log('\n▶ phone (portrait adaptive aspect, GPU device loss)');
  // Portrait phone: the art keeps 270 rows and narrows to the screen instead of a 16:9 strip.
  {
    const browser = await chromium.launch({ executablePath: browserExe, args: SCENARIOS[0].args, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
      const logs = [];
      page.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && !ENVIRONMENT_NOISE.some((re) => re.test(m.text())))) && logs.push(`${m.type()}: ${m.text()}`));
      page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
      await page.goto(urlFor({ url: BASE }, 'touch=1&debug=0'));
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
  for (const s of [SCENARIOS[0]]) {
    let ctx;
    try {
      ctx = await openPage(browserExe, s, 'debug=0');
      const { page, logs } = ctx;
      await page.evaluate(() => {
        const r = window.__PIXEL_ENGINE__.renderer.renderer;
        window.__lostRenderer = r;
        r.backend.device.destroy();
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

/** Desktop fullscreen must fill the viewport, including HUDs and the passive tree. */
async function runFullscreen(browserExe) {
  console.log('\n▶ fullscreen (Riftlight, desktop and HiDPI)');
  for (const s of [SCENARIOS[0]]) {
    for (const dpr of [1, 2]) {
      let ctx;
      try {
        ctx = await openPage(browserExe, s, 'game=riftlight&debug=0&save=memory', { deviceScaleFactor: dpr });
        const { page, logs } = ctx;
        await page.waitForFunction(() => window.__RIFTLIGHT__);
        const layout = () => page.evaluate(() => {
          const e = window.__PIXEL_ENGINE__;
          const rect = (selector) => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
          };
          return {
            viewport: [innerWidth, innerHeight], aspect: e.renderer.aspect, f: e.renderer.framing,
            canvas: rect('canvas[data-engine-canvas]'), hud: rect('canvas[data-hud]'),
          };
        });
        const covers = (r, [w, h]) => r.x <= 0 && r.y <= 0 && r.right >= w && r.bottom >= h;
        const sizes = dpr === 1 ? [[1366, 768], [1920, 1080], [2560, 1440], [2560, 1600], [3440, 1440]] : [[1280, 720]];
        for (const [width, height] of sizes) {
          await page.setViewportSize({ width, height });
          await waitFrames(page, 3);
          const l = await layout();
          check(l.aspect === 'fill' && covers(l.canvas, l.viewport), `${s.backend} ${width}×${height} DPR ${dpr}: game covers every edge`);
          check(covers(l.hud, l.viewport) && JSON.stringify(l.hud) === JSON.stringify(l.canvas), 'HUD exactly follows the game canvas');
          check(l.f.integer && Number.isInteger(l.f.scale) && l.f.canvasWidth === l.f.artWidth * l.f.scale && l.f.canvasHeight === l.f.artHeight * l.f.scale, 'square integer-scaled pixels');
        }

        await page.evaluate(() => document.documentElement.requestFullscreen());
        await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
        await waitFrames(page, 3);
        let l = await layout();
        check(covers(l.canvas, l.viewport) && covers(l.hud, l.viewport), `${s.backend} DPR ${dpr}: entering fullscreen keeps every edge filled`);
        await page.evaluate(() => window.__PIXEL_ENGINE__.renderer.setResolution({ width: 320, height: 180 }));
        await waitFrames(page, 3);
        l = await layout();
        check(covers(l.canvas, l.viewport) && covers(l.hud, l.viewport), 'comparison resolution stays border-free');
        const shot = await capture(page, `fullscreen-${s.name}-dpr${dpr}.png`);
        check(colorCount(shot) > 16 && blockUniformity(shot, l.f.scale) > 0.995, 'fullscreen scene renders with crisp pixel blocks');

        await page.evaluate(async () => {
          await window.__RIFTLIGHT__.newRun({ slot: 0, seed: 42 });
          window.__RIFTLIGHT__.ui.open('tree');
        });
        await page.waitForSelector('canvas[data-rift-tree="canvas"]');
        const tree = await page.evaluate(() => {
          const c = document.querySelector('canvas[data-rift-tree="canvas"]');
          const r = c.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
        });
        l = await layout();
        check(covers(tree, l.viewport) && JSON.stringify(tree) === JSON.stringify(l.canvas), 'passive tree shares the same border-free pixel grid');
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForFunction(() => !document.fullscreenElement);
        await waitFrames(page, 3);
        l = await layout();
        check(covers(l.canvas, l.viewport), 'exiting fullscreen relayouts without a border');
        checkClean(await state(page), logs);
      } catch (e) {
        check(false, `fullscreen (${s.name}, DPR ${dpr}) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
      } finally {
        await ctx?.browser.close();
      }
    }
  }
}

const SUITES = {
  webgpu: (exe) => runCore(exe, SCENARIOS[0]),
  'no-webgpu': (exe) => runNoWebGPU(exe, SCENARIOS[1]),
  cameras: (exe) => runCameras(exe),
  'camera-swap': (exe) => runCameraSwap(exe, SCENARIOS[0]),
  'filters-webgpu': (exe) => runFilters(exe, SCENARIOS[0], 'filters-webgpu'),
  touch: (exe) => runTouch(exe),
  phone: (exe) => runPhone(exe),
  fullscreen: (exe) => runFullscreen(exe),
  moves: (exe) => runMoves(exe),
  lab: (exe) => runLab(exe),
  'asset-lab': (exe) => runAssetLab(exe),
  'riftlight-tree': (exe) => runRiftlightTree({ exe, launch, check, BASE, OUT }),
  riftlight: async (exe) => {
    const helpers = { exe, openPage, check, capture, state, checkClean, colorCount, encodePng, OUT };
    await runRiftlight({ ...helpers, scenario: SCENARIOS[0] });
    await runRiftlightItems({ ...helpers, scenario: SCENARIOS[0] });
  },
  tools: (exe) => runTools(exe),
  bundle: (exe) => runBundle({ exe, root: ROOT, out: OUT, base: BASE, scenarios: SCENARIOS, launch, ready, check, run, tail }),
  systems: async (exe) => {
    const helpers = { exe, openPage, ready, until, check, capture, state, waitFrames, colorCount, meanDiff, checkClean, encodePng, OUT };
    await runSystems({ ...helpers, scenario: SCENARIOS[0] });
  },
  settings: (exe) => runSettings({ exe, scenario: SCENARIOS[0], openPage, ready, until, check, state, waitFrames, checkClean, OUT }),
  'riftlight-loot': async (exe) => {
    const helpers = { exe, openPage, check, capture, checkClean, encodePng, OUT };
    await runRiftlightLoot({ ...helpers, scenario: SCENARIOS[0] });
  },
  'riftlight-levels': async (exe) => {
    const helpers = { exe, openPage, check, capture, state, colorCount, checkClean };
    await runRiftlightLevels({ ...helpers, scenario: SCENARIOS[0] });
  },
  'riftlight-combat': async (exe) => {
    const helpers = { exe, openPage, check, capture, state, colorCount, checkClean };
    await runRiftlightCombat({ ...helpers, scenario: SCENARIOS[0] });
  },
  'riftlight-replay': async (exe) => {
    await runRiftlightReplay({ exe, openPage, check, capture, checkClean, scenario: SCENARIOS[0] });
  },
  'riftlight-snapshot': async (exe) => {
    await runRiftlightSnapshot({ exe, openPage, check, capture, checkClean, scenario: SCENARIOS[0] });
  },
  'riftlight-builds': async (exe) => {
    const helpers = { exe, openPage, check, capture, state, colorCount, checkClean, OUT };
    await runRiftlightBuilds({ ...helpers, scenario: SCENARIOS[0] });
  },
  'riftlight-monsters': async (exe) => {
    const helpers = { exe, openPage, until, check, capture, state, colorCount, checkClean, OUT };
    await runRiftlightMonsters({ ...helpers, scenario: SCENARIOS[0] });
  },
  'riftlight-showcase': async (exe) => {
    const helpers = { exe, openPage, check, capture, state, colorCount, checkClean };
    await runRiftlightShowcase({ ...helpers, scenario: SCENARIOS[0] });
  },
  world: async (exe) => {
    const helpers = { exe, openPage, check, capture, checkClean, colorCount };
    await runWorld({ ...helpers, scenario: SCENARIOS[0] });
  },
};

// CI runs one job per group, in parallel (.github/workflows/ci.yml: `test:e2e -- @core`).
// Every suite must be in exactly one group, or CI would silently skip it.
const GROUPS = {
  '@core': ['webgpu', 'no-webgpu', 'touch', 'phone', 'fullscreen', 'moves', 'settings', 'riftlight', 'riftlight-combat'],
  '@cameras': ['cameras', 'camera-swap', 'lab', 'riftlight-tree', 'riftlight-levels', 'riftlight-builds', 'riftlight-showcase'],
  '@filters': ['filters-webgpu', 'tools', 'bundle', 'systems', 'riftlight-loot', 'riftlight-monsters'],
  '@world': ['world', 'riftlight-replay', 'riftlight-snapshot'],
  // every library model drawn: it grows with the library, so it runs alone
  '@assets': ['asset-lab'],
};
const grouped = Object.values(GROUPS).flat();
const misgrouped = Object.keys(SUITES).filter((n) => grouped.filter((g) => g === n).length !== 1);
if (misgrouped.length || grouped.length !== Object.keys(SUITES).length) {
  console.error(`every e2e suite must be in exactly one group (GROUPS in scripts/e2e.mjs): ${misgrouped.join(', ') || grouped.join(', ')}`);
  process.exit(2);
}
if (process.argv.slice(2).some((a) => ['help', '--help', '-h'].includes(a))) {
  console.log(`npm run build && npm run test:e2e [-- <suite|@group> ...]   (E2E_PORT, E2E_VERBOSE=1: see scripts/e2e.mjs)\nsuites: ${Object.keys(SUITES).join(', ')}`);
  for (const [g, names] of Object.entries(GROUPS)) console.log(`${g}: ${names.join(', ')}`);
  process.exit(0);
}
const wanted = process.argv.slice(2).flatMap((a) => GROUPS[a] ?? [a]);
const unknown = wanted.filter((n) => !SUITES[n]);
if (unknown.length) {
  console.error(`unknown e2e suite(s): ${unknown.join(', ')}\navailable: ${Object.keys(SUITES).join(', ')}, or a group: ${Object.keys(GROUPS).join(', ')}`);
  process.exit(2);
}

await mkdir(OUT, { recursive: true });
const exe = headlessShell();
const server = await startServer();
const started = Date.now();
try {
  for (const [name, runSuite] of Object.entries(SUITES)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const t0 = Date.now();
    const [failedBefore, checksBefore] = [failures, checks];
    // quiet: hold what the suite logs; print it only if the suite fails (its ✘ lines in context)
    const held = [];
    const log = console.log;
    if (!VERBOSE) console.log = (...a) => held.push(format(...a));
    // killed mid-suite (a CI timeout sends SIGINT, Ctrl-C): print what it held and which suite it was
    const killed = (sig) => {
      console.log = log;
      for (const line of held) console.log(line);
      console.log(`✘ ${name}: killed (${sig}) after ${checks - checksBefore} checks`);
      stopServer(server);
      process.exit(130);
    };
    process.once('SIGINT', killed).once('SIGTERM', killed);
    let threw = true;
    try {
      await runSuite(exe);
      threw = false;
    } finally {
      process.off('SIGINT', killed).off('SIGTERM', killed);
      console.log = log;
      const failed = failures - failedBefore;
      if (failed || threw) for (const line of held) console.log(line);
      const t = ((Date.now() - t0) / 1000).toFixed(1);
      const n = checks - checksBefore;
      const what = [failed ? `${failed} of ${n} checks failed` : '', threw ? `threw after ${n} checks` : ''].filter(Boolean).join(', ');
      console.log(what ? `✘ ${name}: ${what}, ${t} s` : `✔ ${name}: ${n} checks, ${t} s`);
    }
  }
} finally {
  stopServer(server);
}
console.log(`⏱ total ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(failures ? `✘ ${failures} check(s) failed` : '✔ all e2e checks passed');
process.exit(failures ? 1 : 0);
