import { model } from '../helpers';

export const greatsword = model({
  id: 'greatsword',
  about: 'Two-handed sword, gold guard, purple grip',
  tags: ['weapon', 'sword'],
  palette: { steel: 'mist', edge: 'white', gold: 'sand', grip: 'plum' },
  parts: [
    {
      at: [0, 0.06, 0],
      group: [
        { slab: [[-0.06, 0], [0.06, 0], [0.06, 1.0], [0, 1.14], [-0.06, 1.0]], depth: 0.035, at: [0, 0.3, 0], c: 'steel' },
        { slab: [[-0.015, 0.05], [0.015, 0.05], [0.015, 0.9], [-0.015, 0.9]], depth: 0.04, at: [0, 0.3, 0], c: 'edge' },
        { box: [0.34, 0.06, 0.08], at: [0, 0.28, 0], c: 'gold' },
        { mirror: [{ ball: [0.07, 0.07, 0.07], at: [0.18, 0.28, 0], c: 'gold' }] },
        { cyl: [0.06, 0.22, 0.06], at: [0, 0.14, 0], seg: 6, c: 'grip' },
        { ball: [0.08, 0.08, 0.08], at: [0, 0.01, 0], c: 'gold' },
      ],
    },
  ],
});

export const WEAPONS = [greatsword];
