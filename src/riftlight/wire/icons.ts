import type { PaletteColor } from '../../engine/palette';
import type { ResolvedSkill } from '../skills/types';

/**
 * Skill bar icons as pixel rows (`hud.sprite` format, 8 × 6): one per delivery kind, a few
 * hand-drawn ones for the default gems, coloured from the gem's `look`. Data, like every
 * other look in Riftlight: add a row set here to give a gem its own icon.
 */
const SHAPES: Readonly<Record<string, readonly string[]>> = {
  strike: ['......h.', '.....hc.', '....hc..', '.d.hc...', '..dc....', '.d.d....'],
  cleave: ['..hhhh..', '.h....h.', 'h..cc..h', '...cc...', '..d..d..', '.d....d.'],
  slam: ['...hh...', '...cc...', '...cc...', '.h.cc.h.', 'hhcccchh', '.dddddd.'],
  projectile: ['........', '...hh...', '.ccchh..', 'dccchhh.', '.ccchh..', '...hh...'],
  nova: ['..h..h..', '.h.cc.h.', '..cddc..', 'hcd..dch', '..cddc..', '.h.cc.h.'],
  beam: ['h.......', '.hh.....', '..cchh..', '...ccchh', '..cchh..', '.hh.....'],
  dash: ['........', 'cc..hh..', '.cc..hh.', '..cc..hh', '.cc..hh.', 'cc..hh..'],
  summon: ['..hhh...', '.h.h.h..', '.hhhhh..', '..h.h...', '.c.c.c..', 'dddddddd'],
  aura: ['.hhhhhh.', 'h......h', 'h.cccc.h', 'h.c..c.h', 'h......h', '.hhhhhh.'],
  trap: ['........', '..h..h..', '...hh...', '.hhcchh.', '..dccd..', '.dddddd.'],
  buff: ['..hhhh..', '.h....h.', 'h.cccc.h', 'h.c..c.h', '.h.cc.h.', '..hhhh..'],
  leap: ['....hh..', '...h..h.', '..h....h', '.c......', 'ccc.....', 'dddd....'],
  dodge: ['..hh....', '.h..h...', 'h....h..', '......h.', '.cc.cc.c', '...c....'],
};

/** Hand-picked shapes for gems whose delivery says too little. */
const BY_SKILL: Readonly<Record<string, string>> = { cleave: 'cleave', 'leap-slam': 'leap', 'war-cry': 'buff', 'molten-shell': 'buff', 'dodge-roll': 'dodge', blink: 'dash' };

/** Darker partner of a palette colour for the icon's shadow pixels. */
const DARK: Partial<Record<PaletteColor, PaletteColor>> = { orange: 'red', red: 'plum', sand: 'orange', cyan: 'blue', sky: 'blue', white: 'mist', mist: 'slate', lime: 'green', green: 'teal', plum: 'night', blue: 'navy' };

export function skillIcon(skill: ResolvedSkill): { icon: readonly string[]; colors: Readonly<Record<string, PaletteColor>> } {
  const shape = BY_SKILL[skill.id] ?? (skill.def.leap ? 'leap' : skill.tags.includes('buff') && skill.delivery.kind !== 'aura' ? 'buff' : skill.delivery.kind);
  const look = skill.def.look;
  const c = look.color;
  const h = look.glow?.[0] ?? 'white';
  return { icon: SHAPES[shape] ?? SHAPES.strike!, colors: { h, c, d: DARK[c] ?? 'slate' } };
}
