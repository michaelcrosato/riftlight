import { gaitClip, mirrorClip, placeFeet, type ClipDef, type Ease, type FeetGoals, type FeetKey, type FootGoal, type Key, type Pose } from '../../engine/animation';
import { HERO_RIG as RIG } from './rig';

/**
 * Every hero animation, as data. Edit numbers, then:
 *
 *   npm run anim -- check            metrics for every clip (foot slide, floor, seams...)
 *   npm run anim -- sheet Walk       contact sheet PNG in .scratch/anim/
 *   npm run dev → /lab.html          live Animation Lab (hot-reloads this file)
 *
 * Conventions (see rig.ts for the full cheat-sheet): frames at 30 fps, degrees, the
 * character faces +Z, R/L are its own sides. `arm()` / `leg()` take friendly values:
 * swing (−90 = forward), out (+ = away from the body), bend (+ = elbow/knee bent).
 *
 * Feet: `track()` keys take foot goals (IK). Where two neighbouring keys both have goals
 * the legs are solved every frame, so feet stay on the floor through the transition.
 * `null` = legs as keyed (airborne, lying down).
 */

// ---------------------------------------------------------------- helpers

type Side = 'R' | 'L';
type V3 = [number, number, number];

/** Arm: swing (−90 ahead, −180 overhead, + back), out (+ away from body), elbow bend, wrist curl, twist. */
function arm(side: Side, swing: number, out = 0, elbow = 0, wrist = 0, twist = 0): Pose {
  const s = side === 'R' ? -1 : 1;
  return { [`Arm${side}`]: [swing, twist * s, out * s], [`Forearm${side}`]: [-elbow, 0, 0], [`Hand${side}`]: [-wrist, 0, 0] };
}
const arms = (swing: number, out = 0, elbow = 0, wrist = 0): Pose => ({ ...arm('R', swing, out, elbow, wrist), ...arm('L', swing, out, elbow, wrist) });

/** Leg: swing (−X forward), out (+ away from body), knee bend, toes (+ pointed down). */
function leg(side: Side, swing: number, out = 0, knee = 0, toes = 0): Pose {
  const s = side === 'R' ? -1 : 1;
  return { [`Leg${side}`]: [swing, 0, out * s], [`Shin${side}`]: [knee, 0, 0], [`Foot${side}`]: [toes, 0, 0] };
}

/** Root pose: rotation (deg), offset from standing (m), squash (uniform or xyz). */
const pelvis = (r: V3 = [0, 0, 0], p: V3 = [0, 0, 0], s: number | V3 = 1): Pose => ({ Pelvis: { r, p, s } });

/** Squash (+) or stretch (−), volume-ish preserving. */
const squash = (k: number): V3 => [1 + k * 0.5, 1 - k, 1 + k * 0.5];

/** Pin feet on a single pose (IK). */
const F = (body: Pose, feet: FeetGoals): Pose => placeFeet(body, RIG, feet as Partial<Record<Side, FootGoal>>);

type TrackKey = readonly [frame: number, body: Pose, feet: FeetGoals | null, ease?: Ease];
/** Keys with foot goals: poses are solved at the keys and the feet track in between. */
function track(keys: readonly TrackKey[]): Pick<ClipDef, 'keys' | 'feet'> {
  return {
    keys: keys.map(([f, body, feet, ease]): Key => [f, feet ? F(body, feet) : body, ease]),
    feet: keys.map(([f, , feet, ease]): FeetKey => [f, feet ?? {}, ease]),
  };
}

/** Both feet flat at these forward positions. */
const flat = (r: number, l: number): FeetGoals => ({ R: { z: r }, L: { z: l } });

// ---------------------------------------------------------------- standing

const STAND_FEET = flat(0.04, -0.03);
const STAND_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.025, 0]),
  Torso: [4, 0, 0],
  Head: [-4, 0, 0],
  ...arm('R', 6, 9, 22, 10),
  ...arm('L', 6, 9, 22, 10),
};
const STAND_IN: Pose = { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.035, 0]), Torso: [2, 0, 0], Head: [-2, 0, 0], ...arm('R', 4, 12, 20, 10), ...arm('L', 4, 12, 20, 10) };

