import { model } from '../../../src/engine/model';

/**
 * The generated pickup coin (public/assets/coin.glb) traced in primitives, standing on its edge.
 *
 *   npm run model -- trace coin --against asset:coin --reference
 *   npm run model -- trace docs/plans/trace/coin.ts --against asset:coin
 *
 * The reference listed two exact pieces: a 10-sided disc spun so a corner points up, and the bar
 * stamped through it. Pasted as printed (the spin rounded to -18), they passed on the first scoring at
 * the numbers in `source.fidelity`; the only difference left is a sub-pixel seam where the bar meets
 * the disc.
 */
export default model({
  id: 'coin',
  about: 'Gold pickup coin on its edge: a ten-sided disc with an upright bar stamped through it',
  tags: ['pickup', 'treasure', 'traced'],
  palette: { face: 'sand', mark: 'orange' },
  parts: [
    { cyl: [0.6, 0.08, 0.571], seg: 10, at: [0, 0.3, 0], rot: [90, -18, 0], c: 'face', name: 'disc' },
    { box: [0.08, 0.3, 0.1], at: [0, 0.3, 0], c: 'mark', name: 'mark' },
  ],
  source: { url: 'public/assets/coin.glb', licence: 'LicenseRef-own', author: 'riftlight', file: 'coin.glb', sha256: 'f5c6b1f1bd70dc7019f73b7bbdee5ed7fca5cd61ead71f8c0687c0e433063900', tool: 'trace', fidelity: { iou: 1, iouClose: 0.9993, colour: 0.0005, bounds: [0, 0, 0] } },
});
