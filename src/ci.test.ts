// CI's e2e job runs one matrix entry per group in scripts/e2e.mjs (GROUPS); a group missing from
// the matrix would never run, and e2e.mjs's own guard only sees GROUPS.
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
});
