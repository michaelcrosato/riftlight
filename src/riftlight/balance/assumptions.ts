/**
 * Every number the balance sim adds on top of the game's own code, in one place. Everything
 * else (damage, mitigation, skills, supports, gear, tree, monster genomes, scaling, XP) is
 * the game's real code. `npm run balance` prints this object into its JSON and summary so a
 * tuning agent knows exactly what is modelled and what is assumed.
 */
import { ACTOR_BASE } from '../combat/tuning';

/** The hero's base record (HeroController.ts `new Actor({ base })`; a unit test keeps them in sync). */
export const HERO_BASE: Readonly<Record<string, number>> = { life: 120, mana: 60, 'mana.regen': 4, 'life.regen': 2, 'move.speed': 5.6, accuracy: 600, mass: 3 };

export interface Assumptions {
  /** Hero base gained per character level after the first (the shell's hero port uses +12 life, +4 mana). */
  readonly heroGrowth: Readonly<Record<string, number>>;
  /** A monster's base record before genome mods, depth scaling and rank (the Actor default). */
  readonly monsterBase: Readonly<Record<string, number>>;
  /** Share of an engaged monster's time spent attacking (the rest: approach, strafe, wind-ups the hero dodges). */
  readonly monsterUptime: number;
  /** Share of a pack attacking the hero at once. */
  readonly packEngaged: number;
  /** Enemies a delivery reaches at once in a pack fight (projectiles: count + chain + pierce + fork, by the DPS model). */
  readonly reach: Readonly<Record<string, number>>;
  /** Walked distance = critical path × this (side rooms, backtracking). */
  readonly walkDetour: number;
  /** Minions alive in a sustained fight: count × SUMMON_BATCHES (combat/deliveries/summon.ts); they are assumed to survive. */
  readonly minionBatches: number;
  /** Candidate rares rolled per slot for a geared build; the best one by the sim's score is worn. */
  readonly gearCandidates: number;
  /** Genomes sampled per depth and rank (their stats are averaged). */
  readonly samples: number;
  /** Skill used when mana runs out (free). */
  readonly fallbackSkill: string;
  /** Map stat names some systems write to the names combat reads (see STAT_ALIASES). Off with --raw. */
  readonly aliases: boolean;
  /** Times each depth is cleared on the way down (XP curve). */
  readonly clears: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  heroGrowth: { life: 12, mana: 4 },
  monsterBase: { ...ACTOR_BASE },
  monsterUptime: 0.5,
  packEngaged: 0.5,
  reach: { strike: 1, 'strike+area': 3, nova: 4, slam: 4, beam: 2, trap: 3, dash: 2, projectile: 4, summon: 1, aura: 0 },
  walkDetour: 1.6,
  minionBatches: 2,
  gearCandidates: 12,
  samples: 6,
  fallbackSkill: 'slash',
  aliases: true,
  clears: 1,
};

/** One line per assumption for the console and the JSON. */
export function describeAssumptions(a: Assumptions): string[] {
  return [
    `hero base ${JSON.stringify(HERO_BASE)}, +${a.heroGrowth.life} life and +${a.heroGrowth.mana} mana per level`,
    `monster base life ${a.monsterBase.life}, accuracy ${a.monsterBase.accuracy}; × genome mods (plan, parts, archetype, elite, rank) × SCALING.monsterLife/Damage(depth)`,
    `monsters attack ${Math.round(a.monsterUptime * 100)}% of the time; ${Math.round(a.packEngaged * 100)}% of a pack at once`,
    `pack reach: ${Object.entries(a.reach).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `walk = critical path × ${a.walkDetour} / move speed`,
    `minions: ${a.minionBatches} batches alive, never die`,
    `geared: best of ${a.gearCandidates} rares per slot at the depth's item level; tree: greedy best value per point (notables + frontier), no masteries or keystones`,
    `gem level = highest the hero can equip (1 + 3 per level); supports at the same level`,
    `out of mana: ${a.fallbackSkill} until the pool refills`,
    `${a.samples} genomes per depth and rank; elite behaviours, conditional mods and boss hazards are not modelled`,
    a.aliases ? 'stat aliases ON: renamed stats (crit.multi → crit.multiplier, ...) are mapped to what combat reads; --raw turns this off' : 'stat aliases OFF (--raw): stats only count if combat reads them by that exact name',
  ];
}
