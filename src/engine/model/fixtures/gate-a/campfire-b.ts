import { around, model } from '../..';

/** A log leaning into the teepee: foot at z = 0.34, top just past the centre (the `around` frame). */
const LOG_LEN = 0.56;
const LEAN = 30;
const rad = (LEAN * Math.PI) / 180;
const leanLog = {
  cyl: [0.1, LOG_LEN, 0.1] as const,
  at: [0, (LOG_LEN / 2) * Math.cos(rad) + 0.03, 0.34 - (LOG_LEN / 2) * Math.sin(rad)] as const,
  rot: [-LEAN, 0, 0] as const,
  seg: 5,
  c: 'wood',
};

export default model({
  id: 'campfire',
  about: 'Campfire ring: stones around a log teepee with flames and embers',
  tags: ['camp', 'fire', 'stone', 'wood', 'lighting'],
  palette: { stone: 'mist', stone2: 'slate', ash: 'night', wood: 'red', fire: 'orange', flame: 'sand' },
  size: [1.36, 0.86, 1.36],
  collider: 'cyl',
  light: { at: [0, 0.5, 0], c: 'flame', intensity: 6, radius: 5, flicker: 'candle' },
  parts: [
    // ash bed and glowing embers inside the ring
    { cyl: [0.92, 0.03, 0.92], at: [0, 0.015, 0], seg: 10, c: 'ash' },
    { ball: [0.56, 0.1, 0.56], at: [0, 0.05, 0], half: true, seg: 8, c: 'fire', glow: true },
    // stone ring, two tones alternating
    ...around(4, { lump: [0.32, 0.21, 0.26], at: [0, 0.105, 0.55], seed: 1, c: 'stone' }),
    ...around(4, { lump: [0.3, 0.18, 0.25], at: [0, 0.09, 0.55], seed: 2, c: 'stone2' }, { phase: 45 }),
    // two crossed logs on the ground
    { cyl: [0.12, 0.8, 0.12], at: [0, 0.075, 0], rot: [0, 22.5, 90], seg: 5, c: 'wood' },
    { cyl: [0.12, 0.8, 0.12], at: [0, 0.18, 0], rot: [0, -67.5, 90], seg: 5, c: 'wood' },
    // log teepee
    ...around(3, leanLog, { phase: 30 }),
    // flames: a fat yellow body engulfing the teepee, orange tongues licking out between the logs
    { lathe: [[0, 0], [0.2, 0], [0.23, 0.14], [0.18, 0.34], [0.1, 0.54], [0.04, 0.7], [0, 0.78]], at: [0, 0.08, 0], seg: 6, c: 'flame', glow: true },
    ...around(3, { cone: [0.15, 0.42, 0.15], at: [0, 0.29, 0.15], rot: [16, 0, 0], seg: 5, c: 'fire', glow: true }, { phase: 90 }),
  ],
});
