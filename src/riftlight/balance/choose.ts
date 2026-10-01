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

/** The greedy tree planner lives with the tree (the playtest bot uses it too). */
export { TreePlanner } from '../tree/planner';
