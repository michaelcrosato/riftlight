/**
 * What a tuning agent should look at first: sudden jumps between depths, builds far from
 * the others, gear that doesn't help, and absolute red flags (one-shots, unwinnable bosses,
 * mana starvation, very long clears). Each outlier has a severity (1 ≈ worth a look) and a
 * sentence. Pure.
 */
import type { Row } from './sim';

export interface Outlier {
  readonly severity: number;
  readonly kind: 'jump' | 'spread' | 'gear' | 'flag';
  readonly metric: string;
  readonly depth: number;
  readonly build?: string;
  readonly text: string;
}

interface Metric {
  readonly id: string;
  readonly label: string;
  readonly get: (r: Row) => number;
  /** True when bigger is worse for the player (times, damage taken). */
  readonly worse: boolean;
}

export const METRICS: readonly Metric[] = [
  { id: 'ttk.normal', label: 'normal TTK', get: (r) => r.ttk.normal, worse: true },
  { id: 'ttk.magic', label: 'magic TTK', get: (r) => r.ttk.magic, worse: true },
  { id: 'ttk.rare', label: 'rare TTK', get: (r) => r.ttk.rare, worse: true },
  { id: 'ttk.boss', label: 'boss TTK', get: (r) => r.ttk.boss, worse: true },
  { id: 'dtps.rare', label: 'damage taken/s from a rare', get: (r) => r.dtps.rare / Math.max(1, r.life + r.es), worse: true },
  { id: 'dtps.boss', label: 'boss damage/s (share of life)', get: (r) => r.dtps.boss / Math.max(1, r.life + r.es), worse: true },
  { id: 'clear', label: 'clear time', get: (r) => r.clear.total, worse: true },
];

export interface OutlierOptions {
  /** Per-depth ratio that counts as a jump (and its inverse). */
  readonly jump?: number;
  /** Ratio to the median of the other builds that counts as an outlier. */
  readonly spread?: number;
}

