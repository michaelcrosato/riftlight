import { model } from '../../../src/engine/model';

/**
 * Oru's mystic tent from Emberfall (src/riftlight/town/Town.ts, `tent`) traced in primitives, in
 * the trace's frame (footprint centred, so the source's z is +0.53 here).
 *
 *   npm run model -- trace tent --against town:tent --reference
 *   npm run model -- trace docs/plans/trace/tent.ts --against town:tent
 *
 * The reference pasted almost whole: every piece an exact cone, prism or box. Two drifts from the
 * source: its crystal-ball stand is night, which the check reads as touching the plum canvas
 * (their boxes overlap) at 0.02 lightness apart, so here it shares the door's ink; and the candle
 * flames are 0.06 m across, not 0.05 (the check's rods under 0.06 m vanish at game scale).
 */
const candle = (x: number, z: number) => [
  { cyl: [0.12, 0.3, 0.12] as const, seg: 5, at: [x, 0.15, z] as const, c: 'candle' },
  { box: [0.06, 0.08, 0.06] as const, at: [x, 0.34, z] as const, c: 'trim' },
];

export default model({
  id: 'tent',
  about: 'Mystic tent: an eight-sided plum cone on a sand ring with a spire, a dark door flap, a rug out front with cushions, candles and a crystal ball on a stand',
  tags: ['town', 'cloth', 'building', 'traced'],
  palette: { canvas: 'plum', trim: 'sand', rug: 'red', inlay: 'orange', dark: 'ink', cushion: 'navy', crystal: 'cyan', candle: 'white' },
  parts: [
    // the tent: canvas cone on a ring, a cap and spire, the door flap leaning on the front
    { cone: [5, 3.4, 5], seg: 8, at: [0, 1.7, -1.07], c: 'canvas', name: 'canvas' },
    { cyl: [5.04, 0.3, 5.04], seg: 8, at: [0, 0.3, -1.07], c: 'trim', name: 'ring' },
    { cone: [0.8, 0.8, 0.8], seg: 8, at: [0, 3.6, -1.07], c: 'trim', name: 'cap' },
    { box: [0.12, 1.2, 0.12], at: [0, 4.2, -1.07], c: 'trim', name: 'spire' },
    { box: [1, 1.6, 0.1], at: [0, 0.8, 0.65], rot: [-34, 0, 0], c: 'dark', name: 'door' },
    // the rug out front, cushions at its sides, the crystal ball on its stand, candles
    { box: [2.8, 0.03, 2.2], at: [0, 0.02, 2.43], c: 'rug', name: 'rug' },
    { box: [2.4, 0.035, 1.8], at: [0, 0.026, 2.43], c: 'inlay' },
    { mirror: [{ box: [0.5, 0.2, 0.5], at: [1.6, 0.1, 2.93], c: 'cushion' }] },
    { cyl: [0.64, 0.6, 0.64], top: 1.6, seg: 6, at: [1.5, 0.3, 1.53], rot: [0, 30, 0], c: 'dark', name: 'stand' },
    { cyl: [0.48, 0.3, 0.48], seg: 8, at: [1.5, 0.75, 1.53], c: 'crystal', name: 'crystal' },
    ...candle(-1.3, 1.43),
    ...candle(-1, 3.53),
    ...candle(1.2, 3.53),
  ],
  source: { url: 'src/riftlight/town/Town.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.9976, iouClose: 0.9971, colour: 0.0021, bounds: [0, 0, 0] } },
});
