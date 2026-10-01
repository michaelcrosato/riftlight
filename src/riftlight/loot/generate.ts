/**
 * Item generation: pure functions of an `Rng`. The same seed always rolls the same item
 * (docs/GAME.md rule 3). Rarity, affix count, tiers and drops follow the numbers below and
 * `core/scaling.ts`; the "Loot" section of docs/GAME.md explains the math.
 */
import type { Mod } from '../core/mods';
import type { Rng } from '../core/rng';
import { RANK, type Rank, SCALING } from '../core/scaling';
import type { Affix, AffixTier, Item, ItemBase, Rarity, RolledAffix } from '../core/types';
import { AFFIXES, affixFits, BASES, CURRENCY, equipmentBases, GEMS, UNIQUES } from './content';
import { FIRST, SECOND } from './data/names';

export const RARITIES: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

/** Base rarity weights at boost 1 (depth 0, no item rarity): 70% / 25% / 5% / 0.3%. */
export const RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = { normal: 700, magic: 250, rare: 50, unique: 3 };

/** How many prefixes / suffixes each rarity may hold, and how many affixes it rolls. */
export const AFFIX_LIMITS: Readonly<Record<Rarity, { prefix: number; suffix: number; min: number; max: number }>> = {
  normal: { prefix: 0, suffix: 0, min: 0, max: 0 },
  magic: { prefix: 1, suffix: 1, min: 1, max: 2 },
  rare: { prefix: 3, suffix: 3, min: 4, max: 6 },
  unique: { prefix: 0, suffix: 0, min: 0, max: 0 },
};

/** Rare affix count weights: 4 / 5 / 6 affixes. */
export const RARE_COUNT_WEIGHTS = [0, 0, 0, 0, 50, 35, 15] as const;

/** Drop tuning (per normal-rank kill, before RANK multipliers). */
export const DROPS = {
  /** Expected item drops per normal kill. */
  itemsPerKill: 0.22,
  /** Chance a normal kill drops a gold pile (magic+ ranks always drop gold). */
  goldChance: 0.25,
  /** Share of item drops that are currency / gems; the rest is equipment. */
  currencyShare: 0.22,
  gemShare: 0.06,
  /** Gold pile size spread around SCALING.gold(depth). */
  goldSpread: [0.6, 1.4] as const,
  /** Extra rarity boost by monster rank. */
  rankRarity: { normal: 1, magic: 1.25, rare: 1.7, boss: 2.5 } as Record<Rank, number>,
} as const;

/**
 * Rarity boost from depth and the `item.rarity` stat (0.3 = 30% increased rarity):
 * `SCALING.rarityBoost(depth) × (1 + itemRarity)`.
 */
export function rarityBoost(depth: number, itemRarity = 0): number {
  return SCALING.rarityBoost(depth) * (1 + Math.max(-0.9, itemRarity));
}

/** Rarity weights for a boost B: magic × B, rare × B^1.5, unique × B^2 (normal fixed). */
export function rarityWeights(boost: number): Record<Rarity, number> {
  const b = Math.max(0.1, boost);
  return { normal: RARITY_WEIGHTS.normal, magic: RARITY_WEIGHTS.magic * b, rare: RARITY_WEIGHTS.rare * Math.pow(b, 1.5), unique: RARITY_WEIGHTS.unique * b * b };
}

export function rollRarity(rng: Rng, boost = 1): Rarity {
  const w = rarityWeights(boost);
  return rng.weighted(RARITIES, (r) => w[r]);
}

/** A short deterministic id. */
export function rollUid(rng: Rng): string {
  return `${rng.int(0, 0xfffffff).toString(36)}${rng.int(0, 0xfffffff).toString(36)}`;
}

// ---------------------------------------------------------------- affixes

/**
 * Pick weight of each tier of `affix` at `itemLevel` (0 = locked). Weaker tiers are more
 * common (× 0.85 per tier up), and a tier ramps in over the levels after it unlocks:
 * `ramp = clamp((itemLevel − tier.level + 4) / 16, 0.25, 1)`.
 */
export function tierWeights(affix: Affix, itemLevel: number): number[] {
  return affix.tiers.map((t, i) => (t.level > itemLevel ? 0 : Math.pow(0.85, i) * Math.min(1, Math.max(0.25, (itemLevel - t.level + 4) / 16))));
}

/** Roll a value in [min, max] with the precision the range is written in (integers stay integers). */
export function rollValue(rng: Rng, min: number, max: number): number {
  if (min === max) return min;
  const decimals = Math.max(decimalsOf(min), decimalsOf(max));
  if (decimals === 0) return rng.int(Math.min(min, max), Math.max(min, max));
  const f = Math.pow(10, decimals);
  return rng.int(Math.round(min * f), Math.round(max * f)) / f;
}

