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

export const TOWN = [statue, well, marketStall, arch, brickWall];
