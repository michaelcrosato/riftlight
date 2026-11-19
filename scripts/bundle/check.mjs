#!/usr/bin/env node
// check.mjs: play a Pixel Engine game in a real browser and report what happened.
// Ships in the engine kit; run it before you hand a game back.
//
//   node check.mjs                       index.html in the current folder
//   node check.mjs examples/looks.html   any page (served from the folder that holds pixel-engine.js)
//   node check.mjs "index.html?look=noir&camera=side"   with URL flags
//   node check.mjs "index.html?touch=1" --size 390x844  as on a phone: a touch screen (touch is the
//                                        device in use, so its prompts show), and <page>-page.png,
//                                        the page as the player sees it (the touch controls and the
//                                        ⚙ are page elements over the frame); report.json's `touch`
//                                        has where each control is (engine.touch.rects())
//   node check.mjs http://localhost:5173/
//   node check.mjs --sheets models.js    sheets of your own models and textures (no page played)
//   node check.mjs --headless game.js    play the game in Node, no browser: steps, errors, a replay
//
// Options:
//   --keys KeyD*60,Space*4,KeyW*30   hold each step for that many frames, in order (*90 alone: 90 frames
//                                    holding nothing, the default). A step is a key's event.code (KeyD,
//                                    Space, ArrowUp, Escape, ...), or on a fake standard pad (plugged in
//                                    a frame before the first step, so the device in use turns pad and
//                                    the prompts follow): a button (PadA, PadB, PadX, PadY, PadLB, PadRB,
//                                    PadLT, PadRT, PadBack, PadStart, PadL3, PadR3, PadTouchpad), the
//                                    d-pad (PadUp, PadDown, PadLeft, PadRight) or a stick held over
//                                    (PadLStick:1,0 right, PadLStick:0,1 up, PadRStick:x,y; -1..1), or
//                                    the mouse at a spot in art pixels (the HUD's x, y): Mouse@120,80
//                                    moves there over 4 frames (hover), MouseLeft@120,80 (MouseRight,
//                                    MouseMiddle) moves there and holds the button; MouseLeft alone,
//                                    where it is. Anything else is refused (exit 2). report.json's
//                                    `device` is the device in use at the end
//   --cameras                        also shoot the iso, topdown, side and third camera presets
//   --looks pixel_heroes,noir        also shoot these looks (names from engine.lookPresets)
//   --out check                      folder for the PNGs and report.json (default: ./check)
//   --size 960x540                   viewport in CSS pixels
//   --sheets models.js,crate,cobbles draw sheets instead of playing a page (ASSETS.md): every
//                                    ModelDef and TextureDef a module exports (by name, in an
//                                    array or object, in a ModelCatalog / TextureCatalog, or added
//                                    to the library), and library ids. A PNG each and report.json
//                                    in --out (default ./check/sheets); exit 1 on any problem
//   --headless [game.js]             play a game module in Node with Engine.headless instead of a
//                                    page (no browser, no pictures): it imports the module, makes
//                                    the game its `createGame()` export returns, plays the --keys
//                                    frames, then replays that run's recording in a fresh game. It
//                                    writes report.json (state, errors, fingerprint) to --out; exit
//                                    1 on an error or a replay that ends somewhere else
//   --help                           this text
//
// It needs Node 20.15+ (or 22.2+) and, except for --headless, Playwright (`npm i -D playwright` then
// `npx playwright install chromium`; a global install, `npm i -g playwright`, works too), or
// `playwright-core` with CHROMIUM_PATH set to a Chromium (its headless shell,
// `chrome-linux/headless_shell`, is the lightest): it plays WebGPU on SwiftShader with no
// display. Exit code 0 means the game started, ran the frames with no errors (page, console,
// engine or GPU) and drew a picture (with --sheets: every sheet was drawn and no
// def has a problem; warnings are fine); 1 means it didn't; 2 means the tool couldn't run (bad
// arguments, no page, no browser, or a browser without WebGPU, which no game can start in).
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as zlib from 'node:zlib';

