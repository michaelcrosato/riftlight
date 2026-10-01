// Hero clips. Getting around on foot: tiptoe, walk, run, skid, stepping up and down.
import { gaitClip, type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { HERO_RIG as RIG } from '../rig';
import { arm, leg, pelvis, squash, track, flat } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';

export const Tiptoe = gaitClip(RIG, {
  name: 'Tiptoe',
  frames: 18,
  speed: 1.2,
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
  plant: 0.15,
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

// Out of a skid, turning to run the other way: gather, hop, spin round in the air (the
// character's facing turns between frames 3 and 6, while both feet are off the floor),
// land and lean into the run. The feet never turn on the ground, so they never skate.
const TURN_AIR: Pose = {
  ...pelvis([0, 0, 0], [0, 0.2, 0], [0.95, 1.08, 0.95]),
  Torso: [-6, 0, 0],
  Head: [-6, 0, 0],
  ...arm('R', -125, 55, 30),
  ...arm('L', -60, 65, 40),
  ...leg('R', -55, 6, 95, 20),
  ...leg('L', -25, 6, 80, 20),
};
export const SkidTurn: ClipDef = {
  name: 'SkidTurn',
  frames: 12,
  fast: true,
  ...track([
    [0, SKID_BODY, SKID_FEET],
    [2, { ...SKID_BODY, ...pelvis([0, 0, 0], [0, -0.2, -0.04], squash(0.06)), Torso: [8, 0, 2], ...arm('R', 15, 30, 30), ...arm('L', 25, 35, 30) }, SKID_FEET, 'out'],
    [4, TURN_AIR, null, 'linear'],
    [6, { ...TURN_AIR, ...pelvis([0, 0, 0], [0, 0.14, 0]), ...arm('R', -95, 60, 30), ...arm('L', -45, 60, 35), ...leg('R', -25, 5, 45, 5), ...leg('L', -5, 5, 40, 5) }, null],
    [7, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.12, 0], squash(0.08)), Torso: [18, 0, 0], ...arm('R', -40, 30, 40), ...arm('L', 20, 30, 40) }, flat(0.12, -0.1), 'out'],
    [12, { ...STAND_BODY, Torso: [12, 0, 0], ...arm('R', -25, 15, 50), ...arm('L', 15, 15, 50) }, flat(0.08, -0.06)],
  ]),
  notes: 'Turnaround out of a skid: hop and spin to face the other way, land leaning into the run.',
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
