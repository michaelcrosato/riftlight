// Hero clips. Low to the floor: crouch, crouch walk and slide, prone and crawl, sit, lie down, sleep.
import { gaitClip, type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { HERO_RIG as RIG } from '../rig';
import { type Side, arm, arms, leg, pelvis, track, flat } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';

export const CROUCH_FEET = flat(0.12, 0.04);
export const CROUCH_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.3, -0.1]),
  Torso: [40, 0, 0],
  Head: [-28, 0, 0],
  ...arm('R', -35, 16, 45, 15),
  ...arm('L', -35, 16, 45, 15),
};
export const Crouch: ClipDef = {
  name: 'Crouch',
  frames: 40,
  loop: true,
  grounded: true,
  ...track([
    [0, CROUCH_BODY, CROUCH_FEET],
    [20, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.31, -0.1]), Torso: [38, 0, 0], ...arm('R', -33, 18, 45, 15), ...arm('L', -33, 18, 45, 15) }, CROUCH_FEET],
    [40, CROUCH_BODY, CROUCH_FEET],
  ]),
  notes: 'Deep squat, hips back, forearms forward, eyes up.',
};

export const CrouchWalk = gaitClip(RIG, {
  name: 'CrouchWalk',
  frames: 12,
  speed: 1.4,
  stance: 0.62,
  hip: -0.17,
  bob: 0.012,
  lift: 0.06,
  liftPeak: 0.25,
  plant: 1,
  dangle: 0.2,
  heelStrike: 5,
  toeOff: 35,
  lean: 36,
  twist: 8,
  head: -14,
  arms: { swing: 14, elbow: 45, forward: 35, spread: 16 },
  notes: 'Duck walk: low, short steps, arms ready.',
});

const CSLIDE_FEET: FeetGoals = { R: { z: 0.3, pitch: -15, pivot: 'heel' }, L: { z: -0.1, pitch: 20, pivot: 'ball' } };
const CSLIDE: Pose = { ...pelvis([0, 0, 0], [0, -0.3, -0.05]), Torso: [22, 0, 0], Head: [-18, 0, 0], ...arm('R', 30, 30, 30), ...arm('L', 30, 30, 30) };
export const CrouchSlide: ClipDef = {
  name: 'CrouchSlide',
  frames: 20,
  loop: true,
  grounded: true,
  ...track([
    [0, CSLIDE, CSLIDE_FEET],
    [10, { ...CSLIDE, Torso: [26, 0, 3] }, CSLIDE_FEET],
    [20, CSLIDE, CSLIDE_FEET],
  ]),
  notes: 'Skidding low on the feet, arms swept back.',
};

// Prone: face down, belly on the floor, body centred over the physics ball.
export const PRONE_Y = 0.2 - 0.62;
const PRONE_BODY: Pose = {
  ...pelvis([90, 0, 0], [0, PRONE_Y, -0.3]),
  Torso: [-4, 0, 0],
  Head: [-55, 0, 0],
  ...arm('R', -135, 22, 55),
  ...arm('L', -135, 22, 55),
  ...leg('R', 2, 6, 5, 70),
  ...leg('L', 2, 6, 5, 70),
};
export const Prone: ClipDef = {
  name: 'Prone',
  frames: 60,
  loop: true,
  keys: [
    [0, PRONE_BODY],
    [30, { ...PRONE_BODY, Torso: [-7, 0, 0], Head: [-58, 0, 0] }],
    [60, PRONE_BODY],
  ],
  notes: 'Lying on the belly, propped on the elbows, looking ahead.',
};

// Plank: hands and toes on the floor, body straight — the bridge between crouch and prone.
const PLANK_FEET: FeetGoals = { R: { z: -0.76, pitch: 72, pivot: 'ball' }, L: { z: -0.76, pitch: 72, pivot: 'ball' } };
const PLANK: Pose = { ...pelvis([62, 0, 0], [0, -0.18, -0.15]), Torso: [10, 0, 0], Head: [-45, 0, 0], ...arms(-74, 18, 5) };

// Halfway between plank and prone: chest low, elbows bent, toes still dug in.
const LOWERED: Pose = { ...pelvis([80, 0, 0], [0, -0.36, -0.2]), Torso: [0, 0, 0], Head: [-50, 0, 0], ...arms(-105, 26, 75) };
// (the toes stay close to where the plank planted them as the body lowers onto the elbows)
const LOWERED_FEET: FeetGoals = { R: { z: -0.85, pitch: 80, pivot: 'ball' }, L: { z: -0.85, pitch: 80, pivot: 'ball' } };

