// e2e suite `hub`: 52in1's own session harness (scripts/hub/harness/, vendored unmodified) plays the
// built page in every online mode its hub:multiplayer names, as the hub does when a game joins its
// library (docs/game/session.md): a shared world co-op and versus, ghost, parallel and moments, on a
// lossy network, with a host leaving and a server with no player of its own. One page offers every
// mode (`npm run build:single`); `&mode=` and `&how=` pick the one a run plays, `&moment=` the moments.
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from 'playwright-core';
import { WEBGPU_ARGS } from './browser.mjs';
import { readHead } from './hub/head.mjs';
import { isOnline, modesOf, parseMoments } from './hub/harness/round.js';

const NET = 'latency=150&jitter=50&loss=5';

/**
 * The online modes a built page offers, read as the hub reads them (`modesOf`, the harness's own):
 * `[{ where, play, seats }]`, and the ids of its moments.
 */
export function pageModes(html) {
  const head = readHead(html);
  const moments = head.all('hub:moment');
  const modes = modesOf({
    session: head.one('hub:session'),
    sessionMode: head.one('hub:session-mode'),
    sessionPlayers: head.one('hub:session-players'),
    multiplayer: head.one('hub:multiplayer'),
    tags: (head.one('hub:tags') ?? '').split(',').map((t) => t.trim()),
    moments,
  }).filter(isOnline);
  return { modes, moments: parseMoments(moments).moments.map((m) => m.id) };
}

/**
 * The harness runs for each online mode a page offers. `full`: what the protocol's *Test it* says
 * the hub runs when a game joins (52in1's hub-check): parallel and moments at 1 and 2 players, the
 * others at 2, 3 and 4, each on a poor network; each once more with a player leaving (at 2 players,
 * or 3); a shared world once more at 2 players hosted by a server with no player of its own (once a
 * page, in the first shared world it offers). Otherwise a shorter set that still runs every check
 * in every mode (the e2e suite). Moments play every one of the page's moments (`&moment=`), where
 * the hub picks three of them by the seed.
 */
export function protocolRuns({ modes, moments }, { full = true } = {}) {
  const runs = [];
  let served = false;
  for (const m of modes) {
    const pick = `mode=${m.where}${m.play ? `&how=${m.play}` : ''}${m.where === 'moments' ? `&moment=${moments.join(',')}` : ''}`;
    const seats = (list) => list.filter((n) => n >= m.seats[0] && n <= m.seats[1]);
    const own = m.where === 'parallel' || m.where === 'moments';
    if (full) {
      const net = `${NET}&play=8000`;
      const counts = seats(own ? [1, 2] : [2, 3, 4]);
      for (const n of counts) runs.push(`${pick}&players=${n}&${net}`);
      const leaving = Math.max(2, Math.min(3, Math.max(...counts, 0)));
      if (leaving <= m.seats[1]) runs.push(`${pick}&players=${leaving}&${net}&scenario=host-leave`);
      if (!served && m.where === 'shared-world' && m.seats[0] <= 2 && m.seats[1] >= 2) {
        runs.push(`${pick}&players=2&${net}&scenario=server`);
        served = true;
      }
      continue;
    }
    for (const n of seats(own ? [2] : [Math.min(4, m.seats[1])])) runs.push(`${pick}&players=${n}&${NET}`);
    // the shorter set has the host leave where the round must carry on (ghost, moments) or end void
    // (the shared world played co-op), and a server host once, in that shared world
    const once = m.where === 'shared-world' && m.play === 'co-op';
    if (once || m.where === 'ghost' || m.where === 'moments') runs.push(`${pick}&players=${Math.min(own ? 2 : 4, m.seats[1])}&${NET}&scenario=host-leave`);
    if (once) runs.push(`${pick}&players=2&scenario=server`);
  }
  return runs;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

/** A static server for one folder (the harness frames the game from its own origin). */
export function serve(dir, port) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'harness.html';
    if (path.includes('..')) return void res.writeHead(400).end();
    try {
      const body = await readFile(new URL(path, dir));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** One run of the harness at `url` (harness.html?game=...&auto=1): whether the hub's checks pass, and the failed ones. */
export async function harness(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 300_000 });
    const report = await page.evaluate(() => window.__hubCheck);
    return { pass: report.pass, checks: report.checks.length, bad: report.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`) };
  } catch (e) {
    return { pass: false, checks: 0, bad: [], error: e.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

/** The vendored harness's files, copied next to the page it plays. */
export const HARNESS_FILES = ['harness.html', 'bridge.js', 'round.js'];

export async function runHub({ exe, root, check, run, tail, port = 4790 }) {
  console.log('\n▶ hub: 52in1 session harness, every online mode the page names');
  const dir = new URL('.scratch/hub/', root);
  await mkdir(dir, { recursive: true });
  for (const f of HARNESS_FILES) await copyFile(new URL(`scripts/hub/harness/${f}`, root), new URL(f, dir));
  const built = await run('npm', ['run', '--silent', 'build:single', '--', '--out', '.scratch/hub/riftlight.html']);
  check(built.code === 0, `build:single${built.code ? ':\n    ' + tail(built.out) : ''}`);
  if (built.code) return;
  const offer = pageModes(await readFile(new URL('riftlight.html', dir), 'utf8'));
  check(offer.modes.length >= 4 && offer.moments.length >= 3, `the page offers ${offer.modes.map((m) => [m.where, m.play].filter(Boolean).join(' ')).join(', ')}; ${offer.moments.length} moments`);
  const server = await serve(dir, port);
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: WEBGPU_ARGS });
  try {
    for (const q of protocolRuns(offer, { full: false })) {
      const r = await harness(browser, `http://localhost:${port}/harness.html?game=riftlight.html&${q}&auto=1`);
      check(r.pass, `${q}: ${r.error ? `the harness ran (${r.error})` : `the hub's checks pass (${r.checks})${r.bad.length ? '\n    ' + r.bad.join('\n    ') : ''}`}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}
