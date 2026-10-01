// Hero clips. Standing still: idle, glancing around, teetering on an edge.
import { type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { arm, pelvis, track, flat } from './helpers';

export const STAND_FEET = flat(0.04, -0.03);
export const STAND_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.025, 0]),
  Torso: [4, 0, 0],
  Head: [-4, 0, 0],
  ...arm('R', 6, 9, 22, 10),
  ...arm('L', 6, 9, 22, 10),
};
const STAND_IN: Pose = { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.035, 0]), Torso: [2, 0, 0], Head: [-2, 0, 0], ...arm('R', 4, 12, 20, 10), ...arm('L', 4, 12, 20, 10) };

export const Idle: ClipDef = {
  name: 'Idle',
  frames: 60,
  loop: true,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [30, STAND_IN, STAND_FEET],
    [60, STAND_BODY, STAND_FEET],
  ]),
  layers: [{ joint: 'Head', channel: 'ry', amplitude: 3, period: 60, phase: 0.25 }],
  notes: 'Relaxed stance, slow breath: chest and shoulders rise, head drifts.',
};

const look = (yaw: number): Pose => ({ ...STAND_BODY, Torso: [3, yaw * 0.2, 0], Head: [-6, yaw, yaw * -0.08] });
export const IdleLook: ClipDef = {
  name: 'IdleLook',
  frames: 102,
  loop: true,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [10, look(60), STAND_FEET, 'hold'],
    [36, look(60), STAND_FEET],
    [46, look(-60), STAND_FEET, 'hold'],
    [74, look(-60), STAND_FEET],
    [88, STAND_BODY, STAND_FEET],
    [102, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Mario-style glance left, then right, then back.',
};

// Teeter: toes over the edge, body pitching, arms windmilling in full circles.
const TEETER_FEET: FeetGoals = { R: { z: 0.08, pitch: 12, pivot: 'ball' }, L: { z: 0.02 } };
const teeter = (lean: number, a: number): Pose => ({
  ...pelvis([0, 0, 0], [0, -0.05, -0.04 + lean * 0.002]),
  Torso: [lean, 0, 0],
  Head: [lean * 0.4, 0, 0],
  ...arm('R', a, 35, 15),
  ...arm('L', a + 180, 35, 15),
});
export const Teeter: ClipDef = {
  name: 'Teeter',
  frames: 30,
  loop: true,
  grounded: true,
  ...track([
    [0, teeter(22, -40), TEETER_FEET, 'linear'],
    [7.5, teeter(32, -130), TEETER_FEET, 'linear'],
    [15, teeter(22, -220), TEETER_FEET, 'linear'],
    [22.5, teeter(12, -310), TEETER_FEET, 'linear'],
    [30, teeter(22, -400), TEETER_FEET, 'linear'],
  ]),
  notes: 'On the edge: pitching forward and back, arms windmill in opposite circles.',
};
