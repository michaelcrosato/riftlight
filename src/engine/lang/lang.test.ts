import { describe, expect, it } from 'vitest';
import { blockJson, fakeLine, isRtl, Lang, langFor, languageName, lineWidth, pickLanguage, pieces, type LineList, type Translations } from './lang';

const SOURCE: LineList = {
  version: 1,
  language: 'en',
  lines: {
    'menu.start': 'Start',
    'hud.lives': { zero: 'No lives left', one: '{count} life left', other: '{count} lives left' },
    'pip.relay': '{player}, the relay is dark. Stay on my wing.',
    'help.jump': '{key:jump} to jump',
    'hud.gold': '{gold} gold',
  },
  max: { 'menu.start': 12 },
  names: ['Pip'],
  brief: 'A test.',
};

const TRANSLATIONS: Translations = {
  'es-419': { by: 'test', lines: { 'menu.start': 'Empezar', 'hud.lives': { zero: 'Sin vidas', one: 'Te queda {count} vida', other: 'Te quedan {count} vidas' }, 'pip.relay': '' } },
  ru: { by: 'test', lines: { 'hud.lives': { one: 'Осталась {count} жизнь', few: 'Осталось {count} жизни', many: 'Осталось {count} жизней', other: 'Осталось {count} жизни' }, 'menu.start': 42 as unknown as string } },
  ar: { by: 'test', lines: { 'hud.gold': '{gold} ذهب' } },
};

describe('t(): a line, its blanks filled', () => {
  it('fills blanks and picks plural forms by {count}', () => {
    const en = new Lang(SOURCE);
    expect(en.t('menu.start')).toBe('Start');
    expect(en.t('hud.lives', { count: 0 })).toBe('No lives left');
    expect(en.t('hud.lives', { count: 1 })).toBe('1 life left');
    expect(en.t('hud.lives', { count: 3 })).toBe('3 lives left');
    expect(en.t('pip.relay', { player: 'Vex' })).toBe('Vex, the relay is dark. Stay on my wing.');
  });

  it('formats numbers for the language', () => {
    expect(new Lang(SOURCE).t('hud.gold', { gold: 12500 })).toBe('12,500 gold');
    const ar = new Lang(SOURCE, TRANSLATIONS, { code: 'ar' });
    expect(ar.t('hud.gold', { gold: 12500 })).toBe(`\u2068${new Intl.NumberFormat('ar').format(12500)}\u2069 ذهب`); // isolated: can't scramble the line
  });

  it('uses the language’s plural forms', () => {
    const ru = new Lang(SOURCE, TRANSLATIONS, { code: 'ru' });
    expect(ru.t('hud.lives', { count: 1 })).toBe('Осталась 1 жизнь');
    expect(ru.t('hud.lives', { count: 3 })).toBe('Осталось 3 жизни');
    expect(ru.t('hud.lives', { count: 5 })).toBe('Осталось 5 жизней');
    expect(ru.t('hud.lives', { count: 21 })).toBe('Осталась 21 жизнь');
  });

  it('control tags ask the game for the key that does the action', () => {
    const en = new Lang(SOURCE);
    en.controlLabel = (action) => (action === 'jump' ? 'Space' : action);
    expect(en.t('help.jump')).toBe('Space to jump');
  });

  it('CRITICAL: a missing, empty or broken translation shows the original line', () => {
    const es = new Lang(SOURCE, TRANSLATIONS, { code: 'es-419' });
    expect(es.t('menu.start')).toBe('Empezar');
    expect(es.t('pip.relay', { player: 'Vex' })).toBe('Vex, the relay is dark. Stay on my wing.'); // empty
    expect(es.t('hud.gold', { gold: 3 })).toBe('3 gold'); // missing
    const ru = new Lang(SOURCE, TRANSLATIONS, { code: 'ru' });
    expect(ru.t('menu.start')).toBe('Start'); // not text
    const broken = new Lang(SOURCE, { fr: 'nonsense' as unknown as Translations[string] }, { code: 'fr' });
    expect(broken.t('menu.start')).toBe('Start');
    expect(new Lang(SOURCE).t('no.such.line')).toBe('no.such.line');
  });

  it('a translated plural with a broken form falls back to the original', () => {
    const odd = new Lang(SOURCE, { de: { by: 't', lines: { 'hud.lives': { one: 'x', other: 7 as unknown as string } } } }, { code: 'de' });
    expect(odd.t('hud.lives', { count: 2 })).toBe('2 lives left');
  });

  it('upper-cases the language’s way (Turkish i → İ)', () => {
    expect(new Lang(SOURCE, { tr: { by: 't', lines: {} } }, { code: 'tr' }).upper('istif')).toBe('İSTİF');
    expect(new Lang(SOURCE).upper('istif')).toBe('ISTIF');
  });
});

