// The player's 52in1 settings (window.AIHubSettings, catalogue *Settings and the DualSense*) and a
// DualSense's outputs, headless: a fake settings object is passed in (no globals are stubbed), the
// way the hub's companion script hands it to a page (an EventTarget that says 'change').
import { Vector3 } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../audio/AudioManager';
import { Engine, type Game, type GameContext } from '../Engine';
import { PALETTE } from '../palette';
import { DualSense } from './dualsense';
import { LocalHub } from './local';
import { HubSession } from './session';
import { HubSettings, type HubSettingsSource, NO_HUB_SETTINGS, readHubSettings, type TriggerEffect } from './settings';

type Call = ['light', string | null] | ['trigger', string, TriggerEffect | null] | ['speaker'] | ['mic'];

/** window.AIHubSettings as companion.js makes it, with a DualSense whose motion must never be read. */
function fakeHub(o: { music?: number; effects?: number; mic?: boolean; micLater?: boolean; dualsense?: Record<string, boolean> | null } = {}) {
  const calls: Call[] = [];
  const read: string[] = [];
  const speakerNode = { speaker: true } as unknown as AudioNode;
  const stream = { mic: true } as unknown as MediaStream;
  const dualsense = {
    connected: true,
    lightbar: true,
    triggers: true,
    motion: true,
    touchpad: true,
    speaker: false,
    aim: false,
    ...o.dualsense,
    light: (c: string | null) => void calls.push(['light', c]),
    trigger: (which: string, effect: TriggerEffect | null) => void calls.push(['trigger', which, effect]),
    openSpeaker: async () => (calls.push(['speaker']), speakerNode),
  };
  // reading these turns the hub's Motion aim off: input comes through ctx.input, never from here
  for (const field of ['gyro', 'accel', 'touches']) Object.defineProperty(dualsense, field, { enumerable: true, get: () => (read.push(field), field === 'touches' ? [] : { x: 0, y: 0, z: 0 }) });
  const source = Object.assign(new EventTarget(), {
    version: 1,
    music: o.music ?? 0.5,
    effects: o.effects ?? 0.25,
    vibration: 0.8,
    mic: o.mic ?? false,
    micLater: o.micLater ?? false,
    muted: false,
    dualsense: o.dualsense === null ? undefined : dualsense,
    openMicrophone: async () => (calls.push(['mic']), stream),
  });
  /** The player changes a setting in the hub's Settings, over the game. */
  const change = (patch: Partial<typeof source> & { ds?: Record<string, boolean> }) => {
    const { ds, ...rest } = patch;
    Object.assign(source, rest);
    if (ds) Object.assign(dualsense, ds);
    source.dispatchEvent(new Event('change'));
  };
  return { source: source as HubSettingsSource, calls, read, change, speakerNode, stream };
}

const lights = (calls: Call[]) => calls.filter((c) => c[0] === 'light').map((c) => c[1]);
const triggers = (calls: Call[]) => calls.filter((c) => c[0] === 'trigger').map((c) => c.slice(1));

describe('readHubSettings', () => {
  it('outside 52in1: full volumes, full vibration, no microphone, no DualSense', () => {
    expect(readHubSettings(null)).toBe(NO_HUB_SETTINGS);
    expect(readHubSettings()).toBe(NO_HUB_SETTINGS); // Node: no window.AIHubSettings
    expect(NO_HUB_SETTINGS).toMatchObject({ music: 1, effects: 1, vibration: 1, mic: false, micLater: false, muted: false, dualsense: { connected: false, lightbar: false, triggers: false, speaker: false } });
  });

  it('reads the hub’s values, holds them to 0..1, and the extras only while a DualSense is connected', () => {
    const hub = fakeHub({ music: 3, effects: Number.NaN, mic: true });
    const v = readHubSettings(hub.source);
    expect(v).toMatchObject({ music: 1, effects: 1, vibration: 0.8, mic: true, micLater: false });
    expect(v.dualsense).toEqual({ connected: true, lightbar: true, triggers: true, motion: true, touchpad: true, speaker: false, aim: false });
    const off = readHubSettings(fakeHub({ dualsense: { connected: false, lightbar: true, triggers: true } }).source);
    expect(off.dualsense.lightbar || off.dualsense.triggers).toBe(false);
    expect(readHubSettings(fakeHub({ dualsense: null }).source).dualsense.connected).toBe(false);
    expect(hub.read, 'never reads gyro, accel or touches').toEqual([]);
  });
});

