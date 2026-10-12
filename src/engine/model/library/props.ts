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

// Hand tools a character can hold stand up along +Y the way they rest against a wall, on their
// working end (a shovel's blade, a hammer's head), with a `grip` anchor where the fist closes.
// Like a weapon's grip (weapons.ts), the anchor's +Y runs from the fist toward the working end:
// here that is down, so the anchor is turned over (rot [180, 0, 0]).

/** The shovel's blade outline (x across, y up): a rounded point on the floor, square shoulders. */
const BLADE: readonly [number, number][] = [[0, 0], [0.07, 0.015], [0.115, 0.06], [0.125, 0.29], [-0.125, 0.29], [-0.115, 0.06], [-0.07, 0.015]];

export const shovel = model({
  id: 'shovel',
  about: 'Shovel standing on its blade: a steel blade with a rolled top edge, an iron socket, a wooden shaft and a T grip',
  tags: ['props', 'tool', 'iron', 'wood'],
  palette: { wood: 'orange', steel: 'mist', iron: 'slate', grip: 'red' },
  anchors: { grip: { at: [0, 0.98, 0], rot: [180, 0, 0] } },
  parts: [
    { slab: BLADE, depth: 0.03, c: 'steel', name: 'blade' },
    { box: [0.26, 0.06, 0.06], at: [0, 0.29, 0], c: 'iron' },
    { cyl: [0.08, 0.16, 0.08], at: [0, 0.38, 0], top: 0.8, seg: 6, c: 'iron', name: 'socket' },
    { cyl: [0.065, 0.64, 0.065], at: [0, 0.77, 0], seg: 6, c: 'wood', name: 'shaft' },
    { box: [0.2, 0.07, 0.075], at: [0, 1.1, 0], c: 'grip', name: 't-grip' },
  ],
});

export const hammer = model({
  id: 'hammer',
  about: 'Smith\'s hammer standing on its head: an iron head with a light striking face and a tapered peen, a wooden handle with a wrapped end',
  tags: ['props', 'tool', 'iron', 'wood'],
  palette: { wood: 'orange', iron: 'slate', face: 'white', wrap: 'plum' },
  anchors: { grip: { at: [0, 0.37, 0], rot: [180, 0, 0] } },
  parts: [
    { box: [0.13, 0.085, 0.085], at: [0.02, 0.0425, 0], c: 'iron', name: 'head' },
    { box: [0.03, 0.095, 0.095], at: [0.095, 0.0475, 0], c: 'face' },
    { group: [{ cyl: [0.085, 0.07, 0.085], top: 0.45, seg: 4, rot: [0, 45, 0], c: 'iron' }], at: [-0.08, 0.0425, 0], rot: [0, 0, 90], name: 'peen' },
    { cyl: [0.06, 0.34, 0.06], at: [0, 0.25, 0], seg: 6, c: 'wood', name: 'handle' },
    { cyl: [0.072, 0.1, 0.072], at: [0, 0.38, 0], seg: 6, c: 'wrap' },
  ],
});

/** The wheelbarrow's tub, (radius, height) turned as a square (4 sides) and stretched along Z: hollow, its walls 3.5 cm thick. */
const TUB: readonly [number, number][] = [[0, 0], [0.283, 0], [0.438, 0.3], [0.4, 0.3], [0.25, 0.035], [0, 0.035]];
/** A barrow shaft's path for x ≥ 0: from the axle, level under the tub, rising behind into the handle. */
const SHAFT: readonly Vec3[] = [[0.08, 0.2, 0.6], [0.18, 0.3, 0.36], [0.22, 0.3, -0.26], [0.27, 0.52, -0.76]];