const usage = () => readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0].replace(/^#!.*\n/, '').replace(/^\/\/ ?/gm, '');
const fail = (message) => {
  console.error(`check.mjs: ${message}\n\n${usage()}`);
  process.exit(2);
};
if (typeof zlib.crc32 !== 'function') fail(`needs Node 20.15+ or 22.2+ (this is ${process.version})`);

// --name value flags, --name flags, then one positional page
const VALUE = new Set(['keys', 'looks', 'out', 'size', 'sheets']);
const FLAG = new Set(['cameras', 'help', 'headless']);
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
// --sheets "" is still --sheets (drawSheets says it needs something to draw), never a page run
const sheets = opts.sheets !== undefined;
if (sheets && positional.length) fail(`--sheets draws sheets instead of playing a page: play ${positional[0]} in a run of its own`);
const headless = opts.headless === true;
if (headless && (sheets || opts.cameras || opts.looks)) fail('--headless plays the game in Node, with no pictures: --sheets, --cameras and --looks need the browser');
const target = positional[0] ?? (headless ? 'game.js' : 'index.html');
const out = resolve(opts.out ?? (sheets ? 'check/sheets' : 'check'));
const [vw, vh] = String(opts.size ?? '960x540').split('x').map(Number);
if (!(vw > 0 && vh > 0)) fail('--size is WIDTHxHEIGHT, e.g. 960x540');
const looks = opts.looks ? String(opts.looks).split(',').filter(Boolean) : [];
const cameras = opts.cameras === true;

/** The keys a step may hold (KeyboardEvent.code), and the codes the engine presses itself (the mouse's, a finger's, swipes, a DualSense touchpad's gestures). */
const KEY_CODES = new Set([
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ...['Up', 'Down', 'Left', 'Right'].map((d) => `Arrow${d}`),
  ...['Add', 'Subtract', 'Multiply', 'Divide', 'Decimal', 'Enter', 'Equal', 'Comma'].map((k) => `Numpad${k}`),
  ...['Shift', 'Control', 'Alt', 'Meta'].flatMap((k) => [`${k}Left`, `${k}Right`]),
  ...'Space Enter Escape Tab Backspace Delete Insert Home End PageUp PageDown CapsLock NumLock ScrollLock PrintScreen Pause ContextMenu Backquote Minus Equal BracketLeft BracketRight Backslash IntlBackslash IntlRo IntlYen Semicolon Quote Comma Period Slash'.split(' '),
  ...['MouseLeft', 'MouseRight', 'MouseMiddle', 'Touch', 'SwipeLeft', 'SwipeRight', 'SwipeUp', 'SwipeDown'],
  ...['Left', 'Right', 'Up', 'Down', 'Tap'].map((g) => `PadTouchpad${g}`),
]);
/** The standard pad's buttons (the engine's GAMEPAD_BUTTONS codes), and its d-pad's by index. */
const PAD_BUTTONS = new Set(['PadA', 'PadB', 'PadX', 'PadY', 'PadLB', 'PadRB', 'PadLT', 'PadRT', 'PadBack', 'PadStart', 'PadL3', 'PadR3', 'PadTouchpad']);
const DPAD = { PadUp: 12, PadDown: 13, PadLeft: 14, PadRight: 15 };
const STICKS = new Set(['PadLStick', 'PadRStick']);
const POINTER = new Set(['Mouse', 'MouseLeft', 'MouseRight', 'MouseMiddle']);
/** Frames the mouse takes to travel to a step's spot (hover follows a pointer that moves). */
const TRAVEL = 4;

/**
 * --keys as steps: `{ kind, code, frames }`, with `stick` ([x, y], y up) or `at` ([x, y] in art
 * pixels). Commas part the steps and a stick's or a spot's two numbers. Exits 2 on anything else.
 */
function parseKeys(text) {
  const kinds = "a key's event.code (KeyD, Space, ArrowUp), a pad button (PadA ... PadTouchpad), the d-pad (PadUp, PadDown, PadLeft, PadRight), a stick (PadLStick:x,y, PadRStick:x,y) or the mouse (Mouse@x,y, MouseLeft@x,y)";
  const num = String.raw`(-?(?:\d+\.?\d*|\.\d+))`;
  const step = new RegExp(String.raw`\s*([A-Za-z][A-Za-z0-9]*)?(?::${num},${num}|@${num},${num})?(?:\*(\d+))?\s*(?:,|$)`, 'y');
  const steps = [];
  for (let at = 0; at < text.length; ) {
    step.lastIndex = at;
    const m = step.exec(text);
    if (!m || step.lastIndex === at) fail(`--keys: can't read "${text.slice(at)}": steps are CODE*FRAMES, parted by commas (${kinds})`);
    at = step.lastIndex;
    const [whole, code = null, sx, sy, px, py, n] = m;
    const said = whole.replace(/\s*,?\s*$/, '').trim();
    if (!said) continue; // an empty step (",,")
    const frames = Math.max(1, Number(n) || 1);
    if (sx !== undefined) {
      if (!STICKS.has(code)) fail(`--keys: "${said}": only a stick takes x,y after a colon (PadLStick:1,0)`);
      const stick = [Number(sx), Number(sy)];
      if (stick.some((v) => !(Math.abs(v) <= 1))) fail(`--keys: "${said}": a stick's x and y are each -1..1 (x right, y up)`);
      steps.push({ kind: 'stick', code, stick, frames });
    } else if (px !== undefined) {
      if (!POINTER.has(code)) fail(`--keys: "${said}": only the mouse takes a spot after @ (Mouse@120,80, MouseLeft@120,80)`);
      steps.push({ kind: 'pointer', code, at: [Number(px), Number(py)], frames });
    } else if (code === null) steps.push({ kind: 'idle', code, frames });
    else if (STICKS.has(code)) fail(`--keys: "${said}": say where the stick is held, ${code}:x,y (x right, y up, each -1..1: ${code}:1,0 is right)`);
    else if (code === 'Mouse') fail(`--keys: "${said}": say where the mouse goes, Mouse@x,y in art pixels`);
    else if (PAD_BUTTONS.has(code) || code in DPAD) steps.push({ kind: 'pad', code, frames });
    else if (POINTER.has(code)) steps.push({ kind: 'pointer', code, at: null, frames });
    else if (KEY_CODES.has(code)) steps.push({ kind: 'key', code, frames });
    else fail(`--keys: "${code}" is not a code check.mjs can hold: ${kinds}`);
  }
  return steps.length ? steps : [{ kind: 'idle', code: null, frames: 90 }];
}
const keys = parseKeys(String(opts.keys ?? '*90'));

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

/** The empty page --sheets draws on (served at /__sheets__.html; it imports the engine itself). */
const SHEETS_PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>sheets</title></head><body></body></html>';

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
      if (path === '/__sheets__.html' && sheets) {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(SHEETS_PAGE);
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
  // beside the game first (npm i -D), then a global install (npm i -g; Claude Code cloud sessions
  // come with one), which an import from here never finds
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return (await import(name)).chromium;
    } catch {
      /* try the next */
    }
  }
  let globalRoot = '';
  try {
    globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch {
    /* no npm, or it failed or hung */
  }
  const require = createRequire(import.meta.url);
  for (const name of globalRoot ? ['playwright', 'playwright-core'] : []) {
    try {
      return require(join(globalRoot, name)).chromium;
    } catch {
      /* try the next */
    }
  }
  console.error('check.mjs needs Playwright: npm i -D playwright && npx playwright install chromium (or a global install, npm i -g playwright)');
  process.exit(2);
}

