// Save-states mid-fight, depth 1 (docs/game/save-states.md; the other depths in their own
// snapshot.depth*.test.ts files, one engine each, ~15 s): a fight by input, a snapshot with
// effects in flight, played on, restored (the level built again), played on the same way. Then
// that moment restored from another level, from town, from the title and in a replay after a
// restore; and a level this game would plan differently refused.
import { expect, it } from 'vitest';
import { describeDepths, SnapDriver } from './testSnapshot';

describeDepths([1], {
  effects: true,
  then: ({ d: driver, rows }) => {
  it(
    "a level this game would plan differently is refused, the game as it was; depth 1's moment comes back the same from depth 2, from town, from the title, and replayed after a restore",
    async () => {
      const d = driver();
      const e = d.e;
      const first = rows[0]!;
      type LevelSnap = { level: { entry: { spec: { seed: number } } } };
      const state = first.snap.state as LevelSnap;
      const lvl = state.level;
      const other = { ...first.snap, state: { ...state, level: { ...lvl, entry: { ...lvl.entry, spec: { ...lvl.entry.spec, seed: lvl.entry.spec.seed + 1 } } } } };
      const now = () => JSON.stringify({ print: e.fingerprint(), screen: d.game.screen, depth: d.game.level?.spec.depth });
      const before = now();
      expect(await SnapDriver.refusal(e.restore(other))).toMatch(/built the same/);
      expect(now()).toBe(before);
      const back = async () => {
        await e.restore(first.snap);
        d.fight(180, 999);
        return e.fingerprint();
      };
      await d.enter(2);
      expect(await back(), 'from depth 2').toBe(first.went);
      d.game.returnToTown();
      e.step(5);
      expect(await back(), 'from town').toBe(first.went);
      d.game.toTitle();
      e.step(5);
      expect(await back(), 'from the title').toBe(first.went);
      const rec = JSON.parse(JSON.stringify(e.recording())) as Parameters<typeof e.replay>[0];
      await e.replay(rec, d.fresh);
      expect(e.fingerprint(), 'replayed in a fresh Riftlight').toBe(first.went);
      expect(e.state().errors).toEqual([]);
    },
    30_000,
  );
},
});
