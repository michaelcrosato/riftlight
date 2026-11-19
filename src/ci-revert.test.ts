// CI's revert-red-main job (scripts/ci/revert-red-main.sh) puts a red main back with the job's
// GITHUB_TOKEN, and GitHub refuses that token a push that changes .github/workflows/ (#178). Run for
// real, against a bare origin with a stand-in `gh` first on PATH: a red commit's workflow changes
// stay as main has them and are named in the PR, the commit and the issue (whatever their names
// are made of), even when main has since edited the same lines; one that changes only workflows
// pushes nothing and asks for an issue; a conflict anywhere else still waits for a fix forward; any
// other commit reverts as it always did. With the REVERT_TOKEN secret (FULL_REVERT=true), which may
// push workflows, workflow changes revert like any other, but for a conflict only in them, which
// still takes main's side and is named; that token only merges (and pushes, as checkout's
// credential), every other gh call keeps the job's own token, the merge's push starts CI on main, so
// nothing dispatches it, and the CI run the token's push started on the revert branch is cancelled.
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

// The stand-in gh logs every call (the GH_TOKEN it got ends in \x1d, args in \x1f, calls in \x1e)
// and a --body-file's text, and answers what the script reads: the parent's CI passed, the commit's
// PR ($GH_PR, else none), pr create's URL, the branch's unfinished CI runs ($GH_RUNS, else none).
const GH = `#!/usr/bin/env bash
{ printf '%s\\035' "$GH_TOKEN"; printf '%s\\037' "$@"; printf '\\036'; } >> "$GH_LOG"
prev=
for a in "$@"; do if [ "$prev" = --body-file ]; then cat "$a" > "$GH_LOG.body"; fi; prev=$a; done
case "$*" in
  "api repos/"*"/actions/workflows/"*) echo success ;;
  "api repos/"*"/commits/"*"/pulls "*) echo "\${GH_PR:-}" ;;
  "pr create "*) echo ${PR_URL} ;;
  "run list "*) echo "\${GH_RUNS:-}" ;;
esac
`;

/**
 * The environment without any GIT_* a caller (a hook) set, so git never reaches past the temp dir,
 * and without the job's own switches: a case sets those itself.
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'FULL_REVERT' && k !== 'JOB_TOKEN'),
);
Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

/**
 * The job with the REVERT_TOKEN secret: GH_TOKEN is that, JOB_TOKEN the job's GITHUB_TOKEN; the red
 * commit came from PR #7, and the revert branch's push started CI run 42.
 */
const WITH_REVERT_TOKEN = { FULL_REVERT: 'true', GH_TOKEN: 'revert-token', JOB_TOKEN: 'job-token', GH_PR: '7', GH_RUNS: '42' };

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * A main with a green parent, then the red commit writing `red` (path → text), then a later commit
 * main moved on with (`later.txt` and `later`, deleting `deleted`); the script runs on main's tip as
 * CI's checkout has it, with the job's `job` environment on top.
 */
