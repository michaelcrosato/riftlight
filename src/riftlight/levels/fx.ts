import type { SoundDef } from '../../engine/audio/synth';
import type { ParticlePreset } from '../../engine/particles/pool';

/**
 * Level effects as data: particle presets (sizes in art pixels, PALETTE colours) and sound
 * effects (synthesised). `buildLevel` registers them with `ctx.particles` / `ctx.audio`, and
 * mechanics play them by name through `level.burst` / `level.sound`.
 */
export const LEVEL_PARTICLES = {
  ember: { count: [2, 4], life: [0.6, 1.2], speed: [0.6, 1.4], spread: 25, gravity: -1.4, drag: 0.8, size: [2, 1], colors: ['sand', 'orange', 'red'], radius: 0.2 },
  'ember-blast': { count: [26, 34], life: [0.3, 0.7], speed: [4, 8], spread: 80, flatten: 0.45, gravity: 4, drag: 2.2, size: [4, 1], colors: ['white', 'sand', 'orange', 'red', 'plum'], radius: 0.4 },
  wisp: { count: [2, 3], life: [0.8, 1.5], speed: [0.3, 0.7], spread: 40, gravity: -0.6, drag: 0.5, size: [2, 1], colors: ['white', 'cyan', 'sky'], radius: 0.3 },
  wind: { count: [5, 8], life: [0.35, 0.6], speed: [6, 9], spread: 8, flatten: 0.2, drag: 0.3, size: [3, 1], colors: ['white', 'mist'], radius: 0.6 },
  frost: { count: [16, 22], life: [0.3, 0.6], speed: [2.5, 5], spread: 90, flatten: 0.6, gravity: 5, drag: 1.5, size: [3, 1], colors: ['white', 'cyan', 'sky', 'blue'], radius: 0.3 },
  thorn: { count: [4, 6], life: [0.25, 0.45], speed: [1.5, 3], spread: 60, gravity: 6, drag: 1.5, size: [2, 1], colors: ['lime', 'green', 'red'], radius: 0.2 },
  spark: { count: [6, 10], life: [0.15, 0.35], speed: [3, 6], spread: 180, drag: 3, size: [2, 1], colors: ['white', 'sand', 'cyan'], radius: 0.15 },
  mud: { count: [2, 3], life: [0.3, 0.6], speed: [0.6, 1.2], spread: 30, gravity: 4, size: [2, 1], colors: ['slate', 'night'], radius: 0.4 },
  haste: { count: [10, 14], life: [0.3, 0.5], speed: [2, 3.5], spread: 50, gravity: -1, drag: 2, size: [2, 1], colors: ['white', 'lime', 'sand'], radius: 0.3 },
  echo: { count: [10, 14], life: [0.4, 0.7], speed: [1, 2.5], spread: 180, gravity: -0.8, drag: 2, size: [2, 1], colors: ['white', 'cyan', 'plum'], radius: 0.4 },
  rift: { count: [14, 20], life: [0.4, 0.8], speed: [1.5, 3.5], spread: 180, gravity: -0.5, drag: 2, size: [3, 1], colors: ['white', 'plum', 'red', 'navy'], radius: 0.4 },
  blood: { count: [22, 30], life: [0.3, 0.6], speed: [3, 6.5], spread: 85, flatten: 0.5, gravity: 7, drag: 1.5, size: [3, 1], colors: ['red', 'red', 'plum', 'ink'], radius: 0.35 },
  grav: { count: [8, 12], life: [0.5, 0.9], speed: [0.5, 1.2], spread: 180, gravity: -0.3, drag: 0.5, size: [2, 1], colors: ['white', 'blue', 'navy', 'plum'], radius: 1.2 },
  crumble: { count: [8, 12], life: [0.4, 0.8], speed: [0.8, 2], spread: 60, gravity: 8, drag: 0.6, size: [3, 1], colors: ['mist', 'slate', 'night'], radius: 0.45 },
  portal: { count: [12, 18], life: [0.5, 1], speed: [1, 2.5], spread: 30, gravity: -2, drag: 1, size: [3, 1], colors: ['white', 'cyan', 'sky', 'blue'], radius: 0.6 },
  loot: { count: [14, 20], life: [0.4, 0.8], speed: [2, 4], spread: 45, gravity: 3, drag: 1.2, size: [2, 1], colors: ['white', 'sand', 'orange'], radius: 0.2 },
} satisfies Record<string, ParticlePreset>;

