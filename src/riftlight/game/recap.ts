/**
 * Death recap: what hurt the hero during this level, by damage type and by source, the
 * killing blow, and a tip picked from the biggest threat. Fed from `hit` events.
 */
import type { DamageType, Hit, HitResult } from '../core/types';
import { DAMAGE_TYPES } from '../core/types';

export interface RecapSource {
  name: string;
  total: number;
  hits: number;
}

export interface Recap {
  /** Damage taken per type this level. */
  byType: Record<DamageType, number>;
  total: number;
  hits: number;
  /** Biggest damage dealers, descending. */
  sources: RecapSource[];
  killer: string | null;
  killingBlow: { total: number; type: DamageType; crit: boolean } | null;
  tip: string;
}

const TIPS: Record<DamageType, string> = {
  physical: 'Physical hits hurt most: dodge the telegraphed slams (Space) and stack armour or life.',
  fire: 'Fire hurt most: fire resistance on gear, and step out of burning ground fast.',
  cold: 'Cold hurt most: cold resistance stops chills from slowing your escape.',
  lightning: 'Lightning hurt most: lightning resistance, and keep out of chained lines.',
  chaos: 'Chaos hurt most: it ignores energy shield. Kill casters first.',
};

export class RecapTracker {
  private byType = zero();
  private total = 0;
  private hits = 0;
  private readonly sources = new Map<string, RecapSource>();
  private last: { name: string; total: number; type: DamageType; crit: boolean } | null = null;

  reset(): void {
    this.byType = zero();
    this.total = 0;
    this.hits = 0;
    this.sources.clear();
    this.last = null;
  }

  /** Record a hit the hero took. */
  record(hit: Hit, result: HitResult): void {
    if (result.total <= 0) return;
    let top: DamageType = 'physical';
    for (const t of DAMAGE_TYPES) {
      const v = result.byType[t] ?? 0;
      this.byType[t] += v;
      if (v > (result.byType[top] ?? 0)) top = t;
    }
    this.total += result.total;
    this.hits++;
    const name = hit.source?.name ?? (hit.source ? 'a monster' : 'the level');
    const s = this.sources.get(name) ?? { name, total: 0, hits: 0 };
    s.total += result.total;
    s.hits++;
    this.sources.set(name, s);
    this.last = { name, total: result.total, type: top, crit: result.crit };
  }

  /** Damage taken so far this level (playtest reports). */
  get damageTaken(): number {
    return this.total;
  }

  recap(): Recap {
    let worst: DamageType = 'physical';
    for (const t of DAMAGE_TYPES) if (this.byType[t] > this.byType[worst]) worst = t;
    const sources = [...this.sources.values()].sort((a, b) => b.total - a.total);
    let tip = TIPS[worst];
    if (this.last?.crit) tip = `The killing blow was a critical strike. ${tip}`;
    if (sources.length >= 4) tip = 'Many attackers at once: pull packs back to a doorway and fight them one by one.';
    return {
      byType: { ...this.byType },
      total: this.total,
      hits: this.hits,
      sources: sources.slice(0, 4),
      killer: this.last?.name ?? null,
      killingBlow: this.last ? { total: this.last.total, type: this.last.type, crit: this.last.crit } : null,
      tip,
    };
  }
}

function zero(): Record<DamageType, number> {
  return { physical: 0, fire: 0, cold: 0, lightning: 0, chaos: 0 };
}
