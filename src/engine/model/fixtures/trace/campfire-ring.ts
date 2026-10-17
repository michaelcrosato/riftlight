import { around, model } from '../..';

/**
 * Gate A's campfire (src/engine/model/fixtures/gate-a/campfire-a.ts) traced in primitives, in the trace's frame
 * (footprint centred, so the hearth's middle is at x 0.1, z 0.43).
 *
 *   npm run model -- trace campfire-ring --against gate-a:campfire-a --reference
 *   npm run model -- trace src/engine/model/fixtures/trace/campfire-ring.ts --against gate-a:campfire-a
 *
 * Most pieces came out exact (logs, end grain, hearth discs); the stones are a 12-stone ring at
 * r 0.68 from their centres, the flames hex cones from their boxes. The first scoring passed (game
 * IoU 0.960, close 0.928, dE 0.015), but the check found the source's seat logs and woodpile
 * floating 4 cm and z-fighting caps; grounding them (a log 2 cm fatter, the pile 3 cm lower) and
 * lifting the leaning logs off the hearth cost about 3 points of IoU, at the numbers in `source`.
 */
const HEARTH: [number, number, number] = [0.1, 0, 0.43];
const LOG = { cyl: [0.42, 1.2, 0.42], seg: 8, c: 'wood' } as const;
const END = { cyl: [0.35, 0.02, 0.35], seg: 8, c: 'grain' } as const;

export default model({
  id: 'campfire-ring',
  about: 'Campfire in a ring of twelve stones: tongues of flame over a star of five logs on a hearth, two seat logs and a stack of firewood',
  tags: ['camp', 'fire', 'stone', 'wood', 'traced'],
  palette: { wood: 'plum', grain: 'sand', flame: 'orange', hot: 'red', heart: 'sand', hearth: 'night', ash: 'ink', stone: 'slate', rock: 'mist' },
  parts: [
    {
      at: HEARTH,
      group: [
        { cyl: [1.12, 0.04, 1.12], seg: 12, at: [0, 0.034, 0], c: 'hearth' },
        { cyl: [0.88, 0.04, 0.837], seg: 10, at: [0, 0.051, 0], rot: [0, -18, 0], c: 'ash' },
        { cyl: [0.6, 0.04, 0.571], seg: 10, at: [0, 0.066, 0], rot: [0, -18, 0], c: 'hot' },
        // the stone ring, mist and slate in turn, every third one smaller
        ...around(12, (i) => ({ cyl: i % 3 === 2 ? [0.27, 0.19, 0.25] : [0.31, 0.26, 0.31], seg: 6, top: 0.78, at: [0, i % 3 === 2 ? 0.105 : 0.135, 0], c: i % 2 ? 'stone' : 'rock' }), { r: 0.68, phase: 84 }),
        // five logs leaning in, their ends showing
        ...around(5, { group: [{ cyl: [0.13, 0.4, 0.113], seg: 6, at: [0, 0.179, 0.308], rot: [-73.6, 0, 0], c: 'wood' }, { cyl: [0.1, 0.02, 0.087], seg: 6, at: [0, 0.123, 0.5], rot: [-73.6, 0, 0], c: 'grain' }] }, { phase: 81 }),
        // the flames
        { cone: [0.42, 1.0, 0.42], seg: 6, at: [-0.02, 0.55, -0.06], c: 'flame' },
        { cone: [0.34, 0.78, 0.36], seg: 6, at: [-0.18, 0.45, -0.02], c: 'flame' },
        { cone: [0.32, 0.7, 0.3], seg: 6, at: [0.16, 0.42, -0.12], c: 'hot' },
        { cone: [0.34, 0.62, 0.3], seg: 6, at: [0.16, 0.37, 0.1], c: 'flame' },
        { cone: [0.32, 0.55, 0.34], seg: 6, at: [-0.08, 0.34, 0.16], c: 'heart' },
      ],
    },
    // two seat logs and the firewood stack, with their end grain
    { ...LOG, at: [-1.401, 0.22, 0.53], rot: [90, 0, 0] },
    ...[1.135, -0.075].map((z) => ({ ...END, at: [-1.401, 0.22, z] as const, rot: [90, 0, 0] as const })),
    { ...LOG, at: [0.199, 0.22, -1.07], rot: [0, 0, 90] },
    ...[-0.406, 0.804].map((x) => ({ ...END, at: [x, 0.22, -1.07] as const, rot: [0, 0, 90] as const })),
    ...([[1.299, 0.107], [1.509, 0.107], [1.404, 0.282]] as const).map(([x, y]) => ({
      at: [x, y, 0.13] as const,
      group: [{ cyl: [0.19, 0.62, 0.195] as const, seg: 7, rot: [90, 13, 0] as const, c: 'wood' }, { mirror: [{ cyl: [0.142, 0.02, 0.146] as const, seg: 7, at: [0, 0, 0.315] as const, rot: [90, 13, 0] as const, c: 'grain' }], axis: 'z' as const }],
    })),
  ],
  source: { url: 'src/engine/model/fixtures/gate-a/campfire-a.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.9315, iouClose: 0.8807, colour: 0.0233, bounds: [0.01, -0.019, 0.008] } },
});
