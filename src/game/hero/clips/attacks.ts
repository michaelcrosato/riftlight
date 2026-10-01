// Hero clips. Attacks: punch, punch, kick combo, sweep kick, jump kick.
import { type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { arm, leg, pelvis, type TrackKey, track, flat } from './helpers';
import { CROUCH_FEET, CROUCH_BODY } from './crouch';
import { DESCEND } from './air';

const GUARD_FEET = flat(-0.12, 0.14);
const GUARD_BODY: Pose = { ...pelvis([0, 0, 0], [0, -0.07, 0]), Torso: [8, 0, 0], Head: [-6, 0, 0], ...arm('R', -40, 16, 115, 10), ...arm('L', -48, 16, 120, 10) };
const guard = (body: Pose): Pose => ({ ...GUARD_BODY, ...body });

export const Punch: ClipDef = {
  name: 'Punch',
  fast: true,
  frames: 10,
  grounded: true,
  ...track([
    [0, GUARD_BODY, GUARD_FEET],
    [2, guard({ Torso: [6, -12, 0], ...arm('R', -15, 22, 125, 10) }), GUARD_FEET, 'out'],
    [4, guard({ Torso: [10, 28, 0], Head: [-6, -18, 0], ...arm('R', -94, 4, 0, 0, 10) }), GUARD_FEET],
    [7, guard({ Torso: [10, 24, 0], Head: [-6, -15, 0], ...arm('R', -90, 6, 10, 0, 10) }), GUARD_FEET],
    [10, GUARD_BODY, GUARD_FEET],
  ]),
  notes: 'Right jab: wind back, twist the shoulders into it.',
};

export const Punch2: ClipDef = {
  name: 'Punch2',
  fast: true,
  frames: 10,
  grounded: true,
  ...track([
    [0, guard({ Torso: [10, 20, 0], ...arm('R', -80, 6, 20) }), GUARD_FEET],
    [2, guard({ Torso: [8, 30, 0], ...arm('L', -20, 30, 120, 10) }), GUARD_FEET, 'out'],
    [4, guard({ Torso: [10, -30, 0], Head: [-6, 18, 0], ...arm('L', -92, 8, 0, 0, 10) }), GUARD_FEET],
    [7, guard({ Torso: [10, -26, 0], Head: [-6, 15, 0], ...arm('L', -88, 10, 10, 0, 10) }), GUARD_FEET],
    [10, GUARD_BODY, GUARD_FEET],
  ]),
  notes: 'Left straight, shoulders whip the other way.',
};

const KICK_FEET: FeetGoals = { L: GUARD_FEET.L };
export const Kick: ClipDef = {
  name: 'Kick',
  fast: true,
  frames: 14,
  grounded: true,
  ...track([
    [0, GUARD_BODY, GUARD_FEET],
    [4, guard({ Torso: [-6, 0, 0], ...arm('R', -30, 50, 60), ...arm('L', -60, 40, 60), ...leg('R', -85, 5, 110, 20) }), KICK_FEET, 'out'],
    [7, guard({ ...pelvis([0, 0, 0], [0, -0.05, 0]), Torso: [-20, 0, 0], Head: [-5, 0, 0], ...arm('R', 10, 55, 30), ...arm('L', -30, 55, 30), ...leg('R', -95, 5, 0, 40) }), KICK_FEET],
    [10, guard({ Torso: [-10, 0, 0], ...arm('R', -20, 45, 60), ...arm('L', -50, 40, 60), ...leg('R', -80, 5, 100, 20) }), KICK_FEET],
    [14, GUARD_BODY, GUARD_FEET],
  ]),
  notes: 'Chamber the knee, snap the leg out, re-chamber.',
};

// Sweep: spins on the planted left foot; the pelvis orbits so the left hip stays over it.
const sweep = (yaw: number): Pose => {
  const a = (yaw * Math.PI) / 180;
  return {
    ...pelvis([0, yaw, 0], [0.14 - 0.14 * Math.cos(a), -0.3, 0.14 * Math.sin(a)]),
    Torso: [35, 0, 0],
    Head: [-20, 0, 0],
    ...arm('R', -40, 40, 20),
    ...arm('L', -60, 30, 10),
    ...leg('R', -10, 70, 5, 30),
  };
};
const SWEEP_FEET: FeetGoals = { L: { z: 0 } };
export const SweepKick: ClipDef = {
  name: 'SweepKick',
  fast: true,
  frames: 18,
  ...track([
    [0, CROUCH_BODY, CROUCH_FEET],
    [2, sweep(-30), { ...SWEEP_FEET, R: { z: 0.22, y: 0.03 } }, 'in'],
    ...Array.from({ length: 12 }, (_, i): TrackKey => [3 + (i * 11) / 12, sweep(-30 + i * 30), SWEEP_FEET, 'linear']),
    [14, sweep(330), { ...SWEEP_FEET, R: { z: 0.22, y: 0.03 } }],
    [18, { ...CROUCH_BODY, ...pelvis([0, 360, 0], [0, -0.3, -0.1]) }, CROUCH_FEET],
  ]),
  notes: 'Low spinning sweep with the leg out wide, pivoting on the left foot.',
};

export const JumpKick: ClipDef = {
  name: 'JumpKick',
  fast: true,
  frames: 14,
  keys: [
    [0, { ...DESCEND }],
    [3, { ...pelvis([-15, 0, 0], [0, 0.1, 0]), Torso: [-10, 0, 0], Head: [10, 0, 0], ...arm('R', 20, 60, 30), ...arm('L', -20, 60, 30), ...leg('R', -100, 5, 0, 45), ...leg('L', -40, 5, 110, 20) }, 'out'],
    [9, { ...pelvis([-12, 0, 0], [0, 0.1, 0]), Torso: [-8, 0, 0], Head: [10, 0, 0], ...arm('R', 15, 60, 30), ...arm('L', -25, 60, 30), ...leg('R', -95, 5, 5, 45), ...leg('L', -40, 5, 110, 20) }],
    [14, DESCEND],
  ],
  notes: 'Mid-air flying kick.',
};