describe('choosing the language', () => {
  const available = ['en', 'es-419', 'zh-Hans', 'zh-Hant', 'pt-BR', 'ar'];
  it('the address first, then the saved choice, the browser, the game’s own', () => {
    expect(pickLanguage(available, ['ar', 'es-419'], 'en')).toBe('ar');
    expect(pickLanguage(available, [null, 'es-419', 'ar'], 'en')).toBe('es-419');
    expect(pickLanguage(available, [null, null, 'fr', 'de'], 'en')).toBe('en');
  });

  it('matches in full, then the same language and writing, then the same language', () => {
    expect(pickLanguage(available, ['zh-TW'], 'en')).toBe('zh-Hant');
    expect(pickLanguage(available, ['zh-CN'], 'en')).toBe('zh-Hans');
    expect(pickLanguage(available, ['es-MX'], 'en')).toBe('es-419');
    expect(pickLanguage(available, ['pt-PT'], 'en')).toBe('pt-BR');
  });

  it('a test language only from the address', () => {
    expect(pickLanguage(available, ['en-XA'], 'en')).toBe('en-XA');
    expect(pickLanguage(available, [null, 'zh-XC'], 'en')).not.toBe('zh-XC');
  });

  it('langFor reads the page’s sources; a broken translations block is no translations', () => {
    const lang = langFor(SOURCE, { asked: 'es-MX' }, TRANSLATIONS);
    expect(lang.code).toBe('es-419');
    expect(langFor(SOURCE, { asked: 'es-MX' }, null).code).toBe('en');
    expect(langFor(SOURCE, { asked: 'ar-XB' }, null).dir).toBe('rtl');
  });

  it('names each language in itself', () => {
    expect(languageName('es-419')).toMatch(/^Español/);
    expect(languageName('zh-Hant')).toBe('繁體中文');
  });
});

describe('the test languages', () => {
  it('en-XA: accented, bracketed, about 40% longer, or exactly max wide', () => {
    const xa = new Lang(SOURCE, {}, { code: 'en-XA' });
    const relay = xa.t('pip.relay', { player: 'Vex' });
    expect(relay.startsWith('[Vex, thé réláy ís dárk. Stáy óñ my wíñg. ·')).toBe(true);
    expect(relay.endsWith('·]')).toBe(true);
    const body = '{player}, thé réláy ís dárk. Stáy óñ my wíñg.';
    expect(fakeLine(SOURCE.lines['pip.relay'] as string, 'en-XA')).toBe(`[${body} ${'·'.repeat(Math.ceil(lineWidth(body) * 0.4))}]`);
    const start = xa.t('menu.start');
    expect(start).toBe('[Stárt·····]');
    expect(lineWidth(start)).toBe(12);
  });

  it('zh-XC: Chinese characters, no spaces; tags kept', () => {
    const line = fakeLine('{player}, the relay is dark.', 'zh-XC');
    expect(line.startsWith('{player}，')).toBe(true);
    expect(line.replace('{player}', '')).not.toMatch(/[a-z ]/);
    expect(new Lang(SOURCE, {}, { code: 'zh-XC' }).t('pip.relay', { player: 'Vex' }).startsWith('Vex')).toBe(true);
  });

  it('ar-XB: Arabic letters, right to left', () => {
    const ar = new Lang(SOURCE, {}, { code: 'ar-XB' });
    expect(ar.dir).toBe('rtl');
    expect(ar.t('menu.start')).toMatch(/^[\u0600-\u06ff]+$/);
    expect(isRtl('ar-XB')).toBe(true);
  });
});

describe('typewriter pieces and widths', () => {
  it('whole letters, a tag one step; Arabic script by word', () => {
    expect(pieces('ab{w=.5}c', 'en')).toEqual(['a', 'b', '{w=.5}', 'c']);
    expect(pieces('नमस्ते', 'hi').length).toBeLessThan([...'नमस्ते'].length); // built letters stay whole
    expect(pieces('مرحبا بك', 'ar')).toEqual(['مرحبا', ' ', 'بك']);
  });

  it('a CJK character counts two; tags nothing', () => {
    expect(lineWidth('你好{count}ab')).toBe(6);
  });

  it('blocks write < as \\u003c', () => {
    expect(blockJson({ a: '</script>' })).toBe('{"a":"\\u003c/script>"}');
  });
});
