import { model, type Part } from '../../../src/engine/model';

/**
 * Emberfall's market stall (src/riftlight/town/Town.ts, `town:market`) traced in primitives. The
 * trace's frame centres the footprint, so everything sits in a group shifted to the stall's own
 * origin (x -0.031, z -0.019) and the numbers inside are the town builder's.
 *
 *   npm run model -- trace market --against town:market --reference
 *   npm run model -- trace docs/plans/trace/market.ts --against town:market
 *
 * The reference printed nearly every piece as an exact box or prism; the first scoring passed
 * (game IoU 0.999, dE 0.002) and the next two only cleared the check's z-fighting warnings
 * (the wall's ends inside the back posts, limes beside apples).
 */
const I7 = [0, 1, 2, 3, 4, 5, 6];

/** Seven red and white stripes across the stall's width, `[h, d]` thick and deep. */
const stripes = (h: number, d: number, at: [number, number, number], rot?: [number, number, number]): Part => ({
  group: I7.map((i) => ({ box: [0.66, h, d] as const, at: [(i - 3) * 0.66, 0, 0] as const, c: i % 2 ? 'canvas' : 'cloth' })),
  at,
  ...(rot ? { rot } : {}),
});

/** A crate of side `s` with a straw lid, standing on `at`. */
const crate = (s: number, at: [number, number, number], rot?: [number, number, number]): Part => ({
  group: [
    { box: [s, s - 0.04, s] as const, at: [0, (s - 0.04) / 2, 0] as const, c: 'wood' },
    { box: [s, 0.04, s] as const, at: [0, s - 0.02, 0] as const, c: 'straw' },
  ],
  at,
  ...(rot ? { rot } : {}),
});

export default model({
  id: 'market',
  about: 'Market stall: plank counter with a plum top, back wall with goods, four posts under a striped sloping awning and valance, crates and a sack',
  tags: ['town', 'wood', 'stall', 'traced'],
  palette: { wood: 'orange', trim: 'plum', cloth: 'red', canvas: 'white', straw: 'sand', glaze: 'sky', fruit: 'lime' },
  parts: [
    {
      at: [-0.031, 0, -0.019],
      group: [
        // counter, its top, and the back wall with goods on it
        { box: [4.2, 1, 0.8], at: [0, 0.5, 1.1], c: 'wood', name: 'counter' },
        { box: [4.4, 0.08, 1], at: [0, 1.02, 1.1], c: 'trim' },
        { box: [4.38, 1.6, 0.12], at: [0, 1.3, -1.45], c: 'wood', name: 'wall' },
        ...[-1.6, -0.8, 0, 0.8, 1.6].map((x, i) => ({ box: [0.5, 0.4, 0.3] as const, at: [x, 2.3, -1.3] as const, c: i % 2 ? 'straw' : 'wood' })),
        // posts: tall at the back, shorter at the front
        { mirror: [{ box: [0.2, 3.5, 0.2], at: [2.1, 1.75, -1.4], c: 'trim' }, { box: [0.2, 2.95, 0.2], at: [2.1, 1.475, 0.82], c: 'trim' }] },
        // awning and valance
        { ...stripes(0.08, 2.5, [0, 3.25, -0.35], [-16, 0, 0]), name: 'awning' },
        stripes(0.3, 0.06, [0, 2.85, 0.86]),
        // wares on the counter: pots, a loaf on a tray, fruit
        ...[0.3, 0.6, 0.9].map((x) => ({ cyl: [0.3, 0.32, 0.26] as const, seg: 6, top: 0.8, at: [x, 1.22, 1.1] as const, rot: [0, -30, 0] as const, c: x === 0.6 ? 'glaze' : 'wood' })),
        { box: [0.5, 0.06, 0.4], at: [1.5, 1.09, 1.1], c: 'straw' },
        { box: [0.3, 0.12, 0.3], at: [1.5, 1.16, 1.1], c: 'straw' },
        ...[0, 1, 2, 3, 4, 5].map((i) => {
          const lime = i % 3 === 2, s = lime ? 0.17 : 0.16; // limes a touch bigger and sunk 5 mm: no face shared with the apples
          return { box: [s, s, s] as const, at: [-1.1 - 0.12 * i, (lime ? 1.055 : 1.06) + s / 2, i % 2 ? 1.05 : 1.17] as const, c: lime ? 'fruit' : 'cloth' };
        }),
        // crates and a sack
        crate(0.8, [2.8, 0, -0.2]),
        crate(0.6, [2.7, 0.8, -0.2], [0, 20, 0]),
        { cyl: [0.855, 0.7, 0.877], seg: 7, top: 0.778, at: [-2.678, 0.35, 0.395], rot: [0, 12.9, 0], c: 'straw', name: 'sack' },
      ],
    },
  ],
  source: { url: 'src/riftlight/town/Town.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.9993, iouClose: 0.9997, colour: 0.003, bounds: [0, 0, 0] } },
});
