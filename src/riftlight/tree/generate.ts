/**
 * The passive tree generator: hand-made blocks (data/) + a seed → ~1,400 linked nodes.
 *
 *   1. A start ring: one gate per region, two travel nodes between neighbouring gates.
 *   2. Each region is a sector of the wheel cut into radial bands; each band holds cluster
 *      *slots* (more slots further out). A slot picks a cluster template by the region's theme
 *      weights over the template's tags, then one of the template's hand-made shapes, then
 *      notables from the template (each notable is used once per tree). When a template runs
 *      out of notables it stops being picked; a slot with nothing left becomes a stat cluster.
 *   3. Small nodes roll their mods from a budget (data/stats.ts) and a pool: the template's
 *      pool inside clusters, the region's pool on travel paths, so regions read coherently.
 *   4. Clusters link inward band by band (plus a few sideways loops), highways cross between
 *      neighbouring regions, keystones hang off the outer edge.
 *   5. Hand-placed overrides (data/overrides.ts) are applied last and win.
 *
 * Ids are derived from *where* a node is in the structure, never from a counter, because
 * saves store allocated ids: `n:<notable>`, `k:<keystone>`, `m:<region>:<mastery>`,
 * `start:<region>`, `<region><band>.<slot>.<shapeKey>` for cluster smalls,
 * `p:<from>~<to>:<i>` for travel nodes and `ring:<a>-<b>:<i>` for the start ring. Changing
 * travel spacing, link rules or pools keeps every other id (radii can change a band's slot
 * count); changing which template a slot gets changes only that
 * cluster's small ids. Every random draw is forked by id or slot, so one change doesn't
 * reshuffle the rest of the tree.
 */
import type { Mod } from '../core/mods';
import type { Registry } from '../core/registry';
import { Rng } from '../core/rng';
import type { PassiveKind } from '../core/types';
import { CLUSTERS } from './data/clusters';
import { KEYSTONES } from './data/keystones';
import { MASTERIES } from './data/masteries';
import { OVERRIDES } from './data/overrides';
import { REGIONS } from './data/regions';
import { notableSlots, SHAPES } from './data/shapes';
import { rollMod, smallName } from './data/stats';
import type { ClusterTemplate, KeystoneDef, MasteryDef, MasteryOption, ModRoll, NodeOverride, NotableDef, RegionDef, ShapeDef, TreeNode } from './types';

export const DEFAULT_TREE_SEED = 'riftlight';

/** Layout numbers (tree units; neighbouring nodes sit ~50–65 apart). */
export const TREE_LAYOUT = {
  /** Radial bands of cluster slots per region. */
  bands: 7,
  innerRadius: 560,
  bandSpacing: 300,
  /** Minimum arc length between slots in a band. */
  slotSpacing: 330,
  startRadius: 250,
  /** Keystones sit this far beyond the outer band. */
  keystoneGap: 300,
  /** Travel nodes are placed every ~this many units along a link. */
  connectorStep: 62,
  /** Travel paths keep at least this far from nodes they don't connect. */
  clearance: 30,
  /** Masteries a region aims for: shapes with a mastery slot are favoured until it has them. */
  masteriesPerRegion: 3,
  /** Budget points of a small node in band 0 (outer bands get a little more). */
  smallBudget: 10,
  /** Degrees left free at each sector edge (highways run there). */
  sectorMargin: 8,
  /** Bands joined to the neighbouring region by a highway. */
  highwayBands: [2, 5] as readonly number[],
  /** Chance a slot is a plain stat cluster even when templates are left (band 0 always is). */
  statChance: 0.12,
  /** Chance of a second inward link, and of a sideways link to the next slot in the band. */
  extraInward: 0.3,
  sideways: 0.2,
} as const;

type Widen<T> = T extends number ? number : T;
export type TreeLayout = { -readonly [K in keyof typeof TREE_LAYOUT]: Widen<(typeof TREE_LAYOUT)[K]> };

export interface TreeGenOptions extends Partial<TreeLayout> {
  seed?: number | string;
  overrides?: readonly NodeOverride[];
  regions?: Registry<RegionDef>;
  clusters?: Registry<ClusterTemplate>;
  shapes?: Registry<ShapeDef>;
  keystones?: Registry<KeystoneDef>;
  masteries?: Registry<MasteryDef>;
}

interface Draft {
  id: string;
  name: string;
  kind: PassiveKind;
  mods: Mod[];
  x: number;
  y: number;
  links: Set<string>;
  region: string;
  cluster: string;
  template?: string;
  tags: string[];
  flavour?: string;
  lines?: readonly string[];
  options?: readonly MasteryOption[];
  budget?: number;
}

