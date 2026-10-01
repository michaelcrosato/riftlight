/**
 * "Compared to equipped": what equipping an item would change on the hero's StatSheet.
 * The hero's sheet is cloned, the slot's `item:<slot>` source swapped (plus a weapon or
 * offhand the new item pushes out), and every stat either item touches is read before and
 * after. The hero's own sheet is never modified.
 */
import { type Mod, StatSheet } from '../core/mods';
import type { Item } from '../core/types';
import { defaultSlot, equipItem } from './inventory';
import { applyEquipment, type EquipSlot, type Equipment, EQUIP_SLOTS, itemMods } from './itemMods';
import { describeItemMod } from './stats';

export interface StatDelta {
  readonly stat: string;
  readonly tags?: readonly string[];
  readonly when?: string;
  readonly before: number;
  readonly after: number;
  /** after − before (for multiplier stats: the change in the (1 + inc) × more factor). */
  readonly delta: number;
  /** True when the change is good for the hero. */
  readonly better: boolean;
  /** Tooltip text, e.g. "+12 maximum life". */
  readonly text: string;
}

/** Stats where less is better. */
export const LOWER_IS_BETTER: ReadonlySet<string> = new Set(['mana.cost', 'echo.delay']);

type SheetInternals = { sources: Map<string, readonly Mod[]>; base: Map<string, number>; conditions: Set<string> };

/**
 * An independent copy of a StatSheet (base values, sources, conditions). StatSheet has no
 * public clone; this reads its fields and is covered by a unit test so a refactor of
 * core/mods.ts fails loudly here.
 */
export function cloneSheet(sheet: StatSheet): StatSheet {
  const s = sheet as unknown as SheetInternals;
  if (!(s.sources instanceof Map) || !(s.base instanceof Map) || !(s.conditions instanceof Set)) throw new Error('cloneSheet: StatSheet internals changed; update loot/compare.ts');
  const out = new StatSheet(Object.fromEntries(s.base));
  for (const [k, v] of s.sources) out.set(k, v);
  for (const c of s.conditions) out.setCondition(c, true);
  return out;
}

const keyOf = (m: Mod) => `${m.stat}|${(m.tags ?? []).join(',')}|${m.when ?? ''}`;

/**
 * Deltas from equipping `item` into `slot` (default: its usual slot, or the first empty
 * ring) on top of `equipment`, read from a clone of `sheet`. Sorted by stat name; only
 * stats that actually change are returned.
 */
export function compareEquip(sheet: StatSheet, equipment: Equipment, item: Item, slot?: EquipSlot): StatDelta[] {
  const target = slot ?? defaultSlot(item, equipment);
  if (!target) return [];
  const r = equipItem(equipment, item, target, Number.POSITIVE_INFINITY);
  if (!r.ok) return [];
  return diffEquipment(sheet, equipment, r.value.equipment);
}

/** Deltas between two equipment sets on a clone of `sheet`. */
export function diffEquipment(sheet: StatSheet, before: Equipment, after: Equipment): StatDelta[] {
  const changed = EQUIP_SLOTS.filter((s) => before[s] !== after[s]);
  const keys = new Map<string, Mod>();
  for (const s of changed) for (const it of [before[s], after[s]]) if (it) for (const m of itemMods(it)) if (!keys.has(keyOf(m))) keys.set(keyOf(m), m);
  const a = cloneSheet(sheet);
  const b = cloneSheet(sheet);
  applyEquipment(a, before);
  applyEquipment(b, after);
  const out: StatDelta[] = [];
  const multStats = new Set<string>();
  for (const m of [...keys.values()].sort((x, y) => keyOf(x).localeCompare(keyOf(y)))) {
    const tags = m.tags ?? [];
    if (m.when) {
      a.setCondition(m.when, true);
      b.setCondition(m.when, true);
    }
    let before0 = a.get(m.stat, tags);
    let after0 = b.get(m.stat, tags);
    let mult = multStats.has(m.stat);
    if (!mult && before0 === 0 && after0 === 0 && (m.kind === 'inc' || m.kind === 'more')) {
      // A pure multiplier stat (no base): compare the (1 + inc) × more factor.
      mult = true;
      multStats.add(m.stat);
      a.setBase(m.stat, 1);
      b.setBase(m.stat, 1);
      before0 = a.get(m.stat, tags);
      after0 = b.get(m.stat, tags);
    }
    if (m.when) {
      a.setCondition(m.when, false);
      b.setCondition(m.when, false);
    }
    const delta = Math.round((after0 - before0) * 10000) / 10000;
    if (Math.abs(delta) < 1e-6) continue;
    const better = LOWER_IS_BETTER.has(m.stat) ? delta < 0 : delta > 0;
    const shown: Mod = { stat: m.stat, kind: mult ? 'inc' : m.kind === 'flag' ? 'flag' : 'flat', value: delta, ...(m.tags ? { tags: m.tags } : {}), ...(m.when ? { when: m.when } : {}) };
    const text = m.kind === 'flag' ? `${delta > 0 ? 'gain' : 'lose'}: ${describeItemMod(shown)}` : describeItemMod(shown);
    out.push({ stat: m.stat, ...(m.tags ? { tags: m.tags } : {}), ...(m.when ? { when: m.when } : {}), before: before0, after: after0, delta, better, text });
  }
  return out;
}
