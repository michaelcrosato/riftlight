// The skill bar is the sockets, in the real game headless: a bar the player emptied in the skills
// window stays empty (the basic attack only; the gems are in the bag), through a level-up and a
// reload. Only a hero with no sockets at all gets gems it never socketed: an old save's starter
// gems (the loot port sockets them), and an old save's old gem ids are renamed, not lost.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Item, SaveData } from '../core/types';
import { newSave, SaveStore } from '../game/save';
import { type HeadlessRiftlight, headlessRiftlight, pointAtArt } from '../headless';
import { STARTER_GEMS } from '../loot/sockets';
import type { RealLoot } from './loot';

const T = 30_000;
const store = new SaveStore(null); // the saves outlive the first engine: a reload
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 31, store });
}, T);
afterAll(() => h?.engine.dispose());

const loot = () => h.game.ports.loot as RealLoot;
/** The bar's four skill ids (null: an empty slot). */
const bar = () =>
  h.game.hero
    .skills()
    .filter((k) => typeof k.slot === 'number')
    .map((k) => k.id);
const sockets = () => h.game.save.hero.skills.map((x) => x.gem?.gem?.id ?? null);
const bagGems = () =>
  loot()
    .store.state.inventory.items.map((p) => p.item.gem?.id)
    .filter(Boolean)
    .sort();
const gem = (id: string, level: number, support = false): Item => ({ uid: `old-${id}`, base: support ? 'support-gem' : 'skill-gem', rarity: 'normal', level: 1, name: id, affixes: [], gem: { id, level, support } });

describe('the skill bar is the sockets', () => {
  it(
    'every socket emptied in the skills window: no skills (the gems in the bag), after a level-up and a reload too',
    async () => {
      const { rl, game, engine } = h;
      rl.newRun({ slot: 0, seed: 31 });
      expect(bar()).toEqual([...STARTER_GEMS]);
      expect(rl.press('KeyG').ui.join()).toBe('skills');
      engine.step(1);
      for (let slot = 0; slot < 4; slot++) {
        // the pointer over the socket, Enter takes the cursor there, X takes the gem out (as a pad player does)
        const at = loot().ui!.socketCenter(slot, -1);
        pointAtArt(engine, at.x, at.y);
        engine.step(2);
        rl.press('Enter');
        rl.press('PadX');
      }
      expect(sockets(), 'every socket is empty').toEqual([null, null, null, null]);
      expect(bagGems(), 'the gems went back into the bag').toEqual([...STARTER_GEMS].sort());
      expect(bar(), 'the bar is empty: no free gems').toEqual([null, null, null, null]);
      expect(rl.press('Escape').ui).toEqual([]);
      rl.give({ levels: 3 }); // a level-up re-levels a default bar: this one is not
      expect(game.save.hero.level).toBeGreaterThan(1);
      expect(bar()).toEqual([null, null, null, null]);
      rl.save(0);
      expect(engine.errors).toEqual([]);
      engine.dispose();
      h = await headlessRiftlight({ seed: 31, store });
      h.engine.step(2);
      h.rl.continueRun(0);
      expect(sockets(), 'reloaded: still empty').toEqual([null, null, null, null]);
      expect(bar()).toEqual([null, null, null, null]);
      expect(bagGems()).toEqual([...STARTER_GEMS].sort());
      expect(h.engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'an old save with no sockets gets the starter gems socketed; old gem ids are renamed, not lost',
    () => {
      const old = newSave(5) as unknown as { hero: Record<string, unknown> };
      delete old.hero.skills; // from before sockets
      store.save(1, old as unknown as SaveData);
      h.rl.continueRun(1);
      expect(sockets(), 'the starter gems, socketed').toEqual([...STARTER_GEMS]);
      expect(bar()).toEqual([...STARTER_GEMS]);
      const renamed = newSave(6);
      renamed.hero.skills = [{ slot: 2, gem: gem('ice-nova', 5), supports: [gem('multiple-projectiles', 2, true)] }];
      store.save(2, renamed);
      h.rl.continueRun(2);
      expect(sockets(), 'ice-nova is frost-nova now').toEqual([null, null, 'frost-nova', null]);
      expect(h.game.save.hero.skills[2]!.supports.map((g) => g?.gem?.id ?? null)).toEqual(['gmp', null, null]);
      expect(bar(), 'and the rest of the bar stays empty').toEqual([null, null, 'frost-nova', null]);
      expect(h.game.save.hero.skills[2]!.gem?.gem?.level, 'at its level').toBe(5);
      expect(h.engine.errors).toEqual([]);
    },
    T,
  );
});
