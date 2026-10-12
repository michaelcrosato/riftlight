import { around, model, rowOf } from '../helpers';

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
    { mirror: [{ box: [0.11, 0.4, 0.12], at: [0.2, 1.2, 0.12], rot: [-38, 0, 12], c: 'stone' }] },
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

export const TOWN = [statue, well, marketStall];
