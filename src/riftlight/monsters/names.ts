import type { Genome } from '../core/types';
import { ELITE_MODS } from './brains/elite';
import { genomeTags } from './genome';

/**
 * What a monster's name is built from, as ids (docs/game/lang.md *Names from parts*): its
 * first elite modifier (magic and rare monsters), a word for its theme and a word for its
 * body. `monsterName` (wire/monsters.ts) shows them through the joining line
 * ("Hasted Cinder Hound"); the words are the lines' English (lang/monsters.ts).
 */

/** A monster's theme (its parts' strongest theme tag) as a word; `none` for a monster without one. */
export const THEME_WORD: Readonly<Record<string, string>> = {
  fire: 'Cinder', ice: 'Frost', undead: 'Grave', insect: 'Chitin', beast: 'Feral', construct: 'Iron', void: 'Void', storm: 'Storm',
  poison: 'Blight', nature: 'Thorn', blood: 'Blood', earth: 'Stone', shadow: 'Shade', crystal: 'Crystal', arcane: 'Rune', water: 'Tide',
  none: 'Rift',
};

/** A monster's body plan as a word; `none` for a plan without one. */
export const PLAN_WORD: Readonly<Record<string, string>> = {
  biped: 'Stalker', brute: 'Brute', quadruped: 'Hound', hexapod: 'Crawler', serpent: 'Serpent', floater: 'Wisp', blob: 'Ooze', avian: 'Shrike', centipede: 'Centipede',
  none: 'Beast',
};

/** The words of a monster's name, as ids: `elite` an ELITE_MODS id (or null), `theme` a THEME_WORD key, `body` a PLAN_WORD key. */
export interface MonsterNameParts {
  readonly elite: string | null;
  readonly theme: string;
  readonly body: string;
}

export function monsterNameParts(g: Genome): MonsterNameParts {
  const tag = genomeTags(g)[0] ?? '';
  const elite = g.rank !== 'normal' && g.elite[0] && ELITE_MODS.has(g.elite[0]) ? g.elite[0] : null;
  return { elite, theme: tag !== 'none' && THEME_WORD[tag] ? tag : 'none', body: g.plan !== 'none' && PLAN_WORD[g.plan] ? g.plan : 'none' };
}