export const LEVEL_SOUNDS = {
  'ember-boom': {
    wave: 'noise', freq: 1800, freqEnd: 200, attack: 0.002, sustain: 0.05, decay: 0.45, volume: 0.45, crush: 12,
    layers: [{ wave: 'triangle', freq: 140, freqEnd: 40, attack: 0.002, decay: 0.35, volume: 0.6 }],
  },
  lantern: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 4, 7, 12], arpRate: 0.06, attack: 0.002, sustain: 0.18, decay: 0.3, volume: 0.18 },
  gust: { wave: 'noise', freq: 600, freqEnd: 2400, attack: 0.15, sustain: 0.2, decay: 0.5, volume: 0.12 },
  shatter: {
    wave: 'noise', freq: 9000, freqEnd: 3000, attack: 0.001, decay: 0.25, volume: 0.25,
    layers: [{ wave: 'square', duty: 0.125, freq: 1800, freqEnd: 900, arp: [0, 7, 12], arpRate: 0.03, attack: 0.001, decay: 0.2, volume: 0.1 }],
  },
  thorn: { wave: 'noise', freq: 5000, freqEnd: 2000, attack: 0.001, decay: 0.06, volume: 0.14 },
  zap: {
    wave: 'square', duty: 0.125, freq: 1400, freqEnd: 200, vibrato: { depth: 3, rate: 60 }, attack: 0.001, sustain: 0.06, decay: 0.15, volume: 0.2,
    layers: [{ wave: 'noise', freq: 8000, attack: 0.001, decay: 0.15, volume: 0.15 }],
  },
  haste: { wave: 'square', duty: 0.25, freq: 440, freqEnd: 1320, attack: 0.002, sustain: 0.04, decay: 0.1, volume: 0.18 },
  echo: { wave: 'triangle', freq: 660, freqEnd: 330, vibrato: { depth: 0.4, rate: 8 }, attack: 0.02, sustain: 0.1, decay: 0.4, volume: 0.22 },
  warp: { wave: 'square', duty: 0.5, freq: 200, freqEnd: 1600, vibrato: { depth: 1, rate: 18 }, attack: 0.005, sustain: 0.1, decay: 0.2, volume: 0.2 },
  'blood-boom': {
    wave: 'noise', freq: 1200, freqEnd: 150, attack: 0.002, decay: 0.35, volume: 0.4,
    layers: [{ wave: 'square', duty: 0.5, freq: 110, freqEnd: 45, attack: 0.002, decay: 0.3, volume: 0.25 }],
  },
  'well-pulse': { wave: 'triangle', freq: 90, freqEnd: 50, vibrato: { depth: 0.5, rate: 6 }, attack: 0.2, sustain: 0.3, decay: 0.5, volume: 0.35 },
  crumble: { wave: 'noise', freq: 700, freqEnd: 150, attack: 0.01, sustain: 0.1, decay: 0.4, volume: 0.25, crush: 8 },
  chest: { wave: 'square', duty: 0.5, freq: 392, arp: [0, 4, 7, 12, 16], arpRate: 0.05, attack: 0.002, sustain: 0.25, decay: 0.3, volume: 0.2 },
  shrine: { wave: 'triangle', freq: 523.25, arp: [0, 7, 12, 19], arpRate: 0.08, vibrato: { depth: 0.2, rate: 5 }, attack: 0.01, sustain: 0.35, decay: 0.5, volume: 0.25 },
  'portal-open': { wave: 'square', duty: 0.25, freq: 220, freqEnd: 880, arp: [0, 7, 12], arpRate: 0.09, attack: 0.02, sustain: 0.4, decay: 0.6, volume: 0.22 },
} satisfies Record<string, SoundDef>;

export type LevelParticle = keyof typeof LEVEL_PARTICLES;
export type LevelSound = keyof typeof LEVEL_SOUNDS;
