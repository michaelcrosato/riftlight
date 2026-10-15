// The engine kit's GitHub Release notes (scripts/release/notes.mjs, CI's release job): the
// version's own CHANGELOG.md section, never a neighbour's, and the links to the release.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { changelogSection, releaseNotes } from '../scripts/release/notes.mjs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const REPO = 'https://github.com/owner/engine';
const CHANGELOG = `# Changelog

Intro.

## 0.3.0

- three

## 0.2.0

The second.

- two
- also two

## 0.1.0

- one
`;

describe('release notes', () => {
  it('take only the version section', () => {
    expect(changelogSection(CHANGELOG, '0.2.0')).toBe('The second.\n\n- two\n- also two');
    expect(changelogSection(CHANGELOG, '0.3.0')).toBe('- three');
    expect(changelogSection(CHANGELOG, '0.1.0')).toBe('- one'); // the last section runs to the end
  });

  it('need a section for the version', () => {
    expect(() => changelogSection(CHANGELOG, '0.4.0')).toThrow('no "## 0.4.0" section');
    expect(() => changelogSection(CHANGELOG, '0.2')).toThrow(); // a heading is matched whole
  });

  it("link the newest release and this one, then say what changed", () => {
    const notes = releaseNotes({ changelog: CHANGELOG, version: '0.2.0', repo: REPO });
    expect(notes).toContain(`${REPO}/releases/latest/download/pixel-engine.zip`);
    expect(notes).toContain(`${REPO}/releases/download/engine-v0.2.0/pixel-engine.zip`);
    expect(notes).toContain('## What changed in 0.2.0\n\nThe second.\n\n- two\n- also two\n');
    expect(notes).not.toContain('three');
    expect(notes).not.toContain('- one');
  });

  it("build for this repository's version, as CI's release job runs them", () => {
    const meta = JSON.parse(read('package.json')) as { version: string; repository: { url: string } };
    const repo = meta.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''); // as the script reads it
    const notes = releaseNotes({ changelog: read('CHANGELOG.md'), version: meta.version, repo });
    expect(notes).toContain(`## What changed in ${meta.version}`);
    expect(notes).toContain(`${repo}/releases/download/engine-v${meta.version}/pixel-engine.zip`);
    // the command the job runs prints the same notes (an empty file would publish empty notes)
    const printed = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/release/notes.mjs', import.meta.url))], { encoding: 'utf8' });
    expect(printed).toBe(notes);
  });
});
