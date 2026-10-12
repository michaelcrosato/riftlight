import { around, model } from '../helpers';
import type { Part, Vec3 } from '../types';

/**
 * A rounded lid's cross-section as an XY outline: a straight lip `lip` tall, then an arc of
 * sagitta `s` over the chord `2c`, in `k` steps, from y = `y0`.
 */
const archOutline = (c: number, s: number, lip: number, k = 6, y0 = 0): [number, number][] => {
  const r = (c * c + s * s) / (2 * s);
  const a = Math.asin(c / r);
  const arc = Array.from({ length: k + 1 }, (_, i): [number, number] => {
    const t = -a + (2 * a * i) / k;
    return [r * Math.sin(t), lip + s - r + r * Math.cos(t)];
  });
  return [[-c, y0], ...arc, [c, y0]];
};

export const chest = model({
  id: 'chest',
  about: 'Treasure chest: iron bands, a gold lock plate, a rounded lid on the pivot `lid` hinged at the back; `open` lifts it on a heap of gold',
  tags: ['dungeon', 'wood'],
  palette: { wood: 'orange', iron: 'night', gold: 'sand' },
  params: { open: [0, 0, 110] },
  parts: (p) => [
    { box: [0.86, 0.42, 0.56], at: [0, 0.21, 0], c: 'wood' },
    { box: [0.88, 0.06, 0.58], at: [0, 0.385, 0], c: 'iron' },
    { mirror: [{ box: [0.08, 0.418, 0.6], at: [0.27, 0.209, 0], c: 'iron' }] },
    { box: [0.18, 0.18, 0.03], at: [0, 0.32, 0.295], c: 'gold' },
    { ball: [0.7, 0.12, 0.42], at: [0, 0.475, 0], half: true, c: 'gold' },
    {
      name: 'lid',
      pivot: true,
      at: [0, 0.42, -0.28],
      rot: [-p.open!, 0, 0],
      group: [
        { slab: archOutline(0.29, 0.18, 0.04), depth: 0.9, at: [0, 0, 0.28], rot: [0, 90, 0], c: 'wood' },
        { mirror: [{ slab: archOutline(0.31, 0.19, 0.04, 6, 0.004), depth: 0.08, at: [0.27, 0, 0.28], rot: [0, 90, 0], c: 'iron' }] },
        { box: [0.1, 0.12, 0.03], at: [0, 0, 0.585], c: 'gold' },
      ],
    },
  ],
});

/** One long bone on the floor along X: a shaft and two darker knobs. */
const bone = (len: number): Part[] => [
  { cyl: [0.1, len, 0.1], rot: [0, 0, 90], at: [0, 0.065, 0], seg: 6, c: 'bone' },
  { mirror: [{ ball: [0.16, 0.13, 0.16], at: [len / 2, 0.065, 0], c: 'joint' }] },
];

export const bones = model({
  id: 'bones',
  about: 'Scatter of long bones round a skull on the floor, seeded; `n` bones over a `spread` metres wide',
  tags: ['dungeon', 'bone'],
  palette: { bone: 'white', joint: 'sand', socket: 'ink' },
  params: { n: [6, 2, 9], spread: [1.2, 0.8, 1.8] },
  parts: (p, rng) => {
    const out: Part[] = [];
    const s = p.spread! / 2;
    const skull: Vec3 = [rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)];
    out.push({
      name: 'skull',
      at: skull,
      rot: [0, rng.range(15, 75), 0],
      group: [
        { ball: [0.3, 0.26, 0.32], at: [0, 0.16, -0.01], seg: 8, c: 'bone' },
        { box: [0.18, 0.1, 0.13], at: [0, 0.05, 0.09], c: 'joint' },
        { mirror: [{ box: [0.08, 0.075, 0.03], at: [0.065, 0.16, 0.135], c: 'socket' }] },
      ],
    });
    const placed: [number, number][] = [[skull[0], skull[2]]];
    for (let i = 0; i < Math.round(p.n!); i++) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 12; tries++) {
        x = rng.range(-s, s);
        z = rng.range(-s, s);
        if (placed.every(([px, pz]) => Math.hypot(x - px, z - pz) > 0.3)) break;
      }
      placed.push([x, z]);
      out.push({ at: [x, 0, z], rot: [0, rng.range(0, 180), 0], group: bone(rng.range(0.34, 0.5)) });
    }
    return out;
  },
});

export const cage = model({
  id: 'cage',
  about: 'Standing round iron cage: bars on a base, two hoops, a domed top with a ring, a gold padlock',
  tags: ['dungeon', 'iron'],
  palette: { iron: 'slate', bar: 'night', lock: 'sand' },
  anchors: { hang: [0, 2.19, 0] },
  parts: [
    { cyl: [1.2, 0.1, 1.2], at: [0, 0.05, 0], seg: 8, rot: [0, 22.5, 0], c: 'iron' },
    ...around(8, { cyl: [0.1, 1.5, 0.1], at: [0, 0.85, 0.47], seg: 4, rot: [0, 45, 0], c: 'bar' }),
    { torus: [1.08, 0.1, 1.08], at: [0, 0.85, 0], seg: 8, rot: [0, 22.5, 0], c: 'iron' },
    { torus: [1.08, 0.1, 1.08], at: [0, 1.6, 0], seg: 8, rot: [0, 22.5, 0], c: 'iron' },
    ...around(4, {
      tube: [[0, 1.6, 0.47], [0, 1.82, 0.38], [0, 1.96, 0.2], [0, 2.0, 0], [0, 1.96, -0.2], [0, 1.82, -0.38], [0, 1.6, -0.47]],
      r: 0.05,
      seg: 4,
      c: 'bar',
    }),
    { ball: [0.18, 0.14, 0.18], at: [0, 2.04, 0], c: 'iron' },
    { torus: [0.22, 0.07, 0.22], at: [0, 2.17, 0], rot: [90, 0, 0], seg: 6, c: 'iron' },
    { group: [{ box: [0.15, 0.17, 0.07], at: [0, 0.72, 0.555], c: 'lock' }], rot: [0, 45, 0] },
  ],
});

