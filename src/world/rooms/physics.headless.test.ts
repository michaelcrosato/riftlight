// Engine World's physics wing headless (moved from the e2e suite `world`): a blast topples the
// tower and instanced bodies fall asleep, the bridge sags and hangs when cut, sheets drape, the lift
// carries the hero, a wall shatters into pieces that dissolve, the well gathers bodies, a launch pad
// throws the hero. One engine for the file (the World shell is one per process), rooms in turn.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import type { worldApi } from '../index';
import { type AtriumBase, atriumBase, expectNoLeak, headlessWorld, release, roomApi, stick, teleport, WORLD_T } from '../testWorld';

let engine: Engine;
let w: typeof worldApi;
let base: AtriumBase;
const room = () => roomApi(w);

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
  base = atriumBase(engine);
}, WORLD_T);
afterAll(() => engine?.dispose());

it(
  'rigid bodies: a blast knocks the tower down; 100 instanced bodies rain in and fall asleep',
  async () => {
    await w.goto('bodies', { instant: true });
    engine.step(30);
    const before = room().standing() as number;
    room().blast();
    engine.step(90);
    room().fill(100);
    // a pile sleeps as one island once every body in it has been still for 2 s: wait for it, up to 15 s
    for (let i = 0; i < 900 && (i < 400 || room().stress().asleep < 30); i++) engine.step(1);
    expect(room().standing()).toBeLessThan(before - 4);
    const stress = room().stress() as { bodies: number; asleep: number };
    expect(stress.bodies).toBe(100);
    expect(stress.asleep).toBeGreaterThanOrEqual(30);
  },
  WORLD_T,
);

it(
  'joints: the bridge sags, the wrecking ball knocks crates over, a cut bridge hangs',
  async () => {
    await w.goto('joints', { instant: true });
    engine.step(30);
    const sag = Math.min(...(room().bridge() as number[]));
    room().swing();
    engine.step(90);
    room().cut();
    engine.step(150);
    expect(sag).toBeLessThan(-0.15);
    expect(room().standing()).toBeLessThan(9);
    expect(Math.min(...(room().bridge() as number[]))).toBeLessThan(-3);
  },
  WORLD_T,
);

it(
  'soft bodies: sheets drape over the table and the ball, released flags fall',
  async () => {
    await w.goto('soft', { instant: true });
    room().drop();
    room().release();
    engine.step(200);
    const sheets = (room().sheets() as number[][]).map((c) => c[1]!);
    const flags = (room().flags() as number[][]).map((f) => f[1]!);
    for (const y of sheets) expect(y > 0.3 && y < 1.6, `sheet at ${y}`).toBe(true);
    for (const y of flags) expect(y).toBeLessThan(0.5);
  },
  WORLD_T,
);

it(
  'platforms: the hero rides the lift up',
  async () => {
    await w.goto('platforms', { instant: true });
    room().restartLift(); // at the bottom, waiting 1.5 s: the same ride whatever ran before
    engine.step(2);
    const lift = room().lift() as number;
    teleport(engine, [10, lift + 0.3, -8.5], 0);
    engine.step(10);
    expect(room().standingOn()).toBe('lift');
    let top = 0;
    for (let i = 0; i < 360; i++) {
      engine.step(1);
      top = Math.max(top, w.state().hero!.at[1]!);
    }
    expect(top).toBeGreaterThan(4.5);
  },
  WORLD_T,
);

it(
  'destruction: a wall breaks into 12 pieces that dissolve away',
  async () => {
    await w.goto('destruction', { instant: true });
    engine.step(10);
    room().punch(1);
    engine.step(5);
    expect(room().chunks()).toBe(12);
    engine.step(330);
    expect(room().chunks()).toBe(0);
    expect(room().broken()).toBe(1);
  },
  WORLD_T,
);

it(
  'fields: the well gathers bodies, a launch pad throws the hero up; the wing runs without errors',
  async () => {
    await w.goto('fields', { instant: true });
    engine.step(240);
    const gathered = room().gathered() as number;
    teleport(engine, [4, 0, 2.2], 0);
    stick(engine, 0, 1);
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      engine.step(1);
      if (i === 25) release(engine);
      peak = Math.max(peak, w.state().hero!.at[1]!);
    }
    release(engine);
    expect(gathered).toBeGreaterThanOrEqual(6);
    expect(room().launches()).toBeGreaterThanOrEqual(1);
    // HOP 12: 12² / (2 × 32) = 2.25 m
    expect(peak).toBeGreaterThan(1.9);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it('leaves the Atrium as it was: no body, collider or scene object of these rooms is left', () => expectNoLeak(engine, w, base), WORLD_T);
