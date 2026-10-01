// Riftlight playtest bot CLI: the scripted player (src/riftlight/game/bot.ts) plays the real
// game in Chromium, frame-exactly through Engine.step, and reports what happened.
//
//   npm run playtest -- <depth> [--runs 3] [--seed 1] [--level N] [--film] [--every 6] [--gif]
//                               [--max 10800] [--webgpu] [--preview] [--json] [--out dir]
//
//   <depth>      the level to play (1..12 designed, 13+ rifts)
//   --runs n     independent runs (seeds seed, seed+1, ...); default 1
//   --seed s     first run seed (the same seed plays the same level); default 1
//   --level N    hero level at the start (default 2 × depth − 1, so deep runs are fair)
//   --max n      frame budget per run (default 3 minutes of game time)
//   --film       write a filmstrip PNG (scene + HUD) per run: every --every frames (default 6)
//   --gif        with --film, also an animated GIF to watch
//   --webgpu     the WebGPU backend (needs a display: run under xvfb-run); default WebGL 2
//   --preview    serve the production build (npm run build) instead of the dev server
//
// Output: a table (clear time, deaths, damage taken, kills, XP, gold, items, stuck) and
// .scratch/playtest/<depth>-<seed>.json (+ .png / .gif). Exit 1 when no run cleared.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { encodeGif } from '../gif';
import { encodePng } from '../png';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const valued = ['runs', 'seed', 'level', 'max', 'every', 'out'].includes(a.slice(2));
    flags.set(a.slice(2), valued ? (argv[++i] ?? '') : true);
  } else args.push(a);
}
const num = (k: string, d: number) => (flags.has(k) ? Number(flags.get(k)) : d);
const depth = Number(args[0] ?? 1);
if (!(depth >= 1)) {
  console.error('usage: npm run playtest -- <depth> [--runs n] [--seed s] [--film] [--gif] [--webgpu]');
  process.exit(2);
}
const runs = num('runs', 1);
const seed0 = num('seed', 1);
const heroLevel = num('level', Math.max(1, depth * 2 - 1));
const maxFrames = num('max', 60 * 60 * 3);
const every = Math.max(1, num('every', 6));
const film = flags.has('film');
const out = resolve(ROOT, String(flags.get('out') ?? '.scratch/playtest'));
const PORT = Number(process.env.PLAYTEST_PORT) || 4800 + Math.floor(Math.random() * 400);

/** Mirrors BotReport in src/riftlight/game/bot.ts (not imported: that pulls the engine into the node typecheck). */
interface BotReport {
  depth: number;
  cleared: boolean;
  time: number;
  frames: number;
  deaths: number;
  damageTaken: number;
  kills: number;
  xp: number;
  gold: number;
  items: number;
  stuck: number;
  outcome: 'cleared' | 'died' | 'timeout';
}

