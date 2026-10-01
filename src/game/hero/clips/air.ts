// Hero clips. Airborne (physics owns the height): jumps, flips, wall kick, fall, dive, ground pound, landings, slope slide.
import { type ClipDef, type FeetGoals, type Key, type Pose } from '../../../engine/animation';
import { arm, arms, leg, pelvis, squash, track, flat, spinRoot, somersault } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';
import { SKID_FEET, SKID_BODY } from './locomotion';
import { CROUCH_FEET, CROUCH_BODY, PRONE_Y } from './crouch';

const LAUNCH_FEET: FeetGoals = { R: { z: 0.02, pitch: 25, pivot: 'ball' }, L: { z: -0.04, pitch: 25, pivot: 'ball' } };
const LAUNCH_BODY: Pose = { ...pelvis([0, 0, 0], [0, -0.12, 0], squash(0.08)), Torso: [18, 0, 0], ...arms(25, 12, 30) };
export const STRETCH: Pose = { ...pelvis([0, 0, 0], [0, 0.24, 0], [0.92, 1.12, 0.92]), Torso: [-4, 0, 0], Head: [-12, 0, 0], ...arm('R', -170, 12, 5), ...arm('L', -40, 18, 20), ...leg('R', 8, 3, 10, 45), ...leg('L', 12, 3, 20, 45) };
export const DESCEND: Pose = { ...pelvis([0, 0, 0], [0, 0.1, 0]), Torso: [6, 0, 0], Head: [8, 0, 0], ...arm('R', -80, 60, 30), ...arm('L', -75, 60, 30), ...leg('R', -25, 5, 40, 20), ...leg('L', -10, 5, 25, 20) };

export const Jump: ClipDef = {
  name: 'Jump',
  fast: true,
  frames: 20,
  ...track([
    [0, LAUNCH_BODY, LAUNCH_FEET],
    [3, STRETCH, null, 'out'],
    [9, { ...pelvis([0, 0, 0], [0, 0.14, 0]), Torso: [2, 0, 0], Head: [-8, 0, 0], ...arm('R', -175, 10, 10), ...arm('L', 20, 25, 30), ...leg('R', -70, 5, 95, 20), ...leg('L', 10, 5, 25, 35) }, null],
    [20, DESCEND, null],
  ]),
  notes: 'Single jump: fist punches up, one knee up.',
};

export const JumpUp: ClipDef = {
  name: 'JumpUp',
  fast: true,
  frames: 20,
  ...track([
    [0, LAUNCH_BODY, LAUNCH_FEET],
    [3, { ...STRETCH, ...arms(-170, 15, 5) }, null, 'out'],
    [10, { ...pelvis([0, 0, 0], [0, 0.14, 0]), Torso: [4, 0, 0], Head: [-10, 0, 0], ...arms(-160, 30, 15), ...leg('R', -45, 8, 80, 30), ...leg('L', -45, 8, 80, 30) }, null],
    [20, DESCEND, null],
  ]),
  notes: 'Straight up: both arms up, knees tucked.',
};

export const DoubleJump: ClipDef = {
  name: 'DoubleJump',
  fast: true,
  frames: 22,
  keys: [
    [0, { ...STRETCH, ...arms(-60, 20, 40) }],
    [4, { ...pelvis([0, 0, 0], [0, 0.2, 0], [0.94, 1.08, 0.94]), Torso: [-8, 0, 0], Head: [-15, 0, 0], ...arms(-150, 55, 0), ...leg('R', -20, 25, 10, 40), ...leg('L', 15, 25, 10, 40) }, 'outBack'],
    [12, { ...pelvis([0, 0, 0], [0, 0.18, 0]), Torso: [-4, 0, 0], Head: [-12, 0, 0], ...arms(-140, 60, 5), ...leg('R', -25, 22, 20, 35), ...leg('L', 12, 22, 20, 35) }],
    [22, DESCEND],
  ],
  notes: 'Second jump: "hoo!" star pose, arms and legs spread wide.',
};

const TUCK_BODY: Pose = {
  Torso: [62, 0, 0],
  Head: [45, 0, 0],
  ...arms(-40, 14, 100, 20),
  ...leg('R', -128, 8, 145, 30),
  ...leg('L', -128, 8, 145, 30),
};


