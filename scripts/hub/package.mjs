// npm run hub -- --model <name> [--effort <level>] [--mode <mode>] [--out <dir>] [--offline] [--keep]
//
// Riftlight's AI Hub package (AI Hub Catalogue v1, docs/game/hub.md), laid out the way the hub is:
//
//   <dir>/games/riftlight-v<version>.<build>.html  the hand-over build: every translation, the model
//                                                  that built it (<build>: the commit's UTC time,
//                                                  YYYYMMDDhhmm, so each hand-over is a new build)
//   <dir>/covers/riftlight/0.jpg                    the title screen
//   <dir>/covers/riftlight/1.jpg, 2.jpg             the game being played: a fight in a rift, the town
//
// The covers are 640×480 baseline JPEGs at quality 58 (a 960×720 window at device scale 2/3), from
// the finished file opened on its own (file://, no session), in English. Then the catalogue's three
// checks, each on the hand-over page itself:
//
//   3. a browser: the picture reaches every edge at 1600×900, 2100×900 and 1200×900; ?lang=en-XA,
//      zh-XC and ar-XB set <html lang> and draw only test-language text on the title and in town
//      (`__PIXEL_TEXT_LOG__`: a word that isn't a line fails); nothing logs an error
//   2. the session harness: the protocol's runs (its *Test it*) for the mode the page declares
//   1. the hub's checker (scripts/hub/catalogue-check.mjs, vendored unmodified) on the folder
//
// and exits 1 if any fails. Pictures of the browser checks go to <dir>-checks/ (never the package).
//
//   --model <name>      the model that wrote the game, as its maker names it (hub:model; required to
//                       build; never stored in the repo)
//   --effort <level>    its effort setting (hub:effort: low, medium, high, xhigh, max, ultra)
//   --mode <mode>       the session mode the page declares (default scripts/hub/riftlight.mjs DEFAULT_MODE)
//   --out <dir>         the package folder (default .scratch/hub-package; emptied first, and refused
//                       if it holds anything but a package's games/ and covers/)
//   --offline           the checker skips comparing the game with the wall's
//   --keep              keep the built page: take the covers and run the checks again (the page's own
//                       hub:model, hub:effort and mode stand; flags that differ are an error)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium } from '../browser.mjs';
import { harness, protocolRuns, serve } from '../e2e-hub.mjs';
import { strays } from '../lang-audit.mjs';
import { helpExit } from '../manual.mjs';
import { engineReady } from '../page.mjs';
import { MODES } from './riftlight.mjs';

helpExit(import.meta.url);

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`);
  return v;
};
const fail = (message) => {
  console.error(`npm run hub: ${message}`);
  process.exit(1);
};

const SLUG = 'riftlight';
const keep = argv.includes('--keep');
const out = resolve(opt('out') ?? join(root, '.scratch/hub-package'));
const covers = join(out, 'covers', SLUG);
if (existsSync(out)) {
  const other = (await readdir(out)).filter((n) => n !== 'games' && n !== 'covers');
  if (other.length || out === resolve(root)) fail(`${out} holds ${other.join(', ') || 'the repository'}: not a package folder (give a new or empty one)`);
}

/** A page's `<meta name content>` tags, by name. */
const metaTags = (html) => {
  const tags = {};
  for (const [m] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = /\bname="([^"]*)"/.exec(m)?.[1];
    const content = /\bcontent="([^"]*)"/.exec(m)?.[1];
    if (name && content !== undefined) tags[name] = content.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return tags;
};

// 1. The page: built (or, with --keep, the one already there).
let page;
if (keep) {
  const pages = existsSync(join(out, 'games')) ? (await readdir(join(out, 'games'))).filter((f) => f.endsWith('.html')) : [];
  if (pages.length !== 1) fail(`--keep: ${join(out, 'games')} holds ${pages.length} pages, not one (build without --keep)`);
  page = join(out, 'games', pages[0]);
  const tags = metaTags(await readFile(page, 'utf8'));
  for (const [flag, tag] of [['model', 'hub:model'], ['effort', 'hub:effort'], ['mode', 'hub:session-mode']]) {
    if (opt(flag) !== undefined && opt(flag) !== tags[tag]) fail(`--keep: the page's ${tag} is ${JSON.stringify(tags[tag] ?? null)}, not ${JSON.stringify(opt(flag))} (build without --keep)`);
  }
} else {
  const model = opt('model');
  if (!model) fail('--model <name>: the model that wrote the game, as its maker names it (hub:model)');
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const build = execFileSync('git', ['log', '-1', '--format=%cd', '--date=format-local:%Y%m%d%H%M'], { cwd: root, env: { ...process.env, TZ: 'UTC' } }).toString().trim(); // the commit's time: one name per commit, later on main, any clone depth
  page = join(out, 'games', `${SLUG}-v${version}.${build}.html`);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'games'), { recursive: true });
  const args = ['tsx', 'scripts/build-single.mjs', '--translations', '--model', model, '--out', page];
  if (opt('effort')) args.push('--effort', opt('effort'));
  if (opt('mode')) args.push('--mode', opt('mode'));
  const built = spawnSync('npx', args, { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) fail(`build:single failed (${built.error?.message ?? `exit ${built.status ?? built.signal}`})`);
}
const declared = metaTags(await readFile(page, 'utf8'))['hub:session-mode'];
const problems = [];
if (!MODES.includes(declared)) problems.push(`the page declares the session mode ${JSON.stringify(declared ?? null)}: one of ${MODES.join(', ')}`);

