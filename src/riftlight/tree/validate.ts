/**
 * Tree validation and statistics, shared by the unit tests and `npm run tree -- validate|stats`.
 * Errors make the CLI exit 1; warnings are printed.
 */
import { REGIONS } from './data/regions';
import { modBudget, modsBudget, STAT_NAMES } from './data/stats';
import { KEYSTONE_FLAGS } from './data/keystones';
import { PassiveTree } from './tree';
import type { TreeNode } from './types';

export interface TreeProblem {
  readonly level: 'error' | 'warn';
  readonly code: string;
  readonly message: string;
  readonly ids?: readonly string[];
}

export interface ValidateOptions {
  /** A keystone must be at least this many points from the nearest start. */
  minKeystoneDistance?: number;
  minNodes?: number;
  maxNodes?: number;
  /** Nodes closer than this (tree units) overlap on screen. */
  minSpacing?: number;
  /** A region's total budget may differ from the mean by this fraction. */
  regionBudgetTolerance?: number;
  /** A small node's mods must be worth within [lo, hi] × its budget. */
  smallBudgetRange?: readonly [number, number];
  /** Notables above this many budget points are flagged. */
  notableBudgetMax?: number;
}

export const VALIDATE_DEFAULTS: Required<ValidateOptions> = {
  minKeystoneDistance: 18,
  minNodes: 1200,
  maxNodes: 1600,
  minSpacing: 24,
  regionBudgetTolerance: 0.3,
  smallBudgetRange: [0.6, 1.5],
  notableBudgetMax: 60,
};

export interface TreeStats {
  readonly total: number;
  readonly byKind: Record<string, number>;
  readonly byRegion: Record<string, Record<string, number>>;
  readonly links: number;
  /** Budget points per region: everything, smalls only, notables only. */
  readonly budget: Record<string, { total: number; small: number; notable: number }>;
  /** Points from the nearest start for each keystone. */
  readonly keystoneDistance: Record<string, number>;
  /** Mods per stat: how many nodes carry it and the budget spent on it. */
  readonly mods: Record<string, { count: number; budget: number }>;
  readonly maxDistance: number;
}

export interface TreeReport {
  readonly problems: TreeProblem[];
  readonly stats: TreeStats;
}

export function treeStats(nodes: readonly TreeNode[]): TreeStats {
  const tree = new PassiveTree(nodes);
  const byKind: Record<string, number> = {};
  const byRegion: Record<string, Record<string, number>> = {};
  const budget: Record<string, { total: number; small: number; notable: number }> = {};
  const mods: Record<string, { count: number; budget: number }> = {};
  let links = 0;
  for (const n of nodes) {
    byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    const r = (byRegion[n.region] ??= {});
    r[n.kind] = (r[n.kind] ?? 0) + 1;
    r.total = (r.total ?? 0) + 1;
    links += n.links.length;
    if (n.kind !== 'keystone') {
      const b = (budget[n.region] ??= { total: 0, small: 0, notable: 0 });
      const v = modsBudget(n.mods);
      b.total += v;
      if (n.kind === 'small') b.small += v;
      if (n.kind === 'notable') b.notable += v;
    }
    for (const m of [...n.mods, ...(n.options ?? []).flatMap((o) => o.mods)]) {
      const s = (mods[m.stat] ??= { count: 0, budget: 0 });
      s.count++;
      s.budget += modBudget(m);
    }
  }
  for (const b of Object.values(budget)) for (const k of ['total', 'small', 'notable'] as const) b[k] = Math.round(b[k]);
  for (const s of Object.values(mods)) s.budget = Math.round(s.budget);
  const dist = tree.distances();
  const keystoneDistance: Record<string, number> = {};
  for (const n of nodes) if (n.kind === 'keystone') keystoneDistance[n.id] = dist.get(n.id) ?? -1;
  return { total: nodes.length, byKind, byRegion, links: links / 2, budget, keystoneDistance, mods, maxDistance: Math.max(0, ...dist.values()) };
}

