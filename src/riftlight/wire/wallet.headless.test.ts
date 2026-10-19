// The loot port and the shell share one wallet: the shell's (`save.hero.gold`). The item
// windows' store copies it before each frame of a window (`RealLoot.sync`) and hands back only
// what it changed itself (a buy, a sale), so a pickup between windows never undoes gold picked
// up since.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Item } from '../core/types';
import type { Drop } from '../game/ports';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { buyPrice } from '../loot/vendor';
import type { RealLoot } from './loot';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242 });
}, T);
afterAll(() => h?.engine.dispose());

const belt = { uid: 'wallet-belt', base: 'leather-belt', rarity: 'normal', level: 1, name: 'Leather Belt', affixes: [] } as unknown as Item;

describe('the wallet', () => {
  it(
    'gold picked up after a window was open stays when an item is picked up',
    () => {
      const { engine, game, rl } = h;
      rl.newRun({ seed: 3 });
      rl.ui.open('inventory');
      engine.step(2);
      rl.ui.close();
      const pick = (drop: Drop) => {
        const [l] = game.ports.loot.spawn([drop], game.hero.actor.position.clone(), game.town, game.services.rng.fork('wallet'));
        engine.step(45); // it lands
        expect(game.pickup(l!)).toBe(true);
      };
      pick({ kind: 'gold', amount: 50 });
      expect(game.save.hero.gold).toBe(50);
      pick({ kind: 'item', item: belt });
      expect(game.save.hero.gold, 'after the item').toBe(50);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "a buy costs its price, whatever the shell's wallet gained since the window's last frame",
    () => {
      const { engine, game } = h;
      game.addGold(1000);
      const ilsa = game.town.interactables.find((x) => x.id === 'ilsa')!;
      game.hero.enter(game.town, ilsa.position.clone(), 0);
      engine.step(2);
      expect(game.interact(), 'F at Ilsa').toBe(true);
      engine.step(2);
      const loot = game.ports.loot as RealLoot;
      const ware = loot.store.vendor.stock[0]!;
      const before = game.save.hero.gold;
      game.addGold(100); // a pickup this frame, after the window's last sync
      const at = loot.ui!.itemCenter(ware.uid)!;
      loot.ui!.primary(at.x, at.y, { ctrl: false, shift: false });
      expect(game.save.hero.gold).toBe(before + 100 - buyPrice(ware));
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
