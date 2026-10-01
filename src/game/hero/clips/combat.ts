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
 * for leaps when the feet touch down, and for bow shots when the string hand takes the string
 * (`draw`, from..to: the string follows the hand from then until it is let go at `hit`). The
 * hero controller releases the skill at `hit` and scales the clip's rate so the whole clip
 * takes the skill's cast time.
 */
export const COMBAT_TIMING: Readonly<Record<string, { hit: number; cancel: number; land?: number; draw?: readonly [number, number] }>> = {
  Slash1: { hit: 5, cancel: 7 },
  Slash2: { hit: 5, cancel: 7 },
  Slash3: { hit: 8, cancel: 11 },
  Slam: { hit: 13, cancel: 16 },
  LeapSlam: { hit: 7, cancel: 23, land: 19.6 },
  Spin: { hit: 3, cancel: 0 },
  Cast: { hit: 8, cancel: 10 },
  CastBig: { hit: 12, cancel: 14 },
  CastWeapon: { hit: 8, cancel: 10 },
  CastBigWeapon: { hit: 12, cancel: 14 },
  BowDraw: { hit: 12, cancel: 13, draw: [3, 5] },
  BowRelease: { hit: 6, cancel: 7, draw: [1, 2.5] },
  Roll: { hit: 1, cancel: 12 },
  Charge: { hit: 2, cancel: 11 },
  Shout: { hit: 9, cancel: 12 },
};

/**
 * How far the bow string is in the drawing hand at `frame` of `clip` (0..1): eased in over the
 * clip's `draw` frames, held, let go at its hit frame. 0 for clips that don't draw a bow.
 */
export function stringEngage(clip: string, frame: number): number {
  const t = COMBAT_TIMING[clip];
  if (!t?.draw || frame >= t.hit) return 0;
  const [a, b] = t.draw;
  const u = Math.min(1, Math.max(0, (frame - a) / Math.max(1e-3, b - a)));
  return u * u * (3 - 2 * u);
}

// ------------------------------------------------------------------ sword combo

/**
 * First swing: coil right (hips, then shoulders, the blade cocked back past the ear, the off
 * hand reaching ahead to aim), then the hips fire first, the shoulders and the arm follow and
 * the blade cuts flat across at frame 5 with the weight driven onto the front foot and the
 * off arm flung back; it carries on past and settles.
 */
