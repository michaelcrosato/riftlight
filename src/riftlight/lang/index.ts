/**
 * Riftlight's words (docs/game/lang.md, AI Hub Languages v1): every line a player reads, under an
 * id, in one `LineList`, `riftlightLines()`. The game shows them through `t(id, values)` in the
 * player's language; the page's `game-lines` block is this list (`npm run build:single` writes
 * it), and translations come from its `game-translations` block (the hand-over build,
 * `build:single -- --translations`). Areas keep their lines beside their code's folder here (`ui.ts`, `data.ts`...).
 */
import { Lang, type LineList, type LineValues, langFor, setTextLocale } from '../../engine';
import { BRIEF, NAMES } from './brief';
import { UI } from './ui';

let lines: LineList | null = null;

/** Every line of the game, its notes and widths, the names and the translator's brief. */
export function riftlightLines(): LineList {
  if (lines) return lines;
  const all: Record<string, LineList['lines'][string]> = {};
  const notes: Record<string, string> = {};
  const max: Record<string, number> = {};
  for (const area of [UI]) {
    for (const [id, line] of Object.entries(area.lines)) {
      if (id in all) throw new Error(`riftlightLines: line ${id} is given twice`);
      all[id] = line;
    }
    Object.assign(notes, area.notes ?? {});
    Object.assign(max, area.max ?? {});
  }
  lines = { version: 1, language: 'en', lines: all, notes, max, names: NAMES, brief: BRIEF };
  return lines;
}

let current: Lang | null = null;

/** The language the game shows (English until the page's is installed). */
export function lang(): Lang {
  return (current ??= new Lang(riftlightLines()));
}

/** Show the game in `language` from now on (and draw its text the language's way). */
export function installLanguage(language: Lang): Lang {
  current = language;
  setTextLocale(language.code);
  return language;
}

/** The page's language: its `?lang=`, the player's choice, the browser's; its translations block. */
export function pageLanguage(): Lang {
  return installLanguage(langFor(riftlightLines()));
}

/** A line in the player's language, its blanks filled (docs/engine/lang.md). */
export function t(id: string, values?: LineValues): string {
  return lang().t(id, values);
}