function decimalsOf(v: number): number {
  const s = String(v);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export function rollTierMods(rng: Rng, tier: AffixTier): Mod[] {
  return tier.mods.map((m) => ({ stat: m.stat, kind: m.kind, value: rollValue(rng, m.min, m.max), ...(m.tags ? { tags: m.tags } : {}), ...(m.when ? { when: m.when } : {}) }));
}

/** Roll one affix at a weighted tier for `itemLevel` (null when every tier is locked). */
export function rollAffix(rng: Rng, affix: Affix, itemLevel: number): RolledAffix | null {
  const w = tierWeights(affix, itemLevel);
  if (!w.some((x) => x > 0)) return null;
  const tier = rng.weighted(
    w.map((_, i) => i),
    (i) => w[i]!,
  );
  return { id: affix.id, tier, mods: rollTierMods(rng, affix.tiers[tier]!) };
}

/** Affixes that may still roll on an item: fit the base, unlocked, free group, room for the type. */
export function eligibleAffixes(base: ItemBase, itemLevel: number, rarity: Rarity, existing: readonly RolledAffix[], type?: 'prefix' | 'suffix'): Affix[] {
  const limits = AFFIX_LIMITS[rarity];
  const have = existing.map((r) => AFFIXES.get(r.id));
  const groups = new Set(have.map((a) => a.group));
  const room = { prefix: limits.prefix - have.filter((a) => a.type === 'prefix').length, suffix: limits.suffix - have.filter((a) => a.type === 'suffix').length };
  return AFFIXES.all().filter(
    (a) => (!type || a.type === type) && room[a.type] > 0 && !groups.has(a.group) && affixFits(a, base) && a.tiers[0]!.level <= itemLevel && (a.weight ?? 100) > 0,
  );
}

/** One more affix for an item of `rarity` (null when nothing fits). */
export function addAffix(rng: Rng, base: ItemBase, itemLevel: number, rarity: Rarity, existing: readonly RolledAffix[]): RolledAffix | null {
  const pool = eligibleAffixes(base, itemLevel, rarity, existing);
  if (!pool.length) return null;
  const affix = rng.weighted(pool, (a) => a.weight ?? 100);
  return rollAffix(rng, affix, itemLevel);
}

/** A full set of affixes for a fresh magic or rare item. */
export function rollAffixes(rng: Rng, base: ItemBase, itemLevel: number, rarity: Rarity): RolledAffix[] {
  const limits = AFFIX_LIMITS[rarity];
  if (limits.max === 0) return [];
  const count = rarity === 'rare' ? rng.weighted([4, 5, 6], (n) => RARE_COUNT_WEIGHTS[n]!) : rng.int(limits.min, limits.max);
  const out: RolledAffix[] = [];
  while (out.length < count) {
    const a = addAffix(rng, base, itemLevel, rarity, out);
    if (!a) break;
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------- names

/** Second-word list for a base: by class (bow, caster), then slot. */
export function nameList(base: ItemBase): readonly string[] {
  const tags = base.tags ?? [];
  if (tags.includes('bow') || tags.includes('quiver')) return SECOND.bow!;
  if (tags.includes('caster') && base.slot === 'weapon') return SECOND.caster!;
  return SECOND[base.slot] ?? SECOND.weapon!;
}

export function rareName(rng: Rng, base: ItemBase): string {
  return `${rng.pick(FIRST)} ${rng.pick(nameList(base))}`;
}

/** "Prefix Base Suffix" for magic items (either part optional). */
export function magicName(base: ItemBase, affixes: readonly RolledAffix[]): string {
  const p = affixes.map((r) => AFFIXES.get(r.id)).find((a) => a.type === 'prefix');
  const s = affixes.map((r) => AFFIXES.get(r.id)).find((a) => a.type === 'suffix');
  return [p?.name, base.name, s?.name].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- items

export interface RollOptions {
  /** Base id; random equipment base at or under the item level when omitted. */
  base?: string;
  itemLevel: number;
  /** Forced rarity; rolled from `rarityBoost` when omitted. */
  rarity?: Rarity;
  /** See `rarityBoost(depth, itemRarity)`. Default 1. */
  rarityBoost?: number;
}

/** A random equipment base for `itemLevel`; bases 30+ levels under it are less likely. */
export function rollBase(rng: Rng, itemLevel: number): ItemBase {
  const pool = equipmentBases().filter((b) => b.level <= itemLevel);
  return rng.weighted(pool, (b) => (b.weight ?? 1) * (itemLevel - b.level > 30 ? 0.35 : 1));
}

/** Roll one item. Pure: same rng state → same item. */
export function rollItem(rng: Rng, opts: RollOptions): Item {
  const itemLevel = Math.max(1, Math.round(opts.itemLevel));
  if (opts.base) {
    const b = BASES.get(opts.base);
    if (b.slot === 'currency') return currencyItem(rng, b.id, 1, itemLevel);
    if (b.slot === 'gem') return rollGem(rng, itemLevel, b.id === 'support-gem');
  }
  let rarity = opts.rarity ?? rollRarity(rng, opts.rarityBoost ?? 1);
  if (rarity === 'unique') {
    const pool = UNIQUES.all().filter((u) => u.level <= itemLevel && (!opts.base || u.base === opts.base) && (u.weight ?? 1) > 0);
    if (pool.length) {
      const u = rng.weighted(pool, (x) => x.weight ?? 1);
      return { uid: rollUid(rng), base: u.base, rarity: 'unique', level: itemLevel, name: u.name, affixes: [], unique: u.id };
    }
    rarity = 'rare';
  }
  const base = opts.base ? BASES.get(opts.base) : rollBase(rng, itemLevel);
  const uid = rollUid(rng);
  const affixes = rollAffixes(rng, base, itemLevel, rarity);
  const name = rarity === 'rare' ? rareName(rng, base) : rarity === 'magic' ? magicName(base, affixes) : base.name;
  return { uid, base: base.id, rarity, level: itemLevel, name, affixes };
}

/** A specific unique (tests, vendors, debug). */
export function makeUnique(rng: Rng, uniqueId: string, itemLevel?: number): Item {
  const u = UNIQUES.get(uniqueId);
  return { uid: rollUid(rng), base: u.base, rarity: 'unique', level: Math.max(itemLevel ?? u.level, u.level), name: u.name, affixes: [], unique: u.id };
}

export function currencyItem(rng: Rng, id: string, quantity = 1, itemLevel = 1): Item {
  const c = CURRENCY.get(id);
  return { uid: rollUid(rng), base: id, rarity: 'normal', level: itemLevel, name: c.name, affixes: [], quantity };
}

/** A random currency orb that can drop at `itemLevel`. */
export function rollCurrency(rng: Rng, itemLevel: number): Item {
  const pool = CURRENCY.all().filter((c) => c.level <= itemLevel);
  const c = rng.weighted(pool, (x) => x.weight ?? 1);
  const qty = c.stack >= 30 && rng.chance(0.25) ? rng.int(2, 3) : 1;
  return currencyItem(rng, c.id, qty, itemLevel);
}

/** A random gem; level 1..(1 + itemLevel/8), capped at 20. */
export function rollGem(rng: Rng, itemLevel: number, support?: boolean, id?: string): Item {
  const pool = GEMS.all().filter((g) => support === undefined || g.support === support);
  const g = id ? GEMS.get(id) : rng.weighted(pool, (x) => x.weight ?? 1);
  const level = rng.int(1, Math.min(20, 1 + Math.floor(itemLevel / 8)));
  return {
    uid: rollUid(rng),
    base: g.support ? 'support-gem' : 'skill-gem',
    rarity: 'normal',
    level: itemLevel,
    name: g.name,
    affixes: [],
    gem: { id: g.id, level, support: g.support },
  };
}

// ---------------------------------------------------------------- drops

export interface DropOptions {
  depth: number;
  rank: Rank;
  /** The killer's `item.rarity` stat (0.5 = 50% increased). */
  itemRarity?: number;
  /** The killer's `item.quantity` stat. */
  itemQuantity?: number;
  /** The killer's `gold.find` stat. */
  goldFind?: number;
}

export interface Drops {
  items: Item[];
  gold: number;
}

/**
 * What a kill drops. Expected items = `DROPS.itemsPerKill × RANK[rank].drops × (1 +
 * itemQuantity)`; item level = `SCALING.monsterLevel(depth)`; rarity boost = depth ×
 * item rarity × rank. Bosses always drop at least one rare or better.
 */
export function rollDrops(rng: Rng, opts: DropOptions): Drops {
  const rank = RANK[opts.rank];
  const itemLevel = SCALING.monsterLevel(opts.depth);
  const boost = rarityBoost(opts.depth, opts.itemRarity ?? 0) * DROPS.rankRarity[opts.rank];
  const expected = DROPS.itemsPerKill * rank.drops * (1 + Math.max(0, opts.itemQuantity ?? 0));
  const count = Math.floor(expected) + (rng.chance(expected - Math.floor(expected)) ? 1 : 0);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng.next();
    if (r < DROPS.currencyShare) items.push(rollCurrency(rng, itemLevel));
    else if (r < DROPS.currencyShare + DROPS.gemShare) items.push(rollGem(rng, itemLevel));
    else items.push(rollItem(rng, { itemLevel, rarityBoost: boost }));
  }
  if (opts.rank === 'boss' && !items.some((it) => it.rarity === 'rare' || it.rarity === 'unique')) {
    items.push(rollItem(rng, { itemLevel, rarity: rng.chance(0.15) ? 'unique' : 'rare' }));
  }
  let gold = 0;
  if (opts.rank !== 'normal' || rng.chance(DROPS.goldChance)) {
    const spread = rng.range(DROPS.goldSpread[0], DROPS.goldSpread[1]);
    gold = Math.max(1, Math.round(SCALING.gold(opts.depth) * rank.gold * spread * (1 + Math.max(0, opts.goldFind ?? 0))));
  }
  return { items, gold };
}
