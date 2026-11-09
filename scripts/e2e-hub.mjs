// e2e suite `hub`: the AI Hub's own session harness (scripts/hub/harness/, vendored unmodified)
// plays the built page in every session mode, as the hub does when a game joins its library
// (docs/game/session.md): parallel, ghost and a shared world on a lossy network, a host leaving,
// a server with no player of its own. Each page is `npm run build:single -- --mode <mode>`.
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from 'playwright-core';
import { WEBGPU_ARGS } from './browser.mjs';

const NET = 'latency=150&jitter=50&loss=5';

/** What the hub runs on a game when it joins, per mode (a shortened set: every check still runs). */
export const HUB_RUNS = [
  ['parallel', 'players=2'],
  ['ghost', `players=4&${NET}`],
  ['shared-world', `players=4&${NET}`],
  ['shared-world', `players=4&${NET}&scenario=host-leave`],
  ['shared-world', 'players=2&scenario=server'],
];

/** The runs the protocol's *Test it* names for a page in `mode`: what the hub runs when it joins. */
export function protocolRuns(mode) {
  const runs = ['players=2'];
  if (mode === 'ghost' || mode === 'shared-world') runs.push(`players=4&${NET}`, `players=4&${NET}&scenario=host-leave`);
  if (mode === 'shared-world') runs.push('players=2&scenario=server');
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
    await page.waitForFunction(() => document.body.dataset.complete === 'true', null, { timeout: 180_000 });
    const report = await page.evaluate(() => window.__hubCheck);
    return { pass: report.pass, checks: report.checks.length, bad: report.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`) };
  } catch (e) {
    return { pass: false, checks: 0, bad: [], error: e.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

export async function runHub({ exe, root, check, run, tail, port = 4790 }) {
  console.log('\n▶ hub: the AI Hub session harness, every mode');
  const dir = new URL('.scratch/hub/', root);
  await mkdir(dir, { recursive: true });
  for (const f of ['harness.html', 'bridge.js', 'round.js']) await copyFile(new URL(`scripts/hub/harness/${f}`, root), new URL(f, dir));
  for (const mode of new Set(HUB_RUNS.map(([m]) => m))) {
    const built = await run('npm', ['run', '--silent', 'build:single', '--', '--mode', mode, '--out', `.scratch/hub/rl-${mode}.html`]);
    check(built.code === 0, `build:single --mode ${mode}${built.code ? ':\n    ' + tail(built.out) : ''}`);
  }
  const server = await serve(dir, port);
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: WEBGPU_ARGS });
  try {
    for (const [mode, q] of HUB_RUNS) {
      const r = await harness(browser, `http://localhost:${port}/harness.html?game=rl-${mode}.html&${q}&auto=1`);
      check(r.pass, `${mode} ${q}: ${r.error ? `the harness ran (${r.error})` : `the hub's checks pass (${r.checks})${r.bad.length ? '\n    ' + r.bad.join('\n    ') : ''}`}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}
