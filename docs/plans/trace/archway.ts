import { model } from '../../../src/engine/model';
import type { Part } from '../../../src/engine/model/types';

/**
 * Gate A's winning stone archway (docs/plans/gate-a/archway-a.ts) traced in primitives, in the
 * trace's frame (footprint centred, base on y = 0).
 *
 *   npm run model -- trace archway --against gate-a:archway-a --reference
 *   npm run model -- trace docs/plans/trace/archway.ts --against gate-a:archway-a
 *
 * Two pillars of alternating mist blocks round a night core, on slate plinths under slate
 * capitals; a semicircular arch about (0, 2.3): a night core ring of 22 blocks, 10 voussoirs each
 * an inner and an outer block, deep and shallow by turns, and a two-part slate keystone.
 * Every piece in the reference was an exact box, so it passed on the first scoring; the colour
 * left is the plinth and capital tops (mist in the source's Kit `top:` faces, slate here).
 */
const CY = 2.3;
/** A box turned to face out from the arch centre at angle `a` (degrees), `r` out from it. */
const ray = (a: number, r: number, box: [number, number, number], c: string): Part => {
  const t = (a * Math.PI) / 180;
  return { box, at: [r * Math.cos(t), CY + r * Math.sin(t), 0], rot: [0, 0, a], c };
};

export default model({
  id: 'archway',
  about: 'Stone archway: block pillars on plinths with capitals, a semicircular arch of voussoirs round a dark core, a keystone',
  tags: ['town', 'stone', 'gate', 'traced'],
  palette: { stone: 'mist', core: 'night', trim: 'slate' },
  parts: [
    { box: [2, 0.06, 0.72], at: [0, 0.03, 0], c: 'trim', name: 'threshold' },
    {
      mirror: [
        { box: [0.82, 0.3, 0.84], at: [1.3, 0.15, 0], c: 'trim', name: 'plinth' },
        { box: [0.52, 1.84, 0.54], at: [1.3, 1.22, 0], c: 'core', name: 'pillar' },
        ...[0.53, 0.99, 1.45, 1.91].map((y, i): Part => ({ box: i % 2 ? [0.58, 0.41, 0.6] : [0.64, 0.41, 0.66], at: [1.3, y, 0], c: 'stone' })),
        { box: [0.76, 0.16, 0.78], at: [1.3, 2.22, 0], c: 'trim', name: 'capital' },
      ],
    },
    ...Array.from({ length: 22 }, (_, k) => ray((180 / 22) * (k + 0.5), 1.3, [0.5, 0.228, 0.52], 'core')),
    ...[0, 1, 2, 3, 4, 6, 7, 8, 9, 10].flatMap((j) => {
      const a = (180 / 11) * (j + 0.5);
      const d = j % 2 ? 0.62 : 0.66;
      return [ray(a, 1.15, [0.302, 0.242, d], 'stone'), ray(a, 1.45, [0.302, 0.327, d], 'stone')];
    }),
    { box: [0.322, 0.302, 0.76], at: [0, 3.45, 0], c: 'trim', name: 'keystone' },
    { box: [0.436, 0.502, 0.76], at: [0, 3.85, 0], c: 'trim' },
  ],
  source: { url: 'docs/plans/gate-a/archway-a.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 1, iouClose: 0.9999, colour: 0.0088, bounds: [0, 0, 0] } },
});
