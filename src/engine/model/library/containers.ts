import { boxFrame, model } from '../helpers';
import type { Part } from '../types';

export const barrel = model({
  id: 'barrel',
  about: 'Wooden barrel with three iron hoops',
  tags: ['container', 'wood'],
  palette: { wood: 'orange', band: 'slate', lid: 'red' },
  parts: [
    { lathe: [[0, 0], [0.27, 0], [0.32, 0.2], [0.34, 0.4], [0.32, 0.6], [0.27, 0.8], [0, 0.8]], seg: 10, c: 'wood' },
    { torus: [0.65, 0.06, 0.65], at: [0, 0.1, 0], seg: 10, c: 'band' },
    { torus: [0.65, 0.06, 0.65], at: [0, 0.7, 0], seg: 10, c: 'band' },
    { torus: [0.73, 0.06, 0.73], at: [0, 0.4, 0], seg: 10, c: 'band' },
    { cyl: [0.48, 0.03, 0.48], at: [0, 0.8, 0], seg: 10, c: 'lid' },
  ],
});

export const crate = model({
  id: 'crate',
  about: 'Wooden crate with a frame and diagonal braces',
  tags: ['container', 'wood'],
  palette: { wood: 'orange', band: 'red' },
  parts: [
    { box: [0.68, 0.68, 0.68], at: [0, 0.36, 0], c: 'wood' },
    boxFrame({ size: [0.72, 0.72, 0.72], beam: 0.09, at: [0, 0.36, 0], c: 'band' }),
    { mirror: [{ box: [0.8, 0.08, 0.04], at: [0, 0.36, 0.35], rot: [0, 0, 45], c: 'band' }], axis: 'z' },
    { mirror: [{ box: [0.04, 0.08, 0.8], at: [0.35, 0.36, 0], rot: [45, 0, 0], c: 'band' }] },
  ],
});

/**
 * A band round a turned wall whose outside radius at height y is `r(y)`, from `y0` to `y1`:
 * `out` proud of the wall and sunk `sunk` into it, so it never shows inside a hollow vessel.
 */
const band = (r: (y: number) => number, y0: number, y1: number, c: string, seg = 10, out = 0.008, sunk = 0.006): Part => ({
  lathe: [[r(y0) - sunk, y0], [r(y0) + out, y0], [r(y1) + out, y1], [r(y1) - sunk, y1], [r(y0) - sunk, y0]],
  seg,
  c,
});

/** The clay pot's outline, (radius, height) turned about Y: a narrow foot, a round belly, a short neck. */
const POT: readonly [number, number][] = [[0, 0], [0.12, 0], [0.17, 0.06], [0.21, 0.16], [0.2, 0.26], [0.15, 0.33], [0.12, 0.36], [0.12, 0.4], [0, 0.4]];

export const clayPot = model({
  id: 'clay-pot',
  about: 'Round-bellied clay pot: terracotta with a red painted band, a pale rolled rim round a dark mouth; `h` is its height (seeded girth)',
  tags: ['container', 'clay', 'town', 'dungeon'],
  palette: { clay: 'orange', paint: 'red', rim: 'sand', mouth: 'ink' },
  params: { h: [0.43, 0.25, 0.7] },
  parts: (p, rng) => {
    const s = p.h! / 0.43;
    const girth = s * rng.range(0.9, 1.1);
    return [
      {
        scale: [girth, s, girth],
        group: [
          { lathe: POT, seg: 8, c: 'clay', name: 'body' },
          { torus: [0.44, 0.05, 0.44], at: [0, 0.19, 0], seg: 8, c: 'paint' },
          { cyl: [0.17, 0.012, 0.17], at: [0, 0.406, 0], seg: 8, c: 'mouth' },
          { torus: [0.28, 0.06, 0.28], at: [0, 0.41, 0], seg: 8, c: 'rim', name: 'rim' },
        ],
      },
    ];
  },
});

/** The amphora's outline: a small foot, a long belly, a narrow neck. */
const AMPHORA: readonly [number, number][] = [[0, 0], [0.08, 0], [0.08, 0.03], [0.06, 0.06], [0.12, 0.16], [0.18, 0.3], [0.2, 0.42], [0.18, 0.52], [0.12, 0.6], [0.075, 0.64], [0.07, 0.76], [0, 0.76]];

export const amphora = model({
  id: 'amphora',
  about: 'Tall two-handled amphora on a small foot: pale clay with a red painted band and rim, a narrow neck and a dark mouth',
  tags: ['container', 'clay', 'town'],
  palette: { clay: 'sand', paint: 'red', handle: 'orange', mouth: 'ink' },
  parts: [
    { lathe: AMPHORA, seg: 10, c: 'clay', name: 'body' },
    { torus: [0.42, 0.06, 0.42], at: [0, 0.42, 0], seg: 10, c: 'paint' },
    { mirror: [{ tube: [[0.16, 0.53, 0], [0.215, 0.61, 0], [0.19, 0.7, 0], [0.065, 0.71, 0]], r: 0.032, c: 'handle', name: 'handle' }] },
    { cyl: [0.11, 0.01, 0.11], at: [0, 0.765, 0], seg: 8, c: 'mouth' },
    { torus: [0.19, 0.045, 0.19], at: [0, 0.765, 0], seg: 8, c: 'paint', name: 'rim' },
  ],
});

