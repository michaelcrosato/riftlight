// What drawn text under a test language isn't a line (AI Hub Languages v1, *Testing with three test
// languages*; docs/game/lang.md): the one test the language audit (`npm run lang -- audit`), the AI
// Hub package's browser check (`npm run hub`) and the game's tests share.

/** en-XA's marks: brackets round a line, its vowels (and n, c) accented (src/engine/lang/lang.ts fakeLine). */
const EN_XA = /[[\]áéíóúñçÁÉÍÓÚÑ]/;

/**
 * The words in a drawn string that aren't the test language (proper names, digits and symbols aside).
 * Under en-XA every vowel of a line is accented, so in a string with en-XA's marks a word with a
 * plain vowel is English: a word that isn't a line, or an English value filled into a line's blank
 * (a wrapped line's middle rows have no brackets, but no plain vowels either). A string with no marks
 * is English wherever it has a word of Latin letters (zh-XC and ar-XB have none).
 */
export function strays(text, names = []) {
  let rest = text;
  for (const n of [...names].sort((a, b) => b.length - a.length)) rest = rest.split(n.toUpperCase()).join(' ').split(n).join(' ');
  if (!EN_XA.test(text)) return rest.match(/[A-Za-z]{2,}/g) ?? [];
  return (rest.match(/[A-Za-zÀ-ɏ]{2,}/g) ?? []).filter((w) => /[aeiouAEIOU]/.test(w));
}
