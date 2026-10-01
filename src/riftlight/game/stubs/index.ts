/**
 * Stub implementations of every port, so the whole flow is playable before the real
 * systems land. Integration replaces them one by one:
 *
 *   new Riftlight({ ...stubPorts(), hero: realHeroFactory, levels: realLevels })
 */
import type { RiftlightPorts } from '../ports';
import { stubHeroFactory } from './hero';
import { stubLevels } from './level';
import { createStubLoot } from './loot';
import { stubMonsters } from './monsters';
import { stubTree } from './tree';

export function stubPorts(): RiftlightPorts {
  return { hero: stubHeroFactory, levels: stubLevels, monsters: stubMonsters, loot: createStubLoot(), tree: stubTree };
}

export { MECHANICS } from './level';
