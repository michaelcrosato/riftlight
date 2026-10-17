// The Loot Lab headless (was e2e `riftlight-loot`'s state checks): kills burst items and gold
// out in an arc; they land with labels, rares in a light beam, with loot sounds; walking over gold
// collects it, F picks up the nearest item, clicking a label too; Alt toggles the loot filter; I
// opens the inventory, right-click equips (the StatSheet changes), a drag onto the paper doll
// equips, the pointer over an item is what its tooltip shows, Ctrl-click moves to the open stash
// and Escape closes the windows. The pictures, the tooltip's pixels and the overlay canvas stay
// in e2e. The tests run in order on one engine, as the e2e flow did.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import { headlessGame, pointAtArt } from '../headless';
import { LootLab } from './lootlab';

const T = 30_000;

describe('the Loot Lab', () => {
  let e: Engine;
  let lab: LootLab;
  let belt = '';
  let ring = '';
  let hat = '';

  beforeAll(async () => {
    lab = new LootLab();
    e = await headlessGame(lab);
    e.step(2);
  }, T);
  afterAll(() => e?.dispose());

  /** A key pressed for a frame and let go (a keyboard press). */
  const press = (code: string) => {
    e.input.setKey(code, true);
    e.step(1);
    e.input.setKey(code, false);
  };
  const carried = (uid: string) => lab.store.state.inventory.items.some((p) => p.item.uid === uid);

  it('two boss kills burst items and gold out in an arc; every drop lands with a label, rares in a beam, with loot sounds', () => {
    expect(lab.world.drops.length, 'the lab starts with nothing on the ground').toBe(0);
    lab.kill('boss', 2, 1);
    const w = lab.world;
    expect(w.drops.filter((d) => d.item).length, 'items').toBeGreaterThanOrEqual(2);
    expect(w.drops.filter((d) => !d.item).length, 'gold piles').toBeGreaterThanOrEqual(1);
    expect(w.drops.every((d) => d.t < 1), 'all bursting out (in flight)').toBe(true);
    e.step(12);
    const mid = w.drops.map((d) => d.mesh.position.y - d.to.y);
    expect(Math.max(...mid), 'drops arc above the ground mid-flight').toBeGreaterThan(0.3);
    e.step(30);
    expect(w.drops.every((d) => d.t >= 1 && Math.abs(d.mesh.position.y - d.to.y) < 1e-6), 'every drop landed on the ground').toBe(true);
    const labels = w.drops.filter((d) => d.label).length;
    expect(labels, 'every visible drop has a name label').toBe(w.drops.filter((d) => d.mesh.visible).length);
    expect(labels).toBeGreaterThan(0);
    const rares = w.drops.filter((d) => d.item && (d.item.rarity === 'rare' || d.item.rarity === 'unique')).length;
    expect(rares, 'a rare or unique among them').toBeGreaterThanOrEqual(1);
    expect(w.drops.filter((d) => d.beam).length, 'rares and uniques stand in a light beam').toBe(rares);
    expect(Object.keys(e.audio.counts).filter((k) => k.startsWith('loot-')).length, 'landing plays loot sounds by rarity').toBeGreaterThan(0);
  });

  it('walking over gold collects it; F picks up the nearest item; clicking an item label picks it up', () => {
    const gold0 = lab.store.state.gold;
    const g = lab.world.drops.find((d) => !d.item)!;
    lab.hero.teleport([g.mesh.position.x, 0, g.mesh.position.z]);
    e.step(6);
    expect(lab.store.state.gold, 'walking over gold collects it').toBeGreaterThan(gold0);

    // away from the other drops, so the belt is the nearest item
    const n0 = lab.store.state.inventory.items.length;
    lab.hero.teleport([-7, 0, -7]);
    e.step(4);
    belt = lab.give('leather-belt', 'magic').uid;
    e.step(40);
    e.input.setKey('KeyF', true);
    e.step(2);
    e.input.setKey('KeyF', false);
    e.step(2);
    expect(carried(belt), 'F picks up the nearest item').toBe(true);
    expect(lab.store.state.inventory.items.length).toBeGreaterThan(n0);

    // move next to an item and click its name
    const d = lab.world.drops.find((x) => x.item && x.label)!;
    expect(d, 'a labelled item to click').toBeTruthy();
    const uid = d.item!.uid;
    lab.hero.teleport([d.mesh.position.x + 0.8, 0, d.mesh.position.z]);
    e.step(8);
    const l = lab.world.drops.find((x) => x.item?.uid === uid)!.label!;
    pointAtArt(e, l.x + Math.floor(l.w / 2), l.y + Math.floor(l.h / 2), true);
    e.step(1);
    e.input.setButtons(0);
    e.step(1);
    expect(carried(uid), 'clicking an item label picks it up').toBe(true);
  });

  it('the loot filter hides a normal item at depth 30, and Alt toggles it off: the item and its label show', () => {
    lab.depth = 30;
    const it = lab.give('iron-hat', 'normal');
    e.step(40);
    const d = lab.world.drops.find((x) => x.item?.uid === it.uid)!;
    expect(d.tier).toBe('hide');
    expect(d.mesh.visible, 'hidden by the filter').toBe(false);
    press('AltLeft');
    e.step(1);
    expect(lab.world.filterEnabled, 'Alt toggles the filter off').toBe(false);
    expect(d.mesh.visible, 'the hidden item shows').toBe(true);
    expect(d.label, 'with its label').toBeTruthy();
    press('AltLeft');
    lab.depth = 10;
  });

  it("I opens the inventory; right-click equips the belt and changes the hero's stats; dragging a ring onto the paper doll equips it", () => {
    ring = lab.give('ruby-ring', 'magic', false).uid;
    press('KeyI');
    e.step(1);
    expect(lab.ui.isOpen && lab.inventory.isOpen(), 'I opens the inventory').toBe(true);
    const life0 = lab.sheet.get('life');
    const b = lab.ui.itemCenter(belt)!;
    pointAtArt(e, b.x, b.y);
    e.step(1);
    e.input.setButtons(2);
    e.step(1);
    e.input.setButtons(0);
    e.step(1);
    expect(lab.store.state.equipment.belt?.uid, 'right-click equips the belt').toBe(belt);
    expect(lab.sheet.hasSource('item:belt'), 'StatSheet source item:belt').toBe(true);
    expect(lab.sheet.get('life'), "equipping changes the hero's stats").toBeGreaterThan(life0);

    // drag and drop the ring onto the second ring slot
    const res0 = lab.sheet.get('res.fire');
    const from = lab.ui.itemCenter(ring)!;
    const to = lab.ui.slotCenter('ring2');
    pointAtArt(e, from.x, from.y);
    e.step(1);
    pointAtArt(e, from.x, from.y, true);
    e.step(1);
    for (let k = 1; k <= 8; k++) {
      pointAtArt(e, Math.round(from.x + ((to.x - from.x) * k) / 8), Math.round(from.y + ((to.y - from.y) * k) / 8));
      e.step(1);
    }
    pointAtArt(e, to.x, to.y, false);
    e.step(2);
    expect(lab.store.state.equipment.ring2?.uid, 'dragging a ring onto the paper doll equips it').toBe(ring);
    expect(lab.ui.held, 'nothing left on the cursor').toBeNull();
    expect(lab.sheet.get('res.fire'), "the ring's fire resistance reaches the StatSheet").toBeGreaterThan(res0);
  });

  it('the pointer over an item is the item its tooltip shows; Ctrl-click moves it into the open stash tab; Escape closes the windows', () => {
    hat = lab.give('leather-cap', 'rare', false).uid;
    e.step(1);
    const c = lab.ui.itemCenter(hat)!;
    pointAtArt(e, c.x, c.y);
    e.step(2);
    // what drawTip shows: the item under the cursor (its pixels are e2e's)
    expect(lab.ui.itemAtTarget(lab.ui.hit(lab.ui.cursor.x, lab.ui.cursor.y))?.uid, 'the hat under the pointer').toBe(hat);
    expect(lab.ui.held).toBeNull();

    press('KeyT');
    e.step(1);
    e.input.setKey('ControlLeft', true);
    pointAtArt(e, c.x, c.y, true);
    e.step(1);
    e.input.setButtons(0);
    e.input.setKey('ControlLeft', false);
    e.step(1);
    expect(lab.store.state.stash.some((g) => g.items.some((p) => p.item.uid === hat)), 'Ctrl-click moves an item into the open stash tab').toBe(true);
    press('Escape');
    e.step(1);
    expect(lab.ui.isOpen, 'Escape closes the windows').toBe(false);
    expect(e.errors).toEqual([]);
  });
});
