// Riftlight playtest bot CLI: the scripted player (src/riftlight/game/bot.ts) plays the real
// game in Chromium, frame-exactly through Engine.step, and reports what happened.
//
//   npm run playtest -- <depth> [--runs 3] [--seed 1] [--level N] [--film] [--every 6] [--gif]
//                               [--max 10800] [--difficulty hard] [--webgpu] [--preview] [--json] [--out dir]
//   npm run playtest -- campaign [--to 24] [--tries 3] [--seed 1] [--difficulty hard] [--film] [--max 18000]
//                                [--resume .scratch/playtest/campaign-save-11.json]
//
//   <depth>      the level to play (1..12 designed, 13+ rifts)
//   --runs n     independent runs (seeds seed, seed+1, ...); default 1
//   --seed s     first run seed (the same seed plays the same level); default 1
//   --level N    hero level at the start (default 2 × depth − 1, so deep runs are fair)
//   --max n      frame budget per run (default 3 minutes of game time; campaign: 5 minutes)
//   --difficulty the Tuning sliders: a preset (story, normal, hard, nightmare) or
//                `enemyLife=1.5,playerDamage=0.8` (keys of DifficultyTuning), applied like the panel
//   --film       write a filmstrip PNG (scene + HUD) per run: every --every frames (default 6)
//   --gif        with --film, also an animated GIF to watch
//   --webgpu     the WebGPU backend (needs a display: run under xvfb-run); default WebGL 2
//   --preview    serve the production build (npm run build) instead of the dev server
//
// Output: a table (clear time, deaths, damage taken, kills, XP, gold, items, stuck) and
// .scratch/playtest/<depth>-<seed>.json (+ .png / .gif). Exit 1 when no run cleared.
//
// campaign: one bot plays a fresh run from depth 1 through the designed levels into the
// rifts, carrying its save like a player: before every level a town visit (the bot's
// `bot.town()`: gems, gear upgrades, selling, the vendors, passive points), then the level.
// A death sends it home (the game's penalty); like a player it farms the depth before once
// (unless --no-farm) and tries again, up to --tries times; the campaign ends at --to or
// when a depth beats it --tries times.
// Per depth: clear time, deaths, hero level, gem levels, gear score, DPS / effective life,
// gold and the items found by rarity → .scratch/playtest/campaign.json and campaign.png.
// After every depth the save is written to campaign-save-<depth>.json; --resume <file>
// carries on from one (handy for looking at one wall). Exit 1 when it does not clear the 12
// designed levels (or --to, if lower).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { lineChart, type Series, textPanel, tile } from '../../src/riftlight/balance/charts';
import { DIFFICULTY_KEYS, DIFFICULTY_PRESETS, sanitizeTuning } from '../../src/riftlight/game/difficulty';
import type { DifficultyTuning } from '../../src/riftlight/core/types';
import { encodeGif } from '../gif';
import { encodePng } from '../png';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const valued = ['runs', 'seed', 'level', 'max', 'every', 'out', 'to', 'tries', 'difficulty', 'resume'].includes(a.slice(2));
    flags.set(a.slice(2), valued ? (argv[++i] ?? '') : true);
  } else args.push(a);
}
const num = (k: string, d: number) => (flags.has(k) ? Number(flags.get(k)) : d);
const campaignMode = args[0] === 'campaign';
const depth = campaignMode ? 1 : Number(args[0] ?? 1);
if (!(depth >= 1)) {
  console.error('usage: npm run playtest -- <depth|campaign> [--runs n] [--seed s] [--to n] [--difficulty hard] [--film] [--gif] [--webgpu]');
  process.exit(2);
}
const difficulty = parseDifficulty(flags.get('difficulty'));
const runs = num('runs', 1);
const seed0 = num('seed', 1);
const heroLevel = num('level', Math.max(1, depth * 2 - 1));
const maxFrames = num('max', 60 * 60 * (campaignMode ? 5 : 3));
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
  found?: Record<string, number>;
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
    if (campaignMode) {
      await campaign(page);
      if (errors.length) console.error(`page errors:\n  ${errors.join('\n  ')}`);
      return;
    }
    for (let r = 0; r < runs; r++) {
      const seed = seed0 + r;
      await page.evaluate(
        async ([seed, depth, level, difficulty]) => {
          const rl = (window as unknown as { __RIFTLIGHT__: Api }).__RIFTLIGHT__;
          // manual time from here on: the render loop must not advance the level between calls,
          // or the same seed plays differently depending on how fast the browser is
          (window as unknown as { __PIXEL_ENGINE__: { manual: boolean } }).__PIXEL_ENGINE__.manual = true;
          rl.newRun({ seed });
          rl.setDifficulty(difficulty);
          if (level > 1) rl.give({ levels: level - 1 });
          await rl.enterDepth(depth);
          rl.bot.start();
        },
        [seed, depth, heroLevel, difficulty] as const,
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
  if (campaignMode) return;
  if (flags.has('json')) console.log(JSON.stringify(reports, null, 1));
  else table(reports);
  if (!reports.some((r) => r.cleared)) process.exitCode = 1;
}

type Api = {
  newRun(o: { seed: number }): unknown;
  give(o: { levels: number }): unknown;
  enterDepth(d: number): Promise<unknown>;
  setDifficulty(t: Partial<DifficultyTuning>): DifficultyTuning;
  bot: { start(): unknown; advance(n: number): unknown };
};

/** `--difficulty`: a preset name or `key=value,...` over the Tuning sliders (normal when absent). */
function parseDifficulty(raw: string | true | undefined): DifficultyTuning {
  if (raw === undefined || raw === true || raw === '') return { ...DIFFICULTY_PRESETS.normal };
  if (raw in DIFFICULTY_PRESETS) return { ...DIFFICULTY_PRESETS[raw as keyof typeof DIFFICULTY_PRESETS] };
  const t: Record<string, number> = { ...DIFFICULTY_PRESETS.normal };
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=') as [string, string | undefined];
    if (!(DIFFICULTY_KEYS as readonly string[]).includes(k) || !Number.isFinite(Number(v))) {
      console.error(`--difficulty: expected a preset (${Object.keys(DIFFICULTY_PRESETS).join(', ')}) or ${DIFFICULTY_KEYS.join('|')}=<multiplier>, got "${part}"`);
      process.exit(2);
    }
    t[k] = Number(v);
  }
  return sanitizeTuning(t);
}

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

