import { describe, expect, it } from 'vitest';
import { flat, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import { ACTOR_BASE } from '../combat/tuning';
import { rollItem } from '../loot/generate';
import { requiredLevel } from '../loot/itemMods';
import { gemItem, starterSockets } from '../loot/sockets';
import { defaultTree, pointBudget } from '../tree/tree';
import { HERO_BASE_STATS, levelMods, starterWeapon } from '../wire/progression';
import { evaluate, gearScore, rig, townVisit } from './botTown';
import { newSave } from './save';

/** The real hero's sheet at a level (base, the level source, the starter sword). */
function heroSheet(level: number): StatSheet {
  const s = new StatSheet({ ...ACTOR_BASE, ...HERO_BASE_STATS });
  s.set('level', levelMods(level));
  s.set('starter', starterWeapon());
  return s;
}

describe('the bot in town', () => {
  it('scores damage and effective life on a clone (the hero sheet is untouched)', () => {
    const sheet = heroSheet(5);
    const sockets = starterSockets(new Rng(1));
    const base = evaluate(sheet, sockets, 3);
    const tougher = sheet.clone();
    tougher.set('gear', [flat('life', 200), flat('res.fire', 0.4)]);
    const t = evaluate(tougher, sockets, 3);
    expect(t.ehp).toBeGreaterThan(base.ehp * 1.5);
    expect(t.score).toBeGreaterThan(base.score);
    expect(sheet.hasSource('gear')).toBe(false);
    // the starter sword goes once a weapon is worn
    const sword = rollItem(new Rng(2), { itemLevel: 10, base: 'arming-sword', rarity: 'rare' });
    expect(rig(sheet, { weapon: sword }).hasSource('starter')).toBe(false);
    expect(rig(sheet, {}).hasSource('starter')).toBe(true);
  });

  it('equips upgrades, sockets a fitting support, sells the rest and spends its passive points', () => {
    const save = newSave(5);
    save.hero.level = 12;
    save.deepest = 5;
    save.hero.skills = starterSockets(new Rng(5));
    const rng = new Rng(9);
    for (let i = 0; i < 30; i++) save.hero.inventory.push(rollItem(rng.fork(`i${i}`), { itemLevel: 14, rarity: i % 3 ? 'magic' : 'rare' }));
    save.hero.inventory.push(rollItem(rng.fork('too high'), { itemLevel: 80, rarity: 'rare' }));
    save.hero.inventory.push(gemItem(rng.fork('mp'), 'melee-physical', 1));
    const sheet = heroSheet(12);
    const points = pointBudget(12, 5).total;
    const r = townVisit(save, { sheet, points, depth: 6, visit: 3, buy: false });
    expect(r.equipped.length).toBeGreaterThan(3);
    expect(r.after.score).toBeGreaterThan(r.before.score);
    expect(r.gearScore).toBe(gearScore(save.hero.equipment));
    for (const it of Object.values(save.hero.equipment)) expect(requiredLevel(it!)).toBeLessThanOrEqual(12);
    // a melee build keeps a melee weapon
    expect(['bow', 'wand'].some((c) => save.hero.equipment.weapon?.base.includes(c))).toBe(false);
    expect(save.hero.skills[0]!.supports.some((g) => g?.gem?.id === 'melee-physical')).toBe(true);
    // the bag is sold (junk, the item it can't wear yet)
    expect(save.hero.inventory).toEqual([]);
    expect(r.soldGold).toBeGreaterThan(0);
    expect(save.hero.gold).toBe(r.soldGold);
    // passive points: within the budget and connected to a start gate
    expect(save.hero.allocated.length).toBe(points);
    const tree = defaultTree();
    const owned = new Set([...tree.roots, ...save.hero.allocated]);
    const seen = new Set([...tree.roots]);
    const queue = [...tree.roots];
    while (queue.length) {
      for (const nb of tree.neighbours(queue.shift()!)) {
        if (!owned.has(nb) || seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
    for (const id of save.hero.allocated) expect(seen.has(id)).toBe(true);
  });

  it('buys from the vendors with the gold it has, and only what it can pay', () => {
    const save = newSave(6);
    save.hero.level = 8;
    save.deepest = 3;
    save.hero.gold = 400;
    save.hero.skills = starterSockets(new Rng(6));
    const r = townVisit(save, { sheet: heroSheet(8), points: 0, depth: 4, visit: 1 });
    expect(save.hero.gold).toBe(400 - r.spent + r.soldGold);
    expect(save.hero.gold).toBeGreaterThanOrEqual(0);
    if (r.bought.length) expect(r.spent).toBeGreaterThan(0);
  });
});
