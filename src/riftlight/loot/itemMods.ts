/**
 * Item → Mods: what an equipped item gives the hero's StatSheet.
 *
 * `itemMods(item)` = base implicit + corruption implicits + explicit affixes + unique mods,
 * with every `local.*` stat folded into the item's own base numbers first (PoE "local"
 * mods: "+40% increased physical damage" on a sword improves that sword only). Weapons then
 * hand their base to the combat system as stats:
 *
 *   weapon.<type>.min / weapon.<type>.max   damage range per type (physical, fire, ...)
 *   attack.speed.base                       attacks per second
 *   crit.chance.base                        base critical strike chance (fraction)
 *   weapon.range                            reach in metres (bows: projectile range)
 *   weapon.<class>                          flag: weapon.sword, weapon.bow, ... (+ weapon.twohand)
 *
 * Armour pieces and shields give flat `armour`, `evasion`, `energy.shield`, `block.chance`.
 */
import { flag, flat, type Mod, type StatSheet } from '../core/mods';
import { SCALING } from '../core/scaling';
import { DAMAGE_TYPES, type DamageType, type Item, type ItemBase } from '../core/types';
import { AFFIXES, BASES, UNIQUES } from './content';

export type EquipSlot = 'weapon' | 'offhand' | 'helm' | 'body' | 'gloves' | 'boots' | 'amulet' | 'ring1' | 'ring2' | 'belt';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'offhand', 'helm', 'body', 'gloves', 'boots', 'amulet', 'ring1', 'ring2', 'belt'];
export type Equipment = Partial<Record<EquipSlot, Item>>;

/** StatSheet source key for an equipment slot: `item:weapon`, `item:ring1`, ... */
export const sourceKey = (slot: EquipSlot): string => `item:${slot}`;

export function baseOf(item: Item): ItemBase {
  return BASES.get(item.base);
}

export const isEquipment = (item: Item): boolean => {
  const s = baseOf(item).slot;
  return s !== 'currency' && s !== 'gem';
};

export const isTwoHanded = (item: Item): boolean => (baseOf(item).tags ?? []).includes('twohand');

/** Every mod on the item as written, locals included (tooltips, inspectors). */
export function rawMods(item: Item): { implicit: Mod[]; explicit: Mod[] } {
  const base = baseOf(item);
  const implicit = [...base.implicit, ...(item.implicits ?? []).flatMap((a) => a.mods)];
  const explicit = item.unique ? [...UNIQUES.get(item.unique).mods] : item.affixes.flatMap((a) => a.mods);
  return { implicit, explicit };
}

function sumLocal(mods: readonly Mod[], stat: string, kind: Mod['kind']): number {
  let s = 0;
  for (const m of mods) if (m.stat === stat && m.kind === kind && !m.when) s += m.value;
  return s;
}

export interface WeaponStats {
  /** Damage range per type, locals applied. */
  damage: Partial<Record<DamageType, [number, number]>>;
  aps: number;
  crit: number;
  range: number;
  /** Average damage × attacks per second. */
  dps: number;
  /** True for each stat a local mod changed (tooltips colour them). */
  modified: { physical: boolean; elemental: boolean; aps: boolean; crit: boolean };
}

/** A weapon's own numbers after local mods (null for non-weapons). */
export function weaponStats(item: Item): WeaponStats | null {
  const base = baseOf(item);
  const phys = base.base.physical;
  if (base.slot !== 'weapon' || !Array.isArray(phys)) return null;
  const { implicit, explicit } = rawMods(item);
  const all = [...implicit, ...explicit];
  const physInc = sumLocal(all, 'local.physical', 'inc');
  const physFlatMin = sumLocal(all, 'local.added.physical.min', 'flat');
  const physFlatMax = sumLocal(all, 'local.added.physical.max', 'flat');
  const damage: WeaponStats['damage'] = {
    physical: [Math.round((phys[0] + physFlatMin) * (1 + physInc)), Math.round((phys[1] + physFlatMax) * (1 + physInc))],
  };
  let elemental = false;
  for (const t of DAMAGE_TYPES) {
    if (t === 'physical') continue;
    const lo = sumLocal(all, `local.added.${t}.min`, 'flat');
    const hi = sumLocal(all, `local.added.${t}.max`, 'flat');
    if (lo || hi) {
      damage[t] = [Math.round(lo), Math.round(hi)];
      elemental = true;
    }
  }
  const apsInc = sumLocal(all, 'local.attack.speed', 'inc');
  const critInc = sumLocal(all, 'local.crit.chance', 'inc');
  const aps = Math.round(Number(base.base.aps ?? 1) * (1 + apsInc) * 100) / 100;
  const crit = Math.round(Number(base.base.crit ?? 0.05) * (1 + critInc) * 1000) / 1000;
  const avg = Object.values(damage).reduce((s, r) => s + (r[0] + r[1]) / 2, 0);
  return {
    damage,
    aps,
    crit,
    range: Number(base.base.range ?? 1.5),
    dps: Math.round(avg * aps * 10) / 10,
    modified: { physical: physInc !== 0 || physFlatMin !== 0 || physFlatMax !== 0, elemental, aps: apsInc !== 0, crit: critInc !== 0 },
  };
}

