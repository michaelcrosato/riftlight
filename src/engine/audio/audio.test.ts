import { describe, expect, it } from 'vitest';
import { AudioManager } from './AudioManager';
import { PLAYGROUND_SONG, parseSong, type Song } from './music';
import { SFX } from './sfx';
import { envelope, frequencyAt, noteFrequency, renderSound, soundDuration, type SoundDef } from './synth';

const SR = 8000;

/** Zero crossings per second in a window: a rough pitch probe. */
function crossings(s: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = Math.max(1, from); i < to; i++) if (s[i - 1]! < 0 !== s[i]! < 0) n++;
  return n / ((to - from) / SR);
}

describe('synth', () => {
  it('maps note names to equal-tempered pitches', () => {
    expect(noteFrequency('A4')).toBeCloseTo(440);
    expect(noteFrequency('C4')).toBeCloseTo(261.63, 1);
    expect(noteFrequency('C#5')).toBeCloseTo(554.37, 1);
    expect(noteFrequency('Bb3')).toBeCloseTo(233.08, 1);
    expect(noteFrequency('.')).toBeNull();
  });

  it('envelope ramps, holds and decays to silence', () => {
    const d: SoundDef = { wave: 'square', freq: 440, attack: 0.1, sustain: 0.2, decay: 0.1 };
    expect(envelope(d, 0)).toBe(0);
    expect(envelope(d, 0.05)).toBeCloseTo(0.5);
    expect(envelope(d, 0.2)).toBe(1);
    expect(envelope(d, 0.35)).toBeCloseTo(0.25);
    expect(envelope(d, 0.41)).toBe(0);
    expect(soundDuration(d)).toBeCloseTo(0.4);
  });

  it('sweeps pitch exponentially from freq to freqEnd', () => {
    const d: SoundDef = { wave: 'square', freq: 200, freqEnd: 800, attack: 0, sustain: 1, decay: 0.001 };
    expect(frequencyAt(d, 0)).toBeCloseTo(200);
    expect(frequencyAt(d, soundDuration(d) / 2)).toBeCloseTo(400, -1);
    const s = renderSound({ ...d, attack: 0.001 }, SR);
    expect(crossings(s, SR * 0.8, SR * 0.95)).toBeGreaterThan(crossings(s, SR * 0.05, SR * 0.2) * 2);
  });

  it('renders every built-in SFX: right length, bounded, silent at the end, deterministic', () => {
    for (const [name, def] of Object.entries(SFX) as [string, SoundDef][]) {
      const s = renderSound(def, SR);
      expect(s.length, name).toBe(Math.ceil(soundDuration(def) * SR));
      let peak = 0;
      for (const v of s) peak = Math.max(peak, Math.abs(v));
      expect(peak, name).toBeGreaterThan(0.02);
      expect(peak, name).toBeLessThanOrEqual(1);
      expect(Math.abs(s[s.length - 1]!), name).toBeLessThan(0.02);
      expect(renderSound(def, SR)).toEqual(s);
    }
  });
});

describe('music', () => {
  it('parses the playground song into timed notes with holds', () => {
    const p = parseSong(PLAYGROUND_SONG);
    expect(p.length).toBe(64);
    expect(p.stepTime).toBeCloseTo(60 / 128 / 4);
    const lead = p.notes.filter((n) => n.track === 'lead');
    expect(lead[0]).toMatchObject({ step: 0, steps: 1 });
    expect(lead.find((n) => n.step === 8)?.steps).toBe(2); // 'A5 -' holds
    expect(p.notes.every((n, i) => i === 0 || n.step >= p.notes[i - 1]!.step)).toBe(true);
  });

  it('rejects malformed patterns', () => {
    const bad: Song = { bpm: 120, tracks: { a: { wave: 'square' } }, patterns: { x: { a: 'C4 H9' } }, order: ['x'] };
    expect(() => parseSong(bad)).toThrow(/bad note/);
    const uneven: Song = { bpm: 120, tracks: { a: { wave: 'square' }, b: { wave: 'noise' } }, patterns: { x: { a: 'C4 .', b: 'C6' } }, order: ['x'] };
    expect(() => parseSong(uneven)).toThrow(/steps/);
  });
});

describe('AudioManager without Web Audio (headless)', () => {
  it('is a silent no-op that still records plays and persists settings safely', () => {
    const audio = new AudioManager(new EventTarget());
    expect(AudioManager.supported).toBe(false);
    expect(audio.play('jump')).toBe(false);
    expect(audio.play('coin')).toBe(false);
    expect(audio.counts).toEqual({ jump: 1, coin: 1 });
    expect(audio.log.map((l) => l.name)).toEqual(['jump', 'coin']);
    audio.playMusic(PLAYGROUND_SONG);
    audio.update();
    audio.setVolume('music', 2);
    expect(audio.volume.music).toBe(1);
    expect(audio.toggleMute()).toBe(true);
    audio.unlock();
    expect(audio.unlocked).toBe(false);
    audio.dispose();
  });
});
