// e2e suite `hub`: 52in1's own session harness (scripts/hub/harness/, vendored unmodified) plays the
// built page in every online mode its hub:multiplayer names, as the hub does when a game joins its
// library (docs/game/session.md): a shared world co-op and versus, ghost, parallel and moments, on a
// lossy network, with a host leaving and a server with no player of its own. One page offers every
// mode (`npm run build:single`); `&mode=` and `&how=` pick the one a run plays, `&moment=` the moments.
// Then a round of moments on a phone held upright with its touch controls: no ≡ in a round.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
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

/**
 * Resolves to `promise`'s value (its error's first line, in brackets, if it fails), or to `fallback`
 * after `ms`, timed in Node: a page whose thread is stuck never answers, and Playwright's own
 * timeouts wait on it (1.56's `waitForFunction` sat out minutes past its timeout on a busy page).
 */
const within = (promise, ms, fallback) => {
  let timer;
  return Promise.race([promise.catch((e) => `(${e.message.split('\n')[0]})`), new Promise((r) => (timer = setTimeout(() => r(fallback), ms)))]).finally(() => clearTimeout(timer));
};

/**
 * How long each read of a failed run's page may take (`capture`), in ms: its state, whether it
 * draws, its debugger pausing it, the state where it paused, letting it go, its picture, closing it.
 */
const BOUNDS = { state: 8000, drawing: 3000, pause: 5000, paused: 5000, evaluate: 5000, release: 4000, picture: 12_000, close: 10_000 };

/** The longest a run lasts past its timeout: its stalls read (3 s), then every read of `capture`. */
export const CAPTURE_MS = 3000 + Object.values(BOUNDS).reduce((a, b) => a + b, 0);

/** A run that never finished in its timeout, timed in Node (the page may be too busy to answer Playwright's own waits). */
export const UNFINISHED = 'the harness page did not finish in its timeout';

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
 * The page's debugger, enabled before its run: a thread stuck later can still be paused (one
 * enabled once the thread is stuck never answers: enabling waits on the thread, pausing doesn't).
 * It never stops the run itself (`setSkipAllPauses`: a `debugger` statement goes by). Null if the
 * browser gives none.
 */
async function debuggerOf(page) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const scripts = new Map(); // script id → its page (a paused frame names only the id)
    cdp.on('Debugger.scriptParsed', (e) => scripts.set(e.scriptId, e.url));
    await cdp.send('Debugger.enable', { maxScriptsCacheSize: 0 }); // no sources of collected scripts kept: a harness page is a big process already
    await cdp.send('Debugger.setSkipAllPauses', { skip: true });
    return { cdp, scripts };
  } catch {
    return null;
  }
}

/**
 * A stuck thread paused by its debugger (`debuggerOf`, each step bounded): where its script is (the
 * stack, innermost first), the harness's state read where it stopped, and the script then ended
 * (`Runtime.terminateExecution`: the page answers again, for its picture). `stack` says so, in
 * words, when there is no debugger or the thread did not pause.
 */
async function pauseStuck(debug) {
  if (!debug) return { stack: 'no debugger: the page had none from its start, so its stuck thread could not be paused', state: null };
  const { cdp, scripts } = debug;
  const paused = new Promise((r) => cdp.once('Debugger.paused', r));
  cdp.send('Debugger.setSkipAllPauses', { skip: false }).catch(() => {}); // the thread reads it with the pause, in order
  const sent = await within(cdp.send('Debugger.pause'), BOUNDS.pause, `no answer in ${BOUNDS.pause / 1000} s`);
  const at = await within(paused, BOUNDS.paused, null);
  if (!at?.callFrames) return { stack: `the thread did not pause in ${(BOUNDS.pause + BOUNDS.paused) / 1000} s (Debugger.pause: ${typeof sent === 'string' ? sent : 'sent'})`, state: null };
  const where = (f) => (scripts.get(f.location.scriptId) || f.url || '?').split('/').pop();
  const stack = at.callFrames.map((f) => `${f.functionName || '(anonymous)'} ${where(f)}:${f.location.lineNumber + 1}:${(f.location.columnNumber ?? 0) + 1}`);
  const read = await within(cdp.send('Runtime.evaluate', { expression: `(${harnessState})()`, returnByValue: true }), BOUNDS.evaluate, null);
  const state = read && typeof read === 'object' && read.result?.value && typeof read.result.value === 'object' ? read.result.value : null;
  await within(
    cdp.send('Debugger.resume').then(() => cdp.send('Runtime.terminateExecution')),
    BOUNDS.release,
    null,
  );
  return { stack, state };
}

