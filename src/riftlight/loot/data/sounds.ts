/**
 * Loot sounds as data (procedural SFX, see docs/ENGINE.md "Audio"). WorldLoot registers
 * them once with `ctx.audio.register(id, def)`. Rarer drops ring longer and higher.
 */
import type { SoundDef } from '../../../engine';

export const LOOT_SOUNDS: Readonly<Record<string, SoundDef>> = {
  'loot-normal': { wave: 'triangle', freq: 330, freqEnd: 220, attack: 0.002, sustain: 0.02, decay: 0.08, volume: 0.18 },
  'loot-magic': { wave: 'square', duty: 0.25, freq: 520, freqEnd: 660, attack: 0.002, sustain: 0.03, decay: 0.12, volume: 0.14, arp: [0, 7], arpRate: 0.05 },
  'loot-rare': { wave: 'square', duty: 0.25, freq: 660, attack: 0.002, sustain: 0.06, decay: 0.25, volume: 0.16, arp: [0, 4, 7, 12], arpRate: 0.05 },
  'loot-unique': {
    wave: 'square',
    duty: 0.125,
    freq: 440,
    attack: 0.005,
    sustain: 0.12,
    decay: 0.6,
    volume: 0.18,
    arp: [0, 7, 12, 16, 19, 24],
    arpRate: 0.06,
    layers: [{ wave: 'triangle', freq: 110, decay: 0.6, volume: 0.2 }],
  },
  'loot-currency': { wave: 'sine', freq: 1320, freqEnd: 1760, attack: 0.001, sustain: 0.02, decay: 0.15, volume: 0.14, arp: [0, 12], arpRate: 0.04 },
  'loot-gem': { wave: 'triangle', freq: 880, attack: 0.002, sustain: 0.05, decay: 0.3, volume: 0.15, arp: [0, 5, 10], arpRate: 0.05 },
  'loot-gold': { wave: 'square', duty: 0.5, freq: 988, attack: 0.001, sustain: 0.02, decay: 0.08, volume: 0.1, arp: [0, 5], arpRate: 0.03 },
  'loot-pickup': { wave: 'triangle', freq: 600, freqEnd: 900, attack: 0.001, sustain: 0.01, decay: 0.06, volume: 0.14 },
  'loot-craft': { wave: 'noise', freq: 3000, attack: 0.001, decay: 0.15, volume: 0.12, layers: [{ wave: 'square', duty: 0.25, freq: 784, decay: 0.2, volume: 0.1, arp: [0, 7], arpRate: 0.05 }] },
  'loot-deny': { wave: 'square', duty: 0.5, freq: 160, freqEnd: 120, attack: 0.001, sustain: 0.03, decay: 0.08, volume: 0.12 },
};
