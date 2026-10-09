import { describe, expect, it } from 'vitest';
import { wrap } from './cutscene';

describe('subtitle wrapping', () => {
  const measure = (t: string) => t.length * 6 - 1; // the 5 x 7 font: 6 px a letter with its gap
  it('breaks between words to fit, keeping every word', () => {
    const text = 'SKIP IT, AND THE CHEST AND THE GATE STILL END UP OPEN.';
    const lines = wrap(text, 120, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => measure(l) <= 120)).toBe(true);
    expect(lines.join(' ')).toBe(text);
    expect(wrap(text, 1000, measure)).toEqual([text]);
  });
  it('gives a word wider than the line a line of its own', () => {
    expect(wrap('A SUPERCALIFRAGILISTIC B', 30, measure)).toEqual(['A', 'SUPERCALIFRAGILISTIC', 'B']);
  });
});
