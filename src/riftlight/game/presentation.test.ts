// Presentation never feeds play (doctrine principle 1): screen shake, damage numbers and sound
// pitch draw from the shell's own presentation stream, so a display setting can't change what a
// seeded run drops. Each setting in a fresh game, the bot playing depth 1 the same way.
import { describe, expect, it } from 'vitest';
import { headlessRiftlight } from '../headless';
import type { Settings } from './settings';

const T = 60_000;

/** What a seeded run of the bot dropped and picked up, with these display settings. */
async function lootWith(settings: Partial<Settings>) {
  const { engine, game, rl } = await headlessRiftlight({ seed: 4242 });
  try {
    Object.assign(game.settings, settings);
    rl.newRun({ seed: 2 });
    await rl.enterDepth(1);
    rl.bot.start();
    rl.bot.advance(1500);
    const { kills, gold, items, found } = rl.bot.report();
    expect(engine.errors).toEqual([]);
    const fx = game.snapshot().fx;
    return { fx, kills, gold, items, found, ground: game.ports.loot.ground().map((l) => `${l.id} ${l.position.toArray().join(',')}`), carried: JSON.stringify(game.ports.loot.peek?.() ?? null) };
  } finally {
    engine.dispose();
  }
}

describe('presentation', () => {
  it(
    "screen shake and damage numbers don't change a seeded run's loot",
    async () => {
      const { fx, ...shown } = await lootWith({ screenShake: 1, damageNumbers: true });
      expect(shown.items + shown.gold, 'the run drops something to compare').toBeGreaterThan(0);
      for (const settings of [{ screenShake: 0, damageNumbers: true }, { screenShake: 1, damageNumbers: false }]) {
        const { fx: drawn, ...run } = await lootWith(settings);
        expect(drawn, `${JSON.stringify(settings)} draws less presentation`).not.toBe(fx);
        expect(run, JSON.stringify(settings)).toEqual(shown);
      }
    },
    3 * T,
  );
});
