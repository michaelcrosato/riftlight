// Engine World's replay and save-state checks headless (moved from the e2e suite `world`): a
// room's recording replays exactly (and an edited one doesn't); replayed to a frame and played on,
// a level replays from its own recording; save-states of a small probe game (a box pushed by keys,
// kicked from a tween's promise, lifted by data the page sends) play on, replay, refuse a running
// tween and roll back a failed restore; a click near the end of the room card, made live at 120 Hz,
// replays as it went (the card counts down on the recorded frames' time). Live play at the browser's
// own pace (requestAnimationFrame) and its replay in a fresh page stay in the e2e suite. One engine
// for the file.
import { Object3D, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Engine, Game, GameContext, Recording } from '../engine';
import { pointAtArt } from '../riftlight/headless';
import type { worldApi } from './index';
import { shell, shownTime } from './shell';
import { headlessWorld, roomApi, WORLD_T } from './testWorld';

let engine: Engine;
let w: typeof worldApi;

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
}, WORLD_T);
afterAll(() => engine?.dispose());

type Body = ReturnType<GameContext['physics']['addDynamicBox']>;

/**
 * The e2e suite's probe: a box on a floor, pushed by keys, hopping from a tween's promise a tenth
 * of a second after Space, lifted by data sent in (`input.send({ lift })`), with save-states (its
 * counters and its box's handle; the engine keeps the box itself, in the physics world).
 */
class Probe implements Game {
  readonly name = 'replay-probe';
  readonly target = new Vector3(0, 0.5, 0);
  kicks = 0;
  lifts = 0;
  box!: Body;
  setup(ctx: GameContext): void {
    ctx.physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [8, 0.5, 8] });
    this.box = ctx.physics.addDynamicBox({ position: [0, 0.5, 0], halfExtents: [0.3, 0.3, 0.3] });
  }
  fixedUpdate(ctx: GameContext): void {
    const i = ctx.input;
    if (i.consumePress('Space'))
      void ctx.tweens.call(0.1, () => {}).done.then(() => {
        this.box.applyImpulse({ x: 0, y: 2, z: 0 }, true);
        this.kicks++;
      });
    if (i.consumePress('KeyJ')) this.box.applyImpulse({ x: ctx.random.range(-1, 1), y: 1, z: ctx.random.range(-1, 1) }, true);
    if (i.isDown('KeyD')) this.box.applyImpulse({ x: 0.04, y: 0, z: 0 }, true);
    if (i.isDown('KeyA')) this.box.applyImpulse({ x: -0.04, y: 0, z: 0 }, true);
  }
  update(ctx: GameContext): void {
    for (const c of ctx.input.commands as { lift?: unknown }[]) {
      if (!c || typeof c.lift !== 'number') continue;
      this.box.applyImpulse({ x: 0, y: c.lift, z: 0 }, true);
      this.lifts++;
    }
  }
  cameraTarget(): Vector3 {
    return this.target;
  }
  status(): string {
    return `kicks ${this.kicks} lifts ${this.lifts}`;
  }
  fingerprint(): string {
    return `${this.kicks} ${this.lifts}`;
  }
  snapshot(): unknown {
    return { kicks: this.kicks, lifts: this.lifts, box: this.box.handle };
  }
  restore(ctx: GameContext, state: unknown): void {
    const s = state as { kicks: number; lifts: number; box: number };
    this.kicks = s.kicks;
    this.lifts = s.lifts;
    this.box = ctx.physics.world.getRigidBody(s.box)!;
  }
}

