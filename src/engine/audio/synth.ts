/**
 * Retro sound synthesis as pure functions (no Web Audio): a sound is data (`SoundDef`)
 * rendered to samples once, then played as a buffer. Deterministic (seeded noise), so
 * sounds are unit-testable and identical on every machine.
 */

export type Wave = 'square' | 'triangle' | 'saw' | 'sine' | 'noise';

export interface SoundDef {
  wave: Wave;
  /** Start pitch in Hz. For `noise` it is the sample-and-hold rate (higher = hissier). */
  freq: number;
  /** End pitch for a sweep (exponential glide from `freq`). */
  freqEnd?: number;
  /** Seconds the sweep takes (default: the whole sound). */
  sweepTime?: number;
  /** Square duty cycle: 0.125, 0.25 or 0.5 are the classic NES widths. Default 0.5. */
  duty?: number;
  /** Envelope (seconds): ramp up, hold at full volume, then fade out. */
  attack?: number;
  sustain?: number;
  decay?: number;
  /** Peak level 0..1 (default 0.5). */
  volume?: number;
  /** Arpeggio: semitone offsets stepped every `arpRate` seconds (the coin "ba-ding"). */
  arp?: readonly number[];
  arpRate?: number;
  /** Vibrato depth in semitones and rate in Hz. */
  vibrato?: { depth: number; rate: number };
  /** Quantize to this many levels (4-bit style crunch). 0 = off. */
  crush?: number;
  /** Seconds of silence before the sound starts (for layers). */
  delay?: number;
  /** Extra sounds mixed in (e.g. a noise burst under a thump). */
  layers?: readonly SoundDef[];
}

/** Seconds a sound lasts, including delays and layers. */
export function soundDuration(def: SoundDef): number {
  const own = (def.delay ?? 0) + (def.attack ?? 0.005) + (def.sustain ?? 0) + (def.decay ?? 0.1);
  return Math.max(own, ...(def.layers ?? []).map(soundDuration));
}

/** Envelope gain 0..1 at time `t` (seconds since the sound's own start). */
export function envelope(def: SoundDef, t: number): number {
  const a = def.attack ?? 0.005;
  const s = def.sustain ?? 0;
  const d = def.decay ?? 0.1;
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + s) return 1;
  if (t < a + s + d) {
    const k = 1 - (t - a - s) / d;
    return k * k; // quadratic: punchy like a hardware volume decay
  }
  return 0;
}

/** Instantaneous frequency (Hz) at time `t`: sweep, arpeggio and vibrato applied. */
export function frequencyAt(def: SoundDef, t: number): number {
  let f = def.freq;
  if (def.freqEnd !== undefined && def.freqEnd > 0 && f > 0) {
    const span = def.sweepTime ?? soundDuration({ ...def, layers: undefined, delay: 0 });
    const k = Math.min(1, Math.max(0, t / Math.max(span, 1e-4)));
    f = f * Math.pow(def.freqEnd / f, k);
  }
  if (def.arp?.length) {
    const step = Math.floor(t / (def.arpRate ?? 0.06));
    f *= Math.pow(2, def.arp[Math.min(step, def.arp.length - 1)]! / 12);
  }
  if (def.vibrato) f *= Math.pow(2, (def.vibrato.depth * Math.sin(2 * Math.PI * def.vibrato.rate * t)) / 12);
  return f;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Render a sound to mono samples in -1..1. */
export function renderSound(def: SoundDef, sampleRate = 44100, seed = 1): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.ceil(soundDuration(def) * sampleRate));
  mixInto(out, def, sampleRate, rng(seed));
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]!));
  return out;
}

function mixInto(out: Float32Array, def: SoundDef, sr: number, random: () => number): void {
  const start = Math.floor((def.delay ?? 0) * sr);
  const own = Math.ceil(soundDuration({ ...def, delay: 0, layers: undefined }) * sr);
  const vol = def.volume ?? 0.5;
  const duty = def.duty ?? 0.5;
  const levels = def.crush ?? 0;
  let phase = 0;
  let noise = random() * 2 - 1;
  for (let i = 0; i < own && start + i < out.length; i++) {
    const t = i / sr;
    const f = frequencyAt(def, t);
    const prev = phase;
    phase = (phase + f / sr) % 1;
    let v: number;
    switch (def.wave) {
      case 'square':
        v = phase < duty ? 1 : -1;
        break;
      case 'triangle':
        v = 1 - 4 * Math.abs(phase - 0.5);
        break;
      case 'saw':
        v = 2 * phase - 1;
        break;
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      case 'noise':
        if (phase < prev) noise = random() * 2 - 1; // new random level every cycle
        v = noise;
        break;
    }
    if (levels > 1) v = Math.round(((v + 1) / 2) * (levels - 1)) / (levels - 1) * 2 - 1;
    out[start + i]! += v * vol * envelope(def, t);
  }
  for (const layer of def.layers ?? []) {
    const sub = new Float32Array(out.length - start);
    mixInto(sub, layer, sr, random);
    for (let i = 0; i < sub.length; i++) out[start + i]! += sub[i]!;
  }
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'A4' → 440, 'C#5', 'Eb3'… Returns null for anything that is not a note. */
export function noteFrequency(note: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!m) return null;
  const semis = NOTE_INDEX[m[1]!.toUpperCase()]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
