import type { Part, Vec3 } from '../types';
import { model } from '../helpers';

/** Arrow boards, top down: [height (m), yaw (degrees: 0 points +X)]. */
const ARROWS: readonly [number, number][] = [
  [1.84, 90],
  [1.5, 180],
  [1.16, 0],
];

export const signpost = model({
  id: 'signpost',
  about: 'Wooden signpost: a post with two or three arrow boards pointing different ways, on footing stones',
  tags: ['props', 'sign', 'wood'],
  palette: { post: 'red', board: 'sand', board2: 'orange', dark: 'plum', stone: 'slate', stone2: 'mist' },
  params: { boards: [3, 2, 3] },
  parts: (p) => [
    { box: [0.16, 2.0, 0.16], at: [0, 1.0, 0], c: 'post' },
    { cone: [0.28, 0.16, 0.28], at: [0, 2.08, 0], rot: [0, 45, 0], seg: 4, c: 'dark' },
    ...ARROWS.slice(0, Math.round(p.boards!)).map(([y, yaw], i): Part => ({
      at: [0, y, 0],
      rot: [0, yaw, 0],
      group: [
        { slab: [[-0.14, -0.13], [0.66, -0.13], [0.82, 0], [0.66, 0.13], [-0.14, 0.13]], depth: 0.05, c: i % 2 ? 'board2' : 'board' },
        { box: [0.42, 0.06, 0.062], at: [0.34, 0, 0], c: 'dark', name: 'lettering' },
      ],
    })),
    { use: 'rock', at: [0.2, 0, 0.08], seed: 3, params: { size: 0.4 }, palette: { stone: 'stone' } },
    { use: 'rock', at: [-0.16, 0, 0.16], seed: 7, params: { size: 0.34 }, palette: { stone: 'stone2' } },
    { use: 'rock', at: [-0.06, 0, -0.2], seed: 11, params: { size: 0.38 }, palette: { stone: 'stone' } },
  ],
});

/** The sack's outline, (radius, height) turned about Y: a flat bottom, a full belly, a shoulder. */
const SACK: readonly [number, number][] = [[0, 0], [0.24, 0], [0.29, 0.06], [0.31, 0.18], [0.28, 0.32], [0.21, 0.42], [0.12, 0.49], [0.07, 0.51], [0, 0.52]];

export const sack = model({
  id: 'sack',
  about: 'Filled cloth sack tied at the neck with a cord, a ruffled tuft above it; `h` is its height',
  tags: ['props', 'loot', 'cloth'],
  palette: { cloth: 'sand', neck: 'orange', cord: 'red' },
  params: { h: [0.74, 0.45, 1] },
  parts: (p, rng) => [
    {
      scale: [p.h! / 0.74, p.h! / 0.74, (p.h! / 0.74) * rng.range(0.82, 0.92)],
      rot: [0, rng.range(0, 360), 0],
      group: [
        { lathe: SACK, seg: 8, c: 'cloth', name: 'body' },
        { cyl: [0.18, 0.1, 0.18], at: [0, 0.55, 0], top: 0.65, seg: 6, c: 'neck' },
        { torus: [0.16, 0.06, 0.16], at: [0, 0.6, 0], seg: 6, c: 'cord' },
        { lump: [0.28, 0.13, 0.25], at: [0.01, 0.68, 0], rot: [rng.range(-12, 12), rng.range(0, 360), rng.range(-12, 12)], seed: rng.int(1, 999), c: 'neck', name: 'tuft' },
      ],
    },
  ],
});

/** The anvil's iron seen from the front (x along it, y up): a flared foot, a waist, the heel and the face. */
const ANVIL: readonly [number, number][] = [
  [-0.2, 0], [0.2, 0], [0.2, 0.05], [0.1, 0.12], [0.09, 0.2], [0.22, 0.24], [0.22, 0.34],
  [-0.28, 0.34], [-0.28, 0.27], [-0.12, 0.22], [-0.09, 0.2], [-0.1, 0.12], [-0.2, 0.05],
];

