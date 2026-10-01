import type { Delivery } from '../../core/types';
import { aura } from './aura';
import { beam } from './beam';
import { dash } from './dash';
import { nova } from './nova';
import { projectile } from './projectile';
import { slam } from './slam';
import { strike } from './strike';
import { summon } from './summon';
import { trap } from './trap';
import type { DeliveryImpl } from './types';

/**
 * The runtime of every Delivery kind in core/types.ts. A new kind: add it to the Delivery
 * union, write `(c: CastContext) => CombatEffect | null` next to these, register it here.
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
};

export type { CastContext, CastOptions, CombatEffect, DeliveryImpl } from './types';
