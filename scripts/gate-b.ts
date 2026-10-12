// Gate B (docs/plans/asset-system.md §5): how many texels per metre a surface may carry before
// it shimmers, measured in the real renderer. The Asset Lab's Gate B scene (src/lab/gateB.ts)
// is stepped frame by frame through Riftlight's camera moves, once per texture set:
//
//   - a zoom sweep through the settings wheel from fully out (0.6, then ×1.08 steps to 1.6, the
//     stops a player reaches scrolling in from the clamp), each step eased as the game eases it
//     (until within 1e-3 of its goal), at the level (1.08) and town (1.22) zooms, on a landscape
//     screen and a portrait one (×0.8);
//   - a crate sliding at 2 m/s at zoom 1;
//   - a pan at 1 m/s (a check: the rig snaps to art pixels, so a pan should score ~0).
//
// A frame's score is the share of pixels that changed since the frame before (after undoing the
// whole-pixel shift that best lines them up: the rig snaps the camera to art pixels, so a snap is a
// shift, not flicker); a textured run's *excess flicker* is its score minus the flat run's (the
// same scene in the textures' mean colours), frame by frame. A zoom step scores the mean over its
// frames. The floor fills most of the frame, so the sweep scores the floor's texture (cobbles) in
// effect; the strips show the wall and crates too. The pass line sits a quarter of the way from a
// calm texture (two-colour blobs at 8 texels/m) to a bad one (a 1-texel checker at 32), each
// scored by its mean step; a density passes when every step is under it. The table also prints
// two other readings of the plan's line: per step (calm and bad at the same step) and from the
// worst steps.
//
//   npm run build && npm run gate-b -- [--backend webgpu|webgl|both] [--densities 8,12,16,20] [--out .scratch/gate-b]
//
// Writes <out>/results.json and the filmstrips (<out>/strip.png); prints the table.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import type { SheetImage } from '../src/engine/animation/raster';
import { column, row, textBox, titleBar } from '../src/engine/inspect/render';
import { upscale } from '../src/engine/model/sheet';
import type { GateBFrame, GateBRun, GateBSet } from '../src/lab/gateB';
import { encodePng } from './png';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GATE_B_PORT) || 4188;
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const DENSITIES = opt('densities', '8,12,16,20').split(',').map(Number);
const BACKEND = opt('backend', 'both');
if (!['webgpu', 'webgl', 'both'].includes(BACKEND)) throw new Error(`--backend ${BACKEND}: webgpu, webgl or both`);
const BACKENDS = BACKEND === 'both' ? ['webgpu', 'webgl'] : [BACKEND];
const OUT = resolve(ROOT, opt('out', '.scratch/gate-b'));

