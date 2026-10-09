import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager, muffleCutoff } from './AudioManager';
import { attenuation, spatialize } from './spatial';

describe('spatialize', () => {
  const listener = { position: [0, 0, 0] as const, right: [1, 0, 0] as const };

  it('is full volume inside ref, then falls off with distance, silent from max', () => {
    const o = { ref: 2, max: 30 };
    expect(attenuation(1, o)).toBe(1);
    expect(attenuation(2, o)).toBe(1);
    expect(attenuation(4, o)).toBeCloseTo(0.5, 5); // inverse distance: twice as far, half as loud
    expect(attenuation(8, o)).toBeCloseTo(0.25, 5);
    expect(attenuation(29.9, o)).toBeLessThan(0.01);
    expect(attenuation(30, o)).toBe(0);
    for (let d = 0; d < 30; d += 0.5) expect(attenuation(d + 0.5, o)).toBeLessThanOrEqual(attenuation(d, o));
  });

  it('pans by which side the sound is on, and not at all from in front or behind', () => {
    expect(spatialize(listener, [5, 0, 0]).pan).toBeCloseTo(1, 5);
    expect(spatialize(listener, [-5, 0, 0]).pan).toBeCloseTo(-1, 5);
    expect(spatialize(listener, [0, 0, -5]).pan).toBeCloseTo(0, 5);
    expect(spatialize(listener, [0, 0, 5]).pan).toBeCloseTo(0, 5);
    expect(spatialize(listener, [3, 0, -3]).pan).toBeCloseTo(Math.SQRT1_2, 5);
    // a turned listener: right is -z now
    expect(spatialize({ position: { x: 0, y: 0, z: 0 }, right: { x: 0, y: 0, z: -1 } }, { x: 0, y: 0, z: -4 }).pan).toBeCloseTo(1, 5);
  });

  it('centres a sound that is right on top of the listener (no flip from ear to ear)', () => {
    expect(spatialize(listener, [0, 0, 0]).pan).toBe(0);
    expect(Math.abs(spatialize(listener, [0.1, 0, 0], { ref: 1 }).pan)).toBeLessThan(0.11);
    expect(spatialize(listener, [3, 4, 0]).distance).toBeCloseTo(5);
  });

  it('muffle closes a low-pass from wide open to a thud', () => {
    expect(muffleCutoff(0)).toBe(20000);
    expect(muffleCutoff(1)).toBeCloseTo(400);
    expect(muffleCutoff(0.5)).toBeGreaterThan(400);
    expect(muffleCutoff(0.5)).toBeLessThan(20000);
  });
});

