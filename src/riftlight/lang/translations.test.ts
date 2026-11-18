// The stored translations (lang/translations/<code>.json) against the checks `npm run lang -- apply`
// files them with (`translationProblems`, the one function `npm run lang -- check` runs too), so a
// hand-edited file or a bad merge fails `npm test`, not the hand-over build. Stale lines are not
// checked: the page leaves them out, and changing the English must never fail a test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineList } from '../../engine';
import { riftlightLines } from './index';
import { lineHash, lineProblems, pluralFormsOf, storedTranslations, translationProblems, type StoredTranslation } from './translations';

describe('stored translations', () => {
  const source = riftlightLines();
  const stored = storedTranslations();

  it('every stored language passes the checks: a hub language, {tags} kept, the plural forms it needs, within max', () => {
    expect(Object.keys(stored).length).toBeGreaterThan(0);
    for (const [code, t] of Object.entries(stored)) expect(translationProblems(code, t, source), code).toEqual([]);
  });

  it('the checks catch a broken {tag}, a missing plural form and a line past its width', () => {
    const list: LineList = {
      version: 1,
      language: 'en',
      lines: { 'a.gold': 'Gold: {n}', 'a.kills': { one: '{count} kill', other: '{count} kills' }, 'a.short': 'OK' },
      max: { 'a.short': 4 },
      names: [],
      brief: '',
    };
    const fr = (lines: Record<string, unknown>): StoredTranslation => ({ by: 'test', lines: lines as StoredTranslation['lines'], source: Object.fromEntries(Object.keys(lines).map((id) => [id, lineHash(list.lines[id]!)])) });
    expect(translationProblems('fr', fr({ 'a.gold': 'Or : {n}', 'a.kills': { one: '{count} victime', many: '{count} victimes', other: '{count} victimes' }, 'a.short': 'OK' }), list)).toEqual([]);
    expect(translationProblems('fr', fr({ 'a.gold': 'Or : {nombre}' }), list)).toEqual(['a.gold: tags {nombre} ≠ {n}']);
    expect(translationProblems('fr', fr({ 'a.kills': { other: '{count} victimes' } }), list)).toEqual(['a.kills: needs the plural form one', 'a.kills: needs the plural form many']);
    expect(translationProblems('fr', fr({ 'a.short': 'D’ACCORD' }), list)).toEqual(['a.short: 8 wide, max 4']);
    expect(translationProblems('xx', fr({}), list)).toEqual(['xx is not a language the hub takes']);
    expect(lineProblems('fr', 'a.none', 'x', list)).toEqual(['a.none: not a line of the game']);
    // a stale line (its English changed since) is not shipped and not checked
    const stale = fr({ 'a.gold': 'Or : {nombre}' });
    expect(translationProblems('fr', { ...stale, source: { 'a.gold': 'old' } }, list)).toEqual([]);
  });

  describe('plural forms come in one order on every Node', () => {
    afterEach(() => vi.restoreAllMocks());
    // V8 orders a language's categories differently between versions (French: one many other on
    // Node 24, many one other on Node 22, which CI runs): force each order and expect the same answer.
    const orders = [
      ['one', 'many', 'other'],
      ['many', 'one', 'other'],
      ['other', 'many', 'one'],
    ] as const;
    const list: LineList = { version: 1, language: 'en', lines: { 'a.kills': { one: '{count} kill', other: '{count} kills' } }, names: [], brief: '' };
    for (const order of orders) {
      it(order.join(' '), () => {
        const real = Intl.PluralRules.prototype.resolvedOptions;
        vi.spyOn(Intl.PluralRules.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.PluralRules) {
          return { ...real.call(this), pluralCategories: [...order] };
        });
        expect(pluralFormsOf('fr')).toEqual(['one', 'many', 'other']);
        const t: StoredTranslation = { by: 'test', lines: { 'a.kills': { other: '{count} victimes' } }, source: { 'a.kills': lineHash(list.lines['a.kills']!) } };
        expect(translationProblems('fr', t, list)).toEqual(['a.kills: needs the plural form one', 'a.kills: needs the plural form many']);
      });
    }
    it('an unknown code needs other only', () => expect(pluralFormsOf('not a language')).toEqual(['other']));
  });
});
