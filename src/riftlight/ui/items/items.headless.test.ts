// The real loot and skill windows in the game shell, headless (moved from e2e riftlight-items):
// a boss's drops, the loot filter, F to pick up, the inventory by mouse (right-click equips, the
// StatSheet follows), Esc / pause / pad routes, gems socketed and taken out, Ilsa's wares and gems
// tab, Brann's anvil, the stash (Ctrl-click, drag and drop) and save → reboot → Continue. The
// mouse is the engine's (`pointAtArt`, `setButtons`), as the canvas would hand it over; the
// pictures of each window stay in the e2e suite. One engine at a time, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight, pointAtArt } from '../../headless';
import { SaveStore } from '../../game/save';
import type { TreePanel } from '../../wire/tree';
import type { Item } from '../../core/types';
import type { RealLoot } from '../../wire/loot';
import type { GroundDrop } from '../../loot/world';

const T = 30_000;
const store = new SaveStore(null); // the saves outlive the first engine: a reload
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 777, store });
}, T);
afterAll(() => h?.engine.dispose());

const loot = () => h.game.ports.loot as RealLoot;
const ui = () => loot().ui!;
const bag = () => loot().store.state.inventory.items;
const inBag = (uid: string) => bag().some((p) => p.item.uid === uid);
const stack = () => h.rl.state().ui;
const heroStat = (stat: string) => h.rl.hero(stat) as { value: number; sources: { source: string }[] };
const bar = () =>
  h.game.hero
    .skills()
    .filter((k) => typeof k.slot === 'number')
    .map((k) => ({ id: k.id, name: k.name, cost: k.cost }));

/** The mouse to an art pixel, a button pressed and let go there (bits: 1 left, 2 right), as a click on the canvas. */
function click(at: { x: number; y: number } | null, bits = 1, o: { ctrl?: boolean } = {}): void {
  if (!at) throw new Error('click: nowhere to click');
  const { engine } = h;
  if (o.ctrl) engine.input.setKey('ControlLeft', true);
  pointAtArt(engine, at.x, at.y);
  engine.step(1);
  engine.input.setButtons(bits);
  engine.step(1);
  engine.input.setButtons(0);
  engine.step(1);
  if (o.ctrl) engine.input.setKey('ControlLeft', false);
  engine.step(1);
}

/** Stand at a townsperson (or the chest) and press F, as e2e's talkTo did (the core suite walks there). */
function talkTo(id: string): string[] {
  const g = h.game;
  const it = g.town.interactables.find((x) => x.id === id)!;
  g.hero.enter(g.town, it.position.clone(), 0);
  h.engine.step(2);
  expect(g.interact(), `F at ${id}`).toBe(true);
  h.engine.step(1);
  return stack();
}

const uidOf = (d: { kind: string; item?: Item }) => (d.kind === 'item' ? d.item?.uid : undefined);
const item = (o: Partial<Item> & Pick<Item, 'uid' | 'base'>): Item => ({ rarity: 'normal', level: 1, name: o.base, affixes: [], ...o }) as Item;