export const ProneDown: ClipDef = {
  name: 'ProneDown',
  frames: 16,
  ...track([
    [0, CROUCH_BODY, CROUCH_FEET],
    [4, { ...CROUCH_BODY, Torso: [62, 0, 0], Head: [-40, 0, 0], ...arms(-90, 20, 10) }, CROUCH_FEET],
    // weight onto the hands, feet hop up, then kick back
    [5, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.27, -0.11]), Torso: [62, 0, 0], Head: [-42, 0, 0], ...arms(-92, 20, 8) }, { R: { z: 0.11, y: 0.06, pitch: 25, pivot: 'ball' }, L: { z: 0.03, y: 0.06, pitch: 25, pivot: 'ball' } }, 'in'],
    [7, { ...PLANK, ...pelvis([40, 0, 0], [0, -0.2, -0.12]) }, { R: { z: -0.3, y: 0.1, pitch: 50, pivot: 'ball' }, L: { z: -0.3, y: 0.1, pitch: 50, pivot: 'ball' } }],
    [9, PLANK, { R: { z: -0.75, y: 0.03, pitch: 70, pivot: 'ball' }, L: { z: -0.75, y: 0.03, pitch: 70, pivot: 'ball' } }],
    [10, PLANK, PLANK_FEET, 'out'],
    [13, LOWERED, LOWERED_FEET],
    [16, PRONE_BODY, null],
  ]),
  notes: 'Hands to the floor, kick the feet back, lower flat.',
};

// Army crawl: elbow and opposite knee reach forward together.
const crawl = (s: 1 | -1): Pose => {
  const [a, b] = (s > 0 ? ['R', 'L'] : ['L', 'R']) as [Side, Side];
  return {
    ...pelvis([90, 0, s * -4], [0, PRONE_Y, -0.3]),
    Torso: [-4, s * 8, 0],
    Head: [-55, s * -6, 0],
    ...arm(a, -172, 25, 30),
    ...arm(b, -135, 22, 50),
    ...leg(a, 5, 6, 10, 70),
    ...leg(b, 0, 50, 70, 50),
  };
};
export const Crawl: ClipDef = {
  name: 'Crawl',
  frames: 36,
  loop: true,
  speed: 0.9,
  keys: [
    [0, crawl(1)],
    [18, crawl(-1)],
    [36, crawl(1)],
  ],
  notes: 'Army crawl: reach with one elbow, drag up the opposite knee.',
};

export const GetUpFront: ClipDef = {
  name: 'GetUpFront',
  frames: 21,
  ...track([
    [0, PRONE_BODY, null],
    [3, LOWERED, LOWERED_FEET],
    [6, PLANK, PLANK_FEET],
    [10, { ...PLANK, ...pelvis([35, 0, 0], [0, -0.19, -0.12]), Torso: [40, 0, 0], ...arms(-80, 20, 10) }, { R: { z: -0.2, y: 0.1, pitch: 40, pivot: 'ball' }, L: { z: -0.2, y: 0.1, pitch: 40, pivot: 'ball' } }],
    [13, { ...CROUCH_BODY, Torso: [52, 0, 0], ...arms(-52, 20, 20) }, { R: { z: 0.12, y: 0.03 }, L: { z: 0.04, y: 0.03 } }, 'out'],
    [14, { ...CROUCH_BODY, Torso: [50, 0, 0], ...arms(-50, 20, 20) }, CROUCH_FEET, 'out'],
    // stand up over the feet where they landed
    [21, STAND_BODY, CROUCH_FEET],
  ]),
  notes: 'Push up, hop the feet under, stand.',
};

// ---------------------------------------------------------------- sit / lie / sleep

const SIT_FEET: FeetGoals = { R: { z: 0.46, pitch: -20, pivot: 'heel' }, L: { z: 0.42, pitch: -20, pivot: 'heel' } };
const SIT_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.5, 0]),
  Torso: [-8, 0, 0],
  Head: [4, 0, 0],
  ...arm('R', 30, 22, 10, -20),
  ...arm('L', 30, 22, 10, -20),
  ...leg('R', 0, 10),
  ...leg('L', 0, 10),
};
export const Sit: ClipDef = {
  name: 'Sit',
  frames: 60,
  loop: true,
  ...track([
    [0, SIT_BODY, SIT_FEET],
    [30, { ...SIT_BODY, Torso: [-10, 0, 0], Head: [2, 6, 0] }, SIT_FEET],
    [60, SIT_BODY, SIT_FEET],
  ]),
  notes: 'Sitting on the floor, leaning back on the hands.',
};

