/**
 * Balance: a headless combat sim over the game's real code (docs/GAME.md, "Agent tools").
 * Pure: the CLI (`npm run balance`, scripts/riftlight/balance.ts) generates the level plans
 * and monster genomes and hands them in as plain data.
 */
export { DEFAULT_ASSUMPTIONS, HERO_BASE, describeAssumptions, type Assumptions } from './assumptions';
export { BUILDS, VARIANTS, buildKey, type BuildArchetype, type Variant } from './builds';
export { skillDps, type DpsReport } from './dps';
export { RecordingSheet, STAT_ALIASES, MINION_STATS, aliasMods, depthMods, heroBase, heroSheet, minionSheet, monsterSheet, type HeroSetup, type MonsterInput } from './sheets';
export { bossFight, duel, gemLevelFor, heroOffense, makeLoadout, monsterOffense, monsterTarget, packFight, reachOf, type Duel, type HeroLoadout, type MonsterTarget } from './fight';
export { TreePlanner, basesFor, chooseGear, scoreLoadout } from './choose';
export { GRADES, runBalance, xpCurve, type BalanceOptions, type BalanceResult, type DepthInput, type Grade, type Row, type XpRow } from './sim';
export { METRICS, findOutliers, type Outlier } from './outliers';