export const TripleJump: ClipDef = {
  name: 'TripleJump',
  frames: 30,
  fast: true,
  ...track([
    [0, LAUNCH_BODY, LAUNCH_FEET],
    [3, { ...STRETCH, ...arms(-170, 20, 5), ...pelvis([10, 0, 0], [0, 0.24, 0], [0.92, 1.1, 0.92]) }, null, 'in'],
    ...somersault('x', 30, 345, 5, 18, TUCK_BODY, undefined, 'out'),
    [23, { ...pelvis([360, 0, 0], [0, 0.18, 0]), Torso: [-6, 0, 0], Head: [-10, 0, 0], ...arms(-150, 60, 10), ...leg('R', -20, 15, 20, 40), ...leg('L', 5, 15, 20, 40) }, null],
    [30, { ...DESCEND, ...pelvis([360, 0, 0], [0, 0.1, 0]) }, null],
  ]),
  notes: 'Triple jump: tucked front somersault, opening into a star.',
};

export const Backflip: ClipDef = {
  name: 'Backflip',
  frames: 30,
  fast: true,
  ...track([
    [0, CROUCH_BODY, CROUCH_FEET],
    [3, { ...pelvis([-25, 0, 0], [0, 0.24, 0], [0.92, 1.1, 0.92]), Torso: [-25, 0, 0], Head: [-35, 0, 0], ...arms(-175, 15, 0), ...leg('R', 10, 4, 5, 50), ...leg('L', 10, 4, 5, 50) }, null, 'in'],
    ...somersault('x', -40, -345, 6, 20, TUCK_BODY, undefined, 'out'),
    [25, { ...pelvis([-360, 0, 0], [0, 0.18, 0]), Torso: [0, 0, 0], Head: [0, 0, 0], ...arms(-120, 55, 20), ...leg('R', -25, 8, 30, 30), ...leg('L', -15, 8, 25, 30) }, null],
    [30, { ...DESCEND, ...pelvis([-360, 0, 0], [0, 0.1, 0]) }, null],
  ]),
  notes: 'Backflip from a crouch: arch back, tuck, full backward somersault.',
};

const SIDE_TUCK: Pose = { Torso: [20, 0, 0], Head: [25, 0, 0], ...arms(-150, 10, 40), ...leg('R', -60, 5, 100, 30), ...leg('L', -60, 5, 100, 30) };
export const SideFlip: ClipDef = {
  name: 'SideFlip',
  frames: 26,
  fast: true,
  ...track([
    [0, SKID_BODY, SKID_FEET],
    [3, { ...STRETCH, ...arms(-170, 25, 0), ...pelvis([0, 0, 20], [0, 0.3, 0], [0.92, 1.1, 0.92]) }, null, 'in'],
    ...somersault('z', 30, 345, 5, 17, SIDE_TUCK, [0, 0.35, 0], 'out'),
    [20, { ...pelvis([0, 0, 360], [0, 0.18, 0]), Torso: [0, 0, 0], ...arms(-120, 60, 10), ...leg('R', -20, 15, 20, 40), ...leg('L', 5, 15, 20, 40) }, null],
    [26, { ...DESCEND, ...pelvis([0, 0, 360], [0, 0.1, 0]) }, null],
  ]),
  notes: 'Side somersault after a skid-turn: a cartwheel flip, arms overhead.',
};

const LONG_FLY: Pose = {
  ...pelvis([62, 0, 0], [0, 0.26, 0]),
  Torso: [12, 0, 0],
  Head: [-60, 0, 0],
  ...arms(-160, 10, 0, -10),
  ...leg('R', 12, 6, 15, 50),
  ...leg('L', 22, 6, 25, 50),
};
export const LongJump: ClipDef = {
  name: 'LongJump',
  fast: true,
  frames: 36,
  ...track([
    [0, { ...CROUCH_BODY, ...arms(40, 10, 20) }, { R: { z: 0.1 }, L: { z: -0.12, pitch: 30, pivot: 'ball' } }],
    [2, { ...pelvis([25, 0, 0], [0, 0.2, 0]), Torso: [20, 0, 0], Head: [-40, 0, 0], ...arms(-60, 10, 10), ...leg('R', -40, 6, 80, 30), ...leg('L', -10, 6, 70, 40) }, null],
    [5, LONG_FLY, null, 'out'],
    [24, { ...LONG_FLY, ...pelvis([58, 0, 0], [0, 0.26, 0]), ...arms(-150, 20, 0) }, null],
    [36, { ...pelvis([30, 0, 0], [0, 0.16, 0]), Torso: [10, 0, 0], Head: [-30, 0, 0], ...arms(-110, 40, 10), ...leg('R', -40, 8, 30, 20), ...leg('L', -30, 8, 20, 20) }, null],
  ]),
  notes: 'Long jump: body flat like a flying squirrel, arms stretched ahead.',
};

