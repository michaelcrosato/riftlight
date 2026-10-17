// The Riftlight shell end to end, headless (part 2 of the flow e2e `riftlight` keeps one browser
// run of): depth 1 cleared with the basic attack (kill events, XP rising, the boss too) → the
// socketed gems earn XP and level up → gold collected → the portal → the loot window → town,
// autosaved. One engine for the file, tests in order: each starts where the last ended.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import type { RealHero } from '../wire/hero';
import type { RealLoot } from '../wire/loot';
import type { MonsterUnit } from '../wire/monsters';

const T = 30_000;
let h: HeadlessRiftlight;
let boss: { name: string; maxLife: number } | null = null;
const kills: { rank: string; name: string | undefined; byHero: boolean; xp: number; level: number }[] = [];

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242 });
  const { engine, rl } = h;
  rl.newRun(); // on the boot seed, as ?seed=4242 in a page
  await rl.enterDepth(1);
  engine.step(5);
  const b = (rl.game.level!.monsters() as readonly MonsterUnit[]).find((m) => m.rank === 'boss');
  boss = b ? { name: b.name, maxLife: b.actor.maxLife } : null;
  rl.game.events.on('kill', (e) => {
    const hero = rl.state().hero;
    kills.push({ rank: e.rank, name: e.target.name, byHero: e.killer === rl.game.hero.actor, xp: hero.xp, level: hero.level });
  });
}, T);
afterAll(() => h?.engine.dispose());

describe('Riftlight flow: depth 1 cleared, back to town', () => {
  it(
    'kills every monster with the basic attack, the boss too, each death a kill event and XP rising kill by kill',
    () => {
      const { engine, rl } = h;
      expect(rl.state().depth).toBe(1);
      expect(boss, 'a boss spawned on level 1').not.toBeNull();
      const fight = rl.fight({ skills: false, maxFrames: 60 * 150 });
      const rs = fight.state;
      const first = kills[0];
      expect(first?.byHero, 'a monster died to the hero').toBe(true);
      expect(first!.xp > 0 || first!.level > 1, `XP rose (${first?.name}: xp ${first?.xp}, level ${first?.level})`).toBe(true);
      expect(kills.length, 'every death was a kill event').toBe(rs.monsters.killed);
      expect(kills.find((k) => k.rank === 'boss')?.name, 'the boss died too').toBe(boss!.name);
      expect(
        kills.every((k, i) => i === 0 || k.level > kills[i - 1]!.level || k.xp >= kills[i - 1]!.xp),
        'XP only rose kill by kill',
      ).toBe(true);
      expect(rs.monsters.total).toBeGreaterThan(0);
      expect(rs.monsters.killed, `killed every monster (in ${fight.frames} frames)`).toBe(rs.monsters.total);
      expect(rs, 'the level is clear and the portal open').toMatchObject({ cleared: true, exitOpen: true });
      expect(rs.hero.xp > 0 || rs.hero.level > 1, `XP gained (level ${rs.hero.level}, xp ${rs.hero.xp})`).toBe(true);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "every socketed gem earned XP from the kills; a gem levels up with the hero, announced, in the save, the skill panel and the bar",
    () => {
      const { rl } = h;
      const gems = rl.gems();
      const cleave0 = gems.find((g) => g.id === 'cleave');
      expect(cleave0).toBeDefined();
      expect(gems.every((g) => g.xp > 0 || g.level > 1), gems.map((g) => `${g.id} L${g.level} ${g.xp}/${g.next}`).join(', ')).toBe(true);
      const before = rl.gems().find((g) => g.id === 'cleave')!;
      rl.give({ levels: 3 }); // three hero levels' XP: the gem earns it too and meets its next requirement
      const after = rl.gems().find((g) => g.id === 'cleave')!;
      expect(after.level, 'a gem levelled up with the hero').toBeGreaterThan(before.level);
      const notes = rl.log(40).filter((l) => l.type === 'gem').map((l) => l.text);
      expect(notes.some((t) => t.startsWith(`cleave level ${after.level}`)), `the level-up was announced (${notes.join('; ')})`).toBe(true);
      const saved = rl.game.save.hero.skills[0]!.gem!.gem!;
      expect(saved.level, 'the save carries the level').toBe(after.level);
      expect(saved.xp, 'the save carries the XP').toBe(after.xp);
      expect((rl.game.ports.loot as RealLoot).store.skills[0]!.gem!.gem!.level, 'the skill panel carries the level').toBe(after.level);
      const slot = (rl.game.hero as RealHero).hc.slots[0];
      if (slot) {
        expect(slot.id, 'the skill bar re-slotted').toBe('cleave');
        expect(slot.level).toBeGreaterThanOrEqual(after.level);
      }
    },
    T,
  );

  it(
    'collects the gold on the floor',
    () => {
      const { engine, rl } = h;
      const gold0 = rl.state().hero.gold;
      // Leave one pile on the floor (if none is left) so collecting is tested every time.
      const loot = rl.game.ports.loot;
      if (!loot.ground().some((l) => l.drop.kind === 'gold')) {
        const p = rl.game.hero.actor.position.clone();
        p.x += 3;
        loot.spawn([{ kind: 'gold', amount: 17 }], p, rl.game.level!, rl.game.services.rng);
        engine.step(40);
      }
      const rs = rl.collectGold().state;
      expect(rs.loot.gold).toBe(0);
      expect(rs.hero.gold, `collected the gold (${gold0} → ${rs.hero.gold})`).toBeGreaterThan(gold0);
    },
    T,
  );

  it(
    'walks into the portal: the level-clear loot window offers what was left; back in town with depth 1 cleared, autosaved',
    () => {
      const { engine, rl } = h;
      const loot = rl.game.ports.loot;
      const ex = rl.game.level!.exit;
      // leave one item on the floor so the loot window has something to offer
      if (!loot.ground().length) loot.spawn([{ kind: 'item', item: loot.give(rl.game.services.rng, 1)! }], rl.game.hero.actor.position, rl.game.level!, rl.game.services.rng);
      const exit = rl.moveTo(ex.x, ex.z, { radius: 1.2, maxFrames: 2400 });
      const sawWindow = rl.state().ui.includes('loot');
      expect(exit.arrived || sawWindow, `walked into the portal (arrived ${exit.arrived})`).toBe(true);
      expect(sawWindow, 'the level-clear loot window offered what was left on the floor').toBe(true);
      rl.ui.click('takeAll');
      rl.ui.click('leave');
      engine.step(5);
      const rs = rl.state();
      expect(rs).toMatchObject({ screen: 'town', deepest: 1 });
      const slot = rl.slots()[0]!;
      expect(slot.empty, 'autosaved on clear and town entry').toBe(false);
      expect(slot.deepest).toBe(1);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
