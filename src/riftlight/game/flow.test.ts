// The Riftlight shell end to end, headless (part 1 of the flow that e2e `riftlight` keeps one
// browser run of): title → New Run by keys → town → a walk to every district of the outskirts
// and back → a Blink stops at the town's walls → Vex → the rift menu → depth 1. One engine for
// the file (module state outlives an engine), tests in order: each starts where the last ended.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight, stepUntil } from '../headless';
import type { RealHero } from '../wire/hero';
import type { MonsterUnit } from '../wire/monsters';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242 });
}, T);
afterAll(() => h?.engine.dispose());

describe('Riftlight flow: title to depth 1', () => {
  it(
    'opens on the title screen; Enter on New Run opens the slot picker, Enter on slot 1 starts a run in town',
    () => {
      const { engine, rl } = h;
      let rs = rl.state();
      expect(rs.screen).toBe('title');
      expect(rs.ui).toContain('title');
      engine.step(20);
      rs = rl.press('Enter');
      expect(rs.ui, 'Enter on New Run opens the slot picker').toContain('slots');
      rs = rl.press('Enter');
      expect(rs).toMatchObject({ screen: 'town', deepest: 0 });
      expect(rs.hero.level).toBe(1);
      expect(rl.game.save.seed, "the boot seed is the run's, as ?seed= is in a page").toBe(4242);
      engine.step(30);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'walks on to every district of the outskirts and back to the plaza',
    () => {
      const { rl } = h;
      const town = rl.game.town;
      const ids = Object.keys(town.districts);
      expect(ids.length).toBe(8);
      for (const [id, p] of Object.entries(town.districts)) {
        const r = rl.moveTo(p.x, p.z, { radius: 0.9, maxFrames: 1500 });
        expect(r.arrived, `walks on to the ${id} (${r.frames} frames, at ${r.state.hero.position.map((v) => v.toFixed(1)).join(', ')})`).toBe(true);
      }
      expect(rl.moveTo(town.spawn.x, town.spawn.z, { radius: 0.6, maxFrames: 1500 }).arrived, 'and back to the plaza').toBe(true);
    },
    T,
  );

  it(
    "a Blink in town stops at walls: the hero's combat asks the town (from the Old Watch's courtyard north through its wall)",
    () => {
      const { rl } = h;
      const town = rl.game.town;
      const from = town.districts.watch!.clone().setY(0.5);
      const to = from.clone().add({ x: -7, y: 0, z: -7 }); // up the screen, 10 m, past the wall
      const combat = (rl.game.hero as RealHero).hc.combat.wall(from, to);
      expect(combat).not.toBeNull();
      expect(combat).toBe(town.wall(from, to));
      expect(combat!).toBeLessThan(1);
    },
    T,
  );

  it(
    'walk to Vex, talk: the rift menu opens; Enter on its first entry enters depth 1 "Embers" with real monsters and a boss',
    async () => {
      const { engine, rl } = h;
      const talk = rl.talkTo('vex');
      expect(talk.ok).toBe(true);
      expect(talk.state.ui).toContain('rift');
      rl.press('Enter'); // the first entry is the next depth: I · EMBERS
      await stepUntil(engine, () => rl.state().screen === 'level', { what: 'the level screen' });
      engine.step(5);
      const rs = rl.state();
      expect(rs).toMatchObject({ depth: 1, levelName: 'Embers' });
      expect(rs.monsters.total).toBeGreaterThan(0);
      expect(rs.codex, 'the codex unlocked the level mechanic').toContain('embers');
      const ms = rl.game.level!.monsters() as readonly Partial<MonsterUnit>[];
      expect(ms.filter((m) => typeof m.runtime?.play === 'function' && m.genome).length, 'every monster is a real animated genome').toBe(ms.length);
      const boss = ms.find((m) => m.rank === 'boss');
      expect(boss, 'a boss spawned on level 1').toBeDefined();
      expect(boss!.actor!.alive).toBe(true);
      expect(boss!.actor!.maxLife).toBeGreaterThan(0);
      expect(boss!.actor!.life).toBe(boss!.actor!.maxLife);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
