import { model } from '../..';

/**
 * The designed boss Vorgath, the Emberhide (src/riftlight/monsters/bosses/designed.ts) traced in
 * primitives at its game scale, in the trace's frame (footprint centred, front +z).
 *
 *   npm run model -- trace vorgath --against monster:vorgath --reference
 *   npm run model -- trace src/engine/model/fixtures/trace/vorgath.ts --against monster:vorgath
 *
 * Phase 6 trace of an organic, off-palette source. The reference's exact pieces (the back shell,
 * its struts, the jaw, the soles) were pasted; the round masses are balls on the reference's boxes;
 * cones (back spikes, arm spikes) run from base centre to tip, read off the source's vertices,
 * since a tilted cone's axis-aligned box is not centred on it. Geometry passes at ~0.96 IoU; colour
 * passes at 0.097 against the palette floor 0.074 + 0.04: the source's sand bands across the hide
 * and tessellation at colour seams add what sits over the floor. The arm spikes are `night`, not
 * the source's teal: teal is too close to the pink fists in lightness to read apart.
 */
const TILT = -63.4; // the back shell's axis: up and back

export default model({
  id: 'vorgath',
  about: 'Hulking ember-backed brute: banded orange hide, pink fists and feet, a dark hex shell on its back with a glowing disc and sand spikes, horned head',
  tags: ['monster', 'boss', 'creature', 'traced'],
  palette: { hide: 'orange', flesh: 'red', shell: 'ink', ember: 'sand', spike: 'night', bone: 'white' },
  parts: [
    // torso, belly to shoulders, and the neck
    { ball: [1.92, 0.67, 1.49], at: [0, 1.42, 0.04], c: 'flesh' },
    { ball: [2.66, 1.3, 2.15], at: [0, 1.92, 0.4] },
    { ball: [3.3, 1.65, 2.21], at: [0, 2.96, 0.59], name: 'chest' },
    { ball: [2.31, 1.06, 1.62], at: [0, 3.65, 0.15] },
    { ball: [1.11, 0.52, 1.24], at: [0, 2.84, 1.62] },
    // the back shell, its glowing disc and spikes
    { cyl: [2.475, 0.66, 2.144], seg: 6, top: 1.5, at: [0, 3.615, -0.923], rot: [TILT, -30, 0], c: 'shell', name: 'shell' },
    { cyl: [0.376, 0.726, 0.386], seg: 7, at: [0, 4.233, -0.171], rot: [TILT, 12.8, 0], c: 'shell' },
    { cyl: [0.439, 0.661, 0.451], seg: 7, at: [0, 3.436, -0.57], rot: [TILT, 12.9, 0], c: 'shell' },
    { ball: [1.85, 0.39, 1.85], at: [0, 3.76, -1.22], rot: [TILT, 0, 0], c: 'ember', glow: true },
    ...([[0, 4.1, -1.92, 1.35], [-0.4, 3.71, -1.93, 1.02], [0.46, 4.34, -1.575, 0.95], [-0.33, 4.41, -1.435, 0.75]] as const).map(
      ([x, y, z, h]) => ({ cone: [0.4, h, 0.4] as const, at: [x, y, z] as const, rot: [TILT, 0, 0] as const, c: 'ember' }),
    ),
    // head: skull, snout, jaw
    { ball: [0.81, 0.78, 0.78], at: [0, 3.46, 1.73], name: 'head' },
    { ball: [0.48, 0.41, 0.46], at: [0, 3.26, 2.15] },
    { ball: [0.23, 0.13, 0.1], at: [0, 3.3, 2.35], c: 'shell' },
    { box: [0.732, 0.228, 0.632], at: [0, 2.969, 2.162], rot: [2.677, 0, 0], c: 'flesh', name: 'jaw' },
    { cone: [0.28, 0.64, 0.33], at: [0, 4.2, 1.7], c: 'ember', glow: true },
    {
      mirror: [
        // legs: thigh, shin, foot, sole and two toe pads
        { ball: [0.98, 1.22, 1.24], seg: 8, at: [0.8, 0.88, 0.29] },
        { ball: [0.9, 0.9, 0.9], at: [0.8, 0.76, 0.41], c: 'flesh' },
        { ball: [0.74, 0.85, 0.87], at: [0.8, 0.58, 0.37], c: 'flesh' },
        { ball: [1.42, 0.39, 1.69], seg: 8, at: [0.8, 0.66, 0.53], c: 'flesh' },
        { box: [1.137, 0.234, 2.106], at: [0.799, 0.117, 0.634], c: 'flesh' },
        ...[0.505, 1.09].map((x) => ({ cyl: [1.9, 0.55, 0.59] as const, seg: 6, top: 0.8, at: [x, 0.275, 0.8] as const, rot: [0, 90, 0] as const, c: 'shell' })),
        // arm: shoulder, forearm with its dark cuff, fist, thumb, knuckles, claws, spikes
        { ball: [1.67, 1.5, 1.66], at: [1.9, 3.28, 0.71] },
        { ball: [1.02, 1.03, 1.02], at: [1.91, 3.89, 0.84] },
        { group: [{ cyl: [1.31, 0.3, 1.345], seg: 7, rot: [0, 17, 0] }], at: [1.935, 4.02, 0.905], rot: [-17.8, 0, -9.7], c: 'shell' },
        { ball: [1.54, 1.21, 1.28], at: [1.85, 3.52, 1.16], c: 'flesh' },
        { ball: [0.46, 0.55, 0.39], at: [2.56, 3.4, 1.49], c: 'flesh' },
        ...([[1.28, 3.29, 1.69], [1.63, 3.24, 1.73], [1.98, 3.17, 1.71], [2.32, 3.08, 1.64]] as const).flatMap(([x, y, z]) => [
          { ball: [0.42, 0.37, 0.37] as const, at: [x, y, z] as const, c: 'flesh' },
          { cone: [0.17, 0.36, 0.2] as const, at: [x, y - 0.13, z + 0.14] as const, rot: [110, 0, 0] as const, c: 'bone' },
        ]),
        { cone: [0.57, 1.44, 0.57], at: [2.125, 4.21, 0.915], rot: [12.6, 0, -37.2], c: 'spike' },
        { cone: [0.42, 1, 0.42], at: [2.22, 3.87, 1.355], rot: [48.3, 0, -45.2], c: 'spike' },
        { cone: [0.42, 1, 0.42], at: [2.22, 4.085, 0.37], rot: [-23.3, 0, -45.5], c: 'spike' },
        // the shell's straps: a rod over each shoulder and two struts into the back
        { cyl: [0.09, 1.31, 0.09], seg: 7, at: [0.865, 3.995, -0.435], rot: [-24.1, 0, -59.7], c: 'shell' },
        { cyl: [0.439, 1.057, 0.451], seg: 7, at: [0.528, 3.347, -0.762], rot: [TILT, 12.9, 0], c: 'shell' },
        // face: horns, tusks, eyes, brows, crest flames
        { ball: [0.36, 0.35, 0.31], at: [0.46, 3.78, 1.7], c: 'bone' },
        { box: [0.33, 0.3, 0.33], at: [0.66, 3.88, 1.79], c: 'bone' },
        { box: [0.2, 0.23, 0.3], at: [0.77, 3.97, 1.99], c: 'bone' },
        { box: [0.14, 0.13, 0.28], at: [0.8, 4.05, 2.22], c: 'bone' },
        { ball: [0.26, 0.24, 0.25], at: [0.29, 3.11, 2.39], c: 'bone' },
        { box: [0.2, 0.23, 0.23], at: [0.34, 3.24, 2.32], c: 'bone' },
        { ball: [0.3, 0.25, 0.12], at: [0.23, 3.54, 2.1], c: 'shell' },
        { ball: [0.22, 0.18, 0.09], at: [0.23, 3.53, 2.16], c: 'ember', glow: true },
        { box: [0.34, 0.17, 0.15], at: [0.21, 3.66, 2.15], c: 'shell' },
        { cone: [0.21, 0.47, 0.2], at: [0.15, 4.09, 1.64], c: 'ember', glow: true },
      ],
    },
  ],
  source: { url: 'src/riftlight/monsters', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.9555, iouClose: 0.9566, colour: 0.0971, bounds: [0.003, 0, 0.005] } },
});
