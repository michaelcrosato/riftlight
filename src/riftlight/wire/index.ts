/**
 * The integration layer: the shell's ports (game/ports.ts) implemented on the real systems.
 *
 *   HeroPort     R1  HeroController + Actor, on the shell's HeroIntent       wire/hero.ts
 *   LevelPort    R5  buildLevel / levelSpec, every pack spawned at load      wire/levels.ts
 *   MonsterPort  R4  generateGenome / buildMonster / MonsterBrain / BossBrain wire/monsters.ts
 *
 * They share one service, `Worlds`: the combat world (ActorManager + Combat) of each stage,
 * found by stage. A level builds its own world on load and disposes it on leave; the hero
 * brings one into the town. See docs/GAME.md, "Integration".
 *
 *   new Riftlight();                                   // corePorts() + stub loot and tree
 *   new Riftlight({ ...corePorts(), loot, tree });      // everything real
 */
import type { RiftlightPorts } from '../game/ports';
import { realHeroFactory } from './hero';
import { RealLevels } from './levels';
import { RealMonsters } from './monsters';
import { Worlds } from './world';

/** The real hero, levels and monsters, sharing one set of stage worlds. */
export function corePorts(): Pick<RiftlightPorts, 'hero' | 'levels' | 'monsters'> {
  const worlds = new Worlds();
  return { hero: realHeroFactory(worlds), levels: new RealLevels(worlds), monsters: new RealMonsters(worlds) };
}

export { CombatWorld, PropActor, Worlds, isProp } from './world';
export { RealHero, realHeroFactory, slotsFromSave, levelMods, starterWeapon, GEM_ALIASES } from './hero';
export { LevelStage, RealLevels } from './levels';
export { MonsterUnit, RealMonsters, monsterGem, monsterName, translateMods, registerBoss, MECHANIC_TAGS, type MonsterHost } from './monsters';
export { Hazards } from './hazards';
export { StageMover, type GridStage } from './stage';
export { themeSongs, transposeSong } from './music';
export { WIRE_TUNING } from './tuning';
