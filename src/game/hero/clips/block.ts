// Hero clips. Blocks: push, lean, grab, pull.
import { gaitClip, type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { HERO_RIG as RIG } from '../rig';
import { arms, pelvis, track, flat } from './helpers';

export const Push = gaitClip(RIG, {
  name: 'Push',
  frames: 30,
  speed: 1.5,
  stance: 0.66,
  reach: -0.2,
  hip: -0.12,
  bob: 0.01,
  lift: 0.06,
  dangle: 0.3,
  toeOff: 30,
  lean: 30,
  pelvisPitch: 10,
  twist: 6,
  head: -30,
  arms: { swing: 6, elbow: 35, forward: 115, spread: 14, lag: 0.1 },
  notes: 'Shoulder into the crate, legs driving back.',
});
const PUSH_FEET: FeetGoals = { R: { z: -0.06 }, L: { z: -0.26, pitch: 25, pivot: 'ball' } };
const PUSH_IDLE: Pose = { ...pelvis([8, 0, 0], [0, -0.1, 0.02]), Torso: [26, 0, 0], Head: [-32, 0, 0], ...arms(-110, 14, 40) };
export const PushIdle: ClipDef = {
  name: 'PushIdle',
  frames: 40,
  loop: true,
  grounded: true,
  ...track([
    [0, PUSH_IDLE, PUSH_FEET],
    [20, { ...PUSH_IDLE, Torso: [28, 0, 0] }, PUSH_FEET],
    [40, PUSH_IDLE, PUSH_FEET],
  ]),
  notes: 'Leaning on a crate.',
};

const GRAB_FEET = flat(0.12, -0.14);
const GRAB: Pose = { ...pelvis([0, 0, 0], [0, -0.14, -0.04]), Torso: [18, 0, 0], Head: [-15, 0, 0], ...arms(-85, 22, 20, 10) };
export const Grab: ClipDef = {
  name: 'Grab',
  frames: 40,
  loop: true,
  grounded: true,
  ...track([
    [0, GRAB, GRAB_FEET],
    [20, { ...GRAB, Torso: [16, 0, 0] }, GRAB_FEET],
    [40, GRAB, GRAB_FEET],
  ]),
  notes: 'Gripping a block, ready to pull.',
};

export const Pull = gaitClip(RIG, {
  name: 'Pull',
  frames: 30,
  speed: -1.3,
  stance: 0.66,
  reach: -0.05,
  hip: -0.16,
  bob: 0.012,
  lift: 0.06,
  dangle: 0.3,
  toeOff: 0,
  heelStrike: 0,
  lean: -8,
  pelvisPitch: -6,
  twist: 5,
  head: 6,
  arms: { swing: 5, elbow: 25, forward: 70, spread: 18, lag: 0.1 },
  pose: { HandR: [-30, 0, 0], HandL: [-30, 0, 0] },
  notes: 'Walking backwards, hauling the block, leaning back.',
});