export const wheelbarrow = model({
  id: 'wheelbarrow',
  about: 'Wooden wheelbarrow: a hollow tub with a light rim on two shafts, one spoked wheel in front (+Z), two legs and wrapped handles behind',
  tags: ['props', 'transport', 'wood', 'town'],
  palette: { tub: 'red', rim: 'sand', shaft: 'orange', tyre: 'night', spoke: 'sand', hub: 'slate', grip: 'plum' },
  anchors: { handle: [0, 0.52, -0.76] },
  parts: [
    {
      name: 'wheel',
      at: [0, 0.2, 0.6],
      rot: [0, 0, 90],
      group: [
        { torus: [0.4, 0.07, 0.4], seg: 12, c: 'tyre' },
        ...[0, 60, 120].map((a): Part => ({ box: [0.065, 0.06, 0.3], rot: [0, a, 0], c: 'spoke' })),
        { cyl: [0.11, 0.12, 0.11], seg: 8, c: 'hub' },
      ],
    },
    { cyl: [0.06, 0.22, 0.06], at: [0, 0.2, 0.6], rot: [0, 0, 90], seg: 6, c: 'hub', name: 'axle' },
    { mirror: [{ tube: SHAFT, r: 0.04, seg: 6, c: 'shaft', name: 'shaft' }] },
    { mirror: [{ tube: [[0.255, 0.454, -0.61], [0.273, 0.533, -0.79]], r: 0.05, seg: 6, c: 'grip' }] },
    { mirror: [{ box: [0.065, 0.3, 0.065], at: [0.22, 0.15, -0.2], c: 'shaft', name: 'leg' }] },
    {
      name: 'tub',
      at: [0, 0.335, 0.08],
      scale: [1, 1, 1.4],
      group: [
        { lathe: TUB, seg: 4, rot: [0, 45, 0], c: 'tub' },
        { lathe: [[0.405, 0.28], [0.452, 0.28], [0.452, 0.315], [0.405, 0.315], [0.405, 0.28]], seg: 4, rot: [0, 45, 0], c: 'rim', name: 'rim' },
      ],
    },
  ],
});

export const ropeCoil = model({
  id: 'rope-coil',
  about: 'Coil of rope on the floor: `loops` stacked turns in two shades, the loose end trailing out to the front with a whipped tip; `r` is its radius',
  tags: ['props', 'rope', 'town', 'dungeon'],
  palette: { rope: 'sand', rope2: 'orange', whip: 'red' },
  params: { loops: [3, 2, 5], r: [0.25, 0.15, 0.4] },
  parts: (p, rng) => {
    const n = Math.round(p.loops!);
    const r0 = p.r!;
    const t = 0.065; // the rope's thickness
    const out: Part[] = [];
    // each turn sits on the one below, a little in from it and turned half a facet, so no two share a face
    for (let i = 0; i < n; i++) {
      const r = r0 * (1 - 0.05 * i);
      out.push({
        torus: [2 * r, t, 2 * r],
        at: [0, t / 2 + i * t * 0.95, 0],
        rot: [i ? rng.range(-2, 2) : 0, i * 18 + rng.range(-5, 5), i ? rng.range(-2, 2) : 0],
        seg: 10,
        c: i % 2 ? 'rope2' : 'rope',
      });
    }
    const top = t / 2 + (n - 1) * t * 0.95;
    const rTop = r0 * (1 - 0.05 * (n - 1));
    // the loose end leaves the top turn at its front, drops over the coil's side and runs out along the floor
    const end: Vec3[] = [[0, top, rTop - t / 2], [0.03, top - 0.005, r0 + 0.05], [0.06, t / 2, r0 + 0.16], [0.16, t / 2, r0 + 0.3], [0.3, t / 2, r0 + 0.34]];
    return [
      ...out,
      {
        rot: [0, rng.range(-30, 10), 0],
        group: [
          { tube: end, r: t / 2 + 0.004, seg: 6, c: n % 2 ? 'rope2' : 'rope', name: 'end' }, // the other shade from the top turn's
          { tube: [[0.24, t / 2, r0 + 0.335], [0.33, t / 2, r0 + 0.342]], r: t / 2 + 0.012, seg: 6, c: 'whip' },
        ],
      },
    ];
  },
});

