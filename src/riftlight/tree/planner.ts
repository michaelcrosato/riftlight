/**
 * A greedy passive-tree planner: each step takes the path (to a notable anywhere reachable,
 * or a small node next to the allocation) with the best value gain per point. Used by the
 * balance sim's geared builds (`balance/choose.ts`) and the playtest bot's town visits
 * (`game/botTown.ts`). Pure; no respec (earlier picks stay).
 */
import type { Mod } from '../core/mods';
import type { PassiveTree } from './tree';

/** A growing allocation: `extend` spends new points greedily; earlier picks stay (no respec). */
export class TreePlanner {
  readonly allocated: string[] = [];
  private readonly set = new Set<string>();
  /** `start`: nodes already allocated (a save's; mastery choices `id=option` are skipped). */
  constructor(
    readonly tree: PassiveTree,
    start: readonly string[] = [],
  ) {
    for (const id of start) {
      if (id.includes('=') || !tree.has(id) || this.set.has(id)) continue;
      this.allocated.push(id);
      this.set.add(id);
    }
  }

  mods(): Mod[] {
    return this.allocated.flatMap((id) => this.tree.node(id).mods ?? []);
  }

  /** Spend up to `points` in total; returns the nodes added. */
  extend(points: number, value: (mods: readonly Mod[]) => number): string[] {
    const added: string[] = [];
    while (this.allocated.length < points) {
      const left = points - this.allocated.length;
      const prev = this.bfs();
      const baseMods = this.mods();
      const base = value(baseMods);
      let best: { path: string[]; v: number } | null = null;
      for (const id of this.candidates(prev)) {
        const path = this.pathTo(id, prev);
        if (!path.length || path.length > left) continue;
        const mods = [...baseMods, ...path.flatMap((p) => this.tree.node(p).mods ?? [])];
        const v = (value(mods) - base) / path.length;
        if (!best || v > best.v) best = { path, v };
      }
      if (!best || best.v <= 1e-9) break;
      for (const id of best.path) {
        this.allocated.push(id);
        this.set.add(id);
        added.push(id);
      }
    }
    return added;
  }

  /** BFS over passable nodes from every root and allocated node: id → previous node. */
  private bfs(): Map<string, string | null> {
    const prev = new Map<string, string | null>();
    const queue: string[] = [];
    for (const id of [...this.tree.roots, ...this.allocated]) {
      prev.set(id, null);
      queue.push(id);
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      if (prev.get(id) !== null && !this.tree.passable(id)) continue;
      for (const nb of this.tree.neighbours(id)) {
        if (prev.has(nb)) continue;
        prev.set(nb, id);
        queue.push(nb);
      }
    }
    return prev;
  }

  private pathTo(id: string, prev: Map<string, string | null>): string[] {
    const out: string[] = [];
    for (let c: string | null | undefined = id; c && prev.get(c) !== null; c = prev.get(c)) out.push(c);
    return out.reverse();
  }

  /** Notables anywhere reachable, plus every small node next to the allocation. */
  private candidates(prev: Map<string, string | null>): string[] {
    const out: string[] = [];
    for (const n of this.tree.nodes) {
      if (this.set.has(n.id) || this.tree.roots.has(n.id) || !prev.has(n.id)) continue;
      if (n.kind === 'notable') out.push(n.id);
      else if (n.kind === 'small' && prev.get(n.id) !== undefined && (this.set.has(prev.get(n.id)!) || this.tree.roots.has(prev.get(n.id)!))) out.push(n.id);
    }
    return out;
  }
}
