// Engine World's shell headless (what the e2e suite `world` drove through window.__WORLD__): the
// Atrium's doors, walking into one (an iris, the room loads as its own Game), the Game Feel Lab's
// hitstop, shake, flash and game speed as state, the panels, the sun dial and a mosaic transition.
// The pictures (the Atrium, the mosaic's colours) stay in the e2e suite. One engine for the file.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../engine';
import { stepUntil } from '../riftlight/headless';
import type { worldApi } from './index';
import { shell } from './shell';
import { headlessWorld, release, roomApi, stick, teleport, WORLD_T } from './testWorld';

let engine: Engine;
let w: typeof worldApi;

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
}, WORLD_T);
afterAll(() => engine?.dispose());

type Door = { id: string; at: [number, number, number]; facing: number };

it('__WORLD__ is up once the engine is ready, in the Atrium, with a door for every room', () => {
  expect((globalThis as { __WORLD__?: unknown }).__WORLD__).toBe(w);
  expect(w.state().room).toBe('atrium');
  const rooms = w.rooms();
  const doors = roomApi(w).doors() as Door[];
  expect(rooms[0]!.id).toBe('atrium');
  expect(rooms.length).toBeGreaterThanOrEqual(10);
  expect(doors.length).toBe(rooms.length - 1);
  for (const r of rooms.slice(1)) expect(doors.some((d) => d.id === r.id), r.id).toBe(true);
});

it(
  'walking into the Game Feel Lab door starts an iris; the room loads as its own Game and the iris opens',
  async () => {
    engine.step(30);
    const d = (roomApi(w).doors() as Door[]).find((x) => x.id === 'feel')!;
    teleport(engine, [d.at[0] - Math.sin(d.facing) * 1.5, 0, d.at[2] - Math.cos(d.facing) * 1.5], d.facing);
    engine.step(5);
    // movement is camera-relative: the stick toward the door in the camera's ground basis
    stick(engine, Math.sin(d.facing), Math.cos(d.facing));
    for (let i = 0; i < 240 && !w.state().busy; i++) engine.step(1);
    expect(w.state().busy).toBe(true);
    let covered = 0;
    for (let i = 0; i < 30; i++) {
      engine.step(1);
      covered = Math.max(covered, engine.screen.state().progress);
    }
    release(engine);
    expect(engine.screen.state().transition).toBe('iris');
    expect(covered).toBeGreaterThan(0.3);
    await stepUntil(engine, () => w.state().room === 'feel' && !w.state().busy, { max: 600, every: 2, what: 'the Game Feel Lab loaded' });
    expect(engine.game.name).toBe('Engine World: Game Feel Lab');
    expect(engine.screen.state().progress).toBe(0);
  },
  WORLD_T,
);

it('a hit: hitstop freezes game time while shake and the flash run; game speed 0.25x slows it', () => {
  engine.step(10);
  const t0 = engine.time;
  roomApi(w).hit();
  expect(engine.state().hitstop).toBeGreaterThan(0.05);
  expect(engine.shake.trauma).toBeGreaterThan(0.3);
  expect(engine.screen.state().flash).toBeGreaterThan(0);
  engine.step(3); // 0.05 s: inside the 0.09 s hitstop
  expect(engine.time - t0).toBe(0);
  engine.step(30);
  expect(engine.time - t0).toBeGreaterThan(0.3);
  w.knob('engine-speed', 0.25);
  const t1 = engine.time;
  engine.step(60);
  expect(engine.time - t1).toBeCloseTo(0.25, 2);
  w.knob('engine-speed', 1);
});

it('the panels open and close; the station guide is whole; closing the room list and the menu thaws the game', () => {
  const got: (string | null)[] = [];
  for (const p of ['guide', 'tweak', 'rooms', 'pause', 'glossary'] as const) {
    got.push(w.open(p));
    engine.step(4);
    w.close();
  }
  expect(got).toEqual(['guide', 'tweak', 'rooms', 'pause', 'glossary']);
  const guide = w.guide('feel');
  expect(guide.filter((l) => l.startsWith('## ')).length).toBeGreaterThanOrEqual(8);
  expect(guide.length).toBeGreaterThan(30);
  expect(engine.timeScale).toBe(1);
});

it(
  'the sun dial points the sun, and the light pool lends every light',
  async () => {
    await w.goto('lights', { instant: true });
    w.pad('DAWN');
    engine.step(5);
    expect(engine.sunDir.x).toBeGreaterThan(0.8);
    w.pad('NOON');
    engine.step(5);
    expect(engine.sunDir.y).toBeGreaterThan(0.8);
    const stats = engine.lights.stats();
    expect(stats.lit).toBe(stats.size);
  },
  WORLD_T,
);

it(
  'a mosaic covers the screen and reveals it again',
  async () => {
    await w.goto('transitions', { instant: true });
    engine.step(10);
    void engine.screen.cover('mosaic', { duration: 0.2 });
    engine.step(20);
    expect(engine.screen.state()).toMatchObject({ transition: 'mosaic', progress: 1 });
    void engine.screen.reveal('mosaic', { duration: 0.2 });
    engine.step(20);
    expect(engine.screen.state().progress).toBe(0);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it('the menu\'s way to Riftlight does nothing headless (no page to leave); the room plays on', () => {
  const room = engine.game.name;
  shell.toRiftlight();
  engine.step(5);
  expect(engine.game.name).toBe(room);
  expect(engine.state().errors).toEqual([]);
});
