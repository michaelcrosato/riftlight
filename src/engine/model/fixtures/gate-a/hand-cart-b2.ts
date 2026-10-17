import { around, model } from '../..';

const R = 0.5; // wheel radius: the axle height
const AXLE_Z = -0.5; // under the middle of the bed

/** One spoked wheel, axis along X: an iron tyre over a wooden felloe, six spokes and a hub. */
const wheel = (x: number) => ({
  name: x > 0 ? 'wheel-r' : 'wheel-l',
  at: [x, R, AXLE_Z] as const,
  rot: [0, 0, 90] as const,
  group: [
    { torus: [2 * R, 0.1, 2 * R] as const, seg: 14, c: 'iron' },
    { torus: [2 * R - 0.14, 0.12, 2 * R - 0.14] as const, seg: 14, c: 'wood' },
    ...around(6, { box: [0.07, 0.08, R - 0.1] as const, at: [0, 0, (R - 0.1) / 2] as const, c: 'spoke' }),
    { cyl: [0.22, 0.18, 0.22] as const, seg: 8, c: 'hub' },
  ],
});

export default model({
  id: 'hand-cart',
  about: 'Two-wheeled wooden hand cart: plank bed, big spoked iron-tyred wheels, long pull handles with a grip bar, prop legs',
  tags: ['town', 'wood', 'vehicle'],
  palette: { wood: 'orange', floor: 'red', rail: 'sand', iron: 'night', spoke: 'sand', hub: 'slate' },
  size: [1.5, 1.04, 2.31],
  parts: [
    // under-frame: two long beams that run forward into the handles
    { mirror: [{ box: [0.1, 0.1, 2.25], at: [0.38, 0.58, 0.02], c: 'floor', name: 'beam' }] },
    // axle
    { cyl: [0.1, 1.44, 0.1], at: [0, R, AXLE_Z], rot: [0, 0, 90], seg: 6, c: 'hub' },
    // bed floor
    { box: [1.0, 0.06, 1.2], at: [0, 0.66, AXLE_Z], c: 'floor', name: 'floor' },
    // side boards
    { mirror: [{ box: [0.08, 0.3, 1.2], at: [0.5, 0.84, AXLE_Z], c: 'wood' }] },
    // front and back boards
    { at: [0, 0, AXLE_Z], group: [{ mirror: [{ box: [0.92, 0.3, 0.08], at: [0, 0.84, 0.56], c: 'wood' }], axis: 'z' }] },
    // stakes on the outside of the side boards
    { at: [0, 0, AXLE_Z], group: [{ mirror: [{ mirror: [{ box: [0.06, 0.4, 0.08], at: [0.57, 0.82, 0.42], c: 'floor' }], axis: 'z' }] }] },
    // top rails
    { mirror: [{ box: [0.12, 0.06, 1.28], at: [0.5, 1.01, AXLE_Z], c: 'rail' }] },
    { at: [0, 0, AXLE_Z], group: [{ mirror: [{ box: [1.12, 0.06, 0.12], at: [0, 1.01, 0.6], c: 'rail' }], axis: 'z' }] },
    // handle grip crossbar
    { box: [0.94, 0.08, 0.08], at: [0, 0.58, 1.08], c: 'rail', name: 'grip' },
    // prop legs under the front board
    { mirror: [{ box: [0.08, 0.53, 0.08], at: [0.38, 0.265, 0.05], c: 'floor' }] },
    // wheels
    wheel(0.66),
    wheel(-0.66),
  ],
});
