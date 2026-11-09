/**
 * Languages (AI Hub Languages v1, docs/engine/lang.md): every word a player reads is a line in one
 * table, `game-lines`, under an id; translations are a second table, `game-translations`, added by
 * a later step without changing the game. `t(id, values)` gives a line in the player's language
 * with its blanks filled; a missing, empty or broken translation shows the original line.
 *
 *   t('menu.start');                          // "Start"
 *   t('hud.lives', { count: 3 });             // plural forms, picked by {count}
 *   t('help.dodge', {});                      // "{key:dodge} to dodge": the game's controlLabel fills it
 *
 * The language is the first of: `?lang=` (the AI Hub adds it), the player's choice from the
 * game's Language menu (`chooseLanguage`), the browser's languages, the game's own. Three test
 * languages, chosen only by `?lang=`, are made from the game's own lines: `en-XA` (accented,
 * bracketed, 40% longer), `zh-XC` (Chinese characters, no spaces), `ar-XB` (right to left).
 */

export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export const PLURAL_FORMS: readonly PluralForm[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** A line: text with `{tags}`, or plural forms of it picked by `{count}`. */
export type Line = string | Partial<Record<PluralForm, string>>;

/** The `game-lines` block: the game's own words. */
export interface LineList {
  readonly version: 1;
  /** The game's own language (one of `HUB_LANGUAGES`). */
  readonly language: string;
  readonly lines: Readonly<Record<string, Line>>;
  readonly notes?: Readonly<Record<string, string>>;
  /** Widths, for lines with little room (a CJK character counts two; tags nothing). */
  readonly max?: Readonly<Record<string, number>>;
  /** Proper names, as written. */
  readonly names: readonly string[];
  /** The translator's brief. */
  readonly brief: string;
  readonly wordPlay?: boolean;
}

export interface Translation {
  readonly by: string;
  readonly names?: Readonly<Record<string, string>>;
  readonly lines: Readonly<Record<string, Line>>;
}

/** The `game-translations` block: one entry per language code. */
export type Translations = Readonly<Record<string, Translation>>;

/** Values for a line's blanks: `{count}` picks the plural form; numbers are formatted for the language. */
export type LineValues = Readonly<Record<string, string | number>>;

/** The AI Hub's languages (both sets), the game's own first when it is English. */
export const HUB_LANGUAGES: readonly string[] = ['en', 'zh-Hans', 'hi', 'es-419', 'ar', 'fr', 'bn', 'pt-BR', 'ru', 'id', 'ja', 'de', 'ko', 'zh-Hant', 'ur', 'tr', 'vi', 'sw', 'ha', 'am', 'yo'];

/** The test languages: chosen only by `?lang=`, made from the game's own lines. */
export const TEST_LANGUAGES: readonly string[] = ['en-XA', 'zh-XC', 'ar-XB'];

/** Line ids: lowercase words joined by dots. */
export const LINE_ID = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

const RTL = /^(ar|fa|ur|he|ps|sd|ug|yi|ckb|dv)\b/i;
const JOINED = /^(ar|fa|ur|ps|sd|ug|ckb)\b/i;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const TAG = /(\{[^{}]*\})/;

/** Written right to left. */
export const isRtl = (code: string): boolean => RTL.test(code);
/** Arabic script: letters join, so text is revealed a word at a time. */
export const isJoined = (code: string): boolean => JOINED.test(code);

const own = <T>(o: unknown, k: string): T | undefined => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? ((o as Record<string, T>)[k]) : undefined);

/** A line that can be shown: text, or plural forms that are all text. */
function usable(v: unknown): v is Line {
  return (typeof v === 'string' && v !== '') || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).length > 0 && Object.values(v).every((s) => typeof s === 'string' && s !== ''));
}

function localeParts(code: string): [string, string] | [] {
  try {
    const l = new Intl.Locale(code).maximize();
    return [l.language, l.script ?? ''];
  } catch {
    return [];
  }
}

/**
 * The language to show from `available`: the first wanted code (in order) that matches one in full,
 * then the same language in the same writing system, then the same language; else `fallback`. A
 * test language matches only as the first wanted code (the address).
 */
export function pickLanguage(available: readonly string[], wanted: readonly (string | null | undefined)[], fallback: string): string {
  const first = wanted[0];
  if (first && TEST_LANGUAGES.includes(first)) return first;
  for (const want of wanted) {
    if (!want) continue;
    const [language, script] = localeParts(want);
    const hit =
      available.find((a) => a.toLowerCase() === want.toLowerCase()) ||
      available.find((a) => { const p = localeParts(a); return p[0] === language && p[1] === script; }) ||
      available.find((a) => localeParts(a)[0] === language);
    if (hit) return hit;
  }
  return fallback;
}

