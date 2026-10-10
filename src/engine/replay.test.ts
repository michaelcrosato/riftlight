import { describe, expect, it } from 'vitest';
import { type GamepadLike, Input, type InputFrame } from './input';
import { type Recording, recordingProblem } from './replay';

const target = () => new EventTarget() as unknown as Window;
const pad = (axes: number[], pressed: number[] = []): GamepadLike => ({ connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) });

/** What game code could read from an input this frame (and what it consumes). */
const read = (input: Input) => ({
  down: ['KeyW', 'KeyD', 'Space', 'KeyJ', 'ShiftLeft'].filter((c) => input.isDown(c)),
  pressed: ['KeyW', 'KeyD', 'Space', 'KeyJ', 'ShiftLeft'].filter((c) => input.wasPressed(c)),
  consumed: input.consumePress('Space'),
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
    expect(frames[6]!.held).toEqual(['KeyD', 'ShiftLeft', 'Space']); // gamepad buttons as keys
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
    again.playBefore({ dt: 1 / 60 }); // nothing changed: W still held, the pointer where it was
    again.beginFrame(3 / 60, 1 / 60, []);
    again.playAfter({ dt: 1 / 60 });
    expect([again.isDown('KeyF'), again.isDown('KeyW'), again.pointer.x, again.mouseButtons]).toEqual([false, true, 0, 0]);
    again.endFrame();
    again.playing = false;
    again.release(); // what the engine does after a replay
    expect(again.isDown('KeyW')).toBe(false);
    expect(again.consumePress('Space')).toBe(true); // a press still waiting stays queued
    key('keydown', 'KeyD');
    expect(again.isDown('KeyD')).toBe(true); // live again
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
  });
});