describe('HubSettings', () => {
  it('follows the hub’s change event until disposed', () => {
    const hub = fakeHub();
    const s = new HubSettings(hub.source);
    const seen: number[] = [];
    s.onChange((v) => seen.push(v.music));
    expect(s.present).toBe(true);
    hub.change({ music: 0.1 });
    expect(s.values.music).toBe(0.1);
    s.dispose();
    hub.change({ music: 0.9 });
    expect(seen).toEqual([0.1]);
    expect(s.values.music).toBe(0.1);
    expect(new HubSettings(null).present).toBe(false);
  });

  it('opens the microphone only once the player allowed it, never during a replay', async () => {
    const hub = fakeHub({ micLater: true });
    let replaying = false;
    const s = new HubSettings(hub.source, () => !replaying);
    expect([s.micAllowed, s.micLater]).toEqual([false, true]); // "open the game again"
    expect(await s.openMicrophone()).toBeNull();
    hub.change({ mic: true, micLater: false });
    replaying = true;
    expect(await s.openMicrophone()).toBeNull();
    replaying = false;
    expect(await s.openMicrophone()).toBe(hub.stream);
    expect(hub.calls).toEqual([['mic']]); // asked for once, when allowed
    expect(await new HubSettings(null).openMicrophone()).toBeNull();
  });
});

