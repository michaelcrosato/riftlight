// 52in1's microphone as a shout's loudness (`Microphone`, docs/engine/hub.md *Shouts*),
// without a browser: a fake AIHubSettings hands out a fake stream, and a fake AudioContext's
// analyser says how loud it is. It opens through the hub once while the game listens and the
// player lets it hear them, and closes (its tracks stopped) as soon as either ends; headless, the
// engine makes none at all.
import { Vector3 } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../Engine';
import { Input, VOICE_KEYS } from '../input';
import { Microphone } from './microphone';
import { HubSettings } from './settings';

/** A stream whose one track says when it is stopped (and ends then, as a real one does). */
function fakeStream() {
  const track = { stopped: false, readyState: 'live' as 'live' | 'ended', stop: () => void Object.assign(track, { stopped: true, readyState: 'ended' }) };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

/** window.AIHubSettings with the microphone allowed (or not), and an AudioContext whose analyser hears `loud`. */
function world(o: { mic?: boolean; muted?: boolean; context?: boolean } = {}) {
  const streams: ReturnType<typeof fakeStream>[] = [];
  const source = Object.assign(new EventTarget(), {
    mic: o.mic ?? true,
    muted: o.muted ?? false,
    openMicrophone: vi.fn(async () => {
      const s = fakeStream();
      streams.push(s);
      return s.stream;
    }),
  });
  const hub = new HubSettings(source);
  const heard = { loud: 0, on: true };
  const connected: unknown[] = [];
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData: (out: Float32Array) => out.forEach((_, i) => (out[i] = i % 2 ? heard.loud : -heard.loud)),
  };
  const context = { createAnalyser: () => analyser, createMediaStreamSource: (s: MediaStream) => ({ connect: (n: unknown) => connected.push([s, n]), disconnect: () => connected.pop() }) } as unknown as AudioContext;
  const ctx = { now: o.context === false ? null : context };
  /** The controller's speaker plays (a sound on the `speaker` bus, or its tail). */
  const speaker = { playing: false };
  const mic = new Microphone(hub, () => hub.micAllowed && heard.on, () => ctx.now, () => speaker.playing);
  /** The hub changes a setting (the player, in 52in1's Settings; the DualSense's mute button). */
  const change = (patch: { mic?: boolean; muted?: boolean }) => {
    Object.assign(source, patch);
    source.dispatchEvent(new Event('change'));
  };
  return { mic, source, streams, heard, ctx, context, change, connected, speaker };
}

