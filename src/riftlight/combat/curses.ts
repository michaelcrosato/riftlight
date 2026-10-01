import type { PaletteColor } from '../../engine/palette';
import type { Mod, StatSheet } from '../core/mods';
import type { ActorLike } from '../core/types';
import type { StatQuery } from './stats';

/**
 * Curses: hexes a caster lays on its enemies, Path of Exile style. A curse is a timed stat
 * source (`curse:<id>`) on the target's sheet; how many curses one caster can keep on a target
 * is `curseLimit` (1 + `curse.count`), the oldest making way for a new one. The caster's
 * `curse.effect` (inc/more) scales the mods and `curse.duration` (inc/more) the time; a target
 * with the `curse.immune` flag (elite and boss modifiers, a corrupted body armour) shrugs them
 * off. Curse skills are gems (`skills/actives.ts`, tag `curse`) with the `curse` delivery and a
 * `curse` effect; `Combat.curse` applies one.
 *
 *   const r = target.curses.apply({ id: 'vulnerability', ... }, target.time);   // 'applied' | 'refreshed' | 'immune'
 */
export interface CurseInstance {
  readonly id: string;
  readonly name: string;
  readonly mods: readonly Mod[];
  /** Game time (the target's) it ends. */
  until: number;
  readonly duration: number;
  readonly source: ActorLike | null;
  readonly color: PaletteColor;
}

export interface CurseApplication {
  readonly id: string;
  readonly name: string;
  readonly mods: readonly Mod[];
  readonly duration: number;
  readonly source: ActorLike | null;
  readonly color: PaletteColor;
  /** Curses this source may keep on the target at once (`curseLimit`). */
  readonly limit: number;
}

export type CurseOutcome = 'applied' | 'refreshed' | 'immune';

export const CURSE_TUNING = {
  /** Curses one caster can keep on a target before `curse.count`. */
  baseCount: 1,
} as const;

/** How many curses a caster with `sheet` keeps on one target. */
export function curseLimit(sheet: StatSheet): number {
  return Math.max(1, Math.round(CURSE_TUNING.baseCount + sheet.get('curse.count')));
}

/** A curse's mods scaled by the caster's `curse.effect` (flags and overrides stay). */
export function scaleCurse(mods: readonly Mod[], q: StatQuery, tags: readonly string[]): Mod[] {
  const k = q.scale('curse.effect', tags);
  return mods.map((m) => (m.kind === 'flag' || m.kind === 'override' || k === 1 ? m : { ...m, value: m.value * k }));
}

/** Seconds a curse lasts: its base × skill duration × the caster's `curse.duration`. */
export function curseDuration(base: number, skillDuration: number, q: StatQuery, tags: readonly string[]): number {
  return base * skillDuration * Math.max(0.1, q.scale('curse.duration', tags));
}

/** The curses on one actor; owns its `curse:<id>` stat sources. */
export class Curses {
  readonly list: CurseInstance[] = [];
  /** Bumps on every change (visuals, HUD). */
  version = 0;
  /** Lifetime counters (tests, inspectors). */
  applied = 0;
  resisted = 0;

  constructor(private readonly sheet: StatSheet) {}

  get immune(): boolean {
    return this.sheet.has('curse.immune');
  }

  has(id: string): boolean {
    return this.list.some((c) => c.id === id);
  }

  apply(a: CurseApplication, now: number): CurseOutcome {
    if (this.immune) {
      this.resisted++;
      return 'immune';
    }
    const same = this.list.find((c) => c.id === a.id);
    if (same) this.remove(same);
    else {
      // the oldest of this caster's curses makes way
      const mine = this.list.filter((c) => c.source === a.source);
      for (let i = 0; i <= mine.length - Math.max(1, a.limit); i++) this.remove(mine[i]!);
    }
    this.list.push({ id: a.id, name: a.name, mods: a.mods, until: now + a.duration, duration: a.duration, source: a.source, color: a.color });
    this.sheet.set(`curse:${a.id}`, a.mods);
    this.applied++;
    this.version++;
    return same ? 'refreshed' : 'applied';
  }

  /** Expire curses whose time is up (and everything, once the target turns immune). */
  tick(now: number): void {
    const immune = this.list.length > 0 && this.immune;
    for (let i = this.list.length - 1; i >= 0; i--) if (immune || this.list[i]!.until <= now) this.remove(this.list[i]!);
  }

  clear(): void {
    for (const c of [...this.list]) this.remove(c);
  }

  private remove(c: CurseInstance): void {
    const i = this.list.indexOf(c);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.sheet.remove(`curse:${c.id}`);
    this.version++;
  }
}
