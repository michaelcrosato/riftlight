// The bestiary keeps English names whatever the player's language: a save holds no finished words,
// and a session replayed in another language must end on the same fingerprint (docs/game/lang.md).
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { installLanguage, riftlightLines } from '../lang';
import { showcaseOf } from './save';

const T = 90_000;
let h: HeadlessRiftlight | null = null;

afterEach(() => {
  h?.engine.dispose();
  h = null;
  installLanguage(new Lang(riftlightLines()));
});

/** A first fight at depth 1 in `code`: the bestiary's names and the run's fingerprint. */
async function fight(code: string): Promise<{ names: string[]; fingerprint: string }> {
  installLanguage(new Lang(riftlightLines(), {}, { code }));
  h = await headlessRiftlight({ seed: 1 });
  h.rl.newRun({ slot: 0, seed: 7 });
  h.engine.step(30);
  await h.rl.enterDepth(1);
  h.engine.step(5);
  h.rl.killAll();
  h.engine.step(5);
  const out = { names: showcaseOf(h.game.save).bestiary.map((e) => e.name), fingerprint: h.game.fingerprint() };
  h.engine.dispose();
  h = null;
  return out;
}

describe('the bestiary in another language', () => {
  it(
    'records English names, so the run ends on the same fingerprint as in English',
    async () => {
      const english = await fight('en');
      const fake = await fight('en-XA');
      expect(english.names.length).toBeGreaterThan(0);
      expect(fake.names).toEqual(english.names);
      expect(fake.names.join(' ')).not.toMatch(/[[\]áéíóú]/);
      expect(fake.fingerprint).toBe(english.fingerprint);
    },
    T,
  );
});
