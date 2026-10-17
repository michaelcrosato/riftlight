// Engine World's AI & direction wing headless (moved from the e2e suite `world`): behaviour-tree
// robots deliver, flee and recharge; the cutscene timeline drives the camera, cuts, speaks and can
// be skipped or taken over; the sound garden's mix is louder near, panned and muffled behind a wall,
// and leaving it stops every loop. One engine for the file (the World shell is one per process).
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
  'robot yard: behaviour trees deliver crystals; up close a robot flees; drained, they recharge and fill up; none in a wall, no crystal claimed twice',
  async () => {
    await w.goto('robots', { instant: true });
    let n = 0;
    let onFloor = true;
    let claims = true;
    while (room().delivered() < 2 && n++ < 1500) {
      engine.step(1);
      onFloor &&= room().onFloor();
      claims &&= room().claimsConsistent();
    }
    expect(room().delivered()).toBeGreaterThanOrEqual(2);
    const at = (room().positions() as number[][])[0]!;
    teleport(engine, [at[0]! + 0.8, 0, at[1]!], 0);
    engine.step(3);
    const fleeing = (room().paths() as string[][])[0]!;
    const traced = room().trace(0) as { status: string }[];
    for (let i = 0; i < 60; i++) {
      engine.step(1);
      claims &&= room().claimsConsistent();
    }
    const now = (room().positions() as number[][])[0]!;
    expect(fleeing).toContain('flee');
    expect(Math.hypot(now[0]! - at[0]!, now[1]! - at[1]!)).toBeGreaterThan(1);
    expect(traced.length).toBeGreaterThanOrEqual(15);
    expect(traced[0]!.status).toBe('running');
    // drained batteries: recharge outranks delivering and collecting; they come back full
    teleport(engine, [10, 0, 4.5], 0);
    room().drain();
    engine.step(3);
    const recharging = room().paths() as string[][];
    expect(recharging.filter((p) => p.includes('recharge')).length).toBeGreaterThanOrEqual(3);
    const charged = (room().batteries() as number[]).map(() => 0);
    n = 0;
    while (charged.some((c) => c < 0.95) && n++ < 3000) {
      engine.step(1);
      (room().batteries() as number[]).forEach((b, i) => (charged[i] = Math.max(charged[i]!, b)));
      onFloor &&= room().onFloor();
    }
    for (const b of charged) expect(b).toBeGreaterThanOrEqual(0.95);
    expect(onFloor, 'no robot in a wall').toBe(true);
    expect(claims, 'no crystal claimed twice').toBe(true);
  },
  WORLD_T,
);

it(
  'cutscene: the timeline drives a fixed camera, bars in, a line spoken, cuts; SPACE skips to the end state; a camera picked mid-scene ends it',
  async () => {
    await w.goto('cutscene', { instant: true });
    engine.step(5);
    expect(w.pad('PLAY SCENE')).toBe(true);
    engine.step(60);
    const shot = room().shot() as { position: number[] };
    const cam = room().cameraAt() as number[];
    expect(room().playing()).toBe(true);
    expect(room().preset()).toBe('fixed');
    expect(w.state().hero).toBeNull();
    expect(Math.hypot(cam[0]! - shot.position[0]!, cam[1]! - shot.position[1]!, cam[2]! - shot.position[2]!)).toBeLessThan(0.01);
    expect(room().bars()).toBeGreaterThan(0.99);
    expect(room().line()).toBeTruthy();
    let n = 0;
    while (room().playing() && room().time() < 7.5 && n++ < 200) engine.step(10);
    expect(room().cuts()).toBeGreaterThanOrEqual(2);
    engine.input.setKey('Space', true);
    engine.step(1);
    engine.input.setKey('Space', false);
    engine.step(2);
    const fired = room().fired() as string[];
    expect(room().playing()).toBe(false);
    expect(room().chestOpen()).toBe(true);
    expect(room().gateOpen()).toBe(true);
    expect(fired).toContain('gate opens');
    expect(fired).not.toContain('fanfare');
    expect(room().preset()).toBe('iso');
    expect(w.state().hero!.at[1]).toBeLessThan(0.1); // back, and not jumping on the same press
    // another camera picked mid-scene (as the T panel does): the scene ends and leaves it be
    room().play();
    engine.step(30);
    expect(room().playing()).toBe(true);
    expect(room().preset()).toBe('fixed');
    engine.setCamera({ preset: 'topdown' }, { syncUrl: false });
    engine.step(2);
    expect(room().playing()).toBe(false);
    expect(room().preset()).toBe('topdown');
    expect(w.state().hero).not.toBeNull();
  },
  WORLD_T,
);

type Mix = { name: string; gain: number; pan: number; occluded: boolean; muffle: number }[];

it(
  'sound garden: loudest by the fountain, panned to its side, muffled behind the wall (not with OCCLUSION off); leaving stops every loop; the wing runs without errors',
  async () => {
    await w.goto('sounds', { instant: true });
    const hear = (x: number, z: number, frames = 40): Mix => {
      teleport(engine, [x, 0, z], 0);
      engine.step(frames);
      return room().mix() as Mix;
    };
    const byFountain = hear(-4.5, -3);
    const west = hear(5, -3.5); // between the wall and the generator: it is east of you
    const east = hear(9.5, -3.5);
    const behind = hear(1, -3.5); // the wall between you and the generator
    const told = room().voices() as Mix;
    w.pad('OCCLUSION');
    const through = hear(1, -3.5);
    expect(byFountain.reduce((a, b) => (b.gain > a.gain ? b : a)).name).toBe('FOUNTAIN');
    expect(byFountain[0]!.gain).toBeGreaterThan(0.5);
    expect(byFountain[2]!.gain).toBeLessThan(byFountain[0]!.gain / 2);
    expect(west[1]!.pan * east[1]!.pan).toBeLessThan(0);
    expect(Math.abs(west[1]!.pan)).toBeGreaterThan(0.3);
    expect(west[1]!.occluded).toBe(false);
    expect(behind[1]!.occluded).toBe(true);
    expect(behind[1]!.muffle).toBeGreaterThan(0.5);
    expect(told[1]!.muffle).toBeGreaterThan(0.5);
    expect(through[1]!.occluded).toBe(false);
    engine.audio.loop('jump', { volume: 0 }); // a loop the room does not know about: the level unload stops it
    await w.goto('atrium', { instant: true });
    engine.step(2);
    expect(engine.audio.loops.length).toBe(0);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

it('leaves the Atrium as it was: no body, collider or scene object of these rooms is left', () => expectNoLeak(engine, w, base), WORLD_T);
