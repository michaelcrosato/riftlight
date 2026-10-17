import { around, model } from '../..';

/**
 * Gate A's winning Kit hand cart (src/engine/model/fixtures/gate-a/hand-cart-a.ts) traced in primitives, in the
 * trace's frame (footprint centred, so the bed's middle is at z = -0.47).
 *
 *   npm run model -- trace hand-cart --against gate-a:hand-cart-a --reference
 *   npm run model -- trace src/engine/model/fixtures/trace/hand-cart.ts --against gate-a:hand-cart-a
 *
 * Phase 6's second proof trace: the reference listed 92 pieces, most of them exact boxes and
 * prisms, alike ones grouped (16 tyre and felloe segments a wheel). The first scoring passed
 * (game IoU 0.972, close 0.969, dE 0.022) but the check found four spoke bars at 90° that drew
 * only two directions, sub-6 cm rods and coplanar seams; the second, fixed, passed clean at the
 * numbers in `source.fidelity`. The colour left is the board tops (the Kit's `top:` faces). ~650 tokens.
 */
const AXLE: [number, number, number] = [0, 0.5, -0.46];

/** A wheel in the YZ plane: 16 tyre and 16 felloe segments, 8 spokes, a hub. */
const wheel = (x: number) => ({
  name: x > 0 ? 'wheel-r' : 'wheel-l',
  at: [x, AXLE[1], AXLE[2]] as const,
  rot: [0, 0, 90] as const,
  group: [
    ...around(16, { box: [0.21, 0.09, 0.04] as const, c: 'tyre' }, { r: 0.48 }),
    ...around(16, { box: [0.186, 0.07, 0.07] as const, c: 'wood' }, { r: 0.425 }),
    ...around(8, { box: [0.06, 0.06, 0.4] as const, c: 'wood' }, { r: 0.2, phase: 22.5 }),
    { cyl: [0.2, 0.15, 0.2] as const, seg: 8, c: 'iron' },
  ],
});

export default model({
  id: 'hand-cart',
  about: 'Two-wheeled hand cart: plank bed on two long rails that run on into the shafts, spoked iron-tyred wheels, prop legs',
  tags: ['town', 'wood', 'vehicle', 'traced'],
  palette: { wood: 'orange', frame: 'red', tyre: 'slate', floor: 'sand', iron: 'night' },
  parts: [
    // rails that become the shafts, and the cross handle
    { mirror: [{ box: [0.08, 0.09, 2.25], at: [0.36, 0.52, 0], c: 'frame', name: 'rail' }] },
    { cyl: [0.08, 0.94, 0.08], seg: 6, at: [0, 0.53, 1.09], rot: [0, 0, 90], c: 'frame', name: 'handle' },
    // axle block and rod
    { box: [0.86, 0.08, 0.12], at: AXLE, c: 'iron' },
    { cyl: [0.07, 1.34, 0.07], seg: 6, at: AXLE, rot: [0, 0, 90], c: 'iron', name: 'axle' },
    // the bed: a sand floor, side boards, front and tail boards, each with a seam strip
    { box: [0.96, 0.06, 1.3], at: [0, 0.59, -0.47], c: 'floor', name: 'floor' },
    { mirror: [{ box: [0.06, 0.3, 1.3], at: [0.45, 0.77, -0.47], c: 'wood' }, { box: [0.08, 0.03, 1.26], at: [0.45, 0.77, -0.47], c: 'frame' }] },
    ...[0.15, -1.09].flatMap((z) => [
      { box: [0.84, 0.3, 0.06] as const, at: [0, 0.77, z] as const, c: 'wood' },
      { box: [0.86, 0.03, 0.08] as const, at: [0, 0.77, z] as const, c: 'frame' },
      { mirror: [{ box: [0.09, 0.32, 0.09] as const, at: [0.45, 0.77, z] as const, c: 'iron' }] },
    ]),
    // prop legs under the front
    { mirror: [{ box: [0.07, 0.52, 0.07], at: [0.36, 0.26, 0.1], c: 'frame' }] },
    wheel(0.6),
    wheel(-0.6),
  ],
  source: { url: 'src/engine/model/fixtures/gate-a/hand-cart-a.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.978, iouClose: 0.9742, colour: 0.022, bounds: [0, 0, 0.005] } },
});