/** The urn's body outline from the top of its foot: a waist, a full shoulder, a short neck. */
const URN: readonly [number, number][] = [[0, 0], [0.09, 0], [0.08, 0.05], [0.16, 0.14], [0.2, 0.26], [0.19, 0.38], [0.14, 0.46], [0.13, 0.5], [0, 0.5]];

export const urn = model({
  id: 'urn',
  about: 'Lidded urn: a glazed body on a gold foot with a gold band, a blue domed lid on the pivot `lid` with a gold knob',
  tags: ['container', 'clay', 'dungeon', 'tomb'],
  palette: { glaze: 'teal', trim: 'sand', lid: 'blue' },
  parts: [
    { cyl: [0.27, 0.06, 0.27], at: [0, 0.03, 0], top: 0.75, seg: 10, c: 'trim', name: 'foot' },
    { lathe: URN, at: [0, 0.06, 0], seg: 10, c: 'glaze', name: 'body' },
    { torus: [0.41, 0.04, 0.41], at: [0, 0.44, 0], seg: 10, c: 'trim' },
    {
      name: 'lid',
      pivot: true,
      at: [0, 0.56, 0],
      group: [
        { cyl: [0.31, 0.035, 0.31], at: [0, 0.0175, 0], seg: 10, c: 'trim' },
        { ball: [0.27, 0.11, 0.27], at: [0, 0.09, 0], half: true, seg: 10, c: 'lid' },
        { ball: [0.09, 0.09, 0.09], at: [0, 0.16, 0], seg: 6, c: 'trim', name: 'knob' },
      ],
    },
  ],
});

/** The basket's outside radius at height y (it flares), and its hollow outline. */
const basketR = (y: number) => 0.19 + (0.06 * y) / 0.3;
const BASKET: readonly [number, number][] = [[0, 0], [0.19, 0], [0.25, 0.3], [0.225, 0.3], [0.17, 0.035], [0, 0.035]];

export const basket = model({
  id: 'basket',
  about: 'Wicker basket: a flared hollow body with a woven band of a second shade, a rolled rim and a hoop handle (`handle` 0 drops it); `w` is its width',
  tags: ['container', 'wicker', 'town', 'market'],
  palette: { wicker: 'sand', weave: 'orange', rim: 'red', inside: 'plum' },
  params: { w: [0.5, 0.3, 0.8], handle: [1, 0, 1] },
  parts: (p) => [
    {
      scale: p.w! / 0.5,
      group: [
        { lathe: BASKET, seg: 8, c: 'wicker', name: 'body' },
        { cyl: [0.32, 0.01, 0.32], at: [0, 0.04, 0], seg: 8, c: 'inside' },
        band(basketR, 0.1, 0.2, 'weave', 8),
        { torus: [0.53, 0.05, 0.53], at: [0, 0.3, 0], seg: 8, c: 'rim', name: 'rim' },
        ...(p.handle! >= 0.5
          ? [{ tube: [[-0.235, 0.3, 0], [-0.215, 0.46, 0], [-0.1, 0.56, 0], [0.1, 0.56, 0], [0.215, 0.46, 0], [0.235, 0.3, 0]], r: 0.03, seg: 4, c: 'rim', name: 'handle' } satisfies Part]
          : []),
      ],
    },
  ],
});

/** The bucket's outside radius at height y, and its hollow outline. */
const bucketR = (y: number) => 0.14 + (0.025 * y) / 0.32;
const BUCKET: readonly [number, number][] = [[0, 0], [0.14, 0], [0.165, 0.32], [0.14, 0.32], [0.118, 0.03], [0, 0.03]];

export const bucket = model({
  id: 'bucket',
  about: 'Wooden bucket: tapered staves in two iron hoops, an iron bail handle standing up from two ears',
  tags: ['container', 'wood', 'town', 'water'],
  palette: { wood: 'orange', hoop: 'slate', bail: 'night', inside: 'plum' },
  parts: [
    { lathe: BUCKET, seg: 10, c: 'wood', name: 'body' },
    { cyl: [0.22, 0.01, 0.22], at: [0, 0.035, 0], seg: 10, c: 'inside' },
    band(bucketR, 0.04, 0.08, 'hoop'),
    band(bucketR, 0.24, 0.28, 'hoop'),
    { mirror: [{ box: [0.04, 0.09, 0.07], at: [0.168, 0.29, 0], c: 'hoop' }] },
    { tube: [[-0.19, 0.3, 0], [-0.18, 0.42, 0], [-0.11, 0.5, 0], [0, 0.52, 0], [0.11, 0.5, 0], [0.18, 0.42, 0], [0.19, 0.3, 0]], r: 0.03, c: 'bail', name: 'bail' },
  ],
});