it(
  "a room's recording holds the run and replays to where it ended; with A held longer it ends elsewhere; replayed to frame 150 and played on, the level replays from its own recording",
  async () => {
    const start = () => w.goto('bodies', { instant: true }); // from the bodies room, as below
    await start();
    await start();
    const from = [...w.state().hero!.at];
    const script: Record<number, [string, boolean]> = { 0: ['KeyW', true], 30: ['KeyD', true], 50: ['Space', true], 53: ['Space', false], 90: ['KeyD', false], 120: ['Space', true], 121: ['Space', false], 200: ['KeyW', false] };
    for (let f = 0; f < 240; f++) {
      const key = script[f];
      if (key) engine.input.setKey(key[0], key[1]);
      engine.step(1);
    }
    const hero = () => {
      const h = w.state().hero!;
      return `${h.at} ${h.state} (${h.anim})`;
    };
    const live = { print: engine.fingerprint(), hero: hero(), at: w.state().hero!.at };
    const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    expect(rec.frames.length).toBe(240);
    expect(Math.hypot(live.at[0]! - from[0]!, live.at[2]! - from[2]!)).toBeGreaterThan(3);
    await engine.replay(rec, start);
    expect({ print: engine.fingerprint(), hero: hero() }).toEqual({ print: live.print, hero: live.hero });
    // frames hold only changes: A held from frame 150 stays held until W is let go at 200
    const altered = { ...rec, frames: rec.frames.map((f, i) => (i === 150 ? { ...f, held: ['KeyA', 'KeyW'] } : f)) };
    await engine.replay(altered, start);
    expect(engine.fingerprint()).not.toBe(live.print);
    // a saved moment: replayed to frame 150 and played on differently, the level's recording is
    // the cut one plus what came after, and it replays to the same end
    await engine.replay(rec, start, { frames: 150 });
    expect(engine.recording()!.frames.length).toBe(150);
    engine.input.setKey('KeyA', true);
    engine.step(40);
    engine.input.setKey('KeyA', false);
    engine.step(20);
    const branch = engine.fingerprint();
    const both = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    expect(both.frames.length).toBe(210);
    expect(branch).not.toBe(live.print);
    await engine.replay(both, start);
    expect(engine.fingerprint()).toBe(branch);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it(
  'a click near the end of the room card, made live at 120 Hz, replays as it went: the card counts down on the recorded frames\' time, so the click is the card\'s in the replay too (the Workshop places nothing behind it)',
  async () => {
    const start = () => w.goto('workshop', { instant: true });
    await start();
    await start(); // entered from itself, as the replay's start enters it: the same card
    const placed = () => (roomApi(w).spawned() as unknown[]).length;
    expect(w.state().card, 'the card is up').toBe(true);
    expect(placed()).toBe(0);
    // live play on a 120 Hz display: the render loop's frames (`tick`), the wall clock in step
    const live = engine as unknown as { tick(ms: number): void; manual: boolean };
    const hz = 120;
    let ms = 1_000_000;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => ms);
    const fps = engine.maxFps;
    let frames = 0;
    const frame = () => {
      ms += 1000 / hz;
      live.tick(ms);
      frames++;
    };
    try {
      engine.maxFps = 0; // the display's own rate
      live.manual = false;
      // the card is up for 8 s: at 120 Hz, 960 frames; the click comes at 7.5 s, on the card over the floor
      while (frames < 900) frame();
      expect(w.state().card, 'still up at 7.5 s').toBe(true);
      pointAtArt(engine, 60, 60);
      frame();
      engine.input.setButtons(1);
      frame();
      engine.input.setButtons(0);
      for (let i = 0; i < 30; i++) frame();
    } finally {
      live.manual = true;
      engine.maxFps = fps;
      now.mockRestore();
    }
    const end = { print: engine.fingerprint(), placed: placed(), card: w.state().card };
    expect(end.card, 'the click sent the card away').toBe(false);
    expect(end.placed, 'and placed nothing behind it').toBe(0);
    const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    expect(rec.frames.length).toBe(frames);
    // the replay steps the recorded frames in manual time, whatever the wall clock does
    await engine.replay(rec, start);
    expect({ print: engine.fingerprint(), placed: placed(), card: w.state().card }).toEqual(end);
    roomApi(w).clear();
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it(
  'a room that starts (a replay\'s start too) starts from nothing held: no click the card took, no press a panel took',
  async () => {
    await w.goto('workshop', { instant: true });
    engine.step(2);
    const presses = () => (shell as unknown as { presses: { size: number } }).presses.size;
    try {
      // Circle held as it closes the guide: the panel's while held
      w.open('guide');
      engine.step(1);
      engine.input.setKey('PadB', true);
      engine.step(2);
      expect(w.state().panel, 'Circle closed the guide').toBeNull();
      expect(presses(), 'its Circle, held').toBe(1);
      // a click on the card, held: the card's while held
      shell.showCard(10);
      engine.step(2);
      pointAtArt(engine, 60, 60, true);
      engine.step(1);
      expect(shell.cardShown, 'the click sent the card away').toBe(false);
      expect(shell.roomPointerFree, 'and is the card\'s while held').toBe(false);
      // the room starts again (as a replay starts it): its level holds nothing of the last one's
      await w.goto('workshop', { instant: true });
      expect(shell.roomPointerFree, 'no click the card took').toBe(true);
      expect(presses(), 'no press a panel took').toBe(0);
    } finally {
      engine.input.setKey('PadB', false);
      pointAtArt(engine, 60, 60, false);
      engine.step(2);
      roomApi(w).clear();
    }
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it(
  'the card and a toast count the frame\'s game seconds unscaled: slow motion doesn\'t hold them up, a room a menu froze holds them',
  async () => {
    expect(shownTime(1 / 120, 1)).toBeCloseTo(1 / 120, 12);
    expect(shownTime(0.25 / 60, 0.25)).toBeCloseTo(1 / 60, 12);
    expect(shownTime(0, 0)).toBe(0);
    await w.goto('workshop', { instant: true });
    engine.step(2);
    const speed = engine.timeScale;
    try {
      engine.timeScale = 0.25; // slow motion: a second of frames is a second of the toast
      shell.toast('Slow', 1);
      engine.step(55);
      expect(w.state().toast, 'up for its second').toBe('Slow');
      engine.step(10);
      expect(w.state().toast, 'gone after it').toBeNull();
      engine.timeScale = speed;
      shell.toast('Held', 1);
      w.open('pause'); // freezes the room
      engine.step(120);
      expect(w.state().toast, 'held while the menu froze the room').toBe('Held');
      w.close();
      engine.step(65);
      expect(w.state().toast).toBeNull();
    } finally {
      w.close();
      engine.timeScale = speed;
    }
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it(
  'save-states: refused while a tween runs; played on from, they match the run that went on; the recording after a restore replays from it; other physics, a tween or a body bound after it change nothing they should not; a failed restore rolls back',
  async () => {
    const start = () => engine.loadGame(new Probe());
    await start();
    const probe = () => engine.game as Probe;
    const status = () => probe().status();
    const play = (from: number, to: number) => {
      for (let f = from; f < to; f++) {
        engine.input.setKey('KeyD', f % 90 < 45);
        engine.input.setKey('KeyJ', f % 70 === 10);
        if (f % 100 === 30) engine.input.send({ lift: 2 });
        engine.step(1);
      }
    };
    play(0, 100);
    engine.input.setKey('Space', true); // a tween now runs for 0.1 s
    engine.step(1);
    engine.input.setKey('Space', false);
    await expect(engine.snapshot()).rejects.toThrow(/tween/);
    engine.step(11); // the tween is over; its promise's callback (a kick) runs before the snapshot is taken
    const snap = JSON.parse(JSON.stringify(await engine.snapshot()));
    play(112, 260);
    const live = { print: engine.fingerprint(), status: status() };
    expect(live.status.startsWith('kicks 1')).toBe(true);
    const later = JSON.parse(JSON.stringify(await engine.snapshot()));
    await engine.restore(snap);
    play(112, 260);
    expect({ print: engine.fingerprint(), status: status() }).toEqual(live);
    const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    expect(rec.from).toBeTruthy();
    expect(rec.frames.length).toBe(148);
    await engine.replay(rec, start);
    expect(engine.fingerprint()).toBe(live.print);
    // the snapshot's own state with a later moment's physics: not the same moment, not the same end
    await engine.restore({ ...snap, physics: later.physics });
    play(112, 260);
    expect(engine.fingerprint()).not.toBe(live.print);
    // a tween running when a restore comes: its promise's callback (a kick) never lands in the restored moment
    await engine.restore(snap);
    engine.input.setKey('Space', true);
    engine.step(1);
    engine.input.setKey('Space', false);
    await engine.restore(snap);
    expect(status().startsWith('kicks 1')).toBe(true);
    play(112, 260);
    expect(engine.fingerprint()).toBe(live.print);
    // a body bound after the snapshot: let go by the restore, and the level steps on the same
    await engine.restore(snap);
    engine.physics.bind(engine.physics.addDynamicBox({ position: [0, 3, 0], halfExtents: [0.2, 0.2, 0.2] }), new Object3D());
    await engine.restore(snap);
    play(112, 260);
    expect(engine.fingerprint()).toBe(live.print);
    // a restore that fails (the game's state is broken) leaves the engine as it was
    const before = { print: engine.fingerprint(), time: engine.time };
    await expect(engine.restore({ ...snap, state: null })).rejects.toThrow();
    expect({ print: engine.fingerprint(), time: engine.time }).toEqual(before);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);
