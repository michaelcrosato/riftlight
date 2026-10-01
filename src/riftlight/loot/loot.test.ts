import { describe, expect, it } from 'vitest';
import { flat, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import { SCALING } from '../core/scaling';
import type { Item, Rarity, SaveData } from '../core/types';
import { compareEquip, cloneSheet } from './compare';
import { AFFIXES, affixFits, BASES, CORRUPTIONS, CURRENCY, equipmentBases, GEMS, UNIQUES } from './content';
import { annul, applyCurrency, augment, chaos, corrupt, craftBlocker, divine, exalt, regal, scour, transmute } from './craft';
import { filterTier } from './filter';
import {
  AFFIX_LIMITS,
  currencyItem,
  makeUnique,
  rarityBoost,
  rarityWeights,
  rollDrops,
  rollItem,
  rollRarity,
  rollValue,
  tierWeights,
} from './generate';
import {
  addItem,
  canPlace,
  dropAt,
  emptyLoot,
  equip,
  findSpace,
  INVENTORY_SIZE,
  itemSize,
  lootFromSave,
  lootToSave,
  pickUp,
  transfer,
  unequip,
  writeSave,
} from './inventory';
import { applyEquipment, defenceStats, equipmentMods, itemMods, requiredLevel, weaponStats } from './itemMods';
import { describeItemMods } from './stats';
import { buy, BUY_MARKUP, buyPrice, gamblePrice, gemLevelCap, HONED_GEMS, revealGamble, sell, sellPrice, vendorStock } from './vendor';

const rare = (seed: number, base?: string, itemLevel = 40): Item => rollItem(new Rng(seed), { itemLevel, rarity: 'rare', ...(base ? { base } : {}) });

describe('content', () => {
  it('has the promised amounts', () => {
    expect(equipmentBases().length).toBeGreaterThanOrEqual(65);
    expect(AFFIXES.size).toBeGreaterThanOrEqual(85);
    expect(UNIQUES.size).toBeGreaterThanOrEqual(28);
    expect(CURRENCY.size).toBe(10);
    expect(GEMS.size).toBeGreaterThan(10);
  });

  it('every affix has 5–8 tiers in ascending level and fits at least one base', () => {
    for (const a of AFFIXES.all()) {
      expect(a.tiers.length, a.id).toBeGreaterThanOrEqual(5);
      expect(a.tiers.length, a.id).toBeLessThanOrEqual(8);
      for (let i = 1; i < a.tiers.length; i++) expect(a.tiers[i]!.level, a.id).toBeGreaterThan(a.tiers[i - 1]!.level);
      for (const t of a.tiers) for (const m of t.mods) expect(m.min, `${a.id} ${m.stat}`).toBeLessThanOrEqual(m.max);
      expect(equipmentBases().some((b) => affixFits(a, b)), a.id).toBe(true);
    }
    for (const c of CORRUPTIONS.all()) expect(equipmentBases().some((b) => affixFits(c, b)), c.id).toBe(true);
  });

  it('has prefixes and suffixes for every equipment slot', () => {
    for (const b of equipmentBases()) {
      const fits = AFFIXES.all().filter((a) => affixFits(a, b));
      expect(fits.some((a) => a.type === 'prefix'), b.id).toBe(true);
      expect(fits.some((a) => a.type === 'suffix'), b.id).toBe(true);
    }
  });

  it('every unique names a real base', () => {
    for (const u of UNIQUES.all()) {
      expect(BASES.has(u.base), u.id).toBe(true);
      expect(u.flavour.length).toBeGreaterThan(5);
      expect(u.level).toBeGreaterThanOrEqual(BASES.get(u.base).level);
    }
  });
});

describe('generation', () => {
  it('is deterministic per seed', () => {
    expect(rollItem(new Rng(7), { itemLevel: 30, rarityBoost: 2 })).toEqual(rollItem(new Rng(7), { itemLevel: 30, rarityBoost: 2 }));
    expect(rollDrops(new Rng(9), { depth: 10, rank: 'rare' })).toEqual(rollDrops(new Rng(9), { depth: 10, rank: 'rare' }));
  });

  it('affix count follows rarity and groups never repeat', () => {
    for (let s = 0; s < 300; s++) {
      for (const rarity of ['magic', 'rare'] as Rarity[]) {
        const it = rollItem(new Rng(s), { itemLevel: 1 + (s % 80), rarity });
        const lim = AFFIX_LIMITS[rarity];
        expect(it.affixes.length).toBeLessThanOrEqual(lim.max);
        if (rarity === 'magic') expect(it.affixes.length).toBeGreaterThanOrEqual(1);
        const defs = it.affixes.map((a) => AFFIXES.get(a.id));
        expect(new Set(defs.map((d) => d.group)).size).toBe(defs.length);
        expect(defs.filter((d) => d.type === 'prefix').length).toBeLessThanOrEqual(lim.prefix);
        expect(defs.filter((d) => d.type === 'suffix').length).toBeLessThanOrEqual(lim.suffix);
        for (const a of it.affixes) expect(AFFIXES.get(a.id).tiers[a.tier]!.level).toBeLessThanOrEqual(it.level);
        for (const a of it.affixes) expect(affixFits(AFFIXES.get(a.id), BASES.get(it.base))).toBe(true);
      }
    }
    // Rares at a decent item level reach 4–6.
    const counts = Array.from({ length: 200 }, (_, s) => rare(s, undefined, 60).affixes.length);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...counts)).toBe(6);
  });

  it('item level gates bases, affix tiers and uniques', () => {
    for (let s = 0; s < 200; s++) {
      const it = rollItem(new Rng(s), { itemLevel: 5, rarityBoost: 30 });
      expect(BASES.get(it.base).level).toBeLessThanOrEqual(5);
      if (it.unique) expect(UNIQUES.get(it.unique).level).toBeLessThanOrEqual(5);
    }
    const w = tierWeights(AFFIXES.get('life'), 20);
    expect(w.filter((x) => x > 0).length).toBe(3);
    // Higher item level → higher average tier.
    const avgTier = (lvl: number) => {
      let sum = 0;
      let n = 0;
      for (let s = 0; s < 400; s++) for (const a of rare(s, 'plate-vest', lvl).affixes) {
          sum += a.tier / Math.max(1, AFFIXES.get(a.id).tiers.length - 1);
          n++;
        }
      return sum / n;
    };
    expect(avgTier(80)).toBeGreaterThan(avgTier(20) + 0.2);
  });

  it('rarity weights grow with depth and item rarity', () => {
    expect(rarityBoost(30, 0.5)).toBeCloseTo(SCALING.rarityBoost(30) * 1.5);
    const w1 = rarityWeights(1);
    const w2 = rarityWeights(2);
    expect(w2.rare / w2.normal).toBeGreaterThan(2 * (w1.rare / w1.normal));
    const tally = (boost: number) => {
      const r = new Rng(3);
      let good = 0;
      for (let i = 0; i < 4000; i++) if (['rare', 'unique'].includes(rollRarity(r, boost))) good++;
      return good;
    };
    expect(tally(3)).toBeGreaterThan(tally(1) * 3);
  });

  it('names magic items "prefix base suffix" and rares with two words', () => {
    let seen = 0;
    for (let s = 0; s < 50; s++) {
      const m = rollItem(new Rng(s), { itemLevel: 30, rarity: 'magic', base: 'plate-vest' });
      expect(m.name).toContain('Plate Vest');
      if (m.affixes.length === 2) {
        seen++;
        expect(m.name.split(' ').length).toBeGreaterThan(3);
      }
      expect(rare(s).name.split(' ').length).toBe(2);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('rolls values with the precision they are written in', () => {
    const r = new Rng(1);
    for (let i = 0; i < 100; i++) {
      expect(Number.isInteger(rollValue(r, 10, 19))).toBe(true);
      const v = rollValue(r, 0.1, 0.19);
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(0.19);
      expect(Math.round(v * 100)).toBeCloseTo(v * 100, 6);
    }
  });

  it('drops scale with rank and depth', () => {
    const run = (depth: number, rank: 'normal' | 'boss', n: number) => {
      const rng = new Rng(`drops:${depth}:${rank}`);
      let items = 0;
      let gold = 0;
      let rares = 0;
      for (let i = 0; i < n; i++) {
        const d = rollDrops(rng, { depth, rank });
        items += d.items.length;
        gold += d.gold;
        rares += d.items.filter((it) => it.rarity === 'rare' || it.rarity === 'unique').length;
      }
      return { items: items / n, gold: gold / n, rares: rares / Math.max(1, items) };
    };
    const shallow = run(1, 'normal', 3000);
    const deep = run(40, 'normal', 3000);
    const boss = run(1, 'boss', 200);
    expect(shallow.items).toBeGreaterThan(0.15);
    expect(shallow.items).toBeLessThan(0.3);
    expect(boss.items).toBeGreaterThan(shallow.items * 8);
    expect(deep.gold).toBeGreaterThan(shallow.gold * 5);
    expect(deep.rares).toBeGreaterThan(shallow.rares);
    for (let s = 0; s < 50; s++) expect(rollDrops(new Rng(s), { depth: 3, rank: 'boss' }).items.some((i) => i.rarity === 'rare' || i.rarity === 'unique')).toBe(true);
  });
});

describe('crafting', () => {
  const normal = (): Item => rollItem(new Rng(11), { itemLevel: 50, rarity: 'normal', base: 'iron-hat' });

  it('walks normal → magic → rare → rerolls without mutating', () => {
    const r = new Rng(5);
    const n = normal();
    const frozen = JSON.stringify(n);
    const m = transmute(r, n);
    expect(m.ok && m.item.rarity).toBe('magic');
    expect(JSON.stringify(n)).toBe(frozen);
    if (!m.ok) return;
    expect(m.item.uid).toBe(n.uid);
    let magic = m.item;
    if (magic.affixes.length === 1) {
      const a = augment(r, magic);
      expect(a.ok).toBe(true);
      if (a.ok) magic = a.item;
    }
    expect(augment(r, magic).ok).toBe(false);
    const g = regal(r, magic);
    expect(g.ok && g.item.rarity).toBe('rare');
    if (!g.ok) return;
    expect(g.item.affixes.length).toBe(3);
    const x = exalt(r, g.item);
    expect(x.ok && x.item.affixes.length).toBe(4);
    const c = chaos(r, g.item);
    expect(c.ok && c.item.affixes.length).toBeGreaterThanOrEqual(4);
    const an = annul(r, g.item);
    expect(an.ok && an.item.affixes.length).toBe(2);
    const sc = scour(r, g.item);
    expect(sc.ok && sc.item.rarity).toBe('normal');
    expect(sc.ok && sc.item.affixes.length).toBe(0);
  });

  it('divine rerolls values but keeps affixes and tiers', () => {
    const it = rare(21, 'full-plate', 70);
    const d = divine(new Rng(2), it);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.item.affixes.map((a) => [a.id, a.tier])).toEqual(it.affixes.map((a) => [a.id, a.tier]));
  });

  it('refuses the wrong targets and corrupted items', () => {
    expect(craftBlocker('chaos', normal())).toMatch(/rare/);
    expect(craftBlocker('transmute', makeUnique(new Rng(1), 'emberheart'))).toMatch(/unique/);
    expect(applyCurrency(new Rng(1), 'kindling-shard', currencyItem(new Rng(1), 'ember-bead')).ok).toBe(false);
    let corrupted = 0;
    for (let s = 0; s < 40; s++) {
      const c = corrupt(new Rng(s), rare(s));
      expect(c.ok).toBe(true);
      if (!c.ok) continue;
      expect(c.item.corrupted).toBe(true);
      expect(applyCurrency(new Rng(s), 'rift-ember', c.item).ok).toBe(false);
      if (c.item.implicits?.length) corrupted++;
    }
    expect(corrupted).toBeGreaterThan(5);
  });
});

describe('item mods', () => {
  it('folds local mods into the weapon and exposes weapon stats', () => {
    const base: Item = { uid: 'w', base: 'rusted-blade', rarity: 'magic', level: 10, name: 'x', affixes: [{ id: 'local-phys-inc', tier: 0, mods: [{ stat: 'local.physical', kind: 'inc', value: 1 }] }] };
    const w = weaponStats(base)!;
    expect(w.damage.physical).toEqual([8, 18]);
    const mods = itemMods(base);
    expect(mods.find((m) => m.stat === 'weapon.physical.min')?.value).toBe(8);
    expect(mods.find((m) => m.stat === 'attack.speed.base')?.value).toBe(1.5);
    expect(mods.find((m) => m.stat === 'crit.chance.base')?.value).toBe(0.05);
    expect(mods.some((m) => m.stat.startsWith('local.'))).toBe(false);
    expect(mods.some((m) => m.stat === 'weapon.sword' && m.kind === 'flag')).toBe(true);
  });

  it('armour pieces give flat defences after local increases', () => {
    const it: Item = { uid: 'a', base: 'plate-vest', rarity: 'magic', level: 10, name: 'x', affixes: [{ id: 'local-armour-inc', tier: 0, mods: [{ stat: 'local.armour', kind: 'inc', value: 0.5 }] }] };
    expect(defenceStats(it)!.armour).toBe(36);
    expect(itemMods(it)).toContainEqual(flat('armour', 36));
  });

  it('feeds a StatSheet by slot source and swaps cleanly', () => {
    const sheet = new StatSheet({ life: 50 });
    const ring: Item = { uid: 'r', base: 'ruby-ring', rarity: 'magic', level: 10, name: 'x', affixes: [{ id: 'life', tier: 1, mods: [flat('life', 25)] }] };
    applyEquipment(sheet, { ring1: ring, ring2: { ...ring, uid: 'r2' } });
    expect(sheet.get('life')).toBe(100);
    expect(sheet.get('res.fire')).toBeCloseTo(0.4);
    expect(Object.keys(equipmentMods({ ring1: ring }))).toEqual(['item:ring1']);
    applyEquipment(sheet, {});
    expect(sheet.get('life')).toBe(50);
  });

  it('requirements come from the base, the affix tiers or the unique', () => {
    expect(requiredLevel(makeUnique(new Rng(1), 'emberheart'))).toBe(34);
    const it = rare(4, 'iron-hat', 80);
    expect(requiredLevel(it)).toBeGreaterThanOrEqual(1);
  });

  it('describes added damage as one line', () => {
    expect(describeItemMods([flat('added.fire.min', 3, ['attack']), flat('added.fire.max', 7, ['attack'])])).toEqual(['Adds 3 to 7 fire damage to attacks']);
    expect(describeItemMods([flat('res.fire', 0.3)])).toEqual(['+30% fire resistance']);
  });
});

describe('comparison', () => {
  it('reads deltas from a cloned sheet and leaves the hero untouched', () => {
    const sheet = new StatSheet({ life: 50 });
    sheet.set('tree', [flat('life', 10)]);
    sheet.setCondition('inDark', true);
    const clone = cloneSheet(sheet);
    expect(clone.get('life')).toBe(60);
    clone.set('tree', []);
    expect(sheet.get('life')).toBe(60);
    const old: Item = { uid: 'o', base: 'leather-belt', rarity: 'normal', level: 1, name: 'Leather Belt', affixes: [] };
    applyEquipment(sheet, { belt: old });
    const v = sheet.version;
    const better: Item = { ...old, uid: 'n', rarity: 'magic', affixes: [{ id: 'life', tier: 0, mods: [flat('life', 15)] }] };
    const d = compareEquip(sheet, { belt: old }, better);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ stat: 'life', delta: 15, better: true });
    expect(sheet.version).toBe(v);
    const twoHander = rollItem(new Rng(1), { itemLevel: 10, rarity: 'normal', base: 'bastard-sword' });
    const shield: Item = { uid: 's', base: 'kite-shield', rarity: 'normal', level: 10, name: 'Kite Shield', affixes: [] };
    const d2 = compareEquip(sheet, { offhand: shield }, twoHander);
    expect(d2.find((x) => x.stat === 'armour')?.delta).toBe(-40);
    expect(d2.find((x) => x.stat === 'weapon.physical.min')?.better).toBe(true);
  });
});

