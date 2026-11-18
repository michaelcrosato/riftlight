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
import { HUB_LANGUAGES, lineWidth, PLURAL_FORMS } from '../../engine/lang/lang';
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

/**
 * The plural forms a language needs (Intl.PluralRules), always in `PLURAL_FORMS` order (zero, one,
 * two, few, many, other): V8 lists a language's categories in an order that changes between Node
 * versions (French is `one many other` on Node 24, `many one other` on Node 22), and the checks and
 * `npm run lang -- todo` must say the same thing on every Node. An unknown code needs `other` only.
 */
export function pluralFormsOf(code: string): string[] {
  let categories: readonly string[] = ['other'];
  try {
    categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  } catch {
    /* an unknown code: other only */
  }
  return PLURAL_FORMS.filter((f) => categories.includes(f));
}

const tagsOf = (s: string): string[] => s.match(/\{[^{}]*\}/g) ?? [];
const texts = (l: Line): string[] => (typeof l === 'string' ? [l] : Object.values(l).filter((v): v is string => typeof v === 'string'));

/**
 * Problems with one translated line (empty when it can be filed), the checks of AI Hub Languages
 * v1 *Translating*: the id is the game's (dev. lines skipped), a line is text or plural forms of
 * text, it keeps the original's {tags} exactly (paired tags in order; {count} may go only where a
 * form means one number), a plural line has the forms its language needs (Intl.PluralRules), and a
 * line with a max keeps within it. `npm run lang -- apply` files only lines without any.
 */
export function lineProblems(code: string, id: string, line: unknown, source: LineList = riftlightLines()): string[] {
  const orig = source.lines[id];
  if (!orig) return [`${id}: not a line of the game`];
  if (id.startsWith('dev.')) return [`${id}: dev. lines are not translated`];
  const ok = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
  const bad: string[] = [];
  if (typeof orig === 'string') {
    if (!ok(line)) return [`${id}: a line is text`];
    const want = tagsOf(orig).sort().join();
    if (tagsOf(line).sort().join() !== want) bad.push(`${id}: tags ${tagsOf(line).join(' ')} ≠ ${tagsOf(orig).join(' ')}`);
    const paired = (s: string) => tagsOf(s).filter((t) => /^\{\/?[a-z]+(=|\})/.test(t) && /^\{\/|=/.test(t));
    if (paired(line).join() !== paired(orig).join()) bad.push(`${id}: paired tags out of order`);
  } else {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return [`${id}: plural forms (an object)`];
    const forms = line as Record<string, unknown>;
    for (const f of pluralFormsOf(code)) if (!ok(forms[f])) bad.push(`${id}: needs the plural form ${f}`);
    for (const [f, v] of Object.entries(forms)) {
      if (!PLURAL_FORMS.includes(f as never)) bad.push(`${id}: ${f} is not a plural form`);
      if (!ok(v)) bad.push(`${id}: form ${f} is empty`);
      else {
        const want = tagsOf(texts(orig)[0]!).filter((t) => t !== '{count}').sort().join();
        if (tagsOf(v).filter((t) => t !== '{count}').sort().join() !== want) bad.push(`${id}.${f}: tags ${tagsOf(v).join(' ')}`);
      }
    }
  }
  const max = source.max?.[id];
  if (max) for (const s of texts(line as Line)) if (lineWidth(s) > max) bad.push(`${id}: ${lineWidth(s)} wide, max ${max}`);
  return bad;
}

/**
 * Problems with a stored language (`npm run lang -- check`, and `npm test` through
 * `lang/translations.test.ts`): a code the hub takes, and `lineProblems` for every current line,
 * the ones the hand-over build ships. A stale line (its English changed since) is left out of the
 * page and listed for the next translation pass, so changing the English never fails a check.
 */
export function translationProblems(code: string, stored: StoredTranslation, source: LineList = riftlightLines()): string[] {
  const problems: string[] = [];
  if (!HUB_LANGUAGES.includes(code) || code === source.language) problems.push(`${code} is not a language the hub takes`);
  for (const id of translationStatus(stored, source).current) problems.push(...lineProblems(code, id, stored.lines[id], source));
  return problems;
}
