import { around, model } from '../helpers';
import type { Rng } from '../../random';
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

/**
 * A pine's parts, shared by `pine` and `snowy-pine`. Snow lies on each tier's shoulder, a band
 * standing proud of the cone from halfway up its showing slope to under the tier above, and caps
 * the top tier.
 */
function pineParts(height: number, rng: Rng, snow: boolean): Part[] {
  const h = height * rng.range(0.94, 1.06);
  const w = h * 0.5 * rng.range(0.92, 1.08); // a trunk shows under the lowest tier from the game camera
  const trunk = h * 0.075;
  const rot: Vec3 = [rng.range(-1.5, 1.5), rng.range(0, 360), rng.range(-1.5, 1.5)];
  const tiers = PINE_TIERS.map(([y, ch, cw], i) => ({ y, ch, tw: w * cw * rng.range(0.94, 1.06), turn: rng.range(0, 45), c: i % 2 ? 'leaf2' : 'leaf' }));
  const caps = snow
    ? tiers.map(({ y, ch, tw, turn }, i): Part => {
        const r = (at: number) => (tw / 2) * 1.08 * (1 - (at - h * y) / (h * ch)); // the tier's radius at a height, and a little proud
        const next = tiers[i + 1];
        if (!next) return { cone: [r(h * (y + ch / 2)) * 2, h * ch * 0.5, r(h * (y + ch / 2)) * 2], at: [0, h * (y + ch * 0.75) + 0.02, 0], rot: [0, turn, 0], seg: 8, c: 'snow' };
        const lo = h * (y + (next.y - y) * 0.5); // the lower half of the showing slope stays green
        const hi = h * next.y + 0.04; // into the tier above, which hides the band's top
        return { cyl: [r(lo) * 2, hi - lo, r(lo) * 2], top: r(hi) / r(lo), at: [0, (lo + hi) / 2, 0], rot: [0, turn, 0], seg: 8, c: 'snow' };
      })
    : [];
  return [
    {
      rot,
      group: [
        { cyl: [trunk, h * 0.4, trunk], at: [0, h * 0.2, 0], top: 0.8, seg: 6, c: 'bark', name: 'trunk' },
        ...tiers.map(({ y, ch, tw, turn, c }): Part => ({ cone: [tw, h * ch, tw], at: [0, h * (y + ch / 2), 0], rot: [0, turn, 0], seg: 8, c })),
        ...caps,
      ],
    },
  ];
}

export const pine = model({
  id: 'pine',
  about: 'Conifer: a plum trunk under four stacked cones, teal and green in turn; `h` is its height',
  tags: ['nature', 'tree'],
  palette: { bark: 'plum', leaf: 'teal', leaf2: 'green' },
  params: { h: [4, 3, 5] },
  collider: 'cyl',
  parts: (p, rng) => pineParts(p.h!, rng, false),
});

export const snowyPine = model({
  id: 'snowy-pine',
  about: "Snow-laden conifer: `pine`'s plum trunk and teal and green tiers with white snow on each tier's shoulders and its tip; `h` is its height",
  tags: ['nature', 'tree', 'snow'],
  palette: { bark: 'plum', leaf: 'teal', leaf2: 'green', snow: 'white' },
  params: { h: [4, 3, 5] },
  collider: 'cyl',
  parts: (p, rng) => pineParts(p.h!, rng, true),
});

/** The point `r` out from the centre at `deg` degrees round Y (from +X towards +Z), on the floor plane. */
export const polar = (deg: number, r: number): [number, number] => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

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