export const WallKick: ClipDef = {
  name: 'WallKick',
  fast: true,
  frames: 20,
  keys: [
    [0, { ...pelvis([-10, 0, 0], [0, 0.02, 0]), Torso: [20, 0, 0], ...arms(20, 20, 40), ...leg('R', -60, 5, 100, 0), ...leg('L', -40, 5, 70, 0) }],
    [4, { ...STRETCH, ...arms(-165, 35, 0), ...leg('R', 30, 5, 10, 50), ...leg('L', -20, 5, 40, 30) }, 'outBack'],
    [20, DESCEND],
  ],
  notes: 'Wall kick: coils against the wall and springs off, arms up.',
};

const WSLIDE = (k: number): Pose => ({
  ...pelvis([-8, 0, 0], [0, 0.1 + k * 0.01, 0]),
  Torso: [-6, 0, 0],
  Head: [10, 30 + k * 4, 0],
  ...arm('R', -150 + k * 5, 25, 30),
  ...arm('L', -100 - k * 4, 50, 40),
  ...leg('R', -20 - k * 2, 8, 50 + k * 2, 10),
  ...leg('L', 10 - k * 2, 8, 30, 10),
});
export const WallSlide: ClipDef = {
  name: 'WallSlide',
  frames: 20,
  loop: true,
  keys: [
    [0, WSLIDE(0)],
    [10, WSLIDE(1)],
    [20, WSLIDE(0)],
  ],
  notes: 'Sliding down a wall, one hand on it.',
};

const fall = (s: 1 | -1): Pose => ({
  ...pelvis([4, 0, 0], [0, 0.14, 0]),
  Torso: [-5, 0, s * 3],
  Head: [18, 0, 0],
  ...arm('R', -150 + s * 22, 40, 15),
  ...arm('L', -150 - s * 22, 40, 15),
  ...leg('R', -25 + s * 15, 8, 45 - s * 15, 25),
  ...leg('L', -25 - s * 15, 8, 45 + s * 15, 25),
});
export const Fall: ClipDef = {
  name: 'Fall',
  frames: 16,
  loop: true,
  keys: [
    [0, fall(1)],
    [8, fall(-1)],
    [16, fall(1)],
  ],
  notes: 'Falling: arms flail overhead, legs pedal, eyes on the ground.',
};

const DIVE_FLY: Pose = { ...pelvis([80, 0, 0], [0, 0.14, 0]), Torso: [6, 0, 0], Head: [-58, 0, 0], ...arms(-172, 8, 0, -10), ...leg('R', 8, 5, 10, 55), ...leg('L', 14, 5, 15, 55) };
export const Dive: ClipDef = {
  name: 'Dive',
  fast: true,
  frames: 12,
  ...track([
    [0, { ...STAND_BODY, ...pelvis([20, 0, 0], [0, -0.05, 0]), Torso: [30, 0, 0], ...arms(-40, 10, 30) }, { R: { z: 0.12, pitch: 20, pivot: 'ball' }, L: { z: -0.25, pitch: 40, pivot: 'ball' } }],
    [2, { ...DIVE_FLY, ...pelvis([40, 0, 0], [0, 0.02, 0]), ...arms(-120, 8, 10) }, { R: { z: -0.05, pitch: 50, pivot: 'ball' }, L: { z: -0.3, y: 0.05, pitch: 60, pivot: 'ball' } }],
    [5, DIVE_FLY, null, 'out'],
    [12, DIVE_FLY, null],
  ]),
  notes: 'Dive: launches forward flat, arms first.',
};

const BELLY: Pose = { ...pelvis([90, 0, 0], [0, PRONE_Y, 0]), Torso: [-6, 0, 0], Head: [-60, 0, 0], ...arms(-168, 22, 0), ...leg('R', 0, 6, 70, 40), ...leg('L', 0, 6, 55, 40) };
export const BellySlide: ClipDef = {
  name: 'BellySlide',
  frames: 20,
  loop: true,
  keys: [
    [0, BELLY],
    [10, { ...BELLY, ...leg('R', 0, 6, 55, 40), ...leg('L', 0, 6, 70, 40) }],
    [20, BELLY],
  ],
  layers: [{ joint: 'Pelvis', channel: 'rz', amplitude: 3, period: 20 }],
  notes: 'Sliding on the belly, arms ahead, feet kicked up.',
};

