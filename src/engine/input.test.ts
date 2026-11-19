import { describe, expect, it } from 'vitest';
import { applyDeadzone, type DualSenseInput, GAMEPAD_BUTTONS, GAMEPAD_DEADZONE, type GamepadLike, HOME_BUTTON, Input, type InputFrame, MOTION_AIM, newShout, SHOUT, type ShoutState, shoutLevels, shoutStep, SWIPE_KEYS, swipeDirection, TOUCHPAD_KEYS, TWIN_SECONDS, VOICE_KEYS, type VoiceInput } from './input';
import { VOICE_SENSITIVITY } from './settings';

const target = () => new EventTarget() as unknown as Window;
const key = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });

function pad(axes: number[] = [0, 0, 0, 0], pressed: number[] = [], extra: Partial<GamepadLike> = {}): GamepadLike {
  return { connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i) })), ...extra };
}

describe('Input presses', () => {
  it('queued presses expire after the press window (game time)', () => {
    const input = new Input(target());
    input.beginFrame(1, 1 / 60, []);
    input.setKey('Space', true);
    input.beginFrame(1.1, 0.1, []);
    expect(input.consumePress('Space')).toBe(true); // 100 ms old: still valid
    input.setKey('Space', false);
    input.setKey('Space', true);
    input.beginFrame(1.3, 0.2, []);
    expect(input.consumePress('Space')).toBe(false); // 200 ms old: expired
    expect(input.queuedPresses).toEqual([]);
  });

  it('stale presses never pile up while no fixed step consumes them', () => {
    const input = new Input(target());
    for (let i = 0; i < 100; i++) {
      input.setKey('KeyJ', true);
      input.setKey('KeyJ', false);
      input.beginFrame(i * 0.05, 0.05, []);
    }
    expect(input.queuedPresses.length).toBeLessThanOrEqual(1);
  });

  it('dispose() removes its window listeners', () => {
    const t = target();
    const input = new Input(t);
    t.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.isDown('KeyA')).toBe(true);
    t.dispatchEvent(key('keyup', 'KeyA'));
    input.dispose();
    t.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.isDown('KeyA')).toBe(false);
  });
});

