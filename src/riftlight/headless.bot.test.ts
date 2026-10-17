// The playtest bot clears depth 1 headless (its own file: a whole level, the slowest headless test).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIFFICULTY_PRESETS } from './index';
import { type HeadlessRiftlight, headlessRiftlight } from './headless';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight();
}, T);
afterAll(() => h?.engine.dispose());

describe('Riftlight headless', () => {
  it(
    'the bot clears depth 1 (seed 1) with no hook errors',
    async () => {
      const { engine, rl } = h;
      rl.newRun({ seed: 1 });
      rl.setDifficulty({ ...DIFFICULTY_PRESETS.normal });
      await rl.enterDepth(1);
      rl.bot.start();
      const { report } = rl.bot.advance(10800);
      expect(report).toMatchObject({ depth: 1, cleared: true, deaths: 0 });
      expect(report.kills).toBeGreaterThan(20);
      expect(engine.errors).toEqual([]);
      expect(engine.state().backend).toBe('headless');
    },
    T,
  );

});
