// CI's revert-red-main job (scripts/ci/revert-red-main.sh) puts a red main back with the job's
// GITHUB_TOKEN, and GitHub refuses that token a push that changes .github/workflows/ (#178). Run for
// real, against a bare origin with a stand-in `gh` first on PATH: a red commit's workflow changes
// stay as main has them and are named in the PR, the commit and the issue; one that changes only
// workflows pushes nothing and asks for an issue; any other commit reverts as it always did.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/ci/revert-red-main.sh', import.meta.url));
const WORKFLOW = '.github/workflows/x.yml';
const REPO = 'owner/repo';
const PR_URL = `https://github.com/${REPO}/pull/2`;
const RUN_URL = `https://github.com/${REPO}/actions/runs/1`;

// The stand-in gh logs every call (args end in \x1f, calls in \x1e) and a --body-file's text, and
// answers what the script reads: the parent's CI passed, the commit has no PR, pr create's URL.
const GH = `#!/usr/bin/env bash
{ printf '%s\\037' "$@"; printf '\\036'; } >> "$GH_LOG"
prev=
for a in "$@"; do if [ "$prev" = --body-file ]; then cat "$a" > "$GH_LOG.body"; fi; prev=$a; done
case "$*" in
  "api repos/"*"/actions/workflows/"*) echo success ;;
  "pr create "*) echo ${PR_URL} ;;
esac
`;

/** The environment without any GIT_* a caller (a hook) set, so git never reaches past the temp dir. */
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * A main with a green parent, then the red commit writing `red` (path → text), then a later commit
 * main moved on with; the script runs on main's tip as CI's checkout has it.
 */
