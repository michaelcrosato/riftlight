import { around, model, rowOf } from '../helpers';
import type { Part } from '../types';
import { levels, masonry } from './architecture';

export const statue = model({
  id: 'statue',
  about: 'Robed stone figure on a plinth, sword point-down',
  tags: ['stone', 'monument'],
  palette: { stone: 'mist', dark: 'slate', trim: 'sand' },
  parts: [
    { box: [0.9, 0.28, 0.9], at: [0, 0.14, 0], c: 'dark' },
    { box: [0.98, 0.08, 0.98], at: [0, 0.32, 0], c: 'trim' },
    { lathe: [[0, 0], [0.3, 0], [0.27, 0.2], [0.19, 0.72], [0.2, 0.92], [0.28, 1.04], [0.11, 1.12], [0, 1.12]], at: [0, 0.36, 0], c: 'stone' },
    { ball: [0.24, 0.28, 0.25], at: [0, 1.6, 0.01], c: 'stone' },
    { mirror: [{ box: [0.11, 0.4, 0.12], at: [0.2, 1.2, 0.12], rot: [-38, 0, 12], c: 'dark' }] },
    {
      name: 'sword',
      at: [0, 0.36, 0.34],
      group: [
        { slab: [[-0.05, 0.06], [0, 0], [0.05, 0.06], [0.05, 0.6], [-0.05, 0.6]], depth: 0.03, c: 'stone' },
        { box: [0.3, 0.05, 0.06], at: [0, 0.62, 0], c: 'trim' },
        { cyl: [0.06, 0.12, 0.06], at: [0, 0.705, 0], seg: 6, c: 'stone' },
        { ball: [0.08, 0.08, 0.08], at: [0, 0.8, 0], c: 'trim' },
      ],
    },
  ],
});

export const well = model({
  id: 'well',
  about: 'Stone well with water, a winch and a gable roof',
  tags: ['town', 'stone', 'water'],
  palette: { stone: 'mist', dark: 'slate', wood: 'orange', roof: 'red', water: 'blue' },
  parts: [
    ...around(10, { box: [0.36, 0.5, 0.22], at: [0, 0.25, 0.62], c: 'stone' }),
    ...around(10, { box: [0.4, 0.08, 0.26], at: [0, 0.54, 0.62], c: 'dark' }, { phase: 18 }),
    { cyl: [1.1, 0.05, 1.1], at: [0, 0.3, 0], seg: 10, c: 'water' },
    { mirror: [{ box: [0.1, 1.5, 0.1], at: [0.62, 1.05, 0], c: 'wood' }] },
    { cyl: [0.12, 1.4, 0.12], at: [0, 1.55, 0], rot: [0, 0, 90], seg: 6, c: 'wood' },
    { cyl: [0.06, 0.7, 0.06], at: [0, 1.15, 0], seg: 4, c: 'dark' },
    { cyl: [0.2, 0.16, 0.2], at: [0, 0.76, 0], top: 1.2, c: 'wood' },
    { mirror: [{ box: [0.86, 0.06, 1.1], at: [0.33, 2.0, 0], rot: [0, 0, -38], c: 'roof' }] },
  ],
});

export const marketStall = model({
  id: 'market-stall',
  about: 'Market stall with a striped awning, crates and a barrel',
  tags: ['town', 'market'],
  palette: { wood: 'orange', cloth: 'red', cloth2: 'white', top: 'sand' },
  parts: [
    { box: [1.8, 0.08, 0.8], at: [0, 0.9, 0], c: 'top' },
    { mirror: [{ mirror: [{ box: [0.08, 0.86, 0.08], at: [0.8, 0.43, 0.32], c: 'wood' }], axis: 'z' }] },
    { mirror: [{ box: [0.07, 1.3, 0.07], at: [0.86, 1.55, -0.36], c: 'wood' }] },
    ...rowOf(6, [0.3, 0, 0], (i) => ({ box: [0.3, 0.05, 1.0], at: [-0.75, 2.05, 0.06], rot: [-22, 0, 0], c: i % 2 ? 'cloth' : 'cloth2' })),
    { use: 'barrel', at: [1.25, 0, 0.1] },
    { use: 'crate', at: [-1.35, 0, 0.15], rot: [0, 20, 0] },
    { use: 'crate', at: [-1.3, 0.72, 0.1], rot: [0, -10, 0], scale: 0.8 },
  ],
});

