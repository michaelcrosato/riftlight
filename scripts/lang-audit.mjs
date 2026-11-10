// `npm run lang -- audit`: play the built game under a test language and list every string on screen
// that isn't a line (docs/game/lang.md). The engine's fonts add each text they draw to
// `__PIXEL_TEXT_LOG__` (docs/engine/lang.md); under `en-XA` every line is bracketed, under `zh-XC` and
// `ar-XB` it has no Latin letters, so a run of Latin letters left over (proper names aside) is a word
// that isn't a line. Screens: the title and its menus, the town and each townsperson, every panel, a
// level (its card, a fight, the clear), a death. Writes .scratch/lang/audit.json and a PNG per screen.
import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium } from './browser.mjs';
import { strays } from './lang-strays.mjs';
import { engineReady, startServer } from './page.mjs';

export { strays };

/** The screens, as actions in the page (window.__RIFTLIGHT__) with an argument; each waits a little after. */
const SCREENS = [
  ['title', () => {}],
  ['title-settings', () => window.__RIFTLIGHT__.ui.open('settings')],
  ['title-slots', () => window.__RIFTLIGHT__.ui.open('slots')],
  ['title-look', () => window.__RIFTLIGHT__.ui.open('look')],
  ['town', () => window.__RIFTLIGHT__.newRun({ seed: 7 })],
  ...['brann', 'ilsa', 'oru', 'vex', 'stash'].map((id) => [`town-${id}`, (who) => window.__RIFTLIGHT__.talkTo(who), id]),
  ...['inventory', 'skills', 'tree', 'character', 'codex', 'pause', 'tuning', 'vendor', 'stash', 'crafting', 'respec', 'rift'].map((id) => [`panel-${id}`, (panel) => window.__RIFTLIGHT__.ui.open(panel), id]),
  ['level', async () => {
    const rl = window.__RIFTLIGHT__;
    rl.give({ items: 6, levels: 3, gold: 500 });
    await rl.enterDepth(1);
  }],
  ['level-fight', () => window.__RIFTLIGHT__.killAll()],
  ['level-inventory', () => window.__RIFTLIGHT__.ui.open('inventory')],
  ['death', () => {
    const g = window.__RIFTLIGHT__.game;
    g.hero.actor.takeHit({ source: g.hero.actor, tags: ['audit'], damage: { chaos: 1e9 }, crit: false });
  }],
];

export async function audit({ root, lang = 'en-XA', names = [], out = `${root}.scratch/lang/` }) {
  await mkdir(out, { recursive: true });
  const port = Number(process.env.LANG_PORT) || 4730 + Math.floor((process.pid % 50) * 2);
  const server = await startServer({ port, mode: 'preview', portEnv: 'LANG_PORT', timeout: 30000 });
  const browser = await launchChromium();
  const report = { lang, screens: [], offenders: 0, errors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('pageerror', (e) => report.errors.push(String(e)));
    await page.addInitScript(() => {
      window.__PIXEL_TEXT_LOG__ = new Set();
    });
    await page.goto(`http://localhost:${port}/?lang=${encodeURIComponent(lang)}&seed=7&save=memory`);
    await engineReady(page);
    await page.waitForFunction(() => !!window.__RIFTLIGHT__, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const all = new Map();
    for (const [name, act, arg] of SCREENS) {
      await page.evaluate((keep) => {
        const rl = window.__RIFTLIGHT__;
        if (!keep) for (let i = 0; i < 8 && rl.ui.stack().length; i++) rl.ui.close(); // the title keeps its menu
        window.__PIXEL_TEXT_LOG__.clear();
      }, name === 'title');
      try {
        await page.evaluate(act, arg);
      } catch (e) {
        report.errors.push(`${name}: ${e.message.split('\n')[0]}`);
      }
      await page.evaluate(() => window.__RIFTLIGHT__.realtime()); // the API's moves step by hand: give time back to the page so frames draw
      // frames, not milliseconds: a software renderer may draw only a few a second. The browser's
      // frames, not the engine's: a window that pauses the game stops the engine's frame count
      const frames = name === 'death' ? 10 : 4;
      await page
        .evaluate((n) => new Promise((done) => { let left = n; const next = () => (--left <= 0 ? done() : requestAnimationFrame(next)); requestAnimationFrame(next); }), frames) // prettier-ignore
        .catch(() => report.errors.push(`${name}: no frames`));
      if (name === 'death') await page.waitForTimeout(2600);
      const texts = await page.evaluate(() => [...window.__PIXEL_TEXT_LOG__]);
      const offenders = texts.filter((t) => strays(t, names).length);
      for (const t of offenders) all.set(t, [...(all.get(t) ?? []), name]);
      report.screens.push({ name, texts: texts.length, offenders });
      await page.screenshot({ path: `${out}${name}.png` });
      console.log(`${offenders.length ? '✘' : '✔'} ${name.padEnd(18)} ${texts.length} texts${offenders.length ? `, ${offenders.length} not lines: ${offenders.slice(0, 4).map((t) => JSON.stringify(t)).join(' ')}${offenders.length > 4 ? ' …' : ''}` : ''}`);
    }
    report.offenders = all.size;
    report.all = Object.fromEntries([...all.entries()].sort(([a], [b]) => a.localeCompare(b)));
  } finally {
    await browser.close();
    server.stop?.();
  }
  await writeFile(`${out}audit.json`, JSON.stringify(report, null, 1));
  console.log(`\n${report.offenders} distinct strings on screen are not lines (${lang}); ${out}audit.json${report.errors.length ? `\npage errors: ${report.errors.slice(0, 5).join(' | ')}` : ''}`);
  return report;
}