/**
 * What a harness page was doing when its run failed or never finished, written to `<evidence>.json`
 * (and a picture, `<evidence>.png`, while the page lives): its state now, or when it is gone the
 * last state read while it ran (`seen`); whether it still draws; the console of every frame. When
 * its thread is stuck (`stuck`: a frame's script in a loop; the frames share the harness's
 * thread), the debugger enabled at the run's start (`debuggerOf`) pauses it: where its script is
 * (`stack`, or why there is none), and the state read where it stopped. Every read is bounded
 * (`BOUNDS`): a stuck page never holds the run.
 */
async function capture(page, debug, { consoleLines, seen, crashed, error, since }, evidence) {
  let now = crashed ? 'the page crashed' : await within(page.evaluate(harnessState), BOUNDS.state, `the page did not answer in ${BOUNDS.state / 1000} s`);
  const stuck = !crashed && typeof now === 'string';
  let stack = null;
  if (stuck) {
    const at = await pauseStuck(debug);
    stack = at.stack;
    if (at.state) now = { ...at.state, drawing: false, pausedAt: stack[0] ?? null };
  } else if (now && typeof now === 'object') {
    // whether the page still draws: the harness's checks wait on timers, its games on frames
    now.drawing = await within(page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => r(true))), new Promise((r) => setTimeout(() => r(false), 1000))])), BOUNDS.drawing, null);
  }
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(`${evidence}.json`, JSON.stringify({ at: new Date().toISOString(), url: page.url(), error, crashed, killed: crashed ? earlyoomKills(since) : null, stuck, now, seen, stack, console: consoleLines }, null, 1));
  if (!crashed) await within(page.screenshot({ path: `${evidence}.png`, timeout: BOUNDS.picture - 2000 }), BOUNDS.picture, null);
}

/**
 * One run of the harness at `url` (harness.html?game=...&auto=1): whether the hub's checks pass, and
 * the failed ones; `stalls`, the harness page's longest gap between frames and longest task (its
 * games share its thread). A page that crashes ends the run at once (`crashed`, `CRASHED`); one
 * that never finishes ends it at `timeout` ms, timed in Node (`UNFINISHED`: a page whose thread is
 * stuck never answers Playwright's own waits), at most `CAPTURE_MS` later. A run that fails leaves
 * what its page was doing at `evidence` (a path without its extension: `.json`, and `.png` while
 * the page lives), when given (`capture`). A browser that is gone (`isConnected()` false) fails the
 * run with its error: it never throws.
 */