/** The ring between radii `a` and `b` (m) from angle `t0` to `t1` (degrees) as an XY outline, its arcs in `k` straight steps. */
const ringBlock = (a: number, b: number, t0: number, t1: number, k = 1): [number, number][] => {
  const at = (r: number, t: number): [number, number] => [r * Math.cos((t * Math.PI) / 180), r * Math.sin((t * Math.PI) / 180)];
  const ts = Array.from({ length: k + 1 }, (_, i) => t0 + ((t1 - t0) * i) / k);
  return [...ts.map((t) => at(b, t)), ...ts.reverse().map((t) => at(a, t))];
};

/**
 * A pier `h` tall under an arch's foot, `w` × `d`: courses about 0.45 m tall over a mortar core,
 * the top one `stone2` (the arch's end voussoirs are `stone`).
 */
const pier = (h: number, w: number, d: number): Part[] => {
  const n = Math.max(1, Math.round(h / 0.45));
  return [
    ...(n > 1 ? [{ box: [w - 0.04, h - 0.02, d - 0.04], at: [0, (h - 0.02) / 2, 0], c: 'mortar' } as const] : []),
    ...masonry({ x: [-w / 2, w / 2], ys: levels(0, h, n), d, k: n % 2, len: w, open: { l: true, r: true, b: true, t: true } }),
  ];
};

export const arch = model({
  id: 'arch',
  about: 'Stone arch of voussoirs in two shades over dark mortar; `piers` (m) stands it on two coursed stone piers that tall, 0 puts its feet on y = 0',
  tags: ['stone', 'building'],
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night' },
  // a box round each stone, so the opening stays open to walk through
  collider: 'parts',
  params: { span: [2, 0.8, 5], ring: [0.42, 0.2, 0.8], depth: [0.6, 0.2, 1.5], blocks: [9, 5, 15], piers: [0, 0, 4] },
  parts: (p) => {
    const a = p.span! / 2;
    const b = a + p.ring!;
    const h = p.piers!;
    const n = Math.round(p.blocks!) | 1; // odd, so a keystone sits at the crown
    const step = 180 / n;
    const gap = (0.06 / ((a + b) / 2)) * (180 / Math.PI); // a 6 cm joint: an art pixel at game scale
    const lift = (Math.asin(0.02 / (a + 0.02)) * 180) / Math.PI; // the mortar's ends 2 cm up, inside the end voussoirs, off their bottoms
    return [
      { slab: ringBlock(a + 0.02, b - 0.02, lift, 180 - lift, n * 2), depth: p.depth! - 0.08, at: [0, h, 0], c: 'mortar', name: 'mortar', collide: false },
      ...Array.from({ length: n }, (_, i): Part => {
        const key = i === (n - 1) / 2;
        return {
          slab: ringBlock(key ? a - 0.06 : a, key ? b + 0.08 : b, i * step + (i ? gap / 2 : 0), (i + 1) * step - (i < n - 1 ? gap / 2 : 0)),
          depth: key ? p.depth! + 0.08 : p.depth!,
          at: [0, h, 0],
          c: i % 2 ? 'stone2' : 'stone',
          ...(key ? { name: 'keystone' } : {}),
        };
      }),
      ...(h > 0 ? [{ mirror: [{ name: 'pier', at: [(a + b) / 2, 0, 0], group: pier(h, p.ring! + 0.12, p.depth! + 0.12) }] } as const] : []),
    ];
  },
});

export const brickWall = model({
  id: 'brick-wall',
  about: 'A stretch of brick wall (the bricks texture, 0.5 m courses at the default texel) under a stone coping',
  tags: ['town', 'wall', 'stone', 'textured'],
  palette: { cap: 'mist' },
  params: { length: [2, 0.5, 6], height: [1.5, 0.5, 3] },
  parts: (p) => [
    { box: [p.length!, p.height!, 0.3], at: [0, p.height! / 2, 0], tex: 'bricks', name: 'wall' },
    { box: [p.length! + 0.1, 0.12, 0.42], at: [0, p.height! + 0.06, 0], c: 'cap', name: 'coping' },
  ],
});