describe('DualSense', () => {
  it('colours the light bar only while the player allows it, sending only changes', () => {
    const hub = fakeHub({ dualsense: { lightbar: false } });
    const ds = new DualSense(new HubSettings(hub.source));
    ds.light('#FF0000');
    expect(lights(hub.calls)).toEqual([]); // not allowed: the hub's
    hub.change({ ds: { lightbar: true } });
    expect(lights(hub.calls)).toEqual(['#ff0000']); // allowed now: what the game wants is sent
    ds.light('#ff0000');
    ds.light(0xff0000);
    ds.light(PALETTE.green);
    ds.light(PALETTE.green);
    expect(lights(hub.calls)).toEqual(['#ff0000', '#38b764']);
    expect(ds.sent.light).toBe('#38b764');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ds.light('red');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    ds.light(null);
    expect(lights(hub.calls)).toEqual(['#ff0000', '#38b764', null]);
    expect(hub.read).toEqual([]);
  });

  it('pushes the triggers back only while trigger effects are on; both sides at once when they agree', () => {
    const hub = fakeHub({ dualsense: { triggers: false } });
    const ds = new DualSense(new HubSettings(hub.source));
    const bow: TriggerEffect = { kind: 'resist', from: 0.2, strength: 0.7 };
    ds.trigger('right', bow);
    expect(triggers(hub.calls)).toEqual([]);
    hub.change({ ds: { triggers: true } });
    ds.trigger('right', bow);
    ds.trigger('left', { kind: 'weapon', from: 0.4, to: 0.2, strength: 3 }); // to before from, too strong
    ds.trigger('both', null);
    ds.trigger('both', null);
    ds.trigger('both', { kind: 'vibrate', from: 0, strength: 0.5, frequency: 900 });
    expect(triggers(hub.calls)).toEqual([
      ['left', null], // turned on: what is wanted on each side (the hub had them), a let-go too
      ['right', bow],
      ['left', { kind: 'weapon', from: 0.4, to: 0.4, strength: 1 }],
      ['both', null],
      ['both', { kind: 'vibrate', from: 0, strength: 0.5, frequency: 255 }],
    ]);
  });

  it('lets the triggers go while paused and pushes back again after; release and close give everything back', () => {
    const hub = fakeHub();
    const ds = new DualSense(new HubSettings(hub.source));
    const gun: TriggerEffect = { kind: 'weapon', from: 0.3, to: 0.6, strength: 0.8 };
    ds.light('#00ff00');
    ds.trigger('right', gun);
    ds.hold(true);
    ds.hold(false);
    expect(triggers(hub.calls)).toEqual([['right', gun], ['right', null], ['right', gun]]);
    ds.release();
    expect(hub.calls.slice(-2)).toEqual([['light', null], ['trigger', 'right', null]]);
    ds.light('#0000ff');
    ds.close();
    ds.light('#ffffff'); // after the end: nothing
    ds.trigger('left', gun);
    expect(hub.calls.slice(-2)).toEqual([['light', '#0000ff'], ['light', null]]);
    expect(ds.sent).toEqual({ light: null, left: null, right: null });
  });

  it('lets go even while the player has the extras off, and sends what is wanted, a let-go too, once they are on again', () => {
    const hub = fakeHub();
    const ds = new DualSense(new HubSettings(hub.source));
    const gun: TriggerEffect = { kind: 'weapon', from: 0.3, to: 0.6, strength: 0.8 };
    ds.light('#ff0000');
    ds.trigger('right', gun);
    hub.change({ ds: { lightbar: false, triggers: false } }); // the player takes them back
    const mark = hub.calls.length;
    ds.trigger('right', null); // its use ends while the hub has the triggers
    ds.release(); // a level unloads
    ds.light(null); // asked again, every frame: sent once
    ds.trigger('both', null);
    expect(hub.calls.slice(mark)).toEqual([['trigger', 'right', null], ['light', null]]);
    ds.light('#00ff00'); // a colour is not sent while the hub has the light bar
    expect(hub.calls.slice(mark)).toHaveLength(2);
    hub.change({ ds: { lightbar: true, triggers: true } });
    expect(hub.calls.slice(mark + 2)).toEqual([['light', '#00ff00'], ['trigger', 'both', null]]);
    // off again, everything given back (a round's close), on again: the hub hears the nulls
    hub.change({ ds: { lightbar: false, triggers: false } });
    ds.trigger('left', gun);
    ds.close();
    hub.calls.length = 0;
    hub.change({ ds: { lightbar: true, triggers: true } });
    expect(hub.calls).toEqual([['light', null], ['trigger', 'both', null]]);
    expect(ds.sent).toEqual({ light: null, left: null, right: null });
  });

  it('sends nothing outside 52in1, without a DualSense, or during a replay', () => {
    const none = new DualSense(new HubSettings(null));
    none.light('#ff0000');
    none.trigger('both', { kind: 'resist', from: 0, strength: 1 });
    expect(none.sent).toEqual({ light: null, left: null, right: null });
    const unplugged = fakeHub({ dualsense: { connected: false } });
    new DualSense(new HubSettings(unplugged.source)).light('#ff0000');
    expect(unplugged.calls).toEqual([]);
    const hub = fakeHub();
    let replaying = true;
    const ds = new DualSense(new HubSettings(hub.source), () => !replaying);
    ds.light('#ff0000');
    ds.trigger('left', { kind: 'resist', from: 0, strength: 1 });
    replaying = false;
    expect(hub.calls).toEqual([]);
  });

  it('opens the controller’s speaker only while the player allows it', async () => {
    const hub = fakeHub();
    const ds = new DualSense(new HubSettings(hub.source));
    const context = {} as AudioContext;
    expect(await ds.openSpeaker(context)).toBeNull();
    hub.change({ ds: { speaker: true } });
    expect(await ds.openSpeaker(context)).toBe(hub.speakerNode);
    expect(await new DualSense(new HubSettings(null)).openSpeaker(context)).toBeNull();
  });
});

describe('AudioManager and the player’s 52in1 volumes', () => {
  it('multiplies music by the hub’s music and every other sound by its effects, never its master', () => {
    const audio = new AudioManager(null);
    audio.setVolume('master', 0.8);
    audio.setVolume('music', 0.6);
    audio.setVolume('sfx', 1);
    expect(audio.levels).toEqual({ master: 0.8, sfx: 1, music: 0.6 }); // no hub: the game's own
    audio.setHubVolumes({ music: 0.5, effects: 0.25 });
    expect(audio.levels.master).toBe(0.8);
    expect(audio.levels.music).toBeCloseTo(0.3);
    expect(audio.levels.sfx).toBeCloseTo(0.25);
    audio.setVolume('music', 1); // the game's own setting stays and multiplies
    expect(audio.levels.music).toBeCloseTo(0.5);
    expect(audio.volume).toMatchObject({ master: 0.8, music: 1, sfx: 1 }); // the hub's are not the game's
    audio.setHubVolumes({ music: 7, effects: Number.NaN });
    expect(audio.hubVolumes).toEqual({ music: 1, effects: 0.25 });
    audio.setMuted(true);
    expect(audio.levels.master).toBe(0);
    audio.dispose();
  });
});

