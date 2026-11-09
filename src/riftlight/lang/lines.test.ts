// The game's line list keeps to AI Hub Languages v1 (the catalogue checker's rules), and the stored
// translations stay honest: a line whose English changed is left out until it is translated again.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUB_LANGUAGES, Lang, LINE_ID, PLURAL_FORMS } from '../../engine';
import { riftlightLines } from './index';
import { lineHash, riftlightTranslations, translationStatus, type StoredTranslation } from './translations';

describe('riftlightLines', () => {
  const list = riftlightLines();

  it('is a game-lines block the hub takes', () => {
    expect(list.version).toBe(1);
    expect(HUB_LANGUAGES).toContain(list.language);
    expect(Object.keys(list.lines).length).toBeGreaterThan(0);
    expect(list.brief.trim().length).toBeGreaterThan(200);
    expect(list.names.every((n) => typeof n === 'string' && n.trim() === n && n.length > 0)).toBe(true);
  });

  it('every line: a valid id, text or plural forms (one and other), balanced tags, no HTML', () => {
    const bad: string[] = [];
    for (const [id, line] of Object.entries(list.lines)) {
      if (!LINE_ID.test(id)) bad.push(`${id}: id`);
      const texts = typeof line === 'string' ? [line] : Object.values(line);
      if (typeof line === 'object') {
        if (!line.one || !line.other) bad.push(`${id}: plural forms need one and other`);
        if (Object.keys(line).some((k) => !PLURAL_FORMS.includes(k as never))) bad.push(`${id}: plural form names`);
        if (!texts.some((s) => s?.includes('{count}'))) bad.push(`${id}: plural forms without {count}`);
      }
      for (const s of texts) {
        if (typeof s !== 'string' || !s.trim()) bad.push(`${id}: empty`);
        else if (s.split('{').length !== s.split('}').length) bad.push(`${id}: unbalanced { }`);
        else if (/<[a-z/!]/i.test(s)) bad.push(`${id}: HTML`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('notes and widths name lines that exist; a line fits its own width', () => {
    for (const id of Object.keys(list.notes ?? {})) expect(list.lines[id], `notes.${id}`).toBeDefined();
    const en = new Lang(list);
    for (const [id, w] of Object.entries(list.max ?? {})) {
      expect(list.lines[id], `max.${id}`).toBeDefined();
      const line = list.lines[id]!;
      const longest = typeof line === 'string' ? en.t(id) : Object.values(line).map((s) => s!.replace('{count}', '99')).sort((a, b) => b.length - a.length)[0]!;
      expect(longest.replace(/\{[^{}]*\}/g, '').length, `${id} is wider than its max ${w}`).toBeLessThanOrEqual(w);
    }
  });
});

describe('the code', () => {
  it('every line id it shows with t() is in the list (a typo shows the id)', () => {
    const root = new URL('../', import.meta.url).pathname;
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const missing: string[] = [];
    for (const f of files) {
      const text = readFileSync(root + f, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-z0-9_.]+)'/g)) if (!(m[1]! in riftlightLines().lines)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('stored translations', () => {
  const source = { version: 1 as const, language: 'en', lines: { 'a.one': 'Start', 'a.two': 'Stop', 'dev.x': 'Debug' }, names: [], brief: 'b' };

  it('a line whose English changed is stale and left out of the page; a missing one shows the English', () => {
    const fr: StoredTranslation = { by: 'test', lines: { 'a.one': 'Commencer', 'a.two': 'Arrêter' }, source: { 'a.one': lineHash('Start'), 'a.two': lineHash('Halt') } };
    expect(translationStatus(fr, source)).toEqual({ current: ['a.one'], stale: ['a.two'], missing: [], unknown: [] });
    const dir = mkdtempSync(join(tmpdir(), 'rl-tr-'));
    writeFileSync(join(dir, 'fr.json'), JSON.stringify(fr));
    const block = riftlightTranslations(dir, source);
    expect(block.fr!.lines).toEqual({ 'a.one': 'Commencer' });
    expect(new Lang(source, block, { code: 'fr' }).t('a.two')).toBe('Stop');
  });

  it('dev. lines are never asked for; lines the game no longer has are reported', () => {
    const de: StoredTranslation = { by: 'test', lines: { 'a.one': 'Start', 'old.line': 'Alt' }, source: { 'a.one': lineHash('Start'), 'old.line': 'x' } };
    const s = translationStatus(de, source);
    expect(s.missing).toEqual(['a.two']);
    expect(s.unknown).toEqual(['old.line']);
  });

  it('a hash follows the text, plural forms in any order', () => {
    expect(lineHash('Start')).toBe(lineHash('Start'));
    expect(lineHash('Start')).not.toBe(lineHash('Start!'));
    expect(lineHash({ one: 'a', other: 'b' })).toBe(lineHash({ other: 'b', one: 'a' }));
  });
});