// WebGPU (the engine renders with nothing else) on SwiftShader's Vulkan, and ANGLE on SwiftShader,
// which the headless shell needs to present
const ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'];
// Chromium's own notices about software GL are not the game's problem.
const NOISE = [/GL Driver Message/];

/** The folder that holds pixel-engine.js: `from` or the nearest one above it (null: none). */
function engineDir(from) {
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, 'pixel-engine.js'))) return d;
    if (dirname(d) === d) return null;
  }
}

/**
 * Hold or let go of a --keys step (`parseKeys`) on the engine `e`; null plugs the fake pad in, at
 * rest. A pad button (the one `input.gamepadButtons` maps to its code), the d-pad and a stick are
 * held on a fake standard pad, which stays connected (at rest between its steps), so
 * `input.device` turns pad as a player's would; a key code is held as a key. The mouse's steps
 * point here only headless (normalised device coordinates from art pixels); a page's are the
 * browser's own mouse. In the page too (passed to it as source: it runs there). Throws
 * `check.mjs: ...` for a step the game can't take (a pad code it maps to no button, a spot off
 * its art).
 */
function holdKey(e, step, down) {
  const pad = { connected: true, mapping: 'standard', index: 0, id: 'check.mjs pad', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
  if (step === null) return e.input.setGamepads([pad]);
  if (step.kind === 'key') return e.input.setKey(step.code, down);
  if (step.kind === 'pad') {
    const dpad = { PadUp: 12, PadDown: 13, PadLeft: 14, PadRight: 15 }[step.code];
    const button = dpad ?? Number(Object.keys(e.input.gamepadButtons).find((i) => e.input.gamepadButtons[i] === step.code));
    if (!Number.isInteger(button)) throw new Error(`check.mjs: no button of the pad presses ${step.code} in this game (input.gamepadButtons)`);
    if (down) pad.buttons[button] = { pressed: true, value: 1 };
    return e.input.setGamepads([pad]);
  }
  if (step.kind === 'stick') {
    const i = step.code === 'PadLStick' ? 0 : 2;
    if (down) [pad.axes[i], pad.axes[i + 1]] = [step.stick[0], -step.stick[1]]; // the browser's y points down
    return e.input.setGamepads([pad]);
  }
  if (step.kind === 'pointer') {
    const { width, height } = e.renderer.resolution;
    if (step.at && down) {
      const [x, y] = step.at;
      if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`check.mjs: ${step.code}@${x},${y} is off the art (${width}×${height} pixels)`);
      e.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2);
      e.input.noteDevice('keyboard'); // the mouse moved: keyboard and mouse are in use
    }
    const bit = { MouseLeft: 1, MouseRight: 2, MouseMiddle: 4 }[step.code] ?? 0;
    if (bit) e.input.setButtons(down ? bit : 0);
  }
}