export const fountain = model({
  id: 'fountain',
  about: 'Round stone fountain: a basin wall under a dark coping round the pool, a centre column with an upper bowl and a jet; map `water` and `spray`; `r` is the basin\'s radius',
  tags: ['town', 'stone', 'water'],
  palette: { stone: 'mist', trim: 'slate', water: 'blue', spray: 'sky' },
  params: { r: [1.1, 0.8, 1.6] },
  collider: 'cyl',
  parts: (p) => {
    const r = p.r!;
    const n = 4 * Math.max(2, Math.round((2 * Math.PI * r) / 0.6 / 4)); // blocks: a multiple of 4, so the pool's ring isn't stretched
    const t = 0.26; // the wall's thickness
    const tan = Math.tan(Math.PI / n);
    const k = 1 / Math.cos(Math.PI / n); // an n-gon's corner radius over its face's
    const pool = 2 * (r - t) * k + 0.06; // its edge runs into the wall
    return [
      ...around(n, { box: [2 * r * tan - 0.05, 0.5, t], at: [0, 0.25, r - t / 2], c: 'stone' }),
      // the coping: one ring, its faces on the blocks'
      { lathe: [[(r - t - 0.03) * k, 0], [(r + 0.03) * k, 0], [(r + 0.03) * k, 0.08], [(r - t - 0.03) * k, 0.08]], at: [0, 0.5, 0], rot: [0, 180 / n, 0], seg: n, c: 'trim', name: 'coping' },
      { cyl: [pool, 0.05, pool], at: [0, 0.38, 0], rot: [0, 180 / n, 0], seg: n, c: 'water', name: 'pool' },
      { cyl: [0.5, 0.3, 0.5], at: [0, 0.3, 0], seg: 8, c: 'stone' },
      { cyl: [0.26, 0.62, 0.26], at: [0, 0.76, 0], top: 0.8, seg: 8, c: 'stone', name: 'column' },
      { cyl: [0.84, 0.18, 0.84], at: [0, 1.16, 0], top: 2.2, seg: 8, c: 'trim', name: 'bowl' },
      { cyl: [0.72, 0.04, 0.72], at: [0, 1.24, 0], seg: 8, c: 'spray' }, // shallow, so lighter: blue on the slate bowl wouldn't read
      { cyl: [0.14, 0.26, 0.14], at: [0, 1.38, 0], seg: 6, c: 'stone' },
      { cone: [0.2, 0.3, 0.2], at: [0, 1.66, 0], seg: 6, c: 'spray', name: 'jet' },
    ];
  },
});

export const haystack = model({
  id: 'haystack',
  about: 'Beehive haystack bound by a rope, darker loose hay round its foot and a straw tuft on its crown (seeded); `h` is its height',
  tags: ['town', 'farm', 'hay'],
  palette: { hay: 'sand', hay2: 'orange', rope: 'red' },
  params: { h: [1.6, 1, 2.4] },
  collider: 'cyl',
  parts: (p, rng) => {
    const h = p.h!;
    const r = h * 0.5;
    const phase = rng.range(0, 360);
    return [
      { lathe: [[0, 0], [r * 0.9, 0], [r, h * 0.16], [r, h * 0.38], [r * 0.86, h * 0.6], [r * 0.56, h * 0.82], [r * 0.2, h * 0.95], [0, h * 0.97]], seg: 10, c: 'hay', name: 'stack' },
      { torus: [r * 1.96, 0.08, r * 1.96], at: [0, h * 0.42, 0], seg: 10, c: 'rope', name: 'rope' },
      ...around(6, () => ({ lump: [r * 0.66, h * 0.1, r * 0.42], at: [0, h * 0.05, r * 0.92], rot: [0, rng.range(-15, 15), 0], seed: rng.int(1, 999), c: 'hay2' }), { phase }),
      // the tuft: straws splayed out of the crown
      ...around(3, () => ({ cone: [0.16, 0.3, 0.16], at: [0, h * 0.97 + 0.08, 0.06], rot: [rng.range(22, 34), 0, 0], seg: 4, c: 'hay2', name: 'tuft' }), { phase: phase + 30 }),
    ];
  },
});

export const hitchingPost = model({
  id: 'hitching-post',
  about: 'Hitching rail: a round log rail on two square posts, iron tie rings hanging from it; `length` along x',
  tags: ['town', 'wood', 'farm'],
  palette: { post: 'red', rail: 'orange', iron: 'mist' },
  params: { length: [2, 1.2, 3] },
  parts: (p) => {
    const L = p.length!;
    return [
      { mirror: [{ box: [0.16, 1.0, 0.16], at: [L / 2 - 0.2, 0.5, 0], c: 'post' }] },
      // knee braces from each post in under the rail
      { mirror: [{ box: [0.08, 0.34, 0.08], at: [L / 2 - 0.36, 0.88, 0], rot: [0, 0, 45], c: 'post' }] },
      { cyl: [0.15, L, 0.15], at: [0, 1.065, 0], rot: [0, 0, 90], seg: 6, c: 'rail', name: 'rail' },
      { mirror: [{ torus: [0.24, 0.06, 0.24], at: [L * 0.12, 0.93, 0.08], rot: [90, 0, 0], seg: 8, c: 'iron', name: 'ring' }] },
    ];
  },
});