export const Slash1: ClipDef = {
  name: 'Slash1',
  fast: true,
  frames: 12,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [3, stance({ ...pelvis([2, -24, 0], [0, -0.1, -0.02]), Torso: [6, -34, 0], Head: [-6, 22, 0], ...arm('R', -58, 82, 55, -45), ...arm('L', -62, 22, 35, 0) }), COMBAT_FEET, 'in'],
    // hips already round, shoulders and blade still behind: the whip
    [4, stance({ ...pelvis([4, -2, 0], [0, -0.11, 0]), Torso: [9, -6, 0], Head: [-6, 6, 0], ...arm('R', -78, 60, 25, -55, 10), ...arm('L', -40, 26, 40, 0) }), COMBAT_FEET, 'linear'],
    [5, stance({ ...pelvis([6, 14, 0], [0, -0.12, 0.03], squash(0.03)), Torso: [13, 32, 0], Head: [-7, -20, 0], ...arm('R', -88, 0, 6, -62, 20), ...arm('L', 0, 38, 45, 0) }), COMBAT_FEET, 'out'],
    [7, stance({ ...pelvis([5, 18, 0], [0, -0.11, 0.03]), Torso: [12, 42, 0], Head: [-6, -24, 0], ...arm('R', -80, -42, 16, -55, 25), ...arm('L', 10, 40, 55, 10) }), COMBAT_FEET, 'inOut'],
    [12, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Combo 1: coil right, hips fire first, flat cut right to left at 5 (weight forward, off arm back), carry through, settle.',
};

/**
 * Second swing: from the first's follow-through, the blade loops over and the hips wind left,
 * then a backhand rips out to the right at frame 5, the off arm crossing the other way.
 */
export const Slash2: ClipDef = {
  name: 'Slash2',
  fast: true,
  frames: 12,
  grounded: true,
  ...track([
    [0, stance({ ...pelvis([4, 14, 0], [0, -0.1, 0.02]), Torso: [11, 34, 0], Head: [-6, -18, 0], ...arm('R', -76, -32, 30, -45, 20), ...arm('L', 0, 36, 50, 0) }), COMBAT_FEET],
    [3, stance({ ...pelvis([2, 20, 0], [0, -0.11, -0.01]), Torso: [9, 44, 0], Head: [-6, -26, 0], ...arm('R', -72, -50, 75, -30, 30), ...arm('L', -50, 20, 45, 0) }), COMBAT_FEET, 'in'],
    [4, stance({ ...pelvis([4, 4, 0], [0, -0.11, 0]), Torso: [10, 14, 0], Head: [-6, -8, 0], ...arm('R', -82, -20, 40, -50, 15), ...arm('L', -30, 26, 45, 0) }), COMBAT_FEET, 'linear'],
    [5, stance({ ...pelvis([6, -14, 0], [0, -0.12, 0.03], squash(0.03)), Torso: [13, -30, 0], Head: [-7, 18, 0], ...arm('R', -88, 44, 4, -62, -10), ...arm('L', 8, 34, 50, 0) }), COMBAT_FEET, 'out'],
    [7, stance({ ...pelvis([5, -20, 0], [0, -0.11, 0.02]), Torso: [11, -38, 0], Head: [-6, 22, 0], ...arm('R', -72, 84, 15, -55, -15), ...arm('L', 14, 30, 60, 0) }), COMBAT_FEET, 'inOut'],
    [12, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Combo 2: blade loops over, hips wind left, backhand rips left to right at 5, off arm crossing back.',
};

/**
 * Finisher: a big overhead chop. Sink and rise up tall on the toes with both hands high and
 * the blade behind the head (anticipation), then drop the whole body into it: the blade
 * drives down in front at frame 8 with a squash, the hips sunk and pushed forward, and holds
 * the hit before rising back to guard.
 */
export const Slash3: ClipDef = {
  name: 'Slash3',
  fast: true,
  frames: 18,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [2, stance({ ...pelvis([4, -4, 0], [0, -0.12, 0], squash(0.04)), Torso: [16, -4, 0], Head: [-12, 0, 0], ...arm('R', -70, 20, 80, -10), ...arm('L', -60, 20, 80, 0) }), COMBAT_FEET, 'out'],
    [5, stance({ ...pelvis([-8, -4, 0], [0, -0.02, -0.03], squash(-0.06)), Torso: [-18, 4, 0], Head: [-16, 0, 0], ...arm('R', -172, 20, 70, -5), ...arm('L', -160, 20, 80, 0) }), { R: { z: -0.03, pitch: 20, pivot: 'ball' }, L: { z: 0.06, pitch: 12, pivot: 'ball' } }, 'in'],
    [8, stance({ ...pelvis([10, 0, 0], [0, -0.19, 0.05], squash(0.08)), Torso: [34, 0, 0], Head: [-24, 0, 0], ...arm('R', -102, 10, 4, -46), ...arm('L', -94, 14, 14, 0) }), COMBAT_FEET, 'out'],
    [11, stance({ ...pelvis([11, 0, 0], [0, -0.2, 0.05], squash(0.06)), Torso: [36, 0, 0], Head: [-24, 0, 0], ...arm('R', -92, 12, 8, -44), ...arm('L', -86, 16, 18, 0) }), COMBAT_FEET, 'inOut'],
    [18, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Combo 3 (finisher): sink, rise tall on the toes with the blade behind the head, drop into the chop at 8 (squash), hold the hit.',
};

// ------------------------------------------------------------------ slams

/** The smash: feet where the guard has them (no shuffle), back heel up, body folded over the blade. */
const SMASH_FEET: FeetGoals = { R: { z: -0.03, pitch: 28, pivot: 'ball' }, L: { z: 0.06 } };
const SMASH_BODY: Pose = {
  ...pelvis([12, 0, 0], [0, -0.25, 0.04], squash(0.08)),
  Torso: [42, 0, 0],
  Head: [-30, 0, 0],
  ...arm('R', -84, 12, 5, -42),
  ...arm('L', -80, 14, 10, 0),
};

/**
 * Ground slam: gather low, heave both arms overhead rising tall onto the toes (a held beat of
 * anticipation), then the whole body drops into the smash: the blade hits the floor ahead at
 * frame 13 with a hard squash, holds, and the body pushes back up to guard.
 */
export const Slam: ClipDef = {
  name: 'Slam',
  fast: true,
  frames: 24,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [4, stance({ ...pelvis([6, 0, 0], [0, -0.15, 0], squash(0.05)), Torso: [24, 0, 0], Head: [-18, 0, 0], ...arms(-25, 15, 85, 10) }), COMBAT_FEET, 'out'],
    [9, { ...pelvis([-8, 0, 0], [0, -0.01, -0.03], squash(-0.06)), Torso: [-20, 0, 0], Head: [-18, 0, 0], ...arm('R', -176, 14, 30, -10), ...arm('L', -170, 14, 35, 0) }, { R: { z: -0.03, pitch: 24, pivot: 'ball' }, L: { z: 0.06, pitch: 16, pivot: 'ball' } }, 'inOut'],
    [11, { ...pelvis([-9, 0, 0], [0, 0, -0.03], squash(-0.07)), Torso: [-22, 0, 0], Head: [-18, 0, 0], ...arm('R', -180, 14, 26, -10), ...arm('L', -174, 14, 32, 0) }, { R: { z: -0.03, pitch: 26, pivot: 'ball' }, L: { z: 0.06, pitch: 18, pivot: 'ball' } }, 'in'],
    [13, SMASH_BODY, SMASH_FEET, 'out'],
    [17, { ...SMASH_BODY, ...pelvis([10, 0, 0], [0, -0.24, 0.04], squash(0.05)) }, SMASH_FEET, 'inOut'],
    [24, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Gather, heave overhead tall on the toes (held beat), drop into the smash at 13 (blade into the floor ahead, hard squash), hold, push back up.',
};

const TUCK_SWORD: Pose = {
  Torso: [20, 0, 0],
  Head: [-10, 0, 0],
  ...arm('R', -170, 15, 50, -10),
  ...arm('L', -150, 20, 60, 0),
  ...leg('R', -70, 6, 110, 30),
  ...leg('L', -50, 6, 100, 30),
};

/**
 * Leap slam: sink deep, arms swung back (anticipation), spring off stretched tall with the
 * sword thrown overhead (launch at 7), tuck in the air, reach down and land smashing at 19.6
 * (the land frame: the physics arc ends there), then rise.
 */
export const LeapSlam: ClipDef = {
  name: 'LeapSlam',
  fast: true,
  frames: 28,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, { ...pelvis([14, 0, 0], [0, -0.28, -0.04], squash(0.09)), Torso: [36, 0, 0], Head: [-26, 0, 0], ...arms(36, 20, 40, 10) }, COMBAT_FEET, 'out'],
    [7, F({ ...pelvis([-2, 0, 0], [0, 0, 0.02], [0.94, 1.1, 0.94]), Torso: [-8, 0, 0], Head: [-14, 0, 0], ...arm('R', -172, 15, 30, -10), ...arm('L', -155, 20, 30, 0) }, { R: { z: -0.03, pitch: 50, pivot: 'ball' }, L: { z: 0.06, pitch: 50, pivot: 'ball' } }), null],
    [13, { ...pelvis([-12, 0, 0], [0, 0.05, 0]), ...TUCK_SWORD }, null],
    [17, { ...pelvis([4, 0, 0], [0, 0.06, 0]), Torso: [26, 0, 0], Head: [-24, 0, 0], ...arm('R', -150, 12, 20, -30), ...arm('L', -140, 14, 25, 0), ...leg('R', -40, 6, 70, 30), ...leg('L', -36, 6, 60, 30) }, null, 'in'],
    [19.6, SMASH_BODY, SMASH_FEET, 'out'],
    [23, { ...SMASH_BODY, ...pelvis([10, 0, 0], [0, -0.24, 0.04], squash(0.05)) }, SMASH_FEET, 'inOut'],
    [28, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Sink deep, spring off stretched with the sword overhead (launch at 7), tuck, reach down, land smashing at 19.6, rise.',
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

/**
 * Casting with a staff or a wand in hand: the weapon does the pointing. Wind the weapon back
 * high past the ear, the off arm reaching ahead to aim, then drive the right shoulder round
 * and thrust the weapon straight at the target (wrist curled back: it extends the arm),
 * the off arm flung back to balance. Same timing as Cast.
 */
export const CastWeapon: ClipDef = {
  name: 'CastWeapon',
  fast: true,
  frames: 16,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, stance({ ...pelvis([0, -18, 0], [0, -0.1, -0.01]), Torso: [0, -24, 0], Head: [-8, 18, 0], ...arm('R', -165, 30, 70, -45), ...arm('L', -70, 30, 30, 0) }), COMBAT_FEET, 'in'],
    [8, stance({ ...pelvis([4, 16, 0], [0, -0.12, 0.03], squash(0.03)), Torso: [12, 22, 0], Head: [-10, -16, 0], ...arm('R', -92, 8, 0, -62), ...arm('L', 0, 40, 40, 0) }), COMBAT_FEET, 'out'],
    [11, stance({ ...pelvis([3, 13, 0], [0, -0.11, 0.02]), Torso: [10, 19, 0], Head: [-9, -13, 0], ...arm('R', -96, 10, 6, -58), ...arm('L', -8, 38, 45, 0) }), COMBAT_FEET],
    [16, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Staff / wand cast: weapon wound back past the ear, off hand aiming, then thrust straight at the target at 8, off arm flung back.',
};

/**
 * Big cast with a staff or wand: gather it low across the body, then sweep it up overhead in
 * both hands, pointing at the sky, chest open (the release at 12); hold, settle.
 */
export const CastBigWeapon: ClipDef = {
  name: 'CastBigWeapon',
  fast: true,
  frames: 22,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [7, stance({ ...pelvis([4, -10, 0], [0, -0.18, 0], squash(0.06)), Torso: [28, -8, 0], Head: [-22, 6, 0], ...arm('R', -30, 20, 90, 30), ...arm('L', -45, -10, 100, 10) }), COMBAT_FEET, 'in'],
    [12, { ...pelvis([-5, 6, 0], [0, -0.01, 0], squash(-0.05)), Torso: [-16, 4, 0], Head: [-26, 0, 0], ...arm('R', -172, 10, 12, -55), ...arm('L', -160, -6, 40, 0) }, COMBAT_FEET, 'out'],
    [15, { ...pelvis([-4, 5, 0], [0, -0.03, 0]), Torso: [-13, 3, 0], Head: [-22, 0, 0], ...arm('R', -168, 12, 16, -50), ...arm('L', -150, -2, 48, 0) }, COMBAT_FEET],
    [22, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Staff / wand big cast: gather low across the body, sweep the weapon up overhead to point at the sky at 12, chest open.',
};

// ------------------------------------------------------------------ bow

/**
 * Archery: side-on to the target (hips and chest turned 55 deg right, head turned back to
 * look down the arrow), the bow (left fist, src/riftlight/actors/weapons.ts) at arm's length on
 * the line, the right hand drawing the string from the chest back to the anchor under the
 * chin. Hand positions solved against the bow (string middle drawn back along the arrow line).
 * The game draws the string to the right hand between COMBAT_TIMING's `draw` frames and lets
 * it go at `hit`.
 */
const BOW_FEET: FeetGoals = { R: { z: -0.08 }, L: { z: 0.1 } };
const SIDE_ON: Pose = { ...pelvis([0, -40, 0], [0, -0.08, 0]), Torso: [4, -15, 0], Head: [-4, 50, 0] };
/** Bow arm raised and bent (nocking), then pushed out to the target. */
const BOW_UP = arm('L', -72, 55, 50, 0);
const BOW_OUT = arm('L', -87, 56, 5, 0);
/** The drawing hand: at the chest by the string, half drawn, at the anchor, flown back on release. */
const NOCK = arm('R', -67, -81, 10, 0);
const HALF = arm('R', -80, -88, 14, 0);
const ANCHOR = arm('R', -87, -90, 19, 0);
const LOOSE = arm('R', -96, -40, 70, 10);

/** Full bow shot: raise and nock, push-pull to the anchor, release (the hand flies back), recover. */
export const BowDraw: ClipDef = {
  name: 'BowDraw',
  fast: true,
  frames: 18,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    // turn side-on, bow up and in, the right hand takes the string
    [4, { ...SIDE_ON, ...pelvis([0, -34, 0], [0, -0.06, 0]), Torso: [6, -12, 0], Head: [-6, 42, 0], ...BOW_UP, ...NOCK }, BOW_FEET, 'out'],
    // push the bow out while pulling the string: the draw builds slowly ('in': the strain)
    [8, { ...SIDE_ON, ...arm('L', -82, 56, 24, 0), ...HALF }, BOW_FEET, 'in'],
    // full draw: chest open, a hair of lean back, hold
    [11, { ...SIDE_ON, ...pelvis([-2, -41, 0], [0, -0.09, -0.01]), Torso: [0, -16, 0], ...BOW_OUT, ...ANCHOR }, BOW_FEET],
    [12, { ...SIDE_ON, ...pelvis([-2, -41, 0], [0, -0.09, -0.01]), Torso: [0, -16, 0], ...arm('L', -86, 57, 4, -6), ...LOOSE }, BOW_FEET, 'out'],
    // follow-through: the bow arm stays on the line, the string hand opens back past the ear
    [14, { ...SIDE_ON, Torso: [0, -18, 0], ...arm('L', -84, 58, 6, -8), ...arm('R', -70, 10, 40, 10) }, BOW_FEET, 'inOut'],
    [18, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Turn side-on, nock at the chest, push-pull to the anchor under the chin, release at 12 (the hand flies back), bow arm holds the line.',
};

/** Quick follow-up shot: the same draw, nocked on the way up, released at 6. */
export const BowRelease: ClipDef = {
  name: 'BowRelease',
  fast: true,
  frames: 12,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [2, { ...SIDE_ON, ...pelvis([0, -34, 0], [0, -0.07, 0]), Torso: [6, -12, 0], Head: [-6, 42, 0], ...arm('L', -78, 56, 36, 0), ...NOCK }, BOW_FEET, 'out'],
    [5, { ...SIDE_ON, ...pelvis([-2, -41, 0], [0, -0.09, -0.01]), Torso: [0, -16, 0], ...BOW_OUT, ...ANCHOR }, BOW_FEET, 'in'],
    [6, { ...SIDE_ON, ...pelvis([-2, -41, 0], [0, -0.09, -0.01]), Torso: [0, -16, 0], ...arm('L', -86, 57, 4, -6), ...LOOSE }, BOW_FEET, 'out'],
    [8, { ...SIDE_ON, Torso: [0, -18, 0], ...arm('L', -84, 58, 6, -8), ...arm('R', -70, 10, 40, 10) }, BOW_FEET, 'inOut'],
    [12, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Snap shot: nock on the way up, anchor at 5, release at 6.',
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

const CHARGE_BODY: Pose = { ...pelvis([18, 18, 0], [0, -0.1, 0.04]), Torso: [24, 20, 0], Head: [-30, -14, 0], ...arm('L', -52, 30, 120, 10), ...arm('R', 14, 20, 60, -10) };
const BOUND: FeetGoals = { R: { z: -0.34, y: 0.12, pitch: 40, pivot: 'ball' }, L: { z: 0.3, y: 0.06 } };
const BOUND2: FeetGoals = { R: { z: 0.26, y: 0.07 }, L: { z: -0.3, y: 0.14, pitch: 40, pivot: 'ball' } };

/**
 * Shield charge / dash: drop the shoulder and explode off the back foot (the dash starts at
 * frame 2), drive forward in long bounds (legs scissoring), then brake: the feet come down
 * ahead as the dash's root motion slows (DASH_PROFILE), the body leaning back, and recover.
 */
export const Charge: ClipDef = {
  name: 'Charge',
  fast: true,
  frames: 14,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [1, stance({ ...pelvis([10, 12, 0], [0, -0.16, 0], squash(0.05)), Torso: [20, 14, 0], Head: [-24, -10, 0], ...arm('L', -45, 30, 110, 10), ...arm('R', 0, 20, 60, -10) }), COMBAT_FEET, 'out'],
    [2, CHARGE_BODY, BOUND, 'inOut'],
    [6, { ...CHARGE_BODY, ...pelvis([20, 18, 0], [0, -0.06, 0.04]), ...arm('L', -58, 30, 120, 10), ...arm('R', 24, 22, 60, -10) }, BOUND2, 'inOut'],
    [10, { ...CHARGE_BODY, ...pelvis([16, 18, 0], [0, -0.08, 0.04]), ...arm('L', -52, 30, 120, 10), ...arm('R', 10, 22, 60, -10) }, { R: { z: -0.2, y: 0.08, pitch: 30, pivot: 'ball' }, L: { z: 0.28, y: 0.04 } }, 'in'],
    // brake: heels dig in ahead, body back
    [12, stance({ ...pelvis([-6, 10, 0], [0, -0.14, -0.04], squash(0.04)), Torso: [-4, 10, 0], Head: [-12, -6, 0], ...arm('L', -60, 36, 80, 10), ...arm('R', -10, 30, 50, -10) }), { R: { z: -0.12, pitch: 20, pivot: 'ball' }, L: { z: 0.2, pitch: -15, pivot: 'heel' } }, 'inOut'],
    [14, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Drop the shoulder, explode off the back foot (dash from 2), drive in scissoring bounds, brake heels-first leaning back, recover.',
};

// ------------------------------------------------------------------ reactions

/**
 * War cry: hunch and draw breath, fists pulled in across the chest (anticipation), then burst
 * open at frame 9: chest out, head thrust up, arms flung wide and down with the fists
 * clenched, a stretch; hold it shaking, then settle back to guard.
 */
export const Shout: ClipDef = {
  name: 'Shout',
  fast: true,
  frames: 20,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [5, stance({ ...pelvis([4, 0, 0], [0, -0.16, -0.02], squash(0.06)), Torso: [28, 0, 0], Head: [16, 0, 0], ...arms(-40, -14, 125, 20) }), COMBAT_FEET, 'in'],
    [9, { ...pelvis([-5, 0, 0], [0, -0.05, 0.02], squash(-0.04)), Torso: [-18, 0, 0], Head: [-30, 0, 0], ...arms(-28, 72, 40, -20) }, COMBAT_FEET, 'outBack'],
    [11, { ...pelvis([-4, 0, 0], [0, -0.07, 0.02]), Torso: [-15, 0, -2], Head: [-27, 0, 3], ...arms(-30, 68, 44, -20) }, COMBAT_FEET, 'inOut'],
    [13, { ...pelvis([-4, 0, 0], [0, -0.07, 0.02]), Torso: [-16, 0, 2], Head: [-28, 0, -3], ...arms(-29, 70, 40, -20) }, COMBAT_FEET, 'inOut'],
    [15, { ...pelvis([-3, 0, 0], [0, -0.08, 0.01]), Torso: [-12, 0, 0], Head: [-24, 0, 0], ...arms(-32, 64, 44, -15) }, COMBAT_FEET],
    [20, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Hunch and draw breath, fists in, then burst open at 9: chest out, head up, arms flung wide and down; shaking hold, settle.',
};

/**
 * Hit react: snapped back from the blow at once (head whipped back, arms flung up and out),
 * the knees give, then the body folds forward past guard and recovers.
 */
export const HitReact: ClipDef = {
  name: 'HitReact',
  fast: true,
  frames: 10,
  grounded: true,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [1, stance({ ...pelvis([-12, 4, 0], [0, -0.09, -0.04]), Torso: [-20, -10, 4], Head: [-26, 8, 6], ...arm('R', -40, 46, 50, -10), ...arm('L', -80, 48, 30, 0) }), COMBAT_FEET, 'out'],
    [3, stance({ ...pelvis([-8, 2, 0], [0, -0.13, -0.03], squash(0.04)), Torso: [-12, -6, 2], Head: [-14, 4, 2], ...arm('R', -30, 40, 55, -10), ...arm('L', -66, 44, 40, 0) }), COMBAT_FEET, 'inOut'],
    [6, stance({ ...pelvis([6, 0, 0], [0, -0.12, 0.01]), Torso: [18, 0, 0], Head: [8, 0, 0] }), COMBAT_FEET, 'inOut'],
    [10, COMBAT_BODY, COMBAT_FEET],
  ]),
  notes: 'Snapped back at once (head whipped, arms flung), knees give, fold forward past guard, recover.',
};

/**
 * Death: the feet never leave where they stood (planted from first frame to last, solved by
 * IK even lying down), so nothing skates: struck, the body reels back, the knees buckle
 * forward over the feet, it drops onto its backside and falls back flat, knees up, with a
 * small bounce; the head lolls aside.
 */
const DEATH_FEET: FeetGoals = { R: { z: -0.02, pitch: 15, pivot: 'ball' }, L: { z: 0.07 } };
const DEAD_FEET: FeetGoals = { R: { z: -0.02 }, L: { z: 0.07 } };
const KNEES: Pose = { ...pelvis([2, 0, 0], [0, -0.3, -0.08]), Torso: [14, 0, 4], Head: [26, 6, 0], ...arm('R', -20, 26, 30, 10), ...arm('L', -14, 30, 34) };
const SIT: Pose = { ...pelvis([-38, 0, -6], [0, -0.44, -0.24]), Torso: [16, 0, 8], Head: [16, 10, 0], ...arm('R', -30, 40, 30), ...arm('L', -36, 46, 30) };
const DEAD_BODY: Pose = { ...pelvis([-84, 0, -8], [0, 0.2 - 0.62, -0.36]), Torso: [-2, 0, 6], Head: [22, -26, 0], ...arm('R', -16, 72, 22), ...arm('L', -26, 52, 40) };

export const Death: ClipDef = {
  name: 'Death',
  fast: true,
  frames: 36,
  ...track([
    [0, COMBAT_BODY, COMBAT_FEET],
    [4, stance({ ...pelvis([-14, 0, 0], [0, -0.08, -0.05]), Torso: [-22, 0, 0], Head: [-32, 0, 0], ...arms(-60, 42, 30) }), COMBAT_FEET, 'out'],
    [11, KNEES, DEATH_FEET, 'in'],
    [16, SIT, DEAD_FEET, 'in'],
    [20, { ...DEAD_BODY, ...pelvis([-84, 0, -8], [0, 0.2 - 0.62 + 0.05, -0.36]) }, DEAD_FEET, 'out'],
    [23, { ...DEAD_BODY, ...pelvis([-82, 0, -8], [0, 0.2 - 0.62 + 0.02, -0.36]), Head: [14, -20, 0] }, DEAD_FEET, 'inOut'],
    [36, DEAD_BODY, DEAD_FEET],
  ]),
  notes: 'Struck: reels back, knees buckle over the planted feet, drops to sit, falls back flat (knees up) with a small bounce.',
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
export const COMBAT_CLIPS: readonly ClipDef[] = [Slash1, Slash2, Slash3, Slam, LeapSlam, Spin, Cast, CastBig, CastWeapon, CastBigWeapon, BowDraw, BowRelease, Roll, Charge, Shout, HitReact, Death, Triumph];
