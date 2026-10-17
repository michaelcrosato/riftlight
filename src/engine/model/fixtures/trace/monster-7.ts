import { around, model } from '../..';

/**
 * Generated monster seed 7 (src/riftlight/monsters) traced in primitives, at its game scale.
 *
 *   npm run model -- trace monster-7 --against monster:7 --reference
 *   npm run model -- trace src/engine/model/fixtures/trace/monster-7.ts --against monster:7
 *
 * The shape passed from the first scoring (a ball, six feet round it, the face's exact boxes from
 * the reference, its hidden inner glow cross left out). Colour is the hard part: the source's faces
 * are mottled off-palette tans whose nearest entries floor at dE 0.082, so it passes at 0.113 under
 * the floor + 0.04. A white body scored 0.158, sand 0.135; the reference's materials put the pale
 * faces low, so a mist dome on a white belly reaches 0.113.
 */
export default model({
  id: 'monster-7',
  about: 'Squat blob monster: a faceted dome on six stubby feet, a pale patch on its back, glowing slit eyes and a dark jaw',
  tags: ['monster', 'creature', 'traced'],
  palette: { skin: 'mist', belly: 'white', foot: 'mist', patch: 'sand', ink: 'ink', glow: 'lime', spot: 'orange' },
  parts: [
    // the source's faces are mottled: pale ones low, greys and tans above
    { ball: [0.39, 0.14, 0.37], half: true, at: [0, 0.21, 0], c: 'skin', name: 'dome' },
    { ball: [0.39, 0.14, 0.37], half: true, at: [0, 0.07, 0], rot: [180, 0, 0], c: 'belly', name: 'belly' },
    { ball: [0.2, 0.12, 0.18], at: [-0.07, 0.21, -0.07], c: 'patch' },
    { cone: [0.08, 0.04, 0.06], seg: 4, at: [0.06, 0.26, 0.05], c: 'spot' },
    { cyl: [0.31, 0.01, 0.32], seg: 6, at: [0, 0.005, 0], c: 'ink', name: 'sole' },
    ...around(6, { ball: [0.08, 0.07, 0.07], seg: 5, at: [0, 0.05, 0], c: 'foot' }, { r: 0.168, phase: 25 }),
    // face: slit eyes and the jaw, sunk into the body so only their fronts show
    { mirror: [{ box: [0.066, 0.026, 0.06], at: [0.067, 0.19, 0.134], c: 'ink' }, { box: [0.06, 0.012, 0.06], at: [0.067, 0.19, 0.137], rot: [0, 0, 8], c: 'glow' }] },
    { box: [0.156, 0.05, 0.06], at: [0, 0.119, 0.159], c: 'ink', name: 'jaw' },
  ],
  source: { url: 'src/riftlight/monsters', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.8913, iouClose: 0.918, colour: 0.1133, bounds: [-0.017, -0.004, 0.001] } },
});
