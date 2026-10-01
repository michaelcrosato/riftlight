// Hero clips. Riftlight combat: a 3-hit sword combo, slams, a whirlwind spin, casts, bow
// shots, the dodge roll, a charge, a war cry, hit react, death and a victory pose.
// The sword is a mesh the game puts in the right hand (src/riftlight/actors/sword.ts); its
// blade points along the hand's +Z, tipped 20° toward the fingers, so with the wrist curled
// back (wrist −60) it extends the arm, and with a straight wrist it stands up off the fist.
import { type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { arm, arms, leg, pelvis, squash, track, flat, F, spinRoot } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';

/**
 * Legs solved for `body` with its pelvis as given, then the pelvis turned further by `add`
 * degrees. Leg angles are relative to the pelvis, so a turn about Y keeps the feet at the
 * same height (they orbit), and a whole 360° about X is the same pose: spins and rolls stay
 * on the floor without the IK seeing the big angles.
 */
function turned(body: Pose, feet: FeetGoals, add: [number, number, number]): Pose {
  const solved = F(body, feet);
  const p = solved.Pelvis as { r?: [number, number, number]; p?: [number, number, number]; s?: number | [number, number, number] };
  const r = p.r ?? [0, 0, 0];
  return { ...solved, Pelvis: { ...p, r: [r[0] + add[0], r[1] + add[1], r[2] + add[2]] } };
}

/** Combat stance: knees soft, left foot forward, sword up in front, off hand guarding. */
export const COMBAT_FEET = flat(-0.03, 0.06);
export const COMBAT_BODY: Pose = {
  ...pelvis([0, -8, 0], [0, -0.07, 0]),
  Torso: [8, 6, 0],
  Head: [-6, 2, 0],
  ...arm('R', -38, 22, 70, -10),
  ...arm('L', -30, 18, 80, 10),
};
const stance = (body: Pose): Pose => ({ ...COMBAT_BODY, ...body });

/**
 * When each clip lands its hit (frames at 30 fps), when it may be cancelled into a dodge,
 * and for leaps when the feet touch down. The hero controller releases the skill at `hit`
 * and scales the clip's rate so the whole clip takes the skill's cast time.
 */
export const COMBAT_TIMING: Readonly<Record<string, { hit: number; cancel: number; land?: number }>> = {
  Slash1: { hit: 5, cancel: 7 },
  Slash2: { hit: 5, cancel: 7 },
  Slash3: { hit: 8, cancel: 11 },
  Slam: { hit: 13, cancel: 16 },
  LeapSlam: { hit: 7, cancel: 23, land: 19.6 },
  Spin: { hit: 3, cancel: 0 },
  Cast: { hit: 8, cancel: 10 },
  CastBig: { hit: 12, cancel: 14 },
  BowDraw: { hit: 12, cancel: 13 },
  BowRelease: { hit: 6, cancel: 7 },
  Roll: { hit: 1, cancel: 12 },
  Charge: { hit: 2, cancel: 11 },
  Shout: { hit: 9, cancel: 12 },
};

// ------------------------------------------------------------------ sword combo

/** First swing: wind up out to the right, sweep flat across to the left. */
export const Slash1: ClipDef = {
  name: 'Slash1',
  fast: true,
  frames: 12,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [3, stance({ ...pelvis([0, -22, 0], [0, -0.09, 0]), Torso: [6, -28, 0], Head: [-6, 18, 0], ...arm('R', -55, 75, 45, -40) }), COMBAT_FEET, 'in'],
    [5, stance({ ...pelvis([0, 10, 0], [0, -0.1, 0]), Torso: [12, 30, 0], Head: [-6, -18, 0], ...arm('R', -88, 0, 8, -60, 20) }), COMBAT_FEET, 'out'],
    [7, stance({ ...pelvis([0, 16, 0], [0, -0.1, 0]), Torso: [12, 38, 0], Head: [-6, -22, 0], ...arm('R', -80, -38, 15, -55, 25), ...arm('L', -15, 30, 60, 10) }), COMBAT_FEET],
    [12, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Combo 1: flat swipe right to left; the hips lead the shoulders, the blade trails.',
};

/** Second swing: backhand from the left, sweeping out to the right. */
export const Slash2: ClipDef = {
  name: 'Slash2',
  fast: true,
  frames: 12,
  grounded: true,
  ...track([
    [0, stance({ ...pelvis([0, 12, 0], [0, -0.09, 0]), Torso: [10, 30, 0], Head: [-6, -16, 0], ...arm('R', -75, -30, 30, -45, 20) }), COMBAT_FEET],
    [3, stance({ ...pelvis([0, 18, 0], [0, -0.1, 0]), Torso: [10, 40, 0], Head: [-6, -24, 0], ...arm('R', -70, -45, 70, -30, 30), ...arm('L', -10, 35, 60, 10) }), COMBAT_FEET, 'in'],
    [5, stance({ ...pelvis([0, -12, 0], [0, -0.11, 0]), Torso: [12, -26, 0], Head: [-6, 16, 0], ...arm('R', -88, 40, 5, -60, -10) }), COMBAT_FEET, 'out'],
    [7, stance({ ...pelvis([0, -18, 0], [0, -0.1, 0]), Torso: [10, -34, 0], Head: [-6, 20, 0], ...arm('R', -70, 80, 15, -55, -15) }), COMBAT_FEET],
    [12, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Combo 2: backhand, left to right, shoulders whip the other way.',
};

/** Finisher: big overhead chop that drives down in front. */
export const Slash3: ClipDef = {
  name: 'Slash3',
  fast: true,
  frames: 18,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, stance({ ...pelvis([-6, -4, 0], [0, -0.03, -0.02], squash(-0.04)), Torso: [-14, 4, 0], Head: [-14, 0, 0], ...arm('R', -168, 20, 60, -10), ...arm('L', -150, 20, 70, 0) }), COMBAT_FEET, 'in'],
    [8, stance({ ...pelvis([8, 0, 0], [0, -0.17, 0.03], squash(0.06)), Torso: [30, 0, 0], Head: [-20, 0, 0], ...arm('R', -62, 10, 5, -55), ...arm('L', -55, 14, 15, 0) }), COMBAT_FEET, 'out'],
    [11, stance({ ...pelvis([10, 0, 0], [0, -0.19, 0.04], squash(0.05)), Torso: [34, 0, 0], Head: [-22, 0, 0], ...arm('R', -48, 12, 8, -55), ...arm('L', -45, 16, 18, 0) }), COMBAT_FEET],
    [18, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Combo 3 (finisher): rise up with both hands overhead, chop down hard, hold the hit.',
};

// ------------------------------------------------------------------ slams

const SMASH_FEET: FeetGoals = { R: { z: -0.14, pitch: 35, pivot: 'ball' }, L: { z: 0.2 } };
const SMASH_BODY: Pose = {
  ...pelvis([12, 0, 0], [0, -0.26, 0.02], squash(0.07)),
  Torso: [42, 0, 0],
  Head: [-30, 0, 0],
  ...arm('R', -40, 12, 5, -55),
  ...arm('L', -38, 14, 10, 0),
};

/** Ground slam: both hands up, then smash the blade into the floor ahead. */
export const Slam: ClipDef = {
  name: 'Slam',
  fast: true,
  frames: 24,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [4, stance({ ...pelvis([0, 0, 0], [0, -0.14, 0], squash(0.04)), Torso: [20, 0, 0], ...arms(-30, 15, 80, 10) }), SMASH_FEET, 'out'],
    [10, { ...pelvis([-8, 0, 0], [0, -0.02, -0.02], squash(-0.05)), Torso: [-18, 0, 0], Head: [-16, 0, 0], ...arm('R', -175, 15, 30, -10), ...arm('L', -170, 15, 35, 0) }, SMASH_FEET, 'in'],
    [13, SMASH_BODY, SMASH_FEET],
    [16, { ...SMASH_BODY, ...pelvis([10, 0, 0], [0, -0.25, 0.02], squash(0.05)) }, SMASH_FEET],
    [24, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Heave both arms overhead, rising onto the toes, then smash down with a squash; hold the impact.',
};

const TUCK_SWORD: Pose = {
  Torso: [20, 0, 0],
  Head: [-10, 0, 0],
  ...arm('R', -170, 15, 50, -10),
  ...arm('L', -150, 20, 60, 0),
  ...leg('R', -70, 6, 110, 30),
  ...leg('L', -50, 6, 100, 30),
};

/** Leap slam: crouch, spring up with the sword overhead, come down smashing (physics flies the arc). */
export const LeapSlam: ClipDef = {
  name: 'LeapSlam',
  fast: true,
  frames: 28,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, { ...pelvis([10, 0, 0], [0, -0.26, -0.04], squash(0.08)), Torso: [34, 0, 0], Head: [-24, 0, 0], ...arms(30, 18, 40, 10) }, flat(-0.08, 0.1), 'out'],
    [7, F({ ...pelvis([0, 0, 0], [0, 0, 0.02], [0.95, 1.08, 0.95]), Torso: [-4, 0, 0], Head: [-12, 0, 0], ...arm('R', -170, 15, 30, -10), ...arm('L', -150, 20, 30, 0) }, { R: { z: -0.08, pitch: 50, pivot: 'ball' }, L: { z: 0.1, pitch: 50, pivot: 'ball' } }), null],
    [13, { ...pelvis([-10, 0, 0], [0, 0.05, 0]), ...TUCK_SWORD }, null],
    [17, { ...pelvis([4, 0, 0], [0, 0.06, 0]), Torso: [30, 0, 0], Head: [-24, 0, 0], ...arm('R', -95, 12, 10, -50), ...arm('L', -90, 14, 15, 0), ...leg('R', -45, 6, 95, 30), ...leg('L', -40, 6, 85, 30) }, null, 'in'],
    [19, SMASH_BODY, SMASH_FEET],
    [23, { ...SMASH_BODY, ...pelvis([10, 0, 0], [0, -0.25, 0.02], squash(0.05)) }, SMASH_FEET],
    [28, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Anticipation crouch, launch with the sword overhead, knees tucked, then the landing smash.',
};

// ------------------------------------------------------------------ whirlwind

const SPIN_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.08, 0]),
  Torso: [10, 0, 0],
  Head: [-8, 0, 0],
  ...arm('R', -78, 85, 5, -60),
  ...arm('L', -60, 70, 30, 0),
};
const SPIN_FEET: FeetGoals = { R: { z: -0.08, x: -0.04, y: 0.02, pitch: 15, pivot: 'ball' }, L: { z: 0.1, x: 0.04, y: 0.02 } };
const spin = (yaw: number): Pose => turned(SPIN_BODY, SPIN_FEET, [0, yaw, 0]);

/** Whirlwind: a continuous spin with the sword held straight out (loops while channelled). */
export const Spin: ClipDef = {
  name: 'Spin',
  fast: true,
  loop: true,
  frames: 12,
  keys: [0, 1, 2, 3, 4].map((i) => [i * 3, spin(-i * 90), 'linear'] as const),
  notes: 'Arms out, blade extended, spinning a full turn every 0.4 s (rightwards), feet skimming the floor.',
};

// ------------------------------------------------------------------ casts

/** One-handed cast: draw the off hand back, thrust it out at the target. */
export const Cast: ClipDef = {
  name: 'Cast',
  fast: true,
  frames: 16,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, stance({ ...pelvis([0, -16, 0], [0, -0.09, 0]), Torso: [4, -22, 0], Head: [-8, 14, 0], ...arm('L', -40, 45, 120, 20), ...arm('R', -20, 25, 50, -10) }), COMBAT_FEET, 'in'],
    [8, stance({ ...pelvis([0, 14, 0], [0, -0.1, 0.02]), Torso: [14, 26, 0], Head: [-8, -14, 0], ...arm('L', -96, 6, 0, -30), ...arm('R', -10, 30, 40, -10) }), COMBAT_FEET, 'out'],
    [10, stance({ ...pelvis([0, 12, 0], [0, -0.1, 0.02]), Torso: [12, 24, 0], Head: [-8, -12, 0], ...arm('L', -92, 8, 8, -25), ...arm('R', -12, 30, 40, -10) }), COMBAT_FEET],
    [16, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Off-hand spell: wind the left hand back past the ear, then thrust it at the target.',
};

/** Two-handed cast: gather low, then throw both arms up and out. */
export const CastBig: ClipDef = {
  name: 'CastBig',
  fast: true,
  frames: 22,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [7, stance({ ...pelvis([0, 0, 0], [0, -0.17, 0], squash(0.05)), Torso: [26, 0, 0], Head: [-20, 0, 0], ...arms(-25, 10, 100, 20) }), COMBAT_FEET, 'in'],
    [12, { ...pelvis([-4, 0, 0], [0, -0.02, 0], squash(-0.04)), Torso: [-14, 0, 0], Head: [-20, 0, 0], ...arms(-140, 42, 10, -10) }, COMBAT_FEET, 'out'],
    [15, { ...pelvis([-3, 0, 0], [0, -0.03, 0]), Torso: [-12, 0, 0], Head: [-18, 0, 0], ...arms(-135, 46, 15, -10) }, COMBAT_FEET],
    [22, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Gather the power low in front, then fling both arms up and wide, chest open.',
};

// ------------------------------------------------------------------ bow

const BOW_FEET: FeetGoals = COMBAT_FEET;
const AIM: Pose = {
  ...pelvis([0, -30, 0], [0, -0.07, 0]),
  Torso: [4, 26, 0],
  Head: [-4, 4, 0],
  ...arm('L', -88, 8, 4, 0),
};

/** Full bow shot: raise, draw to the cheek, release (the right hand flies back). */
export const BowDraw: ClipDef = {
  name: 'BowDraw',
  fast: true,
  frames: 18,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, { ...AIM, ...arm('R', -80, 20, 120, 0) }, BOW_FEET, 'out'],
    [11, { ...AIM, Torso: [2, 30, 0], ...arm('R', -78, 82, 140, 0, -10) }, BOW_FEET, 'in'],
    [12, { ...AIM, Torso: [2, 31, 0], ...arm('R', -74, 90, 150, 0, -10) }, BOW_FEET],
    [14, { ...AIM, Torso: [0, 32, 0], ...arm('R', -40, 95, 40, 10) }, BOW_FEET, 'out'],
    [18, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Side-on to the target: bow arm out, string hand drawn back to the cheek, release and follow through.',
};

/** Quick follow-up shot: nock, draw, release. */
export const BowRelease: ClipDef = {
  name: 'BowRelease',
  fast: true,
  frames: 12,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [3, { ...AIM, ...arm('R', -85, 30, 110, 0) }, BOW_FEET, 'out'],
    [5, { ...AIM, Torso: [2, 30, 0], ...arm('R', -76, 86, 145, 0, -10) }, BOW_FEET, 'in'],
    [6, { ...AIM, Torso: [2, 31, 0], ...arm('R', -72, 90, 150, 0, -10) }, BOW_FEET],
    [8, { ...AIM, Torso: [0, 32, 0], ...arm('R', -42, 95, 45, 10) }, BOW_FEET, 'out'],
    [12, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Snap shot: the same draw and release, twice as fast.',
};

// ------------------------------------------------------------------ movement

const ROLL_TUCK: Pose = {
  Torso: [55, 0, 0],
  Head: [40, 0, 0],
  ...arms(-50, 20, 110, 10),
  ...leg('R', -120, 8, 140, 30),
  ...leg('L', -120, 8, 140, 30),
};
/**
 * The tucked body turns about (0, 0.2, 0.25) from the hips. It isn't round (the hat!), so
 * each key lifts the root by what keeps its lowest point 1–3 cm off the floor, measured by
 * posing the model at that angle (`sampleFrames`): the ball rolls without sinking.
 */
const ROLL_LIFT: Readonly<Record<number, number>> = { 30: -0.28, 60: -0.09, 90: -0.01, 120: 0.06, 150: -0.1, 180: -0.43, 210: -0.61, 240: -0.52, 270: -0.44, 300: -0.44, 330: -0.36 };
const rolling = (angle: number): Pose => ({ ...ROLL_TUCK, ...spinRoot('x', angle, [0, 0.2, 0.25], ROLL_LIFT[angle] ?? 0) });
const ROLL_UP: Pose = { ...pelvis([20, 0, 0], [0, -0.22, 0.04], squash(0.05)), Torso: [34, 0, 0], Head: [-20, 0, 0], ...arms(-40, 18, 70, 10) };

/** Dodge roll: dive into a tight forward roll and come up running. */
export const Roll: ClipDef = {
  name: 'Roll',
  fast: true,
  frames: 14,
  keys: [
    [0, F({ ...pelvis([10, 0, 0], [0, -0.1, 0.02], squash(0.04)), Torso: [24, 0, 0], Head: [-12, 0, 0], ...arms(-60, 18, 60, 10) }, flat(-0.06, 0.08)), 'out'],
    ...Object.keys(ROLL_LIFT).map(Number).map((a, i) => [2 + i * 0.8, rolling(a), 'linear'] as const),
    [11, turned({ ...ROLL_UP, ...pelvis([42, 0, 0], [0, -0.24, 0.02], squash(0.04)), Torso: [36, 0, 0], ...arms(-95, 20, 90, 10) }, { R: { z: 0.0, y: 0.05, pitch: 25, pivot: 'ball' }, L: { z: 0.18, y: 0.03 } }, [360, 0, 0]), 'out'],
    [12, turned(ROLL_UP, flat(-0.06, 0.16), [360, 0, 0]), 'out'],
    [14, turned(COMBAT_BODY, COMBAT_FEET, [360, 0, 0])],
  ],
  notes: 'Low forward roll, tucked tight, back on the feet at frame 12 (the i-frames cover the roll).',
};

const CHARGE_BODY: Pose = { ...pelvis([16, 18, 0], [0, -0.1, 0.04]), Torso: [24, 20, 0], Head: [-30, -14, 0], ...arm('L', -50, 30, 120, 10), ...arm('R', 10, 20, 60, -10) };
const BOUND: FeetGoals = { R: { z: -0.34, y: 0.12, pitch: 40, pivot: 'ball' }, L: { z: 0.3, y: 0.06 } };

/** Shield charge / dash: lowered shoulder, driving forward in one long bound. */
export const Charge: ClipDef = {
  name: 'Charge',
  fast: true,
  frames: 14,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [2, CHARGE_BODY, BOUND, 'out'],
    [10, { ...CHARGE_BODY, ...pelvis([18, 18, 0], [0, -0.08, 0.04]), ...arm('L', -55, 30, 120, 10), ...arm('R', 15, 22, 60, -10) }, BOUND],
    [14, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Shoulder down, off-hand braced in front, body launched forward in a long bound.',
};

// ------------------------------------------------------------------ reactions

/** War cry: draw in, then roar with the arms flung wide. */
export const Shout: ClipDef = {
  name: 'Shout',
  fast: true,
  frames: 20,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, stance({ ...pelvis([0, 0, 0], [0, -0.14, 0], squash(0.05)), Torso: [24, 0, 0], Head: [10, 0, 0], ...arms(-20, 8, 110, 10) }), COMBAT_FEET, 'in'],
    [9, { ...pelvis([-4, 0, 0], [0, -0.06, 0], squash(-0.03)), Torso: [-16, 0, 0], Head: [-28, 0, 0], ...arms(-40, 70, 30, -10) }, COMBAT_FEET, 'outBack'],
    [14, { ...pelvis([-3, 0, 0], [0, -0.07, 0]), Torso: [-14, 0, 0], Head: [-26, 0, 0], ...arms(-42, 66, 34, -10) }, COMBAT_FEET],
    [20, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Crouch and inhale, then chest out, head back, arms thrown wide: the roar.',
};

/** Hit react: a quick flinch back from the blow, then guard again. */
export const HitReact: ClipDef = {
  name: 'HitReact',
  fast: true,
  frames: 10,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [2, stance({ ...pelvis([-10, 0, 0], [0, -0.08, -0.04]), Torso: [-16, -8, 0], Head: [-22, 6, 0], ...arm('R', -10, 40, 50, -10), ...arm('L', -60, 40, 40, 0) }), COMBAT_FEET, 'out'],
    [5, stance({ ...pelvis([4, 0, 0], [0, -0.11, 0]), Torso: [16, 0, 0], Head: [6, 0, 0] }), COMBAT_FEET],
    [10, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Snapped back by the hit, folds forward, recovers the guard.',
};

const DEAD_BODY: Pose = {
  ...pelvis([-90, 0, 0], [0, 0.2 - 0.62, 0.3]),
  Torso: [0, 0, 0],
  Head: [32, -14, 0],
  ...arm('R', -10, 70, 20),
  ...arm('L', -20, 50, 40),
  ...leg('R', -10, 14, 20, 20),
  ...leg('L', -25, 6, 50, 20),
};
const KNEES: Pose = { ...pelvis([0, 0, 0], [0, -0.36, -0.12]), Torso: [30, 0, 0], Head: [20, 0, 0], ...arms(-10, 30, 30) };
const SAG: Pose = { ...pelvis([-40, 0, 0], [0, -0.47, 0.1]), Torso: [10, 0, 0], Head: [10, 0, 0], ...arms(-40, 40, 30) };

/** Death: knees buckle, the body tips back and hits the floor. */
export const Death: ClipDef = {
  name: 'Death',
  fast: true,
  frames: 36,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [4, stance({ ...pelvis([-12, 0, 0], [0, -0.08, -0.04]), Torso: [-20, 0, 0], Head: [-30, 0, 0], ...arms(-60, 40, 30) }), COMBAT_FEET, 'out'],
    [11, KNEES, flat(0.14, 0.06), 'in'],
    [16, SAG, { R: { z: 0.55, y: 0.02, pitch: -30, pivot: 'heel' }, L: { z: 0.5, y: 0.02, pitch: -30, pivot: 'heel' } }, 'in'],
    [20, { ...DEAD_BODY, ...pelvis([-90, 0, 0], [0, 0.2 - 0.62 + 0.05, 0.3]) }, null, 'out'],
    [23, { ...DEAD_BODY, ...pelvis([-88, 0, 0], [0, 0.2 - 0.62 + 0.02, 0.3]), Head: [20, -14, 0] }, null],
    [36, DEAD_BODY, null],
  ]),
  notes: 'Struck: reels back, sags to the knees, sits back and falls flat with a small bounce.',
};

/** Victory: sword thrust to the sky, off hand on the hip. */
export const Triumph: ClipDef = {
  name: 'Triumph',
  fast: true,
  frames: 40,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [6, stance({ ...pelvis([0, 0, 0], [0, -0.2, 0], squash(0.07)), Torso: [24, 0, 0], ...arms(-20, 20, 80) }), COMBAT_FEET, 'out'],
    [11, { ...STAND_BODY, ...pelvis([0, 10, 0], [0, -0.01, 0], [0.95, 1.06, 0.95]), Torso: [-10, 8, 0], Head: [-22, 0, 0], ...arm('R', -176, 12, 5, 0), ...arm('L', 18, 40, 115, 0) }, STAND_FEET, 'outBack'],
    [24, { ...STAND_BODY, ...pelvis([0, 10, 0], [0, -0.03, 0]), Torso: [-8, 8, 0], Head: [-20, 0, 0], ...arm('R', -172, 14, 8, 0), ...arm('L', 18, 40, 115, 0) }, STAND_FEET],
    [40, { ...STAND_BODY, ...pelvis([0, 10, 0], [0, -0.03, 0]), Torso: [-8, 8, 0], Head: [-18, 0, 0], ...arm('R', -168, 16, 12, 0), ...arm('L', 18, 40, 115, 0) }, STAND_FEET],
  ]),
  notes: 'Gather, then spring up with the sword straight overhead, fist on the hip; hold the pose.',
};

/** Every combat clip, in the order the tools show them. */
export const COMBAT_CLIPS: readonly ClipDef[] = [Slash1, Slash2, Slash3, Slam, LeapSlam, Spin, Cast, CastBig, BowDraw, BowRelease, Roll, Charge, Shout, HitReact, Death, Triumph];
