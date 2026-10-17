// Engine World's genre wing headless (moved from the e2e suite `world`): stealth guards see, chase
// and catch the hero and come along their paths at an alarm; flocks line up and sheep scatter; the
// drift car drives, slides and lets the hero out; bullet hell fills the arena and the turret takes
// punches. One engine for the file (the World shell is one per process), rooms in turn.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import type { worldApi } from '../index';
import { type AtriumBase, atriumBase, expectNoLeak, headlessWorld, roomApi, teleport, WORLD_T } from '../testWorld';

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
  'stealth: unseen at the start; in front of a guard you are seen and caught, sent back, and an alarm brings every guard in; no guard in a wall',
  async () => {
    await w.goto('stealth', { instant: true });
    engine.step(180);
    expect(room().alarms()).toBe(0);
    expect(room().states()).toEqual((room().states() as string[]).map(() => 'patrol'));
    teleport(engine, [-0.5, 0, 0], 0);
    let n = 0;
    let onFloor = true;
    while (room().caught() < 1 && n++ < 900) {
      engine.step(1);
      onFloor &&= room().onFloor();
    }
    expect(room().alarms()).toBeGreaterThanOrEqual(1);
    expect(room().caught()).toBe(1);
    n = 0;
    while ((room().states() as string[]).some((st) => st !== 'patrol') && n++ < 1800) {
      engine.step(1);
      onFloor &&= room().onFloor();
    }
    expect((room().states() as string[]).every((st) => st === 'patrol')).toBe(true);
    expect(w.state().hero!.at[0]).toBeLessThan(-10);
    // an alarm with the hero in the far corner: every guard comes along its path, round walls and crates
    room().raise();
    const before = room().distances() as number[];
    for (let i = 0; i < 90; i++) {
      engine.step(1);
      onFloor &&= room().onFloor();
    }
    const closed = (room().distances() as number[]).map((d, i) => before[i]! - d);
    for (const d of closed) expect(d).toBeGreaterThan(1.5);
    expect(onFloor, 'no guard ever stands in a wall or a crate').toBe(true);
  },
  WORLD_T,
);

it(
  'flocks: birds and fish line up (two seconds of average); sheep scatter from the hero',
  async () => {
    await w.goto('flocks', { instant: true });
    engine.step(240);
    // alignment swings as a flock wheels: average it over two seconds
    let birds = 0;
    let fish = 0;
    for (let i = 0; i < 12; i++) {
      engine.step(10);
      const o = room().order() as { birds: { alignment: number }; fish: { alignment: number } };
      birds += o.birds.alignment / 12;
      fish += o.fish.alignment / 12;
    }
    expect(birds).toBeGreaterThan(0.45);
    expect(fish).toBeGreaterThan(0.4);
    // sheep within 2 m of the middle of the pen, before and after the hero stands there
    const near = () => (room().sheep() as number[][]).filter(([x, z]) => Math.hypot(x! + 8, z! + 2) < 2).length;
    expect(near()).toBeGreaterThanOrEqual(3);
    teleport(engine, [-8, 0, -2], 0);
    engine.step(120);
    expect(near()).toBeLessThanOrEqual(2);
  },
  WORLD_T,
);

it(
  'drift: W drives the car forward; it gets up to speed, the handbrake swings the tail out with skid marks; getting out puts the hero beside it',
  async () => {
    await w.goto('drift', { instant: true });
    engine.step(10);
    room().keys();
    engine.input.setKey('KeyW', true);
    engine.step(60);
    engine.input.setKey('KeyW', false);
    expect(room().speed()).toBeGreaterThan(2); // speed > 0 is along the car's heading
    w.pad('FLIP BACK'); // back to the start, then a run-up and a drift in the open
    room().drive(1, 0);
    engine.step(100);
    expect(Math.abs(room().speed())).toBeGreaterThan(6);
    room().drive(0.6, 1, true);
    let slip = 0;
    for (let i = 0; i < 60; i++) {
      engine.step(1);
      slip = Math.max(slip, room().slip());
    }
    expect(slip).toBeGreaterThan(0.4);
    expect(room().marks()).toBeGreaterThan(0);
    room().drive(0, 0);
    engine.step(120);
    expect(room().getOut()).toBeTruthy();
    engine.step(30);
    const car = room().car() as number[];
    const at = w.state().hero?.at ?? [99, 99, 99];
    expect(room().driving()).toBe(false);
    expect(Math.hypot(at[0]! - car[0]!, at[2]! - car[2]!)).toBeLessThan(3.5);
    expect(Math.abs(at[1]!)).toBeLessThan(0.2);
  },
  WORLD_T,
);

it(
  'bullet hell: every pattern fills the arena and hits the hero; punches shoot back and hurt the turret; the wing runs without errors',
  async () => {
    await w.goto('bullets', { instant: true });
    w.pad('ALL');
    engine.step(180);
    expect(room().bullets()).toBeGreaterThan(300);
    expect(room().hits()).toBeGreaterThanOrEqual(1);
    room().patterns([]); // a ceasefire: shoot the turret in peace
    engine.step(240);
    teleport(engine, [0, 0, 3], Math.PI); // facing the turret
    for (let i = 0; i < 6; i++) {
      engine.input.setKey('KeyJ', true);
      engine.step(2);
      engine.input.setKey('KeyJ', false);
      engine.step(16);
    }
    engine.step(30);
    expect(room().shots()).toBeGreaterThanOrEqual(6);
    expect(room().hp()).toBeLessThan(100);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it('leaves the Atrium as it was: no body, collider or scene object of these rooms is left', () => expectNoLeak(engine, w, base), WORLD_T);
