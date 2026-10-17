// Save-states in town, headless (docs/game/save-states.md): a run played by input (the stick,
// the pointer aiming and swinging, a skill now and then: the townsfolk bark, the cat runs,
// cooldowns tick), then `engine.snapshot()` keeps the moment as JSON. Played on from there, then
// restored and played on the same way, the game reaches the same fingerprint, also when restored
// from the arcade, photo mode, or a level with the inventory open; a recording made after a
// restore replays in a fresh Riftlight to it. One engine for the file, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Snapshot } from '../../engine';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { SnapDriver, snapDiff } from './testSnapshot';

const T = 30_000;
let h: HeadlessRiftlight;
let d: SnapDriver;
let snap: Snapshot;
/** The run as it went on from the snapshot (300 frames of `play(…, 1000)`). */
let went: string;
const wentPrints: string[] = [];
let rec: unknown;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242 });
  d = new SnapDriver(h.engine);
}, T);
afterAll(() => h?.engine.dispose());

type TownSnap = { hero: { hc: { cooldowns: unknown[] } }; town: { extensions: unknown[] } };

describe('Riftlight save-states in town', () => {
  it(
    'a new run in town lives while the hero plays, and a snapshot keeps the moment as JSON',
    async () => {
      const { engine: e } = h;
      await d.newRun(1, 99);
      expect(d.game.screen).toBe('town');
      const counts = () => d.hero.hc.stats;
      const before = { ...counts() };
      const npcAt = () => d.game.town.npcs.map((n) => n.position.toArray().join());
      const npcs0 = npcAt();
      d.play(360, 0);
      expect(counts().attacks - before.attacks, 'swings').toBeGreaterThan(0);
      expect(counts().casts - before.casts, 'casts').toBeGreaterThan(0);
      expect(npcAt().filter((p, i) => p !== npcs0[i]).length, 'townsfolk walked').toBeGreaterThan(0);
      // every skill and a dodge just before: cooldowns run at the snapshot; and a buff that never ends (Infinity)
      for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Space']) d.tap(k);
      d.actor.addBuff('e2e-forever', [], 0);
      snap = await d.take();
      expect(JSON.stringify(snap).length).toBeGreaterThan(1000);
      expect((snap.state as TownSnap).hero.hc.cooldowns.length, 'cooldowns running at the snapshot').toBeGreaterThan(0);
      d.play(300, 1000, wentPrints);
      went = e.fingerprint();
    },
    T,
  );

  it(
    'restored and played on the same way: the snapshot just after is the one restored, the same game every 30 frames, the endless buff back',
    async () => {
      const { engine: e } = h;
      const t0 = performance.now(); // real time: how long a restore takes (the page's 500 ms budget; ~20 ms in Node)
      await e.restore(snap);
      const ms = performance.now() - t0; // real time: the restore measured above
      expect(snapDiff(snap, await d.take())).toEqual([]);
      const restoredPrints: string[] = [];
      d.play(300, 1000, restoredPrints);
      expect(restoredPrints).toEqual(wentPrints);
      expect(e.fingerprint()).toBe(went);
      expect(d.actor.hasBuff('e2e-forever')).toBe(true);
      expect(ms, 'a restore in town').toBeLessThan(500);
      rec = JSON.parse(JSON.stringify(e.recording()));
      expect((rec as { from?: unknown }).from).toBeTruthy();
    },
    T,
  );

  it(
    "a different input from the same moment plays differently; a snapshot that doesn't fit this town is refused, the game as it was",
    async () => {
      const { engine: e } = h;
      await e.restore(snap);
      d.play(300, 2000);
      expect(e.fingerprint()).not.toBe(went);
      const now = () => JSON.stringify({ print: e.fingerprint(), time: e.time, hero: d.actor.position.toArray().join() });
      const before = now();
      const state = snap.state as TownSnap;
      const misfit = await SnapDriver.refusal(e.restore({ ...snap, state: { ...state, town: { ...state.town, extensions: [] } } }));
      expect(misfit).toMatch(/extensions/);
      expect(now()).toBe(before);
    },
    T,
  );

  it(
    'skills in flight at a restore (a nova, a dash) are gone: the same moment, the same game',
    async () => {
      const { engine: e } = h;
      await e.restore(snap);
      d.play(240, 3000); // past the snapshot's cooldowns
      const flying = () => d.heroWorld?.combat.effects.length ?? -1;
      for (const k of ['Digit2', 'Digit3', 'Digit1']) {
        e.input.setKey(k, true);
        e.step(1);
        e.input.setKey(k, false);
        for (let f = 0; f < 40 && flying() <= 0; f++) e.step(1); // its wind-up, then it flies
        if (flying() > 0) break;
      }
      expect(flying(), 'effects in flight').toBeGreaterThan(0);
      await e.restore(snap);
      const after = JSON.parse(JSON.stringify(await e.snapshot())) as Snapshot;
      expect(JSON.stringify((after.state as { hero: unknown }).hero)).toBe(JSON.stringify((snap.state as { hero: unknown }).hero));
      d.play(300, 1000);
      expect(e.fingerprint()).toBe(went);
    },
    T,
  );

  it(
    'restored from the arcade and from photo mode (cameras of their own): the same game',
    async () => {
      const { engine: e } = h;
      await d.game.showcase.open(d.game.showcase.arcade, { instant: true });
      e.step(2);
      expect(e.camera.preset).not.toBe('iso');
      await e.restore(snap);
      d.play(300, 1000);
      expect(e.fingerprint(), 'from the arcade').toBe(went);
      d.game.photoMode();
      e.step(2);
      expect(e.camera.preset).not.toBe('iso');
      await e.restore(snap);
      d.play(300, 1000);
      expect(e.fingerprint(), 'from photo mode').toBe(went);
    },
    T,
  );

  it(
    'a snapshot with a panel open is refused; one in a level is taken; restored from a level with the inventory open: back in town, panels closed, the same game',
    async () => {
      const { engine: e } = h;
      await e.restore(snap);
      d.api.ui.open('inventory');
      e.step(2);
      expect(await SnapDriver.refusal(e.snapshot())).toMatch(/panel is open/);
      d.api.ui.close();
      e.step(1);
      await d.enter(1, 30);
      d.play(120, 500);
      expect(d.game.screen).toBe('level');
      expect(await SnapDriver.refusal(e.snapshot())).toBe('');
      d.api.ui.open('inventory');
      e.step(2);
      await e.restore(snap);
      expect(d.game.screen).toBe('town');
      expect(d.api.state().ui).toEqual([]);
      d.play(300, 1000);
      expect(e.fingerprint()).toBe(went);
    },
    T,
  );

  it(
    'a recording made after a restore replays in a fresh Riftlight to the same moment, with no game errors',
    async () => {
      const { engine: e } = h;
      await e.replay(rec as Parameters<typeof e.replay>[0], d.fresh);
      expect(e.fingerprint()).toBe(went);
      expect(e.state().errors).toEqual([]);
    },
    T,
  );
});
