/**
 * Gems that drop and are sold: every active skill and support gem of the skills system
 * (`src/riftlight/skills`: `ACTIVE_SKILLS`, `SUPPORT_GEMS`), so a new skill or support is a
 * new gem with nothing to add here. A gem item stores `{ gem: { id, level, support } }` on
 * base 'skill-gem' or 'support-gem'; the skill panel sockets it (loot/sockets.ts).
 */
import type { Entry } from '../../core/registry';
import type { ItemBase } from '../../core/types';
import { ACTIVE_SKILLS } from '../../skills/actives';
import { SUPPORT_GEMS } from '../../skills/supports';

export interface GemEntry extends Entry {
  readonly name: string;
  readonly support: boolean;
  /** One line for the tooltip (the skill's own description). */
  readonly description?: string;
}

/** Skills every hero has without a gem (the basic attack and the dodge roll): never dropped or sold. */
export const INNATE_SKILLS: ReadonlySet<string> = new Set(['slash', 'dodge-roll']);

/** Drop weight: actives a little more common than supports. */
const ACTIVE_WEIGHT = 1.2;
const SUPPORT_WEIGHT = 1;

export const GEMS: readonly GemEntry[] = [
  ...ACTIVE_SKILLS.filter((s) => !INNATE_SKILLS.has(s.id)).map((s) => ({
    id: s.id,
    name: s.name,
    support: false,
    tags: [...s.tags],
    weight: ACTIVE_WEIGHT,
    description: s.description,
  })),
  ...SUPPORT_GEMS.map((s) => ({
    id: s.id,
    name: s.name,
    support: true,
    // a support is found by what it links to
    tags: [...s.requires, ...(s.tags ?? [])],
    weight: SUPPORT_WEIGHT,
    description: s.description,
  })),
];

export const GEM_BASES: readonly ItemBase[] = [
  { id: 'skill-gem', name: 'Skill Gem', slot: 'gem', level: 1, implicit: [], base: {}, look: 'gem', tags: ['gem', 'skill'] },
  { id: 'support-gem', name: 'Support Gem', slot: 'gem', level: 1, implicit: [], base: {}, look: 'gem', tags: ['gem', 'support'] },
];