// ---------------------------------------------------------------- campaign

/** Mirrors TownReport in src/riftlight/game/botTown.ts. */
interface TownReport {
  equipped: string[];
  socketed: string[];
  sold: number;
  soldGold: number;
  bought: string[];
  spent: number;
  gambled: number;
  allocated: number;
  before: { dps: number; ehp: number; score: number };
  after: { dps: number; ehp: number; score: number };
  gearScore: number;
}

interface GemRow {
  slot: number;
  id: string;
  support: boolean;
  level: number;
  fraction: number;
}

/** One depth of the campaign. */
interface DepthRow {
  depth: number;
  name: string;
  cleared: boolean;
  attempts: number;
  deaths: number;
  timeouts: number;
  /** Seconds of the clearing attempt (or the last one). */
  time: number;
  /** Seconds over every attempt. */
  totalTime: number;
  levelBefore: number;
  levelAfter: number;
  xp: number;
  goldBefore: number;
  goldAfter: number;
  goldEarned: number;
  kills: number;
  damageTaken: number;
  gems: GemRow[];
  gearScore: number;
  dps: number;
  ehp: number;
  found: Record<string, number>;
  town: { equipped: number; socketed: number; bought: number; spent: number; gambled: number; sold: number; soldGold: number; allocated: number };
  points: number;
  /** Who killed the bot, and when (seconds into the attempt). */
  killers: string[];
  /** After a timeout: progress and the monsters still alive. */
  left?: string;
  /** Runs of the depth before, played after a failed attempt (a player farming for XP and gear). */
  farmed: number;
  farmTime: number;
  farmDeaths: number;
  wallSeconds: number;
}

