import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WIRE_TUNING } from '../wire/tuning';
import { StatQuery } from '../combat/stats';
import { flat, more, StatSheet } from '../core/mods';
import { RANK, SCALING } from '../core/scaling';
import { addXp, killXp } from '../game/progress';
import { buildSkill } from '../skills/build';
import { defaultTree } from '../tree/tree';
import {
  aliasMods,
  BUILDS,
  DEFAULT_ASSUMPTIONS,
  duel,
  findOutliers,
  gemLevelFor,
  HERO_BASE,
  heroOffense,
  makeLoadout,
  monsterTarget,
  packFight,
  runBalance,
  skillDps,
  TreePlanner,
  xpCurve,
  type DepthInput,
  type MonsterInput,
  type Row,
} from './index';

const A = DEFAULT_ASSUMPTIONS;
const build = (id: string) => BUILDS.find((b) => b.id === id)!;
const monster = (o: Partial<MonsterInput> = {}): MonsterInput => ({ id: 'm', rank: 'normal', depth: 1, mods: [], skills: ['bite'], ...o });

describe('balance: sheets and scaling', () => {
  it('uses the hero base the real hero port gives the hero actor (HeroController base + WIRE_TUNING)', () => {
    const src = readFileSync(new URL('../actors/HeroController.ts', import.meta.url), 'utf8');
    const m = /base: \{ (life: [^}]*?), \.\.\.o\.base \}/.exec(src);
    expect(m, 'HeroController base literal').toBeTruthy();
    const parsed = Object.fromEntries(m![1]!.split(',').map((kv) => kv.split(':').map((s) => s.trim().replace(/'/g, ''))).map(([k, v]) => [k, Number(v)]));
    expect({ ...parsed, ...WIRE_TUNING.hero.base }).toEqual(HERO_BASE);
  });

  it('scales monster life with depth and rank like the genome mods say', () => {
    const t1 = monsterTarget(monster({ depth: 1 }), A);
    const t9 = monsterTarget(monster({ depth: 9, rank: 'rare', mods: [more('life', RANK.rare.life - 1)] }), A);
    expect(t1.life).toBeCloseTo(A.monsterBase.life!, 6);
    expect(t9.life).toBeCloseTo(A.monsterBase.life! * SCALING.monsterLife(9) * RANK.rare.life, 6);
  });

  it('maps renamed stats to what combat reads (every StatSheet does, core/stats.ts)', () => {
    const used = new Set<string>();
    const mods = aliasMods([flat('crit.multi', 0.5), flat('res.elemental', 0.1), flat('life', 5)], used);
    expect(mods.map((m) => m.stat)).toEqual(['crit.multiplier', 'res.fire', 'res.cold', 'res.lightning', 'life']);
    expect([...used]).toHaveLength(2);
    const on = makeLoadout(build('melee'), { level: 10, tree: [flat('crit.multi', 1)], assumptions: A });
    const off = makeLoadout(build('melee'), { level: 10, tree: [flat('crit.multi', 1)], assumptions: { ...A, aliases: false } });
    const t = monsterTarget(monster(), A);
    expect(skillDps(on.sheet, on.skill, t.defender).hit!.critMultiplier).toBeCloseTo(2.5);
    // the canonical names are built into every StatSheet now, so --raw no longer loses the stat
    expect(skillDps(off.sheet, off.skill, t.defender).hit!.critMultiplier).toBeCloseTo(2.5);
  });

  it('gives the highest gem level the hero can equip (SCALING.gemLevelReq)', () => {
    expect([1, 3, 4, 31, 60, 100].map(gemLevelFor)).toEqual([1, 2, 3, 11, 18, 20]);
    for (const level of [1, 7, 25, 70]) expect(SCALING.gemLevelReq(gemLevelFor(level))).toBeLessThanOrEqual(level);
  });
});

describe('balance: fights', () => {
  it('time to kill is life over the DPS the combat tool reports', () => {
    const h = makeLoadout(build('caster'), { level: 1, assumptions: { ...A, monsterBase: { ...A.monsterBase, life: 60 } } });
    const t = monsterTarget(monster(), { ...A, monsterBase: { ...A.monsterBase, life: 60 } });
    const d = duel(h, t);
    const r = skillDps(h.sheet, h.skill, t.defender);
    expect(d.sustain).toBe(1); // a 50 mana pool pays for a short fight
    expect(d.ttk).toBeCloseTo(60 / r.dps.total, 6);
  });

  it('falls back to the free skill when mana runs out', () => {
    const h = makeLoadout(build('caster'), { level: 1, tree: [more('cost', 20)], assumptions: A });
    const t = monsterTarget(monster({ mods: [more('life', 50)] }), A);
    const off = heroOffense(h, t, 120);
    expect(off.sustain).toBeLessThan(0.2);
    expect(off.single).toBeGreaterThan(Math.min(off.skill.single, off.fallback.single) - 1e-9);
    expect(off.single).toBeLessThan(Math.max(off.skill.single, off.fallback.single) + 1e-9);
  });

  it('monster damage scales with depth and armour cuts it', () => {
    const h = makeLoadout(build('melee'), { level: 1, assumptions: A });
    const armoured = makeLoadout(build('melee'), { level: 1, tree: [flat('armour', 400)], assumptions: A });
    const d1 = duel(h, monsterTarget(monster({ depth: 1 }), A));
    const d10 = duel(h, monsterTarget(monster({ depth: 10 }), A));
    expect(d10.dtps / d1.dtps).toBeCloseTo(SCALING.monsterDamage(10), 1);
    expect(duel(armoured, monsterTarget(monster(), A)).dtps).toBeLessThan(d1.dtps * 0.7);
    expect(d1.hitsToDie).toBeGreaterThan(1);
  });

  it('a pack inside the reach dies in total life over pack DPS', () => {
    const h = makeLoadout(build('melee'), { level: 5, assumptions: A });
    const ms = [0, 1, 2].map(() => monsterTarget(monster(), A));
    const p = packFight(h, ms);
    const pack = heroOffense(h, ms[0]!, 10).pack(3);
    expect(p.time).toBeCloseTo((3 * ms[0]!.life) / pack, 6);
    expect(p.damage).toBeGreaterThan(0);
  });

  it('minions fight with the summon gem damage at their own attack speed, like placeholderMinion', () => {
    const h = makeLoadout(build('minion'), { level: 10, assumptions: A });
    expect(h.minion!.count).toBe(6);
    expect(h.minion!.attack.castTime).toBeCloseTo(0.8 / new StatQuery(h.minion!.sheet).scale('attack.speed', ['attack', 'melee', 'strike', 'physical', 'damage', 'minion']), 6);
    expect(h.minion!.attack.castTime).toBeLessThan(0.8); // the build links Minion Speed
    const t = monsterTarget(monster(), A);
    const per = skillDps(h.minion!.sheet, h.minion!.attack, t.defender).dps.total;
    expect(heroOffense(h, t).single).toBeCloseTo(per * 6, 6);
  });
});

describe('balance: progression, choices, outliers', () => {
  const packs = [['normal', 'normal', 'magic'], ['normal', 'rare']] as const;

  it('levels with the real XP formula', () => {
    const depths: DepthInput[] = [1, 2, 3].map((depth) => ({ depth, name: `d${depth}`, path: 40, packs: packs.map((p) => [...p]) }));
    const xp = xpCurve(depths);
    const hero = { level: 1, xp: 0 };
    for (const d of [1, 2, 3]) {
      const ml = SCALING.monsterLevel(d);
      for (const r of ['normal', 'normal', 'normal', 'magic', 'rare', 'boss'] as const) addXp(hero as never, killXp(ml, RANK[r].xp, hero.level));
      expect(xp[d - 1]!.levelAfter).toBe(hero.level);
    }
    expect(xp[0]!.levelBefore).toBe(1);
  });

  it('grows the tree connected to a start node, within the points', () => {
    const tree = defaultTree();
    const p = new TreePlanner(tree);
    const value = (mods: readonly { stat: string; value: number; kind: string }[]) => mods.filter((m) => m.stat === 'life' && m.kind === 'flat').reduce((s, m) => s + m.value, 0);
    p.extend(8, value);
    expect(p.allocated.length).toBeGreaterThan(0);
    expect(p.allocated.length).toBeLessThanOrEqual(8);
    const set = new Set([...tree.roots, ...p.allocated]);
    for (const id of p.allocated) expect(tree.neighbours(id).some((n) => set.has(n))).toBe(true);
    const before = [...p.allocated];
    p.extend(14, value);
    expect(p.allocated.slice(0, before.length)).toEqual(before); // no respec
  });

  it('runs a seeded matrix: the same inputs give the same rows; gear and tree help', () => {
    const mk = (depth: number): DepthInput => ({
      depth,
      name: `d${depth}`,
      path: 50,
      packs: packs.map((p) => [...p]),
      monsters: { normal: [monster({ depth })], magic: [monster({ depth, rank: 'magic', mods: [more('life', 1.2)] })], rare: [monster({ depth, rank: 'rare', mods: [more('life', 3.5), more('damage', 0.5)], skills: ['claw', 'slam'] })] },
      boss: monster({ id: 'boss', depth, rank: 'boss', mods: [more('life', 29), more('damage', 1)], skills: ['swing', 'slam'], phases: [[], [more('damage', 0.2)]], enrage: { after: 60, mods: [more('damage', 0.5)] } }),
    });
    const depths = [1, 2, 3, 4, 5, 6].map(mk);
    const opts = { builds: [build('bow')], seed: 3, assumptions: { ...A, gearCandidates: 2 } };
    const a = runBalance(depths, opts);
    const b = runBalance(depths, opts);
    expect(a.rows).toEqual(b.rows);
    expect(a.rows).toHaveLength(12);
    const at = (v: string, d: number) => a.rows.find((r) => r.variant === v && r.depth === d)!;
    expect(at('geared', 6).dps).toBeGreaterThan(at('naked', 6).dps);
    expect(at('geared', 6).tree).toBeGreaterThan(0);
    expect(at('geared', 6).gear.length).toBeGreaterThan(3);
    for (const r of a.rows) {
      expect(r.clear.total).toBeCloseTo(r.clear.walk + r.clear.packs + r.clear.boss, 6);
      expect(r.ttk.boss).toBeGreaterThan(r.ttk.normal);
    }
  });

  it('finds jumps and builds far from the others', () => {
    const row = (build: string, depth: number, boss: number): Row =>
      ({
        build, variant: 'geared', depth, name: '', level: 1, gemLevel: 1, points: 0, tree: 0, itemLevel: 1, life: 100, es: 0, armour: 0, evasion: 0, res: 0, dps: 1, packDps: 1, sustain: 1,
        ttk: { normal: 1, magic: 2, rare: 3, boss }, dtps: { normal: 1, magic: 1, rare: 1, boss: 1 }, hitsToDie: { normal: 9, magic: 9, rare: 9, boss: 9 }, timeToDie: { normal: Infinity, magic: Infinity, rare: Infinity, boss: Infinity },
        bossDies: false, bossEnraged: false, monsterLife: { normal: 1, magic: 1, rare: 1, boss: 1 }, clear: { walk: 1, packs: 1, boss, total: 2 + boss }, deadlyPacks: 0, gear: [],
      }) as Row;
    const rows = ['a', 'b', 'c', 'd'].flatMap((b) => [1, 2, 3].map((d) => row(b, d, b === 'd' ? 100 : d === 3 ? 30 : 10)));
    const out = findOutliers(rows);
    expect(out.some((o) => o.kind === 'jump' && o.depth === 3 && o.metric === 'ttk.boss' && /every build/.test(o.text))).toBe(true);
    expect(out.some((o) => o.kind === 'spread' && o.build === 'd' && /slower/.test(o.text))).toBe(true);
    expect(out[0]!.severity).toBeGreaterThanOrEqual(out[out.length - 1]!.severity);
  });

  it('skills resolve with the same buildSkill the game uses', () => {
    const sheet = new StatSheet();
    const h = makeLoadout(build('caster'), { level: 7, assumptions: A });
    expect(h.skill.supports).toEqual(build('caster').supports);
    expect(h.skill.level).toBe(gemLevelFor(7));
    expect(buildSkill('fireball', [], sheet).id).toBe(h.skill.id);
  });
});
