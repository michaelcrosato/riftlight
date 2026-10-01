import type { PaletteColor } from '../../engine/palette';
import { flat, inc, more, type Mod, type StatSheet } from '../core/mods';
import type { ChargeType } from '../core/types';
import { StatQuery } from './stats';

/**
 * Endurance, frenzy and power charges, Path of Exile style. Each actor holds up to
 * `CHARGE_TUNING.baseMax + <type>.max` of each kind; every charge of a kind shares one timer
 * (`CHARGE_TUNING.duration` × `charge.duration`), refreshed whenever one is gained, and they
 * all drop when it runs out. Each charge grants its kind's `perCharge` mods through the
 * actor's `charges` stat source, so the rest of the pipeline sees plain stats.
 *
 * Where charges come from (all read here or in combat/Combat.ts):
 *   charge.onKill  flat chance per kill, scoped by the charge's tag (`flat('charge.onKill', 0.1, ['frenzy'])`)
 *   charge.onHit   flat chance per landed hit (supports: Frenzy Charge on Hit)
 *   charge.onCrit  flat chance per critical strike (Power Charge on Critical)
 *   charge.onStun  flat chance per stun dealt (Endurance Charge on Stun)
 *   skills         a `charges` effect gains (War Cry, Enduring Cry, Frenzy Strikes on hit) or consumes (Discharge)
 *
 *   actor.charges.gain('frenzy');           // +1, refreshes the timer, returns how many it added
 *   actor.charges.consume('all');           // Discharge: every charge, returns how many
 */
export interface ChargeDef {
  readonly id: ChargeType;
  readonly name: string;
  /** Stat that raises the maximum (flat). */
  readonly maxStat: string;
  /** HUD buff and orbiting pip colour. */
  readonly color: PaletteColor;
  /** Pip highlight colour. */
  readonly glow: PaletteColor;
  /** Mods per charge held. */
  readonly perCharge: readonly Mod[];
  readonly description: string;
}

export const CHARGE_TUNING = {
  /** Charges of each kind an actor can hold before `<type>.max`. */
  baseMax: 3,
  /** Seconds the charges of one kind last after the last one was gained (× `charge.duration`). */
  duration: 10,
} as const;

export const CHARGES: Readonly<Record<ChargeType, ChargeDef>> = {
  endurance: {
    id: 'endurance',
    name: 'Endurance',
    maxStat: 'endurance.max',
    color: 'orange',
    glow: 'red',
    perCharge: [flat('res.physical', 0.04), flat('res.fire', 0.04), flat('res.cold', 0.04), flat('res.lightning', 0.04)],
    description: '4% physical damage reduction and +4% elemental resistances per charge',
  },
  frenzy: {
    id: 'frenzy',
    name: 'Frenzy',
    maxStat: 'frenzy.max',
    color: 'lime',
    glow: 'green',
    perCharge: [more('damage', 0.04), inc('attack.speed', 0.04), inc('cast.speed', 0.04)],
    description: '4% more damage and 4% increased attack and cast speed per charge',
  },
  power: {
    id: 'power',
    name: 'Power',
    maxStat: 'power.max',
    color: 'cyan',
    glow: 'sky',
    perCharge: [inc('crit.chance', 0.4), flat('crit.multiplier', 0.05)],
    description: '40% increased critical strike chance and +5% critical strike multiplier per charge',
  },
};

export const CHARGE_TYPES: readonly ChargeType[] = ['endurance', 'frenzy', 'power'];

/** Most charges of a kind `sheet` can hold. */
export function chargeMax(sheet: StatSheet, type: ChargeType): number {
  return Math.max(0, Math.round(CHARGE_TUNING.baseMax + sheet.get(CHARGES[type].maxStat)));
}

/** Seconds charges last on `sheet` (`charge.duration` inc/more). */
export function chargeDuration(sheet: StatSheet): number {
  return CHARGE_TUNING.duration * Math.max(0.1, new StatQuery(sheet).scale('charge.duration'));
}