export const birch = model({
  id: 'birch',
  about: 'Birch: a slender white trunk barred with ink marks under a light, open crown of small lumps in lime and green; `h` is its height',
  tags: ['nature', 'tree'],
  palette: { bark: 'white', mark: 'ink', leaf: 'lime', leaf2: 'green' },
  params: { h: [4.5, 3, 6] },
  collider: 'cyl',
  parts: (p, rng) => {
    const h = p.h! * rng.range(0.94, 1.06);
    const t = 0.065 * h; // the trunk at its foot
    const th = h * 0.8; // the trunk runs up into the crown
    const n = rng.int(5, 6);
    const phase = rng.range(0, 360);
    const face = (y: number) => (t / 2) * (1 - (0.3 * y) / th) * Math.cos(Math.PI / 6); // a face of the tapered hexagon, `y` up
    return [
      { cyl: [t, th, t], at: [0, th / 2, 0], top: 0.7, seg: 6, c: 'bark', name: 'trunk' },
      // dark bars on the bare trunk, on the faces the game camera sees (a hexagon's faces sit at
      // 60° steps from +Z; 0, 60 and 120 face the camera) and a couple round the back
      ...[0, 120, 60, 240, 0, 120, 300].map((turn, i): Part => {
        const y = h * (0.05 + 0.052 * i + rng.range(0, 0.02));
        return { rot: [0, turn, 0], group: [{ box: [t * 0.5, 0.1, 0.06], at: [0, y, face(y)], c: 'mark' }] };
      }),
      // the crown: smallish lumps climbing round the trunk's top, lime and green in turn (the top one lime)
      ...Array.from({ length: n }, (_, i): Part => {
        const f = i / (n - 1);
        const k = h * (0.25 - 0.09 * f) * rng.range(0.9, 1.1);
        const [x, z] = polar(phase + i * 137.5, h * 0.13 * (1 - 0.5 * f));
        return { lump: [k, k * 0.85, k], at: [x, h * (0.5 + 0.38 * f), z], rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c: (n - 1 - i) % 2 ? 'leaf2' : 'leaf' };
      }),
    ];
  },
});

/** The point `r` out from `p` at `deg` degrees round Y, and `up` higher. */
const step = (p: Vec3, deg: number, r: number, up: number): Vec3 => {
  const [x, z] = polar(deg, r);
  return [p[0] + x, p[1] + up, p[2] + z];
};

/** The point `f` of the way from `a` to `b`. */
const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

export const deadTree = model({
  id: 'dead-tree',
  about: 'Dead tree: a crooked slate trunk on night roots, forking into 3-5 bare, twisted branches in mist and slate with dark twigs (seeded); `h` is its height',
  tags: ['nature', 'tree', 'dead'],
  palette: { bark: 'slate', branch: 'mist', twig: 'night', root: 'night' },
  params: { h: [3.5, 2.5, 5] },
  collider: 'cyl',
  parts: (p, rng) => {
    const h = p.h! * rng.range(0.94, 1.06);
    const s = h / 3.5;
    const lean = rng.range(0, 360);
    const spine: Vec3[] = [[0, 0, 0], [0, h * 0.16, 0], step([0, 0, 0], lean, h * 0.05, h * 0.36), step([0, 0, 0], lean + rng.range(60, 120), h * 0.02, h * 0.55)];
    const n = rng.int(3, 5);
    const a0 = rng.range(0, 360);
    const thin = Math.max(0.035, 0.045 * s); // tips stay 0.07 m across, or the outlines eat them
    return [
      { tube: spine, r: [0.24 * s, 0.14 * s], seg: 6, c: 'bark', name: 'trunk' },
      ...roots(4, 0.16 * s, 0.26 * s, 0.34 * s, 0.12 * s, lean + 45, 'root'),
      // branches take mist and slate in turn (one colour would join them into a tangle at 480×270), twigs dark
      ...Array.from({ length: n }, (_, i): Part[] => {
        const top = i === n - 1; // the leader climbs on from the trunk's top
        const a = a0 + i * 137.5 + rng.range(-20, 20);
        const l = h * (top ? 0.3 : rng.range(0.26, 0.36));
        const b0 = top ? spine[3]! : lerp3(spine[2]!, spine[3]!, 0.3 + (0.6 * i) / Math.max(1, n - 2));
        const b1 = step(b0, a, l * (top ? 0.15 : 0.4), l * (top ? 0.45 : 0.3));
        const b2 = step(b1, a + rng.range(-50, 50), l * 0.3, l * 0.42);
        const b3 = step(b2, a + rng.range(-35, 35), l * 0.22, l * 0.32);
        const side = i % 4 ? 1 : -1;
        const twig: Part[] = i % 2 ? [] : [{ tube: [b1, step(b1, a + 75 * side, l * 0.32, l * 0.26), step(b1, a + 100 * side, l * 0.5, l * 0.5)], r: [Math.max(0.045, 0.065 * s), thin], seg: 5, c: 'twig' }];
        return [{ tube: [b0, b1, b2, b3], r: [Math.max(0.065, 0.11 * s), thin], seg: 6, c: i % 2 ? 'bark' : 'branch' }, ...twig];
      }).flat(),
    ];
  },
});

