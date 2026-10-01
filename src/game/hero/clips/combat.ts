// Hero clips. Riftlight combat: a 3-hit sword combo, slams, a whirlwind spin, casts, bow
// shots, the dodge roll, a charge, a war cry, hit react, death and a victory pose.
// The sword is a mesh the game puts in the right hand (src/riftlight/actors/sword.ts); its
// blade points along the hand's +Z, tipped 20° toward the fingers, so with the wrist curled
// back (wrist −60) it extends the arm, and with a straight wrist it stands up off the fist.
import { blend, type ClipDef, type FeetGoals, type Pose } from '../../../engine/animation';
import { arm, arms, leg, pelvis, squash, track as trackFree, flat, F, spinRoot, type TrackKey } from './helpers';
import { STAND_FEET, STAND_BODY } from './standing';

/**
 * Planted feet keep pointing where they stand while the hips twist over them: each foot is
 * turned back by the pelvis' yaw (about its own up axis, at the ankle), so a swing that
 * winds the hips round doesn't screw the soles round on the floor.
 */
function planted(body: Pose): Pose {
  const p = body.Pelvis as { r?: [number, number, number] } | undefined;
  const yaw = p?.r?.[1] ?? 0;
  if (!yaw) return body;
  const twist = (name: 'FootR' | 'FootL'): [number, number, number] => {
    const cur = body[name] as [number, number, number] | { r?: [number, number, number] } | undefined;
    const r = Array.isArray(cur) ? cur : (cur?.r ?? [0, 0, 0]);
    return [r[0], -yaw, r[2]];
  };
  return { ...body, FootR: twist('FootR'), FootL: twist('FootL') };
}
/** `track()` with the feet held square to the floor under a twisting body (see `planted`). */
const track = (keys: readonly TrackKey[]) => trackFree(keys.map(([f, body, feet, ease]): TrackKey => [f, feet ? planted(body) : body, feet, ease]));

/**
 * Legs solved for `body` with its pelvis as given, then the pelvis turned further by `add`
 * degrees. Leg angles are relative to the pelvis, so a turn about Y keeps the feet at the
 * same height (they orbit), and a whole 360° about X is the same pose: spins and rolls stay
 * on the floor without the IK seeing the big angles.
 */