/** Where art pixel `at` ([x, y]) is on the page, in CSS pixels (in the page: on the canvas the engine's pointer reads). */
function artToPage(at) {
  const e = window.__PIXEL_ENGINE__;
  const { width, height } = e.renderer.resolution;
  const [x, y] = at;
  if (x < 0 || y < 0 || x >= width || y >= height) return { off: `${x},${y} is off the art (${width}×${height} pixels)` };
  const r = (e.renderer.renderer?.domElement ?? document.querySelector('canvas')).getBoundingClientRect();
  return { x: r.left + ((x + 0.5) / width) * r.width, y: r.top + ((y + 0.5) / height) * r.height };
}

/**
 * --headless: the game in Node (Engine.headless), no browser. The engine is the pixel-engine.js the
 * module imports (the nearest one above it), so the game and the check share one engine; files the
 * game loads are read from the module's folder.
 */
async function runHeadless(file) {
  const path = resolve(file);
  if (!/\.m?js$/.test(path)) fail(`--headless plays a game module (game.js), not ${file}: pages need the browser (no --headless)`);
  if (!existsSync(path)) fail(`no module ${file}`);
  const dir = engineDir(dirname(path));
  if (!dir) fail(`no pixel-engine.js in ${dirname(path)} or a folder above it`);
  const report = { ok: false, mode: 'headless', module: relative(process.cwd(), path) || file, keys: opts.keys ?? '*90', frames: 0, fingerprint: null, replayed: null, status: null, device: null, state: null, errors: [] };
  const finish = () => {
    report.ok = report.errors.length === 0 && report.fingerprint !== null && report.replayed === report.fingerprint;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`check.mjs --headless ${report.module}: ${report.frames} frames in Node${report.status ? `, ${report.status}` : ''}${report.device ? `, the device in use ${report.device}` : ''}`);
    if (report.fingerprint === null) console.log('  not replayed: the run did not finish');
    else console.log(`  fingerprint ${report.fingerprint}; replayed ${report.replayed === report.fingerprint ? 'to the same' : `to ${report.replayed ?? '-'} (not the same)`}`);
    for (const e of report.errors) console.log(`  error: ${e.split('\n')[0]}`);
    console.log(`${report.ok ? 'ok' : 'FAILED'}: ${join(out, 'report.json')}`);
    process.exit(report.ok ? 0 : 1);
  };
  // a load, a setup or a replay that never settles fails, as a page that never starts does
  const within = (promise, what, ms = 120000) => {
    let timer;
    return Promise.race([promise, new Promise((_, no) => (timer = setTimeout(() => no(new Error(`${what} did not finish within ${ms / 1000} s`)), ms)))]).finally(() => clearTimeout(timer));
  };
  const { Engine } = await import(pathToFileURL(join(dir, 'pixel-engine.js')).href);
  let mod;
  try {
    mod = await within(import(pathToFileURL(path).href), `loading ${file}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const page = /\b(document|window|location|localStorage|navigator)\b is not defined/.test(msg) ? ' (code that touches the page runs only where there is one: guard it, export createGame(), GUIDE.md section 8)' : '';
    report.errors.push(`${file} failed to load: ${msg}${page}`);
    finish();
  }
  const make = typeof mod.createGame === 'function' ? mod.createGame : null;
  if (!make) fail(`${file} exports no createGame(): --headless makes the game with it, a fresh one for the replay (GUIDE.md section 8)`);
  const read = async (p) => {
    const bytes = readFileSync(resolve(dirname(path), p));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  let engine = null;
  try {
    engine = await within(Engine.headless(make(), { assets: read, viewport: { width: vw, height: vh, dpr: 1 } }), 'the game\'s start');
    if (keys.some((k) => k.kind === 'pad' || k.kind === 'stick')) {
      holdKey(engine, null, true); // the pad plugged in a frame before it is used
      engine.step(1);
    }
    for (const k of keys) {
      if (k.kind === 'pointer' && k.at) {
        // the mouse travels there over TRAVEL frames, from where it was (else the top left corner)
        const { width, height } = engine.renderer.resolution;
        const p = engine.input.pointer;
        const from = p.over ? [((p.x + 1) / 2) * width - 0.5, ((1 - p.y) / 2) * height - 0.5] : [0, 0];
        for (let i = 1; i < TRAVEL; i++) {
          holdKey(engine, { kind: 'pointer', code: 'Mouse', at: from.map((v, j) => Math.max(0, v + ((k.at[j] - v) * i) / TRAVEL)) }, true);
          engine.step(1);
        }
      }
      holdKey(engine, k, true);
      engine.step(k.frames);
      holdKey(engine, k, false);
      if (k.kind === 'pointer' && k.code !== 'Mouse') engine.step(1); // the button let go: a click ends on the next frame
    }
    report.fingerprint = engine.fingerprint();
    report.frames = engine.state().frame;
    report.state = engine.state();
    report.status = report.state.status || null;
    report.device = engine.input.device;
    const rec = JSON.parse(JSON.stringify(engine.recording()));
    await within(engine.replay(rec, () => engine.loadGame(make())), 'the replay');
    report.replayed = engine.fingerprint();
  } catch (e) {
    report.errors.push(e instanceof Error ? (e.stack ?? e.message) : String(e));
    if (engine && !report.state) {
      report.state = engine.state();
      report.frames = report.state.frame;
      report.status = report.state.status || null;
    }
  }
  if (engine) report.errors.push(...engine.errors.map(String).filter((e) => !report.errors.some((r) => r.includes(e))));
  engine?.dispose();
  finish();
}

if (headless) await runHeadless(target);

const chromium = await loadPlaywright();

async function launch(server) {
  try {
    // headless (Playwright's headless launch is Chromium's headless shell): no display needed
    return await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ARGS, headless: true });
  } catch (e) {
    server?.close();
    console.error(`check.mjs: could not start Chromium: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    console.error('Install it (npx playwright install chromium) or set CHROMIUM_PATH.');
    process.exit(2);
  }
}