function revertRed(
  red: Record<string, string>,
  later: Record<string, string> = {},
  deleted: string[] = [],
  job: Record<string, string> = {},
) {
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
  const commit = (subject: string, files: Record<string, string>, gone: string[] = []) => {
    write(files);
    gone.forEach((path) => rmSync(join(work, path)));
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
  commit('docs: main moved on', { 'later.txt': 'later\n', ...later }, deleted);
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
    ...job,
  });
  const logged = (existsSync(log) ? readFileSync(log, 'utf8').split('\x1e').filter(Boolean) : []).map((c) => {
    const [token = '', args = ''] = c.split('\x1d');
    return { token, args: args.split('\x1f').slice(0, -1) };
  });
  const calls = logged.map((c) => c.args);
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
    /** Every gh call's args and the GH_TOKEN it ran with. */
    logged,
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
  // Without the REVERT_TOKEN secret the job passes FULL_REVERT=false; a run by hand may not set it.
  const withoutRevertToken: [string, Record<string, string>][] = [
    ['unset', {}],
    ['false', { FULL_REVERT: 'false' }],
  ];
  it.each(withoutRevertToken)('reverts all but the .github/workflows/ changes, which stay as main has them and are named (FULL_REVERT %s)', (_, job) => {
    const red = { 'game.txt': 'v2\n', [WORKFLOW]: 'on: [push, pull_request]\n' };
    const r = revertRed(red, {}, [], job);
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

  it('names a workflow whose path is not ASCII as it is, and keeps it as main has it', () => {
    const odd = '.github/workflows/ünï code.yml';
    const r = revertRed({ 'game.txt': 'v2\n', [odd]: 'on: push\n' });
    expect(r.result.status, r.result.err).toBe(0);
    expect(r.pushed('game.txt')).toBe('v1\n');
    expect(r.pushed(odd), 'the workflow, as main has it').toBe('on: push\n');
    expect(r.changed()).toEqual(['game.txt']);
    const note = `The changes to \`.github/workflows/\` (\`${odd}\`) were left in place`;
    expect(r.message()).toContain(note);
    expect(r.body()).toContain(note);
    expect(r.arg(r.call('issue', 'create'), '--body')).toContain(note);
  });

  // Main edited the red commit's lines of the workflow since, or deleted the file (null).
  const mainSince: [string, string | null][] = [
    ['edited', 'on: [push, pull_request, workflow_dispatch]\n'],
    ['deleted', null],
  ];
  it.each(mainSince)("takes main's side of a conflict only in .github/workflows/ (main %s it), and reverts the rest", (_, since) => {
    const red = { 'game.txt': 'v2\n', [WORKFLOW]: 'on: [push, pull_request]\n' };
    const r = revertRed(red, since === null ? {} : { [WORKFLOW]: since }, since === null ? [WORKFLOW] : []);
    expect(r.result.status, r.result.err).toBe(0);
    expect(r.result.out).not.toContain('::error::');
    expect(r.pushed('game.txt'), 'the normal file, back to the green parent').toBe('v1\n');
    expect(r.pushed(WORKFLOW), 'the workflow, as main has it').toBe(since);
    expect(r.changed(), 'the push touches no workflow file').toEqual(['game.txt']);
    const note = `The changes to \`.github/workflows/\` (\`${WORKFLOW}\`) were left in place: CI's token cannot push them; re-check them in the fix-forward.`;
    expect(r.message(), 'no conflict markers or "# Conflicts:" lines').toBe(
      `Revert "feat: the red one"\n\nThis reverts commit ${r.sha}.\n\n${note}`,
    );
    expect(r.body()).toContain(note);
    expect(r.call('pr', 'merge', PR_URL)).toBeDefined();
    expect(r.arg(r.call('issue', 'create'), '--body')).toContain(note);
    expect(r.output()).toContain('reverted=true');
  });

  const tokens: [string, Record<string, string>][] = [
    ['', {}],
    [', with REVERT_TOKEN too', WITH_REVERT_TOKEN],
  ];
  it.each(tokens)('still stops for a fix forward when the revert also conflicts outside .github/workflows/%s', (_, job) => {
    const r = revertRed(
      { 'game.txt': 'v2\n', [WORKFLOW]: 'on: [push, pull_request]\n' },
      { 'game.txt': 'v3\n', [WORKFLOW]: 'on: [push, pull_request, workflow_dispatch]\n' },
      [],
      job,
    );
    expect(r.result.status).toBe(1);
    expect(r.result.out).toContain('::error::');
    expect(r.result.out).toContain('needs a fix forward');
    expect(r.branches, 'no revert branch pushed').toEqual(['main']);
    expect(r.call('pr', 'create')).toBeUndefined();
    expect(r.call('issue', 'create')).toBeUndefined();
    expect(r.output()).not.toContain('reverted=true');
  });

  it('stops when the revert fails with nothing unmerged (main already undid it by hand): never an empty revert', () => {
    // the revert has nothing to do: git fails with no conflicted path, which is no workflow-only conflict
    const r = revertRed({ 'game.txt': 'v2\n' }, { 'game.txt': 'v1\n' });
    expect(r.result.status).toBe(1);
    expect(r.result.out).toContain('needs a fix forward');
    expect(r.branches, 'no revert branch pushed').toEqual(['main']);
    expect(r.call('pr', 'create')).toBeUndefined();
    expect(r.call('issue', 'create')).toBeUndefined();
    expect(r.output()).not.toContain('reverted=true');
  });

  // The red commit and what main did since; in the second, the revert is empty once main's side is taken.
  const onlyWorkflows: [string, Record<string, string>, Record<string, string>][] = [
    ['', { [WORKFLOW]: 'on: [push, pull_request]\n', '.github/workflows/y.yml': 'on: push\n' }, {}],
    [
      ', even when the revert conflicts',
      { [WORKFLOW]: 'on: [push, pull_request]\n' },
      { [WORKFLOW]: 'on: [push, pull_request, workflow_dispatch]\n' },
    ],
  ];
  it.each(onlyWorkflows)('pushes nothing for a commit that changes only workflows%s, and asks for an issue', (_, red, later) => {
    const r = revertRed(red, later);
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
    expect(r.arg(issue, '--body')).toContain(`(${Object.keys(red).map((path) => `\`${path}\``).join(', ')})`);
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

  describe('with the REVERT_TOKEN secret (FULL_REVERT=true)', () => {
    const ADDED = '.github/workflows/y.yml';
    /**
     * Only the merge ran with REVERT_TOKEN; the parent's runs, the PRs, the comment, the branch's CI
     * run and the issue kept the job's own token, so they fire no workflows, as before, and need
     * nothing of REVERT_TOKEN.
     */
    const expectTokens = (r: ReturnType<typeof revertRed>) => {
      expect(r.logged.some((c) => c.args[0] === 'api' && c.args[1]?.includes('/actions/')), 'the parent run looked up').toBe(true);
      for (const { token, args } of r.logged) {
        const merge = args[0] === 'pr' && args[1] === 'merge';
        expect(token, `gh ${args.slice(0, 2).join(' ')}`).toBe(merge ? 'revert-token' : 'job-token');
      }
    };
    /**
     * Reverted: the PR merged, PR #7 told, a re-land issue; no CI dispatch (the token's merge pushes
     * to main, which starts CI), and the CI run the token's push started on the branch cancelled.
     */
    const expectReverted = (r: ReturnType<typeof revertRed>) => {
      expect(r.result.status, r.result.err).toBe(0);
      expect(r.body().trim().endsWith(`This reverts commit ${r.sha}.`), r.body()).toBe(true);
      for (const c of [['pr', 'create'], ['pr', 'merge', PR_URL], ['pr', 'comment', '7'], ['run', 'cancel', '42']]) {
        expect(r.call(...c), `gh ${c.join(' ')}`).toBeDefined();
      }
      expect(r.arg(r.call('run', 'list'), '--branch')).toBe(r.branch);
      expect(r.call('workflow', 'run'), 'no dispatch').toBeUndefined();
      const issue = r.call('issue', 'create');
      expect(r.arg(issue, '--title')).toBe('Re-land "feat: the red one" with a fix');
      expect(r.arg(issue, '--body')).toContain('(#7)');
      expect(r.output()).toContain('reverted=true');
      expectTokens(r);
    };
    /** Reverted like any other commit: nothing named, nothing left. */
    const expectWhole = (r: ReturnType<typeof revertRed>) => {
      expect(r.result.out).not.toContain('::warning::');
      expect(r.message()).toBe(`Revert "feat: the red one"\n\nThis reverts commit ${r.sha}.`);
      expect(r.body()).not.toContain('were left');
      expect(r.arg(r.call('issue', 'create'), '--body')).not.toContain('were left');
      expectReverted(r);
    };

    it('reverts a commit that also changes a workflow whole, the workflow included', () => {
      const r = revertRed({ 'game.txt': 'v2\n', [WORKFLOW]: 'on: [push, pull_request]\n' }, {}, [], WITH_REVERT_TOKEN);
      expect(r.pushed('game.txt'), 'the normal file, back to the green parent').toBe('v1\n');
      expect(r.pushed(WORKFLOW), 'the workflow, back to the green parent').toBe('on: push\n');
      expect(r.pushed('later.txt'), 'what main did since').toBe('later\n');
      expect(r.changed()).toEqual([WORKFLOW, 'game.txt']);
      expectWhole(r);
    });

    it('reverts a commit that changes only workflows, and opens the PR', () => {
      const r = revertRed({ [WORKFLOW]: 'on: [push, pull_request]\n', [ADDED]: 'on: push\n' }, {}, [], WITH_REVERT_TOKEN);
      expect(r.branches).toContain(r.branch);
      expect(r.pushed(WORKFLOW), 'the workflow, back to the green parent').toBe('on: push\n');
      expect(r.pushed(ADDED), 'the workflow it added, gone').toBeNull();
      expect(r.changed()).toEqual([WORKFLOW, ADDED]);
      expectWhole(r);
    });

    // Never worse than without the token: a conflict only in workflows still takes main's side.
    it.each(mainSince)("takes main's side of a conflict only in .github/workflows/ (main %s it), names it, and reverts the rest, workflows included", (_, since) => {
      const red = { 'game.txt': 'v2\n', [WORKFLOW]: 'on: [push, pull_request]\n', [ADDED]: 'on: push\n' };
      const r = revertRed(red, since === null ? {} : { [WORKFLOW]: since }, since === null ? [WORKFLOW] : [], WITH_REVERT_TOKEN);
      expect(r.result.out).not.toContain('::error::');
      expect(r.pushed('game.txt'), 'the normal file, back to the green parent').toBe('v1\n');
      expect(r.pushed(ADDED), 'the workflow with no conflict, reverted (gone)').toBeNull();
      expect(r.pushed(WORKFLOW), 'the conflicted workflow, as main has it').toBe(since);
      expect(r.changed()).toEqual([ADDED, 'game.txt']);
      const note = `The changes to \`.github/workflows/\` (\`${WORKFLOW}\`) were left as \`main\` has them: \`main\` has changed the same lines since; re-check them in the fix-forward.`;
      expect(r.message()).toBe(`Revert "feat: the red one"\n\nThis reverts commit ${r.sha}.\n\n${note}`);
      expect(r.body()).toContain(note);
      expect(r.arg(r.call('issue', 'create'), '--body')).toContain(note);
      expectReverted(r);
    });

    it('pushes nothing for a commit that changes only workflows whose revert all conflicts, and asks for an issue', () => {
      const r = revertRed({ [WORKFLOW]: 'on: [push, pull_request]\n' }, { [WORKFLOW]: 'on: [push, pull_request, workflow_dispatch]\n' }, [], WITH_REVERT_TOKEN);
      expect(r.result.status, r.result.err).toBe(0);
      expect(r.result.out).toContain('::warning::');
      expect(r.branches, 'no revert branch pushed').toEqual(['main']);
      for (const c of [['pr', 'create'], ['pr', 'merge'], ['workflow', 'run'], ['run', 'list']]) {
        expect(r.call(...c), `gh ${c.join(' ')}`).toBeUndefined();
      }
      const issue = r.call('issue', 'create');
      expect(r.arg(issue, '--label')).toBe('claude');
      expect(r.arg(issue, '--title')).toBe('Revert "feat: the red one" by hand: it conflicts with later workflow changes');
      expect(r.arg(issue, '--body')).toContain(`(#7) turned \`main\` red and was not reverted: it changes only \`.github/workflows/\` (\`${WORKFLOW}\`), and \`main\` has changed the same lines since.`);
      expect(r.arg(issue, '--body')).not.toContain("CI's token cannot push");
      expect(r.output()).not.toContain('reverted=true');
      expectTokens(r);
    });
  });
});