await rm(covers, { recursive: true, force: true });
await mkdir(covers, { recursive: true });

// 2. The covers: three moments of the finished game, each waited on by frames (a software renderer
// draws only a few a second), then looked at by whoever hands the package in.
/** Run `act` in the page, then let `frames` frames draw. */
async function moment(p, act, arg, frames = 6) {
  if (act) await p.evaluate(act, arg);
  await p.evaluate(() => window.__RIFTLIGHT__.realtime());
  const from = await p.evaluate(() => window.__PIXEL_ENGINE__.state().frame);
  await p.waitForFunction(([f, n]) => window.__PIXEL_ENGINE__.state().frame >= f + n, [from, frames], { timeout: 120000 });
}

/** Open the page in `browser` (`query` after it), its errors counted as problems; resolves when the game is up. */
async function open(browser, query, options) {
  const p = await browser.newPage(options);
  const logs = [];
  const where = query || 'the page';
  p.on('console', (m) => m.type() === 'error' && problems.push(`console error (${where}): ${m.text()}`));
  p.on('pageerror', (e) => {
    logs.push(`pageerror ${e}`);
    problems.push(`page error (${where}): ${e}`);
  });
  await p.addInitScript(() => {
    window.__PIXEL_TEXT_LOG__ = new Set(); // every text the engine's fonts draw (docs/engine/lang.md)
  });
  await p.goto(pathToFileURL(page).href + query);
  await engineReady(p, { logs });
  await p.waitForFunction(() => !!window.__RIFTLIGHT__, null, { timeout: 60000 });
  return p;
}

const COVERS = [
  // 0: the title, the cabinet's face
  ['0.jpg', null, null, 10],
  // 1: a fight in a rift: the bot plays past the entrance's messages into the thick of it
  [
    '1.jpg',
    async (depth) => {
      const rl = window.__RIFTLIGHT__;
      rl.newRun({ seed: 7 });
      rl.give({ items: 6, levels: 6, gold: 500 });
      rl.bot.town();
      await rl.enterDepth(depth);
      rl.bot.start();
      rl.bot.advance(60 * 6);
      for (let i = 0; i < 60 * 60; i += 10) {
        rl.bot.advance(10);
        const g = rl.game;
        if (!g.level || g.dead) break;
        const hero = g.hero.actor.position;
        if (g.level.monsters().filter((m) => m.actor.alive && m.actor.position.distanceTo(hero) < 5).length >= 3) break;
      }
      rl.bot.advance(6);
    },
    3,
  ],
  // 2: Emberfall, the town between rifts, in the evening: the hero crossing the plaza
  [
    '2.jpg',
    async () => {
      const rl = window.__RIFTLIGHT__;
      rl.toTown();
      rl.setTimeOfDay(0.76);
      const f = rl.game.town.fountainAt; // the plaza's fountain (private in TypeScript, there at run time: a rename throws here)
      rl.moveTo(f.x + 2.5, f.z + 2.5, { radius: 0.6 });
      rl.step(20);
    },
  ],
];

let browser = await launchChromium();
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 2 / 3, locale: 'en-US' });
  const p = await open(context, '');
  for (const [name, act, arg, frames] of COVERS) {
    await moment(p, act, arg, frames);
    await p.screenshot({ path: join(covers, name), type: 'jpeg', quality: 58 });
    console.log(`covers/${SLUG}/${name}`);
  }
} finally {
  await browser.close();
}

