/**
 * Death recap: what hurt the hero during this level, by damage type and by source, the
 * killing blow, and a tip picked from the biggest threat. Fed from `hit` events.
 *
 * Its state keeps what names an attacker (a monster's genome, a boss's id and English name), never
 * the name in some language (docs/game/lang.md): `recap()` names them in today's language.
 */
import type { ActorLike, DamageType, Genome, Hit, HitResult } from '../core/types';
import { DAMAGE_TYPES } from '../core/types';
import { t } from '../lang';
import { bossNameShown } from '../lang/monsters';
import { monsterNameParts } from '../monsters/names';
import { monsterName, unitOf } from '../wire/monsters';

/** What names an attacker in any language: a monster's genome, or a boss (its id and English name). */
export type RecapWho = { readonly genome: Genome } | { readonly boss: { readonly id: string; readonly name: string } };

export interface RecapSource {
  /** The attacker's key (kinds of monster add up under one); a save from before keys holds its English name. */
  name: string;
  total: number;
  hits: number;
  /** What names it (absent: `name` is shown as it is). */
  who?: RecapWho;
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
  /** A tip from the biggest threat, in the player's language (`death.tip.*`). */
  tip: string;
}

/**
 * What hit the hero when it has no name of its own: kept under these keys (snapshots hold them),
 * shown as lines (`death.source.*`).
 */
const NAMELESS: Readonly<Record<string, string>> = { 'a monster': 'death.source.monster', 'the level': 'death.source.level', yourself: 'death.source.self' };

/** An attacker's name in the player's language. */
function shown(s: { readonly name: string; readonly who?: RecapWho }): string {
  if (s.who) return 'boss' in s.who ? bossNameShown(s.who.boss) : monsterName(s.who.genome);
  return NAMELESS[s.name] ? t(NAMELESS[s.name]!) : s.name;
}

/** What names `source`, and the key it counts under (every monster of a kind under one, as its name does). */
function whoOf(source: ActorLike | null | undefined): { key: string; who?: RecapWho } {
  if (!source) return { key: 'the level' };
  const unit = unitOf(source);
  if (unit?.boss) return { key: `boss:${unit.boss.id}`, who: { boss: { id: unit.boss.id, name: unit.boss.name } } };
  if (unit) {
    const p = monsterNameParts(unit.genome);
    return { key: `monster:${p.elite ?? ''}:${p.theme}:${p.body}`, who: { genome: unit.genome } };
  }
  if (source.faction === 'hero') return { key: 'yourself' }; // the hero's own blow (a skill's cost, a test)
  return { key: source.name ?? 'a monster' };
}

/** `RecapTracker.save`. */
export interface RecapState {
  readonly byType: Record<DamageType, number>;
  readonly total: number;
  readonly hits: number;
  readonly sources: readonly RecapSource[];
  readonly last: { name: string; total: number; type: DamageType; crit: boolean; who?: RecapWho } | null;
}

export class RecapTracker {
  private byType = zero();
  private total = 0;
  private hits = 0;
  private readonly sources = new Map<string, RecapSource>();
  private last: { name: string; total: number; type: DamageType; crit: boolean; who?: RecapWho } | null = null;

  /** What it has counted, as data (save-states). */
  save(): RecapState {
    return { byType: { ...this.byType }, total: this.total, hits: this.hits, sources: [...this.sources.values()].map((s) => ({ ...s })), last: this.last ? { ...this.last } : null };
  }

  load(s: RecapState): void {
    this.byType = { ...s.byType };
    this.total = s.total;
    this.hits = s.hits;
    this.sources.clear();
    for (const x of s.sources) this.sources.set(x.name, { ...x });
    this.last = s.last ? { ...s.last } : null;
  }

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
    for (const type of DAMAGE_TYPES) {
      const v = result.byType[type] ?? 0;
      this.byType[type] += v;
      if (v > (result.byType[top] ?? 0)) top = type;
    }
    this.total += result.total;
    this.hits++;
    const { key: name, who } = whoOf(hit.source);
    const s = this.sources.get(name) ?? { name, total: 0, hits: 0, ...(who ? { who } : {}) };
    s.total += result.total;
    s.hits++;
    this.sources.set(name, s);
    this.last = { name, total: result.total, type: top, crit: result.crit, ...(who ? { who } : {}) };
  }

  /** Damage taken so far this level (playtest reports). */
  get damageTaken(): number {
    return this.total;
  }

  recap(): Recap {
    let worst: DamageType = 'physical';
    for (const type of DAMAGE_TYPES) if (this.byType[type] > this.byType[worst]) worst = type;
    const sources = [...this.sources.values()].sort((a, b) => b.total - a.total);
    let tip = t(`death.tip.${worst}`);
    if (this.last?.crit) tip = t('death.tip.crit', { tip });
    if (sources.length >= 4) tip = t('death.tip.crowd');
    return {
      byType: { ...this.byType },
      total: this.total,
      hits: this.hits,
      sources: sources.slice(0, 4).map((s) => ({ name: shown(s), total: s.total, hits: s.hits })),
      killer: this.last ? shown(this.last) : null,
      killingBlow: this.last ? { total: this.last.total, type: this.last.type, crit: this.last.crit } : null,
      tip,
    };
  }
}

function zero(): Record<DamageType, number> {
  return { physical: 0, fire: 0, cold: 0, lightning: 0, chaos: 0 };
}
