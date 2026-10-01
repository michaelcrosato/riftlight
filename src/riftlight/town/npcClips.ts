/**
 * Townsfolk clips, as data (docs/ANIMATION.md). The townsfolk wear the hero's rig, so
 * these use the hero's clip helpers (arm, leg, pelvis, track, flat) and its standing
 * poses. Check them with the anim tools:
 *
 *   npm run anim -- check --character brann
 *   npm run anim -- sheet Hammer --character brann --compare
 *   npm run anim -- curves Hammer --character brann
 *
 * Event times (sparks, coin clinks) are exported next to the clips that need them.
 */
import type { ClipDef, Pose } from '../../engine/animation';
import { arm, arms, leg, pelvis, squash, track } from '../../game/hero/clips/helpers';
import { Idle, STAND_BODY, STAND_FEET } from '../../game/hero/clips/standing';
import { Walk } from '../../game/hero/clips/locomotion';

// ------------------------------------------------------------------ Brann, the blacksmith

const FORGE_FEET = { R: { z: 0.1 }, L: { z: -0.12 } };
const FORGE: Pose = {
  ...pelvis([0, -8, 0], [0, -0.07, 0]),
  Torso: [14, 8, 0],
  Head: [14, -6, 0],
  ...arm('L', -52, 16, 72, 6),
  ...arm('R', -42, 14, 72, 0),
};
const forge = (p: Pose): Pose => ({ ...FORGE, ...p });

/** Frame of the hammer's impact in `Hammer` (sparks, clang, forge flash). */
export const HAMMER_STRIKE_FRAME = 17;

export const Hammer: ClipDef = {
  name: 'Hammer',
  frames: 40,
  loop: true,
  fast: true,
  grounded: true,
  ...track([
    [0, FORGE, FORGE_FEET],
    // wind up: the hammer comes back and up, the body opens and rises a little
    [8, forge({ ...pelvis([0, -10, 0], [0, -0.05, 0]), Torso: [2, 14, 0], Head: [6, -4, 0], ...arm('R', -125, 20, 95, 0) }), FORGE_FEET],
    // top: a beat of anticipation before the blow
    [13, forge({ ...pelvis([0, -11, 0], [0, -0.04, 0]), Torso: [-6, 16, 0], Head: [4, -2, 0], ...arm('R', -172, 16, 108, -10) }), FORGE_FEET, 'in'],
    // impact: the whole body drops into it
    [HAMMER_STRIKE_FRAME, forge({ ...pelvis([0, -6, 0], [0, -0.1, 0], squash(0.04)), Torso: [24, 4, 0], Head: [18, -6, 0], ...arm('R', -56, 10, 14, 10) }), FORGE_FEET, 'out'],
    // rebound off the anvil
    [20, forge({ ...pelvis([0, -7, 0], [0, -0.085, 0]), Torso: [20, 5, 0], ...arm('R', -74, 12, 38, 4) }), FORGE_FEET],
    [28, forge({ Torso: [15, 8, 0], ...arm('R', -48, 14, 66, 0) }), FORGE_FEET],
    [40, FORGE, FORGE_FEET],
  ]),
  layers: [{ joint: 'Head', channel: 'ry', amplitude: 2, period: 40, phase: 0.3 }],
  notes: 'At the anvil: wind up, hold at the top, a heavy blow that drops the whole body, rebound, settle.',
};

const REST: Pose = { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.03, 0]), Torso: [-2, 0, 0], Head: [-6, 0, 0], ...arm('R', -150, 26, 140, 20), ...arm('L', 8, 14, 30, 10) };
export const HammerRest: ClipDef = {
  name: 'HammerRest',
  frames: 60,
  loop: true,
  grounded: true,
  ...track([
    [0, REST, STAND_FEET],
    [30, { ...REST, ...pelvis([0, 0, 0], [0, -0.04, 0]), Torso: [-4, 2, 0], Head: [-8, 4, 0] }, STAND_FEET],
    [60, REST, STAND_FEET],
  ]),
  notes: 'Talking: hammer resting on his shoulder, chest out, slow breath.',
};

