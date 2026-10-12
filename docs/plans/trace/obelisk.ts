import { model } from '../../../src/engine/model';

/**
 * Emberfall's rune obelisk (town:obelisk, src/riftlight/town/Town.ts) traced in primitives.
 *
 *   npm run model -- trace obelisk --against town:obelisk --reference
 *   npm run model -- trace docs/plans/trace/obelisk.ts --against town:obelisk
 *
 * The reference's pieces were mostly exact (plinth prisms, standing stones, caps, rune strips) and
 * were pasted; the tier and shaft (one welded piece in the source) and the crystal were measured
 * off the sheets. The first scoring passed (game IoU 0.984, close 0.986, dE 0.002) with two
 * readability warnings from the source's own design, fixed the cheapest way, so the trace drifts
 * from it there: the standing stones are mist, not slate (slate stones, disc and tier read as one
 * block at game scale), and the shaft's tip rises 0.12 m to touch the crystal (which hovers in
 * the source). The ring is a square-section torus 0.1 m thick for the source's 0.14 m diamond tube.
 */

/** Rune strips on the shaft's four diagonals: [y, height, offset]; sky on one diagonal, cyan on the other. */
const RUNES = [[1.42, 0.5, 0.47], [2.322, 0.35, 0.4225], [3.122, 0.5, 0.378], [3.92, 0.25, 0.33]] as const;

export default model({
  id: 'obelisk',
  about: 'Rune obelisk on a stepped octagonal plinth: tapered four-sided shaft with glowing rune strips, four leaning standing stones with cyan caps, a crystal on its tip in a ring',
  tags: ['town', 'stone', 'landmark', 'magic', 'traced'],
  palette: { stone: 'slate', dark: 'night', pillar: 'mist', rune: 'cyan', glow: 'sky' },
  parts: [
    // the plinth: slate disc, night step, slate tier
    { cyl: [7.201, 0.12, 7.201], seg: 8, top: 0.944, at: [0, 0.082, 0], c: 'stone' },
    { cyl: [5.6, 0.28, 5.6], seg: 8, top: 1.077, at: [0, 0.222, 0], rot: [-180, 0, 0], c: 'dark' },
    { cyl: [4.2, 0.24, 4.2], seg: 8, top: 0.976, at: [0, 0.44, 0], c: 'stone', name: 'tier' },
    // the shaft: a four-sided frustum (a diamond from above) and its pyramid tip
    { cyl: [1.48, 4.34, 1.48], seg: 4, top: 0.568, at: [0, 2.73, 0], c: 'dark', name: 'shaft' },
    { cone: [0.84, 0.64, 0.84], seg: 4, at: [0, 5.22, 0], c: 'dark' },
    ...RUNES.flatMap(([y, h, d]) => [1, -1].flatMap((s) => [
      { box: [0.12, h, 0.05] as const, at: [s * d, y, s * d] as const, rot: [0, 45, 0] as const, c: 'glow' },
      { box: [0.12, h, 0.05] as const, at: [s * d, y, -s * d] as const, rot: [0, -45, 0] as const, c: 'rune' },
    ])),
    // four leaning standing stones with cyan caps
    { box: [0.4, 1.4, 0.5], at: [0, 0.722, -2.9], rot: [6.026, 0, 0], c: 'pillar' },
    { box: [0.4, 1.4, 0.5], at: [0, 0.722, 2.9], rot: [-6.026, 0, 0], c: 'pillar' },
    { box: [0.5, 1.4, 0.4], at: [-2.9, 0.722, 0], rot: [0, 0, 5], c: 'pillar' },
    { box: [0.5, 1.4, 0.4], at: [2.9, 0.722, 0], rot: [0, 0, -5], c: 'pillar' },
    ...([[-2.9, 0], [2.9, 0], [0, -2.9], [0, 2.9]] as const).map(([x, z]) => ({ box: [0.3, 0.1, 0.3] as const, at: [x, 1.472, z] as const, c: 'rune' })),
    // the crystal (a square bipyramid) on the tip, in its ring
    { cone: [1.103, 0.88, 1.103], seg: 4, at: [0, 6.86, 0], rot: [0, 45, 0], c: 'rune', name: 'crystal' },
    { cone: [1.103, 0.88, 1.103], seg: 4, at: [0, 5.98, 0], rot: [180, 45, 0], c: 'rune' },
    { torus: [2.14, 0.1, 2.14], at: [0, 6.42, 0], c: 'glow', name: 'ring' },
  ],
  source: { url: 'src/riftlight/town/Town.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.9893, iouClose: 0.9888, colour: 0.0285, bounds: [0.001, -0.002, 0.001] } },
});
