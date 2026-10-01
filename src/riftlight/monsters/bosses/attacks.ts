import { Registry } from '../../core/registry';
import type { Entry } from '../../core/registry';
import type { TelegraphSpec } from '../brains/skills';

/**
 * Boss modules: signature attacks as data. Each plays a monster skill's clip (`skill`,
 * from MONSTER_SKILLS: its anim, delivery and hit frame) and asks the world for a
 * `pattern` (MonsterEvent 'hazard' with `id = pattern` and `params`): expanding slam waves,
 * projectile spirals, charges across the arena, adds, arena hazards built on the level's
 * mechanic. Tags name the mechanics a module belongs to, so rift bosses pick them by tag.
 */
export type BossPattern =
  | 'slamWave'
  | 'spiral'
  | 'charge'
  | 'summon'
  | 'hazard'
  | 'gust'
  | 'darkness'
  | 'beam'
  | 'nova'
  | 'pull'
  | 'echo'
  | 'portal'
  | 'quake'
  | 'meteor'
  | 'leap';

export interface BossAttackDef extends Entry {
  readonly name: string;
  readonly description: string;
  readonly skill: string;
  readonly pattern: BossPattern;
  readonly params: Readonly<Record<string, number | string>>;
  readonly telegraph?: TelegraphSpec;
  readonly tags: readonly string[];
}

const B = (b: BossAttackDef): BossAttackDef => b;

