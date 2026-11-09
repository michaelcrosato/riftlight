import { afterEach, describe, expect, it } from 'vitest';
import { drawText, glyphFor, pixelCovers, setTextLocale, textCells, textWidth } from '../animation/font';
import { textWidthPx } from './deviceText';
import { wrapText } from './wrap';

/** A text drawn into rows of '#' and '.' (the two rows over the cell first), for looking at glyphs in a test. */
function picture(text: string): string[] {
  const w = textWidth(text);
  const rows = Array.from({ length: 10 }, () => Array<string>(w).fill('.'));
  drawText(text, 0, 2, (x, y) => void (rows[y]![x] = '#'));
  return rows.map((r) => r.join(''));
}

afterEach(() => setTextLocale(undefined));

describe('the pixel font in other languages', () => {
  it('composes accented capitals: a mark in the two rows over the letter, a mark below in its eighth row', () => {
    expect(picture('É')).toEqual(['...#..', '..#...', '#####.', '#.....', '#.....', '####..', '#.....', '#.....', '#####.', '......']);
    expect(picture('E').slice(2)).toEqual(picture('É').slice(2)); // the capital itself is untouched
    expect(picture('Ç')[9]).toBe('..##..');
    expect(glyphFor('Ẹ́')).not.toBeNull(); // Yoruba: one mark above, one below
    expect(glyphFor('Ế')).toBeNull(); // two marks above: the font has no room for them
  });

  it('covers the Latin languages; other writing systems go to the device font', () => {
    for (const text of ['¿Dónde está?', 'Ça va', 'Größe', 'Şimdi İstanbul', 'Ẹ káàbọ̀', 'Ɓaƙi', '[Stárt·····]', '12 500']) expect(pixelCovers(text), text).toBe(true);
    for (const text of ['Привет', '你好', 'مرحبا', 'नमस्ते', 'Xin chào thế giới', 'ሰላም']) expect(pixelCovers(text), text).toBe(false);
  });

  it('a language the font can’t draw in full draws all its letters in the device font, never half and half', () => {
    setTextLocale('vi');
    expect(pixelCovers('VIỆT')).toBe(false); // drawable alone, but Vietnamese stacks marks elsewhere
    expect(pixelCovers('12/40')).toBe(true); // no letters: the pixel digits
    setTextLocale('zh-XC');
    expect(pixelCovers('HP')).toBe(false);
    setTextLocale('en-XA');
    expect(pixelCovers('[Stárt·]')).toBe(true);
  });

  it('capitals follow the drawing language (Turkish i → İ)', () => {
    setTextLocale('tr');
    expect(picture('i')[1]).toBe('..#...'); // İ: the dot over the capital
    setTextLocale(undefined);
    expect(picture('i')[1]).toBe('......');
  });

  it('a letter and its marks take one cell; isolates and joiners take none', () => {
    expect(textCells('É')).toBe(1);
    expect(textCells('⁨Vex⁩')).toBe(3);
    expect(textCells('größe')).toBe(6); // ß is SS in capitals
    expect(textWidthPx('ABC')).toBe(17);
  });
});

describe('wrapText', () => {
  it('wraps at spaces by measured width, a long word cut between letters', () => {
    expect(wrapText('THE QUICK BROWN FOX', 6 * 10)).toEqual(['THE QUICK', 'BROWN FOX']);
    expect(wrapText('ABCDEFGHIJKL', 6 * 5)).toEqual(['ABCDE', 'FGHIJ', 'KL']);
    expect(wrapText('ONE\nTWO', 100)).toEqual(['ONE', 'TWO']);
  });

  it('keeps punctuation with the word before it', () => {
    expect(wrapText('WAIT, WHAT?!', 6 * 6)).toEqual(['WAIT,', 'WHAT?!']);
    expect(wrapText('A B C D?!', 6 * 4)).toEqual(['A B', 'C', 'D?!']);
  });

  it('wraps Chinese, which has no spaces, between characters; punctuation never starts a line', () => {
    const width = (s: string): number => [...s].length * 10;
    const lines = wrapText('这是一个很长的句子，没有空格。', 50, width, 'zh');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(width(line)).toBeLessThanOrEqual(50);
      expect(line).not.toMatch(/^[，。]/);
    }
    expect(lines.join('')).toBe('这是一个很长的句子，没有空格。');
  });
});