export const Nod: ClipDef = {
  name: 'Nod',
  frames: 30,
  grounded: true,
  ...track([
    [0, REST, STAND_FEET],
    [6, { ...REST, Head: [10, 0, 0], Torso: [2, 0, 0] }, STAND_FEET, 'out'],
    [11, { ...REST, Head: [-12, 0, 0], Torso: [-4, 0, 0] }, STAND_FEET],
    [16, { ...REST, Head: [8, 0, 0], Torso: [1, 0, 0] }, STAND_FEET],
    [30, REST, STAND_FEET],
  ]),
  notes: 'A firm double nod, hammer on the shoulder.',
};

// ------------------------------------------------------------------ Ilsa, the merchant

const CLASP: Pose = { ...arm('R', -26, -6, 92, 12), ...arm('L', -26, -6, 92, 12) };
const ILSA: Pose = { ...STAND_BODY, ...CLASP, Torso: [2, 0, 0], Head: [-4, 0, 0] };
const shift = (lean: number, look: number): Pose => ({
  ...ILSA,
  ...pelvis([0, lean * 1.2, lean * 0.6], [0, -0.03 - Math.abs(lean) * 0.004, 0]),
  Torso: [2, -lean * 0.8, -lean * 1.2],
  Head: [-4, look, lean * 1.5],
});

export const Shuffle: ClipDef = {
  name: 'Shuffle',
  frames: 96,
  loop: true,
  grounded: true,
  ...track([
    [0, shift(0, 0), STAND_FEET],
    [20, shift(3, 22), STAND_FEET, 'hold'],
    [34, shift(3, 22), STAND_FEET],
    [48, shift(0, 0), STAND_FEET],
    [68, shift(-3, -26), STAND_FEET, 'hold'],
    [82, shift(-3, -26), STAND_FEET],
    [96, shift(0, 0), STAND_FEET],
  ]),
  layers: [{ joint: 'Torso', channel: 'rx', amplitude: 1.5, period: 48 }],
  notes: 'Waiting at the stall: hands clasped, weight shifts hip to hip, glances down the street.',
};

const greet = (out: number, elbow: number): Pose => ({ ...ILSA, Torso: [0, 6, -5], Head: [-12, 8, 8], ...arm('R', -10, out, elbow, 0, 60), ...arm('L', -24, -6, 90, 12) });
export const Greet: ClipDef = {
  name: 'Greet',
  frames: 46,
  grounded: true,
  ...track([
    [0, ILSA, STAND_FEET],
    [7, greet(148, 40), STAND_FEET, 'out'],
    [12, greet(166, 18), STAND_FEET],
    [17, greet(140, 58), STAND_FEET],
    [22, greet(166, 18), STAND_FEET],
    [27, greet(140, 58), STAND_FEET],
    [33, greet(158, 30), STAND_FEET],
    [46, ILSA, STAND_FEET],
  ]),
  notes: 'A big friendly wave when you come near the stall.',
};

const COUNT: Pose = { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.035, 0]), Torso: [12, 0, 0], Head: [26, 4, 0], ...arm('L', -36, -6, 72, -22), ...arm('R', -32, -8, 74, 10) };
const pick = (up: number, wrist: number): Pose => ({ ...COUNT, ...arm('R', -32 - up, -10 - up * 0.4, 74 + up * 1.6, wrist) });
/** Frames where a coin drops into her palm (`CountCoins`). */
export const COIN_FRAMES = [10, 25, 40, 55] as const;
export const CountCoins: ClipDef = {
  name: 'CountCoins',
  frames: 60,
  loop: true,
  grounded: true,
  ...track([
    [0, pick(0, 10), STAND_FEET],
    [6, pick(15, -14), STAND_FEET, 'out'],
    [10, pick(3, 34), STAND_FEET],
    [15, pick(0, 10), STAND_FEET],
    [21, pick(15, -14), STAND_FEET, 'out'],
    [25, pick(3, 34), STAND_FEET],
    [30, { ...pick(0, 10), Head: [22, -6, 0] }, STAND_FEET],
    [36, { ...pick(15, -14), Head: [24, -4, 0] }, STAND_FEET, 'out'],
    [40, pick(3, 34), STAND_FEET],
    [45, pick(0, 10), STAND_FEET],
    [51, pick(15, -14), STAND_FEET, 'out'],
    [55, pick(3, 34), STAND_FEET],
    [60, pick(0, 10), STAND_FEET],
  ]),
  layers: [{ joint: 'Head', channel: 'rx', amplitude: 2, period: 15 }],
  notes: 'Head down over a cupped palm, counting coins in with little flicks of the wrist.',
};