export const willow = model({
  id: 'willow',
  about: 'Weeping willow: a green dome under a lime crown, draped in strands of lime, teal and green that fall over its shoulders to knee height round a plum trunk; `h` is its height',
  tags: ['nature', 'tree', 'water'],
  palette: { bark: 'plum', leaf: 'green', leaf2: 'lime', leaf3: 'teal' },
  params: { h: [4, 3, 5] },
  collider: 'cyl',
  parts: (p, rng) => {
    const s = (p.h! / 4) * rng.range(0.94, 1.06);
    const R = 1.45 * s; // the dome's radius
    const H = 0.8 * s; // its half height
    const mid = 2.6 * s; // its widest ring
    const phase = rng.range(0, 360);
    // A strand lies over the dome from near its top to its widest ring in two pieces, then hangs
    // to `bottom`. Strands are 0.18 m wide at any size, so the curtain stays strands (wider, one
    // colour's strands would join into a block at 480×270).
    const ring = (y: number) => R * Math.sqrt(1 - (y / H) ** 2) + 0.06; // just proud of the dome, `y` above its middle
    const over = (ya: number, yb: number, c: string): Part => {
      const [ra, rb] = [ring(ya), ring(yb)];
      const bulge = ring((ya + yb) / 2) - (ra + rb) / 2; // the dome bulges out past the chord
      return { box: [0.18, Math.hypot(rb - ra, ya - yb) + 0.06, 0.08], at: [0, mid + (ya + yb) / 2, (ra + rb) / 2 + bulge], rot: [(-Math.atan2(rb - ra, ya - yb) * 180) / Math.PI, 0, 0], c };
    };
    const strand = (bottom: number, c: string): Part => ({
      name: 'strands',
      group: [over(0.85 * H, 0.45 * H, c), over(0.45 * H, -0.05 * H, c), { box: [0.18, mid - 0.01 * H - bottom, 0.08], at: [0, (mid - 0.01 * H + bottom) / 2, ring(-0.05 * H)], rot: [-4, 0, 0], c }],
    });
    return [
      { cyl: [0.55 * s, mid, 0.55 * s], at: [0, mid / 2, 0], top: 0.7, seg: 7, c: 'bark', name: 'trunk' },
      ...roots(4, 0.16 * s, 0.3 * s, 0.3 * s, 0.12 * s, phase),
      { ball: [2 * R, 2 * H, 2 * R], at: [0, mid, 0], seg: 10, c: 'leaf', name: 'crown' },
      { lump: [0.95 * R, 0.6 * s, 0.95 * R], at: [0, mid + H, 0], seed: rng.int(1, 999), c: 'leaf2', name: 'crown' },
      // the curtain in three greens in turn, and a shorter teal one inside, under the dome
      ...around(22, (i) => strand(s * rng.range(0.35, 0.8), ['leaf2', 'leaf3', 'leaf'][i % 3]!), { phase }),
      ...around(8, () => ({ box: [0.18, mid - H * 0.6 - s * 1.1, 0.08], at: [0, (mid - H * 0.6 + s * 1.1) / 2, R * 0.6], c: 'leaf3', name: 'strands' }), { phase: phase + 8 }),
    ];
  },
});

