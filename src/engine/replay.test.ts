import { describe, expect, it } from 'vitest';
import { type GamepadLike, Input, type InputFrame } from './input';
import { type Recording, recordingProblem } from './replay';

const target = () => new EventTarget() as unknown as Window;
const pad = (axes: number[], pressed: number[] = []): GamepadLike => ({ connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) });

/** What game code could read from an input this frame (and what it consumes). */
const KEYS = ['KeyW', 'KeyD', 'Space', 'KeyJ', 'ShiftLeft', 'MouseLeft', 'MouseRight'];
const read = (input: Input) => ({
  down: KEYS.filter((c) => input.isDown(c)),
  pressed: KEYS.filter((c) => input.wasPressed(c)),
  consumed: input.consumePress('Space'),
  clicked: input.consumePress('MouseRight'),
  commands: [...input.commands],
  buttonEvents: input.buttonEvents.map((e) => ({ ...e })),
  axis: input.moveAxis(),
  delta: { ...input.mouseDelta },
  wheel: input.wheel,
  pointer: { ...input.pointer },
  buttons: input.mouseButtons,
  gamepad: input.gamepadConnected,
});

describe('recording and replaying input', () => {
  it('a replayed input reads exactly like the live one, frame for frame', () => {
    const live = new Input(target());
    // a script of things a player does between frames: keys, a tap, a gamepad, the pointer, the wheel
    const between: ((i: Input) => void)[] = [
      (i) => i.setKey('KeyW', true),
      () => {},
      (i) => (i.setKey('Space', true), i.setKey('Space', false)), // a tap: pressed, never held at a frame
      (i) => i.setKey('KeyD', true),
      (i) => (i.addPointer(12, -3, 1), i.setPointer(0.25, -0.5, true)),
      (i) => i.setKey('KeyW', false),
      () => {},
      (i) => (i.setKey('KeyD', false), (i.analog.x = 0.6)),
      (i) => (i.analog.x = 0),
      (i) => (i.setButtons(3), i.send({ save: { gold: 3, at: undefined } })), // a chord (right while left is held), data from the page
      (i) => (i.setButtons(0), i.send('a'), i.send('b')),
      (i) => (i.setButtons(2), i.setButtons(0)), // a right click shorter than a frame: pressed, never held
      (i) => (i.pointer.touch = true), // a finger now
    ];
    const pads: (GamepadLike | null)[][] = between.map((_, f) => (f === 6 ? [pad([0.9, 0, 0.5, 0], [0, 6])] : f === 7 ? [pad([0, -1, 0, 0], [6])] : []));
    const frames: InputFrame[] = [];
    const seen: ReturnType<typeof read>[] = [];
    const last = { held: '', pointer: '' };
    let now = 0;
    between.forEach((act, f) => {
      act(live);
      now += 1 / 60;
      live.beginFrame(now, 1 / 60, pads[f]);
      live.deliver();
      frames.push(live.snapshot(1 / 60, last));
      seen.push(read(live));
      live.endFrame();
    });

    const again = new Input(target());
    now = 0;
    const replayed = frames.map((f) => {
      again.playBefore(f);
      now += f.dt;
      again.beginFrame(now, f.dt, []);
      again.playAfter(f);
      const r = read(again);
      again.endFrame();
      return r;
    });
    expect(replayed).toEqual(seen);
    // what was recorded: changes only (held and the pointer when they change), nothing when idle
    expect(frames[1]).toEqual({ dt: 1 / 60 });
    expect(frames[2]!.pressed).toEqual(['Space']);
    expect(frames[6]!.held).toEqual(['KeyD', 'MouseLeft', 'ShiftLeft', 'Space']); // gamepad buttons as keys, the pointer held since frame 4
    expect(frames[9]!.held).toEqual(['MouseLeft', 'MouseRight']);
    expect(frames[9]!.commands).toEqual([{ save: { gold: 3 } }]); // as JSON: what a replay will read
    expect(seen[10]!.commands).toEqual(['a', 'b']);
    expect([frames[11]!.pressed, frames[11]!.held, seen[11]!.clicked]).toEqual([['MouseRight'], undefined, true]);
    expect(frames[11]!.clicks).toEqual([['MouseRight', 1, 0.25, -0.5], ['MouseRight', 0, 0.25, -0.5]]); // pressed and let go, where the pointer was
    expect(seen[12]!.commands).toEqual([]); // delivered once
    expect([frames[12]!.touch, seen[12]!.pointer.touch]).toEqual([true, true]);
    // what the game does to a command it got changes neither the recording nor a replay of it
    (seen[9]!.commands[0] as { save: { gold: number } }).save.gold = 13;
    const twice = new Input(target());
    twice.playAfter(frames[9]!);
    (twice.commands[0] as { save: { gold: number } }).save.gold = 23;
    expect(frames[9]!.commands).toEqual([{ save: { gold: 3 } }]);
    expect(JSON.parse(JSON.stringify(frames))).toEqual(frames); // plain data
  });

  it('a gamepad press left waiting expires on the same frame live and replayed', () => {
    // pressed on frame 1, asked for on frame `ask`: near the end of the press window the answer
    // depends on exactly when the press was queued, so both must queue it at the same time
    const run = (ask: number) => {
      const live = new Input(target());
      const frames: InputFrame[] = [];
      const last = { held: '', pointer: '' };
      let now = 0;
      let liveAnswer = false;
      for (let f = 0; f <= ask; f++) {
        now += 1 / 60;
        live.beginFrame(now, 1 / 60, f === 1 ? [pad([0, 0, 0, 0], [0])] : []);
        frames.push(live.snapshot(1 / 60, last));
        if (f === ask) liveAnswer = live.consumePress('Space');
        live.endFrame();
      }
      const again = new Input(target());
      now = 0;
      let replayed = false;
      frames.forEach((fr, f) => {
        again.playBefore(fr);
        now += fr.dt;
        again.beginFrame(now, fr.dt, []);
        again.playAfter(fr);
        if (f === ask) replayed = again.consumePress('Space');
        again.endFrame();
      });
      return [liveAnswer, replayed];
    };
    for (let ask = 2; ask <= 14; ask++) {
      const [live, replayed] = run(ask);
      expect(replayed, `asked on frame ${ask}`).toBe(live);
    }
    expect(run(3)[0]).toBe(true); // still waiting early on
    expect(run(14)[0]).toBe(false); // gone after the press window
  });

  it('a different recording reads differently (so a replay that matches means something)', () => {
    const play = (frames: InputFrame[]) => {
      const i = new Input(target());
      let now = 0;
      return frames.map((f) => {
        i.playBefore(f);
        now += f.dt;
        i.beginFrame(now, f.dt, []);
        i.playAfter(f);
        const r = read(i);
        i.endFrame();
        return r;
      });
    };
    const a = play([{ dt: 1 / 60, held: ['KeyW'], pressed: ['KeyW'] }, { dt: 1 / 60 }]);
    const b = play([{ dt: 1 / 60, held: ['KeyW'], pressed: ['KeyW'] }, { dt: 1 / 60, held: [] }]);
    expect(a).not.toEqual(b);
  });

  it('a replay hears no live input, sets every key the recording holds, and lets go after', () => {
    const win = new EventTarget();
    const key = (type: string, code: string) => win.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
    const live = new Input(win as unknown as Window);
    // the memory the engine starts each level with: the first frame records everything
    const last = { held: '-', pointer: '-' };
    live.beginFrame(1 / 60, 1 / 60, []);
    const first = live.snapshot(1 / 60, last);
    expect(first.held).toEqual([]); // nothing held is said, so nothing held before the replay stays held
    expect(first.gamepad).toBe(false);

    const again = new Input(win as unknown as Window);
    key('keydown', 'KeyA'); // held before the replay starts
    again.send('before');
    again.playing = true;
    again.playBefore(first);
    again.beginFrame(1 / 60, 1 / 60, []);
    again.playAfter(first);
    expect(again.isDown('KeyA')).toBe(false);
    key('keydown', 'KeyD'); // live keys during a replay are ignored
    again.playBefore({ dt: 1 / 60, held: ['KeyW'], pressed: ['Space'] });
    again.beginFrame(2 / 60, 1 / 60, []);
    again.playAfter({ dt: 1 / 60 });
    expect([again.isDown('KeyD'), again.isDown('KeyW'), again.wasPressed('KeyD')]).toEqual([false, true, false]);
    again.endFrame();
    again.setKey('KeyF', true); // and so are touch buttons and scripts
    again.setPointer(0.5, 0.5, true);
    again.setButtons(2);
    again.send('live'); // and what the page sends: the recording's commands are the ones that count
    again.playBefore({ dt: 1 / 60 }); // nothing changed: W still held, the pointer where it was
    again.beginFrame(3 / 60, 1 / 60, []);
    again.playAfter({ dt: 1 / 60 });
    expect([again.isDown('KeyF'), again.isDown('KeyW'), again.pointer.x, again.mouseButtons, again.isDown('MouseRight'), again.commands]).toEqual([false, true, 0, 0, false, []]);
    again.endFrame();
    again.playing = false;
    again.deliver();
    expect(again.commands).toEqual([]); // nothing sent before the replay (`before`, below) or during it is delivered after
    again.release(); // what the engine does after a replay
    expect(again.isDown('KeyW')).toBe(false);
    expect(again.consumePress('Space')).toBe(true); // a press still waiting stays queued
    key('keydown', 'KeyD');
    expect(again.isDown('KeyD')).toBe(true); // live again
  });

  it('the canvas mouse buttons and fingers are keys: a chord, a blur, a short click, a touch', () => {
    // a canvas stand-in: an element with a rect, and a page with no pointer lock
    const doc = globalThis as { document?: unknown };
    const hadDocument = 'document' in doc;
    if (!hadDocument) doc.document = Object.assign(new EventTarget(), { pointerLockElement: null });
    try {
      const win = new EventTarget();
      const el = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }), setPointerCapture: () => {} });
      const input = new Input(win as unknown as Window);
      input.attachPointer(el as unknown as HTMLElement);
      const ev = (type: string, o: { button?: number; buttons?: number; type?: string; id?: number; x?: number }) =>
        Object.assign(new Event(type), { pointerId: o.id ?? 1, pointerType: o.type ?? 'mouse', button: o.button ?? -1, buttons: o.buttons ?? 0, clientX: o.x ?? 50, clientY: 50, movementX: 0, movementY: 0 });
      let now = 0;
      const frame = (act: () => void) => {
        act();
        input.beginFrame((now += 1 / 60), 1 / 60, []);
        const r = { held: ['MouseLeft', 'MouseRight', 'Touch'].filter((c) => input.isDown(c)), pressed: ['MouseLeft', 'MouseRight', 'Touch'].filter((c) => input.wasPressed(c)), buttons: input.mouseButtons, touch: input.pointer.touch };
        input.endFrame();
        return r;
      };
      expect(frame(() => el.dispatchEvent(ev('pointerdown', { button: 0, buttons: 1 })))).toEqual({ held: ['MouseLeft'], pressed: ['MouseLeft'], buttons: 1, touch: false });
      // right pressed while left is held: browsers send a move naming the button (a chord)
      expect(frame(() => el.dispatchEvent(ev('pointermove', { button: 2, buttons: 3 })))).toEqual({ held: ['MouseLeft', 'MouseRight'], pressed: ['MouseRight'], buttons: 3, touch: false });
      // left let go, right still held
      expect(frame(() => el.dispatchEvent(ev('pointermove', { button: 0, buttons: 2 })))).toEqual({ held: ['MouseRight'], pressed: [], buttons: 2, touch: false });
      // the window loses focus with the button held: let go (an event a UI mid-drag hears), and a plain move after is no new click
      expect(frame(() => (win.dispatchEvent(new Event('blur')), expect(input.buttonEvents.map((e) => [e.code, e.down])).toEqual([['MouseRight', false]]), el.dispatchEvent(ev('pointermove', { buttons: 2 }))))).toEqual({ held: [], pressed: [], buttons: 0, touch: false });
      expect(frame(() => el.dispatchEvent(ev('pointerup', { button: 2, buttons: 0 })))).toEqual({ held: [], pressed: [], buttons: 0, touch: false });
      // a click shorter than a frame
      expect(frame(() => (el.dispatchEvent(ev('pointerdown', { button: 0, buttons: 1 })), el.dispatchEvent(ev('pointerup', { button: 0 }))))).toEqual({ held: [], pressed: ['MouseLeft'], buttons: 0, touch: false });
      // a drag shorter than a frame: pressed at x 50, let go at x 150 (ndc -0.5 and 0.5), in that order
      el.dispatchEvent(ev('pointerdown', { button: 0, buttons: 1, x: 50 }));
      el.dispatchEvent(ev('pointermove', { buttons: 1, x: 100 }));
      el.dispatchEvent(ev('pointerup', { button: 0, x: 150 }));
      expect(input.buttonEvents.map((e) => [e.code, e.down, e.x])).toEqual([
        ['MouseLeft', true, -0.5],
        ['MouseLeft', false, 0.5],
      ]);
      frame(() => {});
      // a finger is Touch, not a click; two fingers lift one by one
      expect(frame(() => (el.dispatchEvent(ev('pointerdown', { type: 'touch', id: 5, button: 0, buttons: 1 })), el.dispatchEvent(ev('pointerdown', { type: 'touch', id: 6, button: 0, buttons: 1 }))))).toEqual({ held: ['Touch'], pressed: ['Touch'], buttons: 1, touch: true });
      expect(frame(() => el.dispatchEvent(ev('pointerup', { type: 'touch', id: 5, button: 0 })))).toEqual({ held: ['Touch'], pressed: [], buttons: 1, touch: true });
      expect(frame(() => el.dispatchEvent(ev('pointerup', { type: 'touch', id: 6, button: 0 })))).toEqual({ held: [], pressed: [], buttons: 0, touch: true });
      input.dispose();
    } finally {
      if (!hadDocument) delete doc.document;
    }
  });

  it('commands last one frame, and a send that is not JSON says so', () => {
    const i = new Input(target());
    i.send({ a: 1 });
    i.deliver();
    expect(i.commands).toEqual([{ a: 1 }]);
    i.endFrame();
    expect(i.commands).toEqual([]); // a frame that does not run (paused) sees none
    expect(() => i.send(() => 1)).toThrow(/JSON/);
  });

  it('refuses what is not a recording, and says why', () => {
    const ok: Recording = { format: 1, engine: 'test', game: 'g', seed: 1, time: 0, frames: [{ dt: 1 / 60 }, { dt: 1 / 60, held: ['KeyW'], delta: [1, 2], pointer: [0, 0, 1, 0] }] };
    expect(recordingProblem(ok)).toBeNull();
    expect(recordingProblem(null)).toMatch(/not an object/);
    expect(recordingProblem({ ...ok, format: 2 })).toMatch(/format 2/);
    expect(recordingProblem({ ...ok, seed: -1 })).toMatch(/seed/);
    expect(recordingProblem({ ...ok, frames: [{ dt: 5 }] })).toMatch(/frame 0: dt/);
    expect(recordingProblem({ ...ok, frames: [{ dt: 0.01, held: [3] }] })).toMatch(/frame 0: held/);
    expect(recordingProblem({ ...ok, frames: [{ dt: 0.01 }, { dt: 0.01, delta: [1] }] })).toMatch(/frame 1: delta/);
    expect(recordingProblem({ ...ok, frames: [{ dt: 0.01, pointer: [0, 0, 1] }] })).toMatch(/pointer/);
    expect(recordingProblem({ ...ok, frames: [{ dt: 0.01, gamepad: 1 }] })).toMatch(/gamepad/);
    expect(recordingProblem({ ...ok, frames: [{ dt: 0.01, sync: false }] })).toMatch(/sync/);
    expect(recordingProblem({ ...ok, view: { width: 960, height: 540, dpr: 1 } })).toBeNull();
    expect(recordingProblem({ ...ok, view: { width: 0, height: 0, dpr: 2 } }), 'a hidden page records 0×0').toBeNull();
    expect(recordingProblem({ ...ok, view: { width: 960, height: 540, dpr: 0 } })).toMatch(/view/);
    expect(recordingProblem({ ...ok, view: { width: 960 } as never })).toMatch(/view/);
  });
});
