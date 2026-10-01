import { Registry } from '../../core/registry';
import type { MonsterPartDef } from '../types';
import { BACKS, CORES, MISC, SHOULDERS, TAILS, TENTACLES, WINGS } from './body';
import { EYES, HELMS, HORNS, JAWS, SPECIAL } from './face';
import { HEADS } from './heads';
import { FEET, HANDS, ORBS, WEAPONS } from './limbs';

/**
 * The parts library: hand-made, tagged, with mods and a budget cost. Add a part by
 * appending a `part(...)` entry to one of the family files (heads, face, body, limbs); the
 * generator finds it by slot (`fits`) and theme tags. Tag 'any' = fits every theme.
 */
export const PARTS = new Registry<MonsterPartDef>('parts', [
  ...HEADS,
  ...JAWS,
  ...EYES,
  ...HORNS,
  ...HELMS,
  ...SPECIAL,
  ...BACKS,
  ...SHOULDERS,
  ...WINGS,
  ...TAILS,
  ...CORES,
  ...TENTACLES,
  ...MISC,
  ...HANDS,
  ...WEAPONS,
  ...ORBS,
  ...FEET,
]);

export { part } from './kit';
