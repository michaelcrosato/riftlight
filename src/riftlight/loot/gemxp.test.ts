import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { gemXpToNext, SCALING } from '../core/scaling';
import { requiredLevel } from './itemMods';
import { addGemXp, gemItem, gemProgress, gemWithXp, normalizeSockets, starterSockets } from './sockets';
import { sellPrice, vendorStock } from './vendor';

describe('gem levels and XP', () => {
  it('level requirements follow the hero level: fast early, 20 at 70, never decreasing', () => {
    expect([1, 2, 3, 5, 10, 20].map((g) => SCALING.gemLevelReq(g))).toEqual([1, 2, 4, 9, 25, 70]);
    for (let g = 1; g < 20; g++) expect(SCALING.gemLevelReq(g + 1)).toBeGreaterThan(SCALING.gemLevelReq(g));
    // a level-3 gem needs a level-4 hero (not 7)
    expect(requiredLevel(gemItem(new Rng(1), 'cleave', 3))).toBe(4);
  });

  it("a gem's XP to its next level is the hero's XP between the two requirements", () => {
    for (const g of [1, 4, 9, 15]) {
      let hero = 0;
      for (let l = SCALING.gemLevelReq(g); l < SCALING.gemLevelReq(g + 1); l++) hero += SCALING.xpToNext(l);
      expect(gemXpToNext(g)).toBe(hero);
    }
    expect(gemXpToNext(20)).toBe(0);
  });

  it('a socketed gem earns XP and levels up, but waits for the hero level it needs', () => {
    const gem = gemItem(new Rng(2), 'cleave', 1);
    const one = gemWithXp(gem, gemXpToNext(1) - 1, 1);
    expect(one.levels).toBe(0);
    expect(one.item.gem!.xp).toBe(gemXpToNext(1) - 1);
    const two = gemWithXp(one.item, 1, 2);
    expect(two.levels).toBe(1);
    expect(two.item.gem).toMatchObject({ level: 2, xp: 0 });
    // too low a hero: the bar fills and holds (no banking beyond one level)
    const held = gemWithXp(two.item, gemXpToNext(2) * 5, SCALING.gemLevelReq(3) - 1);
    expect(held.levels).toBe(0);
    expect(held.item.gem!.xp).toBe(gemXpToNext(2));
    expect(gemProgress(held.item, SCALING.gemLevelReq(3) - 1)).toMatchObject({ waiting: true, fraction: 1, nextReq: SCALING.gemLevelReq(3) });
    // the hero catches up: it levels on the next kill
    expect(gemWithXp(held.item, 1, SCALING.gemLevelReq(3)).item.gem!.level).toBe(3);
    // the original item is untouched (items are immutable)
    expect(gem.gem!.xp).toBeUndefined();
  });

  it('every socketed gem, skills and supports, earns the same XP; level-ups are reported', () => {
    const s = starterSockets(new Rng(3));
    s[0]!.supports[0] = gemItem(new Rng(4), 'melee-physical', 1);
    const r = addGemXp(s, gemXpToNext(1) + 10, 5);
    expect(r.levelled.map((l) => `${l.id}@${l.level}`).sort()).toEqual(['cleave@2', 'dash@2', 'frost-nova@2', 'melee-physical@2', 'war-cry@2']);
    expect(r.levelled.find((l) => l.id === 'melee-physical')).toMatchObject({ slot: 0, link: 0 });
    expect(r.sockets[0]!.gem!.gem).toMatchObject({ level: 2, xp: 10 });
    // a save without `xp` loads as 0 XP (additive field)
    const old = normalizeSockets([{ slot: 0, gem: { ...s[0]!.gem!, gem: { id: 'cleave', level: 4, support: false } }, supports: [] }]);
    expect(gemProgress(old[0]!.gem!)).toMatchObject({ level: 4, xp: 0, fraction: 0 });
  });

  it('vendors price gems by the depth they are sold at', () => {
    const shallow = vendorStock(1, 1, 0, 'gems')[0]!;
    const deep = vendorStock(1, 20, 0, 'gems')[0]!;
    expect(shallow.gem!.level).toBe(1);
    expect(deep.gem!.level).toBe(1);
    expect(sellPrice(deep)).toBeGreaterThan(sellPrice(shallow) * 3);
  });
});
