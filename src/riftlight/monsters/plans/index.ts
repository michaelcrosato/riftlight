import { Registry } from '../../core/registry';
import type { BodyPlanDef } from '../types';
import { avian } from './avian';
import { biped, brute } from './biped';
import { blob } from './blob';
import { centipede } from './centipede';
import { floater } from './floater';
import { hexapod } from './hexapod';
import { quadruped } from './quadruped';
import { serpent } from './serpent';

/**
 * Body plans: hand-made skeleton grammars. Add a plan by writing a `BodyPlanDef` (genes,
 * slot chances, mods and a `build` that describes the skeleton with `SkeletonBuilder`) and
 * listing it here; the generator, animation, lab and CLI pick it up.
 */
export const PLANS = new Registry<BodyPlanDef>('plans', [biped, brute, quadruped, hexapod, serpent, floater, blob, avian, centipede]);

export { SkeletonBuilder, gene, SX, type Side } from './builder';
export { DEFAULT_HEAD } from './common';
