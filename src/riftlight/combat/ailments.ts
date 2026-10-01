import type { PaletteColor } from '../../engine/palette';
import { Registry, type Entry } from '../core/registry';
import type { AilmentType, DamageType } from '../core/types';

/**
 * Ailments as data. A hit that lands `from` damage may apply the ailment (by chance, or
 * always for `always` ones, or when the hit is big enough for `threshold` ones); its
 * strength comes from `magnitude(damage, maxLife)`:
 *
 *   dot   damage per second, dealt as `dotType` (ignite, bleed, poison)
 *   slow  fraction of action and movement speed lost (chill)
 *   stop  no action or movement for the duration (freeze, stun)
 *   amp   fraction of increased damage taken (shock)
 *
 * Add an ailment: a new AilmentType in core/types.ts, then an entry here. The pipeline
 * (damage.ts), the actor status (actors/Actor.ts) and the inspector all read this registry.
 */
export type AilmentKind = 'dot' | 'slow' | 'stop' | 'amp';

export interface AilmentDef extends Entry {
  readonly id: AilmentType;
  readonly name: string;
  readonly kind: AilmentKind;
  /** Damage types whose landed damage can cause it (and set its magnitude). */
  readonly from: readonly DamageType[];
  /** Only from hits with these tags (bleed: attacks). */
  readonly requires?: readonly string[];
  /** Applied whenever `from` damage lands, without a chance roll (chill). */
  readonly always?: boolean;
  /** Applied (without a chance roll) when the landed damage passes this check (stun). */
  threshold?(damage: number, maxLife: number): boolean;
  /** Base duration, seconds. `stop` ailments may scale it from the hit (see `scaleDuration`). */
  readonly duration: number;
  /** Duration multiplier from the hit's size (freeze and stun last longer after big hits). */
  scaleDuration?(damage: number, maxLife: number): number;
  /** Strength from the landed damage of the `from` types and the target's max life. */
  magnitude(damage: number, maxLife: number): number;
  /** dot: the type of the damage it deals. */
  readonly dotType?: DamageType;
  /** Several instances at once (poison); otherwise the strongest one wins and refreshes. */
  readonly stacks?: boolean;
  /** Elemental crits always apply it. */
  readonly critApplies?: boolean;
  /** Colour for damage numbers, status icons, tint. */
  readonly color: PaletteColor;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** PoE-style "effect from damage vs threshold": 50% × (damage / max life)^0.4. */
const relative = (damage: number, maxLife: number) => (maxLife > 0 ? 0.5 * Math.pow(damage / maxLife, 0.4) : 0);

export const AILMENTS = new Registry<AilmentDef>('ailment', [
  {
    id: 'ignite', name: 'Ignite', kind: 'dot', from: ['fire'], dotType: 'fire', duration: 4, critApplies: true,
    magnitude: (d) => d * 0.5, color: 'orange', tags: ['elemental', 'dot'],
  },
  {
    id: 'bleed', name: 'Bleed', kind: 'dot', from: ['physical'], requires: ['attack'], dotType: 'physical', duration: 5,
    magnitude: (d) => d * 0.35, color: 'red', tags: ['physical', 'dot'],
  },
  {
    id: 'poison', name: 'Poison', kind: 'dot', from: ['physical', 'chaos'], dotType: 'chaos', duration: 2, stacks: true,
    magnitude: (d) => d * 0.3, color: 'lime', tags: ['chaos', 'dot'],
  },
  {
    id: 'chill', name: 'Chill', kind: 'slow', from: ['cold'], always: true, duration: 2,
    magnitude: (d, life) => clamp(relative(d, life), 0.1, 0.3), color: 'sky', tags: ['elemental'],
  },
  {
    id: 'freeze', name: 'Freeze', kind: 'stop', from: ['cold'], duration: 0.6, critApplies: true,
    scaleDuration: (d, life) => clamp((d / Math.max(1, life)) * 8, 0.5, 3),
    magnitude: () => 1, color: 'cyan', tags: ['elemental'],
  },
  {
    id: 'shock', name: 'Shock', kind: 'amp', from: ['lightning'], duration: 2, critApplies: true,
    magnitude: (d, life) => clamp(relative(d, life), 0.05, 0.5), color: 'sand', tags: ['elemental'],
  },
  {
    id: 'stun', name: 'Stun', kind: 'stop', from: ['physical'], duration: 0.35,
    threshold: (d, life) => d >= life * 0.12,
    scaleDuration: (d, life) => clamp(d / Math.max(1, life) / 0.12, 1, 3),
    magnitude: () => 1, color: 'white', tags: ['physical'],
  },
]);

/** Damage of the types an ailment reads, from a landed hit. */
export function ailmentDamage(def: AilmentDef, byType: Partial<Record<DamageType, number>>): number {
  let d = 0;
  for (const t of def.from) d += byType[t] ?? 0;
  return d;
}
