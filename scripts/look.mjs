// npm run look: play a page of the build in the real renderer and look at it, in one command.
//
//   npm run look -- "<query or URL>" [--keys KeyD*60,Space*4] [--out dir] [check.mjs options]
//
//   npm run look -- "?game=riftlight"                    the game at /, as a player opens it
//   npm run look -- "?game=world&room=physics" --keys KeyW*60
//   npm run look -- "asset-lab.html?model=crate"         any page of the build, with its query
//   npm run look -- http://localhost:5173/?game=arena     a page someone already serves
//
// It serves the build (`vite preview` of dist/: run `npm run build` first, and again after an
// edit; it says so when src/ is newer than the build) on LOOK_PORT (default: a free one from 4600),
// then runs the engine kit's check.mjs (scripts/bundle/check.mjs) on the page in the repo's
// headless Chromium: it waits for the engine, holds --keys (default: 90 idle frames), writes a PNG
// of the frame and report.json (engine.state(), errors, warnings) to --out (default
// .scratch/look), and exits 1 if the page logged an error, the engine reported one or the frame
// is blank. Other options pass through to check.mjs: --cameras, --looks noir,snes, --size 960x540.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headlessShell } from './browser.mjs';
import { helpExit } from './manual.mjs';
import { startServer } from './page.mjs';

helpExit(import.meta.url);

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const VALUED = new Set(['--keys', '--out', '--looks', '--size']);
const pass = [];
const targets = [];
let out = '.scratch/look';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') out = argv[++i] ?? out;
  else if (VALUED.has(a)) pass.push(a, argv[++i] ?? '');
  else if (a.startsWith('--')) pass.push(a);
  else targets.push(a);
}
if (targets.length !== 1) {
  console.error(`look: one page to look at (got ${targets.length ? targets.join(' ') : 'none'}): npm run look -- "?game=riftlight" (npm run look -- help)`);
  process.exit(2);
}
const target = targets[0];

/** Newest modification time under a directory (ms). */
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

let server = null;
let url = target;
if (!/^https?:\/\//.test(target)) {
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    console.error('look: no build to serve (dist/index.html): run npm run build first');
    process.exit(2);
  }
  const built = statSync(join(ROOT, 'dist/index.html')).mtimeMs;
  if (newest(join(ROOT, 'src')) > built) console.warn('look: src/ has changed since the last build: this is the build, run npm run build to look at your edits');
  const port = Number(process.env.LOOK_PORT) || 4600 + Math.floor(Math.random() * 400);
  try {
    server = await startServer({ port, mode: 'preview', portEnv: 'LOOK_PORT', timeout: 30000 });
  } catch (e) {
    console.error(`look: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  // `?game=…` is index.html's: named so, check.mjs calls its PNG index.png
  const path = target.replace(/^\//, '');
  url = server.url + (path === '' || path.startsWith('?') ? `index.html${path}` : path);
}

const env = { ...process.env };
const shell = headlessShell();
if (shell) env.CHROMIUM_PATH = shell;
const check = spawn(process.execPath, [join(ROOT, 'scripts/bundle/check.mjs'), url, '--out', resolve(ROOT, out), ...pass], { cwd: ROOT, stdio: 'inherit', env });
// stopped (Ctrl-C, a timeout): the check stops too, not on against a server that's gone
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => check.kill(sig));
const code = await new Promise((r) => check.on('exit', (c, sig) => r(c ?? (sig ? 1 : 0))));
server?.stop();
process.exit(code);