const Idle: ClipDef = {
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
const IdleLook: ClipDef = {
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
const Teeter: ClipDef = {
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

// ---------------------------------------------------------------- locomotion

const Tiptoe = gaitClip(RIG, {
  name: 'Tiptoe',
  frames: 24,
  speed: 0.9,
  stance: 0.62,
  hip: -0.03,
  bob: 0.015,
  lift: 0.07,
  tiptoe: 22,
  toeOff: 10,
  lean: 10,
  twist: 6,
  head: -6,
  arms: { swing: 14, elbow: 95, spread: 28, forward: 35, lag: 0.08 },
  pose: { HandR: [-35, 0, 0], HandL: [-35, 0, 0] },
  notes: 'Sneaking on the balls of the feet, hands up like paws.',
});

const Walk = gaitClip(RIG, {
  name: 'Walk',
  frames: 12,
  speed: 2,
  stance: 0.53,
  hip: -0.07,
  bob: 0.025,
  squash: 0.03,
  lift: 0.09,
  liftPeak: 0.35,
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

const Run = gaitClip(RIG, {
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
  toeOff: 30,
  lean: 18,
  twist: 16,
  head: -8,
  arms: { swing: 55, elbow: 85, pump: 12, spread: 12, lag: 0.05 },
  pose: { HandR: [-25, 0, 0], HandL: [-25, 0, 0] },
  notes: 'Full sprint: forward lean, flight phase, high knees, pumping fists.',
});

const SKID_FEET: FeetGoals = { R: { z: 0.36, pitch: -30, pivot: 'heel' }, L: { z: -0.2, pitch: 10, pivot: 'ball' } };
const SKID_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.14, -0.06]),
  Torso: [-18, 0, 4],
  Head: [8, 0, 0],
  ...arm('R', -115, 45, 25, 0),
  ...arm('L', -95, 55, 30, 0),
};
const Skid: ClipDef = {
  name: 'Skid',
  frames: 18,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [4, SKID_BODY, SKID_FEET, 'out'],
    [18, { ...SKID_BODY, ...arm('R', -105, 45, 25, 0), ...arm('L', -105, 55, 30, 0) }, SKID_FEET],
  ]),
  notes: 'Brakes hard: leans back on the front heel, arms thrown forward.',
};