/**
 * --sheets: draw the sheets of a game's own defs and of library ids in the page (the engine's
 * `modelSheet` / `textureSheet`, software-drawn), write a PNG each and report.json, exit.
 */
async function drawSheets(list) {
  const items = list.split(',').map((s) => s.trim()).filter(Boolean);
  const isModule = (s) => /\.m?js$/.test(s);
  const files = items.filter(isModule).map((s) => resolve(s));
  const ids = items.filter((s) => !isModule(s));
  if (!items.length) fail('--sheets needs modules (models.js) or library ids (crate), comma-separated');
  for (const f of files) if (!existsSync(f) || statSync(f).isDirectory()) fail(`no such module: ${f}`);
  // the kit the first module is in, else the one around the working folder, else this tool's own
  const dir = engineDir(files.length ? dirname(files[0]) : process.cwd()) ?? engineDir(dirname(fileURLToPath(import.meta.url)));
  if (!dir) fail(`no pixel-engine.js in ${files.length ? dirname(files[0]) : process.cwd()}, beside check.mjs or a folder above them`);
  const inside = (f) => !relative(dir, f).startsWith('..') && !isAbsolute(relative(dir, f));
  for (const f of files) if (!inside(f)) fail(`${f} is outside ${dir}, the folder that holds pixel-engine.js`);
  const server = await serve(dir);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const modules = files.map((f) => ({ name: relative(process.cwd(), f) || f, url: base + relative(dir, f).split(sep).join('/') }));
  const browser = await launch(server);
  const report = { sheets: [], ok: false, errors: [], version: null };
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.some((re) => re.test(m.text()))) report.errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => report.errors.push(`page: ${e.message}`));
    await page.goto(`${base}__sheets__.html`);
    // Collect the defs: a module's own, and those in its catalogs that the library lacks. They
    // join the library in catalogs of their own, so `use` and `tex` find library and own alike.
    const found = await page.evaluate(
      async ({ engine, modules, ids, loadTimeout }) => {
        const E = await import(engine);
        const errors = [];
        const own = { model: new Map(), texture: new Map() };
        const kindOf = (v) => (!v || typeof v !== 'object' || typeof v.id !== 'string' ? null : 'parts' in v && 'palette' in v ? 'model' : 'layers' in v && 'size' in v ? 'texture' : null);
        const libraries = () => [...E.MODEL_LIBRARY.all(), ...E.TEXTURE_LIBRARY.all()];
        const builtIn = new Set(libraries());
        for (const m of modules) {
          const before = new Set(libraries());
          let mod;
          try {
            // a top level that never settles (an await on something that never comes) would hang here
            let timer;
            const late = new Promise((_, no) => (timer = setTimeout(() => no(new Error(`did not finish loading in ${loadTimeout / 1000} s (a top-level await that never settles?)`)), loadTimeout)));
            mod = await Promise.race([import(m.url), late]).finally(() => clearTimeout(timer));
          } catch (e) {
            errors.push(`${m.name}: ${e instanceof Error ? `${e.name}: ${e.message}` : e}`);
            continue;
          }
          // its exports, the defs in its catalogs, and any it added to the libraries
          const added = libraries().filter((d) => !before.has(d));
          // defs exported by name, in an array or a plain object (one level), or in a catalog
          const values = [...new Set([mod.default, ...Object.values(mod)])];
          const plain = (v) => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && !kindOf(v);
          const each = (v) => (v instanceof E.ModelCatalog || v instanceof E.TextureCatalog ? v.all().filter((d) => !builtIn.has(d)) : Array.isArray(v) ? v : plain(v) ? Object.values(v) : [v]);
          const defs = [...new Set([...values.flatMap(each), ...added])];
          let n = 0;
          for (const d of defs) {
            const kind = kindOf(d);
            if (!kind) continue;
            n++;
            if (own[kind].has(d.id) && own[kind].get(d.id) !== d) errors.push(`two ${kind}s are called "${d.id}"`);
            own[kind].set(d.id, d);
          }
          if (!n) errors.push(`${m.name} exports no ModelDef or TextureDef (nor a catalog holding one)`);
        }
        const textures = new E.TextureCatalog([...E.TEXTURE_LIBRARY.all().filter((d) => !own.texture.has(d.id)), ...own.texture.values()]);
        const models = new E.ModelCatalog([...E.MODEL_LIBRARY.all().filter((d) => !own.model.has(d.id)), ...own.model.values()]);
        const targets = [...[...own.model.keys()].map((id) => ({ kind: 'model', id })), ...[...own.texture.keys()].map((id) => ({ kind: 'texture', id }))];
        for (const id of ids) {
          if (models.has(id)) targets.push({ kind: 'model', id });
          else if (textures.has(id)) targets.push({ kind: 'texture', id });
          else errors.push(`no model or texture "${id}"${modules.length ? ' in the library or the modules' : ' in the library'}`);
        }
        window.__SHEETS__ = { E, models, textures };
        return { targets, errors, version: E.ENGINE_VERSION };
      },
      { engine: `${base}pixel-engine.js`, modules, ids, loadTimeout: 30000 },
    );
    report.errors.push(...found.errors);
    report.version = found.version;
    mkdirSync(out, { recursive: true });
    for (const t of found.targets) {
      const s = await page.evaluate(({ kind, id }) => {
        const { E, models, textures } = window.__SHEETS__;
        try {
          const r = kind === 'model' ? E.modelSheet(id, { catalog: models, textures }) : E.textureSheet(id, { catalog: textures });
          const px = r.image.data;
          let bin = '';
          for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
          return { width: r.image.width, height: r.image.height, b64: btoa(bin), problems: r.problems, warnings: r.warnings, tris: r.report?.tris ?? null, size: r.bounds?.size.map((v) => +v.toFixed(2)) ?? null };
        } catch (e) {
          return { problems: [`drawing its sheet threw ${e instanceof Error ? `${e.name}: ${e.message}` : e}`], warnings: [] };
        }
      }, t);
      const entry = { kind: t.kind, id: t.id, file: null, problems: s.problems, warnings: s.warnings, ...(t.kind === 'model' ? { tris: s.tris, size: s.size } : {}) };
      if (s.b64) {
        entry.file = join(out, `${t.id.replace(/[^\w.-]+/g, '-')}${t.kind === 'texture' ? '.tex' : ''}.png`);
        writeFileSync(entry.file, png({ width: s.width, height: s.height, pixels: new Uint8Array(Buffer.from(s.b64, 'base64')) }));
      }
      report.sheets.push(entry);
    }
    if (!found.targets.length && !report.errors.length) report.errors.push('nothing to draw');
    report.ok = !report.errors.length && report.sheets.every((x) => x.file && !x.problems.length);
  } catch (e) {
    report.errors.push(`check: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await browser.close();
    server.close();
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.ok ? 'OK' : 'FAILED'}  sheets: ${items.join(', ')}  (engine ${report.version ?? '?'}, ${report.sheets.length} drawn)`);
  for (const x of report.sheets) {
    console.log(`  ${x.kind} ${x.id}: ${x.problems.length} problem(s), ${x.warnings.length} warning(s)${x.file ? `  ${x.file}` : ''}`);
    for (const p of x.problems) console.log(`    x ${p}`);
    for (const w of x.warnings) console.log(`    ! ${w}`);
  }
  for (const e of report.errors) console.log(`  error: ${e}`);
  console.log(`  report ${join(out, 'report.json')}`);
  process.exit(report.ok ? 0 : 1);
}

