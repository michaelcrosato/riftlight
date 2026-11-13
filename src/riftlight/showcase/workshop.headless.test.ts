// The Engine Workshop in Emberfall (showcase/townProps.ts): its trip to Engine World never loses
// the run, and the prompt over it fits its words and stays clear of the orbs.
import { describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { type KeyValueStore, SaveStore } from '../game/save';
import { miniWidth } from '../ui/kit';
import type { Viewport } from '../../engine';

const T = 60_000;

class Storage implements KeyValueStore {
  readonly map = new Map<string, string>();
  fail = false;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

async function inTown(store: SaveStore, viewport?: Viewport): Promise<HeadlessRiftlight> {
  const h = await headlessRiftlight({ seed: 5, store, viewport });
  h.rl.newRun({ slot: 0, seed: 5 });
  h.engine.step(5);
  expect(h.rl.state().screen).toBe('town');
  return h;
}

const feed = (h: HeadlessRiftlight): string[] => (h.game as unknown as { feed: { text: string }[] }).feed.map((f) => f.text);

describe('the Engine Workshop never loses the run', () => {
  it(
    'with storage working the run is saved and the game goes',
    async () => {
      const storage = new Storage();
      const h = await inTown(new SaveStore(storage));
      storage.map.clear();
      expect(h.game.engineWorld('gallery')).toBe(true);
      expect([...storage.map.keys()].length, 'the run written before leaving').toBeGreaterThan(0);
      h.engine.dispose();
    },
    T,
  );

  it(
    'a failed write keeps the hero in town (the storage toast says why)',
    async () => {
      const storage = new Storage();
      const h = await inTown(new SaveStore(storage));
      storage.fail = true;
      expect(h.game.engineWorld()).toBe(false);
      expect(h.rl.state().screen).toBe('town');
      h.engine.dispose();
    },
    T,
  );

  it(
    'saves that live only in this page keep the hero in town, and the feed says storage is blocked',
    async () => {
      const h = await inTown(new SaveStore(null));
      expect(h.game.engineWorld()).toBe(false);
      expect(feed(h)[0]).toBe('Storage blocked: saves last this session');
      // the title holds no run: it goes
      h.engine.dispose();
    },
    T,
  );
});

describe('the prompt fits its words and keeps off the orbs', () => {
  for (const viewport of [undefined, { width: 960, height: 720 }, { width: 640, height: 360 }, { width: 390, height: 844 }] as (Viewport | undefined)[]) {
    it(
      `at ${viewport ? `${viewport.width}×${viewport.height}` : 'the default size'}`,
      async () => {
        const h = await inTown(new SaveStore(new Storage()), viewport);
        const game = h.game as unknown as { ui: { w: number; measure(s: string): number }; prompt(l: string, s?: string): void; hudLayout: { taken: { x: number; y: number; w: number; h: number }[]; clear(w: number, h: number): void } };
        const zones = h.game.hudRects().zones.filter((z) => z.id === 'life' || z.id === 'mana');
        const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        for (const sub of ['Blacksmith', 'The engine’s tech demo: a room per technique', 'Every model and texture, one at a time, on a turntable']) {
          game.hudLayout.clear(game.ui.w, 1000);
          game.prompt('Step into Engine World', sub);
          const box = game.hudLayout.taken.at(-1)!;
          const shown = Math.min(game.ui.measure(sub), miniWidth(sub), game.ui.w - 12);
          expect(box.w, `${sub}: the box holds its line`).toBeGreaterThanOrEqual(shown);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).toBeLessThanOrEqual(game.ui.w);
          for (const z of zones) expect(overlaps(box, z), `${sub}: clear of the ${z.id} orb`).toBe(false);
        }
        h.engine.dispose();
      },
      T,
    );
  }
});
