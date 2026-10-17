// Engine World headless: every room loads in turn (as `goto` does in a page), its first pad works,
// its knobs are unique and it runs without errors; back in the Atrium after all of them, nothing
// leaked (the same physics and scene counts) and the hero stands at the door they came out of.
// The pictures of each room stay in the e2e suite `world`. One engine for the file (the shell is one per process).
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../engine';
import { headlessWorld, roomApi, WORLD_T } from './testWorld';
import type { worldApi } from './index';

let engine: Engine;
let w: typeof worldApi;
let base: { physics: unknown; children: number };

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
  engine.step(30);
  base = { physics: engine.physics.counts(), children: engine.scene.children.length };
}, WORLD_T);
afterAll(() => engine?.dispose());

it(
  'every room loads, its first pad works, its knobs are unique, and it runs without errors',
  async () => {
    const bad: string[] = [];
    const rooms = w.rooms();
    for (const r of rooms) {
      await w.goto(r.id, { instant: true });
      engine.step(20);
      const pads = w.state().pads;
      const stepped = pads.length ? w.pad(pads[0]!.label) : true;
      engine.step(10);
      const ids = w.knobs().map((k) => k.id);
      const errors = engine.state().errors;
      if (w.state().room !== r.id || !stepped || new Set(ids).size !== ids.length || errors.length) bad.push(`${r.id}: room ${w.state().room}, pad ${stepped}, knobs ${ids}, ${errors.join('; ')}`);
    }
    expect(bad).toEqual([]);
    expect(rooms.length).toBeGreaterThanOrEqual(40);
  },
  WORLD_T,
);

it(
  'shader gallery: TSL materials on one clock, which freezes; the GPU rooms\' readbacks say they need the GPU',
  async () => {
    await w.goto('shaders', { instant: true });
    engine.step(30);
    const ran = roomApi(w).clock() as number;
    roomApi(w).freeze(true);
    engine.step(30);
    expect(ran).toBeGreaterThan(0.3);
    expect(roomApi(w).clock()).toBe(ran);
    expect((roomApi(w).pieces() as unknown[]).length).toBeGreaterThanOrEqual(6);
    // swarm's compute and views' render targets are read back from the GPU: those checks stay in the browser
    await w.goto('swarm', { instant: true });
    await expect((async () => roomApi(w).sample())()).rejects.toThrow(/engine\.gpu/);
    await w.goto('views', { instant: true });
    await expect((async () => roomApi(w).feed(0))()).rejects.toThrow(/engine\.gpu/);
  },
  WORLD_T,
);

it(
  'after every room the Atrium has the same physics and scene objects, and the hero arrives in front of the door',
  async () => {
    await w.goto('lights', { instant: true });
    engine.step(5);
    await w.goto('atrium', { instant: true });
    engine.step(5);
    expect(engine.physics.counts()).toEqual(base.physics);
    expect(engine.scene.children.length).toBe(base.children);
    const hero = w.state().hero!.at;
    const door = (roomApi(w).doors() as { id: string; at: number[] }[]).find((d) => d.id === 'lights')!.at;
    expect(Math.hypot(hero[0]! - door[0]!, hero[2]! - door[2]!)).toBeLessThan(3);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);