describe('Gamepad', () => {
  it('applies a radial deadzone and rescales to the rim', () => {
    expect(GAMEPAD_DEADZONE).toBe(0.15); // about what console games keep: slow gyro aim (the AI Hub adds 0.2 and up) still turns
    expect(new Input(target()).gamepadDeadzone).toBe(GAMEPAD_DEADZONE);
    expect(applyDeadzone(0.14, 0)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(0.2, 0).x).toBeCloseTo(0.05 / 0.85);
    expect(applyDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const full = applyDeadzone(1, 0, 0.2);
    expect(full.x).toBeCloseTo(1);
    const half = applyDeadzone(0, 0.6, 0.2);
    expect(half.y).toBeCloseTo(0.5);
    const diag = applyDeadzone(0.6, 0.6, 0.2);
    expect(diag.x).toBeCloseTo(diag.y); // direction kept
  });

  it('left stick feeds moveAxis (up = forward) and buttons press mapped keys once', () => {
    const input = new Input(target());
    input.beginFrame(0, 1 / 60, [pad([0, -1, 0, 0], [0])]);
    expect(input.moveAxis().y).toBeCloseTo(1);
    expect(input.isDown('PadA')).toBe(true);
    expect(input.isDown('Space')).toBe(false); // a pad button is its own code, not a key
    expect(input.wasPressed('PadA')).toBe(true);
    expect(input.consumePress('PadA')).toBe(true);
    input.endFrame();
    input.beginFrame(1 / 60, 1 / 60, [pad([0, -1, 0, 0], [0])]); // still held: no new press
    expect(input.wasPressed('PadA')).toBe(false);
    expect(input.consumePress('PadA')).toBe(false);
    input.beginFrame(2 / 60, 1 / 60, [pad([0.05, 0.05, 0, 0], [])]); // released, stick in deadzone
    expect(input.isDown('PadA')).toBe(false);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    input.beginFrame(3 / 60, 1 / 60, [pad([0, 0, 0, 0], [14])]); // d-pad left = ArrowLeft
    expect(input.moveAxis().x).toBe(-1);
  });

  it('ignores pads without the standard mapping (unknown layouts)', () => {
    const input = new Input(target());
    input.beginFrame(0, 1 / 60, [{ ...pad([1, 0, 0, 0], [0]), mapping: '' }]);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    expect(input.isDown('PadA')).toBe(false);
    expect(input.device).toBe('keyboard');
  });

  it('View + Menu held together are the host page’s: neither presses its key (the AI Hub’s bar)', () => {
    const input = new Input(target());
    input.beginFrame(0, 1 / 60, [pad([0, 0, 0, 0], [8])]); // View alone: its key (V)
    expect(input.isDown(GAMEPAD_BUTTONS[8]!)).toBe(true);
    input.endFrame();
    input.beginFrame(1 / 60, 1 / 60, [pad([0, 0, 0, 0], [8, 9, 0])]); // both: neither, other buttons still count
    expect(input.isDown(GAMEPAD_BUTTONS[8]!)).toBe(false);
    expect(input.isDown(GAMEPAD_BUTTONS[9]!)).toBe(false);
    expect(input.wasPressed(GAMEPAD_BUTTONS[9]!)).toBe(false);
    expect(input.isDown('PadA')).toBe(true);
    // letting go of one first presses nothing: both must be let go before either counts again
    input.endFrame();
    input.beginFrame(2 / 60, 1 / 60, [pad([0, 0, 0, 0], [9])]);
    expect(input.isDown(GAMEPAD_BUTTONS[9]!)).toBe(false);
    expect(input.wasPressed(GAMEPAD_BUTTONS[9]!)).toBe(false);
    input.endFrame();
    input.beginFrame(3 / 60, 1 / 60, [pad()]);
    input.endFrame();
    input.beginFrame(4 / 60, 1 / 60, [pad([0, 0, 0, 0], [9])]);
    expect([input.isDown('PadStart'), input.wasPressed('PadStart')]).toEqual([true, false]); // alone: held, pressed as it is let go
    input.endFrame();
    input.beginFrame(5 / 60, 1 / 60, [pad()]);
    expect([input.isDown('PadStart'), input.wasPressed('PadStart'), input.consumePress('PadStart')]).toEqual([false, true, true]);
  });

  it('Create and Options press as they are let go, never when the other went down while held (52in1’s bar, however the two are pressed)', () => {
    /** Each poll's buttons down, on one pad; what pressed PadStart and PadBack at each. */
    const run = (polls: number[][], before?: (input: Input, poll: number) => void) => {
      const input = new Input(target());
      return polls.map((buttons, n) => {
        before?.(input, n);
        input.beginFrame(n / 60, 1 / 60, [pad([0, 0, 0, 0], buttons)]);
        const out = [input.wasPressed('PadStart') && 'Options', input.wasPressed('PadBack') && 'Create'].filter(Boolean).join() || '-';
        input.endFrame();
        return out;
      });
    };
    const second = Array.from({ length: 60 }, () => [8, 9]); // the hub opens its bar after a second of both
    expect(run([[9], ...second, []]), 'Options a poll before Create').toEqual(Array(62).fill('-'));
    expect(run([[8], ...second, []]), 'Create a poll before Options').toEqual(Array(62).fill('-'));
    expect(run([[9], [9], [9], [9], [9], [9], [9], [9], [9], [9], ...second, [9], []]), 'Options, then Create a slow sixth of a second later, Options let go last').toEqual(Array(72).fill('-'));
    expect(run([[9], []])).toEqual(['-', 'Options']); // Options alone: as it is let go
    expect(run([[9], [9], [9], [9], [9], [9], [9], [9], [9], [9], []])).toEqual([...Array(10).fill('-'), 'Options']); // held a while, alone: the same
    expect(run([[8, 0], [0], []])).toEqual(['-', 'Create', '-']); // other buttons never spoil it
    expect(run([[9], [], [8], []])).toEqual(['-', 'Options', '-', 'Create']); // one after the other, each let go first: both
    // held through release() (a menu opened over it), it presses nothing as it is let go
    expect(run([[9], [9], []], (input, n) => n === 1 && input.release())).toEqual(['-', '-', '-']);
    expect(run([[9], [9], []], (input, n) => n === 1 && input.reset())).toEqual(['-', '-', '-']); // reset() drops it too
    // two pads: each pad's chord is its own, and one pad's buttons never end another's
    const input = new Input(target());
    const polls: [number[], number[]][] = [[[8, 9], []], [[9], []], [[9], []], [[], []]];
    const pressed = polls.map(([a, b], n) => {
      input.beginFrame(n / 60, 1 / 60, [pad([0, 0, 0, 0], a, { index: 0 }), pad([0, 0, 0, 0], b, { index: 1 })]);
      const out = input.wasPressed('PadStart');
      input.endFrame();
      return out;
    });
    expect(pressed, 'Create let go first on the first pad, a second pad idle beside it').toEqual([false, false, false, false]);
  });

  it('right stick turns into pointer movement for the camera', () => {
    const input = new Input(target());
    input.beginFrame(0, 0.5, [pad([0, 0, 1, 0])]);
    expect(input.mouseDelta.x).toBeCloseTo(input.gamepadLookSpeed * 0.5);
    expect(input.gamepadConnected).toBe(true);
  });

  it("a right stick resting just past its deadzone never creeps a keyboard player's camera; on the pad, it turns", () => {
    const input = new Input(target());
    input.noteDevice('keyboard');
    for (let i = 0; i < 3; i++) {
      input.beginFrame(i / 60, 1 / 60, [pad([0, 0, 0.17, 0])]); // between the deadzone (0.15) and a use (0.25)
      expect([input.device, input.mouseDelta.x, input.lookAxis.x]).toEqual(['keyboard', 0, 0]);
      input.endFrame();
    }
    input.noteDevice('pad'); // a button pressed: the pad is in use, and the same small lean turns
    input.beginFrame(3 / 60, 1 / 60, [pad([0, 0, 0.17, 0])]);
    expect(input.mouseDelta.x).toBeGreaterThan(0);
    expect(input.lookAxis.x).toBeGreaterThan(0);
    input.endFrame();
    input.noteDevice('keyboard');
    input.beginFrame(4 / 60, 1 / 60, [pad([0, 0, 0.9, 0])]); // pushed well over: the poll that picks the pad up turns
    expect([input.device, input.mouseDelta.x > 0, input.lookAxis.x > 0]).toEqual(['pad', true, true]);
  });

  it("release() lets go of a held key for good: its auto-repeat holds nothing until it is let go and pressed anew", () => {
    const t = target();
    const input = new Input(t);
    const repeat = (code: string) => Object.assign(new Event('keydown'), { code, repeat: true });
    t.dispatchEvent(key('keydown', 'KeyD')); // walking right, then a menu opens
    input.release();
    t.dispatchEvent(repeat('KeyD'));
    t.dispatchEvent(repeat('KeyD'));
    expect(input.isDown('KeyD')).toBe(false);
    t.dispatchEvent(key('keyup', 'KeyD'));
    input.endFrame();
    t.dispatchEvent(key('keydown', 'KeyD'));
    expect([input.isDown('KeyD'), input.wasPressed('KeyD')]).toEqual([true, true]);
  });

  it('release() lets go of a held pad button for good: it does not press again until let go and pressed anew', () => {
    const input = new Input(target());
    input.beginFrame(0, 1 / 60, [pad([0, 0, 0, 0], [3])]); // Triangle opens a menu
    expect(input.wasPressed('PadY')).toBe(true);
    input.endFrame();
    input.release(); // what opening the menu does
    for (let i = 1; i < 4; i++) {
      input.beginFrame(i / 60, 1 / 60, [pad([0, 0, 0, 0], [3])]); // still held
      expect([input.wasPressed('PadY'), input.isDown('PadY')]).toEqual([false, false]);
      input.endFrame();
    }
    input.beginFrame(4 / 60, 1 / 60, [pad()]);
    input.endFrame();
    input.beginFrame(5 / 60, 1 / 60, [pad([0, 0, 0, 0], [3])]);
    expect([input.wasPressed('PadY'), input.isDown('PadY')]).toEqual([true, true]);
  });

  it('release() centres a stick still leaning until it goes back inside its deadzone: a run held into a menu never steps it', () => {
    const input = new Input(target());
    const frame = (i: number, axes: number[]) => {
      input.beginFrame(i / 60, 1 / 60, [pad(axes)]);
      const r = { move: input.padAxis.x, look: input.lookAxis.x, turn: input.mouseDelta.x };
      input.endFrame();
      return r;
    };
    expect(frame(0, [1, 0, 1, 0]).move).toBeGreaterThan(0.9); // running right, the camera turning
    input.release(); // a menu opens
    for (let i = 1; i < 60; i++) expect(frame(i, [1, 0, 1, 0])).toEqual({ move: 0, look: 0, turn: 0 }); // still held: centred
    expect(frame(60, [0.1, 0, 0.1, 0])).toEqual({ move: 0, look: 0, turn: 0 }); // back inside the deadzone: let go
    expect(frame(61, [1, 0, 0, 0]).move).toBeGreaterThan(0.9); // leaned anew: it reads
    expect(frame(62, [0, 0, 1, 0]).look).toBeGreaterThan(0.9);
    input.release(); // a stick at rest when it happens reads at once
    expect(frame(63, [0, 0, 0, 0]).move).toBe(0);
    expect(frame(64, [-1, 0, 0, 0]).move).toBeLessThan(-0.9);
  });

  it('its state as data: keys held, presses still queued with their age, the pointer (save-states)', () => {
    const a = new Input(new EventTarget() as unknown as Window);
    a.beginFrame(1, 1 / 60, []);
    a.setKey('KeyW', true);
    a.setKey('KeyJ', true);
    a.setKey('KeyJ', false); // a tap: queued, not held
    a.setPointer(0.25, -0.5);
    a.beginFrame(1.05, 0.05, []);
    const b = new Input(new EventTarget() as unknown as Window);
    b.setState(JSON.parse(JSON.stringify(a.state())), 3.05);
    expect([b.isDown('KeyW'), b.isDown('KeyJ'), b.pointer.x, b.pointer.y, b.pointer.over]).toEqual([true, false, 0.25, -0.5, true]);
    b.beginFrame(3.15, 0.1, []);
    expect(b.consumePress('KeyJ')).toBe(true); // 0.15 s old: still in the window, as it would be in `a`
    b.setState(JSON.parse(JSON.stringify(a.state())), 3.05);
    b.beginFrame(3.25, 0.2, []);
    expect(b.consumePress('KeyJ')).toBe(false); // 0.25 s old: gone, as in `a`
  });

  it('data sent and not yet delivered is part of the moment: kept by a snapshot, dropped by a restore', () => {
    const a = new Input(new EventTarget() as unknown as Window);
    a.send({ lift: 1 });
    const s = JSON.parse(JSON.stringify(a.state())) as ReturnType<Input['state']>;
    a.deliver();
    expect(a.commands).toEqual([{ lift: 1 }]);
    // sent after the snapshot: not the restored moment's
    a.send({ lift: 2 });
    a.send({ lift: 3 });
    a.setState(s, 0);
    a.deliver();
    expect(a.commands).toEqual([{ lift: 1 }]);
    a.deliver();
    expect(a.commands).toEqual([]);
  });
});

describe('One pad scheme', () => {
  it('every standard button presses its Pad code; the d-pad presses the arrows; the home button never counts', () => {
    expect(GAMEPAD_BUTTONS).toEqual({
      0: 'PadA', 1: 'PadB', 2: 'PadX', 3: 'PadY', 4: 'PadLB', 5: 'PadRB', 6: 'PadLT', 7: 'PadRT', 8: 'PadBack', 9: 'PadStart', 10: 'PadL3', 11: 'PadR3',
      12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 17: 'PadTouchpad',
    });
    const input = new Input(target());
    input.gamepadButtons = { ...GAMEPAD_BUTTONS, [HOME_BUTTON]: 'KeyH' }; // a game maps PS / Xbox: still never read
    input.beginFrame(0, 1 / 60, [pad([0, 0, 0, 0], [HOME_BUTTON, 17, 10])]);
    expect([input.isDown('KeyH'), input.isDown('PadTouchpad'), input.isDown('PadL3')]).toEqual([false, true, true]);
    expect(input.device).toBe('pad'); // the touchpad and L3 are the pad in use
    const home = new Input(target());
    home.beginFrame(0, 1 / 60, [pad([0, 0, 0, 0], [HOME_BUTTON])]);
    expect(home.device).toBe('keyboard'); // the PS button alone is the system's, not a use
  });
});

describe('The device used last', () => {
  it('follows real use: a key, a pad button, a stick past its deadzone, a trigger, a touch control', () => {
    const t = target();
    const input = new Input(t);
    expect(input.device).toBe('keyboard'); // a page without a touch screen starts on the keyboard
    let now = 0;
    const frame = (pads: GamepadLike[]) => {
      input.beginFrame((now += 1 / 60), 1 / 60, pads);
      input.endFrame();
    };
    frame([pad([0, 0, 0, 0], [], { index: 2 })]);
    expect([input.device, input.gamepadConnected, input.padIndex]).toEqual(['keyboard', true, -1]); // connected is not used
    frame([pad([0, 0, 0, 0], [1], { index: 2 })]);
    expect([input.device, input.padIndex]).toEqual(['pad', 2]);
    t.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.device).toBe('keyboard');
    frame([pad([0, 0, 0, 0], [1], { index: 2 })]); // Circle still held from before: not a new use
    expect(input.device).toBe('keyboard');
    frame([pad([0, -0.9, 0, 0], [], { index: 2 })]); // the left stick pushed
    expect(input.device).toBe('pad');
    t.dispatchEvent(key('keydown', 'KeyW'));
    frame([pad([0, 0, 0, 0], [], { index: 2 })]);
    frame([pad([0, 0, 0.1, 0], [], { index: 2 })]); // the right stick inside its deadzone
    expect(input.device).toBe('keyboard');
    frame([pad([0, 0, 0.6, 0], [], { index: 2 })]); // past it
    expect(input.device).toBe('pad');
    t.dispatchEvent(key('keydown', 'KeyW'));
    const trigger = (v: number) => pad([0, 0, 0, 0], [], { index: 2, buttons: Array.from({ length: 18 }, (_, i) => (i === 7 ? { pressed: v > 0.1, value: v } : { pressed: false, value: 0 })) });
    frame([trigger(0.2)]); // a trigger touched lightly
    expect(input.device).toBe('keyboard');
    frame([trigger(0.4)]); // pulled
    expect([input.device, input.triggers.right]).toEqual(['pad', 0.4]);
    input.noteTouch();
    expect(input.device).toBe('touch');
    input.noteDevice('keyboard');
    expect(input.device).toBe('keyboard');
  });

  it('a pad merely connected never takes over: a stick resting off-centre (drift) is not a use', () => {
    const input = new Input(target());
    const drift = pad([0.3, 0.2, 0.25, 0]); // seen for the first time already off-centre
    for (let f = 0; f < 30; f++) input.beginFrame(f / 60, 1 / 60, [drift]);
    expect(input.device).toBe('keyboard');
    expect(input.moveAxis().x).toBeGreaterThan(0); // it still moves (the game's call), it just isn't the device in use
    input.beginFrame(31 / 60, 1 / 60, [pad([0.9, 0.2, 0.25, 0])]); // pushed for real
    expect(input.device).toBe('pad');
  });

  it('a stick jittering across its deadzone never takes over from the keyboard; one pushed does, slowly or not', () => {
    const t = target();
    const input = new Input(t);
    let now = 0;
    const frame = (x: number) => {
      input.beginFrame((now += 1 / 60), 1 / 60, [pad([x, 0, 0, 0])]);
      input.endFrame();
    };
    frame(0);
    for (const x of [0.149, 0.151, 0.148, 0.152, 0.149, 0.153, 0.147, 0.151]) {
      t.dispatchEvent(key('keydown', 'KeyW'));
      t.dispatchEvent(key('keyup', 'KeyW'));
      frame(x);
      expect(input.device, `a resting stick at ${x}`).toBe('keyboard');
    }
    for (let x = 0.15; x <= 0.6; x += 0.01) frame(x); // tilted slowly, a little each frame
    expect(input.device).toBe('pad');
  });

  it('a key held wins over a stick resting past its deadzone; the pad in use, pushed, wins over the keys', () => {
    const t = target();
    const input = new Input(t);
    t.dispatchEvent(key('keydown', 'KeyW'));
    input.beginFrame(0, 1 / 60, [pad([0.17, 0, 0, 0])]); // a connected pad's stick resting just past the deadzone
    expect(input.moveAxis()).toEqual({ x: 0, y: 1 }); // W still moves forward
    expect(input.device).toBe('keyboard');
    t.dispatchEvent(key('keyup', 'KeyW'));
    input.beginFrame(1 / 60, 1 / 60, [pad([0.17, 0, 0, 0])]);
    expect(input.moveAxis().x).toBeGreaterThan(0); // no key: the stick is all there is
    // the d-pad (arrows) on the pad in use: the same drifting stick doesn't take it either
    input.beginFrame(2 / 60, 1 / 60, [pad([0.17, 0, 0, 0], [12])]);
    expect([input.device, input.moveAxis()]).toEqual(['pad', { x: 0, y: 1 }]);
    // the pad in use, its stick pushed: it wins over a key still held
    t.dispatchEvent(key('keydown', 'KeyW'));
    input.beginFrame(3 / 60, 1 / 60, [pad([0.9, 0, 0, 0])]);
    expect(input.device).toBe('pad');
    expect(input.moveAxis()).toEqual({ x: (0.9 - 0.15) / 0.85, y: 0 });
  });

  it('is recorded and replayed, kept by save-states, and live input cannot change it during a replay', () => {
    const live = new Input(target());
    live.noteDevice('pad');
    const s = JSON.parse(JSON.stringify(live.state())) as ReturnType<Input['state']>;
    expect(s.device).toBe('pad');
    const b = new Input(target());
    b.setState(s, 0);
    expect(b.device).toBe('pad');
    const old = { ...s, device: undefined }; // a snapshot from before the device was kept
    b.setState(old, 0);
    expect(b.device).toBe('keyboard');
    const t = target();
    const played = new Input(t);
    played.noteDevice('pad'); // live, before the replay
    played.playing = true;
    expect(played.device).toBe('keyboard'); // a level loading in a replay reads the recording's device, not the live one
    played.playFrom('touch'); // the device the recorded level began with
    expect(played.device).toBe('touch');
    played.playFrom(undefined); // a recording without one: the keyboard
    expect(played.device).toBe('keyboard');
    t.dispatchEvent(key('keydown', 'KeyW'));
    played.noteTouch();
    played.beginFrame(0, 1 / 60, [pad([0, 0, 0, 0], [0])]);
    played.playAfter({ dt: 1 / 60 }); // a recording made before the device was recorded: the keyboard
    expect(played.device).toBe('keyboard');
    played.playAfter({ dt: 1 / 60, device: 'touch' });
    played.playAfter({ dt: 1 / 60 }); // unchanged frames keep it
    expect(played.device).toBe('touch');
  });

  it('a quick one-finger flick is a swipe; a tap, a slow drag or a short one is not', () => {
    expect(swipeDirection(-120, 10, 200, 400)).toBe('left');
    expect(swipeDirection(120, -10, 200, 400)).toBe('right');
    expect(swipeDirection(5, 80, 300, 400)).toBe('down');
    expect(swipeDirection(5, -80, 300, 400)).toBe('up');
    expect(swipeDirection(4, 3, 120, 400)).toBeNull(); // a tap
    expect(swipeDirection(-200, 0, 900, 400)).toBeNull(); // a slow drag (turning the camera)
    expect(swipeDirection(-20, 0, 100, 400)).toBeNull(); // under 8% of the short side
    expect(Object.values(SWIPE_KEYS)).toEqual(['SwipeLeft', 'SwipeRight', 'SwipeUp', 'SwipeDown']);
  });
});