// On the back: pelvis tipped −90, head toward −Z, centred over the physics ball.
const BACK_BODY: Pose = {
  ...pelvis([-90, 0, 0], [0, 0.2 - 0.62, 0.3]),
  Torso: [0, 0, 0],
  Head: [38, 0, 0],
  ...arm('R', -8, 28, 20),
  ...arm('L', -8, 28, 20),
  ...leg('R', -5, 6, 6, -15),
  ...leg('L', -5, 6, 6, -15),
};
export const LieDown: ClipDef = {
  name: 'LieDown',
  frames: 30,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    // squat over the feet where they stand
    [8, { ...CROUCH_BODY, ...arms(-10, 30, 20) }, STAND_FEET, 'out'],
    // sit back, stepping each foot out in front (lifted, one after the other)
    [11, { ...CROUCH_BODY, ...pelvis([-6, 0, 0], [0, -0.4, -0.06]), Torso: [24, 0, 0], ...arms(20, 30, 20) }, { R: { z: 0.36, y: 0.08, pitch: -15 }, L: { z: -0.03, pitch: 30, pivot: 'ball' } }],
    [12, { ...CROUCH_BODY, ...pelvis([-5, 0, 0], [0, -0.43, -0.04]), Torso: [16, 0, 0], ...arms(25, 30, 20) }, { R: { z: 0.46, y: 0.025, pitch: -20, pivot: 'heel' }, L: { z: 0.2, y: 0.08, pitch: -5 } }],
    [13, { ...SIT_BODY, ...pelvis([-4, 0, 0], [0, -0.46, -0.02]), Torso: [6, 0, 0] }, { R: SIT_FEET.R!, L: { z: 0.32, y: 0.07, pitch: -15 } }],
    [14, { ...SIT_BODY, ...pelvis([-2, 0, 0], [0, -0.48, -0.01]), Torso: [0, 0, 0] }, { R: SIT_FEET.R!, L: { z: 0.42, y: 0.025, pitch: -20, pivot: 'heel' } }],
    [16, SIT_BODY, SIT_FEET],
    [18, SIT_BODY, SIT_FEET],
    // lie back: the legs lift a little as the body rolls back, and settle straight
    [20, { ...SIT_BODY, ...pelvis([-15, 0, 0], [0, -0.5, 0.05]), Torso: [0, 0, 0], ...arms(0, 30, 25) }, { R: { z: 0.48, y: 0.04, pitch: -24, pivot: 'heel' }, L: { z: 0.44, y: 0.04, pitch: -24, pivot: 'heel' } }],
    [23, { ...SIT_BODY, ...pelvis([-45, 0, 0], [0, -0.49, 0.15]), Torso: [5, 0, 0], ...arms(-30, 30, 30) }, { R: { z: 0.6, y: 0.07, pitch: -30, pivot: 'heel' }, L: { z: 0.56, y: 0.07, pitch: -30, pivot: 'heel' } }],
    [30, BACK_BODY, null],
  ]),
  notes: 'Squats, steps the feet out and sits, then lies back.',
};

export const LieIdle: ClipDef = {
  name: 'LieIdle',
  frames: 60,
  loop: true,
  keys: [
    [0, BACK_BODY],
    [30, { ...BACK_BODY, Torso: [-3, 0, 0], Head: [40, 0, 0] }],
    [60, BACK_BODY],
  ],
  notes: 'Resting on the back.',
};

const SLEEP_BODY: Pose = { ...BACK_BODY, Head: [40, 12, -4], ...arm('R', -140, 50, 120), ...arm('L', -10, 20, 30), ...leg('L', -30, 10, 60, -10) };
export const Sleep: ClipDef = {
  name: 'Sleep',
  frames: 90,
  loop: true,
  keys: [
    [0, SLEEP_BODY],
    [45, { ...SLEEP_BODY, ...pelvis([-90, 0, 0], [0, 0.215 - 0.62, 0.3], [1.03, 1, 1.03]), Head: [42, 12, -4] }],
    [90, SLEEP_BODY],
  ],
  notes: 'Snoozing: hand behind the head, one knee up, big slow breaths.',
};

export const GetUp: ClipDef = {
  name: 'GetUp',
  frames: 24,
  ...track([
    [0, BACK_BODY, null],
    // sit up; the heels come down where they sit
    [6, { ...SIT_BODY, Torso: [18, 0, 0], ...arms(-40, 20, 20) }, { R: { z: 0.46, y: 0.05, pitch: -20, pivot: 'heel' }, L: { z: 0.42, y: 0.05, pitch: -20, pivot: 'heel' } }],
    [8, { ...SIT_BODY, Torso: [30, 0, 0], ...arms(-60, 20, 20) }, SIT_FEET, 'out'],
    // pull each foot in under the body (lifted, one after the other)
    [10, { ...SIT_BODY, Torso: [36, 0, 0], ...arms(-60, 20, 20) }, { R: { z: 0.3, y: 0.07 }, L: SIT_FEET.L! }],
    [12, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.4, -0.04]), Torso: [42, 0, 0], ...arms(-55, 20, 20) }, { R: { z: 0.14 }, L: { z: 0.26, y: 0.07 } }],
    [15, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.3, -0.08]), Torso: [45, 0, 0], ...arms(-50, 20, 20) }, flat(0.14, 0.1)],
    // and stand up over them
    [24, STAND_BODY, flat(0.14, 0.1)],
  ]),
  notes: 'Sit up, pull the feet under one at a time, stand.',
};
