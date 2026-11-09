/**
 * Riftlight's translations, kept as data and added to the page only by the hand-over build
 * (docs/game/lang.md): `src/riftlight/lang/translations/<code>.json`, one file per language, each
 * line filed under its id with the hash of the English it was made from. A line whose English
 * changed since is **stale**: the hand-over build leaves it out (the player sees the English, never
 * an old meaning) and `translationStatus` lists it for the next translation pass. Development
 * builds carry no translations at all.
 *
 * Node only (build tools and tests): the game reads translations from its page's
 * `game-translations` block.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Line, type LineList, type Translation, type Translations } from '../../engine';
import { riftlightLines } from './index';

/** Where the translation files live. */
export const TRANSLATIONS_DIR = fileURLToPath(new URL('./translations/', import.meta.url));

/** One language as stored: the page's entry, plus the source hash of every line. */
export interface StoredTranslation extends Translation {
  /** Line id → `lineHash` of the English it was translated from. */
  readonly source: Readonly<Record<string, string>>;
}

/** A short, stable hash of a line's text (plural forms included), for telling when it changed. */
export function lineHash(line: Line): string {
  const text = typeof line === 'string' ? line : JSON.stringify(Object.keys(line).sort().map((k) => [k, line[k as keyof typeof line]]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The stored languages, by code. */
export function storedTranslations(dir = TRANSLATIONS_DIR): Record<string, StoredTranslation> {
  if (!existsSync(dir)) return {};
  const out: Record<string, StoredTranslation> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    out[file.slice(0, -5)] = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as StoredTranslation;
  }
  return out;
}

/** Per language: lines translated and current, stale (the English changed), missing; and lines no longer in the game. */
export interface TranslationStatus {
  readonly current: string[];
  readonly stale: string[];
  readonly missing: string[];
  readonly unknown: string[];
}

const translatable = (source: LineList): string[] => Object.keys(source.lines).filter((id) => !id.startsWith('dev.'));

export function translationStatus(stored: StoredTranslation, source: LineList = riftlightLines()): TranslationStatus {
  const current: string[] = [];
  const stale: string[] = [];
  const missing: string[] = [];
  for (const id of translatable(source)) {
    if (!(id in stored.lines)) missing.push(id);
    else if (stored.source[id] !== lineHash(source.lines[id]!)) stale.push(id);
    else current.push(id);
  }
  const unknown = Object.keys(stored.lines).filter((id) => !(id in source.lines));
  return { current, stale, missing, unknown };
}

/**
 * The page's `game-translations` block: every stored language with its current lines only (a stale
 * or retired line is left out, so the page shows the English for it).
 */
export function riftlightTranslations(dir = TRANSLATIONS_DIR, source: LineList = riftlightLines()): Translations {
  const out: Record<string, Translation> = {};
  for (const [code, stored] of Object.entries(storedTranslations(dir))) {
    const { current } = translationStatus(stored, source);
    const lines: Record<string, Line> = {};
    for (const id of current) lines[id] = stored.lines[id]!;
    out[code] = { by: stored.by, ...(stored.names && Object.keys(stored.names).length ? { names: stored.names } : {}), lines };
  }
  return out;
}