if (sheets) await drawSheets(String(opts.sheets));

let server = null;
let url = target;
if (!/^https?:/.test(target)) {
  // A local page, maybe with URL flags: "index.html?look=noir"
  const [path, query = ''] = target.split(/\?(.*)/s);
  const file = resolve(path);
  if (!existsSync(file) || statSync(file).isDirectory()) fail(`no such page: ${file}`);
  // Serve from the folder that holds pixel-engine.js (so examples/x.html can import
  // '../pixel-engine.js'), else the page's own folder.
  const dir = engineDir(dirname(file)) ?? dirname(file);
  server = await serve(dir);
  url = `http://127.0.0.1:${server.address().port}/${relative(dir, file).split(sep).join('/')}${query ? `?${query}` : ''}`;
}

const browser = await launch(server);

/** `?touch=1`: a phone's touch screen (a coarse pointer, so the page has its touch controls). */
const touch = new URL(url, 'http://localhost/').searchParams.get('touch') === '1';
const report = { page: target, url, ok: false, errors: [], warnings: [], shots: [], state: null, device: null, ...(touch ? { touch: null } : {}) };
/** The browser had no WebGPU (the engine's "WebGPU unavailable"): the environment's fault, not the game's. */
let noWebGPU = false;
try {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
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
    if (s.fatal) {
      noWebGPU = /WebGPU unavailable/.test(s.fatal);
      throw new Error(s.fatal);
    }
    if (s.frame >= 2) break;
    if (report.errors.length && !firstError) firstError = Date.now();
    if (firstError && Date.now() - firstError > 5000) throw new Error('the game never started (see the errors above)');
    if (Date.now() - t0 > 120000) throw new Error('the game did not start within 120 s');
    await new Promise((r) => setTimeout(r, 250));
  }

  // On a touch screen the player starts on touch (the engine sees the coarse pointer; said again
  // here, as a tap would): its prompts and controls show.
  if (touch) await page.evaluate(() => window.__PIXEL_ENGINE__.input.noteDevice('touch'));

  // Play: hold each step for its frames (frame-exact manual time). A hook that throws during
  // step() throws here: report it as the game's error, stop playing, still take the shots. The
  // fake pad is plugged in a frame before it is first used (a pad seen for the first time with its
  // stick over is resting there, as a player's would be); the mouse is the browser's own (real
  // pointer events on what is at that spot: the canvas, the ⚙, the settings panel).
  const run = (step, frames) =>
    page.evaluate(({ step, frames, hold }) => {
      const e = window.__PIXEL_ENGINE__;
      const holdKey = new Function(`return ${hold}`)();
      try {
        holdKey(e, step, true);
        e.step(frames);
        holdKey(e, step, false);
        e.step(1);
        return null;
      } catch (err) {
        try {
          holdKey(e, step, false);
        } catch {
          /* a step the game can't take: nothing was held */
        }
        return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
    }, { step, frames, hold: holdKey.toString() });
  if (keys.some((k) => k.kind === 'pad' || k.kind === 'stick')) await page.evaluate(({ hold }) => {
    const e = window.__PIXEL_ENGINE__;
    new Function(`return ${hold}`)()(e, null, true);
    e.step(1);
  }, { hold: holdKey.toString() });
  const mouseButton = { MouseLeft: 'left', MouseRight: 'right', MouseMiddle: 'middle' };
  let mouse = { x: 0, y: 0 }; // Playwright's mouse starts in the top left corner
  for (const k of keys) {
    let thrown;
    if (k.kind === 'pointer') {
      const spot = k.at ? await page.evaluate(artToPage, k.at) : null;
      if (spot?.off) {
        report.errors.push(`check: ${k.code}@${spot.off}`);
        break;
      }
      // the mouse travels there over TRAVEL frames, as a hand moves it: hover follows a pointer
      // that moves (a menu opened under a resting one keeps its focus)
      for (let i = 1; spot && i <= TRAVEL && !thrown; i++) {
        await page.mouse.move(mouse.x + ((spot.x - mouse.x) * i) / TRAVEL, mouse.y + ((spot.y - mouse.y) * i) / TRAVEL, { steps: 2 });
        thrown = await page.evaluate(() => {
          try {
            window.__PIXEL_ENGINE__.step(1);
            return null;
          } catch (err) {
            return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          }
        });
      }
      if (spot) mouse = spot;
      const button = mouseButton[k.code];
      if (button && !thrown) await page.mouse.down({ button });
      thrown ??= await run({ kind: 'idle', code: null }, k.frames);
      if (button) await page.mouse.up({ button });
      thrown ??= await run({ kind: 'idle', code: null }, 0);
    } else thrown = await run(k, k.frames);
    if (thrown) {
      const said = k.kind === 'stick' ? `${k.code}:${k.stick}` : k.at ? `${k.code}@${k.at}` : (k.code ?? 'nothing');
      report.errors.push(thrown.startsWith('Error: check.mjs: ') ? `check: ${thrown.slice('Error: check.mjs: '.length)}` : `game: ${thrown} (while holding ${said})`);
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

  const shotName = basename(target.split('?')[0]).replace(/\.html?$/, '') || 'page';
  const first = await shoot(shotName);
  if (touch) {
    // the page as the player sees it: the frame drawn to the canvas (manual time draws nothing by
    // itself), the HUD, and the touch controls and the ⚙ (page elements over it)
    await page.evaluate(() => new Promise((done) => {
      window.__PIXEL_ENGINE__.renderer.render();
      requestAnimationFrame(() => requestAnimationFrame(done));
    }));
    const file = join(out, `${shotName}-page.png`);
    mkdirSync(out, { recursive: true });
    await page.screenshot({ path: file });
    report.shots.push({ name: `${shotName}-page`, file, colors: null, topColorShare: null });
    report.touch = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const box = (r) => r && { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      const r = e.touch?.rects();
      return { device: e.input.device, controls: !!e.touch, visible: !!e.touch?.visible, stick: box(r?.stick), zone: box(r?.zone), buttons: (r?.buttons ?? []).map((b) => ({ code: b.code, label: b.label, hidden: b.hidden, rect: box(b.rect) })) };
    });
  }
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
  report.device = await page.evaluate(() => window.__PIXEL_ENGINE__.input.device);
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
console.log(`${report.ok ? 'OK' : 'FAILED'}  ${report.page}${s ? `  (${s.backend}, engine ${s.version}, ${s.frame} frames, "${s.status}", the device in use ${report.device})` : ''}`);
for (const shot of report.shots) console.log(`  shot ${shot.file}  (${shot.colors === null ? 'the page, with the touch controls' : `${shot.colors} colours`})`);
if (report.touch) console.log(`  touch: ${report.touch.controls ? `${report.touch.visible ? 'shown' : 'hidden'}, the device in use ${report.touch.device}, buttons ${report.touch.buttons.map((b) => `${b.label} (${b.code}${b.hidden ? ', hidden' : ''})`).join(', ') || 'none'}` : 'no touch controls'}`);
for (const w of report.warnings.slice(0, 10)) console.log(`  warning: ${w}`);
for (const e of report.errors) console.log(`  error: ${e}`);
console.log(`  report ${join(out, 'report.json')}`);
if (noWebGPU) {
  console.error('check.mjs: this Chromium has no WebGPU, so no game can start in it. Use Playwright\'s (npx playwright install chromium), or set CHROMIUM_PATH to a Chromium that has it.');
  process.exit(2);
}
process.exit(report.ok ? 0 : 1);