/** A language's name in that language, for the Language menu: "Español latinoamericano", "繁體中文". */
export function languageName(code: string): string {
  let name = code;
  try {
    name = new Intl.DisplayNames([code], { type: 'language' }).of(code) || code;
  } catch {
    /* an engine without DisplayNames: the code */
  }
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}

/** A line's width for `max`: whole letters, a CJK character counting two; tags count nothing. */
export function lineWidth(line: string): number {
  const text = line.replace(/\{[^{}]*\}/g, '');
  return graphemes(text, 'en').reduce((n, g) => n + (CJK.test(g) ? 2 : 1), 0);
}

function graphemes(text: string, lang: string): string[] {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(lang, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return Array.from(text);
}

/**
 * What a typewriter reveals one step at a time: whole letters, or whole words in Arabic script. A
 * `{tag}` is one step that takes no time.
 */
export function pieces(line: string, lang: string): string[] {
  const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(lang, { granularity: isJoined(lang) ? 'word' : 'grapheme' }) : null;
  return line
    .split(TAG)
    .flatMap((part, i) => (i % 2 ? [part] : seg ? [...seg.segment(part)].map((s) => s.segment) : Array.from(part)))
    .filter((p) => p !== '');
}

const HAN = '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对';
const ARABIC = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const ACCENT: Readonly<Record<string, string>> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', n: 'ñ', c: 'ç', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', N: 'Ñ' };

/** A test language made from a line before its blanks are filled. */
export function fakeLine(line: string, lang: string, max?: number): string {
  const out = line
    .split(TAG)
    .map((part, i) => {
      if (i % 2) return part; // a tag stays as it is
      if (lang === 'zh-XC')
        return part
          .replace(/[\p{L}\p{M}]+/gu, (w) => Array.from({ length: Math.ceil([...w].length / 2) }, (_, k) => HAN[((w.codePointAt(k) ?? 0) * 7 + k) % HAN.length]).join(''))
          .replace(/[,.!?:;]/g, (p) => '，。！？：；'[',.!?:;'.indexOf(p)]!)
          .replace(/[ \t]+/g, '');
      if (lang === 'ar-XB') return part.replace(/\p{L}\p{M}*/gu, (c) => ARABIC[(c.codePointAt(0) ?? 0) % ARABIC.length]!);
      return part.replace(/[aeiounc]/gi, (c) => ACCENT[c] ?? c);
    })
    .join('');
  if (lang !== 'en-XA') return out;
  if (max) return '[' + out + '·'.repeat(Math.max(0, max - lineWidth(out) - 2)) + ']';
  return out
    .split('\n')
    .map((p) => '[' + p + ' ' + '·'.repeat(Math.ceil(lineWidth(p) * 0.4)) + ']')
    .join('\n');
}

/** Read a JSON block written into the page (`<script type="application/json" id>`), or null. */
export function pageBlock<T>(id: string): T | null {
  if (typeof document === 'undefined') return null;
  try {
    const el = document.getElementById(id);
    return el ? (JSON.parse(el.textContent ?? '') as T) : null;
  } catch {
    return null;
  }
}

/** Write a block's JSON for a page: every `<` as <, so no line can end the block early. */
export function blockJson(data: unknown, space?: number): string {
  return JSON.stringify(data, null, space).replace(/</g, '\\u003c');
}

/** The storage key of the player's choice from the Language menu. */
export function languageKey(path: string): string {
  return 'lang:' + path;
}

export interface LangOptions {
  /** The language to show, as chosen (`chooseFrom` picks one from the page). Default the game's own. */
  readonly code?: string;
}

/**
 * A game's lines and the language they show in. `t()` fills a line; `dir` is where text that is
 * drawn runs (`el.dir`, `ctx.direction`).
 */
export class Lang {
  /** The language lines show in (a test language too). */
  readonly code: string;
  readonly dir: 'ltr' | 'rtl';
  /** A test language (`en-XA`, `zh-XC`, `ar-XB`). */
  readonly fake: boolean;
  /** The key, gamepad symbol or touch button that does an action on the device in use (`{key:jump}`). */
  controlLabel: (action: string) => string = (action) => action;
  private readonly table: Readonly<Record<string, Line>>;
  private readonly plurals = new Map<string, Intl.PluralRules>();
  private readonly numbers = new Map<string, Intl.NumberFormat>();

  constructor(
    readonly source: LineList,
    readonly translations: Translations = {},
    options: LangOptions = {},
  ) {
    const code = options.code ?? source.language;
    this.code = code;
    this.fake = TEST_LANGUAGES.includes(code);
    this.dir = isRtl(code) ? 'rtl' : 'ltr';
    this.table = (own<Translation>(translations, code)?.lines as Record<string, Line> | undefined) ?? {};
  }

  /** The languages this game has: its own, then its translations. */
  get available(): string[] {
    return [this.source.language, ...Object.keys(this.translations).filter((c) => c !== this.source.language)];
  }

