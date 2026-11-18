// e2e suite `hub`: 52in1's own session harness (scripts/hub/harness/, vendored unmodified) plays the
// built page in every online mode its hub:multiplayer names, as the hub does when a game joins its
// library (docs/game/session.md): a shared world co-op and versus, ghost, parallel and moments, on a
// lossy network, with a host leaving and a server with no player of its own. One page offers every
// mode (`npm run build:single`); `&mode=` and `&how=` pick the one a run plays, `&moment=` the moments.
// Then a round of moments on a phone held upright with its touch controls: no ≡ in a round.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** Resolves to `promise`'s value, or to `fallback` after `ms` (a page whose thread is stuck never answers). */
const within = (promise, ms, fallback) => Promise.race([promise.catch((e) => `(${e.message.split('\n')[0]})`), new Promise((r) => setTimeout(() => r(fallback), ms))]);

/** A run whose page's renderer died: Playwright's waits never notice one, and would sit out their whole timeout. */
export const CRASHED = 'the harness page crashed: its renderer died (out of memory? `journalctl --user -u earlyoom` says whether earlyoom killed it)';

/** The harness page's state, read in it: its checks, its log (every hub message), the round, each copy's phase and frame. */
function harnessState() {
  return {
    complete: document.body.dataset.complete ?? null,
    checks: window.__hubCheck?.checks ?? null,
    round: document.getElementById('round')?.textContent ?? null,
    log: window.__hubCheck?.log ?? null,
    stalls: window.__stalls ?? null,
    copies: [...document.querySelectorAll('iframe')].map((f) => {
      try {
        const w = f.contentWindow;
        const round = w.__RIFTLIGHT__?.game?.round ?? null;
        return { title: f.title, time: w.AIHub?.time?.() ?? null, phase: round?.phase ?? null, players: round?.players ?? null, cleared: round?.clearedAt ?? null, frame: w.__PIXEL_ENGINE__?.state?.().frame ?? null };
      } catch (e) {
        return { title: f.title, error: String(e) };
      }
    }),
  };
}

/** What earlyoom (a memory-capped machine's out-of-memory killer) killed since `since` (ms), where it runs: a crashed page's likely cause. */
function earlyoomKills(since) {
  try {
    const out = execFileSync('journalctl', ['--user', '-u', 'earlyoom', '--since', `@${Math.floor(since / 1000)}`, '--no-pager', '-o', 'short-iso'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().split('\n').filter((l) => /sending SIG/.test(l)).map((l) => l.slice(0, 300));
  } catch {
    return null; // no journal here
  }
}

/**
 * What a harness page was doing when its run failed or never finished, written to `<evidence>.json`
 * (and a picture, `<evidence>.png`, while the page lives): its state now, or when it is gone or
 * doesn't answer the last state read while it ran (`seen`); whether it still draws; the console of
 * every frame; and, when its thread is stuck (a frame's script in a loop: the frames share the
 * harness's thread), where its script is (the debugger paused, its stack).
 */
async function capture(page, { consoleLines, seen, crashed, error, since }, evidence) {
  const now = crashed ? 'the page crashed' : await within(page.evaluate(harnessState), 8000, 'the page did not answer in 8 s');
  // whether the page still draws: the harness's checks wait on timers, its games on frames
  if (now && typeof now === 'object') now.drawing = await within(page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => r(true))), new Promise((r) => setTimeout(() => r(false), 1000))])), 3000, null);
  let stack = null;
  if (!crashed && typeof now === 'string') {
    // the thread is stuck: pause its script where it is and read the stack (each step bounded)
    try {
      const cdp = await within(page.context().newCDPSession(page), 5000, null);
      if (!cdp || typeof cdp !== 'object') throw new Error(`no debugger session ${cdp ?? ''}`);
      const paused = new Promise((r) => cdp.once('Debugger.paused', r));
      await within(cdp.send('Debugger.enable'), 5000, null);
      await within(cdp.send('Debugger.pause'), 5000, null);
      const at = await within(paused, 5000, null);
      stack = at?.callFrames?.map((f) => `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}:${(f.location.columnNumber ?? 0) + 1}`) ?? 'the debugger did not pause';
      await within(cdp.send('Debugger.resume'), 2000, null);
    } catch (e) {
      stack = `(${e.message.split('\n')[0]})`;
    }
  }
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(`${evidence}.json`, JSON.stringify({ at: new Date().toISOString(), url: page.url(), error, crashed, killed: crashed ? earlyoomKills(since) : null, now, seen, stack, console: consoleLines }, null, 1));
  if (!crashed) await within(page.screenshot({ path: `${evidence}.png`, timeout: 10_000 }), 12_000, null);
}

/**
 * One run of the harness at `url` (harness.html?game=...&auto=1): whether the hub's checks pass, and
 * the failed ones; `stalls`, the harness page's longest gap between frames and longest task (its
 * games share its thread). A page that crashes ends the run at once (`crashed`, `CRASHED`). A run
 * that fails, crashes or never finishes in `timeout` ms leaves what its page was doing at
 * `evidence` (a path without its extension: `.json`, and `.png` while the page lives), when given.
 */
