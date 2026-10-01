/**
 * Passive tree logic: graph queries, allocation rules, point accounting, respec cost, the
 * mods a set of allocated nodes grants, search, and a stat summary. Pure and DOM-free.
 *
 *   const tree = defaultTree();                         // the canonical tree (cached)
 *   const state = TreeState.load(tree, save.hero.allocated, pointBudget(level, deepest).total);
 *   state.allocatePath('n:iron-skin');                  // shortest path, if points allow
 *   sheet.set('tree', state.mods());                    // or treeMods(save.hero.allocated)
 *   save.hero.allocated = state.serialize();
 *
 * Every start node is a free root: allocated nodes must stay connected to one of them.
 * Save format: allocated node ids, plus `<masteryId>=<optionId>` for each mastery choice.
 */
import type { Mod } from '../core/mods';
import { SCALING } from '../core/scaling';
import { describeTreeMod, STAT_NAMES } from './data/stats';
import { DEFAULT_TREE_SEED, generateTree } from './generate';
import type { TreeNode } from './types';

/** The graph: nodes by id, adjacency and the free root (start) nodes. Immutable. */
export class PassiveTree {
  readonly nodes: readonly TreeNode[];
  readonly roots: ReadonlySet<string>;
  private readonly byId = new Map<string, TreeNode>();

  constructor(nodes: readonly TreeNode[]) {
    this.nodes = nodes;
    for (const n of nodes) this.byId.set(n.id, n);
    this.roots = new Set(nodes.filter((n) => n.kind === 'start').map((n) => n.id));
  }

  get size(): number {
    return this.nodes.length;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): TreeNode | undefined {
    return this.byId.get(id);
  }

  node(id: string): TreeNode {
    const n = this.byId.get(id);
    if (!n) throw new Error(`tree: no node ${id}`);
    return n;
  }

  neighbours(id: string): readonly string[] {
    return this.byId.get(id)?.links ?? [];
  }

  /** Nodes you can path *through* (masteries and keystones are destinations only). */
  passable(id: string): boolean {
    const k = this.byId.get(id)?.kind;
    return k !== 'mastery' && k !== 'keystone';
  }

  /** Points needed to reach every node from the nearest root (roots are 0). */
  distances(from: Iterable<string> = this.roots): Map<string, number> {
    const dist = new Map<string, number>();
    const queue: string[] = [];
    for (const id of from) {
      dist.set(id, 0);
      queue.push(id);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      if (dist.get(id)! > 0 && !this.passable(id)) continue;
      for (const nb of this.neighbours(id)) {
        if (dist.has(nb)) continue;
        dist.set(nb, dist.get(id)! + 1);
        queue.push(nb);
      }
    }
    return dist;
  }

  /**
   * Shortest path from any node in `from` to `to` (BFS). Returns the nodes after the start,
   * ending with `to`; [] when `to` is in `from`; null when unreachable.
   */
  path(from: ReadonlySet<string>, to: string): string[] | null {
    if (!this.byId.has(to)) return null;
    if (from.has(to)) return [];
    const prev = new Map<string, string | null>();
    const queue: string[] = [];
    for (const id of from) {
      prev.set(id, null);
      queue.push(id);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      for (const nb of this.neighbours(id)) {
        if (prev.has(nb)) continue;
        prev.set(nb, id);
        if (nb === to) {
          const out: string[] = [];
          for (let c: string | null = nb; c !== null && !from.has(c); c = prev.get(c)!) out.push(c);
          return out.reverse();
        }
        if (this.passable(nb)) queue.push(nb);
      }
    }
    return null;
  }
}

// ------------------------------------------------------------------ the canonical tree

let cached: PassiveTree | null = null;

/** The game's tree (DEFAULT_TREE_SEED), generated once and cached. */
export function defaultTree(): PassiveTree {
  return (cached ??= new PassiveTree(generateTree({ seed: DEFAULT_TREE_SEED })));
}

// ------------------------------------------------------------------ points and gold

