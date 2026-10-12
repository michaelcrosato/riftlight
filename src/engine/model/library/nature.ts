import { around, model } from '../helpers';
import type { Part, Vec3 } from '../types';

export const rock = model({
  id: 'rock',
  about: 'Field stone: a rough lump, wider than tall; map `stone` to vary stones side by side',
  tags: ['nature', 'stone'],
  palette: { stone: 'slate' },
  params: { size: [0.35, 0.1, 1.2] },
  parts: (p, rng) => [{ lump: [p.size!, p.size! * 0.62, p.size! * 0.85], at: [0, p.size! * 0.32, 0], rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c: 'stone' }],
});

export const stoneRing = model({
  id: 'stone-ring',
  about: 'Ring of field stones in two greys (a fire pit, a well head, a garden border); `size` is the largest a stone gets',
  tags: ['nature', 'stone'],
  palette: { stone: 'slate', stone2: 'mist' },
  params: { r: [0.6, 0.3, 2], n: [10, 5, 12], size: [0.38, 0.15, 0.8] },
  parts: (p, rng) => {
    const n = Math.round(p.n!);
    const size = Math.min(p.size!, (0.8 * 2 * Math.PI * p.r!) / n); // stones never overlap their neighbours
    return around(n, (i) => ({ use: 'rock', params: { size: size * rng.range(0.85, 1.15) }, palette: { stone: i % 2 ? 'stone2' : 'stone' }, at: [0, 0, p.r!] }));
  },
});

/** Pine tiers as fractions of the height (base y, cone height) and of the lowest tier's width. */
const PINE_TIERS: readonly [y: number, h: number, w: number][] = [
  [0.28, 0.38, 1],
  [0.43, 0.33, 0.8],
  [0.57, 0.29, 0.6],
  [0.71, 0.29, 0.4],
];

export const pine = model({
  id: 'pine',
  about: 'Conifer: a plum trunk under four stacked cones, teal and green in turn; `h` is its height',
  tags: ['nature', 'tree'],
  palette: { bark: 'plum', leaf: 'teal', leaf2: 'green' },
  params: { h: [4, 3, 5] },
  collider: 'cyl',
  parts: (p, rng) => {
    const h = p.h! * rng.range(0.94, 1.06);
    const w = h * 0.5 * rng.range(0.92, 1.08); // a trunk shows under the lowest tier from the game camera
    const trunk = h * 0.075;
    return [
      {
        rot: [rng.range(-1.5, 1.5), rng.range(0, 360), rng.range(-1.5, 1.5)],
        group: [
          { cyl: [trunk, h * 0.4, trunk], at: [0, h * 0.2, 0], top: 0.8, seg: 6, c: 'bark', name: 'trunk' },
          ...PINE_TIERS.map(([y, ch, cw], i) => {
            const tw = w * cw * rng.range(0.94, 1.06);
            return { cone: [tw, h * ch, tw], at: [0, h * (y + ch / 2), 0], rot: [0, rng.range(0, 45), 0], seg: 8, c: i % 2 ? 'leaf2' : 'leaf' } as const;
          }),
        ],
      },
    ];
  },
});

/** The point `r` out from the centre at `deg` degrees round Y (from +X towards +Z), on the floor plane. */
const polar = (deg: number, r: number): [number, number] => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

/** `n` roots round a trunk: wedges `w` wide and `h` tall at the trunk, running `len` out from `r` (their backs inside it). */
const roots = (n: number, w: number, h: number, len: number, r: number, phase: number, c = 'bark'): Part[] =>
  around(n, { wedge: [w, h, len], at: [0, h / 2, r + len / 2], c }, { phase });

export const oak = model({
  id: 'oak',
  about: 'Round broadleaf tree: a red trunk on roots under a crown of 3-5 lumps, green round the sides and lime on top; `h` is its height',
  tags: ['nature', 'tree'],
  palette: { bark: 'red', leaf: 'green', leaf2: 'lime' },
  params: { h: [4, 3, 5] },
  collider: 'cyl',
  parts: (p, rng) => {
    const s = (p.h! / 4) * rng.range(0.94, 1.06);
    const n = rng.int(3, 5);
    const ring = n === 3 ? 2 : 3; // green, round the lower crown
    const tops = n - ring; // lime, above: the lit side from the game camera
    const phase = rng.range(0, 360);
    const lump = (k: number, at: Vec3, c: string): Part => ({ lump: [k, k * 0.78, k], at, rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c });
    const out = (a: number, r: number, y: number): Vec3 => {
      const [x, z] = polar(a, r);
      return [x, y, z];
    };
    const k = s * (ring === 2 ? 1.8 : 1.6);
    const top = (i: number): Vec3 => (tops === 2 ? out(phase + 60 + 180 * i, s * 0.4, s * 3.25) : out(phase + 60, s * 0.1, s * 3.2));
    return [
      { cyl: [0.5 * s, 2.3 * s, 0.5 * s], at: [0, 1.15 * s, 0], top: 0.65, seg: 7, c: 'bark', name: 'trunk' },
      ...roots(4, 0.16 * s, 0.3 * s, 0.3 * s, 0.12 * s, phase),
      ...Array.from({ length: ring }, (_, i) => lump(k * rng.range(0.92, 1.08), out(phase + (360 / ring) * i + rng.range(-12, 12), s * (ring === 2 ? 0.56 : 0.68), s * 2.3), 'leaf')),
      ...Array.from({ length: tops }, (_, i) => lump(s * (tops === 2 ? 1.45 : ring === 2 ? 1.6 : 1.7), top(i), 'leaf2')),
    ];
  },
});

