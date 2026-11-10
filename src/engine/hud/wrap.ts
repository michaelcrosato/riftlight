/**
 * Line wrapping for every pixel surface, in any language (AI Hub Languages v1, *Drawing text*):
 * break points come from `Intl.Segmenter` (words), so Chinese, Japanese and Thai, which put no
 * spaces between words, wrap too; punctuation stays with the word before it; a word wider than the
 * line is cut between whole letters. Widths are measured the way the text will be drawn
 * (`textWidthPx`: the pixel font, or the device's font).
 */
import { textLocale } from '../animation/font';
import { segmentsOf } from '../lang/segment';
import { textWidthPx } from './deviceText';

/** Opening marks (brackets, opening quotes, Spanish ¿ ¡): they go with the word after them. */
const OPENS = /^[\p{Ps}\p{Pi}\u00bf\u00a1]+$/u;
/** Closing punctuation of every script: it goes with the word before it. */
const CLINGS = /^[\p{Pe}\p{Pf}\p{Po}]+$/u;
/** Quotes that open or close by where they stand ("…" '…'): after a space they open. */
const EITHER = /^["']+$/;
/** Spaces that never break a line (French « », number groups like 12 500). */
const NO_BREAK = /^[\u00a0\u202f\u2007]+$/;

function segments(text: string, lang: string | undefined): string[] {
  return segmentsOf(text, lang, 'word') ?? text.split(/(\s+)/).filter((s) => s !== ''); // no segmenter, or an unknown locale: split on spaces
}

function graphemes(text: string, lang: string | undefined): string[] {
  return segmentsOf(text, lang, 'grapheme') ?? Array.from(text);
}

/**
 * `text` in lines no wider than `width` (art pixels at `measure`'s scale). `\n` starts a new
 * paragraph. Spaces at the ends of lines are dropped.
 */
export function wrapText(text: string, width: number, measure: (s: string) => number = (s) => textWidthPx(s), lang: string | undefined = textLocale()): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    // Chunks that never break inside: a word with the marks that open it, the punctuation that
    // closes it and the no-break spaces between; breakable spaces apart.
    const chunks: string[] = [];
    let glue = false; // the next piece joins the last chunk (after an opening mark or a no-break space)
    const last = (): string | undefined => chunks[chunks.length - 1];
    const join = (piece: string): void => {
      if (glue && chunks.length && last() !== ' ') chunks[chunks.length - 1] += piece;
      else chunks.push(piece);
    };
    for (const seg of segments(paragraph, lang)) {
      if (NO_BREAK.test(seg)) {
        if (chunks.length && last() !== ' ') chunks[chunks.length - 1] += seg;
        else chunks.push(seg);
        glue = true;
      } else if (/^\s+$/u.test(seg)) {
        chunks.push(' ');
        glue = false;
      } else if (OPENS.test(seg) || (EITHER.test(seg) && (!chunks.length || last() === ' '))) {
        join(seg);
        glue = true;
      } else if (CLINGS.test(seg) && chunks.length) {
        if (last() !== ' ') chunks[chunks.length - 1] += seg;
        else if (chunks.length >= 2) {
          chunks.pop(); // "QUOI ?": the mark keeps its word, and the space before it
          chunks[chunks.length - 1] += ' ' + seg;
        } else chunks.push(seg);
        glue = false;
      } else {
        join(seg);
        glue = false;
      }
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