// ------------------------------------------------------------------ Oru, the mystic

const LOTUS: Pose = {
  ...pelvis([0, 0, 0], [0, 0.42, 0]),
  Torso: [-2, 0, 0],
  Head: [6, 0, 0],
  ...leg('R', -82, 38, 142, 30),
  ...leg('L', -82, 38, 142, 30),
  ...arm('R', -44, 12, 62, -24),
  ...arm('L', -44, 12, 62, -24),
};

export const Meditate: ClipDef = {
  name: 'Meditate',
  frames: 120,
  loop: true,
  keys: [
    [0, LOTUS],
    [60, { ...LOTUS, ...pelvis([0, 0, 0], [0, 0.47, 0]), Torso: [-4, 0, 0], Head: [3, 0, 0], ...arm('R', -46, 15, 58, -28), ...arm('L', -46, 15, 58, -28) }],
    [120, LOTUS],
  ],
  layers: [
    { joint: 'Pelvis', channel: 'ry', amplitude: 4, period: 120, phase: 0.25 },
    { joint: 'Head', channel: 'rz', amplitude: 2, period: 60 },
  ],
  notes: 'Floating cross-legged above the rug: slow rise and fall, a lazy turn, breathing.',
};

const blessUp = (k: number): Pose => ({ ...LOTUS, ...pelvis([0, 0, 0], [0, 0.42 + 0.1 * k, 0]), Torso: [-6 * k, 0, 0], Head: [-14 * k, 0, 0], ...arms(-44 - 66 * k, 12 + 48 * k, 62 - 40 * k, -24 - 20 * k) });
export const Bless: ClipDef = {
  name: 'Bless',
  frames: 54,
  keys: [
    [0, LOTUS],
    [14, blessUp(1), 'out'],
    [32, { ...blessUp(1), Head: [-18, 0, 0] }],
    [54, LOTUS],
  ],
  notes: 'Arms open, palms up, rising a little: a blessing.',
};

// ------------------------------------------------------------------ Vex, the rift keeper

const STAFF_L: Pose = { ...arm('L', -12, 10, 58, -44), HandL: [44, 0, -10] };
const KEEPER: Pose = { ...STAND_BODY, ...pelvis([0, 0, 0], [0, -0.02, 0]), Torso: [-2, 0, 0], Head: [-6, 0, 0], ...STAFF_L, ...arm('R', 4, 8, 40, 20) };

export const StaffIdle: ClipDef = {
  name: 'StaffIdle',
  frames: 90,
  loop: true,
  grounded: true,
  ...track([
    [0, KEEPER, STAND_FEET],
    [30, { ...KEEPER, Torso: [-3, 4, 0], Head: [-8, 16, 0] }, STAND_FEET],
    [60, { ...KEEPER, Torso: [-2, -3, 0], Head: [-4, -12, 0], ...arm('R', 2, 10, 46, 24) }, STAND_FEET],
    [90, KEEPER, STAND_FEET],
  ]),
  notes: 'Upright, staff planted, scanning the plaza.',
};

const point = (k: number): Pose => ({ ...KEEPER, Torso: [-4, -18 * k, 0], Head: [-10, -34 * k, 0], ...arm('R', 4 - 100 * k, 8 + 62 * k, 40 - 30 * k, 20 - 26 * k) });
export const Gesture: ClipDef = {
  name: 'Gesture',
  frames: 60,
  grounded: true,
  ...track([
    [0, KEEPER, STAND_FEET],
    [12, point(1.04), STAND_FEET, 'out'],
    [16, point(1), STAND_FEET],
    [40, { ...point(1), Head: [-14, -30, 0] }, STAND_FEET],
    [60, KEEPER, STAND_FEET],
  ]),
  notes: 'Sweeps an arm toward the obelisk: "the rift is that way".',
};

/** Clips per townsperson (the town compiles these; the anim CLI checks them). */
export const NPC_CLIPS: Record<string, readonly ClipDef[]> = {
  brann: [Hammer, HammerRest, Nod],
  ilsa: [Shuffle, Greet, CountCoins],
  oru: [Meditate, Bless],
  vex: [StaffIdle, Gesture],
  villager: [Idle, Walk],
  villager2: [Idle, Walk],
};
