// Items' words are lines (docs/game/lang.md): a name is made from its parts' lines through a joining
// line a translation can reorder, every registry entry brings its lines, gameplay hands the windows
// reason ids (never sentences), and a save keeps ids (an old save's English name still shows).
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import { Rng } from '../core/rng';
import { DAMAGE_TYPES, type Item } from '../core/types';
import { installLanguage, lineKey, riftlightLines } from '../lang';
import { CRAFT_NOTES, REASONS } from '../lang/items';
import { AFFIXES, BASES, CORRUPTIONS, CURRENCY, UNIQUES } from './content';
import { chaos, corrupt, regal, scour } from './craft';
import { FIRST, SECOND } from './data/names';
import { currencyItem, makeUnique, rollGem, rollItem } from './generate';
import { emptyLoot, equip, lootFromSave, lootToSave, pickUp, unequip } from './inventory';
import { baseName, goldLabel, itemLabel, itemName, reasonText } from './names';
import { vendorStock } from './vendor';

const lines = riftlightLines().lines;
const english = () => installLanguage(new Lang(riftlightLines()));
/** A language that orders names differently ("{base} {prefix} {suffix}", "{second} {first}"). */
const reordered = () =>
  installLanguage(
    new Lang(riftlightLines(), { xx: { by: 'test', lines: { 'item.name.magic': '{base} {prefix} {suffix}', 'item.name.magic_prefix': '{base} {prefix}', 'item.name.rare': '{second}, {first}', 'item.base.plate_vest.name': 'Gilet' } } }, { code: 'xx' }),
  );

afterEach(english);

describe('item lines', () => {
  it('every base, affix, unique, orb, rare word, class and damage type has its lines', () => {
    const want = [
      ...BASES.all()
        .filter((b) => b.slot !== 'currency')
        .map((b) => lineKey('item.base', b.id, 'name')),
      ...[...AFFIXES.all(), ...CORRUPTIONS.all()].map((a) => lineKey('item.affix', a.id, 'name')),
      ...UNIQUES.all().flatMap((u) => [lineKey('item.unique', u.id, 'name'), lineKey('item.unique', u.id, 'flavour')]),
      ...CURRENCY.all().flatMap((c) => ['name', 'description', 'short'].map((k) => lineKey('item.currency', c.id, k))),
      ...FIRST.map((w) => lineKey('item.rare.first', w)),
      ...Object.values(SECOND)
        .flat()
        .map((w) => lineKey('item.rare.second', w)),
      ...BASES.all()
        .filter((b) => b.slot !== 'currency' && b.slot !== 'gem')
        .map((b) => lineKey('item.class', b.look ?? b.slot)),
      ...DAMAGE_TYPES.map((d) => lineKey('damage', d)),
      ...Object.keys(REASONS).map((r) => `item.reason.${r}`),
      ...Object.keys(CRAFT_NOTES).map((n) => `item.craft.${n}`),
    ];
    expect(want.filter((id) => !(id in lines))).toEqual([]);
    // the English is the registry's own
    expect(lines[lineKey('item.base', 'plate-vest', 'name')]).toBe(BASES.get('plate-vest').name);
    expect(lines[lineKey('item.unique', 'emberheart', 'flavour')]).toBe(UNIQUES.get('emberheart').flavour);
  });

  it("an orb's three letters fit its icon", () => {
    for (const c of CURRENCY.all()) expect(riftlightLines().max?.[lineKey('item.currency', c.id, 'short')]).toBe(3);
  });
});

