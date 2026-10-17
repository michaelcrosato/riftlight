import { model } from '../..';
import type { Part } from '../../types';

/** Wheel radius (m) and where the axle runs (along X). */
const R = 0.5;
const AXLE_Z = -0.15;
/** The bed: floor top, its length and where it is centred along Z. */
const FLOOR_Y = 0.7;
const BED_L = 1.3;
const BED_Z = -0.1;
const BED_W = 0.96;

/** A spoked wheel, axle along X: an iron tyre round a wooden felloe, six spokes, an iron hub. */
const wheel = (x: number): Part => ({
  name: x > 0 ? 'wheel-r' : 'wheel-l',
  at: [x, R, AXLE_Z],
  rot: [0, 0, 90],
  group: [
    { torus: [2 * R, 0.08, 2 * R], seg: 14, c: 'tyre', name: 'tyre' },
    { torus: [2 * R - 0.1, 0.1, 2 * R - 0.1], seg: 14, c: 'felloe' },
    ...[0, 60, 120].map((a): Part => ({ box: [0.07, 0.06, 2 * R - 0.14], rot: [0, a, 0], c: 'spoke' })),
    { cyl: [0.2, 0.16, 0.2], seg: 8, c: 'hub', name: 'hub' },
  ],
});

export default model({
  id: 'hand-cart',
  about: 'Two-wheeled hand cart: a slatted plank bed between two big spoked wheels, long shafts running out front (+Z) to a grip bar, a prop stand under them',
  tags: ['props', 'transport', 'wood', 'town'],
  palette: { floor: 'red', board: 'orange', cap: 'sand', stake: 'plum', tyre: 'night', felloe: 'sand', spoke: 'sand', hub: 'slate' },
  anchors: { handle: [0, 0.62, 1.42] },
  parts: [
    // running gear
    wheel(0.6),
    wheel(-0.6),
    { cyl: [0.08, 1.3, 0.08], at: [0, R, AXLE_Z], rot: [0, 0, 90], seg: 6, c: 'hub', name: 'axle' },
    { mirror: [{ box: [0.1, 0.1, 0.16], at: [0.3, 0.57, AXLE_Z], c: 'stake' }] },
    // two shafts under the bed that run out front into the handles, a grip bar across their ends
    { mirror: [{ box: [0.08, 0.08, 2.3], at: [0.3, 0.63, 0.35], c: 'board', name: 'shaft' }] },
    { cyl: [0.07, 0.78, 0.07], at: [0, 0.63, 1.44], rot: [0, 0, 90], seg: 6, c: 'cap', name: 'grip' },
    // the prop stand: two legs and a cross bar
    { mirror: [{ box: [0.07, 0.6, 0.07], at: [0.3, 0.3, 0.62], c: 'stake', name: 'leg' }] },
    { box: [0.54, 0.06, 0.06], at: [0, 0.2, 0.62], c: 'stake' },
    // the bed: floor, two boards a side with a gap, end boards, caps and corner stakes
    {
      name: 'bed',
      at: [0, 0, BED_Z],
      group: [
        { box: [BED_W, 0.06, BED_L], at: [0, FLOOR_Y - 0.03, 0], c: 'floor', name: 'floor' },
        { mirror: [{ box: [0.05, 0.14, BED_L], at: [BED_W / 2 - 0.025, FLOOR_Y + 0.07, 0], c: 'board' }] },
        { mirror: [{ box: [0.05, 0.14, BED_L], at: [BED_W / 2 - 0.025, FLOOR_Y + 0.25, 0], c: 'board' }] },
        { mirror: [{ box: [BED_W - 0.1, 0.14, 0.05], at: [0, FLOOR_Y + 0.07, BED_L / 2 - 0.025], c: 'board' }], axis: 'z' },
        { mirror: [{ box: [BED_W - 0.1, 0.14, 0.05], at: [0, FLOOR_Y + 0.25, BED_L / 2 - 0.025], c: 'board' }], axis: 'z' },
        { mirror: [{ box: [0.08, 0.05, BED_L + 0.06], at: [BED_W / 2 - 0.025, FLOOR_Y + 0.345, 0], c: 'cap' }] },
        { mirror: [{ box: [BED_W + 0.03, 0.05, 0.08], at: [0, FLOOR_Y + 0.345, BED_L / 2 - 0.025], c: 'cap' }], axis: 'z' },
        // the joints between the floor's planks: dark strips sunk into the floor, 4 mm proud of it
        ...[-0.24, 0, 0.24].map((x): Part => ({ box: [0.06, 0.06, BED_L - 0.1], at: [x, FLOOR_Y - 0.026, 0], c: 'stake' })),
        // stakes from under the floor to just above the caps
        { mirror: [{ mirror: [{ box: [0.07, 0.52, 0.07], at: [BED_W / 2 + 0.01, 0.86, BED_L / 2 - 0.04], c: 'stake', name: 'stake' }], axis: 'z' }] },
        { mirror: [{ box: [0.07, 0.52, 0.07], at: [BED_W / 2 + 0.01, 0.86, 0], c: 'stake' }] },
      ],
    },
  ],
});
