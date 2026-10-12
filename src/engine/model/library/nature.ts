import { around, model } from '../helpers';

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

export const NATURE = [rock, stoneRing];
