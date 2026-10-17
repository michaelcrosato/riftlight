/* global window */
// Pages for the agent tools (the e2e suites, film, playtest, gate-b, look): one way to serve
// this repo and open a page on it.
//
//   const server = await startServer({ port, mode: 'preview' })   // or 'dev'
//   const browser = await launchChromium()                        // scripts/browser.mjs
//   const { page, logs } = await openPage(browser, `${server.url}?game=riftlight`)
//   ...                                                           // the engine is ready here
//   await browser.close(); server.stop()
//
// Servers: `dev` is the vite dev server, for tools that must show source after an edit (film,
// playtest); `preview` serves the build in dist/ (`npm run build`), for e2e, gate-b and look.
// Either runs on the given port with --strictPort, and a port that already answers is refused:
// whatever answers there would be tested instead of this code.
//
// Readiness: on a page with an engine, openPage (and gotoReady) wait for window.__PIXEL_READY__,
// the engine's one readiness signal (a promise that resolves once Engine.start has finished, with
// __PIXEL_ENGINE__ and the game's own handles such as __RIFTLIGHT__ and __WORLD__ set; it rejects
// with the reason a start failed). A failed start fails at once with that reason; a page whose
// engine never appears fails 5 s after its first page error, or at the timeout. Pages without an
// engine (tree.html) pass `engine: false`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Software GL chatter from the rasterizer (ANGLE/SwiftShader performance notes), not app output. */
export const ENVIRONMENT_NOISE = [/GL Driver Message \(OpenGL, Performance/];

/**
 * Start vite on `port` (`mode` 'dev' or 'preview'), wait until `probe` answers, and return
 * `{ port, url, proc, stop() }`. `env` adds to the server's environment; `portEnv` names the
 * variable that picks another port, for the refusal message.
 */
export async function startServer({ port, mode = 'preview', env = {}, probe = '', timeout = 60000, portEnv = '' } = {}) {
  if (!(port > 0)) throw new Error(`startServer needs a port (got ${port})`);
  const url = `http://localhost:${port}/`;
  // Something already answering on the port would be tested instead of this code (e.g. a
  // leftover preview server from another checkout): refuse rather than test the wrong code.
  const taken = await fetch(url).then(() => true, () => false);
  if (taken) throw new Error(`port ${port} is already serving something; stop it${portEnv ? ` or set ${portEnv}` : ''}`);
  if (mode === 'preview' && !existsSync(`${ROOT}dist/index.html`)) throw new Error('no build to serve (dist/index.html): run npm run build first');
  const args = mode === 'dev' ? ['vite', '--port', String(port), '--strictPort'] : ['vite', 'preview', '--port', String(port), '--strictPort'];
  // detached: its own process group, so stop() ends npx *and* the vite it starts (killing npx
  // alone left vite running, holding the port)
  const proc = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: { ...process.env, ...env } });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  let exited = null;
  proc.on('exit', (code) => (exited = code ?? 'signal'));
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    process.off('exit', stop);
    for (const sig of ['SIGINT', 'SIGTERM']) process.off(sig, onSignal);
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill();
    }
  };
  // a tool that exits (or is interrupted) without stopping its server still takes it down
  function onSignal(sig) {
    stop();
    if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
  }
  process.once('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, onSignal);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && exited === null) {
    try {
      if ((await fetch(url + probe)).ok) return { port, url, proc, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  stop();
  const why = exited !== null ? `exited (${exited})` : `did not answer within ${timeout / 1000} s`;
  throw new Error(`vite ${mode === 'dev' ? 'dev server' : 'preview'} on port ${port} ${why}${stderr.trim() ? `:\n${stderr.trim()}` : ''}`);
}

/**
 * Collect a page's errors as lines (`error: …`, `pageerror: …`), and its warnings too when
 * `warnings` (`warning: …`), except those matching `allow` or ENVIRONMENT_NOISE. With `fresh`, a
 * new document (a reload: the dev server still bundling) starts the list again.
 */
export function watchConsole(page, { warnings = false, allow = [], fresh = false } = {}) {
  const logs = [];
  if (fresh) page.on('framenavigated', (f) => f === page.mainFrame() && (logs.length = 0));
  const quiet = [...ENVIRONMENT_NOISE, ...allow];
  page.on('console', (m) => {
    const type = m.type();
    if (type !== 'error' && !(warnings && type === 'warning')) return;
    if (type === 'warning' && quiet.some((re) => re.test(m.text()))) return;
    logs.push(`${type}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  return logs;
}

const seconds = (ms) => `${Math.round(ms / 1000)} s`;
const navigated = (e) => /Execution context was destroyed|navigat|Target page, context or browser has been closed/i.test(String(e?.message ?? e));

/**
 * Wait for window.__PIXEL_READY__ to resolve. Throws the start's own reason when it rejects;
 * when it never appears, 5 s after a page error in `logs` (a module that failed to load) or at
 * `timeout`. A reload while waiting (the dev server re-bundling) waits for the new page.
 */
export async function engineReady(page, { timeout = 90000, logs = [] } = {}) {
  const deadline = Date.now() + timeout;
  let firstError = 0;
  // the engine module sets the promise when it loads
  for (;;) {
    const there = await page.evaluate(() => !!window.__PIXEL_READY__).catch((e) => (navigated(e) ? false : Promise.reject(e)));
    if (there) break;
    if (!firstError && logs.some((l) => l.startsWith('pageerror'))) firstError = Date.now();
    if (firstError && Date.now() - firstError > 5000) throw new Error(`the engine never loaded on ${page.url()}:\n  ${logs.join('\n  ')}`);
    if (Date.now() > deadline) throw new Error(`no window.__PIXEL_READY__ on ${page.url()} after ${seconds(timeout)}: the page has no engine (open it with engine: false) or never loaded it`);
    await new Promise((r) => setTimeout(r, 100));
  }
  for (;;) {
    const left = deadline - Date.now();
    let r;
    try {
      r = await page.evaluate(
        (ms) =>
          Promise.race([
            window.__PIXEL_READY__.then(
              () => ({ status: 'ready' }),
              (e) => ({ status: 'failed', message: e instanceof Error ? e.message : String(e) }),
            ),
            new Promise((res) => setTimeout(() => res({ status: 'timeout' }), Math.max(0, ms))),
          ]),
        left,
      );
    } catch (e) {
      if (!navigated(e) || Date.now() > deadline) throw e;
      await page.waitForFunction(() => !!window.__PIXEL_READY__, null, { timeout: Math.max(1, deadline - Date.now()) });
      continue;
    }
    if (r.status === 'ready') return;
    if (r.status === 'failed') throw new Error(`engine failed to start: ${r.message}`);
    throw new Error(`engine not ready after ${seconds(timeout)} on ${page.url()} (window.__PIXEL_READY__ never resolved)${logs.length ? `:\n  ${logs.join('\n  ')}` : ''}`);
  }
}

/** `page.goto(url)`, then (unless `engine: false`) wait for the engine as engineReady does. */
export async function gotoReady(page, url, { engine = true, timeout = 90000, logs = [] } = {}) {
  await page.goto(url);
  if (engine) await engineReady(page, { timeout, logs });
}

/**
 * A new page in `browser` (launchChromium in scripts/browser.mjs): its console errors (and
 * warnings, with `warnings`) collected in `logs`, `url` opened and, unless `engine: false`, the
 * engine ready. Other options go to `browser.newPage` (viewport, hasTouch, …;
 * deviceScaleFactor defaults to 1). Returns `{ page, logs }`.
 */
export async function openPage(browser, url, { engine = true, timeout = 90000, warnings = false, allow = [], fresh = false, ...pageOptions } = {}) {
  const page = await browser.newPage({ deviceScaleFactor: 1, ...pageOptions });
  const logs = watchConsole(page, { warnings, allow, fresh });
  await gotoReady(page, url, { engine, timeout, logs });
  return { page, logs };
}
