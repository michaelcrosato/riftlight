/**
 * How the sim equips a "geared" build: the passive tree grows greedily (the node path with
 * the best score gain per point, among notables and the frontier) and every slot wears the
 * best of N rolled rares at the depth's item level. The score is the sim's own: log DPS
 * plus log time-to-die against a reference monster, so the choices follow the real maths.
 */
import type { Mod } from '../core/mods';
import type { Rng } from '../core/rng';
import type { Item, ItemBase } from '../core/types';
import { equipmentBases } from '../loot/content';
import { rollItem } from '../loot/generate';
import { EQUIP_SLOTS, requiredLevel, type EquipSlot, type Equipment } from '../loot/itemMods';
import type { PassiveTree } from '../tree/tree';
import type { Assumptions } from './assumptions';
import type { BuildArchetype } from './builds';
import { heroOffense, makeLoadout, monsterOffense, type HeroLoadout, type MonsterTarget } from './fight';

export interface ScoreContext {
  readonly build: BuildArchetype;
  readonly level: number;
  readonly assumptions: Assumptions;
  /** The monster the score fights (a rare of the depth). */
  readonly ref: MonsterTarget;
}

/** log(DPS) (half single target, half a pack of 5) + log(time to die, capped at 10 min). */
export function scoreLoadout(h: HeroLoadout, ref: MonsterTarget): number {
  const off = heroOffense(h, ref, 10);
  const def = monsterOffense(ref, h);
  const net = def.dtps - Math.max(0, h.sheet.get('life.regen')) - off.leech;
  const ttd = net > 0 ? (h.maxLife + h.es) / net : 600;
  return 0.5 * Math.log(Math.max(1e-6, off.single)) + 0.5 * Math.log(Math.max(1e-6, off.pack(5))) + Math.log(Math.min(600, ttd));
}

export function score(c: ScoreContext, tree: readonly Mod[], equipment: Equipment): number {
  return scoreLoadout(makeLoadout(c.build, { level: c.level, tree, equipment, assumptions: c.assumptions }), c.ref);
}

// ---------------------------------------------------------------- gear

const baseSlot = (s: EquipSlot): ItemBase['slot'] => (s === 'ring1' || s === 'ring2' ? 'ring' : s);

/** Bases a build may wear in a slot at an item level. */
export function basesFor(build: BuildArchetype, slot: EquipSlot, itemLevel: number): ItemBase[] {
  const want = baseSlot(slot);
  return equipmentBases().filter((b) => {
    if (b.slot !== want || b.level > itemLevel) return false;
    const tags = b.tags ?? [];
    if (want === 'weapon') return build.weapon.looks.includes(b.look ?? '') && (!build.weapon.hands || tags.includes(build.weapon.hands === 2 ? 'twohand' : 'onehand'));
    if (want === 'offhand') return !!build.offhand && b.look === build.offhand;
    return true;
  });
}

/**
 * Best of `assumptions.gearCandidates` rares per slot, slot by slot (weapon first), each
 * judged with everything chosen so far. Items the hero can't equip yet are re-rolled.
 */
export function chooseGear(rng: Rng, c: ScoreContext, tree: readonly Mod[], itemLevel: number): Equipment {
  const eq: Equipment = {};
  for (const slot of EQUIP_SLOTS) {
    if (slot === 'offhand' && !c.build.offhand) continue;
    const pool = basesFor(c.build, slot, itemLevel);
    if (!pool.length) continue;
    const top = Math.max(...pool.map((b) => b.level));
    const r = rng.fork(slot);
    let best: Item | null = null;
    let bestScore = score(c, tree, eq);
    for (let i = 0; i < c.assumptions.gearCandidates; i++) {
      // fresher bases more often, like drops (bases 30+ levels under the item level are rare)
      const base = r.weighted(pool, (b) => (top - b.level > 30 ? 0.35 : 1) * (1 + b.level / Math.max(1, top)));
      let item: Item | null = null;
      for (let k = 0; k < 4 && !item; k++) {
        const it = rollItem(r.fork(`${i}:${k}`), { itemLevel, base: base.id, rarity: 'rare' });
        if (requiredLevel(it) <= c.level) item = it;
      }
      if (!item) continue;
      const s = score(c, tree, { ...eq, [slot]: item });
      if (s > bestScore) {
        bestScore = s;
        best = item;
      }
    }
    if (best) eq[slot] = best;
  }
  return eq;
}

// ---------------------------------------------------------------- tree

/** A growing allocation: `extend` spends new points greedily; earlier picks stay (no respec). */
export class TreePlanner {
  readonly allocated: string[] = [];
  private readonly set = new Set<string>();
  constructor(readonly tree: PassiveTree) {}

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