/** A keg cradle's outline across the keg (x, y up): splayed legs, a notch that fits the keg's belly. */
const CRADLE: readonly [number, number][] = [
  [-0.22, 0], [-0.13, 0], [-0.07, 0.08], [0.07, 0.08], [0.13, 0], [0.22, 0],
  [0.2, 0.31], [0.165, 0.31], [0.12, 0.25], [0.06, 0.212], [0, 0.2], [-0.06, 0.212], [-0.12, 0.25], [-0.165, 0.31], [-0.2, 0.31],
];
/** The keg's axis height: its belly sits 0.5 cm into the cradles' notches. */
const KEG_Y = 0.38;

export const keg = model({
  id: 'keg',
  about: 'Small barrel lying on a stand of two notched cradles, its head to the front with a brass tap',
  tags: ['container', 'wood', 'town', 'tavern'],
  palette: { wood: 'orange', hoop: 'slate', head: 'red', stand: 'plum', tap: 'sand' },
  parts: [
    { use: 'barrel', at: [0, KEG_Y, -0.24], rot: [90, 0, 0], scale: 0.6, palette: { wood: 'wood', band: 'hoop', lid: 'head' }, name: 'keg' },
    { mirror: [{ slab: CRADLE, depth: 0.07, at: [0, 0, 0.13], c: 'stand' }], axis: 'z' },
    { mirror: [{ box: [0.07, 0.07, 0.33], at: [0.17, 0.035, 0], c: 'stand' }] },
    {
      name: 'tap',
      at: [0, KEG_Y - 0.08, 0.25],
      group: [
        { cyl: [0.07, 0.12, 0.07], at: [0, 0, 0.05], rot: [90, 0, 0], seg: 6, c: 'tap' },
        { cyl: [0.065, 0.08, 0.065], at: [0, -0.05, 0.09], seg: 6, c: 'tap' },
      ],
    },
  ],
});

export const strongbox = model({
  id: 'strongbox',
  about: 'Small iron-banded strongbox: a dark wood body, a lighter lid on the pivot `lid` hinged at the back, iron straps and corners, a gold lock plate',
  tags: ['container', 'iron', 'wood', 'loot', 'dungeon'],
  palette: { wood: 'red', lid: 'orange', iron: 'night', lock: 'sand' },
  parts: [
    { box: [0.5, 0.24, 0.34], at: [0, 0.12, 0], c: 'wood', name: 'body' },
    { box: [0.52, 0.035, 0.36], at: [0, 0.0175, 0], c: 'iron' },
    { mirror: [{ box: [0.07, 0.25, 0.37], at: [0.15, 0.125, 0], c: 'iron' }] },
    { box: [0.13, 0.12, 0.03], at: [0, 0.19, 0.18], c: 'lock', name: 'lock' },
    {
      name: 'lid',
      pivot: true,
      at: [0, 0.24, -0.17],
      group: [
        { box: [0.52, 0.09, 0.36], at: [0, 0.045, 0.17], c: 'lid' },
        { mirror: [{ box: [0.07, 0.1, 0.38], at: [0.15, 0.053, 0.17], c: 'iron' }] },
        { mirror: [{ box: [0.04, 0.1, 0.38], at: [0.25, 0.053, 0.17], c: 'iron' }] },
        { box: [0.08, 0.07, 0.02], at: [0, 0.01, 0.36], c: 'lock' },
      ],
    },
  ],
});

/**
 * Where the crate stack's crates go, in order: two side by side on the floor, one on top across
 * them, a smaller fourth on the floor in front of the first, turned. [x, y, z, yaw, scale].
 */
const STACK: readonly [number, number, number, number, number][] = [
  [-0.4, 0, 0, 0, 1],
  [0.4, 0, -0.04, 0, 1],
  [-0.05, 0.72, -0.02, 0, 1],
  [-0.42, 0, 0.8, -25, 0.75],
];

export const crateStack = model({
  id: 'crate-stack',
  about: 'Stack of `count` crates (seeded): two on the floor, one across their tops, a smaller one in front; alternate crates darker',
  tags: ['container', 'wood', 'town', 'dungeon'],
  palette: { wood: 'orange', wood2: 'red', band: 'red', band2: 'plum' },
  params: { count: [3, 2, 4] },
  parts: (p, rng) =>
    STACK.slice(0, Math.round(p.count!)).map(([x, y, z, yaw, s], i): Part => ({
      use: 'crate',
      at: [x + rng.range(-0.01, 0.01), y, z + rng.range(-0.04, 0.04)],
      rot: [0, yaw + rng.range(-4, 4), 0],
      scale: s,
      palette: i % 2 ? { wood: 'wood2', band: 'band2' } : { wood: 'wood', band: 'band' },
    })),
});

export const CONTAINERS = [barrel, crate, clayPot, amphora, urn, basket, bucket, keg, strongbox, crateStack];