/** Fruit colours: a crate holds mostly one, with a few of another. */
const FRUIT = ['fruit', 'fruit2', 'fruit3'];

export const produceCrate = model({
  id: 'produce-crate',
  about: 'Market display: an open crate of fruit tipped toward the buyer on a four-legged stand, mostly one kind with a few of another (seeded); map `fruit`, `fruit2`, `fruit3`',
  tags: ['town', 'market', 'food', 'wood'],
  palette: { wood: 'orange', frame: 'plum', bed: 'night', fruit: 'red', fruit2: 'lime', fruit3: 'sand' },
  parts: (_, rng) => {
    const tilt = 25; // degrees, the front down
    const y0 = 0.42; // the crate's bottom, under its middle
    const under = (z: number) => y0 - z * Math.tan((tilt * Math.PI) / 180); // the bottom's height over z
    const main = rng.int(0, 2);
    const other = (main + rng.int(1, 2)) % 3;
    const odd = new Set(Array.from({ length: rng.int(2, 4) }, () => rng.int(0, 11))); // which of the 12 are the other kind
    const fruit: Part[] = [];
    for (let iz = 0; iz < 3; iz++) {
      for (let ix = 0; ix < 4; ix++) {
        const k = rng.range(0.14, 0.16);
        const heap = iz === 1 ? 0.02 : 0;
        const c = FRUIT[odd.has(iz * 4 + ix) ? other : main]!;
        fruit.push({ ball: [k, k * 0.9, k], at: [-0.235 + ix * 0.157 + rng.range(-0.01, 0.01), 0.2 + heap, -0.135 + iz * 0.135 + rng.range(-0.01, 0.01)], seg: 6, c });
      }
    }
    return [
      { mirror: [{ box: [0.07, under(0.19) + 0.02, 0.07], at: [0.3, (under(0.19) + 0.02) / 2, 0.19], c: 'frame' }] },
      { mirror: [{ box: [0.07, under(-0.19) + 0.02, 0.07], at: [0.3, (under(-0.19) + 0.02) / 2, -0.19], c: 'frame' }] },
      { mirror: [{ box: [0.07, 0.06, 0.38], at: [0.3, 0.14, 0], c: 'frame' }] },
      {
        name: 'crate',
        at: [0, y0, 0],
        rot: [tilt, 0, 0],
        group: [
          { box: [0.72, 0.04, 0.5], at: [0, 0.02, 0], c: 'wood' },
          { mirror: [{ box: [0.72, 0.2, 0.04], at: [0, 0.12, 0.23], c: 'wood' }], axis: 'z' },
          { mirror: [{ box: [0.04, 0.2, 0.42], at: [0.34, 0.12, 0], c: 'wood' }] },
          { mirror: [{ mirror: [{ box: [0.07, 0.25, 0.07], at: [0.335, 0.115, 0.225], c: 'frame' }], axis: 'z' }] },
          { box: [0.64, 0.12, 0.42], at: [0, 0.1, 0], c: 'bed' },
          ...fruit,
        ],
      },
    ];
  },
});

/**
 * A park bench's cast-iron end from the side (x toward the front, y up): two splayed legs, the
 * seat rail, the armrest on its post, and the back's upright leaning back.
 */
const BENCH_END =
  'M 0.17 0 L 0.25 0 L 0.24 0.42 L 0.16 0.42 Z M -0.25 0 L -0.17 0 L -0.12 0.42 L -0.2 0.42 Z M -0.22 0.36 L 0.25 0.36 L 0.25 0.42 L -0.22 0.42 Z ' +
  'M -0.2 0.36 L -0.12 0.36 L -0.24 0.88 L -0.32 0.88 Z M -0.22 0.6 L 0.27 0.6 L 0.27 0.66 L -0.22 0.66 Z M 0.17 0.42 L 0.23 0.42 L 0.23 0.6 L 0.17 0.6 Z';
/** The back's lean (degrees): the upright's slope. */
const BACK = (Math.atan2(0.12, 0.52) * 180) / Math.PI;

