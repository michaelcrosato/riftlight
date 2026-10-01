/**
 * The balance matrix: every build × variant × depth, from plain-data inputs (level plans and
 * monster genomes the CLI generates). Pure and seeded: the same inputs give the same numbers.
 *
 *   const result = runBalance(depths, { builds: BUILDS, variants: ['naked', 'geared'], seed: 1 });
 *   result.rows      // one Row per build, variant and simulated depth
 *   result.xp        // the hero's level after each depth, with the real XP formula
 */
import { StatSheet } from '../core/mods';
import { RANK, SCALING, type Rank } from '../core/scaling';
import { Rng } from '../core/rng';
import { addXp, killXp } from '../game/progress';
import type { Equipment } from '../loot/itemMods';
import { defaultTree, pointBudget, type PassiveTree } from '../tree/tree';
import { DEFAULT_ASSUMPTIONS, type Assumptions } from './assumptions';
import { buildKey, BUILDS, type BuildArchetype, type Variant } from './builds';
import { chooseGear, scoreLoadout, TreePlanner, type ScoreContext } from './choose';
import { bossFight, curseMods, duel, heroOffense, makeLoadout, monsterOffense, monsterTarget, reachOf, type HeroLoadout, type MonsterTarget, type Offense } from './fight';
import { MINION_STATS, STAT_ALIASES, type MonsterInput } from './sheets';

export type Grade = 'normal' | 'magic' | 'rare';
export const GRADES: readonly Grade[] = ['normal', 'magic', 'rare'];

/** One depth as data: its plan (for XP and clear time) and, when simulated, its monsters. */
export interface DepthInput {
  readonly depth: number;
  readonly name: string;
  /** Critical path length in cells (metres). */
  readonly path: number;
  /** Members' ranks per pack (bosses excluded). */
  readonly packs: readonly (readonly Rank[])[];
  /** Sampled monsters per rank and the boss; present for simulated depths. */
  readonly monsters?: Readonly<Record<Grade, readonly MonsterInput[]>>;
  readonly boss?: MonsterInput;
}

export interface Row {
  build: string;
  variant: Variant;
  depth: number;
  name: string;
  level: number;
  gemLevel: number;
  /** Passive points available, and nodes the greedy tree allocated. */
  points: number;
  tree: number;
  itemLevel: number;
  life: number;
  es: number;
  armour: number;
  evasion: number;
  /** Mean of fire, cold and lightning resistance (capped). */
  res: number;
  /** DPS against a normal monster (sustained), and over a pack of 5. */
  dps: number;
  packDps: number;
  /** Share of a level's fighting the main skill is affordable (the rest: the free fallback). */
  sustain: number;
  /** Expected charges held while clearing packs (all kinds), and the share of mana the auras reserve. */
  charges: number;
  reserved: number;
  ttk: Record<Grade | 'boss', number>;
  dtps: Record<Grade | 'boss', number>;
  hitsToDie: Record<Grade | 'boss', number>;
  timeToDie: Record<Grade | 'boss', number>;
  bossDies: boolean;
  bossEnraged: boolean;
  /** Mean life + ES of the monsters fought, per rank. */
  monsterLife: Record<Grade | 'boss', number>;
  /** Seconds: walking the level, fighting its packs, the boss, and the total. */
  clear: { walk: number; packs: number; boss: number; total: number };
  /** Packs whose fight costs more than the hero's life + ES (no potions). */
  deadlyPacks: number;
  gear: string[];
}

export interface XpRow {
  depth: number;
  kills: Record<Rank, number>;
  xp: number;
  levelBefore: number;
  levelAfter: number;
}

export interface BalanceOptions {
  readonly builds?: readonly BuildArchetype[];
  readonly variants?: readonly Variant[];
  readonly seed?: number;
  readonly assumptions?: Assumptions;
  readonly tree?: PassiveTree;
  /** Progress callback (CLI). */
  readonly onRow?: (row: Row) => void;
}

export interface BalanceResult {
  readonly seed: number;
  readonly assumptions: Assumptions;
  readonly rows: Row[];
  readonly xp: XpRow[];
  /** Stats on simulated sheets that nothing in the sim read, with how many mods carried them. */
  readonly deadStats: { stat: string; mods: number }[];
  /** STAT_ALIASES that fired (contract gaps between systems). */
  readonly aliasesUsed: string[];
}

/** The XP curve: the level after clearing each depth `clears` times, in order. */
export function xpCurve(depths: readonly DepthInput[], clears = 1): XpRow[] {
  const hero = { level: 1, xp: 0 } as { level: number; xp: number };
  const out: XpRow[] = [];
  for (const d of [...depths].sort((a, b) => a.depth - b.depth)) {
    const kills: Record<Rank, number> = { normal: 0, magic: 0, rare: 0, boss: 1 };
    for (const p of d.packs) for (const r of p) kills[r]++;
    const ml = SCALING.monsterLevel(d.depth);
    let xp = 0;
    const before = hero.level;
    // kill by kill: the XP penalty for outlevelling the area depends on the level reached
    for (let i = 0; i < clears; i++)
      for (const r of Object.keys(kills) as Rank[])
        for (let k = 0; k < kills[r]; k++) {
          const got = killXp(ml, RANK[r].xp, hero.level);
          xp += got;
          addXp(hero as Parameters<typeof addXp>[0], got);
        }
    out.push({ depth: d.depth, kills, xp, levelBefore: before, levelAfter: hero.level });
  }
  return out;
}