/** A game that colours the light bar every frame and holds R2, as a game would. */
class Lamp implements Game {
  readonly name = 'Lamp';
  colour: number = PALETTE.red;
  setup(): void {}
  update(ctx: GameContext): void {
    ctx.dualsense.light(this.colour);
    ctx.dualsense.trigger('right', { kind: 'resist', from: 0.5, strength: 0.6 });
  }
  cameraTarget(): Vector3 {
    return new Vector3();
  }
}

describe('the engine with the player’s 52in1 settings', () => {
  it('applies the volumes at start and on every change, and never the hub’s master', async () => {
    const hub = fakeHub({ music: 0.5, effects: 0.25 });
    const engine = await Engine.headless(new Lamp(), { hubSettings: hub.source });
    try {
      const own = engine.audio.volume;
      expect(engine.audio.levels.music).toBeCloseTo(own.music * 0.5);
      expect(engine.audio.levels.sfx).toBeCloseTo(own.sfx * 0.25);
      hub.change({ music: 0, effects: 1 });
      expect(engine.audio.levels).toEqual({ master: own.muted ? 0 : own.master, sfx: own.sfx, music: 0 });
      expect(engine.hubSettings.values.vibration).toBe(0.8);
      const plain = await Engine.headless(new Lamp());
      expect(plain.hubSettings.present, 'headless: no hub unless one is passed').toBe(false);
      expect(plain.audio.hubVolumes).toEqual({ music: 1, effects: 1 });
      plain.dispose();
    } finally {
      engine.dispose();
    }
  });

  it('sends a game’s light and triggers once, gives them back when a level unloads, and lets go for good at dispose', async () => {
    const hub = fakeHub();
    const lamp = new Lamp();
    const engine = await Engine.headless(lamp, { hubSettings: hub.source });
    engine.step(5);
    expect(hub.calls).toEqual([
      ['light', '#b13e53'],
      ['trigger', 'right', { kind: 'resist', from: 0.5, strength: 0.6 }],
    ]);
    hub.calls.length = 0;
    engine.paused = true;
    engine.paused = false;
    expect(triggers(hub.calls)).toEqual([['right', null], ['right', { kind: 'resist', from: 0.5, strength: 0.6 }]]);
    hub.calls.length = 0;
    await engine.loadGame({ name: 'Title', setup() {}, cameraTarget: () => new Vector3() });
    expect(hub.calls).toEqual([['light', null], ['trigger', 'right', null]]); // the title has the hub's colour
    hub.calls.length = 0;
    await engine.loadGame(lamp);
    engine.step(2);
    engine.dispose();
    expect(hub.calls).toEqual([
      ['light', '#b13e53'],
      ['trigger', 'right', { kind: 'resist', from: 0.5, strength: 0.6 }],
      ['light', null],
      ['trigger', 'right', null],
    ]);
    hub.change({ music: 0.1 }); // disposed: no longer listening
    expect(engine.audio.hubVolumes.music).toBe(0.5);
    expect(hub.read).toEqual([]);
  });

  it('a replay sends nothing: outputs are not recorded', async () => {
    const hub = fakeHub();
    const lamp = new Lamp();
    const engine = await Engine.headless(lamp, { hubSettings: hub.source });
    try {
      engine.step(10);
      const rec = engine.recording()!;
      lamp.colour = PALETTE.blue;
      hub.calls.length = 0;
      await engine.replay(rec, () => engine.loadGame(lamp));
      expect(hub.calls, 'only the unload gave the light back').toEqual([['light', null], ['trigger', 'right', null]]);
      engine.step(1); // live again
      expect(lights(hub.calls).at(-1)).toBe('#3b5dc9');
    } finally {
      engine.dispose();
    }
  });

  it('a round’s end gives the light bar back and lets the triggers go for good', async () => {
    const hub = fakeHub();
    const local = new LocalHub({ mode: 'ghost', players: 2 });
    const session = (await HubSession.join({ mode: 'ghost', seats: [1, 4], client: local.client(0), autoFlush: false }))!;
    const engine = await Engine.headless(new Lamp(), { hubSettings: hub.source });
    try {
      session.attach(engine);
      local.start();
      engine.step(2);
      local.end('finished');
      engine.step(3);
      expect(hub.calls.slice(-2)).toEqual([['light', null], ['trigger', 'right', null]]);
      expect(engine.dualsense.sent).toEqual({ light: null, left: null, right: null }); // the game's calls after the end do nothing
    } finally {
      engine.dispose();
    }
  });
});
