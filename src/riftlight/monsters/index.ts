/**
 * Riftlight monsters: the "Spore" generator. Genome → body (parts on sockets of a plan's
 * skeleton) → rig → procedural animation → archetype brain → elite mods; bosses on top.
 * See docs/GAME.md "Monsters". The integration step uses:
 *
 *   const genome = generateGenome(rng.fork('monster:3'), { depth, tags: ['fire'], archetype: 'charger', rank: 'magic' });
 *   const m = buildMonster(genome);            // object, rig, clips (+ hit frames), stats, skills, radius, height
 *   const rt = new MonsterRuntime(m);          // mixer, look-at, flinch, glow, foot placement
 *   const brain = new MonsterBrain({ body, archetype: genome.archetype, skills: m.skills, elite: genome.elite, home });
 */
export * from './types';
export { generateGenome, mutate, crossover, sanitize, validateGenome, genomeBudget, genomeCost, genomeTags, headAnchors, partFits, RANK_SCALE, type GenomeOptions } from './genome';
export { buildMonster, clearMonsterCache, moveSpeeds, applyPose, resolveSkills, type BuildOptions } from './build';
export { generatePalette, shiftPalette, mixPalettes, hslHex, hexToHsl, contrast, luminance, THEME_COLOURS, type Harmony } from './palette';
export { PLANS } from './plans';
export { PARTS } from './parts';
export { geometryCount } from './geometry';
export { generateClips, ATTACK_ANIMS } from './anim';
export { MonsterRuntime, type RuntimeEvent, type UpdateContext } from './runtime';
export { createTelegraph, type Telegraph } from './telegraph';
export { renderPortrait, grid, stack, checkMonster, type MonsterCheck, type PortraitOptions } from './inspect';
export { ARCHETYPES } from './brains/archetypes';
export { MONSTER_SKILLS, boltFor, type MonsterSkillDef, type TelegraphSpec, type SkillRole } from './brains/skills';
export { ELITE_MODS, ELITE_BEHAVIOURS, eliteBehaviour, type MonsterEliteDef, type EliteBehaviour, type EliteContext, type EliteHost } from './brains/elite';
export { MonsterBrain, type BrainOptions, type BrainState } from './brains/brain';
export { Pack } from './brains/pack';
export type { MonsterBody, BrainWorld, BrainLike, MonsterEvent, ActionId, Decision } from './brains/types';
export { BOSSES, BOSS_ATTACKS, BossBrain, bossName, bossSkills, buildBoss, designedBoss, generateBoss, MECHANIC_THEMES, type BossDef, type BossPhase, type BossAttackDef, type BossPattern } from './bosses';
