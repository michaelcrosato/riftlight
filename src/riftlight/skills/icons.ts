import type { PaletteColor } from '../../engine/palette';
import type { Mod } from '../core/mods';
import { SKILLS } from './actives';
import { SUPPORTS } from './supports';
import type { SkillGem, SupportGem } from './types';

/**
 * Pixel icons for every gem (8 × 6 rows, `hud.sprite` format: `h` highlight, `c` colour, `d`
 * shadow), used by the skill bar and by the inventory, the skill panel and the vendor.
 *
 * Generated from the gem's data, like every other look in Riftlight: an active skill draws
 * the shape of its delivery (or a hand-picked one) in its `look` colours; a support draws a
 * glyph for what it changes (more projectiles, chain, pierce, area, speed, crit, leech,
 * minions, duration, traps, penetration...) in the colour of the damage type it is about.
 * A new gem gets an icon with no work; add a row set to `SHAPES` / `GLYPHS` to give it its own.
 */
export interface GemIcon {
  readonly rows: readonly string[];
  readonly colors: Readonly<Record<'h' | 'c' | 'd', PaletteColor>>;
}

/** Active skills by delivery (and a few by name). */
export const SHAPES: Readonly<Record<string, readonly string[]>> = {
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

/** Support glyphs, by what the support does. */
export const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  projectiles: ['.h......', 'hcc.....', '.h..h...', '...hcc..', '.h..h...', 'hcc.....'],
  chain: ['h.......', '.c...h..', '..c.c.c.', '...c...c', '........', '........'],
  pierce: ['....h...', 'cccchh..', 'dd..hhh.', 'cccchh..', '....h...', '........'],
  fork: ['.....hh.', '....c...', 'hccc....', '....c...', '.....hh.', '........'],
  area: ['..hhhh..', '.h....h.', 'h..cc..h', 'h..cc..h', '.h....h.', '..hhhh..'],
  focus: ['...hh...', '..hcch..', '.hcddch.', '.hcddch.', '..hcch..', '...hh...'],
  speed: ['h..h....', '.h..h...', '..h..h..', '.h..h...', 'h..h....', '........'],
  echo: ['.hh..cc.', 'h...c...', 'h...c...', 'h...c...', '.hh..cc.', '........'],
  crit: ['...h....', '...h....', 'hhhchhh.', '..ccc...', '.c...c..', '........'],
  leech: ['...h....', '..hc....', '.hccc...', '.cccc...', '..dd....', '........'],
  minion: ['.hhhh...', 'hchhch..', 'hhhhhh..', '.hddh...', '.h..h...', '........'],
  duration: ['hhhhhh..', '.hcch...', '..cc....', '..hh....', '.hddh...', 'hhhhhh..'],
  trap: ['..h..h..', '...hh...', '.hhcchh.', '..dccd..', '.dddddd.', '........'],
  pen: ['h.......', '.h.dd...', '..hcd...', '..dch...', '...d.h..', '......h.'],
  ailment: ['..h.....', '.hch....', '.hcch...', 'hcccch..', '.hddh...', '........'],
  damage: ['...h....', '..hch...', '.hccch..', 'hcccccd.', '.dcccd..', '..ddd...'],
  knockback: ['....hh..', 'cc.h..h.', '.cch....', 'cc.h..h.', '....hh..', '........'],
  cull: ['.hhhh...', 'h....h..', '...hh...', '..hc....', '.hc.....', 'hc......'],
  buff: ['..hhhh..', '.h....h.', 'h.cccc.h', 'h.c..c.h', '.h.cc.h.', '..hhhh..'],
};

/** Darker partner of a palette colour for an icon's shadow pixels. */
export const DARK: Partial<Record<PaletteColor, PaletteColor>> = { orange: 'red', red: 'plum', sand: 'orange', cyan: 'blue', sky: 'blue', white: 'mist', mist: 'slate', lime: 'green', green: 'teal', plum: 'night', blue: 'navy' };

/** Colour of a damage type / element tag on icons. */
const ELEMENT: Readonly<Record<string, PaletteColor>> = { fire: 'orange', cold: 'cyan', lightning: 'sand', chaos: 'lime', physical: 'mist' };

/** The icon of an active skill gem (the bar and the bags draw the same one). */
export function activeIcon(gem: SkillGem): GemIcon {
  const shape = BY_SKILL[gem.id] ?? (gem.leap ? 'leap' : gem.tags.includes('buff') && gem.delivery.kind !== 'aura' ? 'buff' : gem.delivery.kind);
  const c = gem.look.color;
  const h = gem.look.glow?.[0] ?? 'white';
  return { rows: SHAPES[shape] ?? SHAPES.strike!, colors: { h, c, d: DARK[c] ?? 'slate' } };
}

const stats = (mods: readonly Mod[]) => mods.map((m) => m.stat).join(' ');

/** The glyph of a support gem, from what it changes and which stats it touches. */
function supportGlyph(s: SupportGem): string {
  const ch = s.changes ?? {};
  const st = stats(s.mods);
  if (ch.projectiles) return 'projectiles';
  if (ch.chain) return 'chain';
  if (ch.pierce) return 'pierce';
  if (ch.fork) return 'fork';
  if (ch.repeats) return s.requires.includes('spell') ? 'echo' : 'speed';
  if (ch.area || /\barea\b/.test(st)) return /more/.test(s.mods.map((m) => m.kind).join(' ')) && s.id.includes('concentrated') ? 'focus' : 'area';
  if (s.requires.includes('minion')) return 'minion';
  if (s.requires.includes('trap')) return 'trap';
  if (s.requires.includes('duration')) return 'duration';
  if (s.requires.includes('buff')) return 'buff';
  if (/\bpen\./.test(st)) return 'pen';
  if (/crit/.test(st)) return 'crit';
  if (/leech/.test(st)) return 'leech';
  if (/\bcull\b/.test(st)) return 'cull';
  if (/knockback|stun/.test(st)) return 'knockback';
  if (/speed/.test(st)) return 'speed';
  if (/bleed|poison|ignite|chill|freeze|shock|ailment/.test(st)) return 'ailment';
  return 'damage';
}

/** The colour of a support gem: its element, else what its stats are about. */
function supportColor(s: SupportGem): PaletteColor {
  for (const t of [...(s.tags ?? []), ...s.requires]) if (ELEMENT[t]) return ELEMENT[t]!;
  const st = stats(s.mods);
  for (const e of ['fire', 'cold', 'lightning', 'chaos']) if (st.includes(e)) return ELEMENT[e]!;
  if (/leech\.life|life/.test(st)) return 'red';
  if (/mana/.test(st)) return 'sky';
  if (s.requires.includes('minion')) return 'lime';
  if (/speed/.test(st)) return 'cyan';
  return 'sand';
}

/** The icon of a support gem. */
export function supportIcon(s: SupportGem): GemIcon {
  const c = supportColor(s);
  return { rows: GLYPHS[supportGlyph(s)]!, colors: { h: 'white', c, d: DARK[c] ?? 'slate' } };
}

/** Any gem by id (null for an unknown id). */
export function gemIcon(id: string, support: boolean): GemIcon | null {
  if (support) return SUPPORTS.has(id) ? supportIcon(SUPPORTS.get(id)) : null;
  return SKILLS.has(id) ? activeIcon(SKILLS.get(id)) : null;
}
