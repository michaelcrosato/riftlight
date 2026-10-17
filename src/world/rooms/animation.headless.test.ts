// Engine World's animation wing headless (moved from the e2e suite `world`): the scarf trails a
// running hero, slimes squash only while SQUASH is on, procedural legs follow the hero with planted
// feet, a sprite crowd is a batch per sheet, ragdolls lie down, tumble and get back up. That
// mirrored sprites draw (pixels) stays in the e2e suite. One engine for the file.
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
  'secondary motion: the scarf trails a running hero and settles; slimes squash and stretch, not when SQUASH is off',
  async () => {
    await w.goto('secondary', { instant: true });
    engine.step(60);
    const idle = room().swing() as number; // gravity sags the scarf a little even standing still
    stick(engine, 1, 0);
    engine.step(40);
    const running = room().swing() as number;
    release(engine);
    let squashOn = 0;
    for (let i = 0; i < 120; i++) {
      engine.step(1);
      squashOn = Math.max(squashOn, ...(room().squash() as number[]).map(Math.abs));
    }
    w.pad('SQUASH');
    engine.step(120);
    let squashOff = 0;
    for (let i = 0; i < 120; i++) {
      engine.step(1);
      squashOff = Math.max(squashOff, ...(room().squash() as number[]).map(Math.abs));
    }
    expect(running).toBeGreaterThan(idle + 0.08);
    expect(room().swing()).toBeLessThan(running);
    expect(squashOn).toBeGreaterThan(0.1);
    expect(squashOff).toBeLessThan(0.02);
    expect(room().landings()).toBeGreaterThanOrEqual(3);
  },
  WORLD_T,
);

it(
  'procedural legs: the walker follows the hero onto the deck, the crab and the robot walk, planted feet never slide',
  async () => {
    await w.goto('legs', { instant: true });
    engine.step(10);
    const steps0 = (room().steps() as number[])[0]!;
    teleport(engine, [-2.5, 1.4, -6.5], Math.PI);
    engine.step(300);
    const [wx, wy, wz] = room().walker() as number[];
    const hero = w.state().hero!.at;
    const steps = room().steps() as number[];
    expect(steps[0]! - steps0).toBeGreaterThan(10);
    for (const n of steps.slice(1)) expect(n).toBeGreaterThan(3);
    expect(Math.hypot(wx! - hero[0]!, wz! - hero[2]!)).toBeLessThan(4);
    expect(wy).toBeGreaterThan(1.4);
    expect(room().slide()).toBeLessThan(1e-6);
  },
  WORLD_T,
);

it(
  'sprites: three sheets, three batches, walk frames flip, a crowd of 300',
  async () => {
    await w.goto('sprites', { instant: true });
    engine.step(10);
    expect(room().draws()).toBe(3);
    const seen = new Set<unknown>();
    for (let i = 0; i < 60; i++) {
      engine.step(1);
      for (const f of room().frames() as unknown[]) seen.add(f);
    }
    expect(seen.size).toBe(4);
    w.pad('300 CRITTERS');
    engine.step(5);
    expect(room().critters()).toBe(300);
  },
  WORLD_T,
);

it(
  'ragdolls: limp dummies lie down and get back up, a pushed one tumbles down the stairs, the cannon knocks one over; the wing runs without errors',
  async () => {
    await w.goto('ragdolls', { instant: true });
    engine.step(10);
    w.pad('ALL LIMP');
    let n = 0;
    while ((room().states() as string[]).some((st) => st !== 'stand') && n++ < 1200) engine.step(1);
    const standing = (room().pelvis() as number[][]).slice(0, 3).map((p) => p[1]!);
    const lay = (room().lay() as { at: number[]; rested: boolean }[]).slice(0, 3);
    const ups3 = (room().ups() as number[])[3]; // the stairs dummy may have got up once already (ALL LIMP)
    w.pad('PUSH');
    n = 0;
    while ((room().ups() as number[])[3] === ups3 && n++ < 1200) engine.step(1);
    const stairs = (room().lay() as { at: number[]; rested: boolean }[])[3]!;
    const falls = () => (room().falls() as number[]).slice(0, 3).reduce((a, b) => a + b, 0);
    const before = falls();
    room().fire();
    engine.step(90);
    for (const l of lay) {
      expect(l.at[1]).toBeLessThan(0.35);
      expect(l.rested).toBe(true);
    }
    for (const y of standing) expect(y).toBeGreaterThan(0.5);
    expect((room().ups() as number[]).slice(0, 3)).toEqual([1, 1, 1]);
    // where on the stairs it stops is chaos; that it left the landing (2.8 m up), came down them and lay still is not
    expect(stairs.at[1]).toBeLessThan(1.8);
    expect(stairs.at[2]).toBeGreaterThan(-3.5);
    expect(stairs.rested).toBe(true);
    expect(falls() - before).toBeGreaterThanOrEqual(1);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it('leaves the Atrium as it was: no body, collider or scene object of these rooms is left', () => expectNoLeak(engine, w, base), WORLD_T);