const mean = (v: readonly number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const finiteMean = (v: readonly number[]) => {
  const f = v.filter(Number.isFinite);
  return f.length < v.length / 2 ? Infinity : mean(f);
};

export function runBalance(depths: readonly DepthInput[], o: BalanceOptions = {}): BalanceResult {
  const a = o.assumptions ?? DEFAULT_ASSUMPTIONS;
  const seed = o.seed ?? 1;
  const builds = o.builds ?? BUILDS;
  const variants = o.variants ?? ['naked', 'geared'];
  const tree = o.tree ?? defaultTree();
  const xp = xpCurve(depths, a.clears);
  const levelAt = new Map(xp.map((r) => [r.depth, r.levelBefore]));
  const reads = new Set<string>();
  const aliasesUsed = new Set<string>();
  const seenStats = new Map<string, number>();
  const rows: Row[] = [];
  const simulated = depths.filter((d) => d.monsters && d.boss).sort((x, y) => x.depth - y.depth);

  for (const build of builds) {
    for (const variant of variants) {
      const planner = new TreePlanner(tree);
      let lastGear: Equipment = {};
      for (const d of simulated) {
        const level = levelAt.get(d.depth) ?? 1;
        const itemLevel = SCALING.monsterLevel(Math.max(1, d.depth - 1));
        const targets = Object.fromEntries(GRADES.map((g) => [g, d.monsters![g].map((m) => monsterTarget(m, a))])) as Record<Grade, MonsterTarget[]>;
        const ref = targets.rare[0] ?? targets.normal[0]!;
        let equipment: Equipment = {};
        let points = 0;
        if (variant === 'geared') {
          points = pointBudget(level, d.depth - 1).total;
          // the tree grows (no respec) with the gear worn at the previous depth; then this depth's gear is picked
          const worn = lastGear;
          planner.extend(points, (mods) => scoreLoadout(makeLoadout(build, { level, tree: mods, equipment: worn, assumptions: a }), ref));
          const c: ScoreContext = { build, level, assumptions: a, ref };
          equipment = chooseGear(new Rng(seed).fork(buildKey(build, variant)).fork(`depth:${d.depth}`), c, planner.mods(), itemLevel);
          lastGear = equipment;
        }
        const setup = { level, tree: variant === 'geared' ? planner.mods() : [], equipment, assumptions: a, reads, aliasesUsed };
        const h = makeLoadout(build, setup);
        // at the boss there are no kills to keep on-kill charges up
        const hb = makeLoadout(build, { ...setup, context: 'boss' });
        // count without recording a read (RecordingSheet overrides explain)
        for (const stat of h.sheet.stats()) seenStats.set(stat, (seenStats.get(stat) ?? 0) + StatSheet.prototype.explain.call(h.sheet, stat).length);
        // the build's curse on what it fights
        const cursed = h.curse ? (Object.fromEntries(GRADES.map((g) => [g, targets[g].map((t) => monsterTarget(t.input, a, curseMods(h, t.input, a)))])) as Record<Grade, MonsterTarget[]>) : targets;
        const row = simulate(h, hb, d, cursed, a, { variant, itemLevel, points, tree: variant === 'geared' ? planner.allocated.length : 0, equipment });
        rows.push(row);
        o.onRow?.(row);
      }
    }
  }
  const aliased = (s: string) => a.aliases && (s in STAT_ALIASES || s in MINION_STATS);
  const deadStats = [...seenStats].filter(([s]) => !reads.has(s) && !aliased(s)).map(([stat, mods]) => ({ stat, mods })).sort((x, y) => y.mods - x.mods);
  return { seed, assumptions: a, rows, xp, deadStats, aliasesUsed: [...aliasesUsed].sort() };
}

function simulate(h: HeroLoadout, hb: HeroLoadout, d: DepthInput, targets: Record<Grade, MonsterTarget[]>, a: Assumptions, x: { variant: Variant; itemLevel: number; points: number; tree: number; equipment: Equipment }): Row {
  const ttk = {} as Row['ttk'];
  const dtps = {} as Row['dtps'];
  const htd = {} as Row['hitsToDie'];
  const ttd = {} as Row['timeToDie'];
  for (const g of GRADES) {
    const duels = targets[g].map((t) => duel(h, t));
    ttk[g] = mean(duels.map((u) => u.ttk));
    dtps[g] = mean(duels.map((u) => u.dtps));
    htd[g] = mean(duels.map((u) => u.hitsToDie));
    ttd[g] = finiteMean(duels.map((u) => u.timeToDie));
  }
  const boss = bossFight(hb, d.boss!, a);
  const bt = monsterTarget(d.boss!, a);
  const bossLife = bt.life + bt.es;
  ttk.boss = boss.ttk;
  dtps.boss = boss.dtps;
  htd.boss = boss.hitsToDie;
  ttd.boss = boss.timeToDie;

  // clear: walk + every pack (members drawn from the samples of their rank) + the boss. Mana is
  // a level-wide budget: the pool plus regeneration while walking and fighting pays for the
  // main skill; the rest of the fighting is done with the free fallback.
  type Cached = { off: Offense; dtps: number; skill: Map<number, number>; fallback: Map<number, number> };
  const cache = new Map<MonsterTarget, Cached>();
  const stats = (t: MonsterTarget, n: number) => {
    let c = cache.get(t);
    if (!c) cache.set(t, (c = { off: heroOffense(h, t, 10), dtps: monsterOffense(t, h).dtps, skill: new Map(), fallback: new Map() }));
    if (!c.skill.has(n)) c.skill.set(n, c.off.skill.pack(n));
    if (!c.fallback.has(n)) c.fallback.set(n, c.off.fallback.pack(n));
    return { skill: c.skill.get(n)!, fallback: c.fallback.get(n)!, dtps: c.dtps, mps: c.off.manaPerSecond, manaIn: c.off.manaIn };
  };
  const regen = Math.max(0, h.sheet.get('life.regen'));
  const moveSpeed = Math.max(0.5, h.sheet.get('move.speed'));
  const walk = (d.path * a.walkDetour) / moveSpeed;
  const packs = d.packs
    .filter((ranks) => ranks.length)
    .map((ranks, i) =>
      ranks.map((r, k) => {
        const pool = targets[r === 'boss' ? 'rare' : r];
        return pool[(i * 7 + k) % pool.length]!;
      }),
    );
  // time with the main skill only, and with the fallback only
  let tSkill = 0;
  let tFallback = 0;
  let mps = 0;
  let manaIn = 0;
  for (const members of packs) {
    const n = members.length;
    for (const m of members) {
      const s = stats(m, n);
      tSkill += (m.life + m.es) / Math.max(1e-6, s.skill);
      tFallback += (m.life + m.es) / Math.max(1e-6, s.fallback);
      mps = s.mps;
      manaIn = s.manaIn;
    }
  }
  // share f of the fighting on the main skill: f·tSkill·mps ≤ pool + manaIn·(walk + fighting)
  let sustain = 1;
  if (h.minion) {
    // minions are recast as they expire, walking or fighting
    const total = walk + tSkill;
    if (mps > 0 && total > 0) sustain = Math.min(1, (h.maxMana + manaIn * total) / (mps * total));
  } else if (mps > 0 && tSkill > 0) {
    for (let i = 0; i < 6; i++) {
      const fighting = sustain * tSkill + (1 - sustain) * tFallback;
      sustain = Math.min(1, (h.maxMana + manaIn * (walk + fighting)) / (mps * tSkill));
    }
  }
  const mix = (sk: number, fb: number) => sustain * sk + (1 - sustain) * fb;
  let packTime = 0;
  let deadly = 0;
  for (const members of packs) {
    const n = members.length;
    let time = 0;
    for (const m of members) {
      const s = stats(m, n);
      time += (m.life + m.es) / Math.max(1e-6, mix(s.skill, s.fallback));
    }
    const reach = h.minion ? 1 : reachOf(h);
    const alive = reach >= n ? 1 : 0.5 + 0.5 / n;
    let damage = 0;
    for (const m of members) damage += stats(m, n).dtps * a.packEngaged * time * alive;
    if (damage - regen * time > h.maxLife + h.es) deadly++;
    packTime += time;
  }
  const normal = targets.normal[0]!;
  const off = heroOffense(h, normal, 10);
  const cap = (v: number) => Math.min(0.75, Math.max(-2, v));
  return {
    build: h.build.id,
    variant: x.variant,
    depth: d.depth,
    name: d.name,
    level: h.level,
    gemLevel: h.gemLevel,
    points: x.points,
    itemLevel: x.itemLevel,
    life: Math.round(h.maxLife),
    es: Math.round(h.es),
    armour: Math.round(h.sheet.get('armour')),
    evasion: Math.round(h.sheet.get('evasion')),
    res: (cap(h.sheet.get('res.fire')) + cap(h.sheet.get('res.cold')) + cap(h.sheet.get('res.lightning'))) / 3,
    dps: off.single,
    packDps: off.pack(5),
    sustain,
    charges: h.charges.endurance + h.charges.frenzy + h.charges.power,
    reserved: h.reserved,
    ttk,
    dtps,
    hitsToDie: htd,
    timeToDie: ttd,
    bossDies: boss.dies,
    monsterLife: {
      normal: mean(targets.normal.map((t) => t.life + t.es)),
      magic: mean(targets.magic.map((t) => t.life + t.es)),
      rare: mean(targets.rare.map((t) => t.life + t.es)),
      boss: bossLife,
    },
    bossEnraged: boss.enraged,
    clear: { walk, packs: packTime, boss: boss.ttk, total: walk + packTime + boss.ttk },
    deadlyPacks: deadly,
    gear: Object.entries(x.equipment).map(([slot, it]) => `${slot}: ${it!.name} (${it!.base}, ilvl ${it!.level})`),
    tree: x.tree,
  };
}

