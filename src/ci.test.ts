// CI's e2e job runs one matrix entry per group in scripts/e2e.mjs (GROUPS); a group missing from
// the matrix would never run, and e2e.mjs's own guard only sees GROUPS. It keeps the suites' frames
// and what a failed 52in1 harness run's page was doing (the hub suite's EVIDENCE). The riftlight-html job
// publishes the file `npm run build:single` writes, and never takes releases/latest from the kit.
// Every workflow that runs Claude skips itself, with a notice, when no Claude secret is set. The
// Node the tools need is package.json's `engines`, and an older one is told so.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registerHooksApi } from '../scripts/trace/hooks';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('CI', () => {
  it('runs every e2e group, and only those', () => {
    const help = execFileSync(process.execPath, ['scripts/e2e.mjs', '--help'], { cwd: root, encoding: 'utf8' });
    const groups = [...help.matchAll(/^(@[\w-]+):/gm)].map((m) => m[1]);
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const matrix = /^\s*group: \[(.*)\]$/m.exec(ci)?.[1];
    expect(groups.length).toBeGreaterThan(1);
    expect(matrix, 'ci.yml: the e2e job\'s matrix.group as a one-line ["@core", …] list').toBeDefined();
    expect((JSON.parse(`[${matrix}]`) as string[]).sort()).toEqual(groups.sort());
  });

  it('keeps what the e2e suites leave: their frames, and a failed harness run’s evidence (the hub suite)', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const job = /^ {2}e2e:\n([\s\S]*?)(?=^ {2}\S)/m.exec(ci)?.[1];
    const upload = /uses: actions\/upload-artifact@\S+\n\s*with:\n([\s\S]*?)(?=\n\s*- |$)/.exec(job ?? '')?.[1] ?? '';
    const paths = /path: \|\n((?:\s+\S+\n?)+?)\s*if-no-files-found/.exec(upload)?.[1]?.split('\n').map((l) => l.trim()).filter(Boolean);
    const evidence = /export const EVIDENCE = '([^']+)'/.exec(readFileSync(new URL('../scripts/e2e-hub.mjs', import.meta.url), 'utf8'))?.[1];
    expect(evidence, 'scripts/e2e-hub.mjs: EVIDENCE, where failed runs leave theirs').toBeDefined();
    expect(paths, "ci.yml: the e2e job's upload-artifact path, a block list").toEqual(['.scratch/e2e/', evidence]);
  });

  it('publishes the single-file game build:single writes, never as the latest release', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const job = /^ {2}riftlight-html:\n([\s\S]*?)(?=^ {2}\S)/m.exec(ci)?.[1];
    expect(job, 'ci.yml: a riftlight-html job').toBeDefined();
    const built = /writeFile\(`\$\{outDir\}\/([\w.-]+\.html)`/.exec(readFileSync(new URL('../scripts/build-single.mjs', import.meta.url), 'utf8'))?.[1];
    expect(built, 'scripts/build-single.mjs writes ${outDir}/<name>.html').toBeDefined();
    expect(job).toContain('run: npm run build:single');
    expect(job).toContain(`file=dist-single/${built}`);
    expect(job).toMatch(/needs: \[check, e2e\]\n\s*if: success\(\) && github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
    for (const publish of job!.match(/gh release (?:create|edit) (?:[^\n]*\\\n)*[^\n]*/g) ?? []) expect(publish).toContain('--prerelease --latest=false');
    expect(job!.match(/gh release (?:create|edit) /g)).toHaveLength(1);
    expect(job, 'a failed publish leaves main green').toContain('continue-on-error: true');
  });

  it('asks for the Node the tools need (module.registerHooks: 22.15+), and an older one is told so', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe('>=22.15');
    expect(() => registerHooksApi({}, '22.13.0')).toThrow(/^Node 22\.13\.0 is too old .* need Node 22\.15 or newer/);
    expect(registerHooksApi()).toBeTypeOf('function'); // this Node has it
  });

  it('every Claude workflow skips itself with a notice when neither Claude secret is set', () => {
    const dir = new URL('../.github/workflows/', import.meta.url);
    const claude = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ f, y: readFileSync(new URL(f, dir), 'utf8') }))
      .filter(({ y }) => y.includes('anthropics/claude-code-action@'));
    expect(claude.map(({ f }) => f).sort()).toEqual(['claude-ci-autofix.yml', 'claude-maintenance.yml', 'claude-review.yml', 'claude.yml']);
    for (const { f, y } of claude) {
      expect(y, `${f}: HAS_CLAUDE from the two secrets`).toContain("HAS_CLAUDE: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN != '' || secrets.ANTHROPIC_API_KEY != '' }}");
      expect(y, `${f}: says why it skipped`).toMatch(/if \[ "\$HAS_CLAUDE" != "true" \]; then\n\s*echo "::notice::No CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY secret; skipping/);
      const steps = y.split(/\n\s*- (?=name:|uses:)/).filter((step) => /uses: anthropics\/claude-code-action@/.test(step));
      expect(steps.length, f).toBeGreaterThan(0);
      for (const step of steps) expect(step, `${f}: the Claude step runs only when the guard says so`).toMatch(/\n\s*if: steps\.\w+\.outputs\.\w+ == '\w+'/);
    }
  });
});