/** Passive points designed levels and rifts grant on top of levelling. */
export function bonusPoints(deepest: number): number {
  const designed = Math.min(12, Math.max(0, deepest));
  const rifts = Math.floor(Math.max(0, deepest - 12) / 5);
  return designed + rifts;
}

/** Point budget: one point per level after the first, plus one per designed level cleared and one per 5 rift depths. */
export function pointBudget(level: number, deepest = 0): { level: number; bonus: number; total: number } {
  const fromLevel = Math.max(0, Math.floor(level) - 1);
  const bonus = bonusPoints(deepest);
  return { level: fromLevel, bonus, total: fromLevel + bonus };
}

/** Gold to refund `nodes` passive points at hero `level`: about five kills' gold per point at the hero's depth. */
export function respecCost(nodes: number, level: number): number {
  if (nodes <= 0) return 0;
  const depth = Math.max(1, level / 3.2);
  return Math.round(nodes * 5 * SCALING.gold(depth));
}

// ------------------------------------------------------------------ allocation state

export type TreeChange = { kind: 'allocate' | 'deallocate' | 'mastery' | 'reset'; ids: readonly string[] };

/** Which nodes are allocated, mastery choices, and the point budget. Mutable; `version` bumps on change. */
export class TreeState {
  readonly allocated = new Set<string>();
  readonly masteries = new Map<string, string>();
  version = 0;

  constructor(
    readonly tree: PassiveTree,
    /** Total points available (pointBudget(...).total). */
    public points = Infinity,
  ) {}

  /**
   * Restore from a save (see `serialize`). Unknown ids (the tree changed) are dropped, then
   * anything no longer connected to a root, then the furthest nodes if over budget: those
   * points simply come back.
   */
  static load(tree: PassiveTree, saved: readonly string[] = [], points = Infinity): TreeState {
    const s = new TreeState(tree, points);
    for (const entry of saved) {
      const [id, choice] = entry.split('=') as [string, string | undefined];
      if (!tree.has(id) || tree.roots.has(id)) continue;
      if (choice === undefined) s.allocated.add(id);
      else if (tree.node(id).options?.some((o) => o.id === choice)) s.masteries.set(id, choice);
    }
    s.prune();
    while (s.allocated.size > points) {
      const dist = tree.distances(s.reachable());
      const far = [...s.allocated].sort((a, b) => (dist.get(b) ?? 0) - (dist.get(a) ?? 0) || (a < b ? 1 : -1));
      const leaf = far.find((id) => s.canDeallocate(id));
      if (!leaf) break;
      s.allocated.delete(leaf);
    }
    for (const id of [...s.masteries.keys()]) if (!s.allocated.has(id)) s.masteries.delete(id);
    return s;
  }

  get spent(): number {
    return this.allocated.size;
  }

  get unspent(): number {
    return this.points - this.allocated.size;
  }

  isAllocated(id: string): boolean {
    return this.tree.roots.has(id) || this.allocated.has(id);
  }

  /** Roots plus allocated nodes. */
  owned(): Set<string> {
    return new Set([...this.tree.roots, ...this.allocated]);
  }

  /** Allocatable right now: unallocated, next to an owned node, and a point to spend. */
  canAllocate(id: string): boolean {
    if (!this.tree.has(id) || this.isAllocated(id) || this.unspent < 1) return false;
    return this.tree.neighbours(id).some((nb) => this.isAllocated(nb) && (this.tree.passable(nb) || this.tree.roots.has(nb)));
  }

  allocate(id: string, choice?: string): boolean {
    if (!this.canAllocate(id)) return false;
    this.allocated.add(id);
    const opts = this.tree.node(id).options;
    if (opts?.length) this.masteries.set(id, opts.find((o) => o.id === choice)?.id ?? opts[0]!.id);
    this.version++;
    return true;
  }

  /** Nodes to allocate to reach `id` (cost = length), or null when unreachable. */
  pathTo(id: string): string[] | null {
    if (this.isAllocated(id)) return [];
    return this.tree.path(this.reachable(), id);
  }