export function validateTree(nodes: readonly TreeNode[], options: ValidateOptions = {}): TreeReport {
  const o = { ...VALIDATE_DEFAULTS, ...options };
  const problems: TreeProblem[] = [];
  const err = (code: string, message: string, ids?: string[]) => problems.push({ level: 'error', code, message, ...(ids ? { ids } : {}) });
  const warn = (code: string, message: string, ids?: string[]) => problems.push({ level: 'warn', code, message, ...(ids ? { ids } : {}) });

  // Ids and links.
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) err('duplicate-id', `duplicate id ${n.id}`, [n.id]);
    byId.set(n.id, n);
  }
  for (const n of nodes) {
    if (new Set(n.links).size !== n.links.length) err('duplicate-link', `${n.id} lists a link twice`, [n.id]);
    for (const l of n.links) {
      if (l === n.id) err('self-link', `${n.id} links to itself`, [n.id]);
      const other = byId.get(l);
      if (!other) err('dangling-link', `${n.id} links to unknown ${l}`, [n.id]);
      else if (!other.links.includes(n.id)) err('one-way-link', `${n.id} → ${l} has no way back`, [n.id, l]);
    }
    if (!n.links.length) err('orphan', `${n.id} has no links`, [n.id]);
    if (n.kind === 'mastery' && !n.options?.length) err('mastery-options', `${n.id} has no options`, [n.id]);
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) err('position', `${n.id} has no position`, [n.id]);
  }

  // Count.
  if (nodes.length < o.minNodes || nodes.length > o.maxNodes) err('count', `${nodes.length} nodes; expected ${o.minNodes}–${o.maxNodes}`);

  // Connectivity and keystone distance.
  const tree = new PassiveTree(nodes);
  if (!tree.roots.size) err('no-start', 'the tree has no start node');
  const dist = tree.distances();
  const unreachable = nodes.filter((n) => !dist.has(n.id)).map((n) => n.id);
  if (unreachable.length) err('unreachable', `${unreachable.length} node(s) can't be reached from a start: ${unreachable.slice(0, 8).join(', ')}`, unreachable);
  for (const n of nodes) {
    if (n.kind !== 'keystone') continue;
    const d = dist.get(n.id) ?? -1;
    if (d >= 0 && d < o.minKeystoneDistance) err('keystone-close', `${n.id} is only ${d} points from a start (min ${o.minKeystoneDistance})`, [n.id]);
  }

  // Regions.
  for (const r of REGIONS.all()) {
    const own = nodes.filter((n) => n.region === r.id);
    if (!own.some((n) => n.kind === 'start')) err('region-start', `region ${r.id} has no start node`);
    if (!own.some((n) => n.kind === 'keystone')) err('region-keystone', `region ${r.id} has no keystone`);
    if (!own.some((n) => n.kind === 'mastery')) warn('region-mastery', `region ${r.id} has no mastery`);
  }
  for (const n of nodes) if (n.region !== 'core' && !REGIONS.has(n.region)) err('region-unknown', `${n.id} is in unknown region ${n.region}`, [n.id]);

  // Budgets.
  const [lo, hi] = o.smallBudgetRange;
  for (const n of nodes) {
    const b = modsBudget(n.mods);
    if (n.kind === 'small' && n.budget !== undefined && (b < n.budget * lo || b > n.budget * hi)) err('small-budget', `${n.id} is worth ${b.toFixed(1)} points, budget ${n.budget}`, [n.id]);
    if (n.kind === 'notable' && b > o.notableBudgetMax) warn('notable-budget', `${n.id} (${n.name}) is worth ${b.toFixed(0)} points (max ${o.notableBudgetMax})`, [n.id]);
    if (n.kind === 'notable' && b === 0 && n.mods.length) warn('notable-unpriced', `${n.id} has no priced mods`, [n.id]);
    for (const m of n.mods) {
      if (m.kind === 'flag' || m.kind === 'override') {
        if (n.kind !== 'keystone') warn('rule-outside-keystone', `${n.id} sets ${m.kind} ${m.stat}`, [n.id]);
        continue;
      }
      if (!STAT_NAMES[m.stat] && !KEYSTONE_FLAGS[m.stat]) warn('unknown-stat', `${n.id} uses unnamed stat ${m.stat}`, [n.id]);
    }
  }
  const stats = treeStats(nodes);
  const regionTotals = REGIONS.all().map((r) => [r.id, stats.budget[r.id]?.total ?? 0] as const);
  const mean = regionTotals.reduce((s, [, v]) => s + v, 0) / Math.max(1, regionTotals.length);
  for (const [id, v] of regionTotals) {
    if (Math.abs(v - mean) > mean * o.regionBudgetTolerance) err('region-budget', `region ${id} totals ${v} budget points; mean ${Math.round(mean)} (±${o.regionBudgetTolerance * 100}%)`);
  }

  // Layout: overlapping nodes, links running through other nodes.
  const cell = Math.max(o.minSpacing, 40);
  const grid = new Map<string, TreeNode[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const n of nodes) {
    const k = key(n.x, n.y);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(n);
  }
  const near = (x: number, y: number, r: number): TreeNode[] => {
    const out: TreeNode[] = [];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const span = Math.ceil(r / cell);
    for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) out.push(...(grid.get(`${cx + i},${cy + j}`) ?? []));
    return out;
  };
  const overlaps: string[] = [];
  for (const n of nodes) for (const m of near(n.x, n.y, o.minSpacing)) if (m.id > n.id && Math.hypot(m.x - n.x, m.y - n.y) < o.minSpacing) overlaps.push(`${n.id}/${m.id}`);
  if (overlaps.length) err('overlap', `${overlaps.length} node pair(s) closer than ${o.minSpacing}: ${overlaps.slice(0, 6).join(', ')}`, overlaps.flatMap((p) => p.split('/')));
  const through: string[] = [];
  for (const n of nodes) {
    for (const l of n.links) {
      if (l < n.id) continue;
      const m = byId.get(l);
      if (!m) continue;
      const len = Math.hypot(m.x - n.x, m.y - n.y);
      const steps = Math.ceil(len / cell);
      const seen = new Set<string>();
      for (let s = 0; s <= steps; s++) {
        const px: number = n.x + ((m.x - n.x) * s) / Math.max(1, steps);
        const py: number = n.y + ((m.y - n.y) * s) / Math.max(1, steps);
        for (const q of near(px, py, 12)) {
          if (q === n || q === m || seen.has(q.id)) continue;
          seen.add(q.id);
          if (segmentDistance(q.x, q.y, n.x, n.y, m.x, m.y) < 10) through.push(`${n.id}-${m.id} over ${q.id}`);
        }
      }
    }
  }
  if (through.length) warn('link-through-node', `${through.length} link(s) pass over another node: ${through.slice(0, 4).join('; ')}`);

  return { problems, stats };
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