type CampaignApi = Api & {
  state(): { hero: { level: number; gold: number; xp: number }; levelName: string | null; deepest: number; screen: string };
  gems(): GemRow[];
  gearScore(): number;
  hero(stat: string): { value: number };
  bot: Api['bot'] & { town(o: { depth: number }): TownReport; report(): BotReport };
  game: { save: { hero: { allocated: string[] } } };
};

async function campaign(page: Page): Promise<void> {
  const to = num('to', 24);
  const tries = Math.max(1, num('tries', 3));
  const seed = seed0;
  const rows: DepthRow[] = [];
  const t0 = Date.now();
  // --resume <save.json>: carry on from a campaign save (written after every depth)
  const resume = typeof flags.get('resume') === 'string' ? readFileSync(resolve(String(flags.get('resume'))), 'utf8') : '';
  const first = (await page.evaluate(
    ([seed, difficulty, resume]) => {
      const rl = (window as unknown as { __RIFTLIGHT__: CampaignApi & { importSave(s: number, t: string): unknown; load(s: number): unknown } }).__RIFTLIGHT__;
      (window as unknown as { __PIXEL_ENGINE__: { manual: boolean } }).__PIXEL_ENGINE__.manual = true;
      rl.newRun({ seed });
      if (resume) {
        rl.importSave(0, resume);
        rl.load(0);
      }
      rl.setDifficulty(difficulty);
      return rl.state().deepest + 1;
    },
    [seed, difficulty, resume] as const,
  )) as number;
  const tag = Object.entries(difficulty).filter(([, v]) => v !== 1).map(([k, v]) => `${k} ${v}`).join(', ') || 'normal';
  console.log(`Riftlight campaign · seed ${seed} · to depth ${to} · ${tries} tries per depth · difficulty ${tag}`);
  let wall = false;
  for (let d = first; d <= to && !wall; d++) {
    const start = Date.now();
    const before = (await page.evaluate(() => (window as unknown as { __RIFTLIGHT__: CampaignApi }).__RIFTLIGHT__.state().hero)) as { level: number; gold: number };
    const row: DepthRow = {
      depth: d, name: '', cleared: false, attempts: 0, deaths: 0, timeouts: 0, time: 0, totalTime: 0, levelBefore: before.level, levelAfter: before.level, xp: 0,
      goldBefore: before.gold, goldAfter: before.gold, goldEarned: 0, kills: 0, damageTaken: 0, gems: [], gearScore: 0, dps: 0, ehp: 0, found: {},
      town: { equipped: 0, socketed: 0, bought: 0, spent: 0, gambled: 0, sold: 0, soldGold: 0, allocated: 0 }, points: 0, wallSeconds: 0, killers: [], farmed: 0, farmTime: 0, farmDeaths: 0,
    };
    const frames: Frame[] = [];
    for (let attempt = 0; attempt < tries && !row.cleared; attempt++) {
      row.attempts++;
      // the town visit, then into the level
      const town = (await page.evaluate(
        async (depth) => {
          const rl = (window as unknown as { __RIFTLIGHT__: CampaignApi }).__RIFTLIGHT__;
          const t = rl.bot.town({ depth });
          await rl.enterDepth(depth);
          rl.bot.start();
          return { t, name: rl.state().levelName ?? '', points: rl.game.save.hero.allocated.length };
        },
        d,
      )) as { t: TownReport; name: string; points: number };
      row.name = town.name;
      row.points = town.points;
      row.dps = town.t.after.dps;
      row.ehp = town.t.after.ehp;
      row.gearScore = town.t.gearScore;
      row.town.equipped += town.t.equipped.length;
      row.town.socketed += town.t.socketed.length;
      row.town.bought += town.t.bought.length;
      row.town.spent += town.t.spent;
      row.town.gambled += town.t.gambled ?? 0;
      row.town.sold += town.t.sold;
      row.town.soldGold += town.t.soldGold;
      row.town.allocated += town.t.allocated;
      let report: BotReport | null = null;
      const chunk = film ? every : 1800;
      for (let f = 0; f < maxFrames; f += chunk) {
        const res = (await page.evaluate((n) => (window as unknown as { __RIFTLIGHT__: Api }).__RIFTLIGHT__.bot.advance(n), Math.min(chunk, maxFrames - f))) as { done: boolean; report: BotReport };
        report = res.report;
        if (film && attempt === 0) frames.push(await shot(page));
        if (res.done) break;
      }
      // a level the bot ran out of time on: back to town like a player using the portal home
      const r = report!;
      if (!r.cleared && r.outcome === 'timeout') {
        row.timeouts++;
        // what was left (a wall made of unreachable monsters, not of difficulty)
        const left = (await page.evaluate(() => {
          const rl = (window as unknown as { __RIFTLIGHT__: { state(): { hero: { position: number[] }; monsters: { alive: number; killed: number; total: number } }; actors(): { name: string; rank: string; alive: boolean; position: number[] }[] } }).__RIFTLIGHT__;
          const st = rl.state();
          const p = st.hero.position;
          const alive = rl.actors().filter((a) => a.alive);
          return { progress: st.monsters, near: alive.slice(0, 6).map((a) => `${a.name} (${a.rank}) ${Math.hypot(a.position[0]! - p[0]!, a.position[2]! - p[2]!).toFixed(0)}m`) };
        })) as { progress: { killed: number; total: number }; near: string[] };
        row.left = `${left.progress.killed}/${left.progress.total} killed; alive: ${left.near.join(', ')}`;
        await page.evaluate(() => (window as unknown as { __RIFTLIGHT__: { toTown(): unknown } }).__RIFTLIGHT__.toTown());
      }
      if (r.outcome === 'died') {
        row.deaths++;
        const killer = (await page.evaluate(() => (window as unknown as { __RIFTLIGHT__: { log(n: number): { type: string; text: string }[] } }).__RIFTLIGHT__.log(200).filter((l) => l.type === 'death').at(-1)?.text ?? '')) as string;
        row.killers.push(`${killer.replace('slain by ', '')} @${r.time.toFixed(0)}s`);
      }
      row.cleared = r.cleared;
      row.time = r.time;
      row.totalTime += r.time;
      row.xp += r.xp;
      row.goldEarned += r.gold;
      row.kills += r.kills;
      row.damageTaken += r.damageTaken;
      for (const [k, v] of Object.entries(r.found ?? {})) row.found[k] = (row.found[k] ?? 0) + v;
      // beaten: like a player, farm the depth before once for XP and gear, then try again
      if (!row.cleared && attempt + 1 < tries && d > 1 && !flags.has('no-farm')) {
        const farm = (await page.evaluate(
          async ([depth, max]) => {
            const rl = (window as unknown as { __RIFTLIGHT__: CampaignApi & { toTown(): unknown } }).__RIFTLIGHT__;
            rl.bot.town({ depth });
            await rl.enterDepth(depth);
            rl.bot.start();
            const res = rl.bot.advance(max) as { done: boolean; report: BotReport };
            if (!res.done) rl.toTown();
            return res.report;
          },
          [d - 1, maxFrames] as const,
        )) as BotReport;
        row.farmed++;
        row.farmTime += farm.time;
        if (farm.outcome === 'died') row.farmDeaths++;
        for (const [k, v] of Object.entries(farm.found ?? {})) row.found[k] = (row.found[k] ?? 0) + v;
      }
    }
    const after = (await page.evaluate(() => {
      const rl = (window as unknown as { __RIFTLIGHT__: CampaignApi }).__RIFTLIGHT__;
      return { hero: rl.state().hero, gems: rl.gems(), gear: rl.gearScore() };
    })) as { hero: { level: number; gold: number }; gems: GemRow[]; gear: number };
    row.levelAfter = after.hero.level;
    row.goldAfter = after.hero.gold;
    row.gems = after.gems;
    row.gearScore = after.gear;
    row.wallSeconds = Math.round((Date.now() - start) / 1000);
    rows.push(row);
    if (film && frames.length) writeFileSync(join(out, `campaign-${String(d).padStart(2, '0')}.png`), encodePng(strip(frames, 8, 2) as never));
    const saved = (await page.evaluate(() => (window as unknown as { __RIFTLIGHT__: { save(): unknown; exportSave(): string } }).__RIFTLIGHT__.exportSave())) as string;
    writeFileSync(join(out, `campaign-save-${String(d).padStart(2, '0')}.json`), saved);
    console.log(campaignLine(row));
    if (!row.cleared) wall = true;
  }
  const cleared = rows.filter((r) => r.cleared).length;
  const summary = {
    seed,
    difficulty,
    to,
    tries,
    cleared,
    deepest: rows.filter((r) => r.cleared).at(-1)?.depth ?? 0,
    deaths: rows.reduce((n, r) => n + r.deaths + r.farmDeaths, 0),
    designedDeaths: rows.filter((r) => r.depth <= 12).reduce((n, r) => n + r.deaths, 0),
    gameMinutes: +(rows.reduce((n, r) => n + r.totalTime + r.farmTime, 0) / 60).toFixed(1),
    wallMinutes: +((Date.now() - t0) / 60000).toFixed(1),
    stoppedAt: wall ? rows.at(-1)!.depth : null,
  };
  writeFileSync(join(out, 'campaign.json'), JSON.stringify({ summary, rows }, null, 1));
  writeFileSync(join(out, 'campaign.png'), encodePng(campaignChart(rows, summary) as never));
  console.log(
    `\n${summary.cleared} depths cleared (deepest ${summary.deepest}), ${summary.deaths} deaths (${summary.designedDeaths} in the designed levels), ` +
      `${summary.gameMinutes} min of play in ${summary.wallMinutes} min${summary.stoppedAt ? ` · stopped at depth ${summary.stoppedAt} (${tries} tries)` : ''}`,
  );
  console.log(`→ ${join(out, 'campaign.json')}, ${join(out, 'campaign.png')}`);
  if (summary.deepest < Math.min(12, to)) process.exitCode = 1;
}