export const ladder = model({
  id: 'ladder',
  about: 'Wooden ladder, `rungs` rungs 0.3 m apart between two rails; `lean` tips its top back to a wall at z = 0 (0 stands it upright against it)',
  tags: ['props', 'wood', 'town'],
  palette: { rail: 'orange', rung: 'sand' },
  params: { rungs: [7, 3, 12], lean: [15, 0, 25] },
  parts: (p) => {
    const n = Math.round(p.rungs!);
    const len = (n + 1) * 0.3;
    const a = (p.lean! * Math.PI) / 180;
    const d = 0.07; // the rails' depth: the top's back face lands on z = 0, a foot's back edge on the floor
    return [
      {
        at: [0, (d / 2) * Math.sin(a), len * Math.sin(a) + (d / 2) * Math.cos(a)],
        rot: [-p.lean!, 0, 0],
        group: [
          { mirror: [{ box: [0.085, len, d], at: [0.22, len / 2, 0], c: 'rail', name: 'rail' }] },
          ...Array.from({ length: n }, (_, i): Part => ({ cyl: [0.065, 0.4, 0.065], at: [0, 0.3 * (i + 1), 0], rot: [0, 0, 90], seg: 6, c: 'rung' })),
        ],
      },
    ];
  },
});

export const waymarker = model({
  id: 'waymarker',
  about: 'Waymarker: a short standing stone, five-sided and tapering to a rough top, a little tipped (seeded), with a painted band round it (map `paint`); `h` is its height',
  tags: ['props', 'sign', 'stone', 'nature'],
  palette: { stone: 'mist', paint: 'red' },
  params: { h: [0.9, 0.5, 1.4] },
  parts: (p, rng) => {
    const h = p.h! - 0.1; // the shaft; a rough 0.18 m top half sunk into it
    const w = 0.46 * rng.range(0.92, 1.08);
    const taper = 0.66;
    const wAt = (y: number) => w * (1 - ((1 - taper) * y) / h);
    const [y0, y1] = [h * 0.62, h * 0.62 + 0.13];
    const b = 0.03; // how much wider the band is than the stone
    return [
      {
        at: [0, 0.008, 0],
        rot: [rng.range(-2.5, 2.5), rng.range(0, 360), rng.range(-2.5, 2.5)],
        group: [
          { cyl: [w, h, w * 0.8], at: [0, h / 2, 0], top: taper, seg: 5, c: 'stone', name: 'stone' },
          { lump: [wAt(h) * 1.04, 0.2, wAt(h) * 0.84], at: [0, h, 0], seed: rng.int(1, 999), c: 'stone', name: 'top' },
          { cyl: [wAt(y0) + b, y1 - y0, (wAt(y0) + b) * 0.8], at: [0, (y0 + y1) / 2, 0], top: (wAt(y1) + b) / (wAt(y0) + b), seg: 5, c: 'paint', name: 'band' },
        ],
      },
    ];
  },
});