describe('Analog triggers and the right stick', () => {
  it('read 0..1 per trigger and the right stick as an aim axis (y up), after its deadzone', () => {
    const input = new Input(target());
    input.beginFrame(0, 1 / 60, [pad()]); // seen at rest first
    input.endFrame();
    const buttons = Array.from({ length: 18 }, (_, i) => (i === 6 ? { pressed: false, value: 0.25 } : i === 7 ? { pressed: true, value: 0.75 } : { pressed: false, value: 0 }));
    input.beginFrame(1 / 60, 1 / 60, [pad([0, 0, 0, -1], [], { buttons })]);
    expect(input.triggers).toEqual({ left: 0.25, right: 0.75 });
    expect([input.isDown('PadLT'), input.isDown('PadRT')]).toEqual([false, true]); // pressed, as the browser says (or past half)
    expect(input.lookAxis.x).toBe(0);
    expect(input.lookAxis.y).toBeCloseTo(1); // pushed up
    expect(input.mouseDelta.y).toBeLessThan(0); // and it still turns the camera
    const f = input.snapshot(1 / 60);
    expect([f.trig, f.look?.[1]]).toEqual([[0.25, 0.75], input.lookAxis.y]);
    input.endFrame();
    input.beginFrame(2 / 60, 1 / 60, [pad()]);
    expect([input.triggers, input.lookAxis, Object.is(input.lookAxis.x, -0)]).toEqual([{ left: 0, right: 0 }, { x: 0, y: 0 }, false]);
    const g = input.snapshot(1 / 60);
    expect([g.trig, g.look]).toEqual([undefined, undefined]);
  });

  it('a pad first seen with its triggers resting part-way (half, until first pulled) reads them as 0 and is not in use until they move', () => {
    const input = new Input(target());
    const half = (l: number, r = l) => pad([0, 0, 0, 0], [], { buttons: Array.from({ length: 18 }, (_, i) => (i === 6 ? { pressed: l > 0.1, value: l } : i === 7 ? { pressed: r > 0.1, value: r } : { pressed: false, value: 0 })) });
    for (let f = 0; f < 5; f++) {
      input.beginFrame(f / 60, 1 / 60, [half(0.5)]);
      input.endFrame();
    }
    expect([input.device, input.triggers, input.isDown('PadLT', 'PadRT')]).toEqual(['keyboard', { left: 0, right: 0 }, false]);
    input.beginFrame(5 / 60, 1 / 60, [half(0, 0.5)]); // the left one let go: it reads from now on
    input.endFrame();
    expect([input.device, input.triggers]).toEqual(['keyboard', { left: 0, right: 0 }]);
    input.beginFrame(6 / 60, 1 / 60, [half(0.8, 0.5)]); // and pulled: the pad is in use
    expect([input.device, input.triggers, input.isDown('PadLT'), input.isDown('PadRT')]).toEqual(['pad', { left: 0.8, right: 0 }, true, false]);
    // one pulled all the way when the pad is first seen (the press that showed it) reads at once
    const full = new Input(target());
    full.beginFrame(0, 1 / 60, [half(0, 1)]);
    expect([full.triggers.right, full.isDown('PadRT'), full.device]).toEqual([1, true, 'keyboard']);
  });
});