const RARITY_ORDER = ['normal', 'magic', 'rare', 'unique', 'gem', 'currency'] as const;
const CHART_COLORS = { a: [57, 135, 229], b: [217, 89, 38], c: [25, 158, 112], d: [201, 133, 0], e: [160, 100, 220], f: [230, 232, 240] } as const;

function mainGem(r: DepthRow): GemRow | undefined {
  return r.gems.find((g) => g.slot === 0 && !g.support);
}

function campaignLine(r: DepthRow): string {
  const gem = mainGem(r);
  const found = RARITY_ORDER.filter((k) => r.found[k]).map((k) => `${r.found[k]}${k[0]!.toUpperCase()}`).join(' ');
  return [
    `d${String(r.depth).padStart(2)} ${r.name.padEnd(30).slice(0, 30)}`,
    r.cleared ? `clear ${r.time.toFixed(0).padStart(3)}s` : 'FAILED    ',
    `deaths ${r.deaths}${r.timeouts ? ` (+${r.timeouts} timeout)` : ''}${r.farmed ? ` (farmed d${r.depth - 1} x${r.farmed}${r.farmDeaths ? `, ${r.farmDeaths} died` : ''})` : ''}`,
    `L${r.levelBefore}>${r.levelAfter}`,
    `${gem?.id ?? '-'} ${gem?.level ?? 0}`,
    `gear ${r.gearScore}`,
    `dps ${r.dps.toFixed(0)} ehp ${r.ehp.toFixed(0)}`,
    `gold ${r.goldAfter} (spent ${r.town.spent}${r.town.gambled ? `, ${r.town.gambled} gambles` : ''})`,
    `found ${found || '-'}`,
    ...(r.killers.length ? [`killed by ${r.killers.join(', ')}`] : []),
    ...(r.left && !r.cleared ? [`left: ${r.left}`] : []),
    `${r.wallSeconds}s`,
  ].join(' · ');
}

