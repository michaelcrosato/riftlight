import type { PaletteColor } from '../../engine/palette';
import { DARK, SHAPES } from '../skills/icons';
import type { ResolvedSkill } from '../skills/types';

/**
 * Skill bar icons: the shared gem icons (`skills/icons.ts`: the bags and the skill panel draw
 * the same ones), shaped by the *resolved* skill (supports can change its delivery).
 */
const BY_SKILL: Readonly<Record<string, string>> = { cleave: 'cleave', 'leap-slam': 'leap', 'war-cry': 'buff', 'molten-shell': 'buff', 'dodge-roll': 'dodge', blink: 'dash' };

export function skillIcon(skill: ResolvedSkill): { icon: readonly string[]; colors: Readonly<Record<string, PaletteColor>> } {
  const shape = BY_SKILL[skill.id] ?? (skill.def.leap ? 'leap' : skill.tags.includes('buff') && skill.delivery.kind !== 'aura' ? 'buff' : skill.delivery.kind);
  const look = skill.def.look;
  const c = look.color;
  const h = look.glow?.[0] ?? 'white';
  return { icon: SHAPES[shape] ?? SHAPES.strike!, colors: { h, c, d: DARK[c] ?? 'slate' } };
}
