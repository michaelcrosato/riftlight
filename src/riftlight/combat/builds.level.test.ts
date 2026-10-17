// The build systems in the real game headless (was e2e `riftlight-builds`' game checks), level 1
// (Embers): a mechanic affix (with `brazier.selfIgnite` and `brazier.area` a brazier blast sets
// the hero alight instead of hurting it, and reaches a monster outside the normal blast), an
// aura's reservation on the mana globe's vitals, a real monster cursed with Vulnerability (rune
// and tint) and an Arc totem casting in the level. The HUD and the frames stay in e2e. One engine
// for the file, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Vector3 } from 'three/webgpu';
import type { Mod } from '../core/mods';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import type { RealHero } from '../wire/hero';
import type { LevelStage } from '../wire/levels';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4343 });
  h.rl.newRun({ slot: 0, seed: 4343 });
  await h.rl.enterDepth(1);
  h.engine.step(5);
}, T);
afterAll(() => h?.engine.dispose());

describe('the build systems in a real level', () => {
  it(
    'a plain brazier blast hurts the hero; with brazier.selfIgnite it sets the hero alight instead, and brazier.area reaches a monster outside the normal blast',
    () => {
      const { engine: e, game: g, rl } = h;
      const level = (g.level as LevelStage).level;
      const hero = g.hero as RealHero;
      const b = level.plan.elements.find((x) => x.mechanic === 'embers' && x.kind === 'brazier')!;
      expect(b, 'a brazier on depth 1').toBeTruthy();
      const events: string[] = [];
      const relit: Vector3[] = [];
      g.events.on('mechanic', (m) => {
        events.push(m.event);
        if (m.id === 'embers' && m.event === 'relight' && m.at) relit.push(m.at.clone());
      });
      // Monsters hold still: Vorgath's brazier slam detonates braziers too, and one woken by the
      // skip-ahead below can set off this brazier just after it relights (the blast then never comes).
      rl.dev.ai = false;
      const blast = (mods: Mod[]) => {
        hero.setMods('e2e', mods);
        hero.hc.teleport([b.x, 0, b.z + 1.4]);
        const a = hero.actor;
        a.life = a.maxLife;
        const life = a.life;
        // a monster just outside the normal blast (3.2 m)
        const m = rl.spawn({ seed: 7, x: b.x + 4.1, z: b.z, rank: 'normal' });
        const unit = g.level!.monsters().find((u) => u.actor.alive && Math.hypot(u.actor.position.x - b.x - 4.1, u.actor.position.z - b.z) < 0.6);
        const mLife = unit ? unit.actor.life : 0;
        const target = level.targets().find((t) => Math.hypot(t.position.x - b.x, t.position.z - b.z) < 0.1)!;
        target.takeHit({ source: a, tags: ['attack'], damage: { physical: 1 }, crit: false });
        e.step(20);
        return { heroLost: life - a.life, ignited: a.stats.hasCondition('ignited'), monsterLost: unit ? mLife - unit.actor.life : -1, spawned: !!m };
      };
      const plain = blast([]);
      expect(plain.heroLost, 'a plain blast hurts the hero').toBeGreaterThan(0);
      expect(plain.ignited).toBe(false);
      expect(plain.monsterLost, 'a monster outside the normal blast').toBe(0);
      // braziers relight after 18 s: skip ahead until this one has
      const lit = () => relit.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 0.1);
      for (let i = 0; i < 30 * 60 && !lit(); i++) e.step(1);
      expect(lit(), 'the brazier relit').toBe(true);
      const geared = blast([
        { stat: 'brazier.selfIgnite', kind: 'flag', value: 1 },
        { stat: 'brazier.area', kind: 'inc', value: 1 },
      ] as Mod[]);
      expect(geared.heroLost, 'brazier.selfIgnite: no life lost').toBe(0);
      expect(geared.ignited, 'the hero alight').toBe(true);
      expect(events).toContain('selfIgnite');
      expect(geared.monsterLost, 'brazier.area reaches the monster').toBeGreaterThan(0);
    },
    T,
  );

  it(
    'an aura on the real bar: the mana globe gets the reserved share',
    () => {
      const { game: g, rl } = h;
      const hero = g.hero as RealHero;
      hero.hc.setSlot(0, { skill: 'haste-aura' });
      hero.actor.mana = hero.actor.maxMana;
      rl.step(40, { skill: 0 });
      const v = hero.vitals();
      expect(v.reserved).toBeGreaterThan(0);
      expect(v.reserved!).toBeCloseTo(v.maxMana * 0.25, 0);
    },
    T,
  );

  it(
    'a real monster cursed with Vulnerability shows its rune and tint; an Arc totem stands in the level and casts',
    () => {
      const { engine: e, game: g, rl } = h;
      const hero = g.hero as RealHero;
      hero.hc.setSlot(1, { skill: 'vulnerability' });
      hero.hc.setSlot(2, { skill: 'arc', supports: ['spell-totem'] });
      const a = hero.actor;
      a.mana = a.unreservedMana;
      const p = a.position.clone();
      rl.spawn({ seed: 11, x: p.x + 3.5, z: p.z, rank: 'magic' });
      const unit = g
        .level!.monsters()
        .filter((u) => u.actor.alive)
        .sort((u, v) => u.actor.position.distanceTo(p) - v.actor.position.distanceTo(p))[0]!;
      // hold the monsters still (dev AI off): they would walk away
      rl.dev.ai = false;
      const aim = { x: unit.actor.position.x, z: unit.actor.position.z };
      rl.step(20, { skill: 1, aim });
      rl.step(30, { skill: 2, aim });
      e.step(60);
      const ua = unit.actor as RealHero['actor'];
      expect(ua.curses.list.map((c) => c.id)).toContain('vulnerability');
      expect(!!ua.status?.cursed, 'the rune').toBe(true);
      expect(ua.fx.tinted, 'the tint').toBe(true);
      const totem = (g.level as LevelStage).world.actors.actors.find((x) => x.tags.includes('totem') && x.alive);
      expect(totem, 'an Arc totem').toBeTruthy();
      expect((totem!.brain as { casts?: number } | null)?.casts ?? 0, 'its casts').toBeGreaterThan(0);
      expect(e.errors).toEqual([]);
    },
    T,
  );
});
