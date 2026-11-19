// The item windows on phones (touch), headless (moved from e2e riftlight-items): on a 390×844 and a
// 360×800 phone held upright and a 740×360 and an 844×390 one held sideways, every window fits
// the art screen without overlapping (a 740×360 phone's 180 rows: the short inventory), and back
// closes the passive tree. The pictures, the taps and the tree's own canvas size stay in the e2e suite.
import { afterEach, describe, expect, it } from 'vitest';
import type { Viewport } from '../../../engine';
import { type HeadlessRiftlight, headlessRiftlight } from '../../headless';
import type { RealLoot } from '../../wire/loot';

const T = 30_000;
let h: HeadlessRiftlight | null = null;
afterEach(() => {
  h?.engine.dispose();
  h = null;
});

const PHONES: readonly { name: string; viewport: Viewport }[] = [
  { name: '390×844 upright', viewport: { width: 390, height: 844, dpr: 1 } },
  { name: '360×800 upright', viewport: { width: 360, height: 800, dpr: 3 } },
  { name: '740×360 sideways', viewport: { width: 740, height: 360, dpr: 2 } },
  { name: '844×390 sideways', viewport: { width: 844, height: 390, dpr: 2 } },
];

describe('the item windows on a phone', () => {
  for (const phone of PHONES)
    it(
      `${phone.name}: the inventory, stash, vendor, crafting and skills windows fit the screen without overlapping; back closes the tree`,
      async () => {
        h = await headlessRiftlight({ seed: 777, viewport: phone.viewport, options: { touch: true } });
        const { engine, game, rl } = h;
        rl.newRun({ slot: 2, seed: 99 });
        rl.give({ levels: 5, items: 4 });
        (game.ports.loot as RealLoot).add({ uid: 'p-orb', base: 'ember-bead', rarity: 'normal', level: 1, name: 'Ember Bead', affixes: [], quantity: 4 });
        const res = engine.renderer.resolution;
        const upright = phone.viewport.width < phone.viewport.height;
        expect(res.width < res.height, `an art screen ${upright ? 'upright' : 'sideways'}`).toBe(upright);
        if (phone.viewport.height === 360) expect(res.height, 'a 740×360 phone: 180 rows, fewer than the whole inventory’s').toBe(180);
        for (const view of ['inventory', 'stash', 'vendor', 'crafting', 'skills'] as const) {
          expect(rl.ui.open(view), view).toBe(true);
          engine.step(2);
          const rects = (game.ports.loot as RealLoot).ui!.rects();
          const where = `${view} on ${res.width}x${res.height}: ${rects.map((r) => `${r.x},${r.y} ${r.w}x${r.h}`).join(' / ')}`;
          expect(rects.length, where).toBeGreaterThan(0);
          expect(
            rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= res.width && r.y + r.h <= res.height),
            `inside: ${where}`,
          ).toBe(true);
          const [a, b] = rects;
          const overlap = rects.length === 2 && a!.x < b!.x + b!.w && b!.x < a!.x + a!.w && a!.y < b!.y + b!.h && b!.y < a!.y + a!.h;
          expect(overlap, `no overlap: ${where}`).toBe(false);
          // a phone keeps its compact layouts (the mini font where it fits; the skill panel the bag's width)
          expect((game.ports.loot as RealLoot).ui!.tenFoot(), `${where}: compact`).toBe(false);
          expect(Math.max(...rects.map((r) => r.w)), where).toBeLessThanOrEqual(128);
          expect(rl.state().ui, view).toHaveLength(1);
          rl.ui.close();
          engine.step(1);
        }
        rl.ui.open('tree');
        engine.step(2);
        expect(rl.state().ui).toEqual(['tree']);
        expect(rl.press('PadB').ui, 'back closes the tree').toEqual([]);
        expect(engine.errors).toEqual([]);
      },
      T,
    );
});