describe('riftlight items: loot, inventory, skills, vendor, crafting, stash', () => {
  it(
    'a new run sockets the starter gems and the skill bar shows them',
    () => {
      const { rl, game } = h;
      rl.newRun({ slot: 1, seed: 777 });
      expect(game.save.hero.skills.map((x) => x.gem?.gem?.id ?? null).join()).toBe('cleave,frost-nova,dash,war-cry');
      expect(bar().map((k) => k.name).join()).toBe('Cleave,Frost Nova,Dash,War Cry');
      rl.give({ levels: 12, gold: 20000 });
    },
    T,
  );

  it(
    'a boss kill drops real items (a rare or better, with a beam and a pool light); the loot filter and Alt; F picks the nearest up',
    async () => {
      const { rl, game: g, engine } = h;
      await rl.enterDepth(1);
      engine.step(5);
      for (const m of g.level!.monsters()) m.actor.life = 0.001; // the level's own pack: keep them out of the way
      const p = g.hero.actor.position;
      rl.spawn({ seed: 31, x: p.x + 1.5, z: p.z, rank: 'boss' });
      rl.killAll();
      engine.step(45); // the drops arc out and land
      const items = loot()
        .ground()
        .filter((l) => l.drop.kind === 'item');
      expect(items.length).toBeGreaterThan(0);
      const uids = items.map((l) => uidOf(l.drop));
      expect(new Set(uids).size, 'each kill drops once (no twin items)').toBe(uids.length);
      expect(items.some((l) => l.drop.kind === 'item' && (l.drop.item.rarity === 'rare' || l.drop.item.rarity === 'unique')), 'a rare or better').toBe(true);
      expect(items.some((l) => !!(l as unknown as { ground: GroundDrop }).ground.beam), 'a beam').toBe(true);
      expect(engine.lights.describe().filter((r) => r.name === 'loot beam' && r.alive).length, 'loot lights from the pool').toBeGreaterThan(0);

      // the loot filter follows the setting (2 = rares only; currency and gems always show) and Alt
      loot().spawn([{ kind: 'item', item: item({ uid: 'e2e-normal-belt', base: 'leather-belt' }) }, { kind: 'item', item: item({ uid: 'e2e-ground-orb', base: 'ember-bead' }) }], g.hero.actor.position.clone(), g.level!, g.services.rng);
      engine.step(30);
      const hidden = () =>
        loot()
          .ground()
          .filter((l) => l.filtered)
          .map((l) => uidOf(l.drop));
      expect(hidden(), 'show all').not.toContain('e2e-normal-belt');
      g.settings.lootFilter = 2;
      expect(hidden(), 'rares only').toContain('e2e-normal-belt');
      expect(hidden(), 'rares only: currency shows').not.toContain('e2e-ground-orb');
      rl.press('AltLeft');
      expect(hidden(), 'Alt shows everything').toEqual([]);
      rl.press('AltLeft');
      expect(hidden(), 'Alt again').toContain('e2e-normal-belt');
      g.settings.lootFilter = 0;

      const target = loot()
        .ground()
        .find((l) => l.drop.kind === 'item' && !l.filtered)!;
      rl.moveTo(target.position.x, target.position.z, { radius: 0.5 });
      const before = loot().counts().inventory;
      const lying = loot()
        .ground()
        .map((l) => uidOf(l.drop));
      expect(rl.interact().ok).toBe(true);
      const gone = lying.filter((uid) => uid && !loot().ground().some((l) => uidOf(l.drop) === uid));
      expect(gone.length, 'one item left the ground').toBe(1);
      expect(inBag(gone[0]!), 'into the bag').toBe(true);
      expect(loot().counts().inventory).toBe(before + 1);
      rl.toTown();
      engine.step(5);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "I opens the inventory, the town keeps running; right-click equips the belt and the hero's StatSheet changes",
    () => {
      const { rl, engine } = h;
      // a known magic belt, so the stat change is certain
      loot().add(item({ uid: 'e2e-belt', base: 'leather-belt', rarity: 'magic', level: 5, name: 'Hale Leather Belt', affixes: [{ id: 'life', tier: 0, mods: [{ stat: 'life', kind: 'flat', value: 25 }] }] } as Partial<Item> & Pick<Item, 'uid' | 'base'>));
      const rs = rl.press('KeyI');
      expect(rs.ui).toContain('inventory');
      expect(rs.paused).toBe(false);
      const lifeBefore = heroStat('life').value;
      click(ui().itemCenter('e2e-belt'), 2);
      expect(loot().store.state.equipment.belt?.uid ?? null).toBe('e2e-belt');
      const life = heroStat('life');
      expect(life.value).toBeGreaterThan(lifeBefore);
      expect(life.sources.some((x) => x.source === 'item:belt'), 'from item:belt').toBe(true);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "a click on a bag item under another panel is that panel's",
    () => {
      const { rl, game } = h;
      loot().add(item({ uid: 'e2e-under', base: 'leather-belt', name: 'Under Belt' }));
      rl.step(1);
      game.layer.open({ id: 'e2e-cover', title: 'cover', size: { w: 40, h: 20 }, draw() {}, input: () => true }, { modal: false });
      click(ui().itemCenter('e2e-under'));
      expect(ui().held?.item.uid ?? null, 'nothing on the cursor').toBeNull();
      game.layer.close('e2e-cover');
      expect(stack().join()).toBe('inventory');
    },
    T,
  );

  it(
    "Esc closes the inventory without the pause menu; pause → Inventory stays paused; pad B back to pause; pad Back and I toggle it",
    () => {
      const { rl } = h;
      expect(rl.press('Escape').ui, 'Esc closes, no pause menu').toEqual([]);
      rl.press('Escape');
      rl.ui.click('inventory');
      const rs = rl.state();
      expect(rs.ui.join()).toBe('pause,inventory');
      expect(rs.paused).toBe(true);
      expect(rl.press('PadB').ui.join(), 'pad B back to the pause menu').toBe('pause');
      rl.press('Escape');
      expect(rl.press('PadBack').ui.join(), 'pad Back opens the inventory').toBe('inventory');
      expect(rl.press('KeyI').ui, 'I closes it again').toEqual([]);
    },
    T,
  );

  it(
    'G: right-click sockets Fireball (Cleave back in the bag), a support links and raises the cost, the panel shows HIT / DPS / COST, pad X takes it out, right-click puts it back, Esc closes',
    () => {
      const { rl, game, engine } = h;
      loot().add(item({ uid: 'e2e-fireball', base: 'skill-gem', name: 'Fireball', gem: { id: 'fireball', level: 3, support: false } } as Partial<Item> & Pick<Item, 'uid' | 'base'>));
      loot().add(item({ uid: 'e2e-lmp', base: 'support-gem', name: 'Lesser Multiple Projectiles', gem: { id: 'lmp', level: 1, support: true } } as Partial<Item> & Pick<Item, 'uid' | 'base'>));
      expect(rl.press('KeyG').ui.join()).toBe('skills');
      engine.step(1);
      click(ui().itemCenter('e2e-fireball'), 2);
      expect(game.save.hero.skills[0]!.gem?.gem?.id).toBe('fireball');
      expect(bar()[0]!.name).toBe('Fireball');
      expect(bag().some((p) => p.item.gem?.id === 'cleave'), 'Cleave went back into the bag').toBe(true);
      const cost0 = bar()[0]!.cost;
      click(ui().itemCenter('e2e-lmp'), 2);
      expect(game.save.hero.skills[0]!.supports.map((g) => g?.gem?.id ?? null)[0]).toBe('lmp');
      expect(bar()[0]!.cost, 'the cost follows the support').toBeGreaterThan(cost0);
      const lines = ui()
        .skillLines(ui().numbers()[0]!)
        .map((l) => l.text);
      expect(lines.some((l) => /^HIT \d/.test(l)) && lines.some((l) => /^DPS \d/.test(l)) && lines.some((l) => /^COST \d/.test(l)), lines.join(' | ')).toBe(true);
      // the pointer over skill 1's socket (its tooltip); keys / pad: Enter takes the cursor there, X takes the gem out
      const sock = ui().socketCenter(0, -1);
      pointAtArt(engine, sock.x, sock.y);
      engine.step(2);
      rl.press('Enter');
      rl.press('PadX');
      expect(game.save.hero.skills[0]!.gem).toBeNull();
      expect(inBag('e2e-fireball')).toBe(true);
      expect(bar()[0]!.id).toBeNull();
      rl.press('PadX'); // nothing to take: still fine
      click(ui().itemCenter('e2e-fireball'), 2); // and back in
      expect(bar()[0]!.name).toBe('Fireball');
      expect(rl.press('Escape').ui).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "Ilsa: a click buys from her wares, the gems tab sells only gems and a click buys one, Ctrl-click sells",
    () => {
      const { rl, engine } = h;
      expect(talkTo('ilsa')).toContain('vendor');
      engine.step(1);
      const ware = loot().store.vendor.stock[0]!;
      const gold0 = rl.state().hero.gold;
      click(ui().itemCenter(ware.uid));
      expect(inBag(ware.uid), 'bought').toBe(true);
      expect(rl.state().hero.gold).toBeLessThan(gold0);
      click(ui().tabCenter(1));
      expect(loot().store.vendor.kind).toBe('gems');
      expect(loot().store.vendor.stock.every((x) => x.gem), 'every ware a gem').toBe(true);
      const gem = loot().store.vendor.stock.find((x) => x.gem)!;
      click(ui().itemCenter(gem.uid));
      expect(inBag(gem.uid), `bought a ${gem.gem!.id} gem`).toBe(true);
      const gold1 = rl.state().hero.gold;
      const n = loot().counts().inventory;
      click(ui().itemCenter('e2e-fireball') ?? ui().itemCenter(bag()[0]!.item.uid), 1, { ctrl: true });
      expect(rl.state().hero.gold, 'Ctrl-click sells').toBeGreaterThan(gold1);
      expect(loot().counts().inventory).toBe(n - 1);
      rl.press('Escape');
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "Brann's anvil: a Kindling Shard on the bench makes the boots magic",
    () => {
      const { rl, engine } = h;
      loot().add(item({ uid: 'e2e-boots', base: 'rawhide-boots', level: 8, name: 'Rawhide Boots' }));
      loot().add(item({ uid: 'e2e-orb', base: 'kindling-shard', name: 'Kindling Shard', quantity: 3 } as Partial<Item> & Pick<Item, 'uid' | 'base'>));
      expect(talkTo('brann')).toContain('crafting');
      engine.step(1);
      click(ui().itemCenter('e2e-boots'));
      click(ui().orbCenter('kindling-shard'));
      const boots = bag().find((p) => p.item.uid === 'e2e-boots')?.item;
      const orb = bag().find((p) => p.item.uid === 'e2e-orb')?.item;
      expect(ui().benchItem).toBe('e2e-boots');
      expect(boots?.rarity).toBe('magic');
      expect(boots?.affixes.length).toBeGreaterThan(0);
      expect(orb?.quantity, 'one shard used').toBe(2);
      rl.press('Escape');
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the chest opens the stash: Ctrl-click stores the boots, drag and drop moves them to another cell',
    () => {
      const { rl, engine } = h;
      expect(talkTo('stash')).toContain('stash');
      engine.step(1);
      const stash = () => loot().store.state.stash[0]!.items;
      click(ui().itemCenter('e2e-boots'), 1, { ctrl: true });
      expect(stash().some((p) => p.item.uid === 'e2e-boots'), 'stored').toBe(true);
      // drag them to a cell of our own: the cell must survive the reload too
      const from = ui().itemCenter('e2e-boots')!;
      const to = ui().cellCenter('left', 6, 4);
      pointAtArt(engine, from.x, from.y);
      engine.step(1);
      engine.input.setButtons(1);
      engine.step(1);
      for (let i = 1; i <= 4; i++) {
        pointAtArt(engine, Math.round(from.x + ((to.x - from.x) * i) / 4), Math.round(from.y + ((to.y - from.y) * i) / 4));
        engine.step(1);
      }
      engine.input.setButtons(0);
      engine.step(2);
      const p = stash().find((x) => x.item.uid === 'e2e-boots');
      expect(p && [p.x, p.y]).toEqual([6, 4]);
      rl.press('Escape');
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'save → a new boot on the same saves → Continue: the stash (same cell), gear, sockets and passive tree come back',
    async () => {
      // a tree node, so the tree has something to bring back (the tree's own checks: ui/tree/tree.headless.test.ts)
      expect(h.rl.ui.open('tree')).toBe(true);
      h.engine.step(1);
      const panel = h.game.layer.top!.panel as TreePanel;
      const state = panel.state!;
      const id = state.tree.nodes.map((n) => n.id).find((n) => !state.isAllocated(n) && state.pathTo(n)?.length === 1)!;
      h.engine.input.send({ rl: 'tree', action: { kind: 'activate', id } });
      h.engine.step(2);
      h.rl.ui.close('tree');
      h.engine.step(1);
      h.rl.save(1);
      const before = { allocated: h.game.save.hero.allocated.length, sockets: h.game.save.hero.skills.map((x) => x.gem?.gem?.id ?? null).join() };
      expect(before.allocated).toBeGreaterThan(0);
      expect(h.engine.errors).toEqual([]);
      h.engine.dispose();
      h = await headlessRiftlight({ seed: 777, store });
      h.engine.step(2);
      h.rl.continueRun(1);
      const s = loot().store.state;
      const p = s.stash[0]!.items.find((x) => x.item.uid === 'e2e-boots');
      expect(p && { x: p.x, y: p.y, rarity: p.item.rarity }, 'the stash, in the same cell').toEqual({ x: 6, y: 4, rarity: 'magic' });
      const life = heroStat('life').sources.map((x) => x.source);
      expect(s.equipment.belt?.uid ?? null, 'the belt').toBe('e2e-belt');
      expect(life, 'and it applies').toContain('item:belt');
      expect(h.game.save.hero.skills.map((x) => x.gem?.gem?.id ?? null).join(), 'the sockets').toBe(before.sockets);
      expect(h.game.hero.skills()[0]!.name).toBe('Fireball');
      expect(h.game.save.hero.allocated.length, 'the tree').toBe(before.allocated);
      expect(h.engine.errors).toEqual([]);
    },
    T,
  );
});
