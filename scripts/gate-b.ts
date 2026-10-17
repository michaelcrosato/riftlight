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
//   npm run build && npm run gate-b -- [--densities 8,12,16,20] [--out .scratch/gate-b]
//
// Writes <out>/results.json and the filmstrips (<out>/strip.png); prints the table.
//
// Screening a surface (before a level lays it): `--floors id,…` lays each texture as the floor in
// place of the pinned cobbles (the wall and crates stay) at `--densities` (default 8), against a
// flat floor in that texture's own mean colour, and judges it on the zoom sweeps by the same three
// readings (no crate or pan). An entry is a texture id (the library's, or a pinned one such as
// `gate-b-cobbles`, the record's floor) or a draft file (`.ts`) whose exported TextureDefs are
// each screened (under ids the catalog doesn't use). Calm and bad (and the flat scene that is
// their baseline) run once, on every sweep, so the line is the plan's. A floor fills most of the
// frame, so a wall texture screened as a floor is judged strictly.
//
//   npm run build && npm run gate-b -- --floors cobbles,grass [--quick] [--densities 8] [--out .scratch/gate-b-screen]
//
//   --quick   the floors run only the landscape level sweep, where the worst step has always been
//             (0.65→0.70); their mean step is then over its 13 steps. Calm and bad still run every
//             sweep. A floor takes about 40% of its time (one sweep of four, but a landscape one).
//
// Writes <out>/screen.json and a filmstrip per floor (<out>/<id>.png: its flat and textured runs
// on the level-zoom sweep); prints a table per floor. `help`, `--help` or `-h` prints this.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { launchChromium } from './browser.mjs';
import { openPage, startServer } from './page.mjs';
import type { SheetImage } from '../src/engine/animation/raster';
import { column, row, textBox, titleBar } from '../src/engine/inspect/render';
import { upscale } from '../src/engine/model/sheet';
import { bakeTexture, type TextureDef } from '../src/engine/texture';
import { floorDef, gateBTextures, type GateBFrame, type GateBRun, type GateBSceneOptions, type GateBSet } from '../src/lab/gateB';
import { encodePng } from './png';
import { helpExit } from './manual.mjs';

helpExit(import.meta.url);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GATE_B_PORT) || 4188;
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const FLOORS = opt('floors', '').split(',').filter(Boolean);
const QUICK = argv.includes('--quick');
const DENSITIES = opt('densities', FLOORS.length ? '8' : '8,12,16,20').split(',').map(Number);
/** The renderer it runs on (results keep the name, as runs on the old WebGL 2 fallback did). */
const BACKENDS = ['webgpu'];
const OUT = resolve(ROOT, opt('out', '.scratch/gate-b'));

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
  /** The floor, when screening one (an id, or a draft's def). */
  readonly floor?: GateBSceneOptions['floor'];
  /** The flat run its excess is measured against. */
  readonly flat: string;
  /** The filmstrip its level-sweep frames go in (none: not filmed). */
  readonly strip?: string;
}

/** Calibration and its baseline (the record's flat scene): every run has them. */
const LINE: Config[] = [
  { name: 'flat', set: 'flat', texel: 16, flat: 'flat' },
  { name: 'bad@32', set: 'bad', texel: 32, flat: 'flat' },
  { name: 'calm@8', set: 'calm', texel: 8, flat: 'flat' },
];

/** The record's configs: calibration, then the pinned surfaces at each density, all filmed. */
const CONFIGS: Config[] = [...LINE, ...DENSITIES.map((t): Config => ({ name: `library@${t}`, set: 'library', texel: t, flat: 'flat' }))].map((c) => ({ ...c, strip: 'strip' }));

const isDef = (v: unknown): v is TextureDef => typeof v === 'object' && v !== null && 'layers' in v && 'size' in v && 'id' in v;

