// Riftlight headless (headlessRiftlight, docs/game/shell.md *Headless*): the real game in Node, no
// page. One engine for the file (module state outlives an engine), tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIFFICULTY_PRESETS } from './index';
import { type HeadlessRiftlight, headlessRiftlight } from './headless';
import type { TreePanel } from './wire/tree';

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

  it(
    'a mid-level snapshot, restored and played on, keeps the fingerprint',
    async () => {
      const { engine, rl } = h;
      await rl.enterDepth(2);
      rl.bot.start();
      rl.bot.advance(300);
      const saved = JSON.stringify(await engine.snapshot());
      engine.step(240);
      const a = engine.fingerprint();
      await engine.restore(JSON.parse(saved));
      engine.step(240);
      expect(engine.fingerprint()).toBe(a);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the inventory, stash and vendor open and close',
    async () => {
      const { engine, rl } = h;
      rl.newRun({ seed: 2 });
      engine.step(2);
      expect(rl.state().screen).toBe('town');
      for (const id of ['inventory', 'stash', 'vendor'] as const) {
        expect(rl.ui.open(id), id).toBe(true);
        engine.step(2);
        expect(rl.ui.stack(), id).toContain(id);
        rl.ui.close(id);
        engine.step(2);
        expect(rl.ui.stack(), id).not.toContain(id);
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "a tree node allocated by an rl:'tree' command lands in the save",
    async () => {
      const { engine, game, rl } = h;
      rl.newRun({ seed: 3 });
      rl.give({ levels: 3 });
      engine.step(2);
      expect(rl.ui.open('tree')).toBe(true);
      engine.step(1);
      const panel = game.layer.top?.panel as TreePanel;
      expect(panel.id).toBe('tree');
      expect(panel.view, 'no view without a page').toBeNull();
      const pick = treeNodeOneStepAway(panel);
      expect(game.save.hero.allocated).not.toContain(pick);
      engine.input.send({ rl: 'tree', action: { kind: 'activate', id: pick } });
      engine.step(2);
      expect(game.save.hero.allocated).toContain(pick);
      engine.input.send({ rl: 'tree', action: { kind: 'close' } });
      engine.step(2);
      expect(rl.ui.stack()).not.toContain('tree');
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});

/** A node one allocation away from what the panel's state owns. */
function treeNodeOneStepAway(panel: TreePanel): string {
  const state = panel.state!;
  for (const id of state.tree.nodes.map((n) => n.id)) if (!state.isAllocated(id) && state.pathTo(id)?.length === 1) return id;
  throw new Error('no node one step away');
}
