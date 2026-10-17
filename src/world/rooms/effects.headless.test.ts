// Engine World's effects wing headless (moved from the e2e suite `world`): floaters sit in the
// water and the anchor sinks, wading ripples, lamps at night, settling snow, a storm's lightning, a
// meadow of blades, footprints and decals. The pictures stay in the e2e suite. One engine for the file.
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
  'water: crates and the raft float, the anchor sinks, wading makes ripples',
  async () => {
    await w.goto('water', { instant: true });
    engine.step(240);
    const sub = room().submerged() as { crates: number[]; raft: number; anchor: number };
    teleport(engine, [0, -0.9, -5], 0);
    stick(engine, 1, 0);
    engine.step(60);
    release(engine);
    for (const d of sub.crates) expect(d > 0.2 && d < 0.8, `crate ${d}`).toBe(true);
    expect(sub.raft > 0.1 && sub.raft < 0.7, `raft ${sub.raft}`).toBe(true);
    expect(sub.anchor).toBeLessThan(-0.5);
    expect(room().wades()).toBeGreaterThan(3);
    expect(room().ripples()).toBeGreaterThan(0.5);
  },
  WORLD_T,
);

it(
  'weather: lamps lit at night, snow settles, a storm flashes and wets the ground',
  async () => {
    await w.goto('weather', { instant: true });
    room().time(22.5);
    room().weather('snow');
    engine.step(240);
    const night = room().state() as { lamps: number[]; snow: number };
    room().time(12);
    room().weather('storm');
    engine.step(480);
    const noon = room().state() as { sun: number; bolts: number; wet: number };
    for (const i of night.lamps) expect(i).toBeGreaterThan(5);
    expect(night.snow).toBeGreaterThan(0.15);
    expect(noon.sun).toBeGreaterThan(2.5);
    expect(noon.bolts).toBeGreaterThanOrEqual(1);
    expect(noon.wet).toBeGreaterThan(0.5);
  },
  WORLD_T,
);

it(
  'grass: thousands of blades and flowers',
  async () => {
    await w.goto('foliage', { instant: true });
    engine.step(20);
    expect(room().blades()).toBeGreaterThan(5000);
    expect(room().flowers()).toBeGreaterThan(100);
  },
  WORLD_T,
);

it(
  'trails: a bomb leaves marks, walking leaves footprints, the comet has a tail; the wing runs without errors',
  async () => {
    await w.goto('trails', { instant: true });
    engine.step(10);
    room().bomb();
    teleport(engine, [-3, 0, 6], 0);
    stick(engine, 1, 0);
    engine.step(90);
    release(engine);
    expect(room().marks()).toBeGreaterThanOrEqual(2);
    expect(room().prints()).toBeGreaterThanOrEqual(2);
    expect(room().comet()).toBeGreaterThan(10);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it('leaves the Atrium as it was: no body, collider or scene object of these rooms is left', () => expectNoLeak(engine, w, base), WORLD_T);