/** `--floors`: per floor, its flat run and a textured run per density, filmed into `<id>.png`. Checked here, before an hour of running. */
async function floorConfigs(): Promise<Config[]> {
  const catalog = gateBTextures();
  const out: Config[] = [];
  for (const entry of FLOORS) {
    let floors: { id: string; floor: string | TextureDef }[] = [{ id: entry, floor: entry }];
    if (/\.[cm]?ts$/.test(entry)) {
      const mod = (await import(pathToFileURL(resolve(entry)).href)) as Record<string, unknown>;
      const defs = [...new Set([mod.default, ...Object.values(mod)].filter(isDef))];
      if (!defs.length) throw new Error(`${entry} exports no TextureDef`);
      floors = defs.map((d) => ({ id: d.id, floor: d }));
    }
    for (const { id, floor } of floors) {
      const problems = bakeTexture(floorDef(floor, catalog)).problems;
      if (problems.length) throw new Error(`floor "${id}": ${problems.join('; ')}`);
      out.push({ name: `flat:${id}`, set: 'flat', texel: 16, floor, flat: `flat:${id}`, strip: id }, ...DENSITIES.map((t): Config => ({ name: `${id}@${t}`, set: 'library', texel: t, floor, flat: `flat:${id}`, strip: id })));
    }
  }
  if (new Set(out.map((c) => c.name)).size !== out.length) throw new Error('--floors names a floor twice');
  return out;
}

