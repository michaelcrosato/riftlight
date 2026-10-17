// Engine World's procedural wing headless (moved from the e2e suite `world`): the terrain's
// collider is where its mesh is, a seed is a land, rain erodes it without digging pits; wave
// function collapse solves a valid dungeon, step by step when watched; L-system plants grow and
// draw again branch by branch. One engine for the file (the World shell is one per process).
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import type { worldApi } from '../index';
import { type AtriumBase, atriumBase, expectNoLeak, headlessWorld, roomApi, WORLD_T } from '../testWorld';

let engine: Engine;
let w: typeof worldApi;
let base: AtriumBase;
const room = () => roomApi(w);

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
  base = atriumBase(engine);
}, WORLD_T);
afterAll(() => engine?.dispose());

type Heights = { min: number; max: number };
type Probe = { collider: number | null; mesh: number };

it(
  'terrain: the collider is where the mesh is, a seed is a land, rain erodes it and four times the rain digs no pits; trees grow',
  async () => {
    await w.goto('terrain', { instant: true });
    engine.step(10);
    const spots = [
      [0.13, -5.27],
      [-10.31, 2.17],
      [12.41, -11.73],
      [-15.6, -9.9],
    ] as const;
    const gap = (ps: Probe[]) => Math.max(...ps.map((p) => (p.collider === null ? 99 : Math.abs(p.collider - p.mesh))));
    const probes = spots.map(([x, z]) => room().probe(x, z) as Probe);
    const first = room().heights() as Heights;
    room().seed(8);
    engine.step(2);
    const second = room().heights() as Heights;
    room().seed(7);
    engine.step(2);
    const again = room().heights() as Heights;
    room().erode();
    for (let i = 0; i < 60 && room().eroding(); i++) engine.step(1);
    const eroded = room().heights() as Heights;
    const drops = room().drops() as number;
    // more rain on the same land: it wears down, it never digs a pit
    for (let n = 0; n < 3; n++) {
      room().erode();
      for (let i = 0; i < 60 && room().eroding(); i++) engine.step(1);
    }
    const after = spots.slice(0, 3).map(([x, z]) => room().probe(x, z) as Probe);
    const rained = room().heights() as Heights;
    expect(Math.max(gap(probes), gap(after))).toBeLessThan(0.01);
    expect(first.max).toBeGreaterThan(1.5);
    expect(second.max).not.toBe(first.max);
    expect(again.max).toBe(first.max);
    expect(drops).toBeGreaterThanOrEqual(3000);
    expect(eroded.max).toBeLessThan(first.max);
    expect(room().trees()).toBeGreaterThan(5);
    expect(rained.min).toBeGreaterThan(first.min - 1);
    expect(rained.max).toBeLessThanOrEqual(eroded.max + 0.01);
  },
  WORLD_T,
);

it(
  'dungeon: wave function collapse fits every tile, walls are colliders, most floor is reachable; watched, it collapses square by square and ends valid',
  async () => {
    await w.goto('dungeon', { instant: true });
    engine.step(5);
    const reach = room().reach() as { reachable: number; floor: number };
    expect(room().done()).toBe(true);
    expect(room().valid()).toBe(true);
    expect(room().walls()).toBeGreaterThan(5);
    expect(reach.reachable).toBeGreaterThan(reach.floor * 0.3);
    room().watch();
    engine.step(20);
    expect(room().undecided()).toBeGreaterThan(0);
    expect(room().watching()).toBe(true);
    for (let i = 0; i < 600 && room().watching(); i++) engine.step(1);
    expect(room().done()).toBe(true);
    expect(room().valid()).toBe(true);
  },
  WORLD_T,
);

it(
  'plants: four L-systems grown, drawn again branch by branch; the wing runs without errors',
  async () => {
    await w.goto('plants', { instant: true });
    engine.step(5);
    const counts = room().counts() as { name: string; branches: number; shown: number; height: number }[];
    expect(counts.length).toBe(4);
    for (const c of counts) {
      expect(c.branches, c.name).toBeGreaterThan(20);
      expect(c.shown, c.name).toBe(c.branches);
      expect(c.height, c.name).toBeGreaterThan(1);
    }
    room().grow();
    engine.step(60);
    const half = room().grown() as number;
    expect(half > 0.1 && half < 0.9, `grown ${half} a second in`).toBe(true);
    engine.step(150);
    expect(room().grown()).toBe(1);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it('leaves the Atrium as it was: no body, collider or scene object of these rooms is left', () => expectNoLeak(engine, w, base), WORLD_T);
