/**
 * Every depth-dependent number in one place, so the endless game is balanced in one file.
 * Depth 1..12 are the designed levels; 13+ are rifts. Nothing caps: curves are smooth
 * exponentials with gentle late-game slopes (tune here, re-run `npm run balance` and
 * `npm run playtest -- campaign`).
 *
 * Monster power is shaped after the campaign bot's hero (a player who equips upgrades,
 * levels gems and spends passive points): it gears up fastest over the first depths (a
 * weapon, a full set), so monsters ramp in over depths 1–5 (`early`); through the designed
 * levels they grow a little faster than the hero (life 25%, damage 20% a depth), and in the
 * rifts, where gear and gem levels flatten out, a little slower (18% / 13%) plus 4% life a
 * depth, so difficulty overtakes the hero gradually, with no wall at one depth.
 */
const DESIGNED = 12;
/**
 * Endless depth, softened: the depth itself up to `knee`, then logarithmic (`knee + scale ×
 * ln(1 + over / scale)`): still rising every depth, never flat, but an exponential fed with it
 * stays finite at any depth a run can reach (depth 1000 → 420, a million → 1112).
 */
export const soften = (depth: number, knee: number, scale: number): number => (depth <= knee ? depth : knee + scale * Math.log1p((depth - knee) / scale));
/** Where the monster curves go logarithmic (far past any wall; `npm run balance -- endless`). */
const KNEE = { depth: 200, scale: 100 } as const;
const deep = (depth: number) => soften(depth, KNEE.depth, KNEE.scale);
/** 1 at depth 1, rising linearly to 1 + k by depth 5. */
const early = (depth: number, k: number) => 1 + k * Math.min(1, Math.max(0, depth - 1) / 4);
/** g1 per depth up to depth 12, g2 per (softened) depth after. */
const twoSlope = (depth: number, g1: number, g2: number) => Math.pow(g1, Math.min(depth, DESIGNED) - 1) * Math.pow(g2, Math.max(0, deep(depth) - DESIGNED));

export const SCALING = {
  /** Monster life multiplier vs depth 1. */
  monsterLife: (depth: number) => early(depth, 0.4) * twoSlope(depth, 1.25, 1.18) * (1 + 0.04 * Math.max(0, deep(depth) - DESIGNED)),
  /** Monster damage multiplier vs depth 1. */
  monsterDamage: (depth: number) => early(depth, 0.5) * twoSlope(depth, 1.2, 1.13),
  /**
   * Monster level (also its item level for drops): the "area level", about the hero level a
   * player reaches there (depth 1 = 4, 12 = 25, 20 = 39, 30 = 56), 100 by depth 57, then one
   * per depth so item levels keep rising in deep rifts.
   */
  monsterLevel: (depth: number) => Math.min(100, Math.round(1 + 2.6 * Math.pow(Math.max(0, depth), 0.9))) + Math.max(0, Math.floor(depth) - 57),
  /** XP for killing a normal monster of `level`. */
  monsterXp: (level: number) => Math.round(6 * Math.pow(level, 1.35)),
  /**
   * XP needed to go from `level` to `level + 1`: with the area levels above and the bot's
   * clears, 2–3 levels per early depth (depth 1 → 4, 6 → 15), ~1.5 later (12 → 24, 20 → 37).
   */
  xpToNext: (level: number) => Math.round(70 * Math.pow(level, 2.25) + 200 * level),
  /**
   * Share of a kill's XP a hero of `heroLevel` gets from a monster of `monsterLevel`
   * (PoE-style): full inside a safe zone of 3 + heroLevel/16 levels, then falling fast for a
   * hero who has outlevelled the area. Under-levelled heroes are not penalised, so a hero
   * catches up with the area and then slows down: 2–3 levels per early depth, fewer later.
   */
  xpPenalty: (heroLevel: number, monsterLevel: number) => {
    const over = Math.max(0, heroLevel - monsterLevel - (3 + Math.floor(heroLevel / 16)));
    return over <= 0 ? 1 : Math.max(0.01, Math.pow((heroLevel + 5) / (heroLevel + 5 + Math.pow(over, 2.5)), 1.5));
  },
  /**
   * Hero level a skill or support gem of `gemLevel` needs: fast early (2, 4, 6, 9, 12 …),
   * gem level 10 at 25 and 20 at 70. Socketed gems earn the XP the hero earns, and
   * `gemXpToNext` is the hero XP between two requirements, so a gem socketed from the start
   * is ready for each level just as the hero reaches it.
   */
  gemLevelReq: (gemLevel: number) => (gemLevel <= 1 ? 1 : Math.round(1 + 69 * Math.pow((Math.min(20, gemLevel) - 1) / 19, 1.4))),
  /** Gold per normal kill (before rarity/elite multipliers). */
  gold: (depth: number) => Math.round(2 + depth * 1.5 + Math.pow(depth, 1.3)),
  /** Power budget a generator may spend on a monster / pack / level (see GAME.md rule 4). */
  monsterBudget: (depth: number) => 4 + depth * 1.6,
  eliteBudget: (depth: number) => Math.min(6, 1 + Math.floor(depth / 4)),
  /** How many extra mechanics a rift at `depth` combines (designed levels define their own). */
  riftMechanics: (depth: number) => Math.min(4, 2 + Math.floor((depth - 13) / 15)),
  /** Monster density multiplier. */
  density: (depth: number) => Math.min(2.5, 1 + depth * 0.04),
  /**
   * Rarity weights multiplier for item drops (more rares deeper: rares ~1 in 10 drops by depth
   * 10); past depth 60 it grows logarithmically, so endless rifts never drop only uniques.
   */
  rarityBoost: (depth: number) => 1 + soften(Math.max(0, depth), 60, 20) * 0.07,
} as const;

/** Elite and boss multipliers applied on top of depth scaling. */
export const RANK = {
  normal: { life: 1, damage: 1, xp: 1, gold: 1, drops: 1 },
  magic: { life: 2.2, damage: 1.25, xp: 3, gold: 1.5, drops: 2 },
  rare: { life: 4.5, damage: 1.5, xp: 8, gold: 3, drops: 4 },
  boss: { life: 30, damage: 2, xp: 60, gold: 12, drops: 12 },
} as const;
export type Rank = keyof typeof RANK;

/**
 * Gem XP from `gemLevel` to the next: the hero XP between the two levels' requirements
 * (`SCALING.gemLevelReq`), so gem levels and their requirements agree. 0 at the cap (20).
 */
export function gemXpToNext(gemLevel: number): number {
  if (gemLevel >= 20) return 0;
  let xp = 0;
  for (let l = SCALING.gemLevelReq(gemLevel); l < SCALING.gemLevelReq(gemLevel + 1); l++) xp += SCALING.xpToNext(l);
  return Math.max(1, xp);
}