export const cactus = model({
  id: 'cactus',
  about: 'Saguaro cactus: a green column striped with lime ribs, 2-3 arms elbowing up (seeded), teal and lime by turns round it, red buds on its crown; `h` is its height',
  tags: ['nature', 'plant', 'desert'],
  palette: { body: 'green', arm: 'teal', arm2: 'lime', rib: 'lime', bud: 'red' },
  params: { h: [2.4, 1.2, 3.5] },
  collider: 'cyl',
  parts: (p, rng) => {
    const h = p.h! * rng.range(0.94, 1.06);
    const d = 0.05 + 0.16 * h;
    const col = h - d / 2; // the column, under its dome
    const n = rng.int(2, 3);
    // an arm turned `a` about Y reaches sin(a + 45°) across the screen and cos(a + 45°) toward the
    // game camera: the first stands out to the right (its opposite to the left), never in line
    // with the camera, where the trunk would hide one and cover the other
    const a0 = rng.range(-20, 110);
    const da = d * 0.72; // an arm's width
    const reach = d / 2 + da * 1.05;
    // two arms stand opposite; a third comes out between them, toward the camera. Teal and lime
    // by turns, so two arms of one colour stand opposite with the trunk between them, and are
    // teal, which the lime ribs can't bridge: no two arms join into one block
    const arms = Array.from({ length: n }, (_, i) => {
      const y = h * rng.range(0.32, 0.52);
      const up = h * rng.range(0.24, 0.36);
      return { y, up, yaw: a0 + [0, n === 2 ? 180 : -90, 180][i]! + rng.range(-15, 15), c: i % 2 ? 'arm2' : 'arm' };
    });
    return [
      { cyl: [d, col, d], at: [0, col / 2, 0], seg: 8, c: 'body', name: 'trunk' },
      { ball: [d, d / 2, d], half: true, at: [0, col + d / 4, 0], seg: 8, c: 'body' },
      // ribs on every other face (an octagon's faces sit at 22.5° + 45° steps from +Z)
      ...around(4, { box: [0.07, col * 0.9, 0.04], at: [0, col * 0.47, (d / 2) * Math.cos(Math.PI / 8)], c: 'rib' }, { phase: 22.5 }),
      // an arm: one bent tube out of the column and up, under a dome
      ...arms.map(({ y, up, yaw, c }): Part => ({
        rot: [0, yaw, 0],
        name: 'arm',
        group: [
          { tube: [[0, y, 0], [reach - da * 0.5, y, 0], [reach, y + da * 0.5, 0], [reach, y + up, 0]], r: da / 2, seg: 6, c },
          { ball: [da, da / 2, da], half: true, at: [reach, y + up + da / 4, 0], seg: 6, c },
        ],
      })),
      ...around(3, { ball: [0.1, 0.08, 0.1], at: [0, col + d * 0.4, d * 0.2], seg: 5, c: 'bud' }, { phase: a0 }),
    ];
  },
});

/** Degrees about X and Z that lean +Y `deg` degrees toward `toward` degrees round Y (from +X towards +Z) of the frame. */
const tilt = (deg: number, toward: number): Vec3 => [deg * Math.sin((toward * Math.PI) / 180), 0, -deg * Math.cos((toward * Math.PI) / 180)];

type Outline = [number, number][];

/**
 * A blade or leaf (an XY outline, y up from its foot at `at`) leaning `lean` degrees toward `deg`
 * round Y, its face turned to the game camera (+X +Z) give or take `spin` degrees, so a tuft reads
 * as a fan of leaves rather than edge-on slivers. `tip` bends on from `y` up the blade, `bend`
 * degrees further.
 */
function blade(at: Vec3, deg: number, lean: number, spin: number, c: string, outline: Outline, tip?: { y: number; bend: number; outline: Outline }): Part {
  const yaw = 45 + spin;
  const toward = deg + yaw; // the lean, in the turned frame
  const [ax, , az] = tilt(lean, toward).map((d) => (d * Math.PI) / 180);
  const foot = Math.max(...outline.filter(([, y]) => y <= 0).map(([x]) => Math.abs(x)));
  const lift = foot * Math.abs(Math.sin(az!)) * Math.cos(ax!) + 0.0075 * Math.abs(Math.sin(ax!)); // leaning dips a corner of the foot below the floor
  const bent: Part[] = tip ? [{ at: [0, tip.y, 0], rot: tilt(tip.bend, toward), group: [{ slab: tip.outline, depth: 0.015, c }] }] : [];
  return { at: [at[0], at[1] + lift, at[2]], rot: [0, yaw, 0], group: [{ rot: tilt(lean, toward), group: [{ slab: outline, depth: 0.015, c }, ...bent] }] };
}

