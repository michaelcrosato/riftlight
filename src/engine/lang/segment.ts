/**
 * One `Intl.Segmenter` per language and granularity, made once: building one costs about as much as
 * splitting a whole line with it, and the HUD, menus and wrapping split text every frame
 * (docs/engine/lang.md). Null where the browser has none (callers split on their own then).
 */
const made = new Map<string, Intl.Segmenter | null>();

export function segmenter(lang: string | undefined, granularity: 'grapheme' | 'word'): Intl.Segmenter | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  const key = `${lang ?? ''}|${granularity}`;
  let s = made.get(key);
  if (s === undefined) {
    try {
      s = new Intl.Segmenter(lang, { granularity });
    } catch {
      s = null; // an unknown locale
    }
    made.set(key, s);
  }
  return s;
}

/** The pieces of `text` at `granularity` in `lang` (whole letters, or words), or null without a segmenter. */
export function segmentsOf(text: string, lang: string | undefined, granularity: 'grapheme' | 'word'): string[] | null {
  const s = segmenter(lang, granularity);
  return s ? [...s.segment(text)].map((x) => x.segment) : null;
}