  /** Allocate the whole path to `id` if the points allow; returns the newly allocated ids ([] if nothing happened). */
  allocatePath(id: string): string[] {
    const path = this.pathTo(id);
    if (!path?.length || path.length > this.unspent) return [];
    for (const n of path) this.allocated.add(n);
    for (const n of path) {
      const opts = this.tree.node(n).options;
      if (opts?.length && !this.masteries.has(n)) this.masteries.set(n, opts[0]!.id);
    }
    this.version++;
    return path;
  }

  /** Refundable: allocated, not a root, and everything else stays connected without it. */
  canDeallocate(id: string): boolean {
    if (!this.allocated.has(id)) return false;
    const seen = new Set<string>();
    const queue = [...this.tree.roots];
    for (const r of queue) seen.add(r);
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      if (!this.tree.roots.has(cur) && !this.tree.passable(cur)) continue;
      for (const nb of this.tree.neighbours(cur)) {
        if (nb === id || seen.has(nb) || !this.allocated.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
    return seen.size - this.tree.roots.size === this.allocated.size - 1;
  }

  deallocate(id: string): boolean {
    if (!this.canDeallocate(id)) return false;
    this.allocated.delete(id);
    this.masteries.delete(id);
    this.version++;
    return true;
  }

  /** Pick a mastery option for an allocated mastery. */
  choose(id: string, option: string): boolean {
    if (!this.allocated.has(id) || !this.tree.node(id).options?.some((o) => o.id === option)) return false;
    this.masteries.set(id, option);
    this.version++;
    return true;
  }

  /** Refund everything (a full respec; charge `respecCost(spent, level)` first). */
  reset(): void {
    this.allocated.clear();
    this.masteries.clear();
    this.version++;
  }

  /** Mods from every allocated node and mastery choice (the StatSheet source 'tree'). */
  mods(): Mod[] {
    return collectMods(this.tree, this.owned(), this.masteries);
  }

  /** Save format: allocated ids, then `<masteryId>=<optionId>` per choice. Sorted, so saves diff cleanly. */
  serialize(): string[] {
    return [...[...this.allocated].sort(), ...[...this.masteries].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, o]) => `${id}=${o}`)];
  }

  /** Roots plus allocated nodes reachable from them through passable nodes. */
  private reachable(): Set<string> {
    const seen = new Set(this.tree.roots);
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      if (!this.tree.roots.has(cur) && !this.tree.passable(cur)) continue;
      for (const nb of this.tree.neighbours(cur)) {
        if (seen.has(nb) || !this.allocated.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
    return seen;
  }

  /** Drop allocated nodes no longer connected to a root. */
  private prune(): void {
    const keep = this.reachable();
    for (const id of [...this.allocated]) if (!keep.has(id)) this.allocated.delete(id);
  }
}

function collectMods(tree: PassiveTree, owned: Iterable<string>, masteries: ReadonlyMap<string, string>): Mod[] {
  const out: Mod[] = [];
  for (const id of owned) {
    const n = tree.get(id);
    if (!n) continue;
    out.push(...n.mods);
    const choice = masteries.get(id);
    if (choice) out.push(...(n.options?.find((o) => o.id === choice)?.mods ?? []));
  }
  return out;
}

/**
 * The mods a saved allocation grants: the StatSheet source `tree`.
 *   hero.stats.set('tree', treeMods(save.hero.allocated));
 */
export function treeMods(allocated: readonly string[], tree: PassiveTree = defaultTree()): Mod[] {
  return TreeState.load(tree, allocated).mods();
}

// ------------------------------------------------------------------ search

const haystacks = new WeakMap<TreeNode, string>();

/** Everything searchable about a node, lower-case. */
export function nodeText(n: TreeNode): string {
  let h = haystacks.get(n);
  if (!h) {
    const mods = [...n.mods, ...(n.options ?? []).flatMap((o) => o.mods)];
    h = [n.name, n.kind, n.region, n.flavour ?? '', ...(n.lines ?? []), ...(n.tags ?? []), ...mods.map(describeTreeMod), ...mods.map((m) => m.stat), ...mods.map((m) => STAT_NAMES[m.stat] ?? '')]
      .join(' | ')
      .toLowerCase();
    haystacks.set(n, h);
  }
  return h;
}

/**
 * Node ids matching a query. Every word must appear in the node's name, kind, region,
 * flavour, tags or described mods ("fire res", "keystone", "minion life"). `stat:<name>`
 * matches nodes with a mod on exactly that stat.
 */
export function searchTree(tree: PassiveTree, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const out: string[] = [];
  for (const n of tree.nodes) {
    const ok = words.every((w) => {
      if (w.startsWith('stat:')) {
        const stat = w.slice(5);
        return n.mods.some((m) => m.stat.toLowerCase() === stat) || (n.options ?? []).some((o) => o.mods.some((m) => m.stat.toLowerCase() === stat));
      }
      return nodeText(n).includes(w);
    });
    if (ok) out.push(n.id);
  }
  return out;
}

// ------------------------------------------------------------------ stat summary

export interface SummaryGroup {
  readonly title: string;
  readonly lines: readonly string[];
}

const GROUPS: readonly [string, RegExp][] = [
  ['Ailments', /^(ignite|poison|bleed|freeze|chill|shock|ailment)\./],
  ['Minions and totems', /^(minion|totem)\./],
  ['Auras and curses', /^(aura|curse)\.|^mana\.reservation$/],
  ['Defence', /^(armour|evasion|block|res\.|damage\.taken|dodge|stun\.threshold|immune)/],
  ['Life, mana and shield', /^(life|mana|energy\.shield|es\.)/],
  ['Offence', /damage|^(attack|cast)\.speed$|^crit\.|^area$|^projectile|^pierce$|^knockback$|^stun\.duration$/],
];

/** A summary group title for a stat. */
export function statGroup(stat: string): string {
  return GROUPS.find(([, re]) => re.test(stat))?.[0] ?? 'Utility';
}

/**
 * Aggregate mods and describe them, grouped (Offence, Defence, ...): same stat/kind/tags/
 * condition are summed (`more` multiplied). Flags and overrides go under "Rules".
 */
export function summarizeMods(mods: readonly Mod[]): SummaryGroup[] {
  const merged = new Map<string, Mod>();
  for (const m of mods) {
    const key = `${m.stat}|${m.kind}|${(m.tags ?? []).join(',')}|${m.when ?? ''}`;
    const prev = merged.get(key);
    if (!prev) merged.set(key, { ...m });
    else if (m.kind === 'more') merged.set(key, { ...prev, value: (1 + prev.value) * (1 + m.value) - 1 });
    else if (m.kind === 'flat' || m.kind === 'inc') merged.set(key, { ...prev, value: prev.value + m.value });
    else if (m.kind === 'override') merged.set(key, { ...m });
  }
  const groups = new Map<string, string[]>();
  for (const m of [...merged.values()].sort((a, b) => (a.stat < b.stat ? -1 : a.stat > b.stat ? 1 : 0))) {
    if ((m.kind === 'flat' || m.kind === 'inc' || m.kind === 'more') && Math.abs(m.value) < 1e-9) continue;
    const title = m.kind === 'flag' || m.kind === 'override' ? 'Rules' : statGroup(m.stat);
    let list = groups.get(title);
    if (!list) groups.set(title, (list = []));
    list.push(describeTreeMod({ ...m, value: Math.round(m.value * 10000) / 10000 }));
  }
  const order = ['Rules', 'Offence', 'Ailments', 'Defence', 'Life, mana and shield', 'Minions and totems', 'Auras and curses', 'Utility'];
  return order.filter((t) => groups.has(t)).map((title) => ({ title, lines: groups.get(title)! }));
}

/** Tooltip lines for a node: hand-written lines, else its described mods (masteries: every option). */
export function nodeLines(n: TreeNode, choice?: string): string[] {
  if (n.lines?.length) return [...n.lines];
  if (n.options?.length) return n.options.map((o) => `${o.id === choice ? '> ' : '  '}${o.mods.map(describeTreeMod).join(', ')}`);
  return n.mods.map(describeTreeMod);
}