interface Frame {
  width: number;
  height: number;
  data: Uint8Array;
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const server = await startServer();
  const webgpu = flags.has('webgpu');
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: !process.env.DISPLAY,
    args: webgpu
      ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-fallback-to-gl-for-testing']
      : ['--disable-features=WebGPU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const reports: (BotReport & { seed: number; level: number })[] = [];
  try {
    // 480×270: one device pixel per art pixel (cheapest to render and read back).
    const page = await browser.newPage({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?game=riftlight&debug=0&touch=0&save=memory`);
    await page.waitForFunction(() => (window as unknown as { __RIFTLIGHT__?: unknown }).__RIFTLIGHT__, null, { timeout: 120000 });
    for (let r = 0; r < runs; r++) {
      const seed = seed0 + r;
      await page.evaluate(
        async ([seed, depth, level]) => {
          const rl = (window as unknown as { __RIFTLIGHT__: Api }).__RIFTLIGHT__;
          // manual time from here on: the render loop must not advance the level between calls,
          // or the same seed plays differently depending on how fast the browser is
          (window as unknown as { __PIXEL_ENGINE__: { manual: boolean } }).__PIXEL_ENGINE__.manual = true;
          rl.newRun({ seed });
          if (level > 1) rl.give({ levels: level - 1 });
          await rl.enterDepth(depth);
          rl.bot.start();
        },
        [seed, depth, heroLevel] as const,
      );
      const frames: Frame[] = [];
      let report: BotReport | null = null;
      for (let f = 0; f < maxFrames; f += every) {
        const res = (await page.evaluate((n) => (window as unknown as { __RIFTLIGHT__: Api }).__RIFTLIGHT__.bot.advance(n), film ? every : maxFrames)) as { done: boolean; report: BotReport };
        report = res.report;
        if (film) frames.push(await shot(page));
        if (res.done || !film) break;
      }
      const rep = { ...report!, seed, level: heroLevel };
      reports.push(rep);
      const base = join(out, `${depth}-${seed}`);
      writeFileSync(`${base}.json`, JSON.stringify(rep, null, 1));
      if (film && frames.length) {
        writeFileSync(`${base}.png`, encodePng(strip(frames, 8, 2) as never));
        if (flags.has('gif')) writeFileSync(`${base}.gif`, encodeGif(frames, (every / 60) * 100));
      }
      if (!flags.has('json')) console.log(`run ${r + 1}/${runs} seed ${seed}: ${rep.outcome} in ${rep.time}s${film ? `  → ${base}.png` : ''}`);
    }
    if (errors.length) console.error(`page errors:\n  ${errors.join('\n  ')}`);
  } finally {
    await browser.close();
    stop(server);
  }
  if (flags.has('json')) console.log(JSON.stringify(reports, null, 1));
  else table(reports);
  if (!reports.some((r) => r.cleared)) process.exitCode = 1;
}

type Api = {
  newRun(o: { seed: number }): unknown;
  give(o: { levels: number }): unknown;
  enterDepth(d: number): Promise<unknown>;
  bot: { start(): unknown; advance(n: number): unknown };
};

/** The presented frame with the HUD composited on top (the HUD is a separate 2D canvas). */
async function shot(page: Page): Promise<Frame> {
  const r = (await page.evaluate(async () => {
    const e = (window as unknown as { __PIXEL_ENGINE__: { renderer: { capture(): Promise<{ width: number; height: number; pixels: Uint8Array }> } } }).__PIXEL_ENGINE__;
    const f = await e.renderer.capture();
    const px = f.pixels;
    const hud = document.querySelector('canvas[data-hud]') as HTMLCanvasElement | null;
    if (hud && hud.width) {
      const img = hud.getContext('2d')!.getImageData(0, 0, hud.width, hud.height).data;
      const s = f.width / hud.width;
      for (let y = 0; y < f.height; y++)
        for (let x = 0; x < f.width; x++) {
          const hi = (Math.floor(y / s) * hud.width + Math.floor(x / s)) * 4;
          if (img[hi + 3]! > 0) {
            const o = (y * f.width + x) * 4;
            px[o] = img[hi]!;
            px[o + 1] = img[hi + 1]!;
            px[o + 2] = img[hi + 2]!;
            px[o + 3] = 255;
          }
        }
    }
    let bin = '';
    for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
    return { width: f.width, height: f.height, b64: btoa(bin) };
  })) as { width: number; height: number; b64: string };
  return { width: r.width, height: r.height, data: Uint8Array.from(Buffer.from(r.b64, 'base64')) };
}

/** A grid of frames, each downscaled by `down`, `cols` per row. */
function strip(frames: Frame[], cols: number, down: number): { width: number; height: number; data: Uint8Array } {
  const keep = frames.length > cols * 6 ? frames.filter((_, i) => i % Math.ceil(frames.length / (cols * 6)) === 0) : frames;
  const fw = Math.floor(keep[0]!.width / down);
  const fh = Math.floor(keep[0]!.height / down);
  const rows = Math.ceil(keep.length / cols);
  const width = fw * Math.min(cols, keep.length) + 2 * (Math.min(cols, keep.length) - 1);
  const height = fh * rows + 2 * (rows - 1);
  const data = new Uint8Array(width * height * 4).fill(16);
  keep.forEach((f, i) => {
    const ox = (i % cols) * (fw + 2);
    const oy = Math.floor(i / cols) * (fh + 2);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const s = ((y * down) * f.width + x * down) * 4;
        const d = ((oy + y) * width + ox + x) * 4;
        data[d] = f.data[s]!;
        data[d + 1] = f.data[s + 1]!;
        data[d + 2] = f.data[s + 2]!;
        data[d + 3] = 255;
      }
  });
  return { width, height, data };
}

function table(rows: (BotReport & { seed: number })[]): void {
  const head = ['seed', 'outcome', 'time', 'deaths', 'dmg taken', 'kills', 'xp', 'gold', 'items', 'stuck'];
  const body = rows.map((r) => [r.seed, r.outcome, `${r.time}s`, r.deaths, r.damageTaken, r.kills, r.xp, r.gold, r.items, r.stuck].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(w[i]!)).join('  ');
  console.log(`\nRiftlight playtest · depth ${depth} · hero level ${heroLevel}`);
  console.log(line(head));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const b of body) console.log(line(b));
  const cleared = rows.filter((r) => r.cleared);
  if (cleared.length) console.log(`\n${cleared.length}/${rows.length} cleared · mean clear ${(cleared.reduce((s, r) => s + r.time, 0) / cleared.length).toFixed(1)}s`);
}

async function startServer(): Promise<ChildProcess> {
  const args = flags.has('preview') ? ['vite', 'preview', '--port', String(PORT), '--strictPort'] : ['vite', '--port', String(PORT), '--strictPort'];
  // detached: its own process group, so stop() takes down npx *and* vite
  const proc = spawn('npx', args, { cwd: ROOT, stdio: 'ignore', detached: true, env: { ...process.env, FILM: '1' } });
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  stop(proc);
  throw new Error('vite did not start');
}

function stop(proc: ChildProcess): void {
  try {
    process.kill(-proc.pid!, 'SIGTERM');
  } catch {
    proc.kill();
  }
}

function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const last = readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
    if (last) return `/opt/pw-browsers/${last}/chrome-linux/chrome`;
  } catch {
    /* fall through */
  }
  return undefined;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
