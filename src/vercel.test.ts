// Vercel deploys main only, and only when a commit changed what `npm run build` reads
// (vercel.json, scripts/vercel-ignore.sh; CLAUDE.md, "Deploying to Vercel"). A skipped change the
// site is built from would leave it stale, and a built change it isn't wastes a stored deployment.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' }).trim();
let writes = 0; // each write's content differs, so every change is a diff
const write = (path: string) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), `${path} ${++writes}\n`);
};

// One commit on a repo holding a file at every path below, then the script's verdict on it.
const SEEDED = ['index.html', 'src/a.ts', 'public/x.json', 'docs/GUIDE.md', 'docs/GUIDE-ASSETS.md', 'docs/notes.txt', 'README.md'];
git('init', '-q', '-b', 'main');
for (const p of SEEDED) write(p);
mkdirSync(join(repo, 'scripts'));
cpSync(join(root, 'scripts/vercel-ignore.sh'), join(repo, 'scripts/vercel-ignore.sh'));
git('add', '-A');
git('commit', '-q', '-m', 'seed');
const seed = git('rev-parse', 'HEAD');

function verdict(changed: string[], env: Record<string, string> = {}): 'build' | 'skip' {
  git('checkout', '-q', '-B', 'main', seed);
  for (const p of changed) write(p);
  if (changed.length) {
    git('add', '-A');
    git('commit', '-q', '-m', 'change');
  }
  const run = spawnSync('sh', ['scripts/vercel-ignore.sh'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: seed, ...env },
  });
  expect([0, 1], run.stderr + run.stdout).toContain(run.status);
  return run.status === 0 ? 'skip' : 'build';
}

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('Vercel', () => {
  it('deploys main only', () => {
    const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { git: { deploymentEnabled: Record<string, boolean> }; ignoreCommand: string };
    expect(config.git.deploymentEnabled).toEqual({ '**': false, main: true });
    expect(config.ignoreCommand).toBe('sh scripts/vercel-ignore.sh');
    expect(verdict(['src/a.ts'], { VERCEL_GIT_COMMIT_REF: 'claude/topic' })).toBe('skip');
  });

  it('builds what the site is built from', () => {
    for (const p of ['src/a.ts', 'src/new.ts', 'public/x.json', 'index.html', 'lab.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'CHANGELOG.md', 'LICENSE', 'scripts/bundle.mjs', 'scripts/bundle/guide.mjs', 'scripts/packs.ts', 'docs/GUIDE.md', 'docs/GUIDE-ASSETS.md', 'vercel.json']) {
      expect(verdict([p]), p).toBe('build');
    }
    expect(verdict(['src/a.test.ts', 'src/a.ts'])).toBe('build');
  });

  it('skips what it is not', () => {
    for (const p of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/notes.txt', 'src/a.test.ts', 'scripts/e2e-world.mjs', '.github/workflows/ci.yml', '.claude/rules/x.md', '.vscode/x.json', 'scripts/ci/x.mjs', 'scripts/release/x.mjs', 'scripts/check.sh', 'scripts/session-start.sh', 'scripts/configure-github.sh', 'scripts/forbidden-apis.mjs', 'eslint.config.js']) {
      expect(verdict([p]), p).toBe('skip');
    }
  });

  it('builds when it cannot tell', () => {
    expect(verdict(['README.md'], { VERCEL_GIT_PREVIOUS_SHA: '' })).toBe('build');
    expect(verdict(['src/a.ts'], { VERCEL_GIT_COMMIT_REF: '' })).toBe('build'); // a deployment made without git
    expect(verdict(['README.md'], { VERCEL_GIT_PREVIOUS_SHA: '0123456789abcdef0123456789abcdef01234567' })).toBe('build');
  });
});
