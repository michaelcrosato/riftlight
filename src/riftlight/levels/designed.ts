import type { Genome, LevelSpec } from '../core/types';
import { hashString } from '../core/rng';
import type { LayoutStyle } from './layout/grid';
import { shiftTheme } from './themes/palette';
import { getTheme, type LevelTheme } from './themes/themes';

/**
 * The 12 designed levels (docs/GAME.md). Each introduces one mechanic and is named after
 * it; levels 7–12 bring back an earlier mechanic. Seeds, styles, sizes, themes, archetypes
 * and bosses are hand-tuned here. Archetype ids are the monsters system's (strings).
 */
export const ARCHETYPES = ['charger', 'skirmisher', 'caster', 'summoner', 'bomber', 'tank', 'swarm', 'sniper', 'leaper', 'totem'] as const;

/** A placeholder boss genome (the monsters system replaces it with `generateGenome`). */
export function bossGenome(seed: number, plan: string, archetype: string, theme: string, scale = 2.4): Genome {
  const t = getTheme(theme.split('~')[0]!);
  return {
    seed,
    plan,
    parts: [],
    genes: {},
    palette: { primary: t.palette.wall, secondary: t.trim, accent: t.palette.accent, glow: t.palette.light, dark: t.cliff },
    scale,
    archetype,
    elite: [],
    rank: 'boss',
  };
}

interface Design {
  readonly mechanics: readonly string[];
  readonly theme: string;
  readonly style: LayoutStyle;
  readonly rooms: number;
  readonly size: number;
  readonly archetypes: readonly string[];
  readonly boss: { plan: string; archetype: string; scale?: number };
}

const DESIGNS: readonly Design[] = [
  { mechanics: ['embers'], theme: 'ember-forge', style: 'dungeon', rooms: 7, size: 72, archetypes: ['charger', 'swarm', 'bomber'], boss: { plan: 'brute', archetype: 'tank' } },
  { mechanics: ['gloom'], theme: 'gloom-crypt', style: 'dungeon', rooms: 8, size: 78, archetypes: ['skirmisher', 'caster', 'swarm'], boss: { plan: 'floater', archetype: 'summoner' } },
  { mechanics: ['gale'], theme: 'gale-cliffs', style: 'bridges', rooms: 8, size: 84, archetypes: ['leaper', 'sniper', 'charger'], boss: { plan: 'quadruped', archetype: 'leaper' } },
  { mechanics: ['frostglass'], theme: 'frostglass-caverns', style: 'caves', rooms: 8, size: 84, archetypes: ['tank', 'caster', 'swarm'], boss: { plan: 'hexapod', archetype: 'tank' } },
  { mechanics: ['thornweave'], theme: 'thornweave-jungle', style: 'ruins', rooms: 9, size: 88, archetypes: ['summoner', 'skirmisher', 'charger'], boss: { plan: 'serpent', archetype: 'skirmisher' } },
  { mechanics: ['stormspire'], theme: 'stormspire-peaks', style: 'ruins', rooms: 9, size: 90, archetypes: ['totem', 'sniper', 'leaper'], boss: { plan: 'biped', archetype: 'caster', scale: 2.6 } },
  { mechanics: ['mire', 'gale'], theme: 'mire-swamp', style: 'caves', rooms: 10, size: 94, archetypes: ['tank', 'bomber', 'swarm'], boss: { plan: 'blob', archetype: 'bomber', scale: 2.8 } },
  { mechanics: ['echoes'], theme: 'echo-halls', style: 'dungeon', rooms: 10, size: 94, archetypes: ['caster', 'summoner', 'skirmisher'], boss: { plan: 'biped', archetype: 'summoner' } },
  { mechanics: ['riftgates', 'stormspire'], theme: 'rift-nexus', style: 'bridges', rooms: 11, size: 100, archetypes: ['leaper', 'sniper', 'totem', 'charger'], boss: { plan: 'floater', archetype: 'caster', scale: 2.6 } },
  { mechanics: ['bloodmoon', 'embers'], theme: 'bloodmoon-cathedral', style: 'dungeon', rooms: 11, size: 100, archetypes: ['swarm', 'bomber', 'charger', 'summoner'], boss: { plan: 'brute', archetype: 'charger', scale: 2.8 } },
  { mechanics: ['gravewell', 'frostglass'], theme: 'gravewell-observatory', style: 'town', rooms: 12, size: 96, archetypes: ['caster', 'tank', 'swarm', 'sniper'], boss: { plan: 'hexapod', archetype: 'totem', scale: 2.6 } },
  { mechanics: ['collapse', 'gloom'], theme: 'collapse-ruins', style: 'ruins', rooms: 12, size: 108, archetypes: ['charger', 'leaper', 'bomber', 'skirmisher', 'tank'], boss: { plan: 'quadruped', archetype: 'charger', scale: 3 } },
];

/** Hand-picked seeds (good layouts, checked with `npm run level -- map`). */
const SEEDS = [1101, 2207, 3301, 4409, 5501, 6607, 7703, 8807, 9901, 10007, 11003, 12011];

const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export const DESIGNED_LEVELS: readonly LevelSpec[] = DESIGNS.map((d, i) => ({
  depth: i + 1,
  name: title(d.mechanics[0]!),
  mechanics: d.mechanics,
  theme: d.theme,
  seed: SEEDS[i]!,
  layout: { style: d.style, rooms: d.rooms, size: d.size },
  archetypes: d.archetypes,
  boss: bossGenome(SEEDS[i]! ^ 0xb055, d.boss.plan, d.boss.archetype, d.theme, d.boss.scale),
}));

/** Level `depth` (1..12 designed, deeper: see rift.ts `levelSpec`). */
export function designedSpec(depth: number): LevelSpec {
  const s = DESIGNED_LEVELS[depth - 1];
  if (!s) throw new Error(`designedSpec: no designed level ${depth} (1..12)`);
  return s;
}

/**
 * Resolve a theme id, including rift-shifted ids `base~h<hue>c<contrast>s<saturation>`
 * (written by `riftSpec`), so a LevelSpec stays plain data.
 */
export function resolveTheme(id: string): LevelTheme {
  const [base, shift] = id.split('~');
  const theme = getTheme(base!);
  if (!shift) return theme;
  const m = /^h(-?\d+)c(\d+)s(\d+)$/.exec(shift);
  if (!m) return theme;
  return { ...shiftTheme(theme, { hue: Number(m[1]), contrast: Number(m[2]) / 100, saturation: Number(m[3]) / 100 }), id };
}

/** Stable numeric seed for any string (e.g. a run seed + depth). */
export function seedOf(s: string): number {
  return hashString(s);
}