/** The campaign dashboard: a chart per measure over depth, plus the table. */
function campaignChart(rows: DepthRow[], summary: { seed: number; cleared: number; deaths: number; stoppedAt: number | null }): { width: number; height: number; data: Uint8ClampedArray } {
  const xs = rows.map((r) => r.depth);
  const maxX = Math.max(13, ...xs);
  const line = (label: string, color: readonly number[], ys: number[], dotted = false): Series => ({ label, color: color as [number, number, number], xs, ys, endLabel: true, dotted });
  const C = CHART_COLORS;
  const charts = [
    lineChart({ title: 'CLEAR TIME (S) · DOTS: ALL ATTEMPTS', series: [line('clear', C.a, rows.map((r) => (r.cleared ? r.time : NaN))), line('total', C.b, rows.map((r) => r.totalTime), true)], maxX }),
    lineChart({ title: 'DEATHS PER DEPTH', series: [line('deaths', C.b, rows.map((r) => r.deaths)), line('timeouts', C.d, rows.map((r) => r.timeouts), true)], maxX, yMin: 0 }),
    lineChart({ title: 'HERO LEVEL AFTER · MAIN GEM LEVEL', series: [line('hero', C.a, rows.map((r) => r.levelAfter)), line('gem', C.c, rows.map((r) => mainGem(r)?.level ?? 0)), line('tree', C.e, rows.map((r) => r.points), true)], maxX, yMin: 0 }),
    lineChart({ title: 'BOT DPS AND EFFECTIVE LIFE (LOG)', series: [line('dps', C.b, rows.map((r) => r.dps)), line('ehp', C.c, rows.map((r) => r.ehp))], maxX, log: true }),
    lineChart({ title: 'GEAR SCORE · GOLD CARRIED (/10)', series: [line('gear', C.d, rows.map((r) => r.gearScore)), line('gold/10', C.f, rows.map((r) => r.goldAfter / 10), true)], maxX, yMin: 0 }),
    lineChart({ title: 'ITEMS FOUND BY RARITY', series: [line('magic', C.a, rows.map((r) => r.found.magic ?? 0)), line('rare', C.d, rows.map((r) => r.found.rare ?? 0)), line('unique', C.b, rows.map((r) => r.found.unique ?? 0)), line('gems', C.c, rows.map((r) => r.found.gem ?? 0), true)], maxX, yMin: 0 }),
  ];
  const table = textPanel(
    `CAMPAIGN · SEED ${summary.seed} · ${summary.cleared} CLEARED · ${summary.deaths} DEATHS${summary.stoppedAt ? ` · STOPPED AT ${summary.stoppedAt}` : ''}`,
    rows.map((r) => ({ text: campaignLine(r).replace(/ · \d+s$/, ''), color: (r.cleared ? (r.deaths ? [255, 205, 117] : [230, 232, 240]) : [255, 120, 110]) as [number, number, number] })),
    470 * 2 + 6,
  );
  const grid = tile(charts, 2);
  const width = Math.max(grid.width, table.width + 12);
  const height = grid.height + table.height + 6;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([28, 31, 44, 255], i * 4);
  for (let y = 0; y < grid.height; y++) data.set(grid.data.subarray(y * grid.width * 4, (y + 1) * grid.width * 4), y * width * 4);
  for (let y = 0; y < table.height; y++) data.set(table.data.subarray(y * table.width * 4, (y + 1) * table.width * 4), ((grid.height + y) * width + 6) * 4);
  return { width, height, data };
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
