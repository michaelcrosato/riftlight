/**
 * Line wrapping for every pixel surface, in any language (AI Hub Languages v1, *Drawing text*):
 * break points come from `Intl.Segmenter` (words), so Chinese, Japanese and Thai, which put no
 * spaces between words, wrap too; punctuation stays with the word before it; a word wider than the
 * line is cut between whole letters. Widths are measured the way the text will be drawn
 * (`textWidthPx`: the pixel font, or the device's font).
 */
import { textLocale } from '../animation/font';
import { textWidthPx } from './deviceText';

/** Text that may start a line only if nothing else fits: closing punctuation of every script. */
const CLINGS = /^[\p{Pe}\p{Pf}\p{Po}]+$/u;

function segments(text: string, lang: string | undefined): string[] {
  if (typeof Intl.Segmenter === 'function') {
    try {
      return [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].map((s) => s.segment);
    } catch {
      /* an unknown locale: split on spaces below */
    }
  }
  return text.split(/(\s+)/).filter((s) => s !== '');
}

function graphemes(text: string, lang: string | undefined): string[] {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(lang, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return Array.from(text);
}

/**
 * `text` in lines no wider than `width` (art pixels at `measure`'s scale). `\n` starts a new
 * paragraph. Spaces at the ends of lines are dropped.
 */
export function wrapText(text: string, width: number, measure: (s: string) => number = (s) => textWidthPx(s), lang: string | undefined = textLocale()): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    // Chunks that never break inside: a word with the punctuation that follows it; spaces apart.
    const chunks: string[] = [];
    for (const seg of segments(paragraph, lang)) {
      if (/^\s+$/u.test(seg)) chunks.push(' ');
      else if (chunks.length && CLINGS.test(seg) && chunks[chunks.length - 1] !== ' ') chunks[chunks.length - 1] += seg;
      else chunks.push(seg);
    }
    let line = '';
    const push = (): void => {
      out.push(line.trimEnd());
      line = '';
    };
    for (const chunk of chunks) {
      if (chunk === ' ') {
        if (line) line += ' ';
        continue;
      }
      if (measure(line + chunk) <= width) {
        line += chunk;
        continue;
      }
      if (line.trim()) push();
      if (measure(chunk) <= width) {
        line = chunk;
        continue;
      }
      for (const g of graphemes(chunk, lang)) {
        if (line && measure(line + g) > width) push();
        line += g;
      }
    }
    if (line.trim() || !out.length || paragraph === '') push();
  }
  return out;
}