/** Chance (0..1) to gain a charge of `type` from a kill / hit / crit / stun, from the sheet plus a skill's mods. */
export function chargeChance(q: StatQuery, type: ChargeType, on: 'onKill' | 'onHit' | 'onCrit' | 'onStun'): number {
  const stat = on === 'onKill' ? 'charge.onKill' : on === 'onHit' ? 'charge.onHit' : on === 'onCrit' ? 'charge.onCrit' : 'charge.onStun';
  return Math.min(1, Math.max(0, q.flat(stat, [type])));
}

/** One actor's charges. Owns the `charges` stat source on its sheet. */
export class Charges {
  readonly count: Record<ChargeType, number> = { endurance: 0, frenzy: 0, power: 0 };
  /** Seconds left before each kind drops. */
  readonly left: Record<ChargeType, number> = { endurance: 0, frenzy: 0, power: 0 };
  /** The duration each kind's timer was last set to (buff bars). */
  readonly duration: Record<ChargeType, number> = { endurance: 0, frenzy: 0, power: 0 };
  /** Lifetime counters (tests, inspectors). */
  readonly gained: Record<ChargeType, number> = { endurance: 0, frenzy: 0, power: 0 };
  /** Bumps on every change (visuals, HUD). */
  version = 0;

  constructor(private readonly sheet: StatSheet) {}

  max(type: ChargeType): number {
    return chargeMax(this.sheet, type);
  }

  get total(): number {
    return this.count.endurance + this.count.frenzy + this.count.power;
  }

  /** Gain `n` charges of a kind (capped), refreshing its timer. Returns how many were added. */
  gain(type: ChargeType, n = 1): number {
    const max = this.max(type);
    const before = this.count[type];
    this.count[type] = Math.min(max, before + Math.max(0, Math.round(n)));
    if (max > 0 && n > 0) {
      const d = chargeDuration(this.sheet);
      this.left[type] = d;
      this.duration[type] = d;
    }
    const added = this.count[type] - before;
    if (added) {
      this.gained[type] += added;
      this.apply();
    }
    return added;
  }

  /** Remove every charge of a kind ('all': every kind). Returns how many were removed. */
  consume(type: ChargeType | 'all', n = Infinity): number {
    let out = 0;
    for (const t of type === 'all' ? CHARGE_TYPES : [type]) {
      const k = Math.min(this.count[t], n - out);
      if (k <= 0) continue;
      this.count[t] -= k;
      if (!this.count[t]) this.left[t] = 0;
      out += k;
    }
    if (out) this.apply();
    return out;
  }

  /** Drop everything (death, town). */
  clear(): void {
    if (!this.total) return;
    for (const t of CHARGE_TYPES) {
      this.count[t] = 0;
      this.left[t] = 0;
    }
    this.apply();
  }

  /** Timers; a kind whose maximum shrank (gear swap) is trimmed. */
  tick(dt: number): void {
    let changed = false;
    for (const t of CHARGE_TYPES) {
      if (!this.count[t]) continue;
      this.left[t] -= dt;
      const max = this.max(t);
      if (this.left[t] <= 0) {
        this.count[t] = 0;
        changed = true;
      } else if (this.count[t] > max) {
        this.count[t] = max;
        changed = true;
      }
    }
    if (changed) this.apply();
  }

  /** The `charges` source: each kind's mods × the charges held. */
  private apply(): void {
    this.version++;
    const mods: Mod[] = [];
    for (const t of CHARGE_TYPES) {
      const n = this.count[t];
      if (n > 0) for (const m of CHARGES[t].perCharge) mods.push(m.kind === 'flag' || m.kind === 'override' ? m : { ...m, value: m.value * n });
    }
    if (mods.length) this.sheet.set('charges', mods);
    else this.sheet.remove('charges');
  }
}
