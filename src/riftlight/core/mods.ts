/**
 * The one modifier language. Every bonus in Riftlight is a Mod: passive nodes, item
 * affixes, support gems, buffs, elite monster modifiers, level mechanics, shrines, the
 * difficulty sliders. Every stat is computed the same way:
 *
 *   value = (base + Σ flat) × (1 + Σ inc) × Π (1 + more)        then the last override wins
 *
 * `inc` and `more` are fractions (0.2 = 20%). A `flag` mod sets a boolean stat (keystones:
 * "resolute technique", elite behaviours: "teleporter").
 *
 * Tags scope a mod: a mod with tags applies only when every one of its tags is in the
 * query's tags. `get('damage', ['melee','attack','fire'])` includes untagged damage mods,
 * `['melee']` mods and `['fire','attack']` mods, but not `['spell']` mods.
 */
export type ModKind = 'flat' | 'inc' | 'more' | 'override' | 'flag';

export interface Mod {
  readonly stat: string;
  readonly kind: ModKind;
  readonly value: number;
  /** All of these must be present in the query's tags for the mod to apply. */
  readonly tags?: readonly string[];
  /**
   * A named condition the owner evaluates, e.g. 'lowLife', 'moving', 'inDark',
   * 'recentlyKilled'. The sheet applies conditional mods only while the condition is set.
   */
  readonly when?: string;
}

/** Shorthands for writing content as data. */
export const flat = (stat: string, value: number, tags?: readonly string[], when?: string): Mod => ({ stat, kind: 'flat', value, tags, when });
export const inc = (stat: string, value: number, tags?: readonly string[], when?: string): Mod => ({ stat, kind: 'inc', value, tags, when });
export const more = (stat: string, value: number, tags?: readonly string[], when?: string): Mod => ({ stat, kind: 'more', value, tags, when });
export const override = (stat: string, value: number, tags?: readonly string[]): Mod => ({ stat, kind: 'override', value, tags });
export const flag = (stat: string, tags?: readonly string[]): Mod => ({ stat, kind: 'flag', value: 1, tags });

/**
 * Mods grouped by source ("tree", "item:weapon", "buff:frenzy", "difficulty", ...).
 * Sources are replaced wholesale (`set`) or removed (`remove`), so gear swaps, respecs
 * and expiring buffs are cheap and can't leak stale mods.
 */
import { canonicalMods, canonicalStat } from './stats';

export class StatSheet {
  private readonly sources = new Map<string, readonly Mod[]>();
  private readonly base = new Map<string, number>();
  private readonly conditions = new Set<string>();
  private cache = new Map<string, number>();
  /** Bumps whenever anything changes (cheap dirty check for UI). */
  version = 0;

  constructor(base: Readonly<Record<string, number>> = {}) {
    for (const [k, v] of Object.entries(base)) this.base.set(canonicalStat(k), v);
  }

  setBase(stat: string, value: number): void {
    this.base.set(canonicalStat(stat), value);
    this.dirty();
  }

  /** Replace a source's mods (stat names are made canonical: core/stats.ts). */
  set(source: string, mods: readonly Mod[]): void {
    this.sources.set(source, canonicalMods(mods));
    this.dirty();
  }

  remove(source: string): void {
    if (this.sources.delete(source)) this.dirty();
  }

  hasSource(source: string): boolean {
    return this.sources.has(source);
  }

  setCondition(name: string, on: boolean): void {
    if (on === this.conditions.has(name)) return;
    if (on) this.conditions.add(name);
    else this.conditions.delete(name);
    this.dirty();
  }

  /** Is a condition on (`lowLife`, `inDark`...)? */
  hasCondition(name: string): boolean {
    return this.conditions.has(name);
  }

  /** Final value of `stat` for a query with `tags`. */
  get(stat: string, tags: readonly string[] = []): number {
    stat = canonicalStat(stat);
    const key = tags.length ? `${stat}|${[...tags].sort().join(',')}` : stat;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let flatSum = this.base.get(stat) ?? 0;
    let incSum = 0;
    let moreProd = 1;
    let over: number | undefined;
    for (const mods of this.sources.values()) {
      for (const m of mods) {
        if (m.stat !== stat || !this.applies(m, tags)) continue;
        if (m.kind === 'flat' || m.kind === 'flag') flatSum += m.value;
        else if (m.kind === 'inc') incSum += m.value;
        else if (m.kind === 'more') moreProd *= 1 + m.value;
        else over = m.value;
      }
    }
    const v = over ?? flatSum * Math.max(0, 1 + incSum) * moreProd;
    this.cache.set(key, v);
    return v;
  }

  /** True when any applicable flag mod (or a positive value) sets `stat`. */
  has(stat: string, tags: readonly string[] = []): boolean {
    return this.get(stat, tags) > 0;
  }

  /** Every mod currently contributing to `stat` (for tooltips and inspectors). */
  explain(stat: string, tags: readonly string[] = []): { source: string; mod: Mod }[] {
    stat = canonicalStat(stat);
    const out: { source: string; mod: Mod }[] = [];
    for (const [source, mods] of this.sources) for (const m of mods) if (m.stat === stat && this.applies(m, tags)) out.push({ source, mod: m });
    return out;
  }

  /** Every mod of every source (inspectors; owners forwarding `minion.*` stats to their minions). */
  entries(): { source: string; mod: Mod }[] {
    const out: { source: string; mod: Mod }[] = [];
    for (const [source, mods] of this.sources) for (const m of mods) out.push({ source, mod: m });
    return out;
  }

  /**
   * An independent copy: base values, every source and the conditions. Tooltips and tools
   * ("compared to equipped", skill numbers) change the copy, never the actor's sheet.
   */
  clone(): StatSheet {
    const out = new StatSheet(Object.fromEntries(this.base));
    for (const [source, mods] of this.sources) out.sources.set(source, mods);
    for (const c of this.conditions) out.conditions.add(c);
    return out;
  }

  /** Every source key currently set (inspectors). */
  sourceKeys(): string[] {
    return [...this.sources.keys()];
  }

  /** Every stat name any source mentions. */
  stats(): string[] {
    const s = new Set(this.base.keys());
    for (const mods of this.sources.values()) for (const m of mods) s.add(m.stat);
    return [...s].sort();
  }

  private applies(m: Mod, tags: readonly string[]): boolean {
    if (m.when && !this.conditions.has(m.when)) return false;
    return !m.tags || m.tags.every((t) => tags.includes(t));
  }

  private dirty(): void {
    this.cache = new Map();
    this.version++;
  }
}

/** Human text for a mod, used by tooltips, the tree view and inspectors. */
export function describeMod(m: Mod, names: Readonly<Record<string, string>> = {}): string {
  const name = names[m.stat] ?? m.stat.replace(/\./g, ' ');
  const scope = m.tags?.length ? ` with ${m.tags.join(' ')}` : '';
  const cond = m.when ? ` while ${m.when.replace(/([A-Z])/g, ' $1').toLowerCase()}` : '';
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  switch (m.kind) {
    case 'flat':
      return `${m.value >= 0 ? '+' : ''}${round(m.value)} ${name}${scope}${cond}`;
    case 'inc':
      return `${pct(Math.abs(m.value))} ${m.value >= 0 ? 'increased' : 'reduced'} ${name}${scope}${cond}`;
    case 'more':
      return `${pct(Math.abs(m.value))} ${m.value >= 0 ? 'more' : 'less'} ${name}${scope}${cond}`;
    case 'override':
      return `${name}${scope} is ${round(m.value)}`;
    case 'flag':
      return `${name}${scope}${cond}`;
  }
}

function round(v: number): number {
  return Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
}