describe('inventory', () => {
  const big = () => rollItem(new Rng(100), { itemLevel: 40, rarity: 'normal', base: 'greatsword' });
  const ring = (s: number) => rollItem(new Rng(s), { itemLevel: 40, rarity: 'magic', base: 'ruby-ring' });

  it('places items by size and finds space', () => {
    let state = emptyLoot();
    expect(itemSize(big())).toEqual({ w: 2, h: 4 });
    for (let i = 0; i < 6; i++) {
      const r = pickUp(state, { ...big(), uid: `g${i}` });
      expect(r.ok).toBe(true);
      if (r.ok) state = r.value;
    }
    expect(pickUp(state, { ...big(), uid: 'g7' }).ok).toBe(false);
    expect(findSpace(state.inventory, ring(1))).not.toBeNull();
    expect(canPlace(state.inventory, ring(1), 0, 0)).toBe(false);
    expect(state.inventory.w).toBe(INVENTORY_SIZE.w);
  });

  it('stacks currency and swaps on drop', () => {
    let g = emptyLoot().inventory;
    g = addItem(g, currencyItem(new Rng(1), 'kindling-shard', 30)).grid;
    const a = addItem(g, currencyItem(new Rng(2), 'kindling-shard', 15));
    expect(a.grid.items.map((p) => p.item.quantity)).toEqual([40, 5]);
    const r = dropAt(a.grid, ring(3), 0, 0);
    expect(r.ok && r.value.swapped?.quantity).toBe(40);
  });

  it('equips with level checks, two rings and two-hand rules', () => {
    let state = emptyLoot();
    const items = [ring(1), ring(2), big(), { ...rollItem(new Rng(9), { itemLevel: 10, rarity: 'normal', base: 'buckler' }) }];
    for (const it of items) {
      const r = pickUp(state, it);
      if (r.ok) state = r.value;
    }
    const lvl = 99;
    for (const it of items) {
      const r = equip(state, it.uid, lvl);
      expect(r.ok, it.base).toBe(true);
      if (r.ok) state = r.value;
    }
    expect(state.equipment.ring1 && state.equipment.ring2).toBeTruthy();
    // The buckler pushed the two-handed sword back into the inventory.
    expect(state.equipment.offhand?.base).toBe('buckler');
    expect(state.equipment.weapon).toBeUndefined();
    expect(state.inventory.items.some((p) => p.item.base === 'greatsword')).toBe(true);
    const low = emptyLoot();
    const unique = makeUnique(new Rng(1), 'emberheart');
    const r = pickUp(low, unique);
    expect(r.ok && equip(r.value, unique.uid, 1).ok).toBe(false);
    const un = unequip(state, 'ring1');
    expect(un.ok && un.value.equipment.ring1).toBeUndefined();
  });

  it('moves between inventory and stash tabs and round-trips a save', () => {
    let state = emptyLoot();
    const it = ring(4);
    const r = pickUp(state, it);
    if (r.ok) state = r.value;
    const t = transfer(state, it.uid, 'inventory', 2);
    expect(t.ok).toBe(true);
    if (t.ok) state = t.value;
    expect(state.stash[2]!.items).toHaveLength(1);
    const r2 = pickUp(state, big());
    if (r2.ok) state = r2.value;
    state = { ...state, gold: 123 };
    const loaded = lootFromSave(JSON.parse(JSON.stringify(lootToSave(state))));
    expect(loaded).toEqual(state);
    const save = { version: 1, hero: { level: 1, xp: 0, gold: 0, allocated: [], equipment: {}, inventory: [], skills: [] }, stash: [], deepest: 0, difficulty: {}, seed: 1, settings: {} } as unknown as SaveData;
    expect(lootFromSave(writeSave(save, state))).toEqual(state);
  });
});

