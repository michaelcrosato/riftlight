// The UI kit draws every language (docs/game/lang.md): the 3×5 mini font only for what it can draw,
// widths measured as the text is drawn, wrapping by width at the language's word breaks.
import { afterEach, describe, expect, it } from 'vitest';
import { setTextLocale, textWidthPx } from '../../engine';
import { clip, miniCovers, miniWidth, wrap, wrapRow } from './kit';

afterEach(() => setTextLocale(undefined));

describe('the mini font', () => {
  it('draws capitals, digits and its symbols; anything else goes to the normal font', () => {
    expect(miniCovers('LV 12')).toBe(true);
    expect(miniCovers('lv 12')).toBe(true); // drawn in capitals
    expect(miniWidth('LV 12')).toBe(5 * 4 - 1);
    expect(miniCovers('The engine’s demo'), 'the typographic apostrophe the lines use').toBe(true);
    // accents, other alphabets: the normal font, measured as it draws
    for (const s of ['NIVEAU É', 'Уровень', '等级']) {
      expect(miniCovers(s), s).toBe(false);
      expect(miniWidth(s), s).toBe(textWidthPx(s));
    }
  });

  it('Turkish i is İ in capitals: not a mini letter', () => {
    setTextLocale('tr');
    expect(miniCovers('seviye')).toBe(false);
    setTextLocale('en');
    expect(miniCovers('seviye')).toBe(true);
  });
});

describe('measuring and cutting', () => {
  it('clip cuts whole letters to the width, with a dot', () => {
    const m = (s: string) => textWidthPx(s);
    expect(clip('Gale', 100, m)).toBe('Gale');
    const cut = clip('Frostglass Gravewell', 60, m);
    expect(m(cut)).toBeLessThanOrEqual(60);
    expect(cut.endsWith('.')).toBe(true);
    expect(clip('E\u0301'.repeat(9), 20, m)).toMatch(/^É+\.$/); // a letter and its accent stay together
  });

  it('wrap breaks by measured width, at word breaks', () => {
    const lines = wrap('A hack-and-slash of endless rifts', 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidthPx(l)).toBeLessThanOrEqual(60);
    expect(lines.join('').replace(/\s/g, '')).toBe('Ahack-and-slashofendlessrifts'); // nothing lost
  });

  it('wrapRow puts whole parts on each line, as many as fit; a part wider than a line wraps inside', () => {
    const parts = ['K kill', 'F pick up', 'I inventory', 'T stash'];
    expect(wrapRow(parts, 480)).toEqual(['K kill  F pick up  I inventory  T stash']);
    const lines = wrapRow(parts, textWidthPx('K kill  F pick up'));
    expect(lines).toEqual(['K kill  F pick up', 'I inventory', 'T stash']);
    expect(wrapRow(parts, 130, '   ')).toEqual(['K kill   F pick up', 'I inventory   T stash']);
    const narrow = wrapRow(['Alt filter off'], textWidthPx('Alt filter'));
    expect(narrow).toEqual(['Alt filter', 'off']);
  });
});
