import type { ParticlePreset } from '../../engine/particles';
import type { SoundDef } from '../../engine/audio';

/**
 * Combat sounds as data (the engine's SoundDef: pure, seeded synthesis). `registerCombatFx`
 * adds them to `ctx.audio`; skills name them in `look.sound`.
 */
export const COMBAT_SFX = {
  /** Blade through air: a quick rising noise sweep. */
  swing: { wave: 'noise', freq: 900, freqEnd: 5200, attack: 0.01, decay: 0.09, volume: 0.16 },
  /** Meaty hit: short noise crack over a low thump. */
  hit: {
    wave: 'noise', freq: 2600, freqEnd: 700, attack: 0.001, decay: 0.07, volume: 0.3,
    layers: [{ wave: 'triangle', freq: 180, freqEnd: 60, attack: 0.001, decay: 0.08, volume: 0.4 }],
  },
  /** Crit: the hit, brighter, with a ringing square on top. */
  crit: {
    wave: 'noise', freq: 4200, freqEnd: 900, attack: 0.001, decay: 0.1, volume: 0.34, crush: 12,
    layers: [
      { wave: 'triangle', freq: 200, freqEnd: 50, attack: 0.001, decay: 0.12, volume: 0.5 },
      { wave: 'square', duty: 0.125, freq: 1320, freqEnd: 880, attack: 0.001, sustain: 0.03, decay: 0.12, volume: 0.1 },
    ],
  },
  /** Spell cast: a shimmering rising arpeggio. */
  cast: { wave: 'square', duty: 0.25, freq: 440, freqEnd: 880, arp: [0, 7, 12], arpRate: 0.03, attack: 0.005, sustain: 0.04, decay: 0.12, volume: 0.12 },
  /** Projectile launch: a falling zip. */
  projectile: { wave: 'square', duty: 0.125, freq: 1600, freqEnd: 400, attack: 0.002, decay: 0.1, volume: 0.13 },
  /** Explosion: crushed noise boom. */
  explode: {
    wave: 'noise', freq: 1400, freqEnd: 120, attack: 0.002, sustain: 0.05, decay: 0.38, volume: 0.42, crush: 10,
    layers: [{ wave: 'triangle', freq: 120, freqEnd: 32, attack: 0.002, decay: 0.3, volume: 0.6 }],
  },
  /** Dodge roll / dash: a soft whoosh. */
  dodge: { wave: 'noise', freq: 600, freqEnd: 2800, attack: 0.03, decay: 0.14, volume: 0.13 },
  /** Lightning: buzzy saw with vibrato. */
  zap: { wave: 'saw', freq: 1800, freqEnd: 300, vibrato: { depth: 3, rate: 60 }, attack: 0.001, decay: 0.14, volume: 0.14, crush: 6 },
  /** Ice: a glassy high ping. */
  ice: { wave: 'triangle', freq: 2400, freqEnd: 1800, arp: [0, 5], arpRate: 0.04, attack: 0.001, decay: 0.22, volume: 0.2 },
  /** Fire tick: a soft crackle. */
  burn: { wave: 'noise', freq: 1800, freqEnd: 900, attack: 0.002, decay: 0.05, volume: 0.08 },
  /** Block: a metallic clank. */
  block: { wave: 'square', duty: 0.5, freq: 520, freqEnd: 480, attack: 0.001, decay: 0.12, volume: 0.15, layers: [{ wave: 'noise', freq: 6000, decay: 0.04, volume: 0.1 }] },
  /** Monster death pop. */
  die: { wave: 'square', duty: 0.25, freq: 300, freqEnd: 60, attack: 0.002, decay: 0.25, volume: 0.18, layers: [{ wave: 'noise', freq: 1200, freqEnd: 200, decay: 0.2, volume: 0.15 }] },
} satisfies Record<string, SoundDef>;

export type CombatSfx = keyof typeof COMBAT_SFX;

