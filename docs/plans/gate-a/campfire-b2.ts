import { around, model } from '../../../src/engine/model';

/**
 * One log: its inner end raised into the flame, its outer end on the ash in a gap of the stone
 * ring, where its pale cut face shows. Four of them, between the eight stones.
 */
const LOG_LEN = 0.76;
const LOG_D = 0.15;
const LOG_TILT = 18;
const log = {
  group: [
    { cyl: [LOG_D, LOG_LEN, LOG_D], rot: [90, 0, 0], seg: 6, c: 'bark' },
    { cyl: [LOG_D * 0.78, 0.03, LOG_D * 0.78], at: [0, 0, LOG_LEN / 2], rot: [90, 0, 0], seg: 6, c: 'core' },
  ],
  at: [0, 0.2, 0.36],
  rot: [LOG_TILT, 0, 0],
} as const;

export default model({
  id: 'campfire',
  about: 'Campfire: a ring of field stones around a dark ash bed, four logs crossed into a lit flame, glowing embers between them',
  tags: ['lighting', 'fire', 'nature', 'camp'],
  palette: {
    stone: 'slate',
    stone2: 'mist',
    bark: 'plum',
    ash: 'ink',
    outer: 'red',
    mid: 'orange',
    core: 'sand',
  },
  size: [1.75, 0.86, 1.75],
  collider: 'cyl',
  light: { at: [0, 0.4, 0], c: 'mid', intensity: 5, radius: 5, flicker: 'torch' },
  parts: [
    { cyl: [1.1, 0.04, 1.1], at: [0, 0.02, 0], seg: 8, c: 'ash', name: 'ash' },
    ...around(4, (i) => ({ box: [0.15, 0.06, 0.11], at: [0, 0.06, 0.3 + (i % 2) * 0.05], rot: [0, 20 + i * 35, 6], c: 'mid', glow: true }), { phase: 67.5 }),
    { use: 'stone-ring', params: { r: 0.7, n: 8, size: 0.36 }, palette: { stone: 'stone', stone2: 'stone2' } },
    ...around(4, log, { phase: 22.5 }),
    { use: 'flame', params: { h: 0.72 }, at: [0, 0.1, 0], rot: [0, 60, 0], palette: { outer: 'outer', mid: 'mid', core: 'core', heart: 'mid' } },
  ],
});