/** A coffin's outline in the floor plane (x, z), head at −Z, grown by `k` metres all round. */
const coffinOutline = (k = 0): [number, number][] => [
  [-0.2 - k, -0.95 - k],
  [0.2 + k, -0.95 - k],
  [0.33 + k, -0.5],
  [0.19 + k, 0.95 + k],
  [-0.19 - k, 0.95 + k],
  [-0.33 - k, -0.5],
];

export const coffin = model({
  id: 'coffin',
  about: 'Wooden coffin on the floor, head at -Z: a red body on a lighter plinth, a lighter lid on the pivot `lid`, iron handles',
  tags: ['dungeon', 'wood'],
  palette: { wood: 'red', lid: 'orange', iron: 'night' },
  parts: [
    { slab: coffinOutline(0.02), depth: 0.06, at: [0, 0.03, 0], rot: [90, 0, 0], c: 'lid' },
    { slab: coffinOutline(), depth: 0.38, at: [0, 0.19, 0], rot: [90, 0, 0], c: 'wood' },
    {
      name: 'lid',
      pivot: true,
      at: [0, 0.38, 0],
      group: [
        { slab: coffinOutline(0.03), depth: 0.07, at: [0, 0.035, 0], rot: [90, 0, 0], c: 'lid' },
        { slab: coffinOutline(-0.08), depth: 0.04, at: [0, 0.08, 0], rot: [90, 0, 0], c: 'wood' },
      ],
    },
    {
      mirror: [
        { box: [0.06, 0.07, 0.2], at: [0.335, 0.22, -0.3], rot: [0, -5, 0], c: 'iron' },
        { box: [0.06, 0.07, 0.2], at: [0.29, 0.22, 0.4], rot: [0, -5, 0], c: 'iron' },
      ],
    },
  ],
});

export const banner = model({
  id: 'banner',
  about: 'Wall banner on an iron pole, its back on a wall at z = 0: a pointed `cloth` (map it) with a gold trim and emblem',
  tags: ['dungeon', 'cloth'],
  palette: { cloth: 'red', trim: 'sand', pole: 'night' },
  params: { w: [0.8, 0.5, 1.2], h: [1.4, 0.8, 2] },
  floats: true,
  anchors: { wall: [0, 2.5, 0] },
  parts: (p) => {
    const w = p.w! / 2;
    const h = p.h!;
    const point = Math.min(0.3, w * 0.6);
    const cloth = (k: number): [number, number][] => [
      [-w - k, 0],
      [w + k, 0],
      [w + k, -h + point],
      [0, -h - k * 1.6],
      [-w - k, -h + point],
    ];
    return [
      { mirror: [{ box: [0.08, 0.08, 0.1], at: [w - 0.06, 2.5, 0.05], c: 'pole' }] },
      { cyl: [0.08, p.w! + 0.24, 0.08], at: [0, 2.5, 0.12], rot: [0, 0, 90], seg: 6, c: 'pole' },
      { mirror: [{ ball: [0.13, 0.13, 0.13], at: [w + 0.17, 2.5, 0.12], c: 'trim' }] },
      {
        at: [0, 2.48, 0],
        group: [
          { slab: cloth(0.05), depth: 0.03, at: [0, 0, 0.035], c: 'trim' },
          { slab: cloth(0), depth: 0.03, at: [0, -0.01, 0.06], c: 'cloth' },
          { slab: [[0, 0.2], [0.16, 0], [0, -0.2], [-0.16, 0]], depth: 0.02, at: [0, -h * 0.42, 0.08], c: 'trim' },
          { box: [p.w! + 0.06, 0.08, 0.02], at: [0, -0.22, 0.08], c: 'trim' },
        ],
      },
    ];
  },
});

export const spikes = model({
  id: 'spikes',
  about: 'Floor spike trap: an iron plate with `n` steel spikes in dark holes, the spikes on the pivot `spikes` to raise and lower',
  tags: ['dungeon', 'iron'],
  palette: { plate: 'night', rim: 'slate', hole: 'ink', spike: 'mist' },
  params: { n: [9, 4, 9], h: [0.4, 0.2, 0.55] },
  parts: (p) => {
    const n = Math.round(p.n!);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const step = 0.28;
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - r * cols);
      for (let c = 0; c < inRow; c++) cells.push([(c - (inRow - 1) / 2) * step, (r - (rows - 1) / 2) * step]);
    }
    return [
      { box: [1.0, 0.06, 1.0], at: [0, 0.03, 0], c: 'rim' },
      { box: [0.88, 0.09, 0.88], at: [0, 0.045, 0], c: 'plate' },
      ...cells.map(([x, z]): Part => ({ cyl: [0.25, 0.012, 0.25], at: [x, 0.096, z], seg: 8, c: 'hole' })),
      {
        name: 'spikes',
        pivot: true,
        group: cells.map(([x, z]): Part => ({ cone: [0.2, p.h!, 0.2], at: [x, 0.094 + p.h! / 2, z], rot: [0, 45, 0], seg: 4, c: 'spike' })),
      },
    ];
  },
});

export const DUNGEON = [chest, bones, cage, coffin, banner, spikes];