export async function harness(browser, url, { timeout = 300_000, evidence = null } = {}) {
  const since = Date.now();
  const consoleLines = [];
  const note = (line) => {
    consoleLines.push(line);
    if (consoleLines.length > 400) consoleLines.splice(0, consoleLines.length - 400);
  };
  let page = null;
  let crashed = false;
  let read = null;
  let timer = null;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (m) => note(`${m.type()} ${m.location()?.url?.split('/').pop() ?? ''}: ${m.text()}`));
    page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
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
    const debug = evidence ? await within(debuggerOf(page), 10_000, null) : null;
    // what the page is doing, read every few seconds while it runs: the evidence if it dies
    let seen = null;
    let reading = false;
    read = setInterval(() => {
      if (reading || crashed) return;
      reading = true;
      page
        .evaluate(harnessState)
        .then((s) => (seen = { ...s, at: new Date().toISOString() }))
        .catch(() => {})
        .finally(() => (reading = false));
    }, 3000);
    let error = null;
    const finished = (async () => {
      await page.goto(url, { timeout });
      // polled on a timer, not on frames: a page that stopped drawing is still read
      await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout, polling: 500 });
    })();
    finished.catch(() => {}); // it may settle long after the run ends (a busy page's waits outlast their timeout)
    try {
      await Promise.race([
        finished,
        crash.then(() => {
          throw new Error(CRASHED);
        }),
        // timed in Node: Playwright's waits on a page whose thread is stuck never time out
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${UNFINISHED} (${timeout / 1000} s)`)), timeout))),
      ]);
    } catch (e) {
      error = e.message.split('\n')[0];
    } finally {
      clearTimeout(timer);
    }
    const report = error ? null : await within(page.evaluate(() => window.__hubCheck), 10_000, null);
    const result =
      report && typeof report === 'object'
        ? { pass: report.pass, checks: report.checks.length, bad: report.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`) }
        : { pass: false, checks: 0, bad: [], error: error ?? 'the harness page gave no report' };
    if (crashed) result.crashed = true;
    result.stalls = crashed ? (seen?.stalls ?? null) : await within(page.evaluate(() => window.__stalls ?? null), 3000, null);
    if (!result.pass && evidence) {
      await capture(page, debug, { consoleLines, seen, crashed, error: result.error ?? null, since }, evidence);
      result.evidence = evidence;
    }
    return result;
  } catch (e) {
    return { pass: false, checks: 0, bad: [], error: e.message.split('\n')[0], ...(crashed ? { crashed } : {}) };
  } finally {
    clearInterval(read);
    clearTimeout(timer);
    if (page) await within(page.close(), BOUNDS.close, null);
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
 * Harness runs' browser, launched again when it is gone (`isConnected()` false: a run's
 * out-of-memory kill can take the whole browser, not only its page). `get()` before each run;
 * `launches` counts the browsers it started.
 */
export function harnessBrowser(launch) {
  let browser = null;
  let launches = 0;
  return {
    get launches() {
      return launches;
    },
    async get() {
      if (browser?.isConnected()) return browser;
      await browser?.close().catch(() => {});
      browser = await launch();
      launches++;
      return browser;
    },
    async close() {
      await browser?.close().catch(() => {});
      browser = null;
    },
  };
}

/** A page whose script loops for ever, a while after it loads: its thread never answers again. */
const BUSY_PAGE = `<!doctype html><meta charset="utf-8"><title>busy</title><body>A page whose script loops for ever.<script>
function spin() { for (;;) {} }
setTimeout(function stuck() { spin(); }, 500);
</script>`;

/**
 * Whether `harness` ends a run whose page's thread is stuck (a script in a loop: Playwright's own
 * waits never time out on it) at its timeout, timed in Node, within `CAPTURE_MS` more, and leaves
 * evidence that says so: `stuck`, and the stack where the debugger paused it (`spin`, in the page).
 */
async function busySeen(browser, dir, port) {
  await writeFile(new URL('busy.html', dir), BUSY_PAGE);
  const evidence = fileURLToPath(new URL('checks/busy', dir)); // not in evidence/: CI keeps that for runs that failed
  await rm(`${evidence}.json`, { force: true });
  const timeout = 8000;
  const from = Date.now();
  const r = await within(harness(browser, `http://localhost:${port}/busy.html`, { timeout, evidence }), timeout + CAPTURE_MS + 5000, null);
  const took = Date.now() - from;
  const json = await readFile(`${evidence}.json`, 'utf8').then(JSON.parse, () => null);
  const top = Array.isArray(json?.stack) ? json.stack[0] : json?.stack;
  const pass = !!r && took <= timeout + CAPTURE_MS && r.error?.startsWith(UNFINISHED) && json?.stuck === true && /^spin busy\.html:2:/.test(top ?? '');
  return { pass, detail: `${r ? `ended in ${(took / 1000).toFixed(1)} s (${r.error})` : `still running after ${(took / 1000).toFixed(0)} s`}; its evidence: ${json ? `stuck ${json.stuck}, paused at ${top ?? 'nothing'}` : 'none'}` };
}

