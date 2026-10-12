import { model } from '../../../src/engine/model';

/**
 * The generated tree (public/assets/tree.glb, scripts/generate-assets.mjs) traced in primitives:
 * a tapered six-sided trunk under stacked seven-sided cones. Traced, it varies: `tiers` stacks
 * more or fewer cones, each 0.7 as wide and 0.82 as tall as the one below (2 is the source).
 *
 *   npm run model -- trace tree --against asset:tree --reference
 *   npm run model -- trace docs/plans/trace/tree.ts --against asset:tree
 *
 * Phase 6's first proof trace: the reference read the trunk as an exact frustum and the canopy as
 * two close 7-sided cones; written from it, the first scoring passed (game IoU 0.981, close 0.983,
 * dE 0.000); made parametric, the second passed at the numbers in `source.fidelity`. ~340 tokens.
 */
export default model({
  id: 'tree',
  about: 'Low-poly pine: a tapered six-sided trunk under stacked seven-sided cones',
  tags: ['nature', 'tree', 'traced'],
  palette: { leavesLow: 'teal', leavesHigh: 'green', trunk: 'plum' },
  params: { tiers: [2, 1, 4] },
  parts: (p) => [
    { cyl: [0.4, 0.9, 0.35], seg: 6, top: 0.7, at: [0, 0.45, -0.04], rot: [0, -30, 0], c: 'trunk', name: 'trunk' },
    ...Array.from({ length: p.tiers! }, (_, i) => {
      const k = 0.7 ** i;
      return { cone: [1.62 * k, 1.1 * 0.82 ** i, 1.66 * k] as const, seg: 7, at: [0.04 * k, 1.25 + 0.6 * i, -0.05 * k] as const, rot: [0, 12.8, 0] as const, c: i ? 'leavesHigh' : 'leavesLow', name: `canopy-${i + 1}` };
    }),
  ],
  source: { url: 'public/assets/tree.glb', licence: 'LicenseRef-own', author: 'riftlight', file: 'tree.glb', sha256: 'c9662f53b6dcb0e44e9f33899661d10a4d3f58625de0d9832cc702d58dcac916', tool: 'trace', fidelity: { iou: 0.9827, iouClose: 0.9778, colour: 0.0005, bounds: [0.004, 0.001, 0.003] } },
});