function turned(body: Pose, feet: FeetGoals, add: [number, number, number]): Pose {
  const solved = F(planted(body), feet);
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
    [19.6, SMASH_BODY, SMASH_FEET],
    [23, { ...SMASH_BODY, ...pelvis([10, 0, 0], [0, -0.25, 0.02], squash(0.05)) }, SMASH_FEET],
    [28, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Anticipation crouch, launch with the sword overhead, knees tucked, then the landing smash.',
};

// ------------------------------------------------------------------ whirlwind

/** Whirlwind pose: low, arms flung out, blade level at arm's length, both feet off the floor. */
const SPIN_BODY: Pose = {
  ...pelvis([6, 0, -4], [0, -0.04, 0]),
  Torso: [10, 0, 4],
  Head: [-10, 0, -4],
  ...arm('R', -82, 84, 4, -62),
  ...arm('L', -70, 76, 22, 0),
};
const SPIN_FEET = (lift: number): FeetGoals => ({
  R: { z: -0.12, y: 0.035 + lift, pitch: 30, pivot: 'ball' },
  L: { z: 0.12, y: 0.025 + lift, pitch: 12, pivot: 'ball' },
});
const spinKey = (bob: number, tilt: number): Pose => F({ ...SPIN_BODY, ...pelvis([6, 0, -4 + tilt], [0, -0.04 + bob, 0]), Torso: [10, 0, 4 - tilt] }, SPIN_FEET(bob));

/**
 * Whirlwind: the spinning pose, looped while channelled. The whole model turns (the hero
 * controller spins it, `HERO_TUNING.spinTurns`, rightwards), so the clip holds the pose and
 * only bobs: feet skim clear of the floor, the blade stays level at arm's length.
 */
export const Spin: ClipDef = {
  name: 'Spin',
  fast: true,
  loop: true,
  frames: 12,
  keys: [
    [0, spinKey(0, 0)],
    [6, spinKey(0.02, 3)],
    [12, spinKey(0, 0)],
  ],
  notes: 'Arms flung out, blade level, both feet skimming the floor with a small bob; the hero controller spins the model.',
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

export const ROLL_TUCK: Pose = {
  Torso: [55, 0, 0],
  Head: [40, 0, 0],
  // hugging the shins; the sword hand turned so the blade lies across the body, along the
  // axis the body rolls about (it never sweeps the floor)
  ...arm('R', -50, 20, 110, 10),
  HandR: [-10, -90, 0],
  ...arm('L', -50, 20, 110, 10),
  HandL: [-10, 90, 0],
  ...leg('R', -120, 8, 140, 30),
  ...leg('L', -120, 8, 140, 30),
};
/**
 * The tucked body turns about (0, 0.2, 0.25) from the hips. It isn't round (the hat), so
 * each key lifts the root by what keeps its lowest point 2 cm off the floor, measured by
 * posing the model (hero.glb with the springy Cap) at that angle with the sword in hand
 * (`sampleFrames`; the blade lies along the roll's axis, so it never sweeps the floor):
 * keys every 15 degrees so the ball rolls without sinking between them.
 */
const ROLL_LIFT: Readonly<Record<number, number>> = {
  15: -0.332, 30: -0.279, 45: -0.181, 60: -0.09, 75: -0.047, 90: -0.014, 105: 0.049, 120: 0.055, 135: 0.002, 150: -0.106, 165: -0.261, 180: -0.439,
  195: -0.526, 210: -0.617, 225: -0.597, 240: -0.529, 255: -0.48, 270: -0.452, 285: -0.446, 300: -0.45, 315: -0.421, 330: -0.366, 345: -0.322,
};
/** The sword hand turns back square (blade along the arm again) over the last quarter turn. */
const rolling = (angle: number): Pose => {
  const unfold = Math.min(1, Math.max(0, (angle - 240) / 105));
  return { ...ROLL_TUCK, HandR: [-10, -90 * (1 - unfold), 0], HandL: [-10, 90 * (1 - unfold), 0], ...spinRoot('x', angle, [0, 0.2, 0.25], ROLL_LIFT[angle] ?? 0) };
};
const ROLL_UP: Pose = { ...pelvis([20, 0, 0], [0, -0.22, 0.04], squash(0.05)), Torso: [34, 0, 0], Head: [-20, 0, 0], ...arms(-40, 18, 70, 10) };
const ROLL_ANGLES = Object.keys(ROLL_LIFT).map(Number);

/**
 * Dodge roll: dive off the back foot into a tight forward roll and come up on guard. The body
 * travels by root motion (the dash's ROLL_PROFILE: full speed through the roll, braking to a
 * stop as the feet come down, frame 8.5 of 14), so the planted feet never skate.
 */
function blendFeet(a: FeetGoals, b: FeetGoals, t: number): FeetGoals {
  const m = (u = 0, v = 0) => u + (v - u) * t;
  const one = (x: FeetGoals['R'], y: FeetGoals['R']) => (x && y ? { z: m(x.z, y.z), y: m(x.y, y.y), pitch: m(x.pitch, y.pitch), pivot: x.pivot ?? y.pivot } : (x ?? y));
  return { R: one(a.R, b.R), L: one(a.L, b.L) };
}

// Over the top (330-345 deg) the feet come down in front of the hips, where the ball has
// them; the body then rises up over them: they slide back under it in the clip exactly as
// fast as the roll's root motion carries the body on (ROLL_PROFILE's tail), so in the world
// they stay planted.
const ROLL_LAND: FeetGoals = { R: { z: 0.19, y: 0.01 }, L: { z: 0.26, y: 0.01 } };
const ROLL_RISE: FeetGoals = { R: { z: 0.08, y: 0 }, L: { z: 0.16 } };
export const Roll: ClipDef = {
  name: 'Roll',
  fast: true,
  frames: 14,
  keys: [
    [0, F({ ...pelvis([16, 0, 0], [0, -0.14, 0.04], squash(0.05)), Torso: [28, 0, 0], Head: [-14, 0, 0], ...arms(-70, 18, 50, 10) }, { R: { z: -0.12, pitch: 30, pivot: 'ball' }, L: { z: 0.08, pitch: 10, pivot: 'ball' } }), 'linear'],
    ...ROLL_ANGLES.map((a, i) => [1.2 + i * (7.2 / (ROLL_ANGLES.length - 1)), rolling(a), 'linear'] as const),
    // over the top the feet come down in front (the ball's lowest point at 330-345 deg) and
    // plant; the body unrolls up over them
    [9.6, turned({ ...ROLL_UP, ...pelvis([36, 0, 0], [0, -0.3, 0.02], squash(0.05)), Torso: [34, 0, 0], Head: [6, 0, 0], ...arms(-72, 19, 95, 10) }, ROLL_LAND, [360, 0, 0]), 'inOut'],
    [11, turned({ ...ROLL_UP, ...pelvis([30, 0, 0], [0, -0.26, 0.02], squash(0.05)), Torso: [32, 0, 0], Head: [-6, 0, 0], ...arms(-58, 19, 80, 10) }, blendFeet(ROLL_LAND, ROLL_RISE, 0.55), [360, 0, 0]), 'inOut'],
    [12, turned(ROLL_UP, ROLL_RISE, [360, 0, 0]), 'inOut'],
    // (the rise keyed every frame: legs solved at each, so the planted feet stay put between)
    [13, turned(blend(ROLL_UP, COMBAT_BODY, 0.5), blendFeet(ROLL_RISE, COMBAT_FEET, 0.5), [360, 0, 0]), 'inOut'],
    [14, turned(COMBAT_BODY, COMBAT_FEET, [360, 0, 0])],
  ],
  notes: 'Push off the back foot, tuck tight and roll (keys every 15 deg), feet plant at 8.5 as the ball comes over, up on guard by 14 (the i-frames cover the roll).',
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
