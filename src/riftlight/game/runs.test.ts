// A seed plays the same whatever ran before it in the game (doctrine principle 1): a new run
// starts from what setup left (`Riftlight.startRun`: the hero, the loot, the town, the id
// counters, the shell's run fields), not from what the last run left behind. Seed 2 alone, then
// seed 2 after a run of seed 1 that opened the inventory, was given items, fought, went home and
// loitered in town: the town right after, gifts, a pickup, and the bot on depth 1 the same.
import { describe, expect, it } from 'vitest';
import type { Item } from '../core/types';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import type { Drop } from './ports';

const T = 60_000;
const belt = { uid: 'runs-belt', base: 'leather-belt', rarity: 'normal', level: 1, name: 'Leather Belt', affixes: [] } as unknown as Item;

async function seed2(before?: (h: HeadlessRiftlight) => Promise<void>) {
  const h = await headlessRiftlight({ seed: 4242 });
  const { engine, game, rl } = h;
  try {
    await before?.(h);
    rl.newRun({ seed: 2 });
    engine.step(2);
    const town = game.fingerprint();
    rl.give({ items: 2 });
    const gifts = JSON.stringify(game.ports.loot.peek?.() ?? null);
    // gold, then an item, picked up where the hero stands
    const pick = (drop: Drop) => {
      const [l] = game.ports.loot.spawn([drop], game.hero.actor.position.clone(), game.town, game.services.rng.fork('runs'));
      engine.step(45); // it lands
      game.pickup(l!);
    };
    pick({ kind: 'gold', amount: 50 });
    pick({ kind: 'item', item: belt });
    const gold = game.save.hero.gold;
    await rl.enterDepth(1);
    rl.bot.start();
    rl.bot.advance(1500);
    expect(engine.errors).toEqual([]);
    return { town, gifts, gold, report: rl.bot.report(), fingerprint: game.fingerprint() };
  } finally {
    engine.dispose();
  }
}

describe('runs', () => {
  it(
    'a seed played after another run starts, gives, picks up and plays as the seed alone',
    async () => {
      const alone = await seed2();
      expect(alone.report.kills, 'the bot fights').toBeGreaterThan(0);
      expect(alone.gold, 'the gold picked up').toBe(50);
      const after = await seed2(async ({ engine, rl }) => {
        rl.newRun({ seed: 1 });
        rl.ui.open('inventory'); // an item window hooks the loot up to the shell
        engine.step(2);
        rl.ui.close();
        rl.give({ items: 3 });
        await rl.enterDepth(1);
        rl.bot.start();
        rl.bot.advance(600);
        rl.toTown();
        engine.step(240); // the town lives on: townsfolk walk, the cat roams, the day turns
      });
      expect(after.town, 'the town after newRun').toBe(alone.town);
      expect(after.gifts, 'what give hands out').toBe(alone.gifts);
      expect(after.gold, 'gold kept after an item pickup').toBe(alone.gold);
      expect(after.report).toEqual(alone.report);
      expect(after.fingerprint).toBe(alone.fingerprint);
    },
    2 * T,
  );
});
