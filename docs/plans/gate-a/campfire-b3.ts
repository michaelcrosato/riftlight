import { around, model } from '../../../src/engine/model';
import type { Part, Vec3 } from '../../../src/engine/model/types';

/** The flame's slots onto ours: its tongues in `flame`, its front tongue in `cut` (both sand), its heart in `heart`. */
const FIRE = { outer: 'flame', mid: 'flame', core: 'cut', heart: 'heart' } as const;

/** The ring's radius (stone centres), a log's width, and the ash heap's radius and height. */
const R = 0.62;
const D = 0.16;
const HEAP = { r: 0.3, h: 0.15 };

/** The ash's top at `r` out from the centre: the heap's dome, then the bed. */
const ashTop = (r: number) => 0.03 + (r < HEAP.r ? (HEAP.h - 0.015) * Math.sqrt(1 - (r / HEAP.r) ** 2) : 0);

/**
 * One log fed in along its frame's +Z, nearly level: its inner end on the ash heap just past the
 * centre, its outer end on a ring stone, near the stone's far edge, so its sand cut end shows.
 * It runs half a width off the axis, so the four meet as a pinwheel instead of running into
 * each other.
 */
const feedLog = (): Part => {
  const [r0, y0] = [-0.04, HEAP.h + D / 2 + 0.01]; // inner end, on the heap
  const [r1, y1] = [R + 0.1, 0.32]; // outer end, on the stone
  const len = Math.hypot(r1 - r0, y1 - y0);
  return {
    at: [D / 2, (y0 + y1) / 2, (r0 + r1) / 2],
    rot: [(Math.atan2(r1 - r0, y1 - y0) * 180) / Math.PI, 0, 0], // the cylinder's +Y end out, a little up
    group: [
      { cyl: [D, len, D], seg: 6, c: 'bark', name: 'logs' },
      { cyl: [D * 0.78, 0.03, D * 0.78], at: [0, len / 2 + 0.005, 0], seg: 6, c: 'cut', name: 'ends' },
    ],
  };
};

/** An ember on the ash at (x, z), `k` across. */
const ember = (x: number, z: number, k: number, turn: number): Part => {
  const at: Vec3 = [x, ashTop(Math.hypot(x, z)) + 0.01, z];
  return { box: [k, 0.04, k], at, rot: [0, turn, 0], c: 'flame', glow: true, name: 'embers' };
};

export default model({
  id: 'campfire',
  about: 'Campfire ring: eight field stones in two greys round an ash bed, four red logs crossed over it from the light stones they rest on to the ash heap, sand cut ends out, the library flame where they meet, embers and its light',
  tags: ['lighting', 'fire', 'camp', 'nature'],
  palette: { stone: 'mist', stone2: 'slate', ash: 'night', bark: 'red', cut: 'sand', flame: 'orange', heart: 'white' },
  size: [1.55, 0.95, 1.55],
  light: { at: [0, 0.65, 0], c: 'flame', intensity: 2.5, radius: 6, flicker: 'torch' },
  collider: 'cyl',
  parts: (_, rng): Part[] => [
    // the ring: eight stones, light and dark by turns. The light ones sit on the axes and carry
    // the logs (red and slate are one lightness, so a log never rests on a dark one); the dark
    // ones sit on the diagonals, one straight in front of the camera, one behind the flame
    ...around(8, (i) => {
      const s = i % 2 ? rng.range(0.32, 0.38) : rng.range(0.36, 0.38);
      return { lump: [s, s * 0.6, s * 0.8], at: [0, s * 0.3, R], rot: [0, rng.range(-12, 12), 0], seed: rng.int(1, 999), c: i % 2 ? 'stone2' : 'stone', name: 'stones' };
    }),
    // the ash: a bed under the stones' inner edges and a low heap in the middle that the logs rest on
    { cyl: [1.04, 0.03, 1.04], at: [0, 0.015, 0], seg: 10, c: 'ash', name: 'ash' },
    { ball: [2 * HEAP.r, HEAP.h, 2 * HEAP.r], half: true, at: [0, 0.015 + HEAP.h / 2, 0], seg: 8, c: 'ash', name: 'ash' },
    // four logs along the axes: from the game camera they cross in an X under the flame
    ...around(4, feedLog),
    // embers in the gap between the front pair, where the camera looks in
    ember(0.24, 0.2, 0.08, 30),
    ember(0.34, 0.06, 0.07, 50),
    ember(0.2, 0.34, 0.07, 10),
    { use: 'flame', at: [0.04, 0.28, 0.04], params: { h: 0.8 }, scale: 0.9, palette: FIRE },
  ],
});
