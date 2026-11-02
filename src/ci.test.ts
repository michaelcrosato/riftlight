// CI's e2e job runs one matrix entry per group in scripts/e2e.mjs (GROUPS); a group missing from
// the matrix would never run, and e2e.mjs's own guard only sees GROUPS. The riftlight-html job
// publishes the file `npm run build:single` writes, and never takes releases/latest from the kit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});
