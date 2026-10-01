// Hero clips. Ledges and climbing: hang, shimmy, pull up, climb.
import { mirrorClip, type ClipDef, type Pose } from '../../../engine/animation';
import { HERO_RIG as RIG } from '../rig';
import { type Side, arm, arms, leg, pelvis, track } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';
import { CROUCH_FEET, CROUCH_BODY } from './crouch';

const HANG: Pose = {
  ...pelvis([0, 0, 0], [0, 0.1, 0]),
  Torso: [6, 0, 0],
  Head: [-12, 0, 0],
  ...arm('R', -152, 12, 10, 20),
  ...arm('L', -152, 12, 10, 20),
  ...leg('R', -6, 4, 14, 30),
  ...leg('L', 4, 4, 22, 30),
};
export const Hang: ClipDef = {
  name: 'Hang',
  frames: 40,
  loop: true,
  keys: [
    [0, HANG],
    [20, { ...HANG, ...leg('R', -2, 4, 18, 30), ...leg('L', 0, 4, 16, 30) }],
    [40, HANG],
  ],
  layers: [{ joint: 'Pelvis', channel: 'rx', amplitude: 2, period: 40 }],
  notes: 'Hanging from a ledge by both hands, legs dangling.',
};

export const ShimmyRight: ClipDef = {
  name: 'ShimmyRight',
  frames: 20,
  loop: true,
  keys: [
    [0, HANG],
    [5, { ...HANG, ...pelvis([0, 0, 6], [-0.03, 0.1, 0]), ...arm('R', -150, 32, 10, 20), ...arm('L', -152, 4, 14, 20), ...leg('R', -6, 12, 14, 30), ...leg('L', 4, -2, 22, 30) }],
    [10, { ...HANG, ...pelvis([0, 0, 2], [-0.05, 0.1, 0]) }],
    [15, { ...HANG, ...pelvis([0, 0, -3], [-0.02, 0.1, 0]), ...arm('R', -152, 16, 10, 20), ...arm('L', -150, -6, 14, 20), ...leg('R', -6, 0, 14, 30), ...leg('L', 4, 10, 22, 30) }],
    [20, HANG],
  ],
  notes: 'Hand over hand along the ledge toward its right, legs swinging.',
};
export const ShimmyLeft = mirrorClip(ShimmyRight, 'ShimmyLeft', RIG);

export const PullUp: ClipDef = {
  name: 'PullUp',
  frames: 27,
  ...track([
    [0, HANG, null],
    [7, { ...pelvis([0, 0, 0], [0, 0.1, 0]), Torso: [20, 0, 0], Head: [-20, 0, 0], ...arm('R', -40, 35, 115, 10), ...arm('L', -40, 35, 115, 10), ...leg('R', -40, 5, 60, 20), ...leg('L', -10, 5, 40, 20) }, null],
    [12, { ...pelvis([20, 0, 0], [0, -0.05, 0]), Torso: [35, 0, 0], Head: [-25, 0, 0], ...arm('R', -25, 20, 0, 10), ...arm('L', -25, 20, 0, 10) }, { R: { z: 0.2, pitch: 10, pivot: 'ball' }, L: { z: -0.25, y: 0.12, pitch: 30 } }],
    [19, CROUCH_BODY, CROUCH_FEET],
    [27, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Pull up with bent arms, press down, knee over, stand.',
};

const climb = (s: 1 | -1): Pose => {
  const [hi, lo] = (s > 0 ? ['R', 'L'] : ['L', 'R']) as [Side, Side];
  return {
    ...pelvis([0, 0, 0], [0, 0.05, 0]),
    Torso: [8, s * -5, 0],
    Head: [-20, 0, 0],
    ...arm(hi, -165, 12, 25, 10),
    ...arm(lo, -120, 16, 70, 10),
    ...leg(hi, -15, 6, 35, 10),
    ...leg(lo, -75, 6, 100, 0),
  };
};
export const Climb: ClipDef = {
  name: 'Climb',
  frames: 24,
  loop: true,
  keys: [
    [0, climb(1)],
    [12, climb(-1)],
    [24, climb(1)],
  ],
  notes: 'Ladder climb: opposite hand and foot reach together.',
};
const CLIMB_MID: Pose = { ...pelvis([0, 0, 0], [0, 0.05, 0]), Torso: [8, 0, 0], Head: [-20, 0, 0], ...arms(-145, 14, 45, 10), ...leg('R', -45, 6, 70, 5), ...leg('L', -40, 6, 65, 5) };
export const ClimbIdle: ClipDef = {
  name: 'ClimbIdle',
  frames: 40,
  loop: true,
  keys: [
    [0, CLIMB_MID],
    [20, { ...CLIMB_MID, Torso: [6, 0, 0], Head: [-22, 8, 0] }],
    [40, CLIMB_MID],
  ],
  notes: 'Holding on to the ladder.',
};