describe('vendors', () => {
  it('prices by rarity and level; stock is seeded per visit', () => {
    const n = rollItem(new Rng(1), { itemLevel: 30, rarity: 'normal' });
    const r = { ...n, rarity: 'rare' as const };
    expect(sellPrice(r)).toBeGreaterThan(sellPrice(n) * 4);
    expect(buyPrice(n)).toBeGreaterThan(sellPrice(n));
    expect(vendorStock(1, 5, 0, 'smith')).toEqual(vendorStock(1, 5, 0, 'smith'));
    expect(vendorStock(1, 5, 1, 'smith')).not.toEqual(vendorStock(1, 5, 0, 'smith'));
    // ten level 1 gems, then the honed ones: levelled to what a hero of the area can socket
    const gems = vendorStock(1, 5, 0, 'gems');
    expect(gems.slice(0, 10).every((i) => i.gem?.level === 1)).toBe(true);
    const honed = vendorStock(1, 20, 0, 'gems').slice(10);
    expect(honed).toHaveLength(HONED_GEMS.count);
    const cap = gemLevelCap(SCALING.monsterLevel(20));
    for (const g of honed) {
      expect(g.gem!.level).toBeGreaterThan(1);
      expect(g.gem!.level).toBeLessThanOrEqual(cap);
      // priced by level: a honed gem costs its level × a fresh one
      expect(buyPrice(g)).toBe(sellPrice(g) * BUY_MARKUP * g.gem!.level);
    }
  });

  it('gambles: an unrevealed base per slot at the area item level, priced in kills, revealed on purchase', () => {
    const stock = vendorStock(3, 20, 0, 'gamble');
    const itemLevel = SCALING.monsterLevel(20);
    expect(stock.length).toBeGreaterThanOrEqual(9);
    expect(stock.every((i) => i.gamble && i.level === itemLevel && i.affixes.length === 0)).toBe(true);
    expect(vendorStock(3, 20, 0, 'gamble')).toEqual(stock);
    const ring = stock.find((i) => i.base.includes('ring'))!;
    expect(buyPrice(ring)).toBe(gamblePrice(20, 'ring'));
    expect(gamblePrice(40, 'ring')).toBeGreaterThan(gamblePrice(20, 'ring'));
    const b = buy({ ...emptyLoot(), gold: 1e6 }, stock, ring.uid);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const got = b.value.state.inventory.items.find((p) => p.item.uid === ring.uid)!.item;
    expect(got.gamble).toBeUndefined();
    expect(got.base).toBe(ring.base);
    expect(got.level).toBe(itemLevel);
    expect(got).toEqual(revealGamble(ring));
    expect(b.value.state.gold).toBe(1e6 - gamblePrice(20, 'ring'));
    // better odds than a drop: over many gambles, a rare or better about one in four
    let good = 0;
    for (let i = 0; i < 400; i++) {
      const r = revealGamble({ ...ring, uid: `g${i}` });
      if (r.rarity === 'rare' || r.rarity === 'unique') good++;
    }
    expect(good / 400).toBeGreaterThan(0.15);
    expect(good / 400).toBeLessThan(0.45);
  });

  it('sells and buys through the wallet', () => {
    let state = emptyLoot();
    const n = rollItem(new Rng(1), { itemLevel: 30, rarity: 'magic' });
    const p = pickUp(state, n);
    if (p.ok) state = p.value;
    const s = sell(state, n.uid);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.state.gold).toBe(sellPrice(n));
    const stock = vendorStock(2, 3, 0, 'smith');
    const cheap = stock.reduce((a, b) => (buyPrice(a) < buyPrice(b) ? a : b));
    expect(buy(s.value.state, stock, cheap.uid).ok).toBe(buyPrice(cheap) <= s.value.state.gold);
    const rich = { ...s.value.state, gold: 1e6 };
    const b = buy(rich, stock, cheap.uid);
    expect(b.ok && b.value.stock.length).toBe(stock.length - 1);
  });
});

describe('loot filter', () => {
  it('hides normal items deeper and always shows uniques', () => {
    const n = rollItem(new Rng(1), { itemLevel: 30, rarity: 'normal', base: 'plate-vest' });
    expect(filterTier(n, 2)).not.toBe('hide');
    expect(filterTier(n, 20)).toBe('hide');
    expect(filterTier(makeUnique(new Rng(1), 'emberheart'), 50)).toBe('loud');
    expect(filterTier(currencyItem(new Rng(1), 'starfall-orb'), 50)).toBe('loud');
    expect(filterTier(currencyItem(new Rng(1), 'kindling-shard'), 50)).toBe('show');
  });
});