export const GroundPoundSpin: ClipDef = {
  name: 'GroundPoundSpin',
  frames: 9,
  fast: true,
  keys: [
    ...somersault('x', 0, 360, 0, 9, TUCK_BODY).map(([f, body, , ease]): Key => [f, body, ease]),
  ],
  notes: 'Mid-air somersault before the ground pound.',
};

const POUND: Pose = { ...pelvis([0, 0, 0], [0, 0.25, 0]), Torso: [15, 0, 0], Head: [18, 0, 0], ...arm('R', -40, 70, 60), ...arm('L', -40, 70, 60), ...leg('R', -85, 10, 115, 10), ...leg('L', -85, 10, 115, 10) };
export const GroundPound: ClipDef = {
  name: 'GroundPound',
  fast: true,
  frames: 10,
  keys: [
    [0, { ...TUCK_BODY, ...spinRoot('x', 360) }],
    [3, { ...POUND, ...pelvis([0, 0, 0], [0, 0.3, 0], [0.92, 1.12, 0.92]) }, 'out'],
    [10, POUND],
  ],
  notes: 'Drops butt-first, knees up, elbows out.',
};

const POUND_FEET = flat(0.14, 0.02);
export const GroundPoundLand: ClipDef = {
  name: 'GroundPoundLand',
  frames: 15,
  grounded: true,
  ...track([
    [0, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.34, -0.08], squash(0.16)), Torso: [26, 0, 0], ...arm('R', -30, 65, 40), ...arm('L', -30, 65, 40) }, POUND_FEET, 'out'],
    [4, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.22, -0.08], squash(-0.06)), Torso: [26, 0, 0] }, POUND_FEET],
    [9, CROUCH_BODY, POUND_FEET],
    [15, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Impact: big squash, shockwave arms, spring back up.',
};

export const Land: ClipDef = {
  name: 'Land',
  frames: 10,
  grounded: true,
  ...track([
    [0, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.13, 0], squash(0.1)), Torso: [14, 0, 0], ...arms(-20, 30, 30) }, STAND_FEET, 'out'],
    [3, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.17, 0], squash(0.06)), Torso: [18, 0, 0], ...arms(-15, 28, 30) }, STAND_FEET],
    [10, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Soft landing: knees absorb, squash, recover.',
};

const HARD_FEET = flat(0.12, -0.04);
const HARD_LOW: Pose = { ...pelvis([0, 0, 0], [0, -0.34, -0.1], squash(0.12)), Torso: [48, 0, 0], Head: [10, 0, 0], ...arm('R', -55, 30, 10, -30), ...arm('L', -55, 30, 10, -30) };
export const HardLand: ClipDef = {
  name: 'HardLand',
  frames: 30,
  grounded: true,
  ...track([
    [0, HARD_LOW, HARD_FEET, 'out'],
    [5, { ...HARD_LOW, ...pelvis([0, 0, 0], [0, -0.36, -0.1], squash(0.06)) }, HARD_FEET],
    [12, { ...CROUCH_BODY, Head: [5, 25, 0] }, HARD_FEET],
    [17, { ...CROUCH_BODY, Head: [5, -25, 0] }, HARD_FEET],
    [22, { ...CROUCH_BODY, Head: [0, 0, 0] }, HARD_FEET],
    [30, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Hard landing: slams down, hands to the ground, shakes it off.',
};

const SLIDE: Pose = { ...pelvis([-12, 0, 0], [0, -0.47, 0]), Torso: [2, 0, 0], Head: [6, 0, 0], ...arm('R', -95, 60, 20), ...arm('L', -95, 60, 20), ...leg('R', -85, 8, 12, -20), ...leg('L', -85, 8, 12, -20) };
export const Slide: ClipDef = {
  name: 'Slide',
  frames: 20,
  loop: true,
  keys: [
    [0, SLIDE],
    [10, { ...SLIDE, ...arm('R', -105, 55, 20), ...arm('L', -85, 65, 20) }],
    [20, SLIDE],
  ],
  layers: [{ joint: 'Torso', channel: 'rz', amplitude: 4, period: 20 }],
  notes: 'Butt slide down a slope, arms out for balance.',
};