export const anvil = model({
  id: 'anvil',
  about: 'Smith\'s iron anvil with a horn and a light face, on a wooden block',
  tags: ['props', 'tool', 'iron', 'wood'],
  palette: { wood: 'orange', cut: 'sand', iron: 'night', face: 'mist' },
  parts: [
    { cyl: [0.5, 0.4, 0.5], at: [0, 0.2, 0], top: 0.88, seg: 8, c: 'wood', name: 'block' },
    { cyl: [0.4, 0.04, 0.4], at: [0, 0.42, 0], seg: 8, c: 'cut' },
    {
      name: 'anvil',
      at: [0, 0.44, 0],
      rot: [0, 15, 0],
      group: [
        { slab: ANVIL, depth: 0.18, c: 'iron' },
        { box: [0.4, 0.05, 0.26], at: [0, 0.025, 0], c: 'iron' },
        { box: [0.48, 0.03, 0.16], at: [-0.03, 0.355, 0], c: 'face' },
        { cone: [0.12, 0.26, 0.12], at: [0.35, 0.29, 0], rot: [0, 0, -90], seg: 6, c: 'iron', name: 'horn' },
      ],
    },
  ],
});

/** The pick's head, an outline in the floor plane (x across, y toward the handle's butt). */
const PICK_HEAD: readonly [number, number][] = [
  [-0.44, 0.17], [-0.36, 0.04], [-0.22, -0.05], [0, -0.09], [0.22, -0.05], [0.36, 0.04], [0.44, 0.17],
  [0.29, 0.08], [0.13, 0.04], [0, 0.035], [-0.13, 0.04], [-0.29, 0.08],
];

export const pickaxe = model({
  id: 'pickaxe',
  about: 'Pickaxe lying on the ground: a curved iron head and a wooden handle with a wrapped grip',
  tags: ['props', 'tool', 'iron', 'wood'],
  palette: { wood: 'orange', steel: 'mist', iron: 'slate', wrap: 'plum' },
  // the hand's hold: +Y runs up the handle toward the head, +X along the head
  anchors: { grip: { at: [0.42, 0.06, 0], rot: [90, 0, 90] } },
  parts: [
    { cyl: [0.09, 1.0, 0.09], at: [0.06, 0.06, 0], rot: [0, 0, 90], seg: 6, c: 'wood', name: 'handle' },
    { cyl: [0.105, 0.22, 0.105], at: [0.44, 0.06, 0], rot: [0, 0, 90], seg: 6, c: 'wrap' },
    { slab: PICK_HEAD, depth: 0.1, at: [-0.42, 0.06, 0], rot: [-90, 0, -90], c: 'steel', name: 'head' },
    { box: [0.15, 0.12, 0.14], at: [-0.42, 0.06, 0], c: 'iron' },
  ],
});

/** Where a coin on a dome of radius `r` and height `h` sits: `d` out from the middle (m). */
const onDome = (r: number, h: number, d: number): { y: number; tilt: number } => {
  const y = h * Math.sqrt(Math.max(0, 1 - (d / r) ** 2));
  return { y, tilt: (Math.atan2(d / (r * r), Math.max(y, 0.001) / (h * h)) * 180) / Math.PI };
};

export const goldPile = model({
  id: 'gold-pile',
  about: 'Heap of gold coins (seeded) with a couple of gems, a few coins spilled and stacked beside it',
  tags: ['props', 'loot', 'gold'],
  palette: { gold: 'sand', shade: 'orange', gem: 'cyan', gem2: 'red' },
  params: { coins: [26, 10, 32], r: [0.42, 0.25, 0.7] },
  parts: (p, rng) => {
    const r = p.r!;
    const h = r * 0.66;
    const coin = (at: Vec3, rot: Vec3, c = 'gold'): Part => ({ cyl: [0.15, 0.03, 0.15], at, rot, seg: 6, c });
    const out: Part[] = [{ ball: [2 * r, h, 2 * r], at: [0, h / 2, 0], half: true, seg: 10, c: 'gold', name: 'heap' }];
    for (let i = 0; i < Math.round(p.coins!); i++) {
      const d = r * 0.92 * Math.sqrt(rng.next());
      const { y, tilt } = onDome(r, h, d);
      out.push({ rot: [0, rng.range(0, 360), 0], group: [coin([d, y + 0.004, 0], [rng.range(-15, 15), 0, -tilt - rng.range(-12, 12)], i % 3 ? 'shade' : 'gold')] });
    }
    // two gems, half sunk into the heap
    for (const [k, c] of [[0.25, 'gem'], [0.55, 'gem2']] as const) {
      const d = r * k;
      out.push({ rot: [0, rng.range(0, 360), 0], group: [{ ball: [0.18, 0.24, 0.18], seg: 4, at: [d, onDome(r, h, d).y + 0.05, 0], rot: [0, 45, -onDome(r, h, d).tilt * 0.6], c }] });
    }
    // spilled coins and two short stacks round the foot
    for (let i = 0; i < 4; i++) {
      out.push({ rot: [0, i * 90 + rng.range(10, 70), 0], group: [coin([r + rng.range(0.1, 0.22), 0.015, 0], [0, rng.range(0, 60), 0])] });
    }
    for (const [a, n] of [[rng.range(20, 60), 4], [rng.range(150, 210), 3]] as const) {
      out.push({ rot: [0, a, 0], at: [0, 0, 0], group: Array.from({ length: n }, (_, k) => coin([r + 0.04, 0.015 + k * 0.03, 0], [0, k * 17, 0], k % 2 ? 'shade' : 'gold')) });
    }
    return out;
  },
});

