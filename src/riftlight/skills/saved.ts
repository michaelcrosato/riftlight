/**
 * A resolved skill as data (save-states): everything but its gem, which is named by id and found
 * again in the registry (the same object, so identity checks hold). Skills cast earlier keep the
 * numbers they were cast with, so a restore takes them as they were, not as the sheet makes them now.
 */
import { SKILLS } from './actives';
import type { ResolvedSkill, SkillGem } from './types';

export type SavedSkill = Omit<ResolvedSkill, 'def' | 'inner'> & { readonly def: string; readonly inner?: SavedSkill };

export function saveSkill(s: ResolvedSkill): SavedSkill {
  const { def, inner, ...rest } = s;
  return { ...rest, def: def.id, ...(inner ? { inner: saveSkill(inner) } : {}) };
}

/** `saveSkill` undone; `gems` finds a gem by id (the hero's registry by default; monsters pass theirs). */
export function loadSkill(d: SavedSkill, gems: (id: string) => SkillGem | undefined = (id) => (SKILLS.has(id) ? SKILLS.get(id) : undefined)): ResolvedSkill {
  const { def, inner, ...rest } = d;
  const gem = gems(def);
  if (!gem) throw new Error(`loadSkill: no skill gem "${def}"`);
  return { ...rest, def: gem, ...(inner ? { inner: loadSkill(inner, gems) } : {}) } as ResolvedSkill;
}