  /** Does the game have this line (in its own language)? */
  has(id: string): boolean {
    return usable(own(this.source.lines, id));
  }

  /**
   * A line in the player's language, its tags filled: `{name}` from `values` (numbers formatted
   * for the language), `{key:action}` from `controlLabel`, plural forms by `{count}`. A missing,
   * empty or broken translation shows the original line; an unknown id shows the id.
   */
  t(id: string, values: LineValues = {}): string {
    const translatedLine = own<Line>(this.table, id);
    const translated = usable(translatedLine);
    const textLang = translated ? this.code : this.source.language;
    const raw: unknown = translated ? translatedLine : own(this.source.lines, id);
    if (!usable(raw)) return id;
    let line: string;
    if (typeof raw === 'string') line = raw;
    else {
      const n = Number(values.count ?? 0);
      line = (n === 0 && raw.zero) || raw[this.plural(textLang).select(n) as PluralForm] || raw.other || Object.values(raw)[0]!;
    }
    if (this.fake) line = fakeLine(line, this.code, own<number>(this.source.max, id));
    line = line
      .replace(/\{key:(\w+)\}/g, (_, action: string) => this.controlLabel(action))
      .replace(/\{(\w+)\}/g, (tag, name: string) => {
        if (!Object.prototype.hasOwnProperty.call(values, name)) return tag;
        const v = values[name]!;
        const text = typeof v === 'number' ? this.number(textLang).format(v) : String(v);
        return this.dir === 'rtl' ? '\u2068' + text + '\u2069' : text; // isolated: a Latin name can't scramble the line
      });
    if (!translated && !this.fake && isRtl(this.source.language) !== (this.dir === 'rtl')) line = '\u2068' + line + '\u2069';
    return line;
  }

  /** A number formatted for the language (12,500 · 12.500 · 12 500). */
  formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
    const lang = this.fake ? this.source.language : this.code;
    return options ? new Intl.NumberFormat(lang, options).format(n) : this.number(lang).format(n);
  }

  /** Capitals the language's way (Turkish i → İ). */
  upper(text: string): string {
    return text.toLocaleUpperCase(this.fake ? this.source.language : this.code);
  }

  /** A typewriter's steps for a filled line, in this language (`pieces`). */
  pieces(line: string): string[] {
    return pieces(line, this.code);
  }

  private plural(lang: string): Intl.PluralRules {
    let rules = this.plurals.get(lang);
    if (!rules) {
      try {
        rules = new Intl.PluralRules(lang);
      } catch {
        rules = new Intl.PluralRules('en');
      }
      this.plurals.set(lang, rules);
    }
    return rules;
  }

  private number(lang: string): Intl.NumberFormat {
    let f = this.numbers.get(lang);
    if (!f) {
      try {
        f = new Intl.NumberFormat(lang);
      } catch {
        f = new Intl.NumberFormat('en');
      }
      this.numbers.set(lang, f);
    }
    return f;
  }
}

/** Where the language comes from on a page: its address, the saved choice, the browser. */
export interface LanguageSources {
  /** `?lang=` (the AI Hub always adds it). */
  readonly asked?: string | null;
  /** The player's choice from the game's Language menu. */
  readonly saved?: string | null;
  /** `navigator.languages`. */
  readonly browser?: readonly string[];
}

/** This page's sources: its address, the saved choice for its path, the browser's languages. */
export function pageLanguageSources(): LanguageSources {
  if (typeof location === 'undefined') return {};
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(languageKey(location.pathname));
  } catch {
    /* storage blocked: no saved choice */
  }
  return {
    asked: new URLSearchParams(location.search).get('lang'),
    saved,
    browser: typeof navigator !== 'undefined' ? [...(navigator.languages ?? [])] : [],
  };
}

/**
 * A game's `Lang` from its lines and the page: the translations come from the page's
 * `game-translations` block (a missing or broken one is no translations), the language from
 * `sources` (default this page's). In Node, pass `sources` (or none: the game's own language).
 */
export function langFor(source: LineList, sources: LanguageSources = pageLanguageSources(), translations: Translations | null = pageBlock<Translations>('game-translations')): Lang {
  const table = translations && typeof translations === 'object' && !Array.isArray(translations) ? translations : {};
  const available = [source.language, ...Object.keys(table)];
  const code = pickLanguage(available, [sources.asked, sources.saved, ...(sources.browser ?? [])], source.language);
  return new Lang(source, table, { code });
}

/**
 * The Language menu's choice: saved for this page, then the game restarts in it. Shown only when
 * the address has no `?lang=` (the hub's own menu is in charge then).
 */
export function chooseLanguage(code: string): void {
  if (typeof location === 'undefined') return;
  try {
    localStorage.setItem(languageKey(location.pathname), code);
  } catch {
    /* storage blocked: the choice lasts this load */
  }
  location.reload();
}
