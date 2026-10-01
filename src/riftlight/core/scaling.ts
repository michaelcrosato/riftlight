/**
 * Every depth-dependent number in one place, so the endless game is balanced in one file.
 * Depth 1..12 are the designed levels; 13+ are rifts. Nothing caps: curves are smooth
 * exponentials with gentle late-game slopes (tune here, re-run `npm run balance`).
 */
export const SCALING = {
  /** Monster life multiplier vs depth 1. */
  monsterLife: (depth: number) => Math.pow(1.17, depth - 1) * (1 + 0.04 * Math.max(0, depth - 12)),
  /** Monster damage multiplier vs depth 1. */
  monsterDamage: (depth: number) => Math.pow(1.12, depth - 1),
  /** Monster level (also its item level for drops). */
  monsterLevel: (depth: number) => Math.min(100, 1 + Math.round(depth * 3.2)) + Math.max(0, depth - 30),
  /** XP for killing a normal monster of `level`. */
  monsterXp: (level: number) => Math.round(6 * Math.pow(level, 1.35)),
  /** XP needed to go from `level` to `level + 1`. */
  xpToNext: (level: number) => Math.round(40 * Math.pow(level, 2.25) + 60 * level),
  /** Gold per normal kill (before rarity/elite multipliers). */
  gold: (depth: number) => Math.round(2 + depth * 1.5 + Math.pow(depth, 1.3)),
  /** Power budget a generator may spend on a monster / pack / level (see GAME.md rule 4). */
  monsterBudget: (depth: number) => 4 + depth * 1.6,
  eliteBudget: (depth: number) => Math.min(6, 1 + Math.floor(depth / 4)),
  /** How many extra mechanics a rift at `depth` combines (designed levels define their own). */
  riftMechanics: (depth: number) => Math.min(4, 2 + Math.floor((depth - 13) / 15)),
  /** Monster density multiplier. */
  density: (depth: number) => Math.min(2.5, 1 + depth * 0.04),
  /** Rarity weights multiplier for item drops (more rares deeper). */
  rarityBoost: (depth: number) => 1 + depth * 0.03,
} as const;

/** Elite and boss multipliers applied on top of depth scaling. */
export const RANK = {
  normal: { life: 1, damage: 1, xp: 1, gold: 1, drops: 1 },
  magic: { life: 2.2, damage: 1.25, xp: 3, gold: 2, drops: 2 },
  rare: { life: 4.5, damage: 1.5, xp: 8, gold: 4, drops: 4 },
  boss: { life: 30, damage: 2, xp: 60, gold: 30, drops: 12 },
} as const;
export type Rank = keyof typeof RANK;