export const parkBench = model({
  id: 'park-bench',
  about: 'Park bench: wooden slats on two cast-iron ends with armrests, seat at 0.45 m, the back leaning; `length` along x',
  tags: ['town', 'bench', 'iron', 'wood'],
  palette: { iron: 'night', wood: 'orange', wood2: 'red' },
  params: { length: [1.6, 1, 2.4] },
  anchors: { seat: [0, 0.46, 0.03] },
  parts: (p) => {
    const L = p.length!;
    // the back slats lie on the uprights' front face, which runs from z = -0.12 at y = 0.36 back 0.12 per 0.52 up
    const back = (y: number): Part => ({ box: [L, 0.09, 0.04], at: [0, y, -0.12 - (0.12 * (y - 0.36)) / 0.52 + 0.02], rot: [-BACK, 0, 0], c: 'wood2' });
    return [
      { mirror: [{ slab: BENCH_END, depth: 0.06, at: [L / 2 - 0.12, 0, 0], rot: [0, -90, 0], c: 'iron' }] },
      ...[0.2, 0.08, -0.04, -0.16].map((z): Part => ({ box: [L, 0.04, 0.09], at: [0, 0.435, z], c: 'wood' })),
      back(0.56),
      back(0.68),
      back(0.8),
    ];
  },
});

/** Cloth colours, cycled so neighbours never match. */
const CLOTHS = ['cloth', 'cloth2', 'cloth3', 'cloth4'];
/** A shirt hung by its shoulders: an XY outline, the top edge at y = 0. */
const SHIRT: [number, number][] = [[-0.3, 0], [0.3, 0], [0.3, -0.17], [0.17, -0.17], [0.17, -0.52], [-0.17, -0.52], [-0.17, -0.17], [-0.3, -0.17]];

export const clothesline = model({
  id: 'clothesline',
  about: 'Clothesline: a sagging rope between two T-posts hung with seeded sheets, towels and shirts in four colours; `length` along x',
  tags: ['town', 'cloth', 'yard'],
  palette: { post: 'orange', bar: 'red', rope: 'mist', cloth: 'white', cloth2: 'blue', cloth3: 'red', cloth4: 'sand' },
  params: { length: [3, 2, 5] },
  parts: (p, rng) => {
    const L = p.length!;
    const top = 1.82;
    const sag = 0.05 * L;
    const lineY = (x: number) => top - sag * (1 - ((2 * x) / L) ** 2);
    const slope = (x: number) => (Math.atan((sag * 8 * x) / (L * L)) * 180) / Math.PI;
    const out: Part[] = [
      { mirror: [{ box: [0.12, 2.0, 0.12], at: [L / 2, 1.0, 0], c: 'post' }] },
      { mirror: [{ box: [0.1, 0.1, 0.5], at: [L / 2, 1.9, 0], c: 'bar' }] },
      { tube: Array.from({ length: 9 }, (_, i) => [-L / 2 + (L * i) / 8, lineY(-L / 2 + (L * i) / 8), 0] as const), r: 0.03, seg: 4, c: 'rope', name: 'rope' },
    ];
    let x = -L / 2 + 0.22 + rng.range(0, 0.1);
    let colour = rng.int(0, 3);
    const end = L / 2 - 0.16;
    while (end - x >= 0.28) {
      // a shirt, a towel or a sheet; a towel where nothing wider fits
      const kind = end - x < 0.7 ? 0.4 : rng.next();
      const w = kind < 0.3 ? 0.6 : kind < 0.55 ? rng.range(0.28, Math.min(0.38, end - x)) : rng.range(0.46, 0.7);
      const cx = x + w / 2;
      const c = CLOTHS[(colour = (colour + rng.int(1, 3)) % 4)]!;
      const at: [number, number, number] = [cx, lineY(cx) + 0.025, 0];
      if (kind < 0.3) out.push({ slab: SHIRT, depth: 0.03, at, rot: [0, 0, slope(cx)], c, name: 'shirt' });
      else {
        const h = kind < 0.55 ? rng.range(0.34, 0.46) : rng.range(0.5, 0.78);
        out.push({ at, rot: [0, 0, slope(cx)], group: [{ box: [w, h, 0.03], at: [0, -h / 2, 0], c }] });
      }
      x += w + rng.range(0.08, 0.2);
    }
    return out;
  },
});