/** Just enough Web Audio to see what a voice wires up and sets. */
class FakeParam {
  value = 0;
  setTargetAtTime(v: number) {
    this.value = v; // the glide's destination
  }
}
class FakeNode {
  readonly outs: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    this.outs.push(n);
    return n;
  }
  disconnect() {
    this.outs.length = 0;
  }
}
class FakeContext {
  static made: FakeContext[] = [];
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  sources: (FakeNode & { loop: boolean; started: boolean; stopped: boolean; playbackRate: FakeParam })[] = [];
  constructor() {
    FakeContext.made.push(this);
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: Object.assign(new FakeParam(), { value: 1 }) });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam() });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam() });
  }
  createBufferSource() {
    const s = Object.assign(new FakeNode(), {
      buffer: null,
      loop: false,
      started: false,
      stopped: false,
      playbackRate: Object.assign(new FakeParam(), { value: 1 }),
      start() {
        s.started = true;
      },
      stop() {
        s.stopped = true;
      },
    });
    this.sources.push(s);
    return s;
  }
  createBuffer(_c: number, n: number) {
    return { length: n, copyToChannel() {} };
  }
  /** Decoding finishes when the test says so. */
  static finishDecode: (() => void) | null = null;
  decodeAudioData() {
    return new Promise((done) => (FakeContext.finishDecode = () => done({ length: 100 })));
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

describe('AudioManager.loop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('headless: keeps the settings it is given, clamped, and stops cleanly', () => {
    const audio = new AudioManager(new EventTarget());
    const v = audio.loop('coin', { volume: 0.5, pan: -3 });
    expect(v.sounding).toBe(false);
    v.set({ muffle: 0.4, pitch: 2, volume: Number.NaN });
    expect(v.settings).toEqual({ volume: 0.5, pan: -1, muffle: 0.4, pitch: 2 });
    expect(audio.loops).toEqual([v]);
    v.stop();
    expect(v.stopped).toBe(true);
    expect(audio.loops).toEqual([]);
    const a = audio.loop('jump');
    const b = audio.loop('land');
    audio.stopLoops(); // a level unloading
    expect([a.stopped, b.stopped, audio.loops.length]).toEqual([true, true, 0]);
    a.set({ volume: 0.2 }); // a stopped voice ignores changes
    expect(a.settings.volume).toBe(1);
    audio.dispose();
  });

  it('waits for audio to unlock, then loops through filter, gain and panner with its settings', () => {
    vi.stubGlobal('AudioContext', FakeContext);
    FakeContext.made = [];
    const audio = new AudioManager(new EventTarget());
    const v = audio.loop('coin', { volume: 0.3, pan: 0.5, muffle: 1 });
    expect(v.sounding).toBe(false); // locked: no context yet
    audio.unlock();
    audio.update(); // the frame after the first input: it starts
    const ctx = FakeContext.made[0]!;
    const src = ctx.sources[0]!;
    expect(src.loop).toBe(true);
    expect(src.started).toBe(true);
    expect(v.sounding).toBe(true);
    const filter = src.outs[0] as unknown as { frequency: FakeParam; outs: FakeNode[] };
    const gain = filter.outs[0] as unknown as { gain: FakeParam; outs: FakeNode[] };
    const panner = gain.outs[0] as unknown as { pan: FakeParam };
    expect(filter.frequency.value).toBeCloseTo(400);
    expect(gain.gain.value).toBeCloseTo(0.3);
    expect(panner.pan.value).toBeCloseTo(0.5);
    v.set({ volume: 0.9, pan: -0.25, muffle: 0, pitch: 12 });
    expect(gain.gain.value).toBeCloseTo(0.9);
    expect(panner.pan.value).toBeCloseTo(-0.25);
    expect(filter.frequency.value).toBe(20000);
    expect(src.playbackRate.value).toBeCloseTo(2);
    audio.update();
    expect(ctx.sources).toHaveLength(1); // started once
    audio.dispose();
    expect(src.stopped).toBe(true);
    expect(v.stopped).toBe(true);
    expect(gain.gain.value).toBe(0); // faded, not cut
    (src as unknown as { onended: () => void }).onended(); // once it has stopped: the whole chain comes off the bus
    expect([src.outs.length, filter.outs.length, gain.outs.length]).toEqual([0, 0, 0]);
  });

  it('says once that a loop has no sound, and keeps waiting for one', () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = new AudioManager(new EventTarget());
    audio.unlock();
    const v = audio.loop('not-yet');
    audio.update();
    audio.update();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(v.sounding).toBe(false);
    audio.register('not-yet', { wave: 'sine', freq: 440, sustain: 0.1 });
    audio.update();
    expect(v.sounding).toBe(true);
    warn.mockRestore();
    audio.dispose();
  });

  it('does not call a sound missing while its file is still loading', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = new AudioManager(new EventTarget());
    const loaded = audio.load('rain', 'rain.ogg'); // before the first input: decoded at unlock
    await new Promise((r) => setTimeout(r, 0));
    const v = audio.loop('rain');
    audio.unlock();
    audio.update();
    expect(warn).not.toHaveBeenCalled();
    FakeContext.finishDecode!();
    await loaded;
    await new Promise((r) => setTimeout(r, 0));
    audio.update();
    expect(v.sounding).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    audio.dispose();
  });
});
