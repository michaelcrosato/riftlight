// The item windows on a portrait phone (390×844 at DPR 1, touch), headless (moved from e2e
// riftlight-items): every window fits the art screen without overlapping, and back closes the
// passive tree. The pictures, the taps and the tree's own canvas size stay in the e2e suite.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../../headless';
import type { RealLoot } from '../../wire/loot';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 777, viewport: { width: 390, height: 844, dpr: 1 }, options: { touch: true } });
}, T);
afterAll(() => h?.engine.dispose());

it(
  'phone: the inventory, stash, vendor, crafting and skills windows fit the screen without overlapping; back closes the tree',
  () => {
    const { engine, game, rl } = h;
    rl.newRun({ slot: 2, seed: 99 });
    rl.give({ levels: 5, items: 4 });
    (game.ports.loot as RealLoot).add({ uid: 'p-orb', base: 'ember-bead', rarity: 'normal', level: 1, name: 'Ember Bead', affixes: [], quantity: 4 });
    const res = engine.renderer.resolution;
    expect(res.width, 'a portrait art screen').toBeLessThan(res.height);
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
