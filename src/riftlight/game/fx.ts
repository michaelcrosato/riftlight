/**
 * Riftlight's particle presets (data, registered as `rl.<name>`; see docs/ENGINE.md,
 * Particles). Sizes are art pixels, colours step through the palette over a life.
 */
import type { ParticlePreset, Particles } from '../../engine';

export const FX = {
  /** Forge sparks: fast, hot, falling. */
  sparks: { count: [10, 14], life: [0.25, 0.55], speed: [2.5, 4.5], direction: [0, 1, 0], spread: 70, gravity: 9, drag: 1.2, size: [2, 1], colors: ['white', 'sand', 'orange', 'red'], radius: 0.05 },
  /** Embers drifting up from fires. */
  ember: { count: [1, 2], life: [1.2, 2.2], speed: [0.4, 0.9], direction: [0, 1, 0], spread: 25, gravity: -0.6, drag: 0.8, size: [2, 1], colors: ['sand', 'orange', 'red', 'plum'], radius: 0.18 },
  /** Fireflies: slow, wandering glints. */
  firefly: { count: [1, 1], life: [2.5, 4], speed: [0.15, 0.35], spread: 180, gravity: -0.02, drag: 0.2, size: [1, 1], colors: ['lime', 'sand', 'lime', 'green'], radius: 1.5, max: 64 },
  /** Rift motes rising around the obelisk. */
  mote: { count: [1, 2], life: [1.5, 2.8], speed: [0.3, 0.8], direction: [0, 1, 0], spread: 30, gravity: -0.5, drag: 0.5, size: [2, 1], colors: ['white', 'cyan', 'sky', 'blue'], radius: 0.9 },
  /** Chimney smoke. */
  chimney: { count: [1, 1], life: [2, 3.2], speed: [0.35, 0.6], direction: [0.2, 1, 0], spread: 15, gravity: -0.4, drag: 0.4, size: [3, 5], colors: ['mist', 'slate', 'night'], radius: 0.08 },
  /** Exit portal swirl. */
  portal: { count: [1, 3], life: [0.5, 1], speed: [0.6, 1.4], spread: 180, gravity: -0.8, drag: 1.5, size: [2, 1], colors: ['white', 'cyan', 'sky'], radius: 0.8 },
  /** Fire nova ring. */
  nova: { count: [40, 50], life: [0.35, 0.6], speed: [6, 9], spread: 90, flatten: 0.1, gravity: 0, drag: 3, size: [3, 1], colors: ['white', 'sand', 'orange', 'red'], radius: 0.3 },
  /** War cry burst. */
  cry: { count: [16, 20], life: [0.4, 0.7], speed: [2, 3.5], spread: 180, gravity: -2, drag: 2, size: [2, 1], colors: ['white', 'red', 'orange'], radius: 0.3 },
  /** Hit impact on flesh. */
  hit: { count: [5, 8], life: [0.15, 0.3], speed: [2, 4.5], spread: 60, gravity: 6, drag: 2, size: [2, 1], colors: ['white', 'red', 'plum'], radius: 0.1 },
  /** Level-up column. */
  levelup: { count: [30, 40], life: [0.6, 1.2], speed: [2, 4], direction: [0, 1, 0], spread: 25, gravity: -1, drag: 1, size: [2, 1], colors: ['white', 'sand', 'lime'], radius: 0.6 },
  /** Gold pickup glint. */
  coins: { count: [5, 7], life: [0.3, 0.5], speed: [1.5, 2.5], direction: [0, 1, 0], spread: 50, gravity: 5, drag: 1, size: [2, 1], colors: ['white', 'sand', 'orange'], radius: 0.1 },
  /** Mystic's orbiting-orb trail. */
  orb: { count: [1, 1], life: [0.4, 0.7], speed: [0.05, 0.2], spread: 180, gravity: -0.3, drag: 1, size: [2, 1], colors: ['cyan', 'sky', 'blue'], radius: 0.02 },
  /** Fountain spray. */
  spray: { count: [2, 3], life: [0.5, 0.8], speed: [1.6, 2.2], direction: [0, 1, 0], spread: 20, gravity: 7, drag: 0.2, size: [2, 1], colors: ['white', 'cyan', 'sky'], radius: 0.05 },
} satisfies Record<string, ParticlePreset>;

export function registerFx(particles: Particles): void {
  for (const [name, preset] of Object.entries(FX)) particles.register(`rl.${name}`, preset);
}
