// Under the test language (`en-XA`: every line bracketed and accented), what a level shows from
// the monsters and levels systems is made of lines: every monster's name (the boss bar, the death
// screen's killer), a designed boss's and a rift boss's, the codex the level port gives, the
// level's name. Plain Latin letters left outside brackets are words that aren't lines.
import { afterAll, describe, expect, it } from 'vitest';
import { strays as straysIn } from '../../../scripts/lang-strays.mjs';
import { Lang } from '../../engine';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { installLanguage, riftlightLines } from './index';
import { levelName } from './levels';
import { bossNameParts } from '../monsters/bosses/names';
import { unitOf } from '../wire/monsters';

const T = 60_000;
/** Words that aren't lines (scripts/lang-strays.mjs: the audit's test); proper names aside. */
const strays = (text: string, more: readonly string[] = []) => straysIn(text, [...riftlightLines().names, ...more]);

let h: HeadlessRiftlight | null = null;
afterAll(() => {
  h?.engine.dispose();
  installLanguage(new Lang(riftlightLines()));
});

describe('a level under en-XA', () => {
  it(
    'monster and boss names, the codex and the level name are lines, a designed level and a rift alike',
    async () => {
      installLanguage(new Lang(riftlightLines(), {}, { code: 'en-XA' }));
      h = await headlessRiftlight({ seed: 4242 });
      h.rl.newRun();
      for (const depth of [1, 13]) {
        await h.rl.enterDepth(depth);
        const level = h.rl.game.level!;
        const names = level.monsters().map((m) => m.name);
        expect(names.length).toBeGreaterThan(3);
        expect(names.filter((n) => n !== level.monsters().find((m) => m.rank === 'boss')?.name && strays(n).length), `depth ${depth}: monster names`).toEqual([]);
        const boss = level.monsters().find((m) => m.rank === 'boss');
        expect(boss, `depth ${depth} has a boss`).toBeDefined();
        expect(boss!.name).toMatch(/^\[/);
        // a rift boss's invented name is made at run time and stays as it is (a proper name, filled in)
        const invented = bossNameParts(unitOf(boss!.actor)?.boss?.name ?? '')?.name;
        expect(strays(boss!.name, invented ? [invented] : []), boss!.name).toEqual([]);
        expect(strays(levelName(level.spec)), levelName(level.spec)).toEqual([]);
      }
      const codex = h.rl.game.ports.levels.mechanics().flatMap((m) => [m.name, m.description, m.bypass, m.exploit]);
      expect(codex.filter((s) => strays(s).length)).toEqual([]);
    },
    T,
  );
});