describe('item names from parts', () => {
  const magic = (): Item => {
    for (let s = 0; ; s++) {
      const m = rollItem(new Rng(s), { itemLevel: 30, rarity: 'magic', base: 'plate-vest' });
      if (m.affixes.length === 2) return m;
    }
  };

  it('a magic name is its prefix, base and suffix, in the order the language puts them', () => {
    const m = magic();
    expect(itemName(m)).toBe(m.name); // English: as rolled
    reordered();
    const [prefix, suffix] = ['prefix', 'suffix'].map((type) => AFFIXES.get(m.affixes.map((a) => AFFIXES.get(a.id)).find((a) => a.type === type)!.id).name);
    expect(itemName(m)).toBe(`Gilet ${prefix} ${suffix}`);
  });

  it("a rare keeps its two words (ids), shown through the language's joining line", () => {
    const r = rollItem(new Rng(4), { itemLevel: 30, rarity: 'rare', base: 'plate-vest' });
    expect(r.words).toHaveLength(2);
    expect(FIRST).toContain(r.words![0]);
    expect(itemName(r)).toBe(r.name);
    reordered();
    expect(itemName(r)).toBe(`${r.words![1]}, ${r.words![0]}`);
  });

  it("an old save's rare (no words) shows the name it was saved with; so does an unknown base", () => {
    const old: { -readonly [K in keyof Item]: Item[K] } = { ...rollItem(new Rng(4), { itemLevel: 30, rarity: 'rare', base: 'plate-vest' }) };
    delete old.words; // saved before rares kept their words
    reordered();
    expect(itemName({ ...old, name: 'Old Name' })).toBe('Old Name');
    expect(itemName({ ...old, base: 'gone-base', name: 'Gone' })).toBe('Gone');
  });

  it('crafting keeps the words with the rarity: regal names a rare, chaos keeps it, scour drops it', () => {
    const m = magic();
    const r = regal(new Rng(1), m);
    expect(r.ok && r.item.words?.length).toBe(2);
    if (!r.ok) return;
    expect(r.item.name).toBe(r.item.words!.join(' '));
    const c = chaos(new Rng(2), r.item);
    expect(c.ok && c.item.words).toEqual(r.item.words);
    const s = scour(new Rng(3), r.item);
    expect(s.ok && s.item.words).toBeUndefined();
    expect(s.ok && itemName(s.item)).toBe(baseName('plate-vest'));
    // a corruption that remakes a magic item as a rare names it
    for (let seed = 0; seed < 60; seed++) {
      const k = corrupt(new Rng(seed), m);
      if (k.ok && k.note === 'remade') return expect(k.item.words?.length).toBe(2);
    }
    throw new Error('no corruption remade the item in 60 tries');
  });

  it('uniques, orbs, gems and gambles show their own lines', () => {
    expect(itemName(makeUnique(new Rng(1), 'emberheart'))).toBe('Emberheart');
    expect(itemLabel(currencyItem(new Rng(1), 'kindling-shard', 3))).toBe('3x Kindling Shard');
    expect(itemLabel(currencyItem(new Rng(1), 'kindling-shard', 1))).toBe('Kindling Shard');
    expect(itemName(rollGem(new Rng(1), 10, false, 'fireball'))).toBe('Fireball');
    const gamble = vendorStock(1, 10, 0, 'gamble')[0]!;
    expect(itemName(gamble)).toBe(`Unrevealed ${BASES.get(gamble.base).name}`);
    expect(goldLabel(1)).toBe('1 gold');
    expect(goldLabel(1200)).toBe('1,200 gold');
  });

  it('a save keeps the words, and its items read in the language shown now', () => {
    const r = rollItem(new Rng(4), { itemLevel: 30, rarity: 'rare', base: 'plate-vest' });
    const got = pickUp(emptyLoot(), r);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const back = lootFromSave(JSON.parse(JSON.stringify(lootToSave(got.value))));
    const item = back.inventory.items[0]!.item;
    expect(item.words).toEqual(r.words);
    reordered();
    expect(itemName(item)).toBe(`${r.words![1]}, ${r.words![0]}`);
  });
});

describe('reasons', () => {
  it('gameplay returns reason ids and values; the windows show their lines', () => {
    const boots = rollItem(new Rng(1), { itemLevel: 60, rarity: 'normal', base: 'riftsteel-blade' });
    const s = pickUp(emptyLoot(), boots);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const r = equip(s.value, boots.uid, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason.id).toBe('requires_level');
    expect(reasonText(r.reason)).toMatch(/^Requires level \d+$/);
    const u = unequip(emptyLoot(), 'helm');
    expect(!u.ok && u.reason).toEqual({ id: 'nothing_equipped' });
  });
});