export const reeds = model({
  id: 'reeds',
  about: 'Clump of reeds: green and lime blades fanning round 3-5 green stalks that carry red cattail heads (seeded); `h` is the tallest stalk',
  tags: ['nature', 'plant', 'water'],
  palette: { blade: 'green', blade2: 'lime', stalk: 'green', head: 'red' },
  params: { h: [1.4, 0.8, 2] },
  collider: 'none',
  parts: (p, rng) => {
    const h = p.h!;
    const phase = rng.range(0, 360);
    const stalks = rng.int(3, 5);
    const blades = rng.int(6, 9);
    return [
      ...Array.from({ length: blades }, (_, i): Part => {
        const a = phase + i * 137.5 + rng.range(-12, 12);
        const [x, z] = polar(a, rng.range(0.05, 0.2));
        const l = h * rng.range(0.45, 0.8);
        const w = rng.range(0.12, 0.17);
        return blade([x, 0, z], a, rng.range(8, 26), rng.range(-35, 35), i % 2 ? 'blade2' : 'blade', [[-w / 2, 0], [w / 2, 0], [w * 0.15, l]]);
      }),
      // stalks splay out of the clump, so their heads stand apart
      ...Array.from({ length: stalks }, (_, i): Part => {
        const a = phase + 70 + (360 * i) / stalks + rng.range(-20, 20);
        const [x, z] = polar(a, i ? rng.range(0.1, 0.2) : 0.02);
        const l = h * (i ? rng.range(0.66, 0.9) : 1);
        return {
          at: [x, 0, z],
          rot: tilt(i ? rng.range(4, 10) : 2, a),
          group: [
            { box: [0.06, l, 0.06], at: [0, l / 2, 0], c: 'stalk' },
            { cyl: [0.13, 0.26, 0.13], at: [0, l - 0.21, 0], seg: 6, c: 'head' }, // the stalk's tip shows above it
          ],
        };
      }),
    ];
  },
});

/** A fern frond's half-width (× its full width) `t` of the way from its foot to its tip: narrow at the foot, widest a third up, a point at the tip. */
const frondWidth = (t: number) => 0.5 * Math.sin(Math.PI * (0.15 + 0.85 * Math.min(1, t)));

/**
 * A fern frond's outline (XY, its foot at y = 0), `l` long and `w` wide with `n` leaflets a side:
 * teeth swept toward the tip round a midrib.
 */
function frond(l: number, w: number, n: number): [number, number][] {
  const s = l / n;
  const right: [number, number][] = [];
  for (let j = 0; j < n; j++) right.push([Math.max(0.035, w * frondWidth(j / n) * 0.4), j * s], [w * frondWidth((j + 0.6) / n), (j + 0.7) * s]); // a notch (the midrib stays 0.07 m across), a tooth
  return [...right, [0, l], ...right.reverse().map(([x, y]): [number, number] => [-x, y])];
}

export const ferns = model({
  id: 'ferns',
  about: "Fern clump: 6-8 toothed fronds in green, lime and teal in turn, fanning up and out of a plum crown on steep stalks (seeded); `size` is a frond's length",
  tags: ['nature', 'plant', 'forest'],
  palette: { leaf: 'green', leaf2: 'lime', leaf3: 'teal', crown: 'plum' },
  params: { size: [0.8, 0.5, 1.2] },
  collider: 'none',
  parts: (p, rng) => {
    const l = p.size!;
    const n = rng.int(6, 8);
    const phase = rng.range(0, 360);
    const rad = Math.PI / 180;
    return [
      { lump: [l * 0.3, l * 0.16, l * 0.3], at: [0, l * 0.08, 0], seed: rng.int(1, 999), c: 'crown', name: 'crown' },
      ...Array.from({ length: n }, (_, i): Part => {
        const k = l * rng.range(0.85, 1.1);
        const stalk = k * 0.24;
        const rise = rng.range(50, 65); // the stalk climbs…
        const fall = rng.range(-28, -4); // …and the leafy blade goes on out, still rising a little
        const c = ['leaf', 'leaf2', 'leaf3'][i % 3]!; // three greens in turn: never four fronds of one
        return {
          at: [0, l * 0.1, 0],
          rot: [0, 90 - (phase + (360 * i) / n + rng.range(-12, 12)), 0],
          group: [
            { slab: [[-0.035, 0], [0.035, 0], [0.035, stalk], [-0.035, stalk]], depth: 0.03, rot: [90 - rise, 0, 0], c },
            { slab: frond(k - stalk, k * 0.34, 5), depth: 0.02, at: [0, stalk * Math.sin(rise * rad), stalk * Math.cos(rise * rad)], rot: [90 + fall, 0, 0], c },
          ],
        };
      }),
    ];
  },
});