const WHEEL_R = 0.55;
const AXLE_Z = -0.2;

/** A big spoked wheel, axle along X: a dark iron tyre, eight light spokes, an iron hub. */
const cartWheel = (x: number): Part => ({
  name: x > 0 ? 'wheel-r' : 'wheel-l',
  at: [x, WHEEL_R, AXLE_Z],
  rot: [0, 0, 90],
  group: [
    { torus: [2 * WHEEL_R, 0.1, 2 * WHEEL_R], seg: 14, c: 'tyre' },
    ...[0, 45, 90, 135].map((a): Part => ({ box: [0.075, 0.07, 2 * WHEEL_R - 0.16], rot: [0, a, 0], c: 'spoke' })),
    { cyl: [0.2, 0.16, 0.2], seg: 8, c: 'hub' },
  ],
});

export const cart = model({
  id: 'cart',
  about: 'Two-wheeled hand cart: a plank bed with sides on big spoked wheels, long handles with a grip bar and a stand',
  tags: ['props', 'transport', 'wood'],
  palette: { bed: 'red', side: 'orange', rail: 'sand', frame: 'plum', tyre: 'night', spoke: 'sand', hub: 'slate', axle: 'ink' },
  anchors: { handle: [0, 0.635, 1.33] },
  parts: [
    // running gear
    cartWheel(0.62),
    cartWheel(-0.62),
    { cyl: [0.08, 1.34, 0.08], at: [0, WHEEL_R, AXLE_Z], rot: [0, 0, 90], seg: 6, c: 'axle', name: 'axle' },
    // frame: two shafts under the bed that run out front into the handles, a grip bar, a stand
    { mirror: [{ box: [0.09, 0.09, 2.35], at: [0.31, 0.635, 0.225], c: 'side' }] },
    { cyl: [0.07, 0.8, 0.07], at: [0, 0.635, 1.33], rot: [0, 0, 90], seg: 6, c: 'rail', name: 'grip' },
    { mirror: [{ box: [0.08, 0.59, 0.08], at: [0.31, 0.295, 0.82], rot: [-8, 0, 0], c: 'frame' }] },
    { box: [0.54, 0.06, 0.06], at: [0, 0.2, 0.8], c: 'frame' },
    // bed: floor, side boards, end boards, top rails, corner stakes
    {
      name: 'bed',
      at: [0, 0, -0.25],
      group: [
        { box: [0.94, 0.06, 1.36], at: [0, 0.71, 0], c: 'bed', name: 'floor' },
        { mirror: [{ box: [0.06, 0.32, 1.36], at: [0.44, 0.9, 0], c: 'side' }] },
        { mirror: [{ box: [0.82, 0.32, 0.06], at: [0, 0.9, 0.65], c: 'side' }], axis: 'z' },
        { mirror: [{ box: [0.09, 0.05, 1.42], at: [0.44, 1.085, 0], c: 'rail' }] },
        { mirror: [{ box: [0.97, 0.05, 0.09], at: [0, 1.085, 0.65], c: 'rail' }], axis: 'z' },
        // the joint between the two planks of each board
        { mirror: [{ box: [0.07, 0.04, 1.34], at: [0.44, 0.9, 0], c: 'bed' }] },
        { mirror: [{ box: [0.8, 0.04, 0.07], at: [0, 0.9, 0.65], c: 'bed' }], axis: 'z' },
        { mirror: [{ mirror: [{ box: [0.07, 0.4, 0.07], at: [0.505, 0.88, 0.62], c: 'frame' }], axis: 'z' }] },
      ],
    },
  ],
});

export const PROPS = [signpost, sack, anvil, pickaxe, goldPile, cart];
