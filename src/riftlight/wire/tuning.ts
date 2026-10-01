/**
 * Every number the integration layer adds, in one place (the core loop's feel and balance).
 * Depth curves stay in `core/scaling.ts`; these are the bases they multiply and the knobs
 * that only exist where systems meet (hero growth per level, monster bases, boss pacing,
 * hazard damage, culling distances). Tune here, re-run `npm run playtest -- 1` and `-- 3`.
 */
export const WIRE_TUNING = {
  hero: {
    /** Stats every hero starts with (merged over HeroController's base). Multiplier stats are base 1 (docs/GAME.md, levels). */
    base: { life: 130, mana: 70, 'mana.regen': 5, 'life.regen': 2.5, 'move.speed': 5.6, accuracy: 600, mass: 3, 'xp.gain': 1, 'light.radius': 1, 'item.rarity': 1, 'item.quantity': 1, 'gold.find': 1 },
    /** Growth per character level above 1 (the `level` source). */
    perLevel: { life: 11, mana: 4, accuracy: 25, 'life.regen': 0.25, damage: 0.05 },
    /** The sword the hero carries until loot equips a weapon (the `starter` source). */
    starterWeapon: { min: 6, max: 11, crit: 0.05 },
    /** Gem level of the default skills: 1 + floor(level × this). */
    gemLevelPerLevel: 0.5,
    /** The hero's own light (Gloom reads `light.radius`). */
    light: { color: 0xffd8a8, intensity: 3.2, radius: 6.5, town: 1.4 },
  },
  /** Default gems when a save's slot is empty: a fun bar out of the box (slot 0..3). */
  defaultSkills: ['cleave', 'fireball', 'leap-slam', 'frost-nova'],
  monster: {
    /** Base life at depth 1 before rank, archetype and part mods. */
    life: 34,
    /** Multipliers on the rank's life and damage (RANK.boss is 30× life, 2× damage: too long a fight for one hero). */
    bossLife: 0.26,
    bossDamage: 0.7,
    /** Footprint against walls (m): every body fits through a 1-cell corridor; bodies still push each other by their real radius. */
    wallRadius: 0.42,
    /** Multiplier on every monster hit (with SCALING.monsterDamage(depth) on top). */
    damage: 0.75,
    /** Per skill role on top: ranged volleys from a pack add up, so each shot hurts less. */
    roleDamage: { ranged: 0.7, charge: 0.9, leap: 0.9 } as Readonly<Record<string, number>>,
    /** Base move speed (m/s); archetype mods and the brain's `speed` shape it. */
    speed: 3.3,
    accuracy: 320,
    accuracyPerLevel: 22,
    armourPerDepth: 6,
    /** Turn rate (rad/s) while walking; attacks face their target at once. */
    turnRate: 9,
    /** Corpses: seconds after the Death clip ends before they sink away. */
    corpse: 0.7,
    /** Animate monsters only this close to the camera focus (others hold their pose). */
    animateRange: 26,
    /** Adds called mid-fight (summons, splits): drop nothing, count toward the level total. */
    addScale: 0.8,
  },
  /** Health globes from kills (wire/globes.ts): the hero's healing between fights. */
  globes: {
    chance: { normal: 0.12, magic: 0.5, rare: 0.8, boss: 1 } as Readonly<Record<string, number>>,
    boss: 4,
    heal: 0.2,
    mana: 0.15,
    reach: 1.0,
    life: 30,
  },
  hazard: {
    /** Average damage of a boss/elite hazard at depth 1 (× the source's damage scaling). */
    damage: 10,
    /** Rings (slam waves) are this thick (m). */
    band: 0.75,
  },
  /** XP, gold and drops for monsters: from core/scaling.ts (RANK, SCALING). */
} as const;