export const tallGrass = model({
  id: 'tall-grass',
  about: 'Tuft of tall grass: 4-6 broad blades out of one root, tall lime ones upright and green ones leaning out, some bent over (seeded); `h` is the tallest blade',
  tags: ['nature', 'plant', 'grass'],
  palette: { blade: 'lime', blade2: 'green' },
  params: { h: [0.9, 0.4, 1.2] },
  collider: 'none',
  parts: (p, rng) => {
    const h = p.h!;
    const n = rng.int(4, 6);
    const phase = rng.range(0, 360);
    // two kinds in turn: [colour, length, lean] (the leaning ones face the sky, so they catch the light)
    const kinds = [
      ['blade', [0.8, 1], [4, 18]],
      ['blade2', [0.55, 0.8], [24, 44]],
    ] as const;
    return Array.from({ length: n }, (_, i): Part => {
      const [c, [l0, l1], [a0, a1]] = kinds[i % 2]!;
      // blades fan out to the sides and back (225° is away from the game camera): one leaning at
      // the camera shows it a face turned from the light, and the tuft reads dark
      const a = 105 + ((phase + i * 137.5) % 240) + rng.range(-10, 10);
      const [x, z] = polar(a, rng.range(0.03, 0.12));
      const l = h * rng.range(l0, l1);
      // 6-7 art pixels at the foot, and broad two thirds of the way up before the point: a thin
      // blade is all cel outline at game scale, and the tuft reads dark
      const w = rng.range(0.3, 0.36);
      // every third blade bends over partway up (0.1 m across at the bend, so its tip stays)
      const bend = i % 3 === 2 ? { y: l * 0.55, bend: 35, outline: [[-0.05, 0], [0.05, 0], [0, l * 0.45]] as Outline } : undefined;
      const outline: Outline = bend ? [[-w / 2, 0], [w / 2, 0], [0.05, l * 0.55], [-0.05, l * 0.55]] : [[-w / 2, 0], [w / 2, 0], [w * 0.2, l * 0.68], [0, l], [-w * 0.2, l * 0.68]];
      return blade([x, 0, z], a, rng.range(a0, a1), rng.range(-45, -20), c, outline, bend);
    });
  },
});

export const boulders = model({
  id: 'boulders',
  about: 'Pile of 3-5 boulders (seeded): a big slate one with smaller mist and night ones heaped round its front and sometimes one up on its shoulder; `size` is the biggest',
  tags: ['nature', 'stone'],
  palette: { stone: 'slate', stone2: 'mist', stone3: 'night' },
  params: { size: [1.2, 0.6, 2] },
  collider: 'hull',
  parts: (p, rng) => {
    const s = p.size!;
    const m = rng.int(2, 3); // round its foot
    const [ux, uz] = polar(rng.range(0, 360), s * 0.14);
    const up = rng.chance(0.5); // and one on its shoulder
    // a rounder `rock`, at sizes past its range
    const boulder = (k: number, x: number, y: number, z: number, c: string): Part => ({ lump: [k, k * 0.7, k * 0.85], at: [x, y + k * 0.35, z], rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c });
    return [
      boulder(s, 0, 0, 0, 'stone'),
      // the small ones on the half the game camera sees (-45° to 135°), or the big one hides them
      ...Array.from({ length: m }, (_, i) => {
        const k = s * rng.range(0.42, 0.6);
        const [x, z] = polar(-45 + (180 * (i + 0.5)) / m + rng.range(-15, 15), s * 0.36 + k * 0.28); // into the big one's foot
        return boulder(k, x, 0, z, i % 2 ? 'stone3' : 'stone2');
      }),
      ...(up ? [boulder(s * rng.range(0.4, 0.48), ux, s * 0.56, uz, 'stone2')] : []),
    ];
  },
});

