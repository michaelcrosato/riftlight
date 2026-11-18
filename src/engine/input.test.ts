import { describe, expect, it } from 'vitest';
import { applyDeadzone, type DualSenseInput, GAMEPAD_BUTTONS, GAMEPAD_DEADZONE, type GamepadLike, HOME_BUTTON, Input, SWIPE_KEYS, swipeDirection, TOUCHPAD_KEYS } from './input';

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
    expect(input.wasPressed(GAMEPAD_BUTTONS[9]!)).toBe(true);
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
    input.beginFrame(0, 1 / 60, [pad([0, 0, 0, 0], [9])]); // Options opens a menu
    expect(input.wasPressed('PadStart')).toBe(true);
    input.endFrame();
    input.release(); // what opening the menu does
    for (let i = 1; i < 4; i++) {
      input.beginFrame(i / 60, 1 / 60, [pad([0, 0, 0, 0], [9])]); // still held
      expect([input.wasPressed('PadStart'), input.isDown('PadStart')]).toEqual([false, false]);
      input.endFrame();
    }
    input.beginFrame(4 / 60, 1 / 60, [pad()]);
    input.endFrame();
    input.beginFrame(5 / 60, 1 / 60, [pad([0, 0, 0, 0], [9])]);
    expect([input.wasPressed('PadStart'), input.isDown('PadStart')]).toEqual([true, true]);
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

  it("the pad's click held is no tap", () => {
    const { input, frame } = touchpad();
    const click = Array.from({ length: 18 }, (_, i) => ({ pressed: i === 17 }));
    input.setGamepads([{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: click }]);
    frame(a(0.5));
    input.setGamepads([]);
    expect([...frame(a(0.5)), ...frame()]).toEqual([]);
  });
});