export const bush = model({
  id: 'bush',
  about: 'Low leafy bush: a lime lump standing up out of 1-3 lower green ones round its foot; `w` is its width',
  tags: ['nature', 'plant'],
  palette: { leaf: 'green', leaf2: 'lime' },
  params: { w: [1.2, 0.6, 2] },
  collider: 'cyl',
  parts: (p, rng) => {
    const w = p.w!;
    const n = rng.int(2, 4);
    const phase = rng.range(0, 360);
    const lump = (k: number, h: number, a: number, r: number, c: string): Part => {
      const [x, z] = polar(a, r);
      return { lump: [k, h, k * 0.9], at: [x, h / 2, z], rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c };
    };
    return [
      lump(0.58 * w, 0.5 * w, phase + 180, n === 2 ? 0.12 * w : 0, 'leaf2'), // a pair leans apart
      ...Array.from({ length: n - 1 }, (_, i) => {
        const k = w * (n === 2 ? rng.range(0.62, 0.68) : rng.range(0.5, 0.58));
        return lump(k, k * 0.62, phase + (360 * i) / (n - 1) + rng.range(-20, 20), 0.26 * w, 'leaf');
      }),
    ];
  },
});

export const stump = model({
  id: 'stump',
  about: 'Cut tree stump: red bark on plum roots, a sand cut top with an orange heart; `d` is its width',
  tags: ['nature', 'wood'],
  palette: { bark: 'red', root: 'plum', cut: 'sand', heart: 'orange' },
  params: { d: [0.6, 0.4, 1] },
  collider: 'cyl',
  parts: (p, rng) => {
    const d = p.d!;
    const h = d * 0.7;
    return [
      {
        rot: [0, rng.range(0, 45), 0],
        group: [
          { cyl: [d, h, d], at: [0, h / 2, 0], top: 0.88, seg: 8, c: 'bark', name: 'trunk' },
          { cyl: [d * 0.76, 0.04, d * 0.76], at: [0, h + 0.01, 0], seg: 8, c: 'cut', name: 'cut' },
          { cyl: [d * 0.3, 0.04, d * 0.3], at: [0, h + 0.03, 0], seg: 8, c: 'heart' },
        ],
      },
      ...roots(5, d * 0.22, d * 0.38, d * 0.42, d * 0.32, rng.range(0, 72), 'root'), // darker, or trunk and roots read as one block
    ];
  },
});

/** cos 22.5°: an octagon turned to lie on a face is this much of its width tall. */
const FLAT8 = Math.cos(Math.PI / 8);

export const log = model({
  id: 'log',
  about: 'Fallen log on its side: red bark, sand end grain with an orange heart, a branch stub and a tuft of moss; `length` along x',
  tags: ['nature', 'wood'],
  palette: { bark: 'red', cut: 'sand', heart: 'orange', moss: 'green' },
  params: { length: [1.6, 0.8, 3] },
  parts: (p) => {
    const l = p.length!;
    const d = 0.44;
    const y = (d * FLAT8) / 2;
    return [
      { cyl: [d, l, d], at: [0, y, 0], rot: [22.5, 0, 90], seg: 8, c: 'bark', name: 'log' },
      {
        mirror: [
          { cyl: [d * 0.84, 0.04, d * 0.84], at: [l / 2 + 0.01, y, 0], rot: [22.5, 0, 90], seg: 8, c: 'cut' },
          { cyl: [d * 0.34, 0.04, d * 0.34], at: [l / 2 + 0.03, y, 0], rot: [22.5, 0, 90], seg: 8, c: 'heart' },
        ],
      },
      { cyl: [0.14, 0.32, 0.14], at: [l * 0.18, 2 * y + 0.06, 0.08], rot: [40, 0, -25], top: 0.65, seg: 6, c: 'bark', name: 'stub' },
      { lump: [Math.min(0.5, l * 0.3), 0.12, 0.3], at: [-l * 0.18, 2 * y, -0.02], seed: 3, c: 'moss', name: 'moss' },
    ];
  },
});

