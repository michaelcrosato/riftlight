import { Rng } from '../core/rng';
import { SCALING } from '../core/scaling';
import type { LevelSpec } from '../core/types';
import { ARCHETYPES, bossGenome, designedSpec } from './designed';
import type { LayoutStyle } from './layout/grid';
import { MECHANICS, pickCompatible } from './mechanics';
import { riftShift } from './themes/palette';
import { THEMES } from './themes/themes';

/**
 * Rifts: endless levels past depth 12. `riftSpec(seed, depth)` combines 2–4 compatible
 * mechanics (`SCALING.riftMechanics`), a theme with a palette shift, a layout style, 3–5
 * archetypes and a boss, and names the result after its mechanics ("Rift 37: Frostglass
 * Gravewell"). Same seed + depth, same rift.
 */

/** Each mechanic's home theme: a rift built around it starts from there half the time. */
const HOME_THEME: Record<string, string> = {
  embers: 'ember-forge',
  gloom: 'gloom-crypt',
  gale: 'gale-cliffs',
  frostglass: 'frostglass-caverns',
  thornweave: 'thornweave-jungle',
  stormspire: 'stormspire-peaks',
  mire: 'mire-swamp',
  echoes: 'echo-halls',
  riftgates: 'rift-nexus',
  bloodmoon: 'bloodmoon-cathedral',
  gravewell: 'gravewell-observatory',
  collapse: 'collapse-ruins',
};

const STYLE_WEIGHTS: readonly [LayoutStyle, number][] = [
  ['dungeon', 3],
  ['caves', 2],
  ['ruins', 2],
  ['bridges', 2],
  ['town', 1],
  ['arena', 1],
];

const PLANS = ['biped', 'quadruped', 'hexapod', 'serpent', 'floater', 'blob', 'brute'];

export function riftSpec(seed: number, depth: number): LevelSpec {
  if (depth <= 12) throw new Error(`riftSpec: depth ${depth} is a designed level (use designedSpec)`);
  const rng = new Rng(seed).fork(`rift:${depth}`);
  const n = SCALING.riftMechanics(depth);
  const mechanics = pickCompatible(rng.fork('mechanics'), n);
  const tr = rng.fork('theme');
  const base = tr.chance(0.5) ? HOME_THEME[mechanics[0]!]! : tr.pick(THEMES.all()).id;
  const s = riftShift(tr, depth);
  const theme = `${base}~h${s.hue}c${Math.round(s.contrast * 100)}s${Math.round(s.saturation * 100)}`;
  const style = rng.fork('style').weighted(STYLE_WEIGHTS, (w) => w[1])[0];
  const rooms = Math.min(16, 8 + Math.floor(depth / 6));
  const archetypes = rng.fork('archetypes').shuffle([...ARCHETYPES]).slice(0, rng.int(3, 5));
  const br = rng.fork('boss');
  const levelSeed = rng.fork('layout').int(1, 2 ** 31 - 2);
  const names = mechanics.slice(0, 3).map((id) => MECHANICS.get(id).name);
  return {
    depth,
    name: `Rift ${depth}: ${names.join(' ')}`,
    mechanics,
    theme,
    seed: levelSeed,
    layout: { style, rooms, size: 70 + rooms * 3 + (style === 'town' ? 10 : 0) },
    archetypes,
    boss: bossGenome(br.int(1, 2 ** 31 - 2), br.pick(PLANS), br.pick(archetypes), theme, br.range(2.4, 3.2)),
  };
}

/** The spec for any depth: designed levels 1..12, rifts beyond (seeded by the run). */
export function levelSpec(depth: number, runSeed = 1): LevelSpec {
  return depth <= 12 ? designedSpec(depth) : riftSpec(runSeed, depth);
}
