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
  /** The node under the pad's cursor as a test closed the tree. */
  let left: string | null = null;

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
      // Oru's respec is no character screen: R1 / L1 (E / Q) don't page away from it
      expect(panel().ring).toBe(false);
      expect(rl.press('PadRB').ui, 'R1 keeps the respec tree').toEqual(['tree']);
      expect(rl.press('PadLB').ui, 'L1 keeps the respec tree').toEqual(['tree']);
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

  it(
    "the pad reaches the tree through the engine's input: player 1's pad in use (slot 1) moves its cursor and takes a node, recorded; a couch guest's (slot 0) never does",
    () => {
      const { rl, game, engine } = h;
      const pad = (index: number, pressed: number[] = []) => ({ connected: true, mapping: 'standard', index, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
      /** Button `b` on the pad in `slot` pressed for a frame and let go. */
      const tap = (slot: number, b: number) => {
        engine.input.setGamepads([pad(0, slot === 0 ? [b] : []), pad(1, slot === 1 ? [b] : [])]);
        engine.step(1);
        engine.input.setGamepads([pad(0), pad(1)]);
        engine.step(1);
      };
      engine.input.setGamepads([pad(0), pad(1)]);
      engine.step(1);
      game.coop.join(0); // a couch guest plays on slot 0
      expect(rl.press('KeyP').ui).toEqual(['tree']);
      tap(1, 3); // Triangle on player 1's pad (the stats): the pad in use is slot 1
      expect([engine.input.device, engine.input.padIndex]).toEqual(['pad', 1]);
      const start = panel().debug();
      for (let i = 0; i < 3; i++) tap(0, 15); // the guest's d-pad right
      expect(panel().debug(), "the guest's d-pad moves nothing").toEqual(start);
      for (let i = 0; i < 3; i++) tap(1, 15); // player 1's
      const { hover } = panel().debug();
      expect(hover, "player 1's d-pad steps to a node").toEqual(expect.any(String));
      const st = panel().state!;
      expect(st.pathTo(hover!)?.length, `the path to ${hover} is affordable`).toBeLessThanOrEqual(st.unspent);
      tap(0, 0); // the guest's Cross
      engine.step(2);
      expect(allocated(hover!), "the guest's Cross takes nothing").toBe(false);
      tap(1, 0); // player 1's
      engine.step(2);
      expect(allocated(hover!), "player 1's Cross takes it").toBe(true);
      left = hover;
      const sent = engine.recording()!.frames.flatMap((f) => (f.commands ?? []) as { rl?: string; action?: { kind: string; id?: string } }[]);
      expect(sent.filter((c) => c.rl === 'tree').map((c) => c.action), 'what the pad did to the tree is recorded').toContainEqual({ kind: 'activate', id: hover });
      expect(rl.press('PadB').ui).toEqual([]);
      game.coop.leave(2);
      engine.input.setGamepads(null);
      engine.input.noteDevice('keyboard');
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'opened with the pad in use (Pause → Passive tree, R1 from another screen) its cursor is on a node at once: the start, then the node hovered last; Cross takes it',
    () => {
      const { rl, game, engine } = h;
      const pad = (pressed: number[] = []) => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
      const tap = (b: number) => {
        engine.input.setGamepads([pad([b])]);
        engine.step(1);
        engine.input.setGamepads([pad()]);
        engine.step(1);
      };
      engine.input.setGamepads([pad()]);
      engine.step(1);
      tap(9); // Options: the pause menu, the pad in use
      expect(rl.state().ui).toEqual(['pause']);
      expect(engine.input.device).toBe('pad');
      expect(rl.ui.click('tree')).toBe(true);
      expect(rl.state().ui).toEqual(['pause', 'tree']);
      // the node the last test left the cursor on (where the pad's cursor starts with none: view.test.ts)
      const start = panel().debug().hover;
      expect(start, 'a node under the cursor at once, no stick or d-pad yet').toBe(left);
      // the d-pad steps off the start to a node to take, and Cross takes it
      let next: string | null = start;
      for (let i = 0; i < 6 && (next === start || allocated(next!) || !panel().state!.canAllocate(next!)); i++) {
        tap(15);
        next = panel().debug().hover;
      }
      expect(panel().state!.canAllocate(next!), `${next} can be taken`).toBe(true);
      tap(0); // Cross
      engine.step(2);
      expect(allocated(next!), 'Cross takes the node under the cursor').toBe(true);
      tap(1); // Circle: back to the pause menu
      expect(rl.state().ui).toEqual(['pause']);
      tap(9);
      // another screen, then R1 round the ring to the tree: the cursor where it was left
      tap(8); // Create: the inventory
      expect(rl.state().ui).toEqual(['inventory']);
      tap(5); // R1: skills
      tap(5); // R1: the tree
      expect(rl.state().ui).toEqual(['tree']);
      expect(panel().debug().hover, 'the node hovered last').toBe(next);
      tap(1);
      expect(rl.state().ui).toEqual([]);
      engine.input.setGamepads(null);
      engine.input.noteDevice('keyboard');
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
