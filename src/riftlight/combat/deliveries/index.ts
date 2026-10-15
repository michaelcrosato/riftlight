import type { Delivery } from '../../core/types';
import { restoreTotem } from '../totems';
import { aura, restoreAura } from './aura';
import { beam, restoreBeam } from './beam';
import { curse, restoreCurse } from './curse';
import { dash, restoreDash } from './dash';
import { nova, restoreNova } from './nova';
import { projectile, restoreProjectile } from './projectile';
import { restoreSlam, slam } from './slam';
import { restoreStrike, strike } from './strike';
import { restoreSummon, summon } from './summon';
import { restoreTrap, restoreZone, trap } from './trap';
import type { DeliveryImpl, EffectRestore } from './types';

/**
 * The runtime of every Delivery kind in core/types.ts. A new kind: add it to the Delivery
 * union, write `(c: CastContext) => CombatEffect | null` next to these, register it here
 * (and its effect's restore in `RESTORE`).
 */
export const DELIVERIES: Readonly<Record<Delivery['kind'], DeliveryImpl>> = {
  strike,
  slam,
  projectile,
  nova,
  beam,
  dash,
  summon,
  aura,
  trap,
  curse,
};

/**
 * Every running effect made again from its `save()` (save-states), by its `kind`: its state
 * and visuals, re-requested lights and re-linked motions, none of its start-up.
 */
export const RESTORE: Readonly<Record<string, EffectRestore>> = {
  strike: restoreStrike,
  slam: restoreSlam,
  projectile: restoreProjectile,
  nova: restoreNova,
  beam: restoreBeam,
  dash: restoreDash,
  summon: restoreSummon,
  aura: restoreAura,
  trap: restoreTrap,
  zone: restoreZone,
  curse: restoreCurse,
  totem: restoreTotem,
};

export type { CastContext, CastOptions, CastWiring, CombatEffect, DeliveryImpl, EffectRestore, EffectState, SavedCast, SavedCastOptions } from './types';
