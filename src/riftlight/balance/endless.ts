/**
 * "Scales infinitely", checked: every generator the endless game leans on, run at sampled
 * depths far past any wall (1 … 1000 and beyond), with the assertions an endless run needs:
 *
 *   - the depth curves (`SCALING`) are finite, positive and never fall from one depth to the
 *     next, and grow by a bounded factor per depth (no cliff, no overflow);
 *   - the level at that depth plans, passes the reachability / bypass validator and builds in
 *     time (`validateSpec`);
 *   - monster genomes of every rank and the rift boss generate, validate and build, with
 *     finite stats once depth scaling and the boss budget are on;
 *   - items rolled at the depth's item level (100+ past depth 57) are valid: affix counts by
 *     rarity, prefix / suffix limits, no group twice, every tier unlocked at that item level,
 *     every rolled value inside its tier, finite item mods and level requirement; drops roll;
 *   - every build stays under its time budget.
 *
 *   const report = endlessCheck([1, 13, 100, 1000], { seed: 1 });
 *   report.ok, report.problems, report.depths   // per depth: curves, level, monsters, loot, ms
 *
 * `npm run balance -- endless [--max 1000] [--every 50]` prints it and writes
 * .scratch/balance/endless.json; `endless.test.ts` runs a sample in the unit tests.
 */
import { flat, type Mod, StatSheet } from '../core/mods';
import { StatQuery } from '../combat/stats';
import { Rng } from '../core/rng';
import { SCALING, type Rank } from '../core/scaling';
import type { Item } from '../core/types';
import { validateSpec } from '../levels/validate';
import { levelSpec } from '../levels/rift';
import { AFFIXES, BASES } from '../loot/content';
import { AFFIX_LIMITS, rarityBoost, rollDrops, rollItem } from '../loot/generate';
import { itemMods, requiredLevel } from '../loot/itemMods';
import { buildBoss, buildMonster, generateBoss, generateGenome, genomeBudget, MECHANIC_THEMES, validateGenome } from '../monsters';
import { bossBudget, monsterBase, monsterDepthMods } from '../wire/progression';
import { DEFAULT_ASSUMPTIONS } from './assumptions';
import { BUILDS } from './builds';
import { duel, makeLoadout, monsterTarget } from './fight';

/** The depth curves an endless run reads, by name. */
export const CURVES: Readonly<Record<string, (depth: number) => number>> = {
  monsterLife: SCALING.monsterLife,
  monsterDamage: SCALING.monsterDamage,
  hazardDamage: SCALING.hazardDamage,
  monsterLevel: SCALING.monsterLevel,
  monsterXp: (d) => SCALING.monsterXp(SCALING.monsterLevel(d)),
  xpToNext: (d) => SCALING.xpToNext(SCALING.monsterLevel(d)),
  gold: SCALING.gold,
  monsterBudget: SCALING.monsterBudget,
  eliteBudget: SCALING.eliteBudget,
  density: SCALING.density,
  rarityBoost: SCALING.rarityBoost,
  riftMechanics: (d) => (d > 12 ? SCALING.riftMechanics(d) : 2),
};

/** Largest growth from one depth to the next any curve may show in the rifts (the designed levels ramp by hand). */
export const MAX_STEP = 1.5;

export interface EndlessOptions {
  readonly seed?: number;
  /** Items rolled per depth (each rarity in turn). */
  readonly items?: number;
  /** Time budgets (ms): a level plan + geometry, one monster build, one boss build. */
  readonly maxMs?: { readonly level: number; readonly monster: number; readonly boss: number };
  /** Skip the level layouts (the slow part) for a quick curve + monster + loot pass. */
  readonly levels?: boolean;
}

export interface EndlessDepth {
  readonly depth: number;
  readonly name: string;
  readonly itemLevel: number;
  readonly curves: Record<string, number>;
  readonly level?: { readonly ok: boolean; readonly ms: number; readonly rooms: number | string; readonly monsters: number | string };
  /** Life and damage multiplier of a sampled normal monster and the boss (depth source and boss budget on). */
  readonly monster: { readonly life: number; readonly damage: number; readonly ms: number };
  readonly boss: { readonly name: string; readonly life: number; readonly damage: number; readonly ms: number };
  readonly items: { readonly rolled: number; readonly affixes: number; readonly topTier: number; readonly ms: number };
  readonly problems: string[];
}