/** A lily pad's outline: a disc of radius `r` with a slit `notch` degrees wide cut to its centre. */
const lilyPad = (r: number, notch = 36, n = 10): [number, number][] => [
  [0, 0],
  ...Array.from({ length: n + 1 }, (_, i): [number, number] => {
    const a = ((notch / 2 + ((360 - notch) * i) / n) * Math.PI) / 180;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }),
];

export const lilyPads = model({
  id: 'lily-pads',
  about: 'Lily pads lying flat on water at y = 0: 3-5 slit discs in green and lime (seeded), the middle one holding a white flower with a sand heart; `r` is the patch radius',
  tags: ['nature', 'plant', 'water'],
  palette: { pad: 'green', pad2: 'lime', petal: 'white', heart: 'sand' },
  params: { r: [0.8, 0.5, 1.2] },
  collider: 'none',
  parts: (p, rng) => {
    const R = p.r!;
    const n = rng.int(3, 5);
    const phase = rng.range(0, 360);
    const r0 = R * 0.38;
    const pad = (r: number, x: number, z: number, c: string): Part => ({ at: [x, 0, z], rot: [0, rng.range(0, 360), 0], group: [{ slab: lilyPad(r), depth: 0.03, at: [0, 0.015, 0], rot: [-90, 0, 0], c }] });
    return [
      pad(r0, 0, 0, 'pad'),
      ...Array.from({ length: n - 1 }, (_, i) => {
        const r = R * rng.range(0.22, 0.3);
        const [x, z] = polar(phase + (360 * i) / (n - 1) + rng.range(-15, 15), r0 + r + R * rng.range(0.04, 0.12)); // apart, never overlapping
        return pad(r, x, z, i % 2 ? 'pad' : 'pad2');
      }),
      {
        at: [0, 0.03, 0],
        rot: [0, rng.range(0, 72), 0],
        name: 'flower',
        group: [
          // big petals: smaller ones read as a grey smudge at 480×270
          ...around(5, { box: [0.12, 0.03, 0.2], at: [0, 0.045, 0.1], rot: [-30, 0, 0], c: 'petal' }),
          ...around(5, { box: [0.1, 0.03, 0.13], at: [0, 0.08, 0.05], rot: [-60, 0, 0], c: 'petal' }, { phase: 36 }),
          { cyl: [0.1, 0.1, 0.1], at: [0, 0.09, 0], seg: 6, c: 'heart' },
        ],
      },
    ];
  },
});