/**
 * Whether a harness browser that dies fails only the run it was in: `harness` on a closed browser
 * returns its error (never throws), and `harnessBrowser` launches a new one for the next run.
 */
async function deadBrowserSeen(browsers, port) {
  const dead = await browsers.get();
  await dead.close();
  const r = await harness(dead, `http://localhost:${port}/busy.html`, { timeout: 5000 });
  const next = await browsers.get();
  return { pass: r.pass === false && /closed/.test(r.error ?? '') && next !== dead && next.isConnected(), detail: `the run: ${r.error ?? 'passed'}; the next: ${next !== dead && next.isConnected() ? 'a new browser' : 'no new browser'}` };
}

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

/**
 * `harness`'s own checks, on pages that fail on purpose (served from `dir` at `port`): a page whose
 * thread is stuck, a browser that dies, a page whose renderer dies. Each ends its run in a bounded
 * time, and never takes the tool down.
 */
export async function harnessChecks(browsers, dir, port, check) {
  const busy = await busySeen(await browsers.get(), dir, port);
  check(busy.pass, `a harness page whose thread is stuck ends its run at its timeout, timed in Node (Playwright's waits never time out on it), and its evidence says where it is stuck: ${busy.detail}`);
  const dead = await deadBrowserSeen(browsers, port);
  check(dead.pass, `a harness browser that dies fails only its run (an error, not a crash of the tool), and the next run has a new one: ${dead.detail}`);
  check(await crashSeen(await browsers.get(), dir, port), 'a harness page whose renderer dies ends its run at once, as a crash (Playwright never notices one: it would sit out its timeout)');
}

/** Where the `hub` suite's runs that fail leave their evidence (CI keeps it: ci.yml's e2e job). */
export const EVIDENCE = '.scratch/hub/evidence/';

/**
 * An empty evidence folder at `dir` (a path): an earlier run's evidence is gone, so a green run
 * leaves none behind. Returns where the run `query`, the `index`th of its set (from 0), leaves its
 * evidence there (`harness`'s `evidence`): the run's number first, as a long query cut to a short
 * file name can name two runs alike (moments' runs differ after their every moment).
 */
export async function evidenceFolder(dir) {
  await rm(dir, { recursive: true, force: true });
  return (index, query) => join(dir, `${String(index + 1).padStart(2, '0')}-${query.replace(/[^\w=-]+/g, '_').slice(0, 120)}`);
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
  const browsers = harnessBrowser(() => chromium.launch({ executablePath: exe, headless: true, args: WEBGPU_ARGS }));
  const evidenceOf = await evidenceFolder(fileURLToPath(new URL(EVIDENCE, root)));
  try {
    for (const [i, q] of protocolRuns(offer, { full: false }).entries()) {
      const evidence = evidenceOf(i, q);
      const r = await harness(await browsers.get(), `http://localhost:${port}/harness.html?game=riftlight.html&${q}&auto=1`, { evidence });
      check(r.pass, `${q}: ${r.error ? `the harness ran (${r.error})` : `the hub's checks pass (${r.checks})${r.bad.length ? '\n    ' + r.bad.join('\n    ') : ''}`}${r.evidence ? `\n    what the page was doing: ${r.evidence}.json` : ''}`);
    }
    // a round on a phone, its touch controls on: no ≡ (a round has no pause menu: the hub's bar is the menu there)
    const round = await touchRound(await browsers.get(), `http://localhost:${port}/harness.html?game=${encodeURIComponent('riftlight.html?touch=1')}&mode=moments&moment=${offer.moments[0]}&players=1&play=8000&auto=1`);
    check(round.ok, `a round of moments on a phone with touch controls: ≡ hidden (${round.detail})`);
    await harnessChecks(browsers, dir, port, check);
  } finally {
    await browsers.close();
    server.close();
  }
}
