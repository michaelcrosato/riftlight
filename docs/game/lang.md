# Riftlight in every language

`src/riftlight/lang/`. The engine's side (lines, `t()`, choosing the language, the test languages,
drawing every writing system) is docs/engine/lang.md; this is how Riftlight uses it, and the rules
for its words (AI Hub Languages v1).

## The lines

`riftlightLines()` (`lang/index.ts`) is the game's one `LineList`: every line a player reads under
an id, with notes, widths, the proper names and the translator's brief (`lang/brief.ts`). It
gathers the areas' lines (`lang/ui.ts` and its neighbours: one `LineArea` per part of the game).
The page's `game-lines` block is this list (`npm run build:single` writes it).

The game shows a line with `t(id, values)` from `lang/index.ts`; `pageLanguage()` picks the page's
language at setup, says it on the page's `<html lang>`, and `installLanguage()` sets it (and how
text is drawn: `setTextLocale`).

### Rules for a line

- **One id per line**, lowercase words joined by dots, saying where it shows (`round.go`,
  `menu.title.new_run`). Never reuse an id for other words; keep an id once published.
- **Whole sentences with named blanks**: `'{name} reached level {level}'`, never
  `name + ' REACHED LEVEL ' + level`. A number that counts something gets plural forms picked by
  `{count}`: `{ one: '{count} kill', other: '{count} kills' }`.
- **Normal case.** The font draws capitals; lines are written as a sentence is (`New run`).
- **Names from parts** get a joining line (`'{prefix} {base} {suffix}'`), each part its own line.
- **Controls** are tags, `{key:dodge}`, never a key written into the sentence.
- **Notes** say who speaks, to whom, where it shows; **max** the width of a tight spot (a button).
- **Not lines**: debug text, numbers on their own, what players type, ids. Developer-only screens
  (the dev menu, tuning) use ids starting `dev.`: never translated.
- **Saves keep ids and values, never finished sentences**, so a save shows in today's language.

## Translations and the two builds

Development builds carry the lines and no translations: nothing to keep up to date while the game
changes. Translations are a separate step, at a release: kept as data in
`lang/translations/<code>.json` (`lang/translations.ts`), each line with the hash of the English it
was made from, so a line whose English changed since is **stale**: left out of the page (the player
sees the English, never an old meaning) until the next translation pass.

**The hand-over build** (`build:single -- --translations`) adds the page's `game-translations`
block: every stored language with its current lines.