export const mushrooms = model({
  id: 'mushrooms',
  about: 'Cluster of 3-5 toadstools: white stalks, caps red and orange in turn with sand spots (map `cap`, `cap2`); `size` scales them',
  tags: ['nature', 'plant'],
  palette: { stalk: 'white', cap: 'red', cap2: 'orange', spot: 'sand' },
  params: { size: [1.2, 0.7, 2.5] }, // at 0.7 a spot is still 0.06 m
  collider: 'none',
  parts: (p, rng) => {
    const s = p.size!;
    const n = rng.int(3, 5);
    const phase = rng.range(0, 360);
    const spot = (y: number, out: number, tilt: number): Part => ({ box: [0.09 * s, 0.04 * s, 0.09 * s], at: [0, y, out], rot: [tilt, 45, 0], c: 'spot' });
    return Array.from({ length: n }, (_, i) => {
      const big = i === 0;
      const h = s * (big ? 0.34 : rng.range(0.14, 0.26)); // stalk
      const w = s * (big ? 0.42 : rng.range(0.22, 0.3)); // cap: wide, so the game camera sees its top
      const ch = w * 0.5;
      const top = h - 0.01 + ch; // the cap's crown
      const [x, z] = polar(phase + i * (n === 3 ? 140 : 360 / (n - 1)) + rng.range(-15, 15), big ? 0 : s * rng.range(0.36, 0.4)); // the small ones round the big one, never in a row
      const stalk = Math.max(0.07, w * 0.32);
      return {
        at: [x, 0, z],
        rot: big ? [0, rng.range(0, 360), 0] : [rng.range(-2, 2), rng.range(0, 360), rng.range(-2, 2)], // the big one stands straight
        group: [
          { cyl: [stalk, h, stalk], at: [0, h / 2, 0], top: 0.8, seg: 5, c: 'stalk' },
          // caps alternate shades: a cap behind the big one overlaps it on screen, and one red would join them into a block
          { ball: [w, ch, w], half: true, at: [0, h - 0.01 + ch / 2, 0], seg: 8, c: i % 2 ? 'cap2' : 'cap', ...(big ? { name: 'cap' } : {}) },
          ...(big ? around(3, spot(h - 0.01 + ch * 0.82, w * 0.29, 30)) : [spot(top, 0, 0)]),
        ],
      } as const;
    });
  },
});

export const flowers = model({
  id: 'flowers',
  about: 'Patch of wild flowers: chunky blossoms in red, sand and sky on short stems over leafy tufts in green and teal; `r` is its radius',
  tags: ['nature', 'plant', 'flower'],
  palette: { stem: 'green', leaf: 'teal', a: 'red', b: 'sand', c: 'sky' },
  params: { r: [0.4, 0.2, 0.8] },
  collider: 'none',
  parts: (p, rng) => {
    const r = p.r!;
    const n = Math.max(3, Math.round(rng.int(6, 8) * (r / 0.4) ** 1.2));
    const tufts = r < 0.3 ? 1 : r < 0.6 ? 2 : 3;
    const phase = rng.range(0, 360);
    return [
      ...Array.from({ length: tufts }, (_, i) => {
        const [x, z] = polar(phase + (360 * i) / tufts, tufts > 1 ? r * 0.4 : 0);
        const k = r * (tufts > 1 ? 1.1 : 1.6);
        return { lump: [k, 0.14, k * 0.85], at: [x, 0.07, z], rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c: i % 2 ? 'stem' : 'leaf' } as const;
      }),
      ...Array.from({ length: n }, (_, i) => {
        const [x, z] = polar(phase + i * 137.5, r * Math.sqrt((i + 0.5) / n) * 0.9);
        const h = rng.range(0.16, 0.26);
        const k = rng.range(0.19, 0.23); // chunky: a blossom is 4 art pixels at game scale
        return {
          at: [x, 0, z],
          rot: [rng.range(-6, 6), rng.range(0, 90), rng.range(-6, 6)],
          group: [
            { box: [0.07, h, 0.07], at: [0, h / 2, 0], c: 'stem' },
            { ball: [k, k * 0.5, k], at: [0, h + k * 0.15, 0], seg: 6, c: ['a', 'b', 'c'][i % 3]! },
          ],
        } as const;
      }),
    ];
  },
});

export const NATURE = [rock, stoneRing, pine, oak, bush, stump, log, mushrooms, flowers];