/** Combat particle presets (sizes in art pixels, palette colours). */
export const COMBAT_PARTICLES = {
  /** Weapon contact sparks. */
  spark: { count: [5, 8], life: [0.12, 0.25], speed: [3, 6], spread: 70, gravity: 8, drag: 3, size: [2, 1], colors: ['white', 'sand', 'orange'], radius: 0.1 },
  impactSmall: { count: [10, 14], life: [0.2, 0.35], speed: [3, 5], spread: 85, flatten: 0.4, gravity: 6, drag: 2.5, size: [3, 1], colors: ['white', 'sand', 'mist'], radius: 0.2 },
  fire: { count: [16, 22], life: [0.25, 0.5], speed: [2, 5], spread: 180, gravity: -2, drag: 3, size: [4, 1], colors: ['white', 'sand', 'orange', 'red', 'plum'], radius: 0.3 },
  ember: { count: [1, 2], life: [0.2, 0.4], speed: [0.3, 0.9], spread: 180, gravity: -2, drag: 2, size: [2, 1], colors: ['sand', 'orange', 'red'], radius: 0.08 },
  flames: { count: [2, 3], life: [0.3, 0.55], speed: [0.8, 1.6], direction: [0, 1, 0], spread: 20, gravity: -1.5, drag: 1.5, size: [3, 1], colors: ['sand', 'orange', 'red', 'plum'], radius: 0.25 },
  frost: { count: [14, 20], life: [0.3, 0.55], speed: [2, 4.5], spread: 180, flatten: 0.6, gravity: 2, drag: 3, size: [3, 1], colors: ['white', 'cyan', 'sky'], radius: 0.25 },
  frostTrail: { count: [1, 2], life: [0.2, 0.35], speed: [0.2, 0.6], spread: 180, gravity: 1, drag: 2, size: [2, 1], colors: ['white', 'cyan'], radius: 0.05 },
  zap: { count: [8, 12], life: [0.08, 0.2], speed: [4, 8], spread: 180, drag: 6, size: [2, 1], colors: ['white', 'cyan', 'sand'], radius: 0.15 },
  spark2: { count: [1, 2], life: [0.08, 0.15], speed: [1, 3], spread: 180, drag: 4, size: [1, 1], colors: ['white', 'cyan'], radius: 0.05 },
  toxic: { count: [10, 14], life: [0.3, 0.6], speed: [1, 3], spread: 180, gravity: -0.5, drag: 2, size: [3, 1], colors: ['lime', 'green', 'plum'], radius: 0.2 },
  blink: { count: [14, 18], life: [0.2, 0.4], speed: [1.5, 3], spread: 180, drag: 3, size: [2, 1], colors: ['white', 'cyan', 'sky', 'blue'], radius: 0.3 },
  swirl: { count: [2, 3], life: [0.15, 0.3], speed: [2, 4], spread: 90, flatten: 0.15, drag: 4, size: [2, 1], colors: ['white', 'mist'], radius: 0.6 },
  streak: { count: [1, 1], life: [0.08, 0.14], speed: [0, 0.2], spread: 180, size: [2, 1], colors: ['white', 'mist'], radius: 0.02 },
  bones: { count: [10, 14], life: [0.3, 0.6], speed: [2, 4], spread: 60, gravity: 9, drag: 1, size: [3, 2], colors: ['white', 'mist', 'slate'], radius: 0.3 },
  shout: { count: [20, 28], life: [0.2, 0.4], speed: [5, 8], spread: 90, flatten: 0.1, drag: 4, size: [3, 1], colors: ['white', 'red', 'plum'], radius: 0.3 },
  arrows: { count: [18, 24], life: [0.25, 0.4], speed: [7, 10], direction: [0, -1, 0], spread: 8, size: [1, 1], colors: ['sand', 'white'], radius: 1.6 },
  death: { count: [12, 18], life: [0.3, 0.6], speed: [1.5, 3.5], spread: 180, gravity: 3, drag: 2, size: [3, 1], colors: ['white', 'mist', 'slate', 'night'], radius: 0.3 },
  blood: { count: [6, 9], life: [0.2, 0.4], speed: [2, 4], spread: 50, gravity: 12, drag: 1.5, size: [2, 1], colors: ['red', 'plum'], radius: 0.1 },
} satisfies Record<string, ParticlePreset>;

/** Register every combat sound and particle preset (idempotent; call once per level). */
export function registerCombatFx(audio: { register(name: string, def: SoundDef): void } | null, particles: { register(name: string, p: ParticlePreset): void; presets: Map<string, ParticlePreset> } | null): void {
  if (audio) for (const [name, def] of Object.entries(COMBAT_SFX)) audio.register(name, def as SoundDef);
  if (particles) for (const [name, p] of Object.entries(COMBAT_PARTICLES)) if (particles.presets.get(name) !== p) particles.register(name, p as ParticlePreset);
}
