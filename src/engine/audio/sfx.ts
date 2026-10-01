import type { SoundDef } from './synth';

/**
 * Built-in retro sound effects, as data. Tweak numbers here (or register your own with
 * `ctx.audio.register(name, def)`) and every `ctx.audio.play(name)` picks them up.
 * See docs/ENGINE.md (Audio) for the SoundDef fields.
 */
export const SFX = {
  /** Short rising square chirp. */
  jump: { wave: 'square', duty: 0.25, freq: 260, freqEnd: 640, attack: 0.004, sustain: 0.05, decay: 0.12, volume: 0.28 },
  /** Higher, thinner chirp with a fifth on top. */
  doubleJump: { wave: 'square', duty: 0.125, freq: 360, freqEnd: 900, arp: [0, 7], arpRate: 0.06, attack: 0.004, sustain: 0.07, decay: 0.14, volume: 0.26 },
  /** Soft thud: a falling triangle under a short noise puff. */
  land: {
    wave: 'triangle', freq: 150, freqEnd: 55, attack: 0.002, decay: 0.09, volume: 0.55,
    layers: [{ wave: 'noise', freq: 1400, freqEnd: 500, attack: 0.002, decay: 0.07, volume: 0.18 }],
  },
  /** The classic two-note pickup (B5 → E6). */
  coin: { wave: 'square', duty: 0.5, freq: 987.77, arp: [0, 5], arpRate: 0.075, attack: 0.002, sustain: 0.1, decay: 0.28, volume: 0.22 },
  /** A tiny tick per footstep. */
  step: { wave: 'noise', freq: 2600, freqEnd: 1200, attack: 0.001, decay: 0.035, volume: 0.1 },
  /** Shoe squeal: hissy noise plus a wobbling high square. */
  skid: {
    wave: 'noise', freq: 7000, freqEnd: 3000, attack: 0.01, sustain: 0.12, decay: 0.12, volume: 0.12,
    layers: [{ wave: 'square', duty: 0.125, freq: 760, freqEnd: 520, vibrato: { depth: 0.6, rate: 28 }, attack: 0.01, sustain: 0.1, decay: 0.1, volume: 0.08 }],
  },
  /** Whack: noise burst over a dropping square. */
  punch: {
    wave: 'noise', freq: 3000, freqEnd: 500, attack: 0.001, decay: 0.09, volume: 0.32,
    layers: [{ wave: 'square', duty: 0.5, freq: 220, freqEnd: 70, attack: 0.001, decay: 0.07, volume: 0.18 }],
  },
  /** Big low boom for the ground-pound impact. */
  groundPound: {
    wave: 'triangle', freq: 170, freqEnd: 38, attack: 0.002, sustain: 0.04, decay: 0.32, volume: 0.75, crush: 16,
    layers: [{ wave: 'noise', freq: 900, freqEnd: 180, attack: 0.002, decay: 0.3, volume: 0.32 }],
  },
  /** Spin-up whoosh before the pound falls. */
  whoosh: { wave: 'noise', freq: 500, freqEnd: 4000, attack: 0.06, decay: 0.16, volume: 0.12 },
  /** Descending, wobbly "ouch". */
  hurt: { wave: 'square', duty: 0.5, freq: 620, freqEnd: 140, vibrato: { depth: 1, rate: 24 }, attack: 0.004, sustain: 0.14, decay: 0.22, volume: 0.26 },
  /** Victory fanfare arpeggio. */
  fanfare: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 4, 7, 12, 7, 12], arpRate: 0.1, attack: 0.004, sustain: 0.55, decay: 0.3, volume: 0.24 },
} satisfies Record<string, SoundDef>;

export type SfxName = keyof typeof SFX;
