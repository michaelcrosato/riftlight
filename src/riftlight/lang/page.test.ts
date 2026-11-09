import { describe, expect, it } from 'vitest';
import { lang, pageLanguage } from './index';

describe('the page language', () => {
  it("says the language it picked on the page's <html lang> (AI Hub Languages v1)", () => {
    const page = { documentElement: { lang: '' } };
    const picked = pageLanguage(page);
    expect(page.documentElement.lang).toBe(picked.code);
    expect(page.documentElement.lang).toBe('en'); // headless: no ?lang=, no saved choice, the game's own
    expect(lang().code).toBe('en');
  });

  it('headless, with no page, only picks', () => {
    expect(pageLanguage(undefined).code).toBe('en');
  });
});
