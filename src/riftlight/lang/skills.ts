/**
 * The lines of skill and support gems (their names and descriptions), ailments and charges
 * (skills/, combat/). docs/game/lang.md has the rules for a line. Built from the registries
 * (their English is the line), so a gem added as data brings its lines along; the helpers below
 * show them. A curse is a skill: its name is its skill's. Tag words (`tag.<id>`) are lang/mods.ts's.
 */
import { AILMENTS } from '../combat/ailments';
import { CHARGES, CHARGE_TYPES } from '../combat/charges';
import type { ChargeType } from '../core/types';
import { SKILLS as ACTIVES } from '../skills/actives';
import { SUPPORTS } from '../skills/supports';
import { type LineArea, lineKey } from './area';
import { lang, t } from './index';

/** Every skill line (a function: the registries are read when the list is made). */
export function SKILLS(): LineArea {
  const lines: Record<string, string> = {};
  const notes: Record<string, string> = {};
  for (const s of ACTIVES.all()) {
    lines[lineKey('skill', s.id, 'name')] = s.name;
    lines[lineKey('skill', s.id, 'description')] = s.description ?? s.name;
    notes[lineKey('skill', s.id, 'name')] = `An active skill gem (tags: ${(s.tags ?? []).join(', ')}); also the name of what it leaves behind (a totem, a curse on an enemy).`;
    notes[lineKey('skill', s.id, 'description')] = 'What the skill does, in its gem tooltip and the skill panel; "you" is the player.';
  }
  for (const s of SUPPORTS.all()) {
    lines[lineKey('support', s.id, 'name')] = s.name;
    lines[lineKey('support', s.id, 'description')] = s.description ?? s.name;
    notes[lineKey('support', s.id, 'name')] = 'A support gem: linked to a skill, it changes how the skill works.';
    notes[lineKey('support', s.id, 'description')] = 'What the support does to the skill it is linked to, in its gem tooltip.';
  }
  for (const a of AILMENTS.all()) {
    lines[lineKey('ailment', a.id)] = a.name;
    notes[lineKey('ailment', a.id)] = 'An ailment a hit can cause (on the status row over a monster or the hero).';
  }
  for (const type of CHARGE_TYPES) {
    lines[lineKey('charge', type)] = `${CHARGES[type].name} charges`;
    lines[lineKey('charge', type, 'description')] = CHARGES[type].description;
    notes[lineKey('charge', type)] = 'Charges of one kind the hero holds (the buff row shows how many).';
  }
  return { lines, notes };
}

/** A line, or the registry's English when the game has none (a gem made in a test). */
function lineOr(id: string, english: string): string {
  return lang().has(id) ? t(id) : english;
}

/** An active skill's name ("Fireball"). */
export function skillName(id: string): string {
  return lineOr(lineKey('skill', id, 'name'), ACTIVES.has(id) ? ACTIVES.get(id).name : id);
}

/** What an active skill does. */
export function skillDescription(id: string): string {
  return lineOr(lineKey('skill', id, 'description'), ACTIVES.has(id) ? (ACTIVES.get(id).description ?? '') : '');
}

/** A support gem's name ("Faster Casting"). */
export function supportName(id: string): string {
  return lineOr(lineKey('support', id, 'name'), SUPPORTS.has(id) ? SUPPORTS.get(id).name : id);
}

/** What a support gem does. */
export function supportDescription(id: string): string {
  return lineOr(lineKey('support', id, 'description'), SUPPORTS.has(id) ? (SUPPORTS.get(id).description ?? '') : '');
}

/** An ailment's name ("Ignite"). */
export function ailmentName(id: string): string {
  return lineOr(lineKey('ailment', id), AILMENTS.has(id) ? AILMENTS.get(id).name : id);
}

/** A kind of charges, counted ("Frenzy charges"). */
export function chargeName(type: ChargeType): string {
  return lineOr(lineKey('charge', type), `${CHARGES[type].name} charges`);
}

/** What each charge of a kind gives. */
export function chargeDescription(type: ChargeType): string {
  return lineOr(lineKey('charge', type, 'description'), CHARGES[type].description);
}

/** A curse's name: its skill's (`CurseInstance.id` is the skill's id), else what it was saved with. */
export function curseName(curse: { readonly id: string; readonly name?: string }): string {
  return ACTIVES.has(curse.id) ? skillName(curse.id) : (curse.name ?? curse.id);
}