export const BOSS_ATTACKS = new Registry<BossAttackDef>('boss attacks', [
  // generic
  B({ id: 'quake-slam', name: 'Quake Slam', description: 'Slams the ground; three shockwave rings roll outwards.', skill: 'slam', pattern: 'slamWave', params: { rings: 3, speed: 6, gap: 1.2, damage: 'physical' }, telegraph: { shape: 'circle', size: 3, at: 'self' }, tags: ['generic', 'collapse', 'earth'] }),
  B({ id: 'arena-charge', name: 'Arena Charge', description: 'Charges wall to wall across the arena, twice.', skill: 'charge', pattern: 'charge', params: { length: 16, repeats: 2 }, telegraph: { shape: 'line', size: 16, width: 2, at: 'self' }, tags: ['generic', 'beast'] }),
  B({ id: 'call-brood', name: 'Call the Brood', description: 'Summons a pack of adds from the edges.', skill: 'summon', pattern: 'summon', params: { count: 4, archetype: 'swarm' }, tags: ['generic'] }),
  B({ id: 'pounce', name: 'Crushing Pounce', description: 'Leaps onto your position.', skill: 'leap', pattern: 'leap', params: { radius: 2.5 }, telegraph: { shape: 'circle', size: 2.5, at: 'target' }, tags: ['generic', 'gloom'] }),
  // embers
  B({ id: 'ember-spiral', name: 'Ember Spiral', description: 'A rotating spiral of fireballs.', skill: 'firebolt', pattern: 'spiral', params: { arms: 4, shots: 24, turn: 0.35, damage: 'fire' }, tags: ['embers', 'fire', 'bloodmoon'] }),
  B({ id: 'brazier-slam', name: 'Brazier Slam', description: 'Slams and ignites every brazier in the arena; they blow in sequence.', skill: 'slam', pattern: 'hazard', params: { hazard: 'braziers', delay: 0.6, damage: 'fire' }, telegraph: { shape: 'circle', size: 3, at: 'self' }, tags: ['embers', 'bloodmoon'] }),
  // gloom
  B({ id: 'snuff-lights', name: 'Snuff the Lights', description: 'Darkness falls; lanterns gutter and it hits harder unseen.', skill: 'nova', pattern: 'darkness', params: { duration: 8, radius: 3 }, tags: ['gloom', 'collapse', 'shadow'] }),
  B({ id: 'shade-call', name: 'Shade Call', description: 'Shades step out of the dark.', skill: 'summon', pattern: 'summon', params: { count: 3, archetype: 'skirmisher' }, tags: ['gloom', 'shadow'] }),
  // gale
  B({ id: 'gust', name: 'Gale Gust', description: 'A wide gust that blows you back across the arena.', skill: 'spit', pattern: 'gust', params: { force: 14, width: 4, length: 14 }, telegraph: { shape: 'cone', size: 10, width: 60, at: 'self' }, tags: ['gale', 'mire', 'storm'] }),
  B({ id: 'cyclone', name: 'Cyclone', description: 'Wind blades spiral out from the boss.', skill: 'nova', pattern: 'spiral', params: { arms: 3, shots: 18, turn: 0.5, damage: 'physical', push: 4 }, tags: ['gale', 'storm'] }),
  // frostglass
  B({ id: 'glaze-floor', name: 'Glaze', description: 'Freezes the floor into sheet ice; frozen adds shatter.', skill: 'nova', pattern: 'hazard', params: { hazard: 'ice', radius: 7, duration: 10 }, tags: ['frostglass', 'gravewell', 'ice'] }),
  B({ id: 'frost-spiral', name: 'Shard Spiral', description: 'Spirals of ice shards that chill.', skill: 'frostbolt', pattern: 'spiral', params: { arms: 5, shots: 20, turn: 0.25, damage: 'cold' }, tags: ['frostglass', 'gravewell', 'ice'] }),
  // thornweave
  B({ id: 'vine-eruption', name: 'Vine Eruption', description: 'Thorn lines erupt in a star around the boss.', skill: 'slam', pattern: 'hazard', params: { hazard: 'thorns', lines: 6, length: 9, duration: 6 }, telegraph: { shape: 'circle', size: 2.5, at: 'self' }, tags: ['thornweave', 'nature'] }),
  B({ id: 'root-pull', name: 'Root Pull', description: 'Roots drag you in towards its maw.', skill: 'spit', pattern: 'pull', params: { radius: 10, force: 9 }, tags: ['thornweave', 'gravewell'] }),
  // stormspire
  B({ id: 'pylon-surge', name: 'Pylon Surge', description: 'Charges the pylons; lightning arcs between them.', skill: 'nova', pattern: 'hazard', params: { hazard: 'pylons', arcs: 4, duration: 5, damage: 'lightning' }, tags: ['stormspire', 'riftgates', 'storm'] }),
  B({ id: 'storm-strikes', name: 'Storm Strikes', description: 'Telegraphed lightning bolts rain on you.', skill: 'sparkbolt', pattern: 'meteor', params: { count: 6, radius: 1.6, interval: 0.4, damage: 'lightning' }, tags: ['stormspire', 'storm'] }),
  // mire
  B({ id: 'mud-wave', name: 'Mud Wave', description: 'A slowing wave of mud washes out in rings.', skill: 'slam', pattern: 'slamWave', params: { rings: 2, speed: 4, gap: 2, damage: 'physical', slow: 0.5 }, telegraph: { shape: 'circle', size: 3, at: 'self' }, tags: ['mire', 'poison'] }),
  B({ id: 'bog-spawn', name: 'Bog Spawn', description: 'Blobs bubble up out of the mire.', skill: 'summon', pattern: 'summon', params: { count: 4, archetype: 'bomber' }, tags: ['mire', 'bloodmoon', 'poison'] }),
  // echoes
  B({ id: 'echo-slam', name: 'Echo Slam', description: 'A slam that repeats two seconds later at the same spot.', skill: 'slam', pattern: 'echo', params: { delay: 2, of: 'quake-slam' }, telegraph: { shape: 'circle', size: 3, at: 'self' }, tags: ['echoes', 'arcane'] }),
  B({ id: 'mirror-beam', name: 'Mirror Beams', description: 'Two beams sweep the arena in opposite directions.', skill: 'nova', pattern: 'beam', params: { count: 2, length: 12, speed: 0.7, duration: 5 }, tags: ['echoes', 'arcane'] }),
  // riftgates
  B({ id: 'gate-charge', name: 'Gate Charge', description: 'Charges into a portal and out of another behind you.', skill: 'charge', pattern: 'portal', params: { length: 10, portals: 2 }, telegraph: { shape: 'line', size: 10, width: 2, at: 'self' }, tags: ['riftgates', 'void'] }),
  B({ id: 'void-spiral', name: 'Void Spiral', description: 'Slow void orbs spiral outwards.', skill: 'voidbolt', pattern: 'spiral', params: { arms: 6, shots: 18, turn: 0.2, damage: 'chaos' }, tags: ['riftgates', 'gravewell', 'void'] }),
  // bloodmoon
  B({ id: 'blood-nova', name: 'Blood Nova', description: 'Detonates every corpse in the arena.', skill: 'nova', pattern: 'nova', params: { radius: 5, corpses: 1, damage: 'physical' }, telegraph: { shape: 'circle', size: 5, at: 'self' }, tags: ['bloodmoon', 'blood'] }),
  // gravewell
  B({ id: 'gravity-well', name: 'Singularity', description: 'Opens a gravity well that drags everything in, then collapses.', skill: 'cast', pattern: 'pull', params: { radius: 12, force: 7, duration: 4, collapse: 1 }, tags: ['gravewell', 'void'] }),
  // collapse
  B({ id: 'cave-in', name: 'Cave-In', description: 'The floor crumbles in a spreading ring; rocks fall.', skill: 'slam', pattern: 'quake', params: { tiles: 18, delay: 1.2 }, telegraph: { shape: 'circle', size: 4, at: 'self' }, tags: ['collapse', 'earth'] }),
  B({ id: 'meteor-fall', name: 'Rockfall', description: 'Boulders drop on marked spots.', skill: 'summon', pattern: 'meteor', params: { count: 5, radius: 2, interval: 0.5, damage: 'physical' }, tags: ['collapse', 'earth', 'embers'] }),
]);

/** Mechanic id → theme tags (palette and parts for rift bosses). */
export const MECHANIC_THEMES: Readonly<Record<string, readonly string[]>> = {
  embers: ['fire'],
  gloom: ['shadow'],
  gale: ['storm'],
  frostglass: ['ice'],
  thornweave: ['nature'],
  stormspire: ['storm'],
  mire: ['poison'],
  echoes: ['arcane'],
  riftgates: ['void'],
  bloodmoon: ['blood'],
  gravewell: ['void'],
  collapse: ['earth'],
};

/** The monster skill an attack plays (cast → the theme's bolt is fine: any 'Cast' clip). */
export function attackSkill(a: BossAttackDef): string {
  return a.skill === 'cast' ? 'nova' : a.skill;
}
