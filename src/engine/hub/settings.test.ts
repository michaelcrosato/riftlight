// The player's 52in1 settings (window.AIHubSettings, catalogue *Settings and the DualSense*) and a
// DualSense's outputs, headless: a fake settings object is passed in (no globals are stubbed), the
// way the hub's companion script hands it to a page (an EventTarget that says 'change').
import { Vector3 } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../audio/AudioManager';
import { Engine, type Game, type GameContext } from '../Engine';
import { MOTION_AIM, TOUCHPAD_KEYS } from '../input';
import { PALETTE } from '../palette';
import type { Recording } from '../replay';
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

  it('a hub callback that throws is a warning: loading a game and dispose still finish, and what never arrived is tried again', async () => {
    const hub = fakeHub();
    const ds = (hub.source as unknown as { dualsense: { light: (c: string | null) => void } }).dualsense;
    const light = ds.light;
    let broken = true;
    ds.light = (c) => {
      if (broken) throw new Error('hid write failed');
      light(c);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const engine = await Engine.headless(new Lamp(), { hubSettings: hub.source });
      engine.step(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("the hub's light() threw: hid write failed"));
      expect(lights(hub.calls)).toEqual([]);
      broken = false;
      hub.change({}); // the colour never reached the controller: the next sync sends it
      expect(lights(hub.calls)).toEqual(['#b13e53']);
      broken = true;
      await engine.loadGame({ name: 'Title', setup() {}, cameraTarget: () => new Vector3() });
      expect(engine.game.name).toBe('Title'); // the unload's let-go threw, and the load went on
      broken = false;
      engine.dispose(); // the let-go that failed goes now
      expect(lights(hub.calls)).toEqual(['#b13e53', null]);
      hub.change({ music: 0.1 }); // dispose finished: no longer listening
      expect(engine.audio.hubVolumes.music).toBe(0.5);
    } finally {
      warn.mockRestore();
    }
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

describe('a DualSense’s touchpad and motion through 52in1, as recorded input', () => {
  /** A hub whose DualSense's gyro and touches the test moves, and which notes every read of them. */
  function movingHub(flags: Partial<Record<'motion' | 'touchpad' | 'aim', boolean>> = {}) {
    const read: string[] = [];
    const now = { gyro: { x: 0, y: 0, z: 0 }, touches: [] as { id: number; x: number; y: number }[] };
    const dualsense = { connected: true, motion: true, touchpad: true, aim: true, ...flags };
    for (const field of ['gyro', 'touches'] as const) Object.defineProperty(dualsense, field, { enumerable: true, get: () => (read.push(field), now[field]) });
    const target = Object.assign(new EventTarget(), { dualsense });
    return { source: target as HubSettingsSource, target, read, now, dualsense };
  }
  /** Notes what a game sees each frame: the touchpad's presses, the camera turn, the aim stick. */
  class Feel implements Game {
    readonly name = 'Feel';
    seen: string[] = [];
    turn: number[] = [];
    aim: number[] = [];
    setup(): void {}
    update(ctx: GameContext): void {
      for (const code of Object.values(TOUCHPAD_KEYS)) if (ctx.input.wasPressed(code)) this.seen.push(code);
      this.turn.push(ctx.input.mouseDelta.x);
      this.aim.push(ctx.input.lookAxis.x);
    }
    cameraTarget() {
      return new Vector3();
    }
  }
  const finger = (now: { touches: { id: number; x: number; y: number }[] }, ...touches: { id: number; x: number; y: number }[]) => (now.touches = touches);

  it('reads nothing unless the game asks: its motion aim on, its touchpad on', async () => {
    const hub = movingHub();
    const engine = await Engine.headless(new Feel(), { hubSettings: hub.source });
    engine.input.noteDevice('pad');
    engine.step(10);
    expect(hub.read).toEqual([]); // 52in1's own Motion aim stays on
    expect(engine.input.motion.on).toBe(false);
    engine.dispose();
  });

  it('a swipe on the touchpad presses a direction and a tap presses tap, once, recorded; two fingers or the click are not a tap', async () => {
    const hub = movingHub();
    const game = new Feel();
    const engine = await Engine.headless(game, { hubSettings: hub.source });
    engine.input.touchpad = true;
    engine.input.noteDevice('keyboard');
    for (const x of [0.2, 0.4, 0.6, 0.8]) {
      finger(hub.now, { id: 1, x, y: 0.5 });
      engine.step(1);
    }
    finger(hub.now);
    engine.step(1);
    expect([game.seen, engine.input.device]).toEqual([['PadTouchpadRight'], 'pad']); // a use of the pad
    finger(hub.now, { id: 2, x: 0.5, y: 0.2 });
    engine.step(1);
    finger(hub.now, { id: 2, x: 0.5, y: 0.9 });
    engine.step(1);
    finger(hub.now);
    engine.step(1);
    finger(hub.now, { id: 3, x: 0.5, y: 0.5 });
    engine.step(2);
    finger(hub.now);
    engine.step(1);
    expect(game.seen).toEqual(['PadTouchpadRight', 'PadTouchpadDown', 'PadTouchpadTap']);
    finger(hub.now, { id: 4, x: 0.5, y: 0.5 }, { id: 5, x: 0.2, y: 0.5 }); // two fingers
    engine.step(2);
    finger(hub.now);
    engine.step(1);
    const click = Array.from({ length: 18 }, (_, i) => ({ pressed: i === 17 }));
    engine.input.setGamepads([{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: click }]);
    finger(hub.now, { id: 6, x: 0.5, y: 0.5 }); // the click's own touch
    engine.step(2);
    engine.input.setGamepads([]);
    finger(hub.now);
    engine.step(1);
    expect(game.seen).toEqual(['PadTouchpadRight', 'PadTouchpadDown', 'PadTouchpadTap']);
    expect(hub.read.every((f) => f === 'touches')).toBe(true); // the touchpad alone: 52in1's Motion aim stays on
    // the presses are in the recording, and a replay reads nothing of the hub
    const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    expect(rec.frames.flatMap((f) => f.pressed ?? []).filter((c) => c.startsWith('PadTouchpad') && c !== 'PadTouchpad')).toEqual(['PadTouchpadRight', 'PadTouchpadDown', 'PadTouchpadTap']);
    const reads = hub.read.length;
    finger(hub.now, { id: 7, x: 0.1, y: 0.5 }); // live, during the replay: never read
    const again = new Feel();
    await engine.replay(rec, () => engine.loadGame(again));
    expect([again.seen, hub.read.length]).toEqual([game.seen, reads]);
    engine.dispose();
  });

  it('motion aim adds the controller’s turns to the camera and the aim stick, by its sensitivity, on the pad in use; recorded', async () => {
    const hub = movingHub({ aim: true });
    const game = new Feel();
    const engine = await Engine.headless(game, { hubSettings: hub.source, settings: { motion: true } });
    expect(engine.input.motion).toEqual({ on: true, sensitivity: 1 }); // on, as 52in1's own Motion aim is
    engine.input.noteDevice('pad');
    hub.now.gyro = { x: 0, y: -64, z: 0 }; // turning right, 64° a second
    engine.step(1);
    const dt = 1 / 60;
    expect(game.turn.at(-1)).toBeCloseTo((64 - MOTION_AIM.still) * dt * MOTION_AIM.pixels, 6);
    expect(game.aim.at(-1)!).toBeGreaterThan(MOTION_AIM.floor);
    engine.settings.set({ motionSensitivity: 2 });
    engine.step(1);
    expect(game.turn.at(-1)).toBeCloseTo(2 * (64 - MOTION_AIM.still) * dt * MOTION_AIM.pixels, 6);
    hub.now.gyro = { x: 0, y: -3, z: 0 }; // a hand holding still
    engine.step(1);
    expect([game.turn.at(-1), game.aim.at(-1)]).toEqual([0, 0]);
    hub.now.gyro = { x: 0, y: -64, z: 0 };
    engine.input.noteDevice('keyboard'); // the pad put down: its turns move nothing
    engine.step(1);
    expect(game.turn.at(-1)).toBe(0);
    const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    const turns = game.turn.slice();
    engine.settings.set({ motion: false }); // turned off: the gyro is not read any more (52in1's own aim is back)
    expect(engine.input.motion.on).toBe(false);
    const reads = hub.read.length;
    engine.input.noteDevice('pad');
    engine.step(3);
    expect(hub.read.length).toBe(reads);
    const again = new Feel();
    engine.settings.set({ motion: true });
    await engine.replay(rec, () => engine.loadGame(again));
    expect([again.turn, hub.read.length]).toEqual([turns, reads]); // what was recorded, nothing read
    engine.dispose();
  });

  it('motion aim is off without a DualSense’s motion, and while 52in1’s own Motion aim is off until the player turns it on', async () => {
    const hub = movingHub({ aim: false });
    const engine = await Engine.headless(new Feel(), { hubSettings: hub.source, settings: { motion: true } });
    expect(engine.input.motion.on).toBe(false);
    engine.settings.set({ motion: true });
    expect(engine.input.motion.on).toBe(true);
    hub.dualsense.motion = false;
    hub.target.dispatchEvent(new Event('change'));
    expect(engine.input.motion.on).toBe(false);
    engine.dispose();
  });
});