export interface EndlessReport {
  readonly ok: boolean;
  readonly depths: EndlessDepth[];
  /** Every problem, prefixed with its depth. */
  readonly problems: string[];
  /** Curve checks over every depth 1..max (not only the sampled ones). */
  readonly curveProblems: string[];
  readonly ms: number;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const finite = (v: number) => Number.isFinite(v) && !Number.isNaN(v);

/** Monotonic, finite, bounded-step curves over every depth 1..max, plus far-off depths. */
export function checkCurves(max: number, far: readonly number[] = [1e4, 1e6, 1e9], curves: Readonly<Record<string, (depth: number) => number>> = CURVES): string[] {
  const problems: string[] = [];
  for (const [name, f] of Object.entries(curves)) {
    let prev = f(1);
    if (!finite(prev) || prev <= 0) problems.push(`${name}(1) = ${prev}`);
    for (let d = 2; d <= max; d++) {
      const v = f(d);
      if (!finite(v) || v <= 0) {
        problems.push(`${name}(${d}) = ${v}`);
        break;
      }
      if (v < prev - 1e-9 * Math.abs(prev)) {
        problems.push(`${name} falls at depth ${d}: ${prev} → ${v}`);
        break;
      }
      if (d > 12 && prev > 0 && v / prev > MAX_STEP) {
        problems.push(`${name} jumps ${(v / prev).toFixed(2)}× at depth ${d}`);
        break;
      }
      prev = v;
    }
    for (const d of far) {
      const v = f(d);
      if (!finite(v) || v <= 0) problems.push(`${name}(${d}) = ${v}: not finite that deep`);
    }
  }
  return problems;
}

/** Problems with one rolled item at `itemLevel` (empty when valid). */
export function itemProblems(item: Item, itemLevel: number): string[] {
  const out: string[] = [];
  const where = `${item.rarity} ${item.base} (ilvl ${itemLevel})`;
  if (!BASES.has(item.base)) return [`${where}: unknown base`];
  if (item.level !== Math.max(1, Math.round(itemLevel))) out.push(`${where}: item level ${item.level}`);
  const limits = AFFIX_LIMITS[item.rarity];
  const affixes = item.affixes.map((r) => ({ r, a: AFFIXES.has(r.id) ? AFFIXES.get(r.id) : null }));
  if (affixes.some((x) => !x.a)) out.push(`${where}: unknown affix ${affixes.find((x) => !x.a)!.r.id}`);
  if (item.rarity !== 'unique' && (item.affixes.length > limits.max || (limits.max > 0 && item.affixes.length < 1))) out.push(`${where}: ${item.affixes.length} affixes`);
  const prefixes = affixes.filter((x) => x.a?.type === 'prefix').length;
  const suffixes = affixes.filter((x) => x.a?.type === 'suffix').length;
  if (prefixes > limits.prefix || suffixes > limits.suffix) out.push(`${where}: ${prefixes} prefixes, ${suffixes} suffixes`);
  const groups = affixes.map((x) => x.a?.group);
  if (new Set(groups).size !== groups.length) out.push(`${where}: two affixes of one group`);
  for (const { r, a } of affixes) {
    if (!a) continue;
    const tier = a.tiers[r.tier];
    if (!tier) {
      out.push(`${where}: ${r.id} has no tier ${r.tier}`);
      continue;
    }
    if (tier.level > item.level) out.push(`${where}: ${r.id} tier ${r.tier} needs item level ${tier.level}`);
    r.mods.forEach((m, i) => {
      const t = tier.mods[i];
      if (!t || !finite(m.value) || m.value < Math.min(t.min, t.max) - 1e-9 || m.value > Math.max(t.min, t.max) + 1e-9) out.push(`${where}: ${r.id} rolled ${m.stat} ${m.value} outside ${t?.min}..${t?.max}`);
    });
  }
  for (const m of itemMods(item)) if (!finite(m.value)) out.push(`${where}: ${m.stat} = ${m.value}`);
  const req = requiredLevel(item);
  if (!finite(req) || req < 1) out.push(`${where}: required level ${req}`);
  return out;
}

/** Life and damage multipliers of a monster sheet built like the monster port builds one. */
function monsterScale(mods: readonly Mod[], depth: number, boss: boolean): { life: number; damage: number } {
  const sheet = new StatSheet();
  sheet.set('base', Object.entries(monsterBase(depth)).map(([stat, value]) => flat(stat, value)));
  sheet.set('genome', mods);
  sheet.set('depth', monsterDepthMods(depth));
  if (boss) sheet.set('boss', bossBudget(mods, depth));
  return { life: sheet.get('life'), damage: new StatQuery(sheet).scale('damage') };
}

/** Run every check at `depths` (see the file comment). */
export function endlessCheck(depths: readonly number[], o: EndlessOptions = {}): EndlessReport {
  const t0 = now();
  const seed = o.seed ?? 1;
  const budget = o.maxMs ?? { level: 1500, monster: 250, boss: 600 };
  const out: EndlessDepth[] = [];
  const max = Math.max(1, ...depths);
  const curveProblems = checkCurves(max);
  const hero = makeLoadout(BUILDS[0]!, { level: 100, assumptions: DEFAULT_ASSUMPTIONS });
  for (const depth of [...depths].sort((a, b) => a - b)) {
    const problems: string[] = [];
    const spec = levelSpec(depth, seed);
    const itemLevel = SCALING.monsterLevel(depth);
    const curves = Object.fromEntries(Object.entries(CURVES).map(([k, f]) => [k, f(depth)]));
    for (const [k, v] of Object.entries(curves)) if (!finite(v) || v <= 0) problems.push(`${k} = ${v}`);

    // the level
    let level: EndlessDepth['level'];
    if (o.levels !== false) {
      const t = now();
      const { report } = validateSpec(spec, budget.level);
      const ms = now() - t;
      level = { ok: report.ok, ms: Math.round(ms), rooms: report.stats.rooms ?? '?', monsters: report.stats.monsters ?? '?' };
      for (const p of report.problems) problems.push(`level: ${p}`);
    }

    // monsters of every rank, then the boss
    const tags = [...new Set(spec.mechanics.flatMap((m) => MECHANIC_THEMES[m] ?? []))];
    let monster = { life: 0, damage: 0, ms: 0 };
    for (const rank of ['normal', 'magic', 'rare'] as Rank[]) {
      const g = generateGenome(new Rng(seed).fork(`endless:${depth}:${rank}`), { depth, rank, tags: tags.length ? tags : undefined, archetype: spec.archetypes?.[0], budget: genomeBudget(depth, rank) });
      for (const e of validateGenome(g)) problems.push(`${rank} genome: ${e}`);
      const t = now();
      const m = buildMonster(g);
      const ms = now() - t;
      if (ms > budget.monster) problems.push(`${rank} monster built in ${ms.toFixed(0)} ms (budget ${budget.monster})`);
      if (!m.skills.length) problems.push(`${rank} monster has no skills`);
      const s = monsterScale(m.stats, depth, false);
      if (!finite(s.life) || s.life <= 0 || !finite(s.damage) || s.damage <= 0) problems.push(`${rank} monster: life ${s.life}, damage ×${s.damage}`);
      if (rank === 'normal') monster = { ...s, ms: Math.round(ms) };
      // the hit pipeline at these numbers: a level 100 hero and this monster trade blows
      const u = duel(hero, monsterTarget({ id: rank, rank, depth, mods: m.stats, skills: m.skills }, DEFAULT_ASSUMPTIONS));
      if (![u.ttk, u.dps, u.dtps, u.hitsToDie].every(finite)) problems.push(`${rank} duel: ttk ${u.ttk}, dps ${u.dps}, damage taken/s ${u.dtps}, hits to die ${u.hitsToDie}`);
    }
    const boss = depth <= 12 ? null : generateBoss(new Rng(seed).fork(`endless:boss:${depth}`), depth, spec.mechanics);
    let bossRow = { name: spec.boss ? 'designed' : '-', life: 0, damage: 0, ms: 0 };
    if (boss) {
      for (const e of validateGenome(boss.genome)) problems.push(`boss genome: ${e}`);
      const t = now();
      const bm = buildBoss(boss);
      const ms = now() - t;
      if (ms > budget.boss) problems.push(`boss built in ${ms.toFixed(0)} ms (budget ${budget.boss})`);
      if (boss.phases.length < 1) problems.push('boss has no phases');
      const s = monsterScale(bm.stats, depth, true);
      if (!finite(s.life) || s.life <= 0 || !finite(s.damage) || s.damage <= 0) problems.push(`boss: life ${s.life}, damage ×${s.damage}`);
      bossRow = { name: boss.name, ...s, ms: Math.round(ms) };
    }

    // loot at the depth's item level
    const t = now();
    const r = new Rng(seed).fork(`endless:loot:${depth}`);
    const n = o.items ?? 40;
    let affixes = 0;
    let topTier = 0;
    for (let i = 0; i < n; i++) {
      const rarity = (['normal', 'magic', 'rare', 'unique'] as const)[i % 4]!;
      const item = rollItem(r.fork(`item:${i}`), { itemLevel, rarity, rarityBoost: rarityBoost(depth) });
      problems.push(...itemProblems(item, itemLevel));
      affixes += item.affixes.length;
      for (const a of item.affixes) if (AFFIXES.has(a.id)) topTier = Math.max(topTier, a.tier === AFFIXES.get(a.id).tiers.length - 1 ? 1 : 0);
    }
    for (const rank of ['normal', 'rare', 'boss'] as Rank[]) {
      const drops = rollDrops(r.fork(`drops:${rank}`), { depth, rank });
      if (!finite(drops.gold) || drops.gold < 0) problems.push(`${rank} drop gold ${drops.gold}`);
      for (const it of drops.items) if (!it.gem && BASES.has(it.base) && BASES.get(it.base).slot !== 'currency') problems.push(...itemProblems(it, itemLevel));
    }
    const lootMs = now() - t;
    out.push({ depth, name: spec.name, itemLevel, curves, level, monster, boss: bossRow, items: { rolled: n, affixes, topTier, ms: Math.round(lootMs) }, problems });
  }
  const problems = [...curveProblems.map((p) => `curves: ${p}`), ...out.flatMap((d) => d.problems.map((p) => `depth ${d.depth}: ${p}`))];
  return { ok: problems.length === 0, depths: out, problems, curveProblems, ms: Math.round(now() - t0) };
}

/** Sampled depths for an endless check: every designed level's neighbourhood, then spaced out to `max`. */
export function endlessDepths(max = 1000, every = 50): number[] {
  const out = new Set<number>([1, 2, 5, 12, 13, 14, 20, 25, 40, 57, 58, 60, 99, 100, 101]);
  for (let d = every; d <= max; d += every) out.add(d);
  out.add(max);
  return [...out].filter((d) => d >= 1 && d <= max).sort((a, b) => a - b);
}