describe('Rumble', () => {
  const actuator = () => {
    const calls: [string, Record<string, number>][] = [];
    return { calls, playEffect: (type: string, params: Record<string, number>) => (calls.push([type, params]), Promise.resolve('complete')) };
  };
  const used = (input: Input, act: GamepadLike['vibrationActuator']) => input.beginFrame(0, 1 / 60, [pad([0, 0, 0, 0], [0], { index: 0, vibrationActuator: act })]);

  it("plays the frame's strongest request on the pad in use, scaled by the player's vibration", () => {
    const input = new Input(target());
    const act = actuator();
    used(input, act);
    input.rumble({ strong: 0.2, weak: 0.9, ms: 60 });
    input.rumble({ strong: 0.8, weak: 0.1, ms: 120 });
    expect(act.calls).toEqual([]); // when the frame ends
    input.vibration = 0.5;
    input.endFrame();
    expect(act.calls).toEqual([['dual-rumble', { startDelay: 0, duration: 120, strongMagnitude: 0.4, weakMagnitude: 0.45 }]]);
    input.endFrame();
    expect(act.calls.length).toBe(1); // once
  });

  it('does nothing at vibration 0, headless, during a replay, off the pad, or on a pad that cannot rumble', () => {
    const quiet = (setup: (i: Input) => void, target_: Window | null = target(), act = actuator()) => {
      const input = new Input(target_);
      used(input, act);
      setup(input);
      input.rumble({ strong: 1, weak: 1 });
      input.endFrame();
      return act.calls.length;
    };
    expect(quiet(() => {})).toBe(1);
    expect(quiet((i) => (i.vibration = 0))).toBe(0);
    expect(quiet(() => {}, null)).toBe(0); // Engine.headless
    expect(quiet((i) => (i.playing = true))).toBe(0);
    expect(quiet((i) => i.noteDevice('keyboard'))).toBe(0); // the player put the pad down
    const input = new Input(target());
    used(input, null);
    input.rumble({ strong: 1 });
    expect(() => input.endFrame()).not.toThrow();
  });

  it('a couch player’s pad rumbles alone (`player(slot).rumble`), as player 1’s does: the strongest, scaled, once; never headless, in a replay, at vibration 0 or with no pad there', () => {
    /** Player 1's pad in slot 0 (in use), a guest's in slot 1 (joined); what each was asked to play. */
    const couch = (target_: Window | null = target()) => {
      const one = actuator();
      const two = actuator();
      const input = new Input(target_);
      input.padPlayers = true;
      const pads = () => [pad([0, 0, 0, 0], [0], { index: 0, vibrationActuator: one }), pad([0, 0, 0, 0], [], { index: 1, vibrationActuator: two })];
      input.beginFrame(0, 1 / 60, pads());
      input.joined.add(1);
      input.endFrame();
      input.beginFrame(1 / 60, 1 / 60, pads());
      return { input, one: one.calls, two: two.calls };
    };
    const c = couch();
    c.input.vibration = 0.5;
    c.input.player(1).rumble({ strong: 0.2, weak: 0.6, ms: 80 });
    c.input.player(1).rumble({ strong: 0.6, weak: 0.2, ms: 40 });
    expect(c.two, 'when the frame ends').toEqual([]);
    c.input.endFrame();
    expect(c.two).toEqual([['dual-rumble', { startDelay: 0, duration: 80, strongMagnitude: 0.3, weakMagnitude: 0.3 }]]);
    expect(c.one, 'player 1’s pad: nothing').toEqual([]);
    c.input.endFrame();
    expect(c.two.length, 'once').toBe(1);
    // player 1's rumble shakes player 1's pad alone
    const p1 = couch();
    p1.input.rumble({ strong: 1 });
    p1.input.endFrame();
    expect([p1.one.length, p1.two.length]).toEqual([1, 0]);
    const quiet = (setup: (i: Input) => void, target_: Window | null = target(), slot = 1) => {
      const q = couch(target_);
      setup(q.input);
      q.input.player(slot).rumble({ strong: 1, weak: 1 });
      expect(() => q.input.endFrame()).not.toThrow();
      return q.two.length;
    };
    expect(quiet(() => {})).toBe(1);
    expect(quiet((i) => (i.vibration = 0))).toBe(0);
    expect(quiet(() => {}, null), 'headless').toBe(0);
    // a replay: its pads are the recording's (`playing` forgets the live ones); one still holding a
    // live pad shakes nothing either
    expect(quiet((i) => (i.playing = true)), 'a replay').toBe(0);
    expect(
      quiet((i) => {
        const live = i.player(1).gamepad;
        i.playing = true;
        Object.assign(i.player(1), { gamepad: live, connected: true });
      }),
      'a replay, a live pad left in the slot',
    ).toBe(0);
    expect(quiet(() => {}, target(), 2), 'no pad in that slot').toBe(0);
  });

  it('a pad that refuses (unplugged, Firefox, a rejected effect) logs nothing', async () => {
    const input = new Input(target());
    let rejected = 0;
    used(input, { playEffect: () => (rejected++, Promise.reject(new Error('NotSupportedError'))) });
    input.rumble({ strong: 1, ms: 50 });
    input.endFrame();
    used(input, {
      playEffect: () => {
        throw new Error('InvalidStateError');
      },
    });
    input.rumble({ weak: 1 });
    expect(() => input.endFrame()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run here
    expect(rejected).toBe(1);
  });
});

describe('the device in use and typing', () => {
  it("a phone's soft keyboard, or a key typed into a text field, is not a keyboard picked up (the touch controls stay)", () => {
    const t = target();
    const input = new Input(t);
    input.noteDevice('touch');
    const typed = (o: { key?: string; keyCode?: number; isComposing?: boolean; target?: object }) => {
      const e = Object.assign(new Event('keydown'), { code: 'KeyA', key: o.key ?? 'a', keyCode: o.keyCode ?? 65, isComposing: o.isComposing ?? false, repeat: false });
      if (o.target) Object.defineProperty(e, 'target', { value: o.target });
      t.dispatchEvent(e);
      t.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyA' }));
      return input.device;
    };
    expect(typed({ key: 'Unidentified', keyCode: 229 })).toBe('touch'); // Android's soft keyboard composing
    expect(typed({ keyCode: 229 })).toBe('touch');
    expect(typed({ isComposing: true })).toBe('touch');
    expect(typed({ target: { tagName: 'INPUT' } })).toBe('touch'); // the tree's search box
    expect(typed({ target: { tagName: 'TEXTAREA' } })).toBe('touch');
    expect(typed({ target: { tagName: 'DIV', isContentEditable: true } })).toBe('touch');
    expect(typed({ target: { tagName: 'CANVAS' } })).toBe('keyboard'); // a key on the game: the keyboard
  });
});

describe("the DualSense's touchpad (input.touchpad)", () => {
  type Finger = { id: number; x: number; y: number };
  /** An Input reading a touchpad the test moves; `frame` polls it once and returns this frame's gestures. */
  function touchpad() {
    const input = new Input(null);
    let touches: Finger[] = [];
    input.dualsense = { motion: false, touchpad: true, gyro: () => null, touches: () => touches } satisfies DualSenseInput;
    input.touchpad = true;
    input.setGamepads([]);
    let t = 0;
    const frame = (...fingers: Finger[]) => {
      touches = fingers;
      t += 1 / 60;
      input.beginFrame(t, 1 / 60);
      const out = Object.entries(TOUCHPAD_KEYS)
        .filter(([, code]) => input.wasPressed(code))
        .map(([g]) => g);
      input.endFrame();
      return out;
    };
    return { input, frame };
  }
  const a = (x: number, y = 0.5) => ({ id: 1, x, y });
  const b = (x: number, y = 0.5) => ({ id: 2, x, y });

  it('a one-finger tap and swipe are gestures', () => {
    const { frame } = touchpad();
    frame(a(0.5));
    frame(a(0.5));
    expect(frame()).toEqual(['tap']);
    for (const x of [0.2, 0.4, 0.6, 0.8]) frame(a(x));
    expect(frame()).toEqual(['right']);
  });

  it('two fingers are never a gesture, however they lift: together, or one at a time in either order', () => {
    const { frame } = touchpad();
    const seen: string[] = [];
    // a two-finger tap, the first finger lifted first
    seen.push(...frame(a(0.3), b(0.7)), ...frame(a(0.3), b(0.7)), ...frame(b(0.7)), ...frame());
    // the second lifted first
    seen.push(...frame(a(0.3), b(0.7)), ...frame(a(0.3)), ...frame());
    // a two-finger swipe, one finger lifting before the other
    for (const x of [0.2, 0.4, 0.6]) seen.push(...frame(a(x), b(x + 0.1)));
    seen.push(...frame(b(0.8)), ...frame());
    // a second finger landing during a one-finger swipe
    seen.push(...frame(a(0.2)), ...frame(a(0.4), b(0.5)), ...frame(a(0.6)), ...frame(a(0.8)), ...frame());
    expect(seen).toEqual([]);
    expect([...frame(a(0.5)), ...frame()]).toEqual(['tap']); // bare again: the next touch is a tap
  });

  it('another finger taking the lead while fingers stay is no gesture either', () => {
    const { frame } = touchpad();
    expect([...frame(a(0.5)), ...frame(b(0.5)), ...frame()]).toEqual([]); // one lifted as another landed, in one poll
  });

  it('a couch guest’s DualSense (its `id`) swipes on its own pad, recorded and replayed, never on player 1’s; its turns never turn player 1; `dualSenseGuest` says so', () => {
    const input = new Input(null);
    let touches: Finger[] = [];
    let turning = { x: 0, y: 0, z: 0 };
    input.dualsense = { motion: true, touchpad: true, gyro: () => turning, touches: () => touches } satisfies DualSenseInput;
    input.touchpad = true;
    input.motion.on = true;
    input.padPlayers = true;
    const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
    const SENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
    /** Player 1's Xbox pad in slot 0 (`pressed` down), the DualSense in slot 1; `ids` false: a browser that names neither. */
    const pads = (pressed: number[] = [], ids = true) => [pad([0, 0, 0, 0], pressed, { index: 0, id: ids ? XBOX : '' }), pad([0, 0, 0, 0], [], { index: 1, id: ids ? SENSE : '' })];
    const frames: InputFrame[] = [];
    const memory = { held: '', pointer: '' };
    let t = 0;
    const frame = (list: GamepadLike[], ...fingers: Finger[]) => {
      touches = fingers;
      t += 1 / 60;
      input.beginFrame(t, 1 / 60, list);
      frames.push(input.snapshot(1 / 60, memory));
      const pressed = (r: { wasPressed(...c: string[]): boolean }) => Object.values(TOUCHPAD_KEYS).filter((c) => r.wasPressed(c));
      const out = { p1: pressed(input), guest: pressed(input.player(1)), turn: input.motionTurn.x, device: input.device, isGuests: input.dualSenseGuest };
      input.endFrame();
      return out;
    };
    /** A swipe right over the frames it takes; what each reader saw pressed, and player 1's turn and device at its end. */
    const swipe = (list: GamepadLike[]) => {
      const seen = [0.2, 0.4, 0.6, 0.8].map((x) => frame(list, a(x)));
      seen.push(frame(list));
      return { p1: seen.flatMap((f) => f.p1), guest: seen.flatMap((f) => f.guest), turn: seen.reduce((s, f) => s + f.turn, 0), device: seen.at(-1)!.device, isGuests: seen.every((f) => f.isGuests) };
    };
    // the DualSense joins as player 2; player 1 is on the keyboard
    expect(frame(pads()).isGuests, 'nobody joined: player 1’s DualSense').toBe(false);
    expect(input.dualSenseGuestSlot, 'nobody joined: no guest’s').toBe(null);
    input.joined.add(1);
    input.noteDevice('keyboard');
    turning = { x: 0, y: -64, z: 0 };
    expect(swipe(pads()), 'the guest’s swipe: its own, player 1’s device untouched; `dualSenseGuest` says so').toEqual({ p1: [], guest: ['PadTouchpadRight'], turn: 0, device: 'keyboard', isGuests: true });
    expect(input.dualSenseGuestSlot, 'whose: the guest in slot 1 (its light bar)').toBe(1);
    // a second guest on a DualSense: whose 52in1 reads is unknown
    input.joined.add(2);
    frame([...pads(), pad([0, 0, 0, 0], [], { index: 2, id: SENSE })]);
    expect([input.dualSenseGuest, input.dualSenseGuestSlot], 'two guests’ DualSenses: a guest’s, whose unknown').toEqual([true, null]);
    input.joined.delete(2);
    frame(pads());
    expect(JSON.stringify(frames), '`dualSenseGuest` is presentation: never recorded').not.toMatch(/guest/i);
    const at = frames.findIndex((f) => f.padPressed?.some(([slot, ...codes]) => slot === 1 && codes.includes('PadTouchpadRight')));
    expect([at >= 0, frames.some((f) => f.pressed?.includes('PadTouchpadRight'))], 'recorded with its pad, not player 1’s').toEqual([true, false]);
    // player 1 picks up the Xbox pad: the guest's DualSense turning never turns player 1's aim
    frame(pads([3]));
    expect(swipe(pads()), 'player 1 on a pad: still the guest’s alone').toEqual({ p1: [], guest: ['PadTouchpadRight'], turn: 0, device: 'pad', isGuests: true });
    // replayed: the guest's swipe presses on its pad again
    const again = new Input(null);
    let rt = 0;
    const replayed = (JSON.parse(JSON.stringify(frames)) as InputFrame[]).map((f) => {
      again.playBefore(f);
      rt += f.dt;
      again.beginFrame(rt, f.dt, []);
      again.playAfter(f);
      const out = [again.player(1).wasPressed('PadTouchpadRight'), again.wasPressed('PadTouchpadRight'), again.dualSenseGuest];
      again.endFrame();
      return out;
    });
    expect(replayed[at], 'replayed on the guest’s pad (`dualSenseGuest` false: a replay never reads the DualSense)').toEqual([true, false, false]);
    // the DualSense plays player 1 again (it left), or no pad's id names it: player 1's, as ever
    input.joined.delete(1);
    expect(swipe(pads()), 'not joined: player 1’s').toMatchObject({ p1: ['PadTouchpadRight'], guest: [], isGuests: false });
    expect(swipe(pads()).turn, 'its turns turn player 1').toBeGreaterThan(0);
    input.joined.add(1);
    expect(swipe(pads([], false)), 'no id names it: player 1’s').toMatchObject({ p1: ['PadTouchpadRight'], guest: [], isGuests: false });
  });

  it("the pad's click held is no tap", () => {
    const { input, frame } = touchpad();
    const click = Array.from({ length: 18 }, (_, i) => ({ pressed: i === 17 }));
    input.setGamepads([{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: click }]);
    frame(a(0.5));
    input.setGamepads([]);
    expect([...frame(a(0.5)), ...frame()]).toEqual([]);
  });
});

describe('a shout into the microphone (input.voice)', () => {
  const dt = 1 / 60;
  /**
   * An Input hearing a microphone the test sets the loudness of; `frame` polls it once and says
   * whether it pressed `VoiceShout`. It has heard a quiet room for `SHOUT.learnS` (`learn`: the
   * room's floor learnt), unless `learnt` is false.
   */
  function mic(learnt = true) {
    const input = new Input(null);
    const heard = { level: 0 as number | null, on: true, echo: false, reads: 0, listening: [] as boolean[] };
    input.microphone = {
      get on() {
        return heard.on;
      },
      get echo() {
        return heard.echo;
      },
      level: () => (heard.reads++, heard.level),
      listen: (on) => void heard.listening.push(on),
    } satisfies VoiceInput;
    input.voice = true;
    input.setGamepads([]);
    let t = 0;
    const frames: InputFrame[] = [];
    const last = { held: '', pointer: '' };
    const frame = (level: number | null, runs = true) => {
      heard.level = level;
      t += dt;
      input.beginFrame(t, dt, undefined, runs);
      frames.push(input.snapshot(dt, last));
      const pressed = input.wasPressed(VOICE_KEYS.shout);
      input.endFrame();
      return pressed;
    };
    /** `seconds` of polls at `level`: how many pressed. */
    const hold = (level: number | null, seconds: number, runs = true) => {
      let presses = 0;
      for (let k = 0; k < Math.round(seconds / dt); k++) presses += frame(level, runs) ? 1 : 0;
      return presses;
    };
    /** The room heard at `level` while the floor is learnt (`SHOUT.learnS`): nothing presses. */
    const learn = (level = 0) => hold(level, SHOUT.learnS);
    if (learnt) {
      learn();
      frames.length = 0;
      heard.reads = 0;
    }
    return { input, heard, frame, hold, learn, frames };
  }
  const LOUD = 0.5;

  it('a shout as loud as `SHOUT.loud`, held `SHOUT.holdS`, presses once; quieter or shorter never does', () => {
    expect(mic().hold(SHOUT.loud * 0.95, 1), 'just under the threshold, for a second').toBe(0);
    const { hold, frame } = mic();
    expect(hold(LOUD, SHOUT.holdS - 2 * dt) + hold(0, SHOUT.quietS), 'loud, but too short').toBe(0);
    // the press comes the poll the shout has lasted `holdS`, not before
    const polls = Math.round(SHOUT.holdS / dt);
    const at = Array.from({ length: polls + 3 }, () => frame(SHOUT.loud)).indexOf(true);
    expect(at, 'the poll it has lasted holdS').toBe(polls - 1);
    expect(shoutStep({ ...newShout(), heard: SHOUT.learnS }, 1, SHOUT.holdS), 'one long poll is a whole shout').toBe(true);
  });

  it('one shout is one press: held on, or a breath between its words, it never presses again until quiet for `SHOUT.quietS`', () => {
    const { hold } = mic();
    expect(hold(LOUD, 1), 'held a second').toBe(1);
    expect(hold(0, SHOUT.quietS - 3 * dt) + hold(LOUD, 0.3), 'a breath between words: the same shout').toBe(0);
    expect(hold(0, 1) + hold(LOUD, 0.3), 'quiet a second: a new shout').toBe(1);
    // softer than loud, louder than quiet, keeps a shout's count: it neither grows nor ends there
    const between = (SHOUT.quiet + SHOUT.loud) / 2;
    expect(hold(0, 1) + hold(LOUD, SHOUT.holdS / 2) + hold(between, 0.2) + hold(LOUD, SHOUT.holdS / 2 + dt), 'loud, softer, loud: one shout').toBe(1);
    expect(hold(0, 1) + hold(LOUD, SHOUT.holdS / 2) + hold(0, 2 * dt) + hold(LOUD, SHOUT.holdS / 2 + dt), 'loud, quiet, loud: two short ones, no shout').toBe(0);
  });

  it('nothing is heard or pressed while the game is not listening, the microphone is off or muted, or nothing is heard yet; the microphone is told', () => {
    const { input, heard, hold, learn } = mic();
    input.voice = false;
    expect(hold(LOUD, 1), 'the game not listening').toBe(0);
    expect([heard.reads, heard.listening.at(-1)], 'never read; the microphone told to close').toEqual([0, false]);
    input.voice = true;
    heard.on = false; // the voice feature off, the microphone not allowed, or muted (`VoiceInput.on`)
    expect(hold(LOUD, 1), 'the player lets the game hear nothing').toBe(0);
    expect([heard.reads, heard.listening.at(-1)], 'never read; the game still listens').toEqual([0, true]);
    heard.on = true;
    expect(hold(null, 1), 'no stream yet').toBe(0);
    expect(hold(Number.NaN, 0.5) + learn() + hold(LOUD, SHOUT.holdS), 'a broken reading, then the room learnt again, then a shout').toBe(1);
    // a shout half done when the player mutes is gone: unmuted, it takes a whole shout again
    expect(hold(0, SHOUT.quietS) + hold(LOUD, SHOUT.holdS / 2), 'half a shout').toBe(0);
    heard.on = false;
    hold(LOUD, dt);
    heard.on = true;
    expect(hold(LOUD, SHOUT.holdS - 2 * dt), 'the rest of it, unmuted').toBe(0);
  });

  it('while the game’s own sound may reach the microphone (`echo`: the controller’s speaker playing beside it), nothing it hears makes a shout, and a shout held through it presses once', () => {
    const { heard, hold } = mic();
    heard.echo = true;
    expect(hold(LOUD, 1), 'loud all through the speaker’s sound').toBe(0);
    heard.echo = false;
    expect(hold(LOUD, SHOUT.holdS - 2 * dt), 'still loud after it: a shout counts from the end of it').toBe(0);
    expect(hold(LOUD, 2 * dt), 'loud for holdS after it').toBe(1);
    // a shout half done when the speaker starts is not finished by it
    expect(hold(0, SHOUT.quietS) + hold(LOUD, SHOUT.holdS / 2), 'half a shout').toBe(0);
    heard.echo = true;
    expect(hold(LOUD, 0.5), 'the speaker plays').toBe(0);
    heard.echo = false;
    expect(hold(LOUD, SHOUT.holdS - 2 * dt), 'loud on after it, short of a whole shout: the half before the speaker is gone').toBe(0);
    expect(hold(0, SHOUT.quietS), 'quiet after').toBe(0);
    // a shout that pressed, held on through the speaker's sound: still the one press
    expect(hold(LOUD, 0.5), 'a shout').toBe(1);
    heard.echo = true;
    expect(hold(LOUD, 0.5) + hold(0, SHOUT.quietS - 3 * dt), 'held on through the speaker, a breath under it').toBe(0);
    heard.echo = false;
    expect(hold(LOUD, 0.5), 'still the same shout').toBe(0);
    expect(hold(0, SHOUT.quietS) + hold(LOUD, 0.5), 'the next one').toBe(1);
  });

  it('a shout completed in a frame that never runs (paused, loading) presses nothing, then or after', () => {
    const { hold } = mic();
    expect(hold(LOUD, 0.5, false), 'paused').toBe(0);
    expect(hold(LOUD, 0.5), 'the same shout, play resumed').toBe(0);
    expect(hold(0, SHOUT.quietS) + hold(LOUD, 0.5), 'the next one').toBe(1);
  });

  it('is recorded as a press and replayed exactly, never hearing the microphone in the replay', () => {
    const { input, heard, frames, hold } = mic();
    hold(0, 0.2);
    hold(LOUD, 0.5);
    hold(0, 0.5);
    const at = frames.findIndex((f) => f.pressed?.includes(VOICE_KEYS.shout));
    expect([at, frames.filter((f) => f.pressed?.includes(VOICE_KEYS.shout)).length], 'one press, recorded').toEqual([Math.round(0.2 / dt) + Math.round(SHOUT.holdS / dt) - 1, 1]);
    // replayed on the same Input, its microphone still there and loud: only the recording presses
    input.playing = true;
    heard.reads = 0;
    heard.level = LOUD;
    let t = 0;
    const replayed = (JSON.parse(JSON.stringify(frames)) as InputFrame[]).map((f) => {
      input.playBefore(f);
      t += f.dt;
      input.beginFrame(t, f.dt, []);
      input.playAfter(f);
      const out = input.wasPressed(VOICE_KEYS.shout);
      input.endFrame();
      return out;
    });
    expect([replayed.indexOf(true), replayed.filter(Boolean).length]).toEqual([at, 1]);
    expect([heard.reads, heard.listening.at(-1)], 'the microphone never read in a replay, and told to close').toEqual([0, false]);
  });

  // the room's floor (`SHOUT.floorLoud`, `floorQuiet`, `floorS`, `learnS`): the room's average level,
  // so a hum ends under a shout and a shout over it presses
  const HUM = 0.25;

  it('a steady hum louder than `SHOUT.loud`, heard from the start, never presses; a shout over it does, and the hum ends it', () => {
    const { hold } = mic(false);
    expect(HUM, 'a shout, were the threshold fixed').toBeGreaterThan(SHOUT.loud);
    expect(hold(HUM, 10), 'ten seconds of a hum (a fan, a TV)').toBe(0);
    const over = HUM * SHOUT.floorLoud * 1.2;
    expect(hold(over, 0.3) + hold(HUM, 1), 'a shout over it, the hum after').toBe(1);
    expect(hold(over, 0.3) + hold(HUM, 1), 'the next: the hum ended the last').toBe(1);
    expect(hold(HUM * SHOUT.floorLoud * 0.9, 2), 'louder than the hum, short of `floorLoud` times it').toBe(0);
  });

  it('a sound that starts and stays (a fan turned on) presses once at most, as a shout would; the floor follows it within seconds (`SHOUT.floorS`), and a shout over it presses', () => {
    const { input, hold } = mic();
    expect(hold(HUM, 0.5), 'it starts, as loud as a shout').toBe(1);
    expect(hold(HUM, 20), 'twenty seconds on').toBe(0);
    expect(input.shoutMeter?.loud, 'the floor now').toBeCloseTo(HUM * SHOUT.floorLoud, 6);
    expect(hold(HUM * SHOUT.floorLoud * 1.2, 0.3) + hold(HUM, 1), 'a shout over it').toBe(1);
  });

  it('a shout lifts the floor only for a moment: shouts a second apart each press', () => {
    const { input, hold } = mic();
    expect(Array.from({ length: 6 }, () => hold(LOUD, 0.3) + hold(0, 1)), 'six shouts, a second of quiet between').toEqual([1, 1, 1, 1, 1, 1]);
    expect(input.shoutMeter?.loud, 'what a shout needs: the quiet room’s again').toBe(SHOUT.loud);
  });

  it('the first `SHOUT.learnS` of each stream learn the room: loud from the first poll heard presses nothing and is the floor, until the room is quiet again', () => {
    const { input, hold } = mic(false);
    expect(hold(LOUD, 1), 'loud from the first poll').toBe(0);
    expect(input.shoutMeter?.loud, 'the room it learnt').toBeCloseTo(LOUD * SHOUT.floorLoud, 6);
    expect(hold(LOUD * SHOUT.floorLoud * 1.2, 0.3), 'a shout over it').toBe(1);
    expect(hold(0, 3) + hold(LOUD, 0.3), 'quiet three seconds: the floor fallen, as loud is a shout').toBe(1);
    expect(hold(0, 1) + hold(null, 0.1) + hold(LOUD, 1), 'a new stream (nothing heard between), loud from its first poll').toBe(0);
    // part-way through a shout while learning: nothing presses until `learnS` is heard
    expect(shoutStep({ ...newShout(), loud: SHOUT.holdS }, 1, 1 / 50), 'learning').toBe(false);
    expect(shoutStep({ ...newShout(), loud: SHOUT.holdS, heard: SHOUT.learnS }, 1, 1 / 50), 'learnt').toBe(true);
  });

  it('a state written for 0.73.0 (`{ loud, quiet, fired }`) is filled in by `shoutStep`: it learns the room as `newShout()` does, then presses', () => {
    const old: ShoutState = { loud: 0, quiet: 0, fired: false };
    const polls = (level: number, seconds: number) => Array.from({ length: Math.round(seconds / dt) }, () => shoutStep(old, level, dt)).filter(Boolean).length;
    expect(shoutLevels(old), 'no floor yet: `SHOUT`’s levels').toEqual({ loud: SHOUT.loud, quiet: SHOUT.quiet });
    expect(polls(0.01, SHOUT.learnS), 'a quiet room, learnt').toBe(0);
    expect([old.heard, old.floor]).toEqual([expect.closeTo(SHOUT.learnS, 9), 0.01]);
    expect(polls(LOUD, 0.3) + polls(0.01, 1) + polls(LOUD, 0.3), 'two shouts').toBe(2);
    const broken: ShoutState = { loud: 0, quiet: 0, fired: false, floor: Number.NaN, heard: Number.NaN };
    expect([shoutStep(broken, 0.01, dt), broken.floor, broken.heard], 'NaN: as left out').toEqual([false, 0.01, dt]);
  });

  it('what is heard while the game’s own sound may reach the microphone (`echo`) leaves the floor alone', () => {
    const { input, heard, hold } = mic();
    const mid = SHOUT.loud * 0.9; // under a shout, and `floorLoud` times it over one
    heard.echo = true;
    expect(hold(mid, 3), 'the speaker playing, a sound under a shout').toBe(0);
    heard.echo = false;
    expect(input.shoutMeter?.loud, 'the floor still the quiet room’s').toBe(SHOUT.loud);
    expect(hold(SHOUT.loud * 1.1, 0.5), 'a shout just over `loud`').toBe(1);
    // the same sound heard with no speaker playing is the room's: that shout is under it
    const room = mic();
    expect(room.hold(mid, 10), 'heard, not an echo').toBe(0);
    expect(room.input.shoutMeter?.loud, 'the floor').toBeCloseTo(mid * SHOUT.floorLoud, 3);
    expect(room.hold(SHOUT.loud * 1.1, 0.5), 'the same shout, under it').toBe(0);
  });

  it('a quiet microphone (low gain), at the most sensitive, presses under `SHOUT.loud` over a quiet room; over a noisy one a shout must be `floorLoud` times the room', () => {
    /** An Input in a room as loud as `level`, learnt, at the highest sensitivity. */
    const room = (level: number) => {
      const m = mic(false);
      m.input.shoutSensitivity = VOICE_SENSITIVITY.max;
      m.learn(level);
      m.hold(level, 1);
      return { shout: (loud: number) => m.hold(loud, 0.5) + m.hold(level, 0.5) };
    };
    const soft = SHOUT.loud / 2; // a low-gain microphone's shout
    expect(room(0.004).shout(soft), 'a quiet room').toBe(1);
    const noisy = 0.08; // over `SHOUT.loud / 3`, so the room's floor decides
    expect(room(noisy).shout(noisy * SHOUT.floorLoud * 0.9), 'a noisy room: under `floorLoud` times it').toBe(0);
    expect(room(noisy).shout(noisy * SHOUT.floorLoud * 1.2), 'a noisy room: a shout over it').toBe(1);
    const plain = mic();
    expect(plain.hold(soft, 0.5), 'the same shout at sensitivity 1').toBe(0);
  });

  it('the player’s sensitivity (`input.shoutSensitivity`) divides `SHOUT.loud` and `quiet`: higher presses on less, lower needs more', () => {
    /** A half-second sound at `level` and sensitivity `k`, over a quiet room: how many pressed. */
    const at = (k: number, level: number) => {
      const { input, hold } = mic();
      input.shoutSensitivity = k;
      return hold(level, 0.5);
    };
    expect(at(1, SHOUT.loud * 0.6), 'at 1: too soft').toBe(0);
    expect(at(2, SHOUT.loud * 0.6), 'at 2: a shout').toBe(1);
    expect(at(0.5, SHOUT.loud * 1.5), 'at 0.5: loud is not enough').toBe(0);
    expect(at(0.5, SHOUT.loud * 2.5), 'at 0.5: twice as loud').toBe(1);
    expect([shoutLevels({ floor: 0 }, 2), shoutLevels({ floor: 0 }, 0), shoutLevels({ floor: 0 }, Number.NaN), shoutLevels({ floor: 0.1 }, 2)]).toEqual([
      { loud: SHOUT.loud / 2, quiet: SHOUT.quiet / 2 },
      { loud: SHOUT.loud, quiet: SHOUT.quiet },
      { loud: SHOUT.loud, quiet: SHOUT.quiet },
      { loud: 0.1 * SHOUT.floorLoud, quiet: 0.1 * SHOUT.floorQuiet }, // the floor still in force
    ]);
  });

  it('`shoutMeter` says what it hears and what a shout needs, for a meter beside a voice setting: never in a replay, nor while nothing is heard', () => {
    const { input, hold, learn } = mic(false);
    expect(input.shoutMeter, 'nothing heard yet').toBeNull();
    learn(0.01);
    expect(input.shoutMeter).toEqual({ level: 0.01, loud: SHOUT.loud, shouted: false });
    input.shoutSensitivity = 2;
    expect(input.shoutMeter?.loud).toBe(SHOUT.loud / 2);
    expect(hold(LOUD, SHOUT.holdS), 'a shout').toBe(1);
    expect(input.shoutMeter, 'it pressed').toMatchObject({ level: LOUD, shouted: true });
    expect(input.shoutMeter!.loud, 'the shout lifts the floor, slowly').toBeGreaterThan(SHOUT.loud / 2);
    expect(input.shoutMeter!.loud, 'the shout lifts the floor, slowly').toBeLessThan(LOUD);
    hold(HUM, 8); // a hum: the floor
    expect(input.shoutMeter!.loud, 'a hum lifts what a shout needs').toBeCloseTo(HUM * SHOUT.floorLoud, 2);
    input.playing = true;
    input.beginFrame(100, dt, []);
    expect(input.shoutMeter, 'a replay').toBeNull();
    input.playing = false;
    hold(LOUD, dt);
    expect(input.shoutMeter?.level, 'heard again').toBe(LOUD);
    input.voice = false;
    hold(LOUD, dt);
    expect(input.shoutMeter, 'not listening').toBeNull();
  });
});

// The numbers in `SHOUT` against simulated rooms, at 60 polls a second (`shoutStep`); the tables in
// docs/engine/hub.md *Shouts* are these. No room may lock shouts out: a player shouting (0.4 RMS for
// 0.3 s, once a second) from any moment presses within a few seconds, at every sensitivity. A room
// may press on its own (loud talk or music near the microphone): those presses are counted here,
// and a lower sensitivity has fewer.
describe('shouts in simulated rooms: none locks a shout out, and a lower sensitivity presses less on its own', () => {
  const dt = 1 / 60;
  /** A room's loudness (RMS) at `t` seconds. */
  type Sound = (t: number) => number;
  const QUIET: Sound = () => 0.005;
  /** A fan's hum, louder than `SHOUT.loud`. */
  const HUM: Sound = (t) => 0.25 * (1 + 0.03 * Math.sin(37 * t));
  /** Music that swells and dips at 0.5 Hz, 0 to 0.3. */
  const MUSIC: Sound = (t) => 0.15 * (1 - Math.cos(Math.PI * t));
  /** Loud music, 0.3 to 0.5. */
  const LOUD_MUSIC: Sound = (t) => 0.4 + 0.1 * Math.sin(4 * Math.PI * t);
  /**
   * Words: each 0.12 to 0.45 s at `low` to `high` RMS, 0.04 to 0.2 s apart, a pause of 0.4 to 1.2 s
   * after every 3 to 8, under them 0.02 (a seeded random, the same every run).
   */
  const words = (low: number, high: number, seed: number): Sound => {
    const random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let x = Math.imul(seed ^ (seed >>> 15), seed | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const polls = new Float64Array(Math.round(70 / dt)).fill(0.02);
    for (let t = 0; t < 70; t += 0.4 + random() * 0.8) {
      for (let n = 3 + Math.floor(random() * 6); n > 0; n--) {
        const [length, level] = [0.12 + random() * 0.33, low + random() * (high - low)];
        polls.fill(level, Math.round(t / dt), Math.round((t + length) / dt));
        t += length + 0.04 + random() * 0.16;
      }
    }
    return (t) => polls[Math.round(t / dt)] ?? 0.02;
  };
  /** A TV's words, 0.1 to 0.25. */
  const TV = words(0.1, 0.25, 1);
  /** Talk near the microphone, 0.15 to 0.35. */
  const TALK = words(0.15, 0.35, 7);
  /** A shout of `level` for 0.3 s at each of `at` (seconds) over `room`: their powers add. */
  const shouts = (room: Sound, at: readonly number[], level = 0.4): Sound => (t) => Math.hypot(room(t), at.some((s) => t >= s && t < s + 0.3) ? level : 0);
  /** `room` from `from` seconds on, the quiet room before (talk starting mid-listen). */
  const from = (from: number, room: Sound): Sound => (t) => (t < from ? QUIET(t) : room(t - from));
  /** The seconds a new stream hearing `room` for `seconds` presses at. */
  const presses = (room: Sound, seconds: number, sensitivity = 1) => {
    const s = newShout();
    const at: number[] = [];
    for (let k = 0; k < Math.round(seconds / dt); k++) if (shoutStep(s, room(k * dt), dt, sensitivity)) at.push(k * dt);
    return at;
  };
  /**
   * A player shouting once a second over `room`, from any moment between 8 and 50 s: the longest
   * from the first shout to a press during one (seconds, to 0.01), Infinity if none in ten.
   */
  const wait = (room: Sound, sensitivity: number) => {
    let longest = 0;
    for (let start = 8; start < 50; start += 0.37) {
      const at = Array.from({ length: 10 }, (_, k) => start + k);
      const first = presses(shouts(room, at), start + 10, sensitivity).find((p) => at.some((s) => p >= s && p < s + 0.3));
      longest = Math.max(longest, first === undefined ? Infinity : Math.round((first - start) * 100) / 100);
    }
    return longest;
  };
  /** The player's sensitivities: 50%, 100% (the default), 200%, 300% (`VOICE_SENSITIVITY`). */
  const SENSITIVITIES = [0.5, 1, 2, 3];
  const ROOMS: Record<string, Sound> = {
    quiet: QUIET,
    hum: HUM,
    'hum turned on': from(5, HUM),
    music: MUSIC,
    tv: TV,
    'tv turned on': from(5, TV),
    talk: TALK,
    'talk turned on': from(5, TALK),
  };
  const table = (cell: (room: Sound, sensitivity: number) => number) => Object.fromEntries(Object.entries(ROOMS).map(([name, room]) => [name, SENSITIVITIES.map((k) => cell(room, k))]));

  it('nobody shouting for 60 s: the presses at 50%, 100%, 200% and 300%, fewer at a lower sensitivity and none at 50%', () => {
    const alone = table((room, k) => presses(room, 60, k).length);
    expect(alone).toEqual({
      quiet: [0, 0, 0, 0],
      hum: [0, 0, 0, 0],
      'hum turned on': [0, 1, 1, 1], // as it starts, as a shout would
      music: [0, 30, 30, 30], // every swell
      tv: [0, 19, 26, 26],
      'tv turned on': [0, 17, 24, 24],
      talk: [0, 23, 23, 23],
      'talk turned on': [0, 22, 22, 22],
    });
    for (const [name, counts] of Object.entries(alone)) expect(counts, name).toEqual([0, ...counts.slice(1)].sort((a, b) => a - b));
  });

  it('no room locks a shout out: shouting once a second from any moment presses within a few seconds, at every sensitivity', () => {
    const waits = table(wait);
    expect(waits).toEqual({
      quiet: [0.15, 0.15, 0.15, 0.15], // the first shout presses, as it has lasted `SHOUT.holdS`
      hum: [0.15, 0.15, 0.15, 0.15],
      'hum turned on': [0.15, 0.15, 0.15, 0.15],
      music: [0.15, 1.15, 1.15, 1.15], // the second at most: the first may come as a swell has pressed
      tv: [0.15, 2.14, 2.15, 2.15],
      'tv turned on': [0.15, 2.15, 2.15, 2.15],
      talk: [0.15, 3.14, 3.14, 3.14],
      'talk turned on': [0.15, 4.14, 4.14, 4.14],
    });
    expect(Math.max(...Object.values(waits).flat()), 'the longest wait').toBeLessThan(5);
  }, 30_000); // millions of shout steps: ~1.2 s alone, more on a loaded box or CI's runner

  it('a shout alone presses once; a soft one (0.12) is under `SHOUT.loud` at 1, a shout at 2', () => {
    expect(presses(shouts(QUIET, [5]), 8)).toHaveLength(1);
    expect([presses(shouts(QUIET, [5], 0.12), 8).length, presses(shouts(QUIET, [5], 0.12), 8, 2).length]).toEqual([0, 1]);
  });

  it('a silent room at the most sensitive (3): its floor is 0, and a shout needs `SHOUT.loud / 3`, no more', () => {
    const s = newShout();
    for (let k = 0; k < 120; k++) shoutStep(s, 0, dt, VOICE_SENSITIVITY.max);
    expect([s.floor, shoutLevels(s, VOICE_SENSITIVITY.max)]).toEqual([0, { loud: SHOUT.loud / 3, quiet: SHOUT.quiet / 3 }]);
    const silent: Sound = () => 0;
    expect([presses(shouts(silent, [5]), 8, 3).length, presses(shouts(silent, [5], (SHOUT.loud / 3) * 1.01), 8, 3).length, presses(shouts(silent, [5], (SHOUT.loud / 3) * 0.99), 8, 3).length]).toEqual([1, 1, 0]);
  });

  it('five seconds of loud music press once as they start, as a shout would; a shout counts from half a second after they end', () => {
    const music: Sound = (t) => (t < 5 ? LOUD_MUSIC(t) : QUIET(t));
    expect(presses(from(5, music), 22), 'the music starts').toHaveLength(1);
    const after = (seconds: number) => presses(shouts(from(5, music), [10 + seconds]), 22).filter((t) => t >= 10).length;
    expect([after(0), after(0.3), after(0.5), after(1), after(2)], 'a shout 0, 0.3, 0.5, 1 and 2 s after the music').toEqual([0, 0, 1, 1, 1]);
  });
});

describe("motion aim's turn (input.motionTurn)", () => {
  /** An Input reading a gyro the test turns, its motion aim on, the pad in use; `frame` polls it once and returns what a game reads. */
  function gyro() {
    const input = new Input(null);
    let now = { x: 0, y: 0, z: 0 };
    input.dualsense = { motion: true, touchpad: false, gyro: () => now, touches: () => null } satisfies DualSenseInput;
    input.motion.on = true;
    input.setGamepads([pad()]);
    input.noteDevice('pad');
    let t = 0;
    const frames: InputFrame[] = [];
    const last = { held: '', pointer: '' };
    const frame = (turn: { x: number; y: number; z: number } = now) => {
      now = turn;
      t += 1 / 60;
      input.beginFrame(t, 1 / 60);
      frames.push(input.snapshot(1 / 60, last));
      const out = { turn: { ...input.motionTurn }, look: { ...input.lookAxis }, delta: { ...input.mouseDelta } };
      input.endFrame();
      return out;
    };
    return { input, frame, frames };
  }
  const dt = 1 / 60;
  const right64 = { x: 0, y: -64, z: 0 }; // turning right, 64° a second

  it('is the turn this frame in degrees past a still hand, times the sensitivity, as mouseDelta turns; nothing off the pad, still, or off', () => {
    const { input, frame } = gyro();
    const a = frame(right64);
    expect(a.turn.x).toBeCloseTo((64 - MOTION_AIM.still) * dt, 9);
    expect(a.turn.y).toBe(0);
    expect(a.delta.x).toBeCloseTo(a.turn.x * MOTION_AIM.pixels, 9); // the camera's turn, in pointer pixels
    expect(a.look.x, 'leaning the aim stick, as 52in1’s own Motion aim does').toBeGreaterThan(MOTION_AIM.floor);
    expect(frame({ x: 20, y: 0, z: 0 }).turn.y, 'tipped up: up, as the pointer goes (y down)').toBeCloseTo(-(20 - MOTION_AIM.still) * dt, 9);
    input.motion.sensitivity = 2;
    expect(frame(right64).turn.x).toBeCloseTo(2 * (64 - MOTION_AIM.still) * dt, 9);
    expect(frame({ x: 0, y: -3, z: 0 }).turn, 'a hand holding still').toEqual({ x: 0, y: 0 });
    input.noteDevice('keyboard');
    expect(frame(right64).turn, 'the pad put down').toEqual({ x: 0, y: 0 });
    input.noteDevice('pad');
    input.motion.on = false;
    expect(frame(right64).turn, 'motion aim off').toEqual({ x: 0, y: 0 });
  });

  it('with lean off, the aim stick is the stick alone while the turn still arrives', () => {
    const { input, frame } = gyro();
    input.motion.lean = false;
    const a = frame(right64);
    expect([a.look, a.turn.x > 0, a.delta.x > 0]).toEqual([{ x: 0, y: 0 }, true, true]);
    input.setGamepads([pad([0, 0, 0.6, 0])]);
    expect(frame(right64).look.x, 'the stick, exactly').toBeCloseTo((0.6 - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE), 9);
  });

  it('is recorded while it turns and replayed exactly, and lasts the frame', () => {
    const { input, frame, frames } = gyro();
    const seen = [frame(right64), frame({ x: 0, y: 30, z: 0 }), frame({ x: 0, y: 0, z: 0 })].map((f) => f.turn);
    expect([frames[0]!.turn, frames[2]!.turn]).toEqual([[seen[0]!.x, seen[0]!.y], undefined]);
    expect(input.motionTurn, 'gone once the frame ends').toEqual({ x: 0, y: 0 });
    const again = new Input(null);
    let t = 0;
    const replayed = (JSON.parse(JSON.stringify(frames)) as InputFrame[]).map((f) => {
      again.playBefore(f);
      t += f.dt;
      again.beginFrame(t, f.dt, []);
      again.playAfter(f);
      const turn = { ...again.motionTurn };
      again.endFrame();
      return turn;
    });
    expect(replayed).toEqual(seen);
  });
});

describe('couch co-op: each pad on its own (input.player)', () => {
  /** At 60 Hz, the polls the twin window takes (50 ms: 3) and a join's wait (33 ms: 2): `TWIN_SECONDS`. */
  const WINDOW = Math.round(TWIN_SECONDS.window * 60);
  const WAIT = Math.ceil(TWIN_SECONDS.wait * 60);
  /** An Input reading `pads` (by slot) on their own; `frame` polls once and returns what the game would read. */
  function couch() {
    const input = new Input(null);
    input.padPlayers = true;
    let t = 0;
    const frame = (pads: (GamepadLike | null)[]) => {
      t += 1 / 60;
      input.beginFrame(t, 1 / 60, pads.map((p, i) => (p ? { ...p, index: i } : null)));
      const seen = {
        p1: { a: input.isDown('PadA'), pressed: input.wasPressed('PadA'), move: input.moveAxis(), look: { ...input.lookAxis }, device: input.device },
        p2: { a: input.player(1).isDown('PadA'), pressed: input.player(1).wasPressed('PadA'), move: input.player(1).moveAxis(), look: { ...input.player(1).lookAxis }, triggers: { ...input.player(1).triggers } },
        joined: [...input.joinedNow],
      };
      input.endFrame();
      return seen;
    };
    return { input, frame };
  }

  it('reads every pad on its own while the merged input stays player 1’s; a pad that joined no longer drives player 1', () => {
    const { input, frame } = couch();
    // two pads: both drive the merged input (every game as before), and each reads on its own too
    let f = frame([pad([0, 0, 0, 0]), pad([0.9, 0, 0, -0.9], [0, 7])]);
    expect([f.p1.a, f.p2.a, f.p2.pressed, f.p2.move.x > 0.8, f.p2.look.y > 0.8, f.p2.triggers.right]).toEqual([true, true, true, true, true, 1]);
    expect(input.player(0).isDown('PadA'), 'pad 0 holds nothing').toBe(false);
    frame([pad(), pad()]);
    // pad 1 joins: its buttons and sticks are its own from now on, player 1 never sees them
    input.noteDevice('keyboard');
    input.joined.add(1);
    f = frame([pad(), pad([0.9, 0, 0, 0], [0, 12])]);
    expect([f.p1.a, f.p1.move, f.p1.look, f.p2.a, f.p2.pressed, f.p2.move.x > 0.8]).toEqual([false, { x: 0, y: 0 }, { x: 0, y: 0 }, true, true, true]);
    expect(input.player(1).isDown('ArrowUp'), 'its d-pad too').toBe(true);
    expect(input.device, 'a joined pad is never player 1’s device in use').toBe('keyboard');
    // the d-pad moves it when the stick rests
    f = frame([pad(), pad([0, 0, 0, 0], [15])]);
    expect(f.p2.move).toEqual({ x: 1, y: 0 });
    // its presses queue for fixed-step code, as the merged input's do
    frame([pad(), pad([0, 0, 0, 0], [2])]);
    expect([input.player(1).consumePress('PadX'), input.player(1).consumePress('PadX'), input.consumePress('PadX')]).toEqual([true, false, false]);
    // left: it drives player 1 again
    input.joined.delete(1);
    frame([pad(), pad()]);
    f = frame([pad(), pad([0, 0, 0, 0], [0])]);
    expect([f.p1.a, f.p2.a]).toEqual([true, true]);
    // gone: nothing held
    frame([pad(), null]);
    expect([input.player(1).connected, input.player(1).isDown('PadA'), input.player(0).connected]).toEqual([false, false, true]);
    expect(() => input.player(4)).toThrow(RangeError);
  });

  it('off (the default), nothing is read on its own', () => {
    const input = new Input(null);
    input.beginFrame(1 / 60, 1 / 60, [pad([0, 0, 0, 0], [0])]);
    expect([input.isDown('PadA'), input.player(0).isDown('PadA'), input.player(0).connected]).toEqual([true, false, false]);
  });

  it('joinWith: another pad pressing Cross joins before the press reaches anything; player 1’s pad in use never does', () => {
    const { input, frame } = couch();
    input.joinWith = ['PadA'];
    // player 1 picks up pad 0 (its press is a use), then presses Cross on it: player 1's, no join
    frame([pad([0, 0, 0, 0], [3]), pad()]);
    frame([pad(), pad()]);
    expect([input.device, input.padIndex]).toEqual(['pad', 0]);
    let f = frame([pad([0, 0, 0, 0], [0]), pad()]);
    expect([f.joined, f.p1.pressed]).toEqual([[], true]);
    for (let n = 0; n < WINDOW; n++) frame([pad(), pad()]); // past the window a twin's press would come in
    // pad 1's Cross: player 1 is on a pad, so the join waits 33 ms (WAIT polls: a twin's press
    // would come by then), its pad driving nothing meanwhile; then it joins, and the press that
    // joined presses nothing (held, it reads as up until let go)
    for (let n = 0; n < WAIT; n++) {
      f = frame([pad(), pad([0.9, 0, 0, 0], [0])]);
      expect([f.joined, [...input.joined], f.p1.pressed, f.p1.a, f.p1.move, f.p2.pressed, f.p2.a], `waiting, poll ${n}`).toEqual([[], [], false, false, { x: 0, y: 0 }, false, false]);
    }
    f = frame([pad(), pad([0, 0, 0, 0], [0])]);
    expect([f.joined, [...input.joined], f.p1.pressed, f.p1.a, f.p2.pressed, f.p2.a, input.padIndex]).toEqual([[1], [1], false, false, false, false, 0]);
    f = frame([pad(), pad([0, 0, 0, 0], [0])]);
    expect([f.joined, f.p2.a]).toEqual([[], false]);
    frame([pad(), pad()]);
    f = frame([pad(), pad([0, 0, 0, 0], [0])]);
    expect([f.p2.pressed, f.p2.a, f.p1.a]).toEqual([true, true, false]); // pressed anew: its own
    // player 1 on the keyboard: any pad that has not joined may join, at once
    input.noteDevice('keyboard');
    f = frame([pad([0, 0, 0, 0], [0]), pad()]);
    expect([f.joined, [...input.joined].sort()]).toEqual([[0], [0, 1]]);
    // nobody joins while joinWith is null
    input.joined.clear();
    input.joinWith = null;
    frame([pad(), pad()]);
    f = frame([pad(), pad([0, 0, 0, 0], [0])]);
    expect([f.joined, f.p1.a]).toEqual([[], true]);
  });

  it('a controller seen twice (a virtual pad beside the real one: DS4Windows, Steam Input) never joins its own twin: a Cross player 1’s pad pressed in the same poll', () => {
    for (const mine of [0, 1]) {
      const { input, frame } = couch();
      input.joinWith = ['PadA'];
      const twin = 1 - mine;
      /** The two pads as the browser lists them, both pressing `buttons` (one controller, two pads). */
      const both = (buttons: number[]) => [pad([0, 0, 0, 0], buttons), pad([0, 0, 0, 0], buttons)];
      // player 1 picks up their pad (the twin's press is a use too: the higher index's wins, so pick it by its own press)
      frame(mine === 0 ? [pad([0, 0, 0, 0], [3]), pad()] : [pad(), pad([0, 0, 0, 0], [3])]);
      frame([pad(), pad()]);
      expect([input.device, input.padIndex], `player 1 on pad ${mine}`).toEqual(['pad', mine]);
      // every press shows on both: Cross is player 1's, nobody joins
      for (let n = 0; n < 3; n++) {
        const f = frame(both([0]));
        expect([f.joined, [...input.joined], input.isDown('PadA')], `pad ${twin} is pad ${mine}'s twin`).toEqual([[], [], true]);
        frame(both([]));
      }
      // another controller (pad 2) still joins, once the twin's window and the wait are over
      for (let n = 0; n < WINDOW; n++) frame([pad(), pad()]);
      const joins = Array.from({ length: WAIT + 1 }, () => frame([pad(), pad(), pad([0, 0, 0, 0], [0])]).joined);
      expect([joins, [...input.joined]]).toEqual([[...Array.from({ length: WAIT }, () => []), [2]], [2]]);
    }
  });

  it('the twin’s press a poll late, or a poll early (DS4Windows, Steam Input feed it a few milliseconds after the real pad), never joins; Cross reaches player 1 once', () => {
    for (const mine of [0, 1]) {
      for (const lag of [1, -1, 2, -2]) {
        const { input, frame } = couch();
        input.joinWith = ['PadA'];
        const twin = 1 - mine;
        /** The two pads as the browser lists them: player 1's real pad pressing `real`, its twin `virtual`. */
        const pads = (real: number[], virtual: number[]) => (mine === 0 ? [pad([0, 0, 0, 0], real), pad([0, 0, 0, 0], virtual)] : [pad([0, 0, 0, 0], virtual), pad([0, 0, 0, 0], real)]);
        frame(mine === 0 ? [pad([0, 0, 0, 0], [3]), pad()] : [pad(), pad([0, 0, 0, 0], [3])]);
        frame(pads([], []));
        expect([input.device, input.padIndex], `player 1 on pad ${mine}`).toEqual(['pad', mine]);
        const where = `pad ${twin}, ${Math.abs(lag)} poll(s) ${lag > 0 ? 'late' : 'early'}`;
        // Cross held on both, the twin's going down `lag` polls after (or before) the real one's, and let go the same way
        const seen: { joined: number[]; pressed: boolean }[] = [];
        for (let k = 0; k < 8; k++) {
          const real = k >= Math.max(0, -lag) && k < 5;
          const virtual = k >= Math.max(0, lag) && k < 5 + lag;
          const f = frame(pads(real ? [0] : [], virtual ? [0] : []));
          seen.push({ joined: f.joined, pressed: f.p1.pressed });
        }
        expect([seen.flatMap((s) => s.joined), [...input.joined]], `${where}: nobody joined`).toEqual([[], []]);
        expect(seen.filter((s) => s.pressed).length, `${where}: Cross pressed once for player 1`).toBe(1);
        expect(seen.findIndex((s) => s.pressed), `${where}: when the real pad pressed it`).toBe(Math.max(0, -lag));
        // the twin connecting (Steam Input starting it) while player 1 holds Cross: it shows up with Cross down, and never joins
        const alone = (real: number[]) => pads(real, []).map((p, i) => (i === twin ? null : p));
        frame(alone([3]));
        frame(alone([]));
        expect(input.padIndex, `${where}: player 1 on its real pad`).toBe(mine);
        for (let k = 0; k < WINDOW + 2; k++) frame(alone([0]));
        for (let k = 0; k < 4; k++) frame(pads([0], [0]));
        expect([...input.joined], `${where}: a twin seen first while player 1 holds Cross`).toEqual([]);
      }
    }
  });

  it('the twin window (50 ms) and a join’s wait (33 ms) last as long at 120 Hz as at 60 Hz (timed by the frames’ dt, not counted in polls), a poll at least', () => {
    // per frame rate: the most polls the twin's press may lag player 1's and still be its twin (under
    // 50 ms, a poll at least), the most it may come first (within the wait), the polls a join waits
    const RATES = [
      { hz: 60, late: 2, early: 2, wait: 2 },
      { hz: 120, late: 5, early: 4, wait: 4 },
      { hz: 20, late: 1, early: 1, wait: 1 }, // slow frames: the next poll is still the window, the wait one poll
    ] as const;
    for (const { hz, late, early, wait } of RATES) {
      const dt = 1 / hz;
      /** A couch at `hz`, player 1 on pad 0; `frame` polls once (pads 0 to 2 pressing what `down` says) and returns the pads that joined. */
      const couchAt = () => {
        const input = new Input(null);
        input.padPlayers = true;
        input.joinWith = ['PadA'];
        let t = 0;
        const frame = (down: [boolean, boolean, boolean]) => {
          t += dt;
          input.beginFrame(t, dt, down.map((d, i) => ({ ...pad([0, 0, 0, 0], d ? [0] : []), index: i })));
          const joined = [...input.joinedNow];
          input.endFrame();
          return joined;
        };
        input.beginFrame(dt, dt, [0, 1, 2].map((i) => ({ ...pad([0, 0, 0, 0], i === 0 ? [3] : []), index: i })));
        input.endFrame();
        frame([false, false, false]);
        expect([input.device, input.padIndex], `${hz} Hz: player 1 on pad 0`).toEqual(['pad', 0]);
        return { input, frame };
      };
      // another controller (pad 2) pressing Cross joins once the wait is over: 33 ms on
      {
        const { input, frame } = couchAt();
        const at = Array.from({ length: hz / 10 }, () => frame([false, false, true])).findIndex((j) => j.includes(2));
        expect([at, [...input.joined]], `${hz} Hz: pad 2 joined ${wait} poll(s) on`).toEqual([wait, [2]]);
      }
      // pad 1 is pad 0's twin, its Cross `lag` polls after player 1's (or before: `lag` < 0); a quick
      // tap, down a poll, so player 1's pad no longer holds it when the twin's comes
      const lagged = (lag: number) => {
        const { input, frame } = couchAt();
        for (let k = 0; k < 12; k++) frame([k === Math.max(0, -lag), k === Math.max(0, lag), false]);
        return [...input.joined];
      };
      for (let lag = 1; lag <= late; lag++) expect(lagged(lag), `${hz} Hz: the twin's Cross ${Math.round(lag * dt * 1000)} ms late`).toEqual([]);
      for (let lag = 1; lag <= early; lag++) expect(lagged(-lag), `${hz} Hz: the twin's Cross ${Math.round(lag * dt * 1000)} ms early`).toEqual([]);
      // a press past the window is another player's: it joins
      expect(lagged(late + 1), `${hz} Hz: a Cross ${Math.round((late + 1) * dt * 1000)} ms after player 1's`).toEqual([1]);
    }
  });

  it('no pad joins on a poll whose frame never reaches the game (paused, loading): it joins on a press in a frame that runs', () => {
    const { input } = couch();
    input.joinWith = ['PadA'];
    let t = 0;
    /** A poll of the paused engine (`beginFrame(…, runs: false)`) or a running frame's. */
    const poll = (pads: GamepadLike[], runs: boolean) => {
      t += 1 / 60;
      input.beginFrame(t, 1 / 60, pads.map((p, i) => ({ ...p, index: i })), runs);
      const joined = [...input.joinedNow];
      input.endFrame();
      return joined;
    };
    poll([pad(), pad()], true);
    // Cross on pad 1 while paused: nobody joins (the press drives player 1's input, as any pad's that has not joined does)
    expect([poll([pad(), pad([0, 0, 0, 0], [0])], false), poll([pad(), pad([0, 0, 0, 0], [0])], false), [...input.joined]]).toEqual([[], [], []]);
    // held into the frames that run (player 1 back on the keyboard): nobody either, it was pressed in a pause
    input.noteDevice('keyboard');
    expect([poll([pad(), pad([0, 0, 0, 0], [0])], true), [...input.joined]]).toEqual([[], []]);
    poll([pad(), pad()], true);
    // pressed again in a frame that runs: it joins
    expect([poll([pad(), pad([0, 0, 0, 0], [0])], true), [...input.joined]]).toEqual([[1], [1]]);
    // player 1 on a pad: a join waiting when the game pauses is dropped (its pad is player 1's again, the press reading as up)
    input.joined.clear();
    poll([pad([0, 0, 0, 0], [3]), pad()], true);
    for (let n = 0; n < WINDOW; n++) poll([pad(), pad()], true);
    expect(input.device).toBe('pad');
    expect(poll([pad(), pad([0, 0, 0, 0], [0])], true)).toEqual([]);
    expect([poll([pad(), pad([0, 0, 0, 0], [0])], false), poll([pad(), pad([0, 0, 0, 0], [0])], false), poll([pad(), pad([0, 0, 0, 0], [0])], true), [...input.joined], input.isDown('PadA')]).toEqual([[], [], [], [], false]);
  });

  it('records each joined pad on its own, and only those: player 1’s pad is in the merged input already', () => {
    const { input, frame } = couch();
    const frames: InputFrame[] = [];
    const memory = { held: '', pointer: '' };
    const poll = (pads: (GamepadLike | null)[]) => {
      input.beginFrame(frames.length / 60 + 1 / 60, 1 / 60, pads.map((p, i) => (p ? { ...p, index: i } : null)));
      frames.push(input.snapshot(1 / 60, memory));
      input.endFrame();
    };
    // player 1 on pad 0, its stick and buttons moving; pad 1 there, not joined: nothing per pad
    poll([pad([0, 0, 0, 0], [3]), pad()]);
    poll([pad([0.8, 0, 0.5, 0], [0]), pad([0, 0, 0, 0], [1])]);
    poll([pad([0.2, 0.4, 0, 0]), pad()]);
    expect(frames.flatMap((f) => [f.pads, f.padPressed]).filter((x) => x !== undefined), 'nobody joined').toEqual([]);
    // pad 1 joins: its own frames and presses are recorded
    input.joined.add(1);
    poll([pad(), pad([0.9, 0, 0, 0], [2])]);
    const last = frames.at(-1)!;
    expect([last.pads?.map((p) => p[0]), last.padPressed]).toEqual([[1], [[1, 'PadX']]]);
    void frame;
  });

  it('is kept by a snapshot: each pad’s held buttons and queued presses, and the pads that joined', () => {
    const { input, frame } = couch();
    input.joined.add(2);
    frame([pad(), null, pad([0, 0, 0, 0], [0, 1])]);
    const s = JSON.parse(JSON.stringify(input.state())) as ReturnType<Input['state']>;
    expect([s.joined, s.pads?.map((p) => p[0])]).toEqual([[2], [0, 2]]);
    const b = new Input(null);
    b.setState(s, 5);
    expect([[...b.joined], b.player(2).isDown('PadA'), b.player(2).consumePress('PadB'), b.player(0).connected]).toEqual([[2], true, true, true]);
    // a snapshot without pads (an older one) has none
    const older = { ...s, pads: undefined, joined: undefined };
    b.setState(JSON.parse(JSON.stringify(older)) as typeof s, 6);
    expect([[...b.joined], b.player(2).connected]).toEqual([[], false]);
  });
});