const median = (v: readonly number[]) => {
  const s = [...v].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
const secs = (v: number) => (v >= 120 ? `${(v / 60).toFixed(1)} min` : `${fmt(v)} s`);

export function findOutliers(rows: readonly Row[], o: OutlierOptions = {}): Outlier[] {
  const jumpAt = o.jump ?? 1.8;
  const spreadAt = o.spread ?? 3;
  const out: Outlier[] = [];
  const variants = [...new Set(rows.map((r) => r.variant))];
  const builds = [...new Set(rows.map((r) => r.build))];
  const depths = [...new Set(rows.map((r) => r.depth))].sort((a, b) => a - b);
  const at = new Map(rows.map((r) => [`${r.build}/${r.variant}/${r.depth}`, r]));
  const row = (b: string, v: string, d: number) => at.get(`${b}/${v}/${d}`);

  // ---- jumps between consecutive simulated depths (content: all builds; or one build alone)
  for (const m of METRICS) {
    for (const v of variants) {
      for (let i = 1; i < depths.length; i++) {
        const d0 = depths[i - 1]!;
        const d1 = depths[i]!;
        const ratios = builds.map((b) => {
          const r0 = row(b, v, d0);
          const r1 = row(b, v, d1);
          return r0 && r1 && m.get(r0) > 0 && Number.isFinite(m.get(r0)) && Number.isFinite(m.get(r1)) ? m.get(r1) / m.get(r0) : NaN;
        });
        const step = (r: number) => Math.pow(r, 1 / (d1 - d0));
        const med = median(ratios);
        const gap = d1 - d0 > 1 ? ` (${fmt(step(med))}× per depth)` : '';
        if (Number.isFinite(med) && (step(med) > jumpAt || step(med) < 1 / jumpAt)) {
          out.push({ severity: Math.abs(Math.log(step(med))) / Math.log(jumpAt), kind: 'jump', metric: m.id, depth: d1, text: `depth ${d1} ${m.label} ${fmt(med)}× depth ${d0}${gap} (${v}, every build)` });
          continue;
        }
        builds.forEach((b, k) => {
          const r = ratios[k]!;
          if (!Number.isFinite(r)) return;
          const s = step(r);
          if (s > jumpAt || s < 1 / jumpAt) {
            out.push({ severity: (0.8 * Math.abs(Math.log(s))) / Math.log(jumpAt), kind: 'jump', metric: m.id, depth: d1, build: b, text: `${v} ${b}: depth ${d1} ${m.label} ${fmt(r)}× depth ${d0}${d1 - d0 > 1 ? ` (${fmt(s)}× per depth)` : ''}` });
          }
        });
      }
    }
  }

  // ---- one build far from the others (summarised over depths)
  for (const m of METRICS.filter((x) => x.id === 'ttk.boss' || x.id === 'ttk.normal' || x.id === 'clear' || x.id === 'dtps.boss')) {
    for (const v of variants) {
      for (const b of builds) {
        let worst = { k: 1, d: 0 };
        let count = 0;
        for (const d of depths) {
          const mine = row(b, v, d);
          if (!mine) continue;
          const others = median(builds.filter((x) => x !== b).map((x) => (row(x, v, d) ? m.get(row(x, v, d)!) : NaN)));
          const k = others / m.get(mine); // > 1: this build does better (smaller time / damage)
          if (!Number.isFinite(k) || k <= 0) continue;
          if (k > spreadAt || k < 1 / spreadAt) count++;
          if (Math.abs(Math.log(k)) > Math.abs(Math.log(worst.k))) worst = { k, d };
        }
        if (!count) continue;
        const better = worst.k > 1;
        const times = better ? worst.k : 1 / worst.k;
        const text =
          m.id === 'dtps.boss'
            ? `${v} ${b} takes ${fmt(times)}× ${better ? 'less' : 'more'} boss damage (share of life) than the others (${count}/${depths.length} depths, worst at depth ${worst.d})`
            : `${v} ${b}: ${m.label} ${fmt(times)}× ${better ? 'faster' : 'slower'} than the others (${count}/${depths.length} depths, worst at depth ${worst.d})`;
        out.push({ severity: (Math.abs(Math.log(times)) / Math.log(spreadAt)) * (0.6 + (0.4 * count) / depths.length), kind: 'spread', metric: m.id, depth: worst.d, build: b, text });
      }
    }
  }

  // ---- gear and tree that don't help
  if (variants.includes('naked') && variants.includes('geared')) {
    for (const b of builds) {
      const ks = depths
        .filter((d) => d >= 8)
        .map((d) => {
          const n = row(b, 'naked', d);
          const g = row(b, 'geared', d);
          return n && g ? { d, k: n.ttk.boss / g.ttk.boss } : null;
        })
        .filter((x): x is { d: number; k: number } => !!x);
      if (!ks.length) continue;
      const best = ks.reduce((a, x) => (x.k > a.k ? x : a));
      if (best.k < 1.5) out.push({ severity: 1.6 - best.k + 0.5, kind: 'gear', metric: 'ttk.boss', depth: best.d, build: b, text: `${b}: gear + tree make the boss die at most ${fmt(best.k)}× faster than naked (depth ${best.d}); its damage ignores what it wears` });
    }
  }

  // ---- red flags, first depth + how often
  // a flag most builds share is a content problem: one line for all of them
  const flag = (id: string, test: (r: Row) => boolean, say: (r: Row, n: number) => string, weight: number, all?: (first: Row, builds: number) => string) => {
    for (const v of variants) {
      const hit = builds.map((b) => ({ b, rows: depths.map((d) => row(b, v, d)).filter((r): r is Row => !!r && test(r)) })).filter((x) => x.rows.length);
      if (all && builds.length > 2 && hit.length >= builds.length - 1) {
        const first = hit.map((x) => x.rows[0]!).sort((a, b) => a.depth - b.depth);
        const n = Math.max(...hit.map((x) => x.rows.length));
        // the depth by which all but one build are flagged
        const by = first[Math.max(0, first.length - 2)]!;
        out.push({ severity: 1.4 * weight * (0.7 + (0.6 * n) / depths.length), kind: 'flag', metric: id, depth: by.depth, text: all(by, hit.length) + ` (first: ${first.map((r) => `${r.build} d${r.depth}`).join(', ')})` });
        continue;
      }
      for (const { b, rows: hits } of hit) out.push({ severity: weight * (0.7 + (0.6 * hits.length) / depths.length), kind: 'flag', metric: id, depth: hits[0]!.depth, build: b, text: say(hits[0]!, hits.length) });
    }
  };
  flag('boss.dies', (r) => r.bossDies && r.variant === 'geared', (r, n) => `geared ${r.build} dies to the boss at depth ${r.depth} (${n} depths; boss TTK ${secs(r.ttk.boss)}, hero lasts ${secs(r.timeToDie.boss)})`, 1.5, (r, k) => `${k} geared builds die to the boss (no potions), all but one by depth ${r.depth}`);
  flag('oneshot', (r) => r.hitsToDie.boss < 1 && r.variant === 'geared', (r, n) => `geared ${r.build} is one-shot by the depth ${r.depth} boss (${fmt(r.hitsToDie.boss)} hits to die; ${n} depths)`, 1.4, (r, k) => `${k} geared builds are one-shot by the boss's biggest hit, all but one by depth ${r.depth}`);
  flag('boss.long', (r) => r.ttk.boss > 180 && r.variant === 'geared', (r, n) => `geared ${r.build}: the depth ${r.depth} boss takes ${secs(r.ttk.boss)} (${n} depths over 3 min)`, 1.2, (r, k) => `${k} geared builds need over 3 min for the boss, all but one by depth ${r.depth}`);
  flag('mana', (r) => r.sustain < 0.5, (r, n) => `${r.variant} ${r.build} can afford its skill only ${Math.round(r.sustain * 100)}% of the time at depth ${r.depth} (${n} depths)`, 1.1);
  flag('clear.long', (r) => r.clear.total > 900 && r.variant === 'geared', (r, n) => `geared ${r.build}: depth ${r.depth} takes ${secs(r.clear.total)} to clear (${n} depths over 15 min)`, 1, (r, k) => `${k} geared builds need over 15 min per level, all but one by depth ${r.depth}`);
  flag('packs', (r) => r.deadlyPacks > 0 && r.variant === 'geared', (r, n) => `geared ${r.build}: ${r.deadlyPacks} packs at depth ${r.depth} deal more than life + ES before they die (${n} depths)`, 1, (r, k) => `${k} geared builds meet packs that out-damage their life + ES, all but one by depth ${r.depth}`);

  // naked builds are the floor, not the game: their outliers matter less; one spread line per build
  const weighted = out.map((x) => (/\bnaked\b/.test(x.text) && x.kind !== 'gear' ? { ...x, severity: x.severity * 0.7 } : x));
  const spreadSeen = new Set<string>();
  return weighted
    .sort((a, b) => b.severity - a.severity)
    .filter((x) => {
      if (x.kind !== 'spread') return true;
      const k = `${x.build}/${x.text.split(' ')[0]}`;
      if (spreadSeen.has(k)) return false;
      spreadSeen.add(k);
      return true;
    });
}