const ARGS: Record<string, string[]> = {
  webgpu: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-fallback-to-gl-for-testing'],
  webgl: ['--disable-features=WebGPU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const BASES = { level: 1.08, town: 1.22 } as const;
const PORTRAIT = 0.8;
const EASE = 1 - Math.exp(-4 / 60); // Riftlight's zoom easing per 1/60 s frame (Riftlight.ts)
const DONE = 1e-3; // and where it stops easing
// Frames at the start of a sequence that aren't scored: the lab camera settles (stiffness 40)
// and the scene's light fades in (0.25 s) while the last scene's fades out.
const SETTLE = 20;

/** The settings wheel from 0.6 to 1.6 in ×1.08 steps: each step's goal. */
function wheel(): number[] {
  const out = [0.6];
  while (out.at(-1)! < 1.6) out.push(Math.min(1.6, out.at(-1)! * 1.08));
  return out;
}

interface Sequence {
  readonly name: string;
  readonly frames: GateBFrame[];
  /** Scored windows: [first frame, end) with a label. */
  readonly windows: { label: string; from: number; to: number }[];
}

function sweep(base: number, scale: number): Sequence {
  const goals = wheel().map((s) => base * s * scale);
  const frames: GateBFrame[] = [];
  let zoom = goals[0]!;
  for (let i = 0; i < SETTLE; i++) frames.push({ zoom });
  const windows: Sequence['windows'] = [];
  for (let k = 1; k < goals.length; k++) {
    const from = frames.length;
    while (Math.abs(goals[k]! - zoom) > DONE) {
      zoom += (goals[k]! - zoom) * EASE;
      frames.push({ zoom });
    }
    windows.push({ label: `${goals[k - 1]!.toFixed(2)}→${goals[k]!.toFixed(2)}`, from, to: frames.length });
  }
  return { name: 'sweep', frames, windows };
}

function crateRun(): Sequence {
  const frames: GateBFrame[] = [];
  for (let i = 0; i < SETTLE; i++) frames.push({ zoom: 1, crate: -3 });
  for (let i = 1; i <= 180; i++) frames.push({ zoom: 1, crate: -3 + (2 * i) / 60 });
  return { name: 'crate', frames, windows: [{ label: 'crate', from: SETTLE, to: frames.length }] };
}

function panRun(): Sequence {
  const frames: GateBFrame[] = [];
  for (let i = 0; i < SETTLE; i++) frames.push({ zoom: BASES.level, pan: 0 });
  for (let i = 1; i <= 120; i++) frames.push({ zoom: BASES.level, pan: i / 60 });
  return { name: 'pan', frames, windows: [{ label: 'pan', from: SETTLE, to: frames.length }] };
}

interface Config {
  readonly name: string;
  readonly set: GateBSet;
  readonly texel: number;
}

const CONFIGS: Config[] = [{ name: 'flat', set: 'flat', texel: 16 }, { name: 'bad@32', set: 'bad', texel: 32 }, { name: 'calm@8', set: 'calm', texel: 8 }, ...DENSITIES.map((t): Config => ({ name: `library@${t}`, set: 'library', texel: t }))];

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function openLab(page: Page, query: string): Promise<void> {
  // a fixed quality, so the engine's start-up auto quality can't change it mid-run
  await page.goto(`http://localhost:${PORT}/asset-lab.html?model=crate&quality=medium${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __ASSET_LAB__?: unknown }).__ASSET_LAB__, null, { timeout: 120000 });
}

async function runOn(page: Page, c: Config, seq: Sequence, shots: number[] = []): Promise<GateBRun> {
  return page.evaluate(
    async ({ set, texel, frames, shots }) => {
      const lab = (window as unknown as { __ASSET_LAB__: { gateB: { scene(s: string, t: number): unknown; run(f: unknown, s: number[]): Promise<GateBRun> } } }).__ASSET_LAB__;
      lab.gateB.scene(set, texel);
      return lab.gateB.run(frames, shots);
    },
    { set: c.set, texel: c.texel, frames: seq.frames, shots },
  );
}

interface Result {
  backend: string;
  screen: string;
  base: string;
  seq: string;
  config: string;
  windows: { label: string; raw: number; excess: number }[];
  shift: number;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const results: Result[] = [];
  const strips: SheetImage[] = [];
  const renderers = new Set<string>();
  const t0 = Date.now();
  try {
    for (const backend of BACKENDS) {
      const browser = await chromium.launch({ executablePath: chromiumPath(), headless: !process.env.DISPLAY, args: ARGS[backend] });
      try {
        for (const screen of ['landscape', 'portrait'] as const) {
          const page = await browser.newPage({ viewport: screen === 'landscape' ? { width: 480, height: 270 } : { width: 124, height: 270 }, deviceScaleFactor: 1 });
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
          await openLab(page, `${screen === 'portrait' ? '&aspect=adaptive' : ''}${backend === 'webgl' ? '&backend=webgl' : ''}`);
          const st = await page.evaluate(() => (window as unknown as { __PIXEL_ENGINE__: { state(): { backend: string; resolution: { width: number; height: number } } } }).__PIXEL_ENGINE__.state());
          renderers.add(`${backend} ${screen}: ${st.backend}, ${st.resolution.width}×${st.resolution.height}`);
          const seqs: { base: string; seq: Sequence }[] = (Object.keys(BASES) as (keyof typeof BASES)[]).map((b) => ({ base: b, seq: sweep(BASES[b], screen === 'portrait' ? PORTRAIT : 1) }));
          if (screen === 'landscape') seqs.push({ base: 'zoom 1', seq: crateRun() }, { base: 'level', seq: panRun() });
          for (const { base, seq } of seqs) {
            const runs = new Map<string, GateBRun>();
            const stripAt = screen === 'landscape' && base === 'level' && seq.name === 'sweep' ? seq.windows.filter((_, k) => k % 4 === 0).map((w) => Math.floor((w.from + w.to) / 2)) : [];
            for (const c of CONFIGS) {
              const r = await runOn(page, c, seq, stripAt);
              runs.set(c.name, r);
              if (stripAt.length) {
                const shots = r.shots.map((s) => ({ width: r.width, height: r.height, data: new Uint8ClampedArray(Buffer.from(s.rgba, 'base64')) }));
                strips.push(column([textBox([{ text: `${backend} ${c.name}` }], 200), row(shots.map((s) => upscale(s, 1)))]));
              }
              process.stdout.write(`\r${backend} ${screen} ${base} ${seq.name} ${c.name}: ${r.changed.length} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)        `);
            }
            const flat = runs.get('flat')!;
            for (const c of CONFIGS) {
              const r = runs.get(c.name)!;
              results.push({
                backend,
                screen,
                base,
                seq: seq.name,
                config: c.name,
                windows: seq.windows.map((w) => ({ label: w.label, raw: mean(r.changed.slice(w.from, w.to)), excess: mean(r.changed.slice(w.from, w.to).map((v, i) => v - flat.changed[w.from + i]!)) })),
                shift: r.shift.filter(([dx, dy]) => dx || dy).length,
              });
            }
          }
          if (errors.length) console.log(`\n  ${backend} ${screen}: page errors: ${errors.slice(0, 5).join(' | ')}`);
          await page.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    stop(server);
  }
  console.log('\n');
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ settle: SETTLE, densities: DENSITIES, renderers: [...renderers], results }, null, 1));
  console.log(`renderers: ${[...renderers].join('; ')}`);
  report(results);
  if (strips.length) {
    const body = column(strips);
    writeFileSync(join(OUT, 'strip.png'), encodePng(column([titleBar('gate b: the level-zoom sweep, steps 1, 5, 9, 13 (mid-step frames)', body.width), body])));
  }
  console.log(`wrote ${join(OUT, 'results.json').replace(`${ROOT}/`, '')}, ${join(OUT, 'strip.png').replace(`${ROOT}/`, '')} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

function report(results: Result[]): void {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  for (const backend of BACKENDS) {
    const of = (config: string, seq: string) => results.filter((r) => r.backend === backend && r.config === config && r.seq === seq).flatMap((r) => r.windows.map((w) => w.excess));
    const line = (seq: string) => {
      const calm = mean(of('calm@8', seq));
      const bad = mean(of('bad@32', seq));
      return { calm, bad, line: calm + (bad - calm) / 4 };
    };
    const sweepLine = line('sweep');
    const crateLine = line('crate');
    // the other readings: a line per step (calm and bad at that step), and one from the worst steps
    const stepsOf = (config: string) => results.filter((r) => r.backend === backend && r.config === config && r.seq === 'sweep').flatMap((r) => r.windows.map((w) => ({ key: `${r.screen} ${r.base} ${w.label}`, excess: w.excess })));
    const calmAt = new Map(stepsOf('calm@8').map((w) => [w.key, w.excess]));
    const badAt = new Map(stepsOf('bad@32').map((w) => [w.key, w.excess]));
    const worstOf = (config: string) => Math.max(...stepsOf(config).map((w) => w.excess));
    const worstLine = worstOf('calm@8') + (worstOf('bad@32') - worstOf('calm@8')) / 4;
    console.log(`${backend}: sweep pass line ${pct(sweepLine.line)} (calm ${pct(sweepLine.calm)}, bad ${pct(sweepLine.bad)}; from the worst steps ${pct(worstLine)}); crate pass line ${pct(crateLine.line)} (calm ${pct(crateLine.calm)}, bad ${pct(crateLine.bad)})`);
    console.log(`  ${'config'.padEnd(12)} ${'sweep worst step'.padEnd(34)} ${'sweep mean'.padEnd(11)} ${'per step'.padEnd(18)} ${'worst line'.padEnd(11)} ${'crate'.padEnd(9)} pan (raw)`);
    for (const c of CONFIGS.filter((x) => x.set !== 'flat')) {
      const steps = results.filter((r) => r.backend === backend && r.config === c.name && r.seq === 'sweep').flatMap((r) => r.windows.map((w) => ({ ...w, where: `${r.screen} ${r.base} ${w.label}` })));
      const worst = steps.reduce((a, b) => (b.excess > a.excess ? b : a), steps[0]!);
      const crate = mean(of(c.name, 'crate'));
      const pan = results.find((r) => r.backend === backend && r.config === c.name && r.seq === 'pan');
      const passS = steps.every((s) => s.excess <= sweepLine.line) ? 'pass' : 'FAIL';
      const passC = crate <= crateLine.line ? 'pass' : 'FAIL';
      const ratio = Math.max(...stepsOf(c.name).map((w) => (w.excess - calmAt.get(w.key)!) / (((badAt.get(w.key)! - calmAt.get(w.key)!) / 4) || 1e-9)));
      const perStep = `${ratio <= 1 ? 'pass' : 'FAIL'} (×${ratio.toFixed(2)})`;
      const byWorst = worst.excess <= worstLine ? 'pass' : 'FAIL';
      console.log(`  ${c.name.padEnd(12)} ${`${pct(worst.excess)} ${passS} (${worst.where})`.padEnd(34)} ${pct(mean(steps.map((s) => s.excess))).padEnd(11)} ${perStep.padEnd(18)} ${byWorst.padEnd(11)} ${`${pct(crate)} ${passC}`.padEnd(9)} ${pct(pan?.windows[0]?.excess ?? 0)} (${pct(pan?.windows[0]?.raw ?? 0)})`);
    }
  }
}

// ---- infrastructure (as scripts/film.ts) -----------------------------------------------------
async function startServer(): Promise<ChildProcess> {
  // the production build: run `npm run build` first
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  // up to 2 minutes: on a loaded machine the preview server can take a while
  for (let i = 0; i < 1200; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/asset-lab.html`)).ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  stop(proc);
  throw new Error('vite preview did not start (run npm run build first)');
}

function stop(proc: ChildProcess): void {
  try {
    if (proc.pid) process.kill(-proc.pid);
  } catch {
    /* already gone */
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