export const planter = model({
  id: 'planter',
  about: 'Wooden flower box: board sides between dark corner posts under a rim, soil and leaves, seeded blossoms in `a`, `b`, `c`; `length` along x',
  tags: ['town', 'plant', 'flower', 'wood'],
  palette: { wood: 'orange', frame: 'plum', soil: 'night', leaf: 'green', a: 'red', b: 'sand', c: 'sky' },
  params: { length: [1, 0.6, 1.8] },
  parts: (p, rng) => {
    const L = p.length!;
    const D = 0.4;
    const leaves = Math.max(2, Math.round(L / 0.4));
    const n = Math.max(4, Math.round(L / 0.15));
    let colour = rng.int(0, 2);
    return [
      { mirror: [{ mirror: [{ box: [0.08, 0.38, 0.08], at: [L / 2 - 0.04, 0.19, D / 2 - 0.04], c: 'frame' }], axis: 'z' }] },
      { mirror: [{ box: [L - 0.1, 0.3, 0.05], at: [0, 0.2, D / 2 - 0.035], c: 'wood' }], axis: 'z' },
      { mirror: [{ box: [0.05, 0.3, D - 0.1], at: [L / 2 - 0.035, 0.2, 0], c: 'wood' }] },
      { mirror: [{ box: [L + 0.02, 0.05, 0.07], at: [0, 0.405, D / 2 - 0.025], c: 'frame' }], axis: 'z' },
      { mirror: [{ box: [0.07, 0.05, D - 0.06], at: [L / 2 - 0.025, 0.405, 0], c: 'frame' }] },
      { box: [L - 0.1, 0.04, D - 0.1], at: [0, 0.37, 0], c: 'soil', name: 'soil' },
      // leaves clear of the boards, so green never touches the wood
      ...Array.from({ length: leaves }, (_, i): Part => ({ lump: [(L - 0.2) / leaves + 0.04, 0.14, 0.24], at: [-L / 2 + 0.1 + ((L - 0.2) * (i + 0.5)) / leaves, 0.42, 0], seed: rng.int(1, 999), c: 'leaf' })),
      ...Array.from({ length: n }, (_, i): Part => {
        const h = rng.range(0.12, 0.24);
        const k = rng.range(0.18, 0.21);
        colour = (colour + rng.int(1, 2)) % 3;
        return {
          at: [-L / 2 + 0.1 + ((L - 0.2) * (i + 0.5)) / n + rng.range(-0.02, 0.02), 0.39, i % 2 ? -0.07 : 0.07],
          group: [
            { box: [0.06, h, 0.06], at: [0, h / 2, 0], c: 'leaf' },
            { ball: [k, k * 0.5, k], at: [0, h + k * 0.15, 0], seg: 6, c: ['a', 'b', 'c'][colour]! },
          ],
        };
      }),
    ];
  },
});

export const waterTrough = model({
  id: 'water-trough',
  about: 'Wooden water trough: two-plank sides held by iron bands between thick end boards, on two skids, full of water; map `water`; `length` along x',
  tags: ['town', 'farm', 'water', 'wood'],
  palette: { wood: 'orange', wood2: 'red', frame: 'plum', iron: 'night', water: 'blue' },
  params: { length: [1.6, 1, 2.4] },
  parts: (p) => {
    const L = p.length!;
    return [
      { mirror: [{ box: [0.12, 0.1, 0.72], at: [L / 2 - 0.24, 0.05, 0], c: 'frame' }] },
      { box: [L - 0.1, 0.06, 0.5], at: [0, 0.13, 0], c: 'wood2' },
      { mirror: [{ box: [L - 0.08, 0.21, 0.06], at: [0, 0.265, 0.25], c: 'wood2' }], axis: 'z' },
      { mirror: [{ box: [L - 0.08, 0.22, 0.06], at: [0, 0.48, 0.25], c: 'wood' }], axis: 'z' },
      { mirror: [{ box: [0.08, 0.54, 0.64], at: [L / 2 - 0.04, 0.35, 0], c: 'frame', name: 'end' }] },
      { box: [L - 0.14, 0.04, 0.46], at: [0, 0.5, 0], c: 'water', name: 'water' },
      { mirror: [{ mirror: [{ box: [0.07, 0.46, 0.03], at: [L * 0.22, 0.37, 0.29], c: 'iron' }], axis: 'z' }] },
    ];
  },
});

export const TOWN = [statue, well, marketStall, arch, brickWall, fountain, haystack, hitchingPost, produceCrate, parkBench, clothesline, planter, waterTrough];
