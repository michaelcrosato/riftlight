import type { Mod, StatSheet } from '../core/mods';

/**
 * Reading stats for one action: an actor's StatSheet plus the extra mods of the skill it is
 * using (support gems, gem level). Supports must only touch the skill they are linked to, so
 * they never go on the sheet; this view folds them in at query time.
 *
 * Combat stats are *modifier stats*: their base comes from the skill, the weapon or the
 * actor's base record, not from the sheet. `value(stat, tags, base)` gives
 * `(base + Σflat) × (1 + Σinc) × Π(1 + more)` (the last override wins), exactly like
 * `StatSheet.get`, with increases from every listed stat added together:
 * `scale(['damage', 'fire.damage'], tags)` is one pool of increased damage, PoE style.
 */
export interface Totals {
  flat: number;
  inc: number;
  more: number;
  override: number | undefined;
}

export class StatQuery {
  constructor(
    readonly sheet: StatSheet,
    /** Mods that apply only to this action (supports, gem level). */
    readonly extra: readonly Mod[] = [],
    /** Conditions for `extra` mods that carry `when` (the sheet tracks its own). */
    readonly conditions: ReadonlySet<string> = EMPTY,
  ) {}

  /** Sum of every applicable mod to any of `stats` for a query with `tags`. */
  totals(stats: string | readonly string[], tags: readonly string[] = NONE): Totals {
    const t: Totals = { flat: 0, inc: 0, more: 1, override: undefined };
    const list = typeof stats === 'string' ? [stats] : stats;
    for (const stat of list) {
      for (const { mod } of this.sheet.explain(stat, tags)) add(t, mod);
      for (const mod of this.extra) if (mod.stat === stat && applies(mod, tags, this.conditions)) add(t, mod);
    }
    return t;
  }

  /** `(base + Σflat) × (1 + Σinc) × Π more`, override wins. */
  value(stats: string | readonly string[], tags: readonly string[] = NONE, base = 0): number {
    const t = this.totals(stats, tags);
    if (t.override !== undefined) return t.override;
    return (base + t.flat) * Math.max(0, 1 + t.inc) * t.more;
  }

  /** Multiplier only: `(1 + Σinc) × Π more` (flat ignored). */
  scale(stats: string | readonly string[], tags: readonly string[] = NONE): number {
    const t = this.totals(stats, tags);
    if (t.override !== undefined) return t.override;
    return Math.max(0, 1 + t.inc) * t.more;
  }

  /** Σ flat only. */
  flat(stats: string | readonly string[], tags: readonly string[] = NONE): number {
    return this.totals(stats, tags).flat;
  }

  /** True when any applicable flag (or positive flat) sets `stat`. */
  has(stat: string, tags: readonly string[] = NONE): boolean {
    return this.flat(stat, tags) > 0;
  }
}

const NONE: readonly string[] = [];
const EMPTY: ReadonlySet<string> = new Set();

function add(t: Totals, m: Mod): void {
  if (m.kind === 'flat' || m.kind === 'flag') t.flat += m.value;
  else if (m.kind === 'inc') t.inc += m.value;
  else if (m.kind === 'more') t.more *= 1 + m.value;
  else t.override = m.value;
}

function applies(m: Mod, tags: readonly string[], conditions: ReadonlySet<string>): boolean {
  if (m.when && !conditions.has(m.when)) return false;
  return !m.tags || m.tags.every((t) => tags.includes(t));
}

/** A plain query over a sheet with no extra mods. */
export const query = (sheet: StatSheet, extra: readonly Mod[] = []): StatQuery => new StatQuery(sheet, extra);