interface Slot {
  key: string;
  region: RegionDef;
  band: number;
  index: number;
  angle: number;
  radius: number;
  nodes: Draft[];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Generate the tree. Same options → same nodes, links, mods and ids, every time. */
export function generateTree(options: TreeGenOptions = {}): TreeNode[] {
  const L: TreeLayout = { ...TREE_LAYOUT, ...stripUndefined(options) };
  const seed = options.seed ?? DEFAULT_TREE_SEED;
  const regions = [...(options.regions ?? REGIONS).all()].sort((a, b) => a.angle - b.angle);
  const clusters = options.clusters ?? CLUSTERS;
  const shapes = options.shapes ?? SHAPES;
  const keystones = options.keystones ?? KEYSTONES;
  const masteries = options.masteries ?? MASTERIES;
  const root = new Rng(seed);
  const nodes = new Map<string, Draft>();
  const sector = 360 / regions.length;
  const usable = sector - 2 * L.sectorMargin;

  const add = (d: Omit<Draft, 'links'>): Draft => {
    if (nodes.has(d.id)) throw new Error(`tree: duplicate node id ${d.id}`);
    const node: Draft = { ...d, links: new Set() };
    nodes.set(d.id, node);
    return node;
  };
  const segments: [Draft, Draft][] = [];
  const link = (a: Draft, b: Draft) => {
    if (a === b || a.links.has(b.id)) return;
    a.links.add(b.id);
    b.links.add(a.id);
    segments.push([a, b]);
  };
  const smallMods = (id: string, pool: readonly ModRoll[], budget: number): Mod[] => {
    const rng = root.fork(`mods:${id}`);
    const first = rng.weighted(pool, (r) => r.weight);
    const others = pool.filter((r) => r.stat !== first.stat || (r.tags ?? []).join() !== (first.tags ?? []).join());
    if (others.length && rng.chance(0.25)) {
      const second = rng.weighted(others, (r) => r.weight);
      return [rollMod(first, budget * 0.6), rollMod(second, budget * 0.4)];
    }
    return [rollMod(first, budget)];
  };
  const small = (id: string, x: number, y: number, region: RegionDef, cluster: string, pool: readonly ModRoll[], budget: number, extra: Partial<Draft> = {}): Draft => {
    const mods = smallMods(id, pool, budget);
    return add({ id, name: smallName(mods), kind: 'small', mods, x, y, region: region.id, cluster, tags: [], budget, ...extra });
  };
  const bandBudget = (band: number) => L.smallBudget * (1 + 0.04 * Math.max(0, band));

  /**
   * Travel nodes between two groups of ports, rolled from the regions' pools. Picks the
   * shortest pair whose straight line keeps clear of other nodes and crosses no other link
   * (small nodes are preferred over notables as ports). An `optional` link that can't be
   * drawn cleanly is skipped.
   */
  const connect = (aKey: string, aPorts: Draft[], aRegion: RegionDef, bKey: string, bPorts: Draft[], bRegion: RegionDef, band: number, optional = false) => {
    let best: [Draft, Draft] | null = null;
    let bestScore = Infinity;
    let bestClean = false;
    for (const p of aPorts)
      for (const q of bPorts) {
        const d = Math.hypot(p.x - q.x, p.y - q.y) + (p.kind === 'notable' ? 45 : 0) + (q.kind === 'notable' ? 45 : 0);
        if (d >= bestScore) continue;
        const bad = blocked(p, q) + crossings(p, q);
        const score = d + 1000 * bad;
        if (score < bestScore) [bestScore, best, bestClean] = [score, [p, q], bad === 0];
      }
    if (!best || (optional && !bestClean)) return false;
    const [p, q] = best;
    const k = Math.max(0, Math.round(Math.hypot(p.x - q.x, p.y - q.y) / L.connectorStep) - 1);
    let prev = p;
    for (let i = 1; i <= k; i++) {
      const t = i / (k + 1);
      const region = i <= k / 2 ? aRegion : bRegion;
      const id = `p:${aKey}~${bKey}:${i}`;
      const node = small(id, p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, region, 'path', region.pool, bandBudget(band), { tags: ['travel'] });
      link(prev, node);
      prev = node;
    }
    link(prev, q);
    return true;
  };
  /** How many nodes (other than the ends) sit within `clearance` of the segment p→q. */
  const blocked = (p: Draft, q: Draft): number => {
    const c = L.clearance;
    const x0 = Math.min(p.x, q.x) - c;
    const x1 = Math.max(p.x, q.x) + c;
    const y0 = Math.min(p.y, q.y) - c;
    const y1 = Math.max(p.y, q.y) + c;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len2 = dx * dx + dy * dy || 1;
    let hits = 0;
    for (const n of nodes.values()) {
      if (n === p || n === q || n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
      const t = Math.max(0, Math.min(1, ((n.x - p.x) * dx + (n.y - p.y) * dy) / len2));
      if (Math.hypot(n.x - (p.x + t * dx), n.y - (p.y + t * dy)) < c) hits++;
    }
    return hits;
  };
  /** How many existing links the segment p→q would cross. */
  const crossings = (p: Draft, q: Draft): number => {
    let hits = 0;
    const x0 = Math.min(p.x, q.x);
    const x1 = Math.max(p.x, q.x);
    const y0 = Math.min(p.y, q.y);
    const y1 = Math.max(p.y, q.y);
    for (const [a, b] of segments) {
      if (a === p || a === q || b === p || b === q) continue;
      if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) continue;
      if (segmentsCross(p, q, a, b)) hits++;
    }
    return hits;
  };
  const ports = (slot: Slot) => slot.nodes.filter((n) => n.kind === 'small' || n.kind === 'notable');

  // ---------------------------------------------------------------- 1. start ring
  const starts = new Map<string, Draft>();
  for (const r of regions) {
    const a = rad(r.angle);
    starts.set(
      r.id,
      add({ id: `start:${r.id}`, name: `${r.name} Gate`, kind: 'start', mods: [], x: L.startRadius * Math.cos(a), y: L.startRadius * Math.sin(a), region: r.id, cluster: 'ring', tags: ['start', r.id], flavour: r.flavour }),
    );
  }
  regions.forEach((r, i) => {
    const next = regions[(i + 1) % regions.length]!;
    const delta = (next.angle - r.angle + 360) % 360;
    let prev = starts.get(r.id)!;
    for (let k = 1; k <= 2; k++) {
      const a = rad(r.angle + (delta * k) / 3);
      const region = k === 1 ? r : next;
      const node = small(`ring:${r.id}-${next.id}:${k}`, L.startRadius * Math.cos(a), L.startRadius * Math.sin(a), region, 'ring', region.pool, L.smallBudget * 0.8, { tags: ['ring'] });
      link(prev, node);
      prev = node;
    }
    link(prev, starts.get(next.id)!);
  });

  // ---------------------------------------------------------------- 2. cluster slots
  const slots: Slot[] = [];
  const byRegionBand = new Map<string, Slot[]>();
  for (const r of regions) {
    for (let b = 0; b < L.bands; b++) {
      const radius = L.innerRadius + b * L.bandSpacing;
      const count = Math.max(1, Math.floor((radius * rad(usable)) / L.slotSpacing));
      const list: Slot[] = [];
      for (let j = 0; j < count; j++) {
        const key = `${r.id}${b}.${j}`;
        const jr = root.fork(`slot:${key}`);
        const angle = r.angle - usable / 2 + (usable * (j + 0.5)) / count + jr.range(-1, 1) * (usable / count) * 0.12;
        const slot: Slot = { key, region: r, band: b, index: j, angle, radius: radius + jr.range(-1, 1) * L.bandSpacing * 0.06, nodes: [] };
        list.push(slot);
        slots.push(slot);
      }
      byRegionBand.set(`${r.id}:${b}`, list);
    }
  }

  // ---------------------------------------------------------------- 3. fill slots
  const remaining = new Map<string, NotableDef[]>(clusters.all().map((c) => [c.id, [...c.notables]]));
  const usedInRegion = new Map<string, number>();
  const usedMasteries = new Set<string>();
  const order = root.fork('order').shuffle([...slots]);
  const statShapes = shapes.query({ all: ['n0'] });
  for (const slot of order) {
    const r = slot.region;
    const rng = root.fork(`fill:${slot.key}`);
    const score = (c: ClusterTemplate) => c.tags.reduce((s, t) => s + (r.themes[t] ?? 0), 0);
    const eligible = slot.band === 0 || rng.chance(L.statChance) ? [] : clusters.all().filter((c) => score(c) > 0 && remaining.get(c.id)!.length > 0);
    const template = eligible.length ? rng.weighted(eligible, (c) => score(c) ** 2 / (1 + 1.5 * (usedInRegion.get(`${r.id}:${c.id}`) ?? 0))) : null;
    let shape: ShapeDef;
    let picked: NotableDef[] = [];
    if (template) {
      const left = remaining.get(template.id)!;
      const fits = template.shapes.map((id) => shapes.get(id)).filter((s) => notableSlots(s) <= left.length);
      const wantMastery = [...usedMasteries].filter((k) => k.startsWith(`${r.id}:`)).length < L.masteriesPerRegion;
      const hasMastery = (s: ShapeDef) => s.tags?.includes('mastery') && masteries.query({ any: template.tags }).some((m) => !usedMasteries.has(`${r.id}:${m.id}`));
      shape = fits.length ? rng.weighted(fits, (s) => ([1, 1, 0.8, 0.45][notableSlots(s)] ?? 0.3) * (wantMastery && hasMastery(s) ? 4 : 1)) : statShapes[0]!;
      const want = notableSlots(shape);
      for (let i = 0; i < want; i++) picked.push(left.splice(rng.int(0, left.length - 1), 1)[0]!);
      usedInRegion.set(`${r.id}:${template.id}`, (usedInRegion.get(`${r.id}:${template.id}`) ?? 0) + 1);
    } else {
      shape = rng.pick(statShapes);
      picked = [];
    }
    const pool = template?.pool ?? r.pool;
    const u = [Math.cos(rad(slot.angle)), Math.sin(rad(slot.angle))] as const;
    const t = [-u[1], u[0]] as const;
    const cx = slot.radius * u[0];
    const cy = slot.radius * u[1];
    const flip = rng.chance(0.5) ? -1 : 1;
    const local = new Map<string, Draft>();
    let notableIndex = 0;
    for (const s of shape.slots) {
      const lx = s.x * flip;
      const x = cx + lx * t[0] + s.y * u[0];
      const y = cy + lx * t[1] + s.y * u[1];
      const tags = template ? [...template.tags] : ['stat'];
      const base = { x, y, region: r.id, cluster: slot.key, ...(template ? { template: template.id } : {}) };
      let node: Draft | null = null;
      if (s.kind === 'notable') {
        const def = picked[notableIndex++]!;
        node = add({ ...base, id: `n:${def.id}`, name: def.name, kind: 'notable', mods: [...def.mods], tags, flavour: def.flavour, ...(def.lines ? { lines: def.lines } : {}) });
      } else if (s.kind === 'mastery' && template) {
        const options = masteries.query({ any: template.tags }).filter((m) => !usedMasteries.has(`${r.id}:${m.id}`));
        if (options.length) {
          const def = rng.weighted(options, (m) => m.tags!.filter((x) => template.tags.includes(x)).length);
          usedMasteries.add(`${r.id}:${def.id}`);
          node = add({ ...base, id: `m:${r.id}:${def.id}`, name: def.name, kind: 'mastery', mods: [], tags: [...tags, 'mastery'], options: def.options, flavour: 'Allocate, then choose one.' });
        }
      }
      node ??= small(`${slot.key}.${s.key}`, x, y, r, slot.key, pool, bandBudget(slot.band), { tags, ...(template ? { template: template.id } : {}) });
      local.set(s.key, node);
      slot.nodes.push(node);
    }
    for (const [a, b] of shape.links) link(local.get(a)!, local.get(b)!);
  }

  // ---------------------------------------------------------------- 4. links between clusters
  for (const r of regions) {
    const band = (b: number) => byRegionBand.get(`${r.id}:${b}`) ?? [];
    const start = starts.get(r.id)!;
    for (const s of band(0)) connect(`start:${r.id}`, [start], r, s.key, ports(s), r, 0);
    for (let b = 1; b < L.bands; b++) {
      for (const s of band(b)) {
        const rng = root.fork(`link:${s.key}`);
        const inner = [...band(b - 1)].sort((x, y) => angleDiff(x.angle, s.angle) - angleDiff(y.angle, s.angle));
        // Inward to the nearest slot, or the second nearest if that draws cleaner.
        let made = inner.slice(0, 2).find((t) => connect(t.key, ports(t), r, s.key, ports(s), r, b, true));
        if (!made) connect((made = inner[0]!).key, ports(made), r, s.key, ports(s), r, b);
        const other = inner.slice(0, 2).find((t) => t !== made);
        const step = usable / band(b - 1).length;
        if (other && angleDiff(other.angle, s.angle) < 1.5 * step && rng.chance(L.extraInward)) connect(other.key, ports(other), r, s.key, ports(s), r, b, true);
      }
    }
    for (let b = 1; b < L.bands; b++) {
      const list = band(b);
      for (let j = 0; j + 1 < list.length; j++) if (root.fork(`side:${list[j]!.key}`).chance(L.sideways)) connect(list[j]!.key, ports(list[j]!), r, list[j + 1]!.key, ports(list[j + 1]!), r, b, true);
    }
  }
  // Highways: the outermost slot of a band to the first slot of the next region's band.
  regions.forEach((r, i) => {
    const next = regions[(i + 1) % regions.length]!;
    for (const b of L.highwayBands) {
      const a = byRegionBand.get(`${r.id}:${b}`)?.at(-1);
      const z = byRegionBand.get(`${next.id}:${b}`)?.[0];
      if (a && z) connect(a.key, ports(a), r, z.key, ports(z), next, b);
    }
  });

  // ---------------------------------------------------------------- 5. keystones
  const outer = L.innerRadius + (L.bands - 1) * L.bandSpacing + L.keystoneGap;
  for (const r of regions) {
    const ks = keystones.query({ filter: (k) => (k as KeystoneDef).region === r.id });
    ks.forEach((k, i) => {
      const angle = r.angle - usable / 2 + (usable * (i + 0.5)) / ks.length;
      const node = add({
        id: `k:${k.id}`,
        name: k.name,
        kind: 'keystone',
        mods: [...k.mods],
        x: outer * Math.cos(rad(angle)),
        y: outer * Math.sin(rad(angle)),
        region: r.id,
        cluster: 'keystone',
        tags: ['keystone', ...(k.tags ?? [])],
        flavour: k.flavour,
        lines: k.lines,
      });
      const near = [...(byRegionBand.get(`${r.id}:${L.bands - 1}`) ?? [])].sort((x, y) => angleDiff(x.angle, angle) - angleDiff(y.angle, angle))[0];
      if (near) connect(near.key, ports(near), r, node.id, [node], r, L.bands);
    });
  }

  // ---------------------------------------------------------------- 6. hand-placed overrides
  for (const o of options.overrides ?? OVERRIDES) applyOverride(nodes, o);

  return [...nodes.values()].map(freeze);
}

function applyOverride(nodes: Map<string, Draft>, o: NodeOverride): void {
  let node = nodes.get(o.id);
  if (!node) {
    if (o.x === undefined || o.y === undefined || !o.name || !o.kind || !o.region) throw new Error(`tree override ${o.id}: a new node needs x, y, name, kind and region`);
    node = { id: o.id, name: o.name, kind: o.kind, mods: [], x: o.x, y: o.y, links: new Set(), region: o.region, cluster: 'override', tags: ['override'] };
    nodes.set(o.id, node);
  }
  if (o.x !== undefined) node.x = o.x;
  if (o.y !== undefined) node.y = o.y;
  if (o.name) node.name = o.name;
  if (o.kind) node.kind = o.kind;
  if (o.region) node.region = o.region;
  if (o.mods) node.mods = [...o.mods];
  if (o.flavour) node.flavour = o.flavour;
  if (o.lines) node.lines = o.lines;
  for (const id of o.link ?? []) {
    const other = nodes.get(id);
    if (!other) throw new Error(`tree override ${o.id}: link to unknown node ${id}`);
    node.links.add(id);
    other.links.add(node.id);
  }
  for (const id of o.unlink ?? []) {
    node.links.delete(id);
    nodes.get(id)?.links.delete(node.id);
  }
}

function freeze(d: Draft): TreeNode {
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    mods: d.mods,
    x: round(d.x),
    y: round(d.y),
    links: [...d.links],
    region: d.region,
    cluster: d.cluster,
    tags: d.tags,
    ...(d.template ? { template: d.template } : {}),
    ...(d.flavour ? { flavour: d.flavour } : {}),
    ...(d.lines ? { lines: d.lines } : {}),
    ...(d.options ? { options: d.options } : {}),
    ...(d.budget !== undefined ? { budget: Math.round(d.budget * 100) / 100 } : {}),
  };
}

/** True when segments p–q and a–b properly intersect. */
function segmentsCross(p: Draft, q: Draft, a: Draft, b: Draft): boolean {
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  return o(p.x, p.y, q.x, q.y, a.x, a.y) * o(p.x, p.y, q.x, q.y, b.x, b.y) < 0 && o(a.x, a.y, b.x, b.y, p.x, p.y) * o(a.x, a.y, b.x, b.y, q.x, q.y) < 0;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