// 3. The browser checks (the catalogue's *Checks*, 3): the picture fills the window at three shapes,
// loaded at one and resized to the others; the three test languages show on the title and in town
// (every text drawn is a line in the test language: brackets and accents, Chinese characters, Arabic;
// proper names aside); nothing errors. Their pictures go beside the package, in <dir>-checks/.
const shots = `${out}-checks`;
await rm(shots, { recursive: true, force: true });
await mkdir(shots, { recursive: true });
const SIZES = [
  [1600, 900],
  [2100, 900],
  [1200, 900],
];
const TEST_LANGUAGES = ['en-XA', 'zh-XC', 'ar-XB'];
browser = await launchChromium();
try {
  const p = await open(browser, '', { viewport: { width: SIZES[0][0], height: SIZES[0][1] } });
  for (const [width, height] of SIZES) {
    await p.setViewportSize({ width, height });
    await moment(p, null, null, 4);
    const f = await p.evaluate(() => window.__PIXEL_ENGINE__.state().framing);
    const fills = f.offsetX <= 0.5 && f.offsetY <= 0.5 && f.offsetX + f.cssWidth >= width - 0.5 && f.offsetY + f.cssHeight >= height - 0.5; // reaches every edge (a pixel art scale may overhang one)
    if (!fills) problems.push(`at ${width}×${height} the picture is ${f.cssWidth}×${f.cssHeight} at ${f.offsetX},${f.offsetY}: it doesn't fill the window`);
    await p.screenshot({ path: join(shots, `${width}x${height}.png`) });
    console.log(`${fills ? '✓' : '✗'} ${width}×${height}: the picture ${f.cssWidth}×${f.cssHeight} at ${f.offsetX},${f.offsetY} (art ${f.artWidth}×${f.artHeight} ×${f.scale})`);
  }
  await p.close();
  for (const code of TEST_LANGUAGES) {
    const q = await open(browser, `?lang=${code}`, { viewport: { width: SIZES[0][0], height: SIZES[0][1] } });
    const names = await q.evaluate(() => JSON.parse(document.getElementById('game-lines').textContent).names ?? []);
    const lang = await q.evaluate(() => document.documentElement.lang);
    const bad = lang === code ? [] : [`<html lang> is ${JSON.stringify(lang)}`];
    for (const [screen, act] of [
      ['title', null],
      ['town', () => window.__RIFTLIGHT__.newRun({ seed: 7 })],
    ]) {
      await q.evaluate(() => window.__PIXEL_TEXT_LOG__.clear());
      await moment(q, act, null, 6);
      const texts = await q.evaluate(() => [...window.__PIXEL_TEXT_LOG__]);
      const english = texts.filter((t) => strays(t, names).length);
      if (texts.length < 3) bad.push(`the ${screen} drew ${texts.length} texts`);
      if (english.length) bad.push(`the ${screen} drew ${english.length} texts that aren't ${code}: ${english.slice(0, 6).map((t) => JSON.stringify(t)).join(' ')}${english.length > 6 ? ' …' : ''}`);
      await q.screenshot({ path: join(shots, `${code}-${screen}.png`) });
    }
    for (const b of bad) problems.push(`?lang=${code}: ${b}`);
    console.log(`${bad.length ? '✗' : '✓'} ?lang=${code}: the title and the town${bad.length ? `: ${bad.join('; ')}` : ''}`);
    await q.close();
  }
} finally {
  await browser.close();
}

// 4. The session harness (the catalogue's *Checks*, 2): the protocol's runs for the page's mode, on
// the hand-over page itself (the `hub` e2e suite runs a shorter set in every mode on development builds).
if (MODES.includes(declared)) {
  const bench = join(shots, 'harness') + '/';
  await mkdir(bench, { recursive: true });
  for (const f of ['harness.html', 'bridge.js', 'round.js']) await copyFile(join(root, 'scripts/hub/harness', f), join(bench, f));
  await copyFile(page, join(bench, 'game.html'));
  const port = Number(process.env.HUB_PORT) || 4795;
  const server = await serve(pathToFileURL(bench), port);
  browser = await launchChromium();
  try {
    for (const q of protocolRuns(declared)) {
      const r = await harness(browser, `http://localhost:${port}/harness.html?game=game.html&${q}&auto=1`);
      if (!r.pass) problems.push(`the session harness, ${declared} ${q}: ${r.error ?? r.bad.join('; ')}`);
      console.log(`${r.pass ? '✓' : '✗'} the session harness: ${declared} ${q}${r.pass ? ` (${r.checks} checks)` : ''}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

// 5. The hub's checker on the package (the catalogue's *Checks*, 1).
const checked = spawnSync(process.execPath, [join(root, 'scripts/hub/catalogue-check.mjs'), out, ...(argv.includes('--offline') ? ['--offline'] : [])], { stdio: 'inherit' });
if (checked.status !== 0) problems.push(`the hub's checker: ${checked.error?.message ?? `exit ${checked.status ?? checked.signal}`}`);
for (const p of problems) console.log(`✗ ${p}`);
console.log(`\n${out}: look at each cover (covers/${SLUG}/) and each check's picture (${shots}/) before handing the package in`);
process.exit(problems.length ? 1 : 0);
