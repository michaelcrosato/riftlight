// Hero clips. Emotes and reactions: wave, victory, hurt.
import { type ClipDef, type Pose } from '../../../engine/animation';
import { arm, arms, leg, pelvis, squash, track, flat } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';
import { CROUCH_BODY } from './crouch';
import { STRETCH } from './air';

const waveUp = (out: number, elbow: number): Pose => ({ ...STAND_BODY, Torso: [2, 0, -4], Head: [-8, 0, 8], ...arm('R', -15, out, elbow, 0, 60) });
export const Wave: ClipDef = {
  name: 'Wave',
  frames: 44,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [7, waveUp(150, 40), STAND_FEET, 'out'],
    [12, waveUp(165, 20), STAND_FEET],
    [17, waveUp(142, 55), STAND_FEET],
    [22, waveUp(165, 20), STAND_FEET],
    [27, waveUp(142, 55), STAND_FEET],
    [32, waveUp(160, 30), STAND_FEET],
    [44, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Friendly wave over the head.',
};

const VICTORY_POSE: Pose = { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.02, 0]), Torso: [-6, 0, 0], Head: [-12, 0, 0], ...arm('R', -165, 28, 20), ...arm('L', 15, 35, 115) };
export const Victory: ClipDef = {
  name: 'Victory',
  fast: true,
  frames: 48,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [7, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.2, -0.05], squash(0.08)), Torso: [20, 0, 0], ...arms(20, 20, 60) }, STAND_FEET, 'out'],
    [13, { ...STRETCH, ...pelvis([0, 20, 0], [0, 0.35, 0], [0.92, 1.12, 0.92]), ...arm('R', -178, 10, 0), ...arm('L', 10, 40, 110), ...leg('R', 10, 4, 20, 45), ...leg('L', -60, 4, 90, 30) }, null],
    [20, { ...STRETCH, ...pelvis([0, 20, 0], [0, 0.3, 0]), ...arm('R', -178, 10, 0), ...arm('L', 10, 40, 110), ...leg('R', 5, 4, 30, 45), ...leg('L', -50, 4, 80, 30) }, null],
    [26, { ...STAND_BODY, ...pelvis([0, 10, 0], [0, -0.14, 0], squash(0.1)), Torso: [12, 0, 0], ...arm('R', -175, 10, 10), ...arm('L', 10, 40, 110) }, flat(0.06, -0.06), 'out'],
    [34, VICTORY_POSE, flat(0.06, -0.06)],
    [48, { ...VICTORY_POSE, ...arm('R', -168, 24, 15) }, flat(0.06, -0.06)],
  ]),
  notes: 'Star get: crouch, leap with a fist in the air, land and hold the pose.',
};

export const Hurt: ClipDef = {
  name: 'Hurt',
  fast: true,
  frames: 20,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [3, { ...STAND_BODY, ...pelvis([-12, 0, 0], [0, -0.06, -0.05]), Torso: [-18, 0, 0], Head: [-25, 0, 0], ...arms(-110, 35, 20) }, STAND_FEET, 'out'],
    [10, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.12, 0]), Torso: [20, 0, 0], Head: [15, 0, 0], ...arms(-20, 25, 40) }, STAND_FEET],
    [20, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Knocked back, then doubles over.',
};
