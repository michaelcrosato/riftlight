/**
 * STUB hero combat clips (the combat workstream ships the real ones): two sword slashes,
 * a cast, a dodge roll. Data on the hero rig, using the hero's clip helpers.
 */
import type { ClipDef, Pose } from '../../../engine/animation';
import { arm, pelvis, somersault, squash, track } from '../../../game/hero/clips/helpers';
import { CROUCH_BODY, CROUCH_FEET } from '../../../game/hero/clips/crouch';
import { STAND_BODY, STAND_FEET } from '../../../game/hero/clips/standing';

const LUNGE = { R: { z: 0.22 }, L: { z: -0.18 } };
const READY: Pose = { ...pelvis([0, 0, 0], [0, -0.07, 0]), Torso: [8, 0, 0], Head: [-6, 0, 0], ...arm('R', -40, 20, 70, 0), ...arm('L', -30, 20, 80, 0) };

export const Slash: ClipDef = {
  name: 'Slash',
  frames: 12,
  fast: true,
  grounded: true,
  ...track([
    [0, READY, LUNGE],
    [3, { ...READY, ...pelvis([0, 25, 0], [0, -0.06, 0]), Torso: [0, 30, 0], ...arm('R', -150, 70, 60, 10, -40) }, LUNGE, 'in'],
    [6, { ...READY, ...pelvis([0, -20, 0], [0, -0.1, 0], squash(0.03)), Torso: [16, -35, 0], ...arm('R', -70, -10, 10, 0, 30) }, LUNGE, 'out'],
    [12, READY, LUNGE],
  ]),
  notes: 'Stub: a diagonal sword slash from the right shoulder.',
};

export const Slash2: ClipDef = {
  name: 'Slash2',
  frames: 12,
  fast: true,
  grounded: true,
  ...track([
    [0, READY, LUNGE],
    [3, { ...READY, ...pelvis([0, -25, 0], [0, -0.06, 0]), Torso: [4, -30, 0], ...arm('R', -95, -40, 70, 0, 50) }, LUNGE, 'in'],
    [6, { ...READY, ...pelvis([0, 22, 0], [0, -0.1, 0], squash(0.03)), Torso: [14, 32, 0], ...arm('R', -95, 75, 5, 0, -40) }, LUNGE, 'out'],
    [12, READY, LUNGE],
  ]),
  notes: 'Stub: the backhand return slash.',
};

export const Cast: ClipDef = {
  name: 'Cast',
  frames: 16,
  fast: true,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [5, { ...CROUCH_BODY, Torso: [20, 0, 0], ...arm('R', -40, 40, 100), ...arm('L', -40, 40, 100) }, CROUCH_FEET, 'in'],
    [8, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, 0.02, 0]), Torso: [-10, 0, 0], Head: [-14, 0, 0], ...arm('R', -150, 60, 10), ...arm('L', -150, 60, 10) }, STAND_FEET, 'out'],
    [16, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Stub: gather and throw both arms up (nova, war cry).',
};

const TUCK: Pose = { ...CROUCH_BODY, Torso: [40, 0, 0], Head: [30, 0, 0], ...arm('R', -60, 20, 120), ...arm('L', -60, 20, 120) };
export const Roll: ClipDef = {
  name: 'Roll',
  frames: 14,
  fast: true,
  keys: [
    ...track([[0, STAND_BODY, STAND_FEET], [2, TUCK, CROUCH_FEET, 'linear']]).keys,
    ...somersault('x', 0, 360, 3, 11, TUCK, [0, 0.0, 0.2], 'inOut').map(([f, body]) => [f, { ...body, ...pelvis([(f - 3) * 45, 0, 0], [0, -0.3 + 0.1 * Math.sin(((f - 3) / 8) * Math.PI), 0]) }] as const),
    ...track([[12, CROUCH_BODY, CROUCH_FEET], [14, STAND_BODY, STAND_FEET]]).keys,
  ],
  notes: 'Stub: a quick forward roll.',
};

export const STUB_HERO_CLIPS: readonly ClipDef[] = [Slash, Slash2, Cast, Roll];