export const fallenTree = model({
  id: 'fallen-tree',
  about: 'Fallen tree: a red trunk with peeled orange bark, a broken limb and a stub, sloping down from its upturned root plate (plum earth with torn clods, seeded red roots, some broken off, mist stones, green turf along its top) to a sand end; `length` along x',
  tags: ['nature', 'wood', 'forest'],
  palette: { bark: 'red', bark2: 'orange', earth: 'plum', turf: 'green', stone: 'mist', cut: 'sand' },
  params: { length: [3.2, 2, 4.5] },
  parts: (p, rng) => {
    const l = p.length!;
    const d = 0.55; // the trunk at its foot
    const D = 1.7; // the root plate, standing on edge at the +x end with its earth to the camera
    const px = l / 2 - 0.1;
    const foot: Vec3 = [px - 0.05, 0.62, 0]; // where the trunk leaves the plate
    const slope = Math.asin((foot[1] - 0.18) / l); // down to its narrow end on the floor
    const dir: Vec3 = [-Math.cos(slope), -Math.sin(slope), 0];
    const deg = (slope * 180) / Math.PI;
    const n = rng.int(6, 8);
    const rad = Math.PI / 180;
    /** The trunk's radius `t` of the way from its foot to its narrow end (it tapers to 0.6). */
    const rAt = (t: number) => (d / 2) * (1 - 0.4 * t);
    const taper = (Math.atan((0.2 * d) / l) * 180) / Math.PI;
    const flat = Math.cos(Math.PI / 8); // an octagon's face, from its middle, over its corner
    /** A point `x` out from the plate's earth, `r` from its middle at `deg` from straight up toward +z. */
    const pt = (deg: number, r: number, x: number): Vec3 => [px + x, D / 2 + Math.cos(deg * rad) * r, Math.sin(deg * rad) * r];
    return [
      { lump: [0.4, D * 0.94, D * 0.9], at: [px, D * 0.48, 0], seed: rng.int(1, 999), c: 'earth', name: 'plate' },
      // clods torn up with it break the plate's round (a round plate and even roots read as a wheel)
      ...[rng.range(-130, -95), rng.range(40, 100)].map((a): Part => ({ lump: [0.36, D * 0.36, D * 0.4], at: pt(a, D * 0.42, -0.04), seed: rng.int(1, 999), c: 'earth', name: 'plate' })),
      // the turf it lifted, behind the earth, shows along its top
      { lump: [0.24, D * 0.5, D * 0.86], at: [px - 0.16, D * 0.72, 0], seed: rng.int(1, 999), c: 'turf', name: 'turf' },
      // roots out of the earth at seeded angles and lengths, curling, every third broken off short;
      // they stand out of it and past its rim, none down into the floor
      ...Array.from({ length: n }, (_, i): Part => {
        const broken = i % 3 === 1;
        const a = -120 + (240 * (i + rng.range(0.1, 0.9))) / n;
        const b = Math.max(-128, Math.min(128, a + rng.range(-28, 28)));
        const len = D * (broken ? rng.range(0.22, 0.3) : rng.range(0.42, 0.62));
        return { tube: [pt(a, D * rng.range(0.03, 0.14), 0.1), pt((a + b) / 2, len * 0.55, 0.22), pt(b, len, rng.range(0.1, 0.2))], r: [rng.range(0.08, 0.1), broken ? 0.075 : 0.04], seg: 5, c: 'bark', name: 'roots' };
      }),
      ...[0, 1, 2].map((i): Part => ({ lump: [0.16, 0.26, 0.28], at: [px + 0.2, D * (0.3 + 0.2 * i), D * (i - 1) * 0.22 + rng.range(-0.1, 0.1)], seed: rng.int(1, 999), c: 'stone' })),
      {
        at: lerp3(foot, [foot[0] + dir[0] * l, foot[1] + dir[1] * l, 0], 0.5),
        rot: [0, 0, 90 + deg],
        group: [
          // local +X is up, +Y toward the narrow end, +Z toward the camera; turned a face up
          { cyl: [d, l, d], top: 0.6, seg: 8, rot: [0, 22.5, 0], c: 'bark', name: 'trunk' },
          { cyl: [d * 0.5, 0.04, d * 0.5], at: [0, l / 2 + 0.01, 0], seg: 8, c: 'cut' },
          // peeled bark: a strip along its top, then one on the face below it toward the camera
          ...[[0, 0.18, 0.32], [45, 0.5, 0.28]].map(([a, t, k]): Part => ({ at: [0, -l / 2 + l * (t! + k! / 2), 0], rot: [0, -a!, 0], group: [{ box: [0.04, l * k!, 0.18], at: [rAt(t! + k! / 2) * flat + 0.01, 0, 0], rot: [0, 0, taper], c: 'bark2', name: 'peeled' }] })),
          // a broken limb splintered pale at its end, and a stub
          {
            at: [d * 0.3, -l / 2 + l * 0.36, -0.04],
            rot: [-18, 0, -30],
            name: 'limb',
            group: [
              { cyl: [0.22, 0.6, 0.22], at: [0, 0.3, 0], top: 0.8, seg: 6, c: 'bark' },
              { cone: [0.18, 0.16, 0.18], at: [0, 0.68, 0], seg: 5, c: 'cut' },
            ],
          },
          { cyl: [0.14, 0.34, 0.14], at: [d * 0.42, -l / 2 + l * 0.8, -0.1], rot: [-35, 0, -55], top: 0.7, seg: 6, c: 'bark' },
        ],
      },
    ];
  },
});

export const NATURE = [rock, stoneRing, pine, oak, bush, stump, log, mushrooms, flowers, snowyPine, birch, deadTree, willow, cactus, reeds, ferns, tallGrass, boulders, lilyPads, fallenTree];
