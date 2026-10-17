// Engine World's workshop wing headless (moved from the e2e suite `world`): the sandbox's mouse
// picks and drags a crate, a layout clears and loads back the same, a broken one is refused, a
// random drop lands on the same spot each visit; the time lab's dominoes fall and stand back up
// while R is held, its ball rewinds to sleep on its ramp, and R is the lab's while there (the
// resolution hotkey moves to F7). Saving to the browser's storage, the canvas's pointer events and
// "no hotkeys without ?debug=1" stay in the e2e suite. One engine for the file.
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import type { worldApi } from '../index';
import { headlessWorld, roomApi, WORLD_T } from '../testWorld';

let engine: Engine;
let w: typeof worldApi;
const room = () => roomApi(w);

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
}, WORLD_T);
afterAll(() => engine?.dispose());

type Prop = { kind: string; at: number[]; rot: number[] };

it(
  'sandbox: the mouse picks the tower\'s top crate and drags it away; a layout clears and loads back the same; a broken one is refused',
  async () => {
    await w.goto('sandbox', { instant: true });
    engine.step(60);
    const top = new Vector3(4, 3.6, -4).project(engine.camera.camera);
    expect(room().pick(top.x, top.y)).toBe('crate');
    engine.input.setPointer(top.x, top.y, true);
    engine.step(2);
    expect(room().holding()).toBe('crate');
    for (let i = 0; i < 40; i++) {
      engine.input.setPointer(top.x - i * 0.02, top.y, true);
      engine.step(1);
    }
    engine.input.setPointer(top.x - 0.8, top.y, false);
    engine.step(60);
    const crates = (room().layout() as Prop[]).filter((p) => p.kind === 'crate');
    expect(Math.max(...crates.map((c) => Math.hypot(c.at[0]! - 4, c.at[2]! + 4)))).toBeGreaterThan(1);
    // no browser storage headless: SAVE says so instead of throwing
    expect(room().save()).toBe(false);
    const layout = room().layout() as Prop[];
    const before = JSON.stringify(layout);
    room().clear();
    expect(room().count()).toBe(0);
    expect(room().load(JSON.parse(before))).toBe(layout.length);
    expect(JSON.stringify(room().layout())).toBe(before);
    // a layout that is not one changes nothing
    const bad = [room().load({}), room().load([null]), room().load([{ kind: 'constructor', at: [0, 1, 0], rot: [0, 0, 0, 1] }]), room().load([{ kind: 'crate', at: [0, NaN, 0], rot: [0, 0, 0, 1] }])];
    expect(bad).toEqual([-1, -1, -1, -1]);
    expect(room().count()).toBe(layout.length);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it(
  'time lab: dominoes fall and stand back up while R is held; the ball rewinds to sleep on its ramp; R is the lab\'s (resolution on F7) and the resolution key again outside',
  async () => {
    // engine hotkeys on, as ?debug=1 has them
    engine.debugKeys = { mode: ['KeyP'], resolution: ['KeyR'], debug: ['Backquote'], nextLook: ['BracketRight'], prevLook: ['BracketLeft'], mute: ['KeyM'] };
    await w.goto('rewind', { instant: true });
    engine.step(10);
    expect(engine.debugKeys.resolution).toEqual(['F7']);
    type Ball = { at: number[]; asleep: boolean };
    const parked = room().ball() as Ball;
    expect(room().standing()).toBe(22);
    w.pad('DOMINOES');
    engine.step(240);
    expect(room().standing()).toBeLessThan(4);
    engine.input.setKey('KeyR', true);
    engine.step(300);
    engine.input.setKey('KeyR', false);
    expect(room().standing()).toBe(22);
    expect(room().rewound()).toBeGreaterThan(200);
    engine.step(30);
    expect(room().standing()).toBe(22);
    // the ball rolls off its ramp; rewound to before that, it sleeps there again
    room().roll();
    engine.step(90);
    const rolled = room().ball() as Ball;
    engine.input.setKey('KeyR', true);
    engine.step(150);
    engine.input.setKey('KeyR', false);
    engine.step(60);
    const after = room().ball() as Ball;
    const off = (a: Ball, b: Ball) => Math.hypot(a.at[0]! - b.at[0]!, a.at[1]! - b.at[1]!, a.at[2]! - b.at[2]!);
    expect(parked.asleep).toBe(true);
    expect(off(rolled, parked)).toBeGreaterThan(1);
    expect(after.asleep).toBe(true);
    expect(off(after, parked)).toBeLessThan(0.05);
    await w.goto('sandbox', { instant: true });
    expect(engine.debugKeys.resolution).toEqual(['KeyR']);
    engine.debugKeys = { mode: [], resolution: [], debug: [], nextLook: [], prevLook: [], mute: [] };
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it(
  'seeded randomness: a prop dropped at a random spot lands on the same spot every visit',
  async () => {
    const spots: number[][] = [];
    for (let k = 0; k < 2; k++) {
      await w.goto('sandbox', { instant: true });
      room().spawn('crate');
      spots.push((room().layout() as Prop[]).at(-1)!.at);
    }
    // a drop spot: 4 m up, within 0.75 m of the drop point (0, -2); not the tower the room starts with
    for (const at of spots) {
      expect(at[1]).toBe(4);
      expect(Math.abs(at[0]!)).toBeLessThanOrEqual(0.75);
      expect(Math.abs(at[2]! + 2)).toBeLessThanOrEqual(0.75);
      expect(at[0]).not.toBe(0);
    }
    expect(spots[1]).toEqual(spots[0]);
  },
  WORLD_T,
);
