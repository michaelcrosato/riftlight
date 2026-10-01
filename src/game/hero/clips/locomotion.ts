// Hero clips. Getting around on foot: tiptoe, walk, run, skid, stepping up and down.
import { gaitClip, type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { HERO_RIG as RIG } from '../rig';
import { arm, pelvis, squash, track, flat } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';

export const Tiptoe = gaitClip(RIG, {
  name: 'Tiptoe',
  frames: 24,
  speed: 0.9,
  stance: 0.62,
  hip: -0.03,
  bob: 0.015,
  lift: 0.07,
  plant: 1,
  tiptoe: 22,
  toeOff: 10,
  lean: 10,
  twist: 6,
  head: -6,
  arms: { swing: 14, elbow: 95, spread: 28, forward: 35, lag: 0.08 },
  pose: { HandR: [-35, 0, 0], HandL: [-35, 0, 0] },
  notes: 'Sneaking on the balls of the feet, hands up like paws.',
});

export const Walk = gaitClip(RIG, {
  name: 'Walk',
  frames: 12,
  speed: 2,
  stance: 0.53,
  hip: -0.07,
  bob: 0.025,
  squash: 0.03,
  lift: 0.09,
  liftPeak: 0.35,
  plant: 1,
  heelStrike: 15,
  toeOff: 25,
  lean: 7,
  twist: 12,
  sway: 3,
  head: -4,
  arms: { swing: 32, elbow: 25, pump: 25, spread: 9 },
  pose: { HandR: [-15, 0, 0], HandL: [-15, 0, 0] },
  notes: 'Jaunty walk: heel-toe roll, bouncy hips, arms swing opposite the legs.',
});

export const Run = gaitClip(RIG, {
  name: 'Run',
  frames: 12,
  speed: 6,
  stance: 0.27,
  reach: -0.06,
  hip: -0.1,
  bob: 0.035,
  squash: 0.05,
  lift: 0.16,
  liftPeak: 0.35,
  dangle: 0.4,
  swingDelay: 0.15,
  swingReach: 0.08,
  plant: 1,
  toeOff: 30,
  lean: 18,
  twist: 16,
  head: -8,
  arms: { swing: 55, elbow: 85, pump: 12, spread: 12, lag: 0.05 },
  pose: { HandR: [-25, 0, 0], HandL: [-25, 0, 0] },
  notes: 'Full sprint: forward lean, flight phase, high knees, pumping fists.',
});

export const SKID_FEET: FeetGoals = { R: { z: 0.36, pitch: -30, pivot: 'heel' }, L: { z: -0.2, pitch: 10, pivot: 'ball' } };
export const SKID_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.14, -0.06]),
  Torso: [-18, 0, 4],
  Head: [8, 0, 0],
  ...arm('R', -115, 45, 25, 0),
  ...arm('L', -95, 55, 30, 0),
};
export const Skid: ClipDef = {
  name: 'Skid',
  frames: 18,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [4, SKID_BODY, SKID_FEET, 'out'],
    [18, { ...SKID_BODY, ...arm('R', -105, 45, 25, 0), ...arm('L', -105, 55, 30, 0) }, SKID_FEET],
  ]),
  notes: 'Brakes hard: leans back on the front heel, arms thrown forward.',
};

export const StepUp: ClipDef = {
  name: 'StepUp',
  frames: 8,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [3, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.04, 0]), Torso: [16, 0, 0], ...arm('R', 25, 10, 30), ...arm('L', -35, 10, 45) }, { R: { z: 0.2, y: 0.2 }, L: { z: -0.03 } }, 'out'],
    [8, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Knee drives up onto the step, body leans in.',
};

export const StepDown: ClipDef = {
  name: 'StepDown',
  frames: 8,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [3, { ...STAND_BODY, Torso: [-4, 0, 0], ...arm('R', -20, 25, 20), ...arm('L', 15, 25, 20) }, { R: { z: 0.2, y: 0.04, pitch: 20, pivot: 'ball' }, L: { z: -0.03 } }],
    [5, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.1, 0], squash(0.05)), Torso: [10, 0, 0] }, flat(0.08, -0.03), 'out'],
    [8, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Reaches down with the toe, absorbs the drop.',
};