function revertRed(red: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'revert-red-main-'));
  dirs.push(dir);
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  const run = (cmd: string, args: string[], cwd: string, extra: Record<string, string> = {}) => {
    const r = spawnSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    return { status: r.status, out: r.stdout.trim(), err: r.stderr };
  };
  const git = (...args: string[]) => {
    const r = run('git', args, work);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.err}`);
    return r.out;
  };
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    }
  };
  const commit = (subject: string, files: Record<string, string>) => {
    write(files);
    git('add', '-A');
    git('commit', '-q', '-m', subject);
    return git('rev-parse', 'HEAD');
  };
  run('git', ['init', '-q', '--bare', '-b', 'main', origin], dir);
  run('git', ['init', '-q', '-b', 'main', work], dir);
  git('config', 'user.name', 'dev');
  git('config', 'user.email', 'dev@example.com');
  git('remote', 'add', 'origin', origin);
  commit('feat: green parent', { 'game.txt': 'v1\n', [WORKFLOW]: 'on: push\n' });
  const sha = commit('feat: the red one', red);
  commit('docs: main moved on', { 'later.txt': 'later\n' });
  git('push', '-q', 'origin', 'main');

  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const log = join(dir, 'gh.log');
  const output = join(dir, 'github-output');
  const result = run('bash', [script], work, {
    PATH: `${bin}:${env.PATH}`,
    GH_TOKEN: 'token',
    GH_REPO: REPO,
    BASE: 'main',
    SHA: sha,
    RUN_URL,
    GH_LOG: log,
    GITHUB_OUTPUT: output,
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').split('\x1e').filter(Boolean).map((c) => c.split('\x1f').slice(0, -1))
    : [];
  const call = (...head: string[]) => calls.find((c) => head.every((h, i) => c[i] === h));
  const branch = `claude/revert-${sha.slice(0, 7)}`;
  const pushed = (path: string) => {
    const r = run('git', ['show', `${branch}:${path}`], origin);
    return r.status === 0 ? `${r.out}\n` : null;
  };
  return {
    sha,
    result,
    call,
    pushed,
    branches: run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], origin).out.split('\n'),
    /** What the pushed revert changes against main. */
    changed: () => run('git', ['diff', '--name-only', 'main', branch], origin).out.split('\n').filter(Boolean),
    message: () => run('git', ['log', '-1', '--format=%B', branch], origin).out,
    body: () => (existsSync(`${log}.body`) ? readFileSync(`${log}.body`, 'utf8') : ''),
    /** The value after `flag` in a call. */
    arg: (c: string[] | undefined, flag: string) => c?.[c.indexOf(flag) + 1] ?? '',
    output: () => readFileSync(output, 'utf8'),
    branch,
  };
}

describe('revert-red-main', () => {
  it('reverts all but the .github/workflows/ changes, which stay as main has them and are named', () => {
    const red = { 'game.txt': 'v2\n', [WORKFLOW]: 'on: [push, pull_request]\n' };
    const r = revertRed(red);
    expect(r.result.status, r.result.err).toBe(0);
    expect(r.branches).toContain(r.branch);
    expect(r.pushed('game.txt'), 'the normal file, back to the green parent').toBe('v1\n');
    expect(r.pushed(WORKFLOW), 'the workflow, as main has it').toBe(red[WORKFLOW]);
    expect(r.pushed('later.txt'), 'what main did since').toBe('later\n');
    expect(r.changed(), 'the push touches no workflow file').toEqual(['game.txt']);
    const note = `The changes to \`.github/workflows/\` (\`${WORKFLOW}\`) were left in place`;
    expect(r.message()).toContain(`This reverts commit ${r.sha}.`);
    expect(r.message()).toContain(note);
    expect(r.call('pr', 'create'), 'gh pr create').toBeDefined();
    expect(r.body()).toContain(note);
    expect(r.body().trim().endsWith(`This reverts commit ${r.sha}.`), r.body()).toBe(true);
    expect(r.call('pr', 'merge', PR_URL)).toBeDefined();
    const issue = r.call('issue', 'create');
    expect(r.arg(issue, '--title')).toBe('Re-land "feat: the red one" with a fix');
    expect(r.arg(issue, '--body')).toContain(note);
    expect(r.output()).toContain('reverted=true');
  });

  it('pushes nothing for a commit that changes only workflows, and asks for an issue', () => {
    const r = revertRed({ [WORKFLOW]: 'on: [push, pull_request]\n', '.github/workflows/y.yml': 'on: push\n' });
    expect(r.result.status, r.result.err).toBe(0);
    expect(r.result.out).toContain('::warning::');
    expect(r.branches, 'no revert branch pushed').toEqual(['main']);
    expect(r.call('pr', 'create')).toBeUndefined();
    expect(r.call('pr', 'merge')).toBeUndefined();
    expect(r.call('workflow', 'run'), 'no CI re-run: main is unchanged').toBeUndefined();
    const issue = r.call('issue', 'create');
    expect(issue, 'gh issue create').toBeDefined();
    expect(r.arg(issue, '--label')).toBe('claude');
    expect(r.arg(issue, '--title')).toBe('Revert "feat: the red one" by hand: CI\'s token cannot push workflow changes');
    expect(r.arg(issue, '--body')).toContain(`\`${WORKFLOW}\`, \`.github/workflows/y.yml\``);
    expect(r.arg(issue, '--body')).toContain('a token with the `workflows` permission');
    expect(r.output()).not.toContain('reverted=true');
  });

  it('reverts any other commit whole, as before', () => {
    const r = revertRed({ 'game.txt': 'v2\n' });
    expect(r.result.status, r.result.err).toBe(0);
    expect(r.pushed('game.txt')).toBe('v1\n');
    expect(r.changed()).toEqual(['game.txt']);
    expect(r.message()).toBe(`Revert "feat: the red one"\n\nThis reverts commit ${r.sha}.`);
    expect(r.body()).not.toContain('.github/workflows/');
    expect(r.body().trim().endsWith(`This reverts commit ${r.sha}.`)).toBe(true);
    for (const c of [['pr', 'create'], ['pr', 'merge', PR_URL], ['workflow', 'run', 'ci.yml'], ['issue', 'create']]) {
      expect(r.call(...c), `gh ${c.join(' ')}`).toBeDefined();
    }
    expect(r.arg(r.call('issue', 'create'), '--body')).not.toContain('.github/workflows/');
    expect(r.output()).toContain('reverted=true');
  });
});
