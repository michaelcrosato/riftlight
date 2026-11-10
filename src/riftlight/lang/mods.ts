/**
 * The lines every bonus in the game is described with: stat names, scopes, tag words, conditions
 * and the sentence shapes (docs/game/lang.md), and the helpers that show them (`modText`,
 * `statName`, `tagWord`, `scopeName`, `conditionName`...). The lines and the describer are data
 * in modLines.ts, which core/mods.ts can use (`describeMod` is `modText`); this module is the
 * area the line list gathers, and from when it loads mods show in the player's language.
 */
import type { LineArea } from './area';
import { lang } from './index';
import { modLines, showModsIn } from './modLines';

export * from './modLines';

/** Every mod line (a function: called once, when the game's line list is made). */
export function MODS(): LineArea {
  return modLines();
}

showModsIn(lang);
