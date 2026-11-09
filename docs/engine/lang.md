# Languages: lines, translations, text in every writing system

`src/engine/lang/`, `src/engine/hud/deviceText.ts`, `src/engine/hud/wrap.ts`,
`src/engine/animation/font.ts`. The engine follows
[AI Hub Languages v1](https://raw.githubusercontent.com/michaelcrosato/ai-hub/main/lib/hub/languages.md):
a game is written in one language; every word a player reads is a **line** under an id; translation
is a separate step that adds a second table to the page without changing the game.

## Lines and translations

```ts
const lines: LineList = {
  version: 1, language: 'en',
  lines: {
    'menu.start': 'Start',
    'hud.lives': { zero: 'No lives left', one: '{count} life left', other: '{count} lives left' },
    'help.dodge': '{key:dodge} to dodge',
  },
  notes: { 'hud.lives': 'On the HUD, top left.' },   // who speaks, to whom, where it shows
  max: { 'menu.start': 12 },                          // width for tight spots (CJK counts two)
  names: ['Emberfall'], brief: 'What the game is, its tone, its people…',
};
const lang = langFor(lines);        // the page's language and its `game-translations` block
lang.t('hud.lives', { count: 3 });  // "3 lives left"
```

- **Ids** match `LINE_ID` (`^[a-z0-9_]+(\.[a-z0-9_]+)*$`) and say where the line is used; keep an
  id once published (translations are filed under it). Ids starting `dev.` are never translated.
- **A line** is a whole sentence with named `{blanks}`, never glued from pieces; plural forms
  (`zero one two few many other`, as `Intl.PluralRules` names them) when a number counts
  something, picked by `{count}`. Names built from parts get a joining line
  (`"item.name": "{prefix} {base} {suffix}"`) so a translation can reorder them.
- **`t(id, values)`** fills blanks (numbers formatted for the language with `Intl.NumberFormat`,
  and wrapped in Unicode isolates in right-to-left languages), control tags `{key:action}` from
  `lang.controlLabel(action)` (the key, pad button or touch button that does it on the device in
  use), and picks the plural form. **A missing, empty or broken translation shows the original
  line** (AI Hub's *Critical* rule); an unknown id shows the id.
- `lang.formatNumber(n)`, `lang.upper(text)` (Turkish İ), `lang.dir` (`rtl` for Arabic, Urdu…).

The page carries two blocks, written into the HTML (not by a script), in `<head>`:
`<script type="application/json" id="game-lines">` (the `LineList`) and, from the translation step,
`id="game-translations"` (`{ "<code>": { by, names?, lines } }`). Write both with `blockJson(data)`
(every `<` as `<`). `pageBlock(id)` reads one; a broken block reads as null.

## Choosing the language

`langFor(lines)` shows the first the game has of: `?lang=` (the AI Hub adds it every time, sessions
included), the player's choice from the game's Language menu (saved under
`languageKey(location.pathname)`), `navigator.languages`, the game's own. `pickLanguage` matches a
code in full, then the same language in the same writing system, then the same language: `zh-TW`
gets `zh-Hant`, `es-MX` `es-419`, `pt-PT` `pt-BR`. The Language menu belongs on the title screen,
shown only when the address has no `?lang=`; it lists `lang.available` by `languageName(code)` (each
in its own language) and `chooseLanguage(code)` saves the choice and reloads. The codes the hub
uses are `HUB_LANGUAGES`.

## The test languages

`?lang=en-XA`, `?lang=zh-XC` and `?lang=ar-XB` (`TEST_LANGUAGES`, chosen only by the address) are
made from the game's own lines (`fakeLine`): accented, bracketed and about 40% longer (or exactly
`max` wide); Chinese characters without spaces; Arabic letters, right to left. Plain text on screen
under `en-XA` is a line missing from the list; a missing `]` is a box that cuts text off; `?` or
boxes under `zh-XC` are a font without a fallback; text that doesn't run right to left under
`ar-XB` is direction not set where text is drawn.

## Drawing text in any writing system

The pixel font (`animation/font.ts`, 5×7 capitals in a 6×8 cell) draws every line in its
**capitals** (`fontCase`: `toLocaleUpperCase` in the language `setTextLocale(code)` set, so Turkish
i is İ). It **composes accented capitals** (`glyphFor`): a two-row mark above a five-row letter, a
mark below in the cell's eighth row, so Spanish, French, Portuguese, German, Italian, Dutch,
Polish, Turkish, Indonesian, Swahili, Hausa and Yoruba (and `en-XA`) stay in pixels
(`PIXEL_LANGUAGES`). Marks above a capital take the two rows over the cell, so lines of such text sit
at least 9 pixels apart. Compatibility forms draw as their plain letter (² as 2). Isolates and joiners
take no room; no-break and thin spaces are spaces.

Any other language (Vietnamese stacks its marks; Cyrillic, Chinese, Arabic, Hindi, Bengali,
Amharic... have their own letters) is drawn in the **device's own font** whenever a line holds a
letter (`pixelCovers` is false), never half and half on one screen. Device text
(`drawDeviceText`) sits in the same box as a pixel line, at the screen's own resolution: a surface
that holds it is painted `surfaceScale(framing.scale)` device pixels per art pixel, so an 8-pixel
row of Chinese is 32 device pixels on a 1080p screen, readable, with no layout change. The browser
joins Arabic letters, builds Devanagari ones and runs right-to-left text (`runsRtl`) right to left.
`ctx.hud` does all of this by itself; another 2D surface uses `textWidthPx`, `drawDeviceText` and
`surfaceScale` the same way. Without a canvas (Node), device text measures like the pixel font and
draws as `?`.

**Widths and wrapping.** Measure with `textWidthPx(text, scale)` (`hud.measure`), never by
`text.length`. `wrapText(text, width, measure?, lang?)` breaks at `Intl.Segmenter` word boundaries
(so Chinese and Japanese wrap between characters), keeps closing punctuation with the word before it
(a French space before `?` too) and opening marks (`¿ ¡ « (` and a quote after a space) with the word
after it, never breaks at a no-break space (`« BONJOUR »`, `12 500`), cuts a word wider than the
line between whole letters, and starts a paragraph at each `\n`. A device-font line runs the way its
first strong letter does, isolated runs skipped (`runsRtl`).

**Typewriters** reveal `pieces(line, lang)` one step at a time (whole letters; whole words in Arabic
script; a `{tag}` is one step that takes no time) and draw the revealed part as one string.

## Keys

Keys are read by `event.code` (their place), so WASD works on any keyboard layout. Never write a key
into a sentence: use a control tag, `{key:dodge}`.
