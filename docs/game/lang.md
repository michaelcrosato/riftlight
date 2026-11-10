# Riftlight in every language

`src/riftlight/lang/`. The engine's side (lines, `t()`, choosing the language, the test languages,
drawing every writing system) is docs/engine/lang.md; this is how Riftlight uses it, and the rules
for its words (AI Hub Languages v1).

## The lines

`riftlightLines()` (`lang/index.ts`) is the game's one `LineList`: every line a player reads under
an id, with notes, widths, the proper names and the translator's brief (`lang/brief.ts`). It
gathers the areas' lines: one `LineArea` per part of the game, each in its own file (`ui.ts`,
`shell.ts`, `panels.ts`, `town.ts`, `showcase.ts`, `items.ts`, `mods.ts`, `skills.ts`, `tree.ts`,
`monsters.ts`, `levels.ts`). The page's `game-lines` block is this list (`npm run build:single`
writes it); `npm run lang -- lines` counts it by area.

The game shows a line with `t(id, values)` from `lang/index.ts`; `pageLanguage()` picks the page's
language at setup, says it on the page's `<html lang>`, and `installLanguage()` sets it (and how
text is drawn: `setTextLocale`).

### Content brings its lines

An area built from a registry is a function (`ITEMS()`, `MONSTERS()`, `TREE()`, ...): every base,
affix, unique, skill, support, stat, monster part, boss, mechanic and tree node gives a line under
an id made from its own (`lineKey('item.base', base.id)`), so content added as data brings its
lines along. The registries keep their English (it *is* the source line); code shows it through the
area's helpers, never the registry's text:

| Area | Helpers |
| --- | --- |
| items (`loot/names.ts`) | `itemName`, `itemLabel`, `baseName`, `affixName`, `uniqueName`, `currencyName`, `rarityName`, `damageName`, `gemName`, `reasonText`, `lootFilterOptions` |
| mods (`lang/mods.ts`, `lang/modLines.ts`) | `modText` (core's `describeMod`, loot's `describeItemMods` and the tree's text all use it), `statName`, `tagWord`, `scopeName`, `conditionName`, `modList` |
| skills (`lang/skills.ts`) | `skillName`, `skillDescription`, `supportName`, `ailmentName`, `chargeName`, `curseName` |
| tree (`tree/text.ts`) | `nodeName`, `nodeFlavour`, `nodeLines`, `kindName`, `regionName` |
| monsters (`lang/monsters.ts`, `wire/monsters.ts`) | `monsterName(genome)`, `bossNameShown`, `partName`, `planName`, `eliteName` |
| levels (`lang/levels.ts`) | `levelName(spec)`, `mechanicName`, `mechanicText`, `themeName` |
| shell (`game/progress.ts`, `game/controls.ts`) | `levelTitle(spec)`, `formatTime`, `controlLabel` |

**Mind the import graph.** `lang/index` imports every area and the areas import the registries, so
nothing low in the graph (a registry, `core/mods`, `tree/data/`) may import `lang/index`: a module
read before it exists crashes the load. Mod text lives in `lang/modLines.ts` for that reason (it
never imports the line list), and areas stay function declarations.

### Rules for a line

- **One id per line**, lowercase words joined by dots, saying where it shows (`round.go`,
  `menu.title.new_run`). Never reuse an id for other words; keep an id once published.
- **Whole sentences with named blanks**: `'{name} reached level {level}'`, never
  `name + ' REACHED LEVEL ' + level`. A number that counts something gets plural forms picked by
  `{count}`: `{ one: '{count} kill', other: '{count} kills' }`. Numbers go in as blanks and are
  formatted for the language (`lang().formatNumber`).
- **Normal case.** The font draws capitals; lines are written as a sentence is (`New run`). No
  `toUpperCase()` on shown text (it breaks Turkish).
- **Names from parts** get a joining line, each part its own line: an item's
  `'{prefix} {base} {suffix}'`, a monster's `'{theme} {body}'`, a rift's `'Rift {depth}: {mechanics}'`,
  so a translation can reorder them.
- **Controls** are tags, `{key:dodge}`, never a key written into the sentence. `CONTROLS`
  (`game/controls.ts`) maps each action to its key, pad button and touch button; the shell sets
  `lang().controlLabel` to name them on the device in use (`controlDevice()`).
- **Notes** say who speaks, to whom, where it shows; **max** the width of a tight spot (a button).
- **Not lines**: debug text, numbers on their own, what players type, ids, a generated boss's
  invented name. Developer-only screens (the dev menu, the Loot Lab) use ids starting `dev.`: never
  translated. The pause menu's Tuning is the players' (difficulty presets): `menu.tuning.*`.
- **Saves keep ids and values, never finished sentences**, so a save shows in today's language: a
  rare item keeps its two `words`, a speech bubble its line id, the death recap what rebuilds a
  killer's name (a genome, a boss's id). Where a save must keep a name (the bestiary), it keeps the
  English (`sourceLang()`), so a run ends on the same fingerprint in any language. An old save
  holding English shows it as it is.