const StepUp: ClipDef = {
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

const StepDown: ClipDef = {
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

// ---------------------------------------------------------------- crouch / prone

const CROUCH_FEET = flat(0.12, 0.04);
const CROUCH_BODY: Pose = {
  ...pelvis([0, 0, 0], [0, -0.3, -0.1]),
  Torso: [40, 0, 0],
  Head: [-28, 0, 0],
  ...arm('R', -35, 16, 45, 15),
  ...arm('L', -35, 16, 45, 15),
};
const Crouch: ClipDef = {
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

const CrouchWalk = gaitClip(RIG, {
  name: 'CrouchWalk',
  frames: 16,
  speed: 1.4,
  stance: 0.62,
  hip: -0.24,
  bob: 0.012,
  lift: 0.05,
  dangle: 0.2,
  heelStrike: 5,
  toeOff: 10,
  lean: 36,
  twist: 8,
  head: -14,
  arms: { swing: 14, elbow: 45, forward: 35, spread: 16 },
  notes: 'Duck walk: low, short steps, arms ready.',
});

const CSLIDE_FEET: FeetGoals = { R: { z: 0.3, pitch: -15, pivot: 'heel' }, L: { z: -0.1, pitch: 20, pivot: 'ball' } };
const CSLIDE: Pose = { ...pelvis([0, 0, 0], [0, -0.3, -0.05]), Torso: [22, 0, 0], Head: [-18, 0, 0], ...arm('R', 30, 30, 30), ...arm('L', 30, 30, 30) };
const CrouchSlide: ClipDef = {
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
const PRONE_Y = 0.18 - 0.62;
const PRONE_BODY: Pose = {
  ...pelvis([90, 0, 0], [0, PRONE_Y, -0.3]),
  Torso: [-4, 0, 0],
  Head: [-55, 0, 0],
  ...arm('R', -135, 22, 55),
  ...arm('L', -135, 22, 55),
  ...leg('R', 2, 6, 5, 70),
  ...leg('L', 2, 6, 5, 70),
};
const Prone: ClipDef = {
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
const PLANK_FEET: FeetGoals = { R: { z: -0.62, pitch: 70, pivot: 'ball' }, L: { z: -0.62, pitch: 70, pivot: 'ball' } };
const PLANK: Pose = { ...pelvis([62, 0, 0], [0, -0.18, -0.15]), Torso: [10, 0, 0], Head: [-45, 0, 0], ...arms(-74, 18, 5) };

// Halfway between plank and prone: chest low, elbows bent, toes still dug in.
const LOWERED: Pose = { ...pelvis([80, 0, 0], [0, -0.36, -0.2]), Torso: [0, 0, 0], Head: [-50, 0, 0], ...arms(-105, 26, 75) };
const LOWERED_FEET: FeetGoals = { R: { z: -0.85, pitch: 80, pivot: 'ball' }, L: { z: -0.85, pitch: 80, pivot: 'ball' } };

const ProneDown: ClipDef = {
  name: 'ProneDown',
  frames: 16,
  ...track([
    [0, CROUCH_BODY, CROUCH_FEET],
    [4, { ...CROUCH_BODY, Torso: [62, 0, 0], Head: [-40, 0, 0], ...arms(-90, 20, 10) }, CROUCH_FEET],
    [7, { ...PLANK, ...pelvis([40, 0, 0], [0, -0.2, -0.12]) }, { R: { z: -0.3, y: 0.08, pitch: 50, pivot: 'ball' }, L: { z: -0.3, y: 0.08, pitch: 50, pivot: 'ball' } }],
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
const Crawl: ClipDef = {
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

const GetUpFront: ClipDef = {
  name: 'GetUpFront',
  frames: 21,
  ...track([
    [0, PRONE_BODY, null],
    [3, LOWERED, LOWERED_FEET],
    [6, PLANK, PLANK_FEET],
    [10, { ...PLANK, ...pelvis([35, 0, 0], [0, -0.22, -0.12]), Torso: [40, 0, 0], ...arms(-80, 20, 10) }, { R: { z: -0.2, y: 0.1, pitch: 40, pivot: 'ball' }, L: { z: -0.2, y: 0.1, pitch: 40, pivot: 'ball' } }],
    [14, { ...CROUCH_BODY, Torso: [50, 0, 0], ...arms(-50, 20, 20) }, CROUCH_FEET, 'out'],
    [21, STAND_BODY, STAND_FEET],
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
const Sit: ClipDef = {
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
  ...pelvis([-90, 0, 0], [0, 0.19 - 0.62, 0.3]),
  Torso: [0, 0, 0],
  Head: [30, 0, 0],
  ...arm('R', -8, 28, 20),
  ...arm('L', -8, 28, 20),
  ...leg('R', -5, 6, 6, -15),
  ...leg('L', -5, 6, 6, -15),
};
const LieDown: ClipDef = {
  name: 'LieDown',
  frames: 30,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [8, { ...CROUCH_BODY, ...arms(-10, 30, 20) }, CROUCH_FEET, 'out'],
    [16, SIT_BODY, SIT_FEET],
    [23, { ...SIT_BODY, ...pelvis([-45, 0, 0], [0, -0.49, 0.15]), Torso: [5, 0, 0], ...arms(-30, 30, 30) }, { R: { z: 0.6, y: 0.02, pitch: -30, pivot: 'heel' }, L: { z: 0.56, y: 0.02, pitch: -30, pivot: 'heel' } }],
    [30, BACK_BODY, null],
  ]),
  notes: 'Squats, sits down, then lies back.',
};

const LieIdle: ClipDef = {
  name: 'LieIdle',
  frames: 60,
  loop: true,
  keys: [
    [0, BACK_BODY],
    [30, { ...BACK_BODY, Torso: [-3, 0, 0], Head: [32, 0, 0] }],
    [60, BACK_BODY],
  ],
  notes: 'Resting on the back.',
};

const SLEEP_BODY: Pose = { ...BACK_BODY, Head: [32, 12, -4], ...arm('R', -140, 50, 120), ...arm('L', -10, 20, 30), ...leg('L', -30, 10, 60, -10) };
const Sleep: ClipDef = {
  name: 'Sleep',
  frames: 90,
  loop: true,
  keys: [
    [0, SLEEP_BODY],
    [45, { ...SLEEP_BODY, ...pelvis([-90, 0, 0], [0, 0.205 - 0.62, 0.3], [1.03, 1, 1.03]), Head: [34, 12, -4] }],
    [90, SLEEP_BODY],
  ],
  notes: 'Snoozing: hand behind the head, one knee up, big slow breaths.',
};

const GetUp: ClipDef = {
  name: 'GetUp',
  frames: 24,
  ...track([
    [0, BACK_BODY, null],
    [8, { ...SIT_BODY, Torso: [30, 0, 0], ...arms(-60, 20, 20) }, SIT_FEET, 'out'],
    [15, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.3, -0.08]), Torso: [45, 0, 0], ...arms(-50, 20, 20) }, flat(0.14, 0.1)],
    [24, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Sit up, feet under, stand.',
};

// ---------------------------------------------------------------- jumps (airborne; physics owns height)

const LAUNCH_FEET: FeetGoals = { R: { z: 0.02, pitch: 25, pivot: 'ball' }, L: { z: -0.04, pitch: 25, pivot: 'ball' } };
const LAUNCH_BODY: Pose = { ...pelvis([0, 0, 0], [0, -0.12, 0], squash(0.08)), Torso: [18, 0, 0], ...arms(25, 12, 30) };
const STRETCH: Pose = { ...pelvis([0, 0, 0], [0, 0.24, 0], [0.92, 1.12, 0.92]), Torso: [-4, 0, 0], Head: [-12, 0, 0], ...arm('R', -170, 12, 5), ...arm('L', -40, 18, 20), ...leg('R', 8, 3, 10, 45), ...leg('L', 12, 3, 20, 45) };
const DESCEND: Pose = { ...pelvis([0, 0, 0], [0, 0.1, 0]), Torso: [6, 0, 0], Head: [8, 0, 0], ...arm('R', -80, 60, 30), ...arm('L', -75, 60, 30), ...leg('R', -25, 5, 40, 20), ...leg('L', -10, 5, 25, 20) };

const Jump: ClipDef = {
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

const JumpUp: ClipDef = {
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

const DoubleJump: ClipDef = {
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

/**
 * Root for a body spinning `angle` degrees about X (flip) or Z (cartwheel) around its
 * middle (`pivot`, relative to the hips) instead of the hips, lifted by `lift`.
 */
function spinRoot(axis: 'x' | 'z', angle: number, pivot: V3 = [0, 0.2, 0.25], lift = 0.15): Pose {
  const a = (angle * Math.PI) / 180;
  const [, cy, cz] = pivot;
  if (axis === 'x') {
    const y = cy * Math.cos(a) - cz * Math.sin(a);
    const z = cy * Math.sin(a) + cz * Math.cos(a);
    return pelvis([angle, 0, 0], [0, lift + cy - y, cz - z]);
  }
  return pelvis([0, 0, angle], [cy * Math.sin(a), lift + cy - cy * Math.cos(a), 0]);
}

/** Keys (≤ 30° apart, eased overall) for a somersault from `from` to `to` degrees. */
function somersault(axis: 'x' | 'z', from: number, to: number, f0: number, f1: number, body: Pose, pivot?: V3, shape: 'linear' | 'inOut' | 'out' = 'linear'): TrackKey[] {
  const n = Math.max(2, Math.ceil(Math.abs(to - from) / 30));
  const ease = (u: number) => (shape === 'inOut' ? u * u * (3 - 2 * u) : shape === 'out' ? 1 - (1 - u) * (1 - u) : u);
  return Array.from({ length: n + 1 }, (_, i): TrackKey => {
    const u = i / n;
    return [f0 + (f1 - f0) * u, { ...body, ...spinRoot(axis, from + (to - from) * ease(u), pivot) }, null, 'linear'];
  });
}

const TripleJump: ClipDef = {
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

const Backflip: ClipDef = {
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
const SideFlip: ClipDef = {
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
const LongJump: ClipDef = {
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

const WallKick: ClipDef = {
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
const WallSlide: ClipDef = {
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
const Fall: ClipDef = {
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
const Dive: ClipDef = {
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
const BellySlide: ClipDef = {
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

const GroundPoundSpin: ClipDef = {
  name: 'GroundPoundSpin',
  frames: 9,
  fast: true,
  keys: [
    ...somersault('x', 0, 360, 0, 9, TUCK_BODY).map(([f, body, , ease]): Key => [f, body, ease]),
  ],
  notes: 'Mid-air somersault before the ground pound.',
};

const POUND: Pose = { ...pelvis([0, 0, 0], [0, 0.25, 0]), Torso: [15, 0, 0], Head: [18, 0, 0], ...arm('R', -40, 70, 60), ...arm('L', -40, 70, 60), ...leg('R', -85, 10, 115, 10), ...leg('L', -85, 10, 115, 10) };
const GroundPound: ClipDef = {
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
const GroundPoundLand: ClipDef = {
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

const Land: ClipDef = {
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
const HardLand: ClipDef = {
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
const Slide: ClipDef = {
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

// ---------------------------------------------------------------- ledges and climbing

const HANG: Pose = {
  ...pelvis([0, 0, 0], [0, 0.1, 0]),
  Torso: [6, 0, 0],
  Head: [-12, 0, 0],
  ...arm('R', -152, 12, 10, 20),
  ...arm('L', -152, 12, 10, 20),
  ...leg('R', -6, 4, 14, 30),
  ...leg('L', 4, 4, 22, 30),
};
const Hang: ClipDef = {
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

const ShimmyRight: ClipDef = {
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
const ShimmyLeft = mirrorClip(ShimmyRight, 'ShimmyLeft', RIG);

const PullUp: ClipDef = {
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
const Climb: ClipDef = {
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
const ClimbIdle: ClipDef = {
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

// ---------------------------------------------------------------- push / grab / pull

const Push = gaitClip(RIG, {
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
const PUSH_FEET: FeetGoals = { R: { z: -0.12 }, L: { z: -0.35, pitch: 30, pivot: 'ball' } };
const PUSH_IDLE: Pose = { ...pelvis([10, 0, 0], [0, -0.12, 0]), Torso: [30, 0, 0], Head: [-35, 0, 0], ...arms(-115, 14, 35) };
const PushIdle: ClipDef = {
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
const Grab: ClipDef = {
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

const Pull = gaitClip(RIG, {
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

// ---------------------------------------------------------------- attacks

const GUARD_FEET = flat(-0.12, 0.14);
const GUARD_BODY: Pose = { ...pelvis([0, 0, 0], [0, -0.07, 0]), Torso: [8, 0, 0], Head: [-6, 0, 0], ...arm('R', -40, 16, 115, 10), ...arm('L', -48, 16, 120, 10) };
const guard = (body: Pose): Pose => ({ ...GUARD_BODY, ...body });

const Punch: ClipDef = {
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

const Punch2: ClipDef = {
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
const Kick: ClipDef = {
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
const SweepKick: ClipDef = {
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

const JumpKick: ClipDef = {
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

// ---------------------------------------------------------------- emotes and reactions

const waveUp = (out: number, elbow: number): Pose => ({ ...STAND_BODY, Torso: [2, 0, -4], Head: [-8, 0, 8], ...arm('R', -15, out, elbow, 0, 60) });
const Wave: ClipDef = {
  name: 'Wave',
  frames: 44,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [7, waveUp(150, 40), STAND_FEET, 'out'],
    [12, waveUp(165, 20), STAND_FEET],
    [17, waveUp(142, 55), STAND_FEET],
    [22, waveUp(165, 20), STAND_FEET],
    [27, waveUp(142, 55), STAND_FEET],
    [32, waveUp(160, 30), STAND_FEET],
    [44, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Friendly wave over the head.',
};

const VICTORY_POSE: Pose = { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.02, 0]), Torso: [-6, 0, 0], Head: [-12, 0, 0], ...arm('R', -165, 28, 20), ...arm('L', 15, 35, 115) };
const Victory: ClipDef = {
  name: 'Victory',
  fast: true,
  frames: 48,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [7, { ...CROUCH_BODY, ...pelvis([0, 0, 0], [0, -0.2, -0.05], squash(0.08)), Torso: [20, 0, 0], ...arms(20, 20, 60) }, STAND_FEET, 'out'],
    [13, { ...STRETCH, ...pelvis([0, 20, 0], [0, 0.35, 0], [0.92, 1.12, 0.92]), ...arm('R', -178, 10, 0), ...arm('L', 10, 40, 110), ...leg('R', 10, 4, 20, 45), ...leg('L', -60, 4, 90, 30) }, null],
    [20, { ...STRETCH, ...pelvis([0, 20, 0], [0, 0.3, 0]), ...arm('R', -178, 10, 0), ...arm('L', 10, 40, 110), ...leg('R', 5, 4, 30, 45), ...leg('L', -50, 4, 80, 30) }, null],
    [26, { ...STAND_BODY, ...pelvis([0, 10, 0], [0, -0.14, 0], squash(0.1)), Torso: [12, 0, 0], ...arm('R', -175, 10, 10), ...arm('L', 10, 40, 110) }, flat(0.06, -0.06), 'out'],
    [34, VICTORY_POSE, flat(0.06, -0.06)],
    [48, { ...VICTORY_POSE, ...arm('R', -168, 24, 15) }, flat(0.06, -0.06)],
  ]),
  notes: 'Star get: crouch, leap with a fist in the air, land and hold the pose.',
};

const Hurt: ClipDef = {
  name: 'Hurt',
  fast: true,
  frames: 20,
  grounded: true,
  ...track([
    [0, STAND_BODY, STAND_FEET],
    [3, { ...STAND_BODY, ...pelvis([-12, 0, 0], [0, -0.06, -0.05]), Torso: [-18, 0, 0], Head: [-25, 0, 0], ...arms(-110, 35, 20) }, STAND_FEET, 'out'],
    [10, { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.12, 0]), Torso: [20, 0, 0], Head: [15, 0, 0], ...arms(-20, 25, 40) }, STAND_FEET],
    [20, STAND_BODY, STAND_FEET],
  ]),
  notes: 'Knocked back, then doubles over.',
};

export const HERO_CLIPS: readonly ClipDef[] = [
  Idle, IdleLook, Teeter,
  Tiptoe, Walk, Run, Skid, StepUp, StepDown,
  Crouch, CrouchWalk, CrouchSlide, ProneDown, Prone, Crawl, GetUpFront,
  Sit, LieDown, LieIdle, Sleep, GetUp,
  Jump, JumpUp, DoubleJump, TripleJump, Backflip, SideFlip, LongJump, WallKick, WallSlide,
  Fall, Dive, BellySlide, GroundPoundSpin, GroundPound, GroundPoundLand, Land, HardLand, Slide,
  Hang, ShimmyRight, ShimmyLeft, PullUp, ClimbIdle, Climb,
  Push, PushIdle, Grab, Pull,
  Punch, Punch2, Kick, SweepKick, JumpKick,
  Wave, Victory, Hurt,
];