export const noticeBoard = model({
  id: 'notice-board',
  about: 'Notice board: a framed board on two posts, `notes` paper notes in two shades pinned to its front (seeded)',
  tags: ['props', 'sign', 'wood', 'town'],
  palette: { post: 'red', board: 'orange', frame: 'plum', paper: 'white', paper2: 'sand' },
  params: { notes: [5, 0, 8] },
  parts: (p, rng) => {
    const out: Part[] = [
      { mirror: [{ box: [0.14, 1.9, 0.14], at: [0.63, 0.95, 0], c: 'post', name: 'post' }] },
      { mirror: [{ cone: [0.2, 0.1, 0.2], at: [0.63, 1.95, 0], rot: [0, 45, 0], seg: 4, c: 'frame' }] },
      { box: [1.16, 0.7, 0.06], at: [0, 1.32, 0], c: 'board', name: 'board' },
      { box: [1.42, 0.08, 0.1], at: [0, 1.71, 0], c: 'frame' },
      { box: [1.42, 0.08, 0.1], at: [0, 0.93, 0], c: 'frame' },
    ];
    // notes take distinct cells of a 4 × 2 grid, so no two overlap
    const cells = Array.from({ length: 8 }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    for (const [k, cell] of cells.slice(0, Math.round(p.notes!)).entries()) {
      const [w, h] = [rng.range(0.15, 0.2), rng.range(0.19, 0.25)];
      out.push({
        box: [w, h, 0.008],
        at: [-0.39 + (cell % 4) * 0.26 + rng.range(-0.01, 0.01), (cell < 4 ? 1.48 : 1.16) + rng.range(-0.02, 0.02), 0.036],
        rot: [0, 0, rng.range(-8, 8)],
        c: k % 2 ? 'paper2' : 'paper',
      });
    }
    return out;
  },
});

/** The pouch's outline: a round bottom, a full belly, a gathered neck. */
const POUCH: readonly [number, number][] = [[0, 0], [0.08, 0.005], [0.12, 0.05], [0.13, 0.11], [0.11, 0.17], [0.07, 0.21], [0.05, 0.23], [0, 0.23]];

export const lootPouch = model({
  id: 'loot-pouch',
  about: 'Small leather drawstring pouch tipped on its side, a little heap of gold spilled from its open mouth with `coins` coins on and round it (seeded)',
  tags: ['props', 'loot', 'gold'],
  palette: { leather: 'red', neck: 'plum', cord: 'sand', gold: 'sand', shade: 'orange' },
  params: { coins: [9, 4, 16] },
  parts: (p, rng) => {
    const coin = (at: Vec3, rot: Vec3, i: number): Part => ({ cyl: [0.11, 0.025, 0.11], at, rot, seg: 6, c: i % 3 ? 'gold' : 'shade' });
    // the pouch lies along +X, its belly 0.13 m round the axis, its mouth over the heap's near side
    const [hx, hr, hh] = [0.22, 0.17, 0.085];
    const out: Part[] = [
      {
        name: 'pouch',
        at: [-0.1, 0.128, 0],
        rot: [0, 0, -82],
        group: [
          { lathe: POUCH, at: [0, -0.11, 0], seg: 8, c: 'leather', name: 'body' },
          { cyl: [0.1, 0.06, 0.1], at: [0, 0.14, 0], seg: 6, c: 'neck' },
          { torus: [0.125, 0.035, 0.125], at: [0, 0.14, 0], seg: 6, c: 'cord' },
          { cyl: [0.15, 0.05, 0.15], at: [0, 0.19, 0], top: 1.6, seg: 6, c: 'neck', name: 'mouth' },
        ],
      },
      { ball: [2 * hr, hh, 2 * hr], at: [hx, hh / 2, 0], half: true, seg: 8, c: 'gold', name: 'heap' },
    ];
    const n = Math.round(p.coins!);
    // a third of the coins lie on the heap, tipped to its slope
    for (let i = 0; i < Math.round(n / 3); i++) {
      const d = hr * 0.8 * Math.sqrt(rng.next());
      const { y, tilt } = onDome(hr, hh, d);
      out.push({ at: [hx, 0, 0], rot: [0, rng.range(-120, 120), 0], group: [coin([d, y + 0.004, 0], [rng.range(-10, 10), 0, -tilt], i)] });
    }
    // the rest on the floor round the heap's far side; one that finds no room lies on the coins it hits
    const placed: Vec3[] = [];
    for (let i = Math.round(n / 3); i < n; i++) {
      let at: Vec3 = [0, 0, 0];
      for (let tries = 0; tries < 16; tries++) {
        const a = (rng.range(-80, 80) * Math.PI) / 180;
        const d = hr + 0.03 + 0.16 * rng.next();
        const [x, z] = [hx + d * Math.cos(a), d * Math.sin(a)];
        const hit = placed.filter(([px, , pz]) => Math.hypot(x - px, z - pz) < 0.115);
        at = [x, 0.0125 + Math.max(0, ...hit.map((h) => h[1] + 0.0125)), z];
        if (!hit.length) break;
      }
      placed.push(at);
      out.push(coin(at, [0, rng.range(0, 60), 0], i));
    }
    // turned so the pouch lies across the game camera's view (+X toward screen right)
    return [{ rot: [0, rng.range(30, 60), 0], group: out }];
  },
});

export const PROPS = [signpost, sack, anvil, pickaxe, goldPile, cart, shovel, hammer, wheelbarrow, ropeCoil, ladder, waymarker, noticeBoard, lootPouch];