/** What runs on one screen: the record's sequences, or (screening) the sweeps, with the floors where they run. */
function plan(screen: 'landscape' | 'portrait', floors: readonly Config[]): { base: string; seq: Sequence; configs: readonly Config[] }[] {
  const sweeps = (Object.keys(BASES) as (keyof typeof BASES)[]).map((b) => ({ base: b, seq: sweep(BASES[b], screen === 'portrait' ? PORTRAIT : 1) }));
  if (!floors.length) {
    const seqs: { base: string; seq: Sequence }[] = [...sweeps];
    if (screen === 'landscape') seqs.push({ base: 'zoom 1', seq: crateRun() }, { base: 'level', seq: panRun() });
    return seqs.map((s) => ({ ...s, configs: CONFIGS }));
  }
  return sweeps.map((s) => ({ ...s, configs: [...LINE, ...(QUICK && !(screen === 'landscape' && s.base === 'level') ? [] : floors)] }));
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The Asset Lab (the engine ready, scripts/page.mjs), with its __ASSET_LAB__ handle. */
async function openLab(browser: Browser, url: string, viewport: { width: number; height: number }, query: string): Promise<{ page: Page; logs: string[] }> {
  // a fixed quality, so the engine's start-up auto quality can't change it mid-run
  const lab = await openPage(browser, `${url}asset-lab.html?model=crate&quality=medium${query}`, { viewport, timeout: 120000 });
  // the lab sets its handle as Engine.start's promise settles, just after __PIXEL_READY__
  await lab.page.waitForFunction(() => !!(window as unknown as { __ASSET_LAB__?: unknown }).__ASSET_LAB__, null, { timeout: 10000 });
  return lab;
}

async function runOn(page: Page, c: Config, seq: Sequence, shots: number[] = []): Promise<GateBRun> {
  return page.evaluate(
    async ({ set, texel, opts, frames, shots }) => {
      const lab = (window as unknown as { __ASSET_LAB__: { gateB: { scene(s: string, t: number, o: GateBSceneOptions): unknown; run(f: unknown, s: number[]): Promise<GateBRun> } } }).__ASSET_LAB__;
      lab.gateB.scene(set, texel, opts);
      return lab.gateB.run(frames, shots);
    },
    { set: c.set, texel: c.texel, opts: c.floor === undefined ? {} : { floor: c.floor }, frames: seq.frames, shots },
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
  const floors = await floorConfigs();
  mkdirSync(OUT, { recursive: true });
  // the production build: run `npm run build` first
  const server = await startServer({ port: PORT, mode: 'preview', probe: 'asset-lab.html', timeout: 120000, portEnv: 'GATE_B_PORT' });
  const results: Result[] = [];
  const strips = new Map<string, SheetImage[]>();
  const renderers = new Set<string>();
  const t0 = Date.now();
  // a screen saves as it goes (it runs for an hour or more); `done` says it finished
  const saveScreen = (done: boolean) => writeFileSync(join(OUT, 'screen.json'), JSON.stringify({ done, settle: SETTLE, densities: DENSITIES, quick: QUICK, floors: FLOORS, renderers: [...renderers], ...(done ? { screened: screenReport(results, floors) } : {}), results }, null, 1));
  const writeStrip = (name: string): string => {
    const body = column(strips.get(name)!);
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, encodePng(column([titleBar(`gate b${floors.length ? `: ${name} as the floor` : ''}: the level-zoom sweep, steps 1, 5, 9, 13 (mid-step frames)`, body.width), body])));
    return file;
  };
  try {
    for (const backend of BACKENDS) {
      const browser = await launchChromium();
      try {
        for (const screen of ['landscape', 'portrait'] as const) {
          const viewport = screen === 'landscape' ? { width: 480, height: 270 } : { width: 124, height: 270 };
          const { page, logs: errors } = await openLab(browser, server.url, viewport, screen === 'portrait' ? '&aspect=adaptive' : '');
          const st = await page.evaluate(() => (window as unknown as { __PIXEL_ENGINE__: { state(): { backend: string; resolution: { width: number; height: number } } } }).__PIXEL_ENGINE__.state());
          renderers.add(`${backend} ${screen}: ${st.backend}, ${st.resolution.width}×${st.resolution.height}`);
          for (const { base, seq, configs } of plan(screen, floors)) {
            const runs = new Map<string, GateBRun>();
            const stripAt = screen === 'landscape' && base === 'level' && seq.name === 'sweep' ? seq.windows.filter((_, k) => k % 4 === 0).map((w) => Math.floor((w.from + w.to) / 2)) : [];
            // each config's flat run comes before it, so its excess is known as soon as it has run
            for (const c of configs) {
              const r = await runOn(page, c, seq, c.strip ? stripAt : []);
              runs.set(c.name, r);
              if (c.strip && r.shots.length) {
                const shots = r.shots.map((s) => ({ width: r.width, height: r.height, data: new Uint8ClampedArray(Buffer.from(s.rgba, 'base64')) }));
                strips.set(c.strip, [...(strips.get(c.strip) ?? []), column([textBox([{ text: `${backend} ${c.name}` }], 200), row(shots.map((s) => upscale(s, 1)))])]);
              }
              process.stdout.write(`\r${backend} ${screen} ${base} ${seq.name} ${c.name}: ${r.changed.length} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)        `);
              const flat = runs.get(c.flat)!;
              results.push({
                backend,
                screen,
                base,
                seq: seq.name,
                config: c.name,
                windows: seq.windows.map((w) => ({ label: w.label, raw: mean(r.changed.slice(w.from, w.to)), excess: mean(r.changed.slice(w.from, w.to).map((v, i) => v - flat.changed[w.from + i]!)) })),
                shift: r.shift.filter(([dx, dy]) => dx || dy).length,
              });
              if (floors.length) {
                saveScreen(false);
                if (c.strip && r.shots.length) writeStrip(c.strip);
              }
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
    server.stop();
  }
  console.log('\n');
  console.log(`renderers: ${[...renderers].join('; ')}`);
  const rel = (f: string) => f.replace(`${ROOT}/`, '');
  const wrote: string[] = [];
  if (floors.length) {
    saveScreen(true);
    wrote.push(rel(join(OUT, 'screen.json')));
  } else {
    writeFileSync(join(OUT, 'results.json'), JSON.stringify({ settle: SETTLE, densities: DENSITIES, renderers: [...renderers], results }, null, 1));
    report(results);
    wrote.push(rel(join(OUT, 'results.json')));
  }
  for (const name of strips.keys()) wrote.push(rel(writeStrip(name)));
  console.log(`wrote ${wrote.join(', ')} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const passFail = (ok: boolean) => (ok ? 'pass' : 'FAIL');

/**
 * The sweep's pass line on `backend`, the plan's (a quarter of the way from calm@8's mean step to
 * bad@32's, over every step they ran), and the two other readings: a line per step (calm and bad at
 * that step) and one from their worst steps. `judge` reads a config's sweep steps all three ways.
 */
function readings(results: readonly Result[], backend: string) {
  const stepsOf = (config: string) => results.filter((r) => r.backend === backend && r.config === config && r.seq === 'sweep').flatMap((r) => r.windows.map((w) => ({ where: `${r.screen} ${r.base} ${w.label}`, excess: w.excess })));
  const calmSteps = stepsOf('calm@8');
  const badSteps = stepsOf('bad@32');
  const calmAt = new Map(calmSteps.map((w) => [w.where, w.excess]));
  const badAt = new Map(badSteps.map((w) => [w.where, w.excess]));
  const calm = mean(calmSteps.map((w) => w.excess));
  const bad = mean(badSteps.map((w) => w.excess));
  const line = calm + (bad - calm) / 4;
  const worstOf = (steps: readonly { excess: number }[]) => Math.max(...steps.map((w) => w.excess));
  const worstLine = worstOf(calmSteps) + (worstOf(badSteps) - worstOf(calmSteps)) / 4;
  const judge = (config: string) => {
    const steps = stepsOf(config);
    const worst = steps.reduce((a, b) => (b.excess > a.excess ? b : a), steps[0]!);
    const ratio = Math.max(...steps.map((w) => (w.excess - calmAt.get(w.where)!) / (((badAt.get(w.where)! - calmAt.get(w.where)!) / 4) || 1e-9)));
    return { worst: worst.excess, where: worst.where, mean: mean(steps.map((w) => w.excess)), steps: steps.length, ratio, pass: { line: worst.excess <= line, perStep: ratio <= 1, worstLine: worst.excess <= worstLine } };
  };
  return { calm, bad, line, worstLine, judge };
}

function report(results: Result[]): void {
  for (const backend of BACKENDS) {
    const of = (config: string, seq: string) => results.filter((r) => r.backend === backend && r.config === config && r.seq === seq).flatMap((r) => r.windows.map((w) => w.excess));
    const crateCalm = mean(of('calm@8', 'crate'));
    const crateBad = mean(of('bad@32', 'crate'));
    const crateLine = crateCalm + (crateBad - crateCalm) / 4;
    const sweep = readings(results, backend);
    console.log(`${backend}: sweep pass line ${pct(sweep.line)} (calm ${pct(sweep.calm)}, bad ${pct(sweep.bad)}; from the worst steps ${pct(sweep.worstLine)}); crate pass line ${pct(crateLine)} (calm ${pct(crateCalm)}, bad ${pct(crateBad)})`);
    console.log(`  ${'config'.padEnd(12)} ${'sweep worst step'.padEnd(34)} ${'sweep mean'.padEnd(11)} ${'per step'.padEnd(18)} ${'worst line'.padEnd(11)} ${'crate'.padEnd(9)} pan (raw)`);
    for (const c of CONFIGS.filter((x) => x.set !== 'flat')) {
      const j = sweep.judge(c.name);
      const crate = mean(of(c.name, 'crate'));
      const pan = results.find((r) => r.backend === backend && r.config === c.name && r.seq === 'pan');
      const perStep = `${passFail(j.pass.perStep)} (×${j.ratio.toFixed(2)})`;
      console.log(`  ${c.name.padEnd(12)} ${`${pct(j.worst)} ${passFail(j.pass.line)} (${j.where})`.padEnd(34)} ${pct(j.mean).padEnd(11)} ${perStep.padEnd(18)} ${passFail(j.pass.worstLine).padEnd(11)} ${`${pct(crate)} ${passFail(crate <= crateLine)}`.padEnd(9)} ${pct(pan?.windows[0]?.excess ?? 0)} (${pct(pan?.windows[0]?.raw ?? 0)})`);
    }
  }
}

/** The screen's table: each floor at each density, read three ways; returns the rows for screen.json. */
function screenReport(results: readonly Result[], floors: readonly Config[]) {
  const rows = [];
  for (const backend of BACKENDS) {
    const sweep = readings(results, backend);
    console.log(`${backend}: pass line ${pct(sweep.line)} (calm ${pct(sweep.calm)}, bad ${pct(sweep.bad)}: their mean steps over every sweep); from the worst steps ${pct(sweep.worstLine)}${QUICK ? '; the floors ran the landscape level sweep only (--quick)' : ''}`);
    console.log(`  ${'floor'.padEnd(20)} ${'worst step'.padEnd(36)} ${'mean step'.padEnd(10)} ${'line'.padEnd(5)} ${'per step'.padEnd(14)} worst line`);
    for (const c of floors.filter((x) => x.set !== 'flat')) {
      const j = sweep.judge(c.name);
      console.log(`  ${c.name.padEnd(20)} ${`${pct(j.worst)} (${j.where})`.padEnd(36)} ${pct(j.mean).padEnd(10)} ${passFail(j.pass.line).padEnd(5)} ${`${passFail(j.pass.perStep)} (×${j.ratio.toFixed(2)})`.padEnd(14)} ${passFail(j.pass.worstLine)}`);
      rows.push({ backend, config: c.name, texel: c.texel, line: sweep.line, worstLine: sweep.worstLine, ...j });
    }
  }
  return rows;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
