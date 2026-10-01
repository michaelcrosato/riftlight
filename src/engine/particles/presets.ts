import type { ParticlePreset } from './pool';

/**
 * Built-in particle effects, as data (see ParticlePreset). Register more with
 * `ctx.particles.register(name, preset)`. Sizes are art pixels; colors are PALETTE names.
 */
export const PARTICLES = {
  /** Landing puff: a flat ring of dust around the feet. */
  dust: {
    count: [7, 10], life: [0.25, 0.45], speed: [1.4, 2.4], spread: 90, flatten: 0.3,
    gravity: 2, drag: 3.5, size: [3, 1], colors: ['white', 'mist', 'slate'], radius: 0.15,
  },
  /** Skid puffs: a few small clouds kicked back (pass `direction`). */
  skid: {
    count: [2, 3], life: [0.2, 0.35], speed: [0.8, 1.6], spread: 40, flatten: 0.5,
    gravity: 1, drag: 3, size: [2, 1], colors: ['mist', 'slate'], radius: 0.1,
  },
  /** Coin pickup: a burst of bright twinkles that float away. */
  sparkle: {
    count: [10, 14], life: [0.3, 0.6], speed: [1.6, 3.2], spread: 180, gravity: -0.6,
    drag: 2.5, size: [2, 1], colors: ['white', 'sand', 'cyan'], radius: 0.1,
  },
  /** Slow rising smoke. */
  smoke: {
    count: [4, 6], life: [0.6, 1.0], speed: [0.3, 0.8], spread: 35, gravity: -1.2,
    drag: 1, size: [4, 2], colors: ['mist', 'slate', 'night'], radius: 0.2,
  },
  /** Ground-pound impact: a wide, fast, hot shockwave of debris. */
  impact: {
    count: [18, 24], life: [0.25, 0.5], speed: [3.5, 6], spread: 88, flatten: 0.22,
    gravity: 6, drag: 2.5, size: [4, 1], colors: ['white', 'sand', 'orange', 'plum'], radius: 0.25,
  },
} satisfies Record<string, ParticlePreset>;

export type ParticlePresetName = keyof typeof PARTICLES;
