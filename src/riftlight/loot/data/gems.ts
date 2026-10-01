/**
 * Gem ids that can drop or be sold, until the skills system (src/riftlight/skills) is
 * integrated: then the gem registry there replaces this list. A gem item stores
 * `{ gem: { id, level, support } }` on base 'skill-gem' or 'support-gem'.
 */
import type { Entry } from '../../core/registry';
import type { ItemBase } from '../../core/types';

export interface GemEntry extends Entry {
  readonly name: string;
  readonly support: boolean;
}

export const GEMS: readonly GemEntry[] = [
  { id: 'fireball', name: 'Fireball', support: false, tags: ['spell', 'fire', 'projectile'] },
  { id: 'spark', name: 'Spark', support: false, tags: ['spell', 'lightning', 'projectile'] },
  { id: 'ice-nova', name: 'Ice Nova', support: false, tags: ['spell', 'cold', 'area'] },
  { id: 'arc', name: 'Arc', support: false, tags: ['spell', 'lightning', 'chain'] },
  { id: 'frost-blink', name: 'Frost Blink', support: false, tags: ['spell', 'cold', 'movement'] },
  { id: 'cleave', name: 'Cleave', support: false, tags: ['attack', 'melee', 'area', 'physical'] },
  { id: 'ground-slam', name: 'Ground Slam', support: false, tags: ['attack', 'melee', 'area', 'physical'] },
  { id: 'whirling-blades', name: 'Whirling Blades', support: false, tags: ['attack', 'melee', 'movement'] },
  { id: 'lightning-arrow', name: 'Lightning Arrow', support: false, tags: ['attack', 'projectile', 'lightning'] },
  { id: 'poison-arrow', name: 'Poison Arrow', support: false, tags: ['attack', 'projectile', 'chaos'] },
  { id: 'flame-dash', name: 'Flame Dash', support: false, tags: ['spell', 'fire', 'movement'] },
  { id: 'summon-skeletons', name: 'Summon Skeletons', support: false, tags: ['spell', 'minion'] },
  { id: 'added-fire', name: 'Added Fire Damage', support: true, tags: ['fire'] },
  { id: 'multiple-projectiles', name: 'Multiple Projectiles', support: true, tags: ['projectile'] },
  { id: 'melee-physical', name: 'Melee Physical Damage', support: true, tags: ['melee', 'physical'] },
  { id: 'faster-casting', name: 'Faster Casting', support: true, tags: ['spell'] },
  { id: 'faster-attacks', name: 'Faster Attacks', support: true, tags: ['attack'] },
  { id: 'chain', name: 'Chain', support: true, tags: ['projectile', 'chain'] },
  { id: 'increased-area', name: 'Increased Area', support: true, tags: ['area'] },
  { id: 'elemental-focus', name: 'Elemental Focus', support: true, tags: ['fire', 'cold', 'lightning'] },
];

export const GEM_BASES: readonly ItemBase[] = [
  { id: 'skill-gem', name: 'Skill Gem', slot: 'gem', level: 1, implicit: [], base: {}, look: 'gem', tags: ['gem', 'skill'] },
  { id: 'support-gem', name: 'Support Gem', slot: 'gem', level: 1, implicit: [], base: {}, look: 'gem', tags: ['gem', 'support'] },
];
