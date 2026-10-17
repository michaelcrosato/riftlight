// The passive tree in the game shell, headless (moved from e2e riftlight-items). Without a page
// the tree panel has no view and applies what the player did as the view would send it
// (`{ rl: 'tree', action }` through `ctx.input.send`, ui/tree/actions.ts): P opens it and pauses,
// an allocation moves the hero's stat through the `tree` source, a refund is refused outside the
// respec, Oru refunds for gold, pad B closes. Which canvas pixel is which node, and the view's own
// keys (Escape, P again), stay in the e2e suite. One engine, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../../headless';
import type { TreePanel } from '../../wire/tree';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 777 });
}, T);
afterAll(() => h?.engine.dispose());

const panel = () => h.game.layer.find('tree') as TreePanel;
const allocated = (id: string) => h.game.save.hero.allocated.includes(id);
const act = (action: { kind: 'activate' | 'refund'; id: string }) => {
  h.engine.input.send({ rl: 'tree', action });
  h.engine.step(2);
};

describe('riftlight passive tree', () => {
  let node = { id: '', stat: '', tags: [] as string[] };

  it(
    "P opens the passive tree with the hero's points, the world pauses",
    () => {
      const { rl } = h;
      rl.newRun({ slot: 1, seed: 777 });
      rl.give({ levels: 12, gold: 20000 });
      const rs = rl.press('KeyP');
      expect(rs.ui).toContain('tree');
      expect(rs.paused).toBe(true);
      const st = panel().state!;
      expect(st.points).toBeGreaterThanOrEqual(12);
      const tree = st.tree;
      const near = [...tree.roots].flatMap((r) => tree.neighbours(r)).filter((n) => st.canAllocate(n) && tree.node(n)!.mods.length);
      // a flat mod moves the sheet value itself (an increase to a pure multiplier such as the real
      // hero's damage, which has no base, only scales it)
      const id = near.find((n) => tree.node(n)!.mods[0]!.kind === 'flat') ?? near[0]!;
      const mod = tree.node(id)!.mods[0]!;
      node = { id, stat: mod.stat, tags: [...(mod.tags ?? [])] };
    },
    T,
  );

  it(
    'an allocation lands in the save and the stat changes through the tree source; a refund is refused outside the respec; pad B closes it',
    () => {
      const { rl, engine } = h;
      const before = (rl.hero(node.stat, node.tags) as { value: number }).value;
      act({ kind: 'activate', id: node.id });
      expect(allocated(node.id), `allocates ${node.id}`).toBe(true);
      const after = rl.hero(node.stat, node.tags) as { value: number; sources: { source: string }[] };
      expect(after.value, `${node.stat} moves`).not.toBe(before);
      expect(after.sources.some((x) => x.source === 'tree'), 'through the tree source').toBe(true);
      act({ kind: 'refund', id: node.id });
      expect(allocated(node.id), 'only the mystic refunds').toBe(true);
      expect(rl.press('PadB').ui).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'talking to Oru opens the respec tree; he refunds the node for gold; pad B closes it',
    () => {
      const { rl, game, engine } = h;
      const it = game.town.interactables.find((x) => x.id === 'oru')!;
      game.hero.enter(game.town, it.position.clone(), 0);
      engine.step(2);
      expect(game.interact()).toBe(true);
      engine.step(1);
      expect(rl.state().ui).toContain('tree');
      expect(panel().respec).toBe(true);
      const gold = rl.state().hero.gold;
      act({ kind: 'refund', id: node.id });
      expect(allocated(node.id), 'refunded').toBe(false);
      expect(rl.state().hero.gold, 'for gold').toBeLessThan(gold);
      expect(rl.press('PadB').ui).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