/** Let the hub's answer arrive. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Microphone (52in1’s, for shouts)', () => {
  it('opens through the hub once while the game listens, and hears the stream’s loudness (RMS)', async () => {
    const w = world();
    expect(w.mic.level(), 'nothing yet').toBeNull();
    w.mic.listen(true);
    w.mic.listen(true);
    await settle();
    w.mic.listen(true);
    w.mic.listen(true);
    expect(w.source.openMicrophone, 'asked once').toHaveBeenCalledTimes(1);
    expect([w.mic.open, w.connected.length]).toEqual([true, 1]);
    w.heard.loud = 0.5;
    expect(w.mic.level()).toBeCloseTo(0.5, 6);
    w.heard.loud = 0;
    expect(w.mic.level()).toBe(0);
  });

  it('closes, its tracks stopped, when the game stops listening, the voice setting goes off, the microphone is muted or no longer allowed; and opens again after', async () => {
    const w = world();
    const open = async () => {
      w.mic.listen(true);
      await settle();
      w.mic.listen(true);
      return w.streams.at(-1)!;
    };
    const cases: [string, () => void, () => void][] = [
      ['the game stops listening', () => w.mic.listen(false), () => {}],
      ['the voice setting off', () => (w.heard.on = false), () => (w.heard.on = true)],
      ['muted', () => w.change({ muted: true }), () => w.change({ muted: false })],
      ['no longer allowed', () => w.change({ mic: false }), () => w.change({ mic: true })],
    ];
    for (const [why, off, back] of cases) {
      const s = await open();
      expect([why, s.track.stopped, w.mic.open]).toEqual([why, false, true]);
      off();
      w.mic.listen(true); // Input's next poll: the game still listens
      expect([why, s.track.stopped, w.mic.open, w.mic.level(), w.connected.length]).toEqual([why, true, false, null, 0]);
      back();
    }
    expect(w.source.openMicrophone, 'opened again after each').toHaveBeenCalledTimes(cases.length);
  });

  it('never asks while the game’s voice feature is off, the microphone not allowed or muted', async () => {
    for (const o of [{ mic: false }, { muted: true }]) {
      const w = world(o);
      w.mic.listen(true);
      await settle();
      expect(w.source.openMicrophone).not.toHaveBeenCalled();
    }
    const w = world();
    w.heard.on = false;
    w.mic.listen(true);
    await settle();
    expect(w.source.openMicrophone).not.toHaveBeenCalled();
  });

  it('a stream that arrives after it closed is stopped at once; one the hub refuses is not asked for again until it closes', async () => {
    const w = world();
    w.mic.listen(true);
    w.mic.listen(false);
    await settle();
    expect([w.streams[0]!.track.stopped, w.mic.open], 'stopped as it arrives, not kept').toEqual([true, false]);
    w.mic.listen(false);
    expect([w.streams[0]!.track.stopped, w.mic.open]).toEqual([true, false]);
    w.source.openMicrophone.mockImplementation(async () => null as unknown as MediaStream);
    for (let k = 0; k < 5; k++) {
      w.mic.listen(true);
      await settle();
    }
    expect(w.source.openMicrophone, 'refused once: not asked every poll').toHaveBeenCalledTimes(2);
  });

  it('asks again when the stream’s tracks end on their own (the DualSense unplugged); one that arrives ended is let go, not asked for every poll', async () => {
    const w = world();
    w.mic.listen(true);
    await settle();
    w.mic.listen(true);
    expect([w.mic.open, w.connected.length]).toEqual([true, 1]);
    w.streams[0]!.track.readyState = 'ended'; // the device went: the analyser would hear silence for ever
    w.mic.listen(true);
    await settle();
    w.mic.listen(true);
    expect(w.source.openMicrophone, 'asked again').toHaveBeenCalledTimes(2);
    expect([w.mic.open, w.connected.length, w.streams[1]!.track.stopped], 'the new stream heard, the old one let go').toEqual([true, 1, false]);
    w.heard.loud = 0.5;
    expect(w.mic.level()).toBeCloseTo(0.5, 6);
    // 52in1 answers with a stream already ended (no microphone left): none, until it closes
    w.source.openMicrophone.mockImplementation(async () => {
      const s = fakeStream();
      s.track.readyState = 'ended';
      w.streams.push(s);
      return s.stream;
    });
    w.streams[1]!.track.readyState = 'ended';
    for (let k = 0; k < 5; k++) {
      w.mic.listen(true);
      await settle();
    }
    expect(w.source.openMicrophone, 'once more, not on every poll').toHaveBeenCalledTimes(3);
    expect([w.mic.open, w.mic.level(), w.connected.length]).toEqual([false, null, 0]);
  });

  it('hears nothing before the engine has sound (the first key or click), then hears it', async () => {
    const w = world({ context: false });
    w.mic.listen(true);
    await settle();
    w.mic.listen(true);
    w.heard.loud = 0.5;
    expect([w.mic.open, w.mic.level()]).toEqual([true, null]);
    w.ctx.now = w.context;
    w.mic.listen(true);
    expect(w.mic.level()).toBeCloseTo(0.5, 6);
  });

  it('a shout through it presses VoiceShout on Input, and a replay never asks it', async () => {
    const w = world();
    const input = new Input(null);
    input.microphone = w.mic;
    input.voice = true;
    input.setGamepads([]);
    let t = 0;
    const frame = () => {
      t += 1 / 60;
      input.beginFrame(t, 1 / 60);
      const pressed = input.wasPressed(VOICE_KEYS.shout);
      input.endFrame();
      return pressed;
    };
    frame();
    await settle();
    w.heard.loud = 0.5;
    expect(Array.from({ length: 30 }, frame).filter(Boolean)).toHaveLength(1);
    input.playing = true;
    frame();
    expect([w.streams[0]!.track.stopped, w.mic.open], 'a replay: closed').toEqual([true, false]);
    for (let k = 0; k < 5; k++) frame();
    await settle();
    expect(w.source.openMicrophone, 'never asked during it').toHaveBeenCalledTimes(1);
  });

  it('while the controller’s speaker plays (and a tail after) it is an echo: a shout through it presses nothing then', async () => {
    const w = world();
    const input = new Input(null);
    input.microphone = w.mic;
    input.voice = true;
    input.setGamepads([]);
    let t = 0;
    const frames = (n: number) => {
      let presses = 0;
      for (let k = 0; k < n; k++) {
        t += 1 / 60;
        input.beginFrame(t, 1 / 60);
        presses += input.wasPressed(VOICE_KEYS.shout) ? 1 : 0;
        input.endFrame();
      }
      return presses;
    };
    frames(1);
    await settle();
    expect(w.mic.echo).toBe(false);
    w.speaker.playing = true; // the portal from the DualSense's speaker, beside its microphone
    w.heard.loud = 0.5;
    expect([w.mic.echo, frames(60)], 'the speaker heard: no shout').toEqual([true, 0]);
    w.speaker.playing = false;
    expect([w.mic.echo, frames(30)], 'the player still shouting after it').toEqual([false, 1]);
  });

  it('headless, the engine makes none, even with 52in1’s settings allowing the microphone', async () => {
    const w = world();
    const engine = await Engine.headless({ name: 'Mic', setup() {}, cameraTarget: () => new Vector3() }, { hubSettings: w.source });
    try {
      engine.input.voice = true;
      engine.step(10);
      expect([engine.voiceOn, engine.microphone, engine.input.microphone]).toEqual([true, null, null]);
      expect(w.source.openMicrophone).not.toHaveBeenCalled();
    } finally {
      engine.dispose();
    }
  });
});
