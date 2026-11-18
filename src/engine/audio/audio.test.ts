import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from './AudioManager';
import { PLAYGROUND_SONG, parseSong, type Song } from './music';
import { SFX } from './sfx';
import { envelope, frequencyAt, noteFrequency, renderSound, soundDuration, type SoundDef } from './synth';
import { FakeContext, FakeNode, type FakeParam } from './testAudio';

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

  it('stores volume changes, except while persist is off (a replay)', () => {
    const stored = new Map<string, string>();
    const was = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) },
      configurable: true,
    });
    try {
      const audio = new AudioManager(new EventTarget());
      audio.setVolume('master', 0.5);
      expect(JSON.parse(stored.get('pixel-engine:audio')!)).toMatchObject({ master: 0.5, muted: false });
      audio.persist = false;
      audio.setVolume('master', 0.2);
      audio.setMuted(true);
      expect(audio.volume).toMatchObject({ master: 0.2, muted: true }); // heard
      expect(JSON.parse(stored.get('pixel-engine:audio')!)).toMatchObject({ master: 0.5, muted: false }); // not written
      audio.dispose();
    } finally {
      if (was) Object.defineProperty(globalThis, 'localStorage', was);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('AudioManager buses: music, sfx and the controller’s speaker', () => {
  afterEach(() => vi.unstubAllGlobals());
  type Gain = FakeNode & { gain: FakeParam };
  type Bus = 'sfx' | 'music' | 'speaker';
  const wired = (audio: AudioManager) => audio as unknown as { master: Gain; buses: Record<Bus, Gain>; speakerOut: Gain | null };
  /** The bus a sound's chain reaches (source → gain → panner → bus). */
  const busOf = (audio: AudioManager, from: FakeNode): Bus | undefined => {
    const buses = Object.entries(wired(audio).buses) as [Bus, Gain][];
    for (let at: FakeNode | undefined = from; at; at = at.outs[0]) {
      const hit = buses.find(([, g]) => g === at);
      if (hit) return hit[0];
    }
    return undefined;
  };

  it('plays a sound on the bus it names: music from an audio file follows the music volume', () => {
    vi.stubGlobal('AudioContext', FakeContext);
    FakeContext.made = [];
    const audio = new AudioManager(new EventTarget());
    audio.register('theme', { wave: 'triangle', freq: 220, sustain: 0.2 });
    audio.unlock();
    const ctx = FakeContext.made[0]!;
    expect(audio.play('theme', { bus: 'music' })).toBe(true);
    expect(busOf(audio, ctx.sources.at(-1)!)).toBe('music');
    audio.play('coin', { volume: 0.5, pan: 0.2 });
    expect(busOf(audio, ctx.sources.at(-1)!)).toBe('sfx');
    const loop = audio.loop('theme', { bus: 'music', volume: 0.4 });
    audio.update();
    expect(loop.bus).toBe('music');
    expect(busOf(audio, ctx.sources.at(-1)!)).toBe('music');
    expect(audio.loop('coin').bus).toBe('sfx');
    audio.dispose();
  });

  it('the buses play at the game’s own volumes × the player’s 52in1 ones; the master stays the game’s', () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const audio = new AudioManager(new EventTarget());
    audio.unlock();
    audio.setHubVolumes({ music: 0.5, effects: 0.25 });
    const { master, buses } = wired(audio);
    const own = audio.volume;
    expect(master.gain.value).toBe(own.master);
    expect(buses.music.gain.value).toBeCloseTo(own.music * 0.5);
    expect(buses.sfx.gain.value).toBeCloseTo(own.sfx * 0.25);
    expect(buses.speaker.gain.value).toBeCloseTo(own.sfx * 0.25);
    audio.setHubVolumes({ effects: 1 }); // the hub's change event
    expect(buses.sfx.gain.value).toBeCloseTo(own.sfx);
    expect(buses.music.gain.value).toBeCloseTo(own.music * 0.5);
    audio.dispose();
  });

  it('routes the speaker bus to the controller’s speaker once it opens, and back to the others without it', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    FakeContext.made = [];
    const audio = new AudioManager(new EventTarget());
    const controller = new FakeNode();
    const opened: unknown[] = [];
    const open = async (c: AudioContext) => (opened.push(c), controller as unknown as AudioNode);
    audio.useSpeaker(open); // before the first input: opened once audio unlocks
    expect(opened).toEqual([]);
    audio.unlock();
    const ctx = FakeContext.made[0]!;
    const w = wired(audio);
    expect(opened).toEqual([ctx]);
    expect(w.buses.speaker.outs).toEqual([w.master]); // until it resolves: with the other sounds
    await Promise.resolve();
    expect(audio.speakerRouted).toBe(true);
    expect(w.buses.speaker.outs).toEqual([w.speakerOut]);
    expect(w.speakerOut!.outs).toEqual([controller]);
    expect(w.speakerOut!.gain.value).toBe(audio.volume.master); // past the master node: the master again
    audio.play('coin', { bus: 'speaker' });
    expect(busOf(audio, ctx.sources.at(-1)!)).toBe('speaker');
    audio.setMuted(true);
    expect(w.speakerOut!.gain.value).toBe(0);
    audio.setMuted(false);
    audio.useSpeaker(open); // the same: not opened again
    expect(opened).toHaveLength(1);
    audio.useSpeaker(null); // the player turned the speaker off
    expect(audio.speakerRouted).toBe(false);
    expect(w.buses.speaker.outs).toEqual([w.master]);
    audio.useSpeaker(async () => null); // no DualSense speaker after all
    await Promise.resolve();
    expect(audio.speakerRouted).toBe(false);
    expect(w.buses.speaker.outs).toEqual([w.master]);
    audio.dispose();
  });

  it('a speaker opener that throws, gives no promise or no node only leaves the speaker bus with the other sounds', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    FakeContext.made = [];
    const audio = new AudioManager(new EventTarget());
    audio.useSpeaker(() => {
      throw new Error('the hub lost the controller');
    });
    audio.unlock();
    const ctx = FakeContext.made[0]!;
    expect(FakeContext.made, 'one context, kept').toHaveLength(1);
    expect(audio.context, 'audio still plays').toBe(ctx);
    const w = wired(audio);
    expect(w.buses.speaker.outs).toEqual([w.master]);
    expect(audio.play('coin', { bus: 'speaker' })).toBe(true);
    type Opener = (c: AudioContext) => Promise<AudioNode | null>;
    const settle = () => new Promise((r) => setTimeout(r, 0));
    for (const broken of [() => 'not a node, nor a promise', async () => ({ notANode: true })]) {
      audio.useSpeaker(broken as unknown as Opener);
      await settle();
      expect(audio.context).toBe(ctx);
      expect(audio.speakerRouted).toBe(false);
      expect(w.buses.speaker.outs).toEqual([w.master]);
    }
    const controller = new FakeNode();
    audio.useSpeaker((() => controller) as unknown as Opener); // a node without a promise works
    await settle();
    expect(audio.speakerRouted).toBe(true);
    expect(w.buses.speaker.outs).toEqual([w.speakerOut]);
    expect(w.speakerOut!.outs).toEqual([controller]);
    audio.dispose();
  });
});
