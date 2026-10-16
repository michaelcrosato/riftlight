// The docs agents read stay true and small: every docs/….md a file cites exists, and so does the
// heading cited after it (`docs/x.md *Heading*`, `docs/x.md, "Heading"`, `*A* and *B*`: a
// heading or bold `**label` that starts with the whole words); every docs/{engine,game,assets}/ file
// is listed in its index (ENGINE.md, GAME.md, ASSETS.md); relative markdown links and their
// anchors resolve; every topic doc fits one Read (24 KB) and AGENTS.md, loaded every session,
// stays under 11 KB. History (CHANGELOG.md) and plans (docs/plans/) are not checked.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
/** Tracked files and new ones not ignored, so a doc added in the working tree counts too. */
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && existsSync(join(root, f)));
const history = (f: string) => f === 'CHANGELOG.md' || f.startsWith('docs/plans/') || f === 'src/docs.test.ts';
const citing = files.filter((f) => /\.(ts|mjs|md|yml|html)$/.test(f) && !history(f));

/** A markdown file's headings (outside code fences), without the hashes. */
function headings(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    else if (!fence && /^#{1,6} /.test(line)) out.push(line.replace(/^#+ /, '').trim());
  }
  return out;
}
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `doc` has a section named `name`: a heading or a bold `**label` starting with its whole words. */
function hasSection(doc: string, name: string): boolean {
  const want = squash(name);
  const whole = (s: string) => s.startsWith(want) && !/[\p{L}\p{N}]/u.test(s.charAt(want.length));
  return headings(doc).some((h) => whole(squash(h))) || new RegExp(`\\*\\*${escapeRe(want)}(?![\\p{L}\\p{N}])`, 'u').test(squash(doc));
}

/** Every `docs/….md` cited in `text`, with the headings cited right after it. */
function citations(text: string): { path: string; headings: string[]; line: number }[] {
  const out: { path: string; headings: string[]; line: number }[] = [];
  // a heading is *…* or "…", after an optional comma, possibly across a comment line break
  const gap = String.raw`,?[ \t]*(?:\n[ \t]*(?:\*|\/\/|#)?[ \t]*)?`;
  const quoted = String.raw`(\*[^*\n]+\*|"[^"\n]+")`;
  const first = new RegExp(`^${gap}${quoted}`);
  const more = new RegExp(`^,?[ \\t]*(?:and|,)${gap.slice(2)}${quoted}`);
  for (const m of text.matchAll(/(?<![\w/.-])docs\/([\w./-]+?\.md)\b/g)) {
    const found: string[] = [];
    let rest = text.slice(m.index + m[0].length);
    let h = first.exec(rest);
    while (h) {
      found.push(h[1]!.slice(1, -1));
      rest = rest.slice(h[0].length);
      h = more.exec(rest);
    }
    out.push({ path: `docs/${m[1]}`, headings: found, line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('docs', () => {
  it('parses the citation forms the repo uses', () => {
    const c = (t: string) => citations(t).map((x) => [x.path, ...x.headings]);
    expect(c('see docs/game/loot.md *Rarity math*.')).toEqual([['docs/game/loot.md', 'Rarity math']]);
    expect(c('(docs/ANIMATION.md, "At runtime")')).toEqual([['docs/ANIMATION.md', 'At runtime']]);
    expect(c(' * docs/assets/importing.md\n * *Packs*)')).toEqual([['docs/assets/importing.md', 'Packs']]);
    expect(c('docs/ASSETS.md *The loop* and *Checks*')).toEqual([['docs/ASSETS.md', 'The loop', 'Checks']]);
    expect(c('docs/engine/ (a folder), docs/GAME.md rule 5, `docs/WORLD.md`')).toEqual([['docs/GAME.md'], ['docs/WORLD.md']]);
  });

  it('matches a cited section by whole words', () => {
    const doc = '# Loot\n\n## Rarity math\n\n**Recording and replay**: …';
    expect(hasSection(doc, 'Rarity math')).toBe(true);
    expect(hasSection(doc, 'Rarity')).toBe(true);
    expect(hasSection(doc, 'Recording and replay')).toBe(true);
    expect(hasSection(doc, 'R')).toBe(false);
    expect(hasSection(doc, 'Rar')).toBe(false);
    expect(hasSection(doc, 'Record')).toBe(false);
  });

  it('every topic file is in its index', () => {
    const missing: string[] = [];
    for (const [dir, index] of [['docs/engine/', 'docs/ENGINE.md'], ['docs/game/', 'docs/GAME.md'], ['docs/assets/', 'docs/ASSETS.md']] as const) {
      const text = read(index);
      for (const f of files.filter((x) => x.startsWith(dir) && x.endsWith('.md'))) if (!text.includes(f)) missing.push(`${index} doesn't list ${f}`);
    }
    expect(missing).toEqual([]);
  });

  it('every cited doc and heading exists', () => {
    const broken: string[] = [];
    for (const file of citing) {
      for (const { path, headings: cited, line } of citations(read(file))) {
        if (!existsSync(join(root, path))) {
          broken.push(`${file}:${line}: ${path} does not exist`);
          continue;
        }
        const doc = read(path);
        for (const h of cited) if (!hasSection(doc, h)) broken.push(`${file}:${line}: ${path} has no section *${h}*`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('relative markdown links and anchors resolve', () => {
    const broken: string[] = [];
    for (const file of citing.filter((f) => f.endsWith('.md') && !/(^|\/)GUIDE[^/]*\.md$/.test(f))) {
      const text = read(file);
      for (const m of text.matchAll(/\]\(([^)\s]*)\)/g)) {
        const [target = '', anchor] = m[1]!.split('#');
        if (/^[a-z]+:/.test(target)) continue;
        const path = target ? normalize(join(dirname(file), target)) : file;
        if (!existsSync(join(root, path))) {
          broken.push(`${file}: ${m[1]} (no ${path})`);
          continue;
        }
        if (anchor && path.endsWith('.md') && !headings(read(path)).some((h) => slug(h) === anchor)) broken.push(`${file}: ${m[1]} (no #${anchor})`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every topic doc fits one Read (≤ 24 KB; GUIDE*.md and docs/plans/ excepted)', () => {
    const big = files
      .filter((f) => /^docs\/.*\.md$/.test(f) && !/^docs\/GUIDE[^/]*\.md$/.test(f) && !f.startsWith('docs/plans/'))
      .map((f) => [f, statSync(join(root, f)).size] as const)
      .filter(([, size]) => size > 24_576)
      .map(([f, size]) => `${f}: ${size} bytes`);
    expect(big).toEqual([]);
  });

  it('AGENTS.md, loaded every session, stays ≤ 11 KB', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBeLessThanOrEqual(11_264);
  });
});