export interface DefenceStats {
  armour: number;
  evasion: number;
  es: number;
  block: number;
  modified: { armour: boolean; evasion: boolean; es: boolean; block: boolean };
}

/** Armour/evasion/energy shield/block of a piece after local mods (null when it has none). */
export function defenceStats(item: Item): DefenceStats | null {
  const base = baseOf(item);
  const b = base.base;
  if (b.armour === undefined && b.evasion === undefined && b.es === undefined && b.block === undefined) return null;
  const { implicit, explicit } = rawMods(item);
  const all = [...implicit, ...explicit];
  const local = (key: string, stat: string) => {
    const v = Number(b[key] ?? 0);
    const f = sumLocal(all, stat, 'flat');
    const i = sumLocal(all, stat, 'inc');
    return { value: v || f ? Math.round((v + f) * (1 + i)) : 0, changed: f !== 0 || i !== 0 };
  };
  const ar = local('armour', 'local.armour');
  const ev = local('evasion', 'local.evasion');
  const es = local('es', 'local.energy.shield');
  const blockFlat = sumLocal(all, 'local.block', 'flat');
  return {
    armour: ar.value,
    evasion: ev.value,
    es: es.value,
    block: Math.round((Number(b.block ?? 0) + blockFlat) * 100) / 100,
    modified: { armour: ar.changed, evasion: ev.changed, es: es.changed, block: blockFlat !== 0 },
  };
}

/**
 * The mods an equipped item gives the StatSheet: global mods as written, locals folded
 * into base stats, base stats as `weapon.*` / defence stats. Currency and gems give none
 * (gems are socketed by the skills system).
 */
export function itemMods(item: Item): Mod[] {
  if (!isEquipment(item)) return [];
  const base = baseOf(item);
  const { implicit, explicit } = rawMods(item);
  const out: Mod[] = [...implicit, ...explicit].filter((m) => !m.stat.startsWith('local.'));
  const w = weaponStats(item);
  if (w) {
    for (const [type, range] of Object.entries(w.damage)) {
      out.push(flat(`weapon.${type}.min`, range[0]), flat(`weapon.${type}.max`, range[1]));
    }
    out.push(flat('attack.speed.base', w.aps), flat('crit.chance.base', w.crit), flat('weapon.range', w.range));
    if (base.look) out.push(flag(`weapon.${base.look}`));
    if (isTwoHanded(item)) out.push(flag('weapon.twohand'));
  }
  const d = defenceStats(item);
  if (d) {
    if (d.armour) out.push(flat('armour', d.armour));
    if (d.evasion) out.push(flat('evasion', d.evasion));
    if (d.es) out.push(flat('energy.shield', d.es));
    if (d.block) out.push(flat('block.chance', d.block));
  }
  return out;
}

/** StatSheet sources for every equipment slot: `{ 'item:weapon': Mod[], ... }` (empty slots omitted). */
export function equipmentMods(equipment: Equipment): Record<string, Mod[]> {
  const out: Record<string, Mod[]> = {};
  for (const slot of EQUIP_SLOTS) {
    const item = equipment[slot];
    if (item) out[sourceKey(slot)] = itemMods(item);
  }
  return out;
}

/** Set (or remove) every `item:<slot>` source on `sheet` to match `equipment`. */
export function applyEquipment(sheet: StatSheet, equipment: Equipment): void {
  const mods = equipmentMods(equipment);
  for (const slot of EQUIP_SLOTS) {
    const key = sourceKey(slot);
    const m = mods[key];
    if (m) sheet.set(key, m);
    else sheet.remove(key);
  }
}

/**
 * Level needed to equip: uniques use their level; other items their base level or 80% of
 * their highest affix tier's level, whichever is higher. Gems: `SCALING.gemLevelReq`.
 */
export function requiredLevel(item: Item): number {
  if (item.gem) return SCALING.gemLevelReq(item.gem.level);
  const base = baseOf(item);
  if (base.slot === 'currency') return 0;
  if (item.unique) return UNIQUES.get(item.unique).level;
  let top = 0;
  for (const a of item.affixes) top = Math.max(top, AFFIXES.get(a.id).tiers[a.tier]?.level ?? 0);
  return Math.max(base.level, Math.floor(top * 0.8));
}
