import { around, model, rowOf } from '../..';

/** One spoked wheel (0.9 m), axle along X, centred on its hub. */
const wheel = (x: number) => ({
  name: x > 0 ? 'wheel-r' : 'wheel-l',
  at: [x, 0.45, 0] as const,
  rot: [0, 0, 90] as const,
  group: [
    { torus: [0.9, 0.06, 0.9] as const, seg: 14, c: 'iron' },
    { torus: [0.84, 0.08, 0.84] as const, seg: 14, c: 'wood' },
    ...around(6, { box: [0.07, 0.06, 0.3] as const, at: [0, 0, 0.2] as const, c: 'wood' }),
    { cyl: [0.16, 0.18, 0.16] as const, seg: 8, c: 'iron' },
  ],
});

export default model({
  id: 'hand-cart',
  about: 'Two-wheeled wooden hand cart with spoked wheels, plank sides and pull shafts',
  tags: ['cart', 'wood', 'town', 'vehicle'],
  palette: { wood: 'orange', dark: 'red', iron: 'night' },
  size: [1.24, 0.95, 2.0],
  parts: [
    // running gear
    wheel(0.55),
    wheel(-0.55),
    { cyl: [0.06, 1.24, 0.06], at: [0, 0.45, 0], rot: [0, 0, 90], seg: 6, c: 'iron', name: 'axle' },
    { box: [0.86, 0.08, 0.14], at: [0, 0.5, 0], c: 'dark', name: 'bolster' },
    // shafts: the frame under the bed, running forward into the pull handle
    { mirror: [{ box: [0.07, 0.08, 2.0], at: [0.39, 0.54, 0.25], c: 'dark' }] },
    { cyl: [0.06, 0.84, 0.06], at: [0, 0.54, 1.21], rot: [0, 0, 90], seg: 6, c: 'wood', name: 'grip' },
    // rest legs under the front of the bed
    { mirror: [{ box: [0.06, 0.54, 0.06], at: [0.39, 0.27, 0.62], c: 'dark' }] },
    // bed
    { box: [0.84, 0.05, 1.26], at: [0, 0.6, -0.05], c: 'wood', name: 'floor' },
    { mirror: [{ box: [0.04, 0.31, 1.32], at: [0.435, 0.735, -0.05], c: 'wood' }] },
    { box: [0.8, 0.2, 0.04], at: [0, 0.72, 0.57], c: 'wood', name: 'front-board' },
    { box: [0.8, 0.27, 0.04], at: [0, 0.75, -0.665], c: 'wood', name: 'tailboard' },
    { mirror: [{ box: [0.07, 0.05, 1.38], at: [0.44, 0.905, -0.05], c: 'dark' }] },
    { mirror: rowOf(3, [0, 0, 0.61], () => ({ box: [0.06, 0.38, 0.06], at: [0.475, 0.75, -0.66], c: 'dark' })) },
  ],
});