- **Proper names** (people, places, products) are in `NAMES` (`lang/brief.ts`).

## Showing the words

- **Choosing the language**: the hub's `?lang=`, then the player's choice, the browser's, English.
  The title's **Language** entry lists the languages the page has, each in its own name, and
  restarts in the one chosen; it shows only when the address has no `?lang=` (then the hub's menu
  is in charge) and the page has more than English (a development build has no translations). With
  `?lang=` the title also hides Engine World and the Asset Gallery (developer pages, not translated).
- **Room that grows**: text is measured (`textWidthPx`, `ui.measure`) and wrapped (`wrapText`, the
  kit's `wrap`), never counted in characters; boxes, columns and buttons grow to fit. A cut
  (`clip`) is the last resort. The 3×5 mini font draws only what it covers (`miniCovers`); other
  text falls back to the normal font, one row higher.
- **Other writing systems** go to the device's font (docs/engine/lang.md): the HUD does it itself;
  the tree view and the item windows draw their canvases at `surfaceScale` with device text.

## Checking

- **Tests per area** draw their screens under `en-XA` and fail on any word that isn't a line
  (`ui/panels.test.ts`, `showcase/words.test.ts`, `tree/tree.test.ts`, `lang/levels.headless.test.ts`,
  `ui/items/items.test.ts`); `lang/lines.test.ts` keeps every id, form and width valid and every
  `t('literal')` in the code a line.
- **`npm run lang -- audit [--lang en-XA]`** (after `npm run build`) plays the built game under a
  test language and lists every string drawn that isn't a line (`.scratch/lang/audit.json`, a
  picture per screen). The test, `strays()`, is `scripts/lang-strays.mjs`, shared with the tests
  and the hub package's browser check: under `en-XA` a word with a plain vowel is English (a line's
  vowels are all accented, wrapped rows included), elsewhere any word of Latin letters.

## Translations and the two builds

Development builds carry the lines and no translations: nothing to keep up to date while the game
changes. Translations are a separate step, at a release: kept as data in
`lang/translations/<code>.json` (`lang/translations.ts`), each line with the hash of the English it
was made from, so a line whose English changed since is **stale**: left out of the page (the player
sees the English, never an old meaning) until the next translation pass.

- `npm run lang -- status` shows each language's current, stale and missing lines;
- `npm run lang -- todo <code>` writes what a translator needs (missing and stale lines with their
  notes, widths, the names, the brief, the language's plural forms);
- `npm run lang -- apply <code> <file> --by <who>` files a translation after the checks (tags kept
  exactly, plural forms the language needs, within `max`); `npm run lang -- check` re-checks all.

**The hand-over build** (`build:single -- --translations`, which `npm run hub` makes: docs/game/hub.md)
adds the page's `game-translations` block: every stored language with its current lines.
