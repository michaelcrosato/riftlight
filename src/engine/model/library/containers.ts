import { boxFrame, model } from '../helpers';

export const barrel = model({
  id: 'barrel',
  about: 'Wooden barrel with three iron hoops',
  tags: ['container', 'wood'],
  palette: { wood: 'orange', band: 'slate', lid: 'red' },
  parts: [
    { lathe: [[0, 0], [0.27, 0], [0.32, 0.2], [0.34, 0.4], [0.32, 0.6], [0.27, 0.8], [0, 0.8]], seg: 10, c: 'wood' },
    { torus: [0.65, 0.05, 0.65], at: [0, 0.1, 0], c: 'band' },
    { torus: [0.65, 0.05, 0.65], at: [0, 0.7, 0], c: 'band' },
    { torus: [0.73, 0.044, 0.73], at: [0, 0.4, 0], c: 'band' },
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

export const CONTAINERS = [barrel, crate];
