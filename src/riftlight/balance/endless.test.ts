import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { SCALING, soften } from '../core/scaling';
import { rollItem } from '../loot/generate';
import { checkCurves, endlessCheck, endlessDepths, itemProblems } from './endless';

describe('endless: the game scales without end', () => {
  it('generates levels, monsters, bosses and loot at depths 1…1000 with nothing broken', () => {
    const depths = endlessDepths(1000, 250);
    expect(depths).toContain(1000);
    expect(depths).toContain(101);
    const r = endlessCheck(depths, { seed: 1, items: 24 });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    for (const d of r.depths) {
      expect(d.level?.ok).toBe(true);
      expect(Number.isFinite(d.monster.life) && d.monster.life > 0).toBe(true);
      if (d.depth > 12) expect(Number.isFinite(d.boss.life) && d.boss.life > d.monster.life).toBe(true);
    }
    // item levels keep rising past 100, and the rolls there are still valid
    expect(r.depths.at(-1)!.itemLevel).toBeGreaterThan(1000);
    // monsters keep getting stronger, by finite steps
    const lives = r.depths.map((d) => d.curves.monsterLife!);
    for (let i = 1; i < lives.length; i++) expect(lives[i]!).toBeGreaterThan(lives[i - 1]!);
  }, 60_000);

  it('the depth curves are monotonic, finite and bounded per step, even a billion deep', () => {
    expect(checkCurves(2000)).toEqual([]);
    for (const d of [1e4, 1e6, 1e9]) {
      expect(Number.isFinite(SCALING.monsterLife(d))).toBe(true);
      expect(SCALING.monsterLife(d)).toBeGreaterThan(SCALING.monsterLife(d / 10));
    }
    // the knee: the depth itself, then logarithmic
    expect(soften(150, 200, 100)).toBe(150);
    expect(soften(300, 200, 100)).toBeCloseTo(200 + 100 * Math.log(2), 9);
  });

  it('flags the curves an endless game must not have', () => {
    const p = checkCurves(500, [1e4], { naive: (d) => Math.pow(1.18, d), dips: (d) => (d === 40 ? 1 : d), cliff: (d) => (d < 30 ? d : d * 10) });
    expect(p.some((x) => x.startsWith('naive(10000)'))).toBe(true);
    expect(p.some((x) => x.startsWith('dips falls at depth 40'))).toBe(true);
    expect(p.some((x) => x.startsWith('cliff jumps'))).toBe(true);
  });

  it('flags an item that could not have rolled at its item level', () => {
    const rng = new Rng(4);
    const ok = rollItem(rng, { itemLevel: 120, rarity: 'rare' });
    expect(itemProblems(ok, 120)).toEqual([]);
    const a = ok.affixes[0]!;
    const tampered = { ...ok, affixes: [{ ...a, mods: a.mods.map((m) => ({ ...m, value: m.value * 100 + 1000 })) }, ...ok.affixes.slice(1)] };
    expect(itemProblems(tampered, 120).some((x) => /outside/.test(x))).toBe(true);
    const low = rollItem(new Rng(4), { itemLevel: 3, rarity: 'rare' });
    expect(itemProblems({ ...low, affixes: low.affixes.map((x) => ({ ...x, tier: 5 })) }, 3).length).toBeGreaterThan(0);
  });
});
