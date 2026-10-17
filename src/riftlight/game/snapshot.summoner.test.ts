// Save-states with a summoner (docs/game/save-states.md): skeletons and a spectre against waves
// at depth 3. Minions die and leave while monsters still point at them (kept as ghosts): a
// snapshot every 10 frames is never refused, and a moment holding a ghost, restored twice, plays
// on the same. One engine for the file, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Snapshot } from '../../engine';
import type { Item } from '../core/types';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { PICTURE, SnapDriver, snapDiff } from './testSnapshot';

const T = 60_000; // 1200 frames of waves with a snapshot every 10: ~15 s alone, more under load
let h: HeadlessRiftlight;
let d: SnapDriver;
let held: Snapshot | null = null;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242 });
  d = new SnapDriver(h.engine);
  await d.newRun(2, 4242, false);
  d.game.dev.god = true;
  d.api.give({ levels: 20 });
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

type LevelSnap = { level: { state: { world: { combat: { actors: { kind: string }[] } } } } };

describe('Riftlight save-states with a summoner', () => {
  it(
    'a summoner fights waves: a snapshot every 10 frames, none refused; a minion gone but still pointed at is kept as a ghost',
    async () => {
      const e = h.engine;
      let uid = 1;
      const gem = (id: string) => ({ uid: `e2e-gem-${uid++}`, base: 'skill-gem', rarity: 'normal', level: 1, name: id, affixes: [], gem: { id, level: 8, support: false } }) as unknown as Item;
      const sockets = [
        { slot: 0, gem: gem('summon-skeletons'), supports: [] },
        { slot: 1, gem: gem('raise-spectre'), supports: [] },
      ];
      const g0 = d.game;
      g0.save.hero.skills = sockets;
      g0.ports.loot.setSockets?.(sockets);
      g0.hero.setSkills?.(sockets);
      await d.enter(3);
      const refused: string[] = [];
      let minions = 0;
      let tries = 0;
      for (let f = 0; f < 1200; f += 10) {
        const g = d.game;
        g.hero.actor.mana = d.actor.maxMana;
        if (f % 300 === 0) {
          const hp = g.hero.actor.position;
          for (let i = 0; i < 6; i++) d.level!.spawn(300 + f + i, hp.clone().set(hp.x + 5 * Math.cos(i), hp.y, hp.z + 5 * Math.sin(i)), 'normal');
        }
        e.input.setKey('Digit1', f % 120 === 0);
        d.fight(10, f);
        minions = Math.max(minions, d.level!.world.actors.actors.filter((a) => a.owner === d.actor).length);
        tries++;
        try {
          const s = await d.take();
          if (!held && (s.state as LevelSnap).level.state.world.combat.actors.some((a) => a.kind === 'ghost')) held = s;
        } catch (err) {
          refused.push(`${f}: ${(err as Error).message}`);
        }
      }
      e.input.setKey('Digit1', false);
      expect(minions, 'minions at once').toBeGreaterThan(0);
      expect(refused, `${tries} snapshots tried`).toEqual([]);
      expect(held, 'a snapshot holding a ghost').not.toBeNull();
    },
    T,
  );

  it(
    'that moment, restored twice (into the run that went on, then again), plays on the same, with no game errors',
    async () => {
      const e = h.engine;
      await e.restore(held!);
      d.fight(240, 11);
      const a = { print: e.fingerprint(), snap: await d.take() };
      await e.restore(held!);
      d.fight(240, 11);
      expect(e.fingerprint()).toBe(a.print);
      expect(snapDiff(a.snap, await d.take(), PICTURE)).toEqual([]);
      expect(e.state().errors).toEqual([]);
    },
    T,
  );
});