export async function harness(browser, url, { timeout = 300_000, evidence = null } = {}) {
  const since = Date.now();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleLines = [];
  const note = (line) => {
    consoleLines.push(line);
    if (consoleLines.length > 400) consoleLines.splice(0, consoleLines.length - 400);
  };
  page.on('console', (m) => note(`${m.type()} ${m.location()?.url?.split('/').pop() ?? ''}: ${m.text()}`));
  page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
  let crashed = false;
  const crash = new Promise((resolve) =>
    page.once('crash', () => {
      crashed = true;
      note(`crash: ${CRASHED}`);
      resolve();
    }),
  );
  // the harness page's stalls: its longest gap between frames and its longest task
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const stalls = (window.__stalls = { frameGap: 0, task: 0, tasks: 0 });
    let last = -1;
    const tick = (t) => {
      if (last >= 0) stalls.frameGap = Math.max(stalls.frameGap, Math.round(t - last));
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          stalls.tasks++;
          stalls.task = Math.max(stalls.task, Math.round(e.duration));
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* no long task timing */
    }
  });
  // what the page is doing, read every few seconds while it runs: the evidence if it dies
  let seen = null;
  let reading = false;
  const read = setInterval(() => {
    if (reading || crashed) return;
    reading = true;
    page
      .evaluate(harnessState)
      .then((s) => (seen = { ...s, at: new Date().toISOString() }))
      .catch(() => {})
      .finally(() => (reading = false));
  }, 3000);
  try {
    let error = null;
    try {
      await Promise.race([
        (async () => {
          await page.goto(url);
          // polled on a timer, not on frames: a page that stopped drawing is still read
          await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout, polling: 500 });
        })(),
        crash.then(() => {
          throw new Error(CRASHED);
        }),
      ]);
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    const report = error ? null : await within(page.evaluate(() => window.__hubCheck), 10_000, null);
    const result =
      report && typeof report === 'object'
        ? { pass: report.pass, checks: report.checks.length, bad: report.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`) }
        : { pass: false, checks: 0, bad: [], error: error ?? 'the harness page gave no report' };
    if (crashed) result.crashed = true;
    result.stalls = crashed ? (seen?.stalls ?? null) : await within(page.evaluate(() => window.__stalls ?? null), 3000, null);
    if (!result.pass && evidence) {
      await capture(page, { consoleLines, seen, crashed, error: result.error ?? null, since }, evidence);
      result.evidence = evidence;
    }
    return result;
  } catch (e) {
    return { pass: false, checks: 0, bad: [], error: e.message.split('\n')[0], ...(crashed ? { crashed } : {}) };
  } finally {
    clearInterval(read);
    await within(page.close(), 10_000, null);
  }
}

/**
 * One harness run at `url` on a phone held upright with a touch screen: once a frame's round is on
 * (its card, the countdown, play) with the touch controls showing (the harness plays a round on the
 * keyboard, which steps them aside), whether ≡ (Escape) among them is hidden.
 */
export async function touchRound(browser, url) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.goto(url);
    for (let i = 0; i < 240; i++) {
      for (const frame of page.frames()) {
        const s = await frame
          .evaluate(() => {
            const e = window.__PIXEL_ENGINE__;
            const round = window.__RIFTLIGHT__?.game?.round;
            if (!e?.touch?.visible || !round) return null;
            const buttons = e.touch.rects().buttons;
            return { phase: round.phase, buttons: buttons.length, menu: buttons.find((b) => b.code === 'Escape')?.hidden ?? null, errors: e.errors };
          })
          .catch(() => null);
        if (s?.buttons) return { ok: s.menu === true && !s.errors.length, detail: `${s.phase}: ${s.buttons} buttons, ≡ hidden ${s.menu}${s.errors.length ? `, errors ${s.errors.join('; ')}` : ''}` };
      }
      await page.waitForTimeout(250);
    }
    return { ok: false, detail: 'no round showed its touch controls' };
  } catch (e) {
    return { ok: false, detail: e.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}

/** The vendored harness's files, copied next to the page it plays. */
export const HARNESS_FILES = ['harness.html', 'bridge.js', 'round.js'];

/**
 * Whether `harness` ends a run whose page's renderer dies at once, as a crash: a page that never
 * finishes, crashed through the debugger (`Page.crash`, as earlyoom's kill or an out-of-memory would).
 */
async function crashSeen(browser, dir, port) {
  await writeFile(new URL('stuck.html', dir), '<!doctype html><meta charset="utf-8"><title>stuck</title><body>A page that never finishes.</body>');
  const from = Date.now();
  const run = harness(browser, `http://localhost:${port}/stuck.html`, { timeout: 30_000 });
  let page = null;
  while (!page && Date.now() - from < 10_000) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('/stuck.html')) ?? null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  if (page) (await page.context().newCDPSession(page)).send('Page.crash').catch(() => {}); // it answers nothing: it is gone
  const r = await run;
  return !!page && r.crashed === true && r.error === CRASHED && Date.now() - from < 15_000;
}

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
      const r = await harness(browser, `http://localhost:${port}/harness.html?game=riftlight.html&${q}&auto=1`, { evidence: fileURLToPath(new URL(`evidence/${q.replace(/[^\w=-]+/g, '_').slice(0, 120)}`, dir)) });
      check(r.pass, `${q}: ${r.error ? `the harness ran (${r.error})` : `the hub's checks pass (${r.checks})${r.bad.length ? '\n    ' + r.bad.join('\n    ') : ''}`}${r.evidence ? `\n    what the page was doing: ${r.evidence}.json` : ''}`);
    }
    // a round on a phone, its touch controls on: no ≡ (a round has no pause menu: the hub's bar is the menu there)
    const round = await touchRound(browser, `http://localhost:${port}/harness.html?game=${encodeURIComponent('riftlight.html?touch=1')}&mode=moments&moment=${offer.moments[0]}&players=1&play=8000&auto=1`);
    check(round.ok, `a round of moments on a phone with touch controls: ≡ hidden (${round.detail})`);
    check(await crashSeen(browser, dir, port), 'a harness page whose renderer dies ends its run at once, as a crash (Playwright never notices one: it would sit out its timeout)');
  } finally {
    await browser.close();
    server.close();
  }
}
