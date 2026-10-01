import type { Object3D, Vector3 } from 'three/webgpu';
import type { LightHandle, LightRequestOptions } from '../../../engine/render/lights';
import type { Mod } from '../../core/mods';
import type { Rng } from '../../core/rng';
import type { Rank } from '../../core/scaling';
import type { ActorLike, DamageType, Genome, HitResult, LevelRuntimeContext, MechanicDef, MechanicRuntime, Rarity } from '../../core/types';
import type { Cell, Layout, Room, Spot } from '../layout/grid';
import type { LevelTheme } from '../themes/themes';

/**
 * How an element affects the **bypass guarantee** check (the exit must be reachable with
 * every element treated as blocked):
 *  - `solid`  an object you can't walk through (pylon, brazier, altar): its cells become wall;
 *  - `hazard` an area that hurts, pushes or slows (thorns, wind lanes, wells, mud, ice);
 *  - `zone`   an interactive pad (portal, haste pad, lantern ring): walkable, optional.
 * All three are avoided by the bypass path; only `solid` blocks actors at runtime.
 */
export type BlockKind = 'solid' | 'hazard' | 'zone';

/** One placed mechanic element, as data (the map tool, validation and the runtime read it). */
export interface MechanicElement {
  readonly id: number;
  readonly mechanic: string;
  readonly kind: string;
  /** World centre. */
  readonly x: number;
  readonly z: number;
  /** Cells it covers (index z * width + x). */
  readonly cells: readonly number[];
  readonly block: BlockKind;
  readonly room: number;
  readonly data: Readonly<Record<string, number | string | boolean>>;
}

export type ElementInit = Omit<MechanicElement, 'id' | 'mechanic' | 'data' | 'room'> & {
  readonly room?: number;
  readonly data?: Record<string, number | string | boolean>;
};

/** What a mechanic gets while placing its elements into a generated layout. */
export interface PlaceContext {
  readonly layout: Layout;
  readonly rng: Rng;
  readonly depth: number;
  /** The mechanic being placed. */
  readonly mechanic: string;
  /** Every mechanic of the level (synergies: Gale lanes aim at pits, Stormspire pylons guard gates). */
  readonly combined: readonly string[];
  /** Chebyshev distance to the nearest non-floor cell. */
  readonly clearance: Uint8Array;
  /** Elements placed so far (all mechanics). */
  readonly elements: readonly MechanicElement[];
  /**
   * Add an element if it keeps the bypass guarantee (start → exit still reachable with every
   * element cell blocked) and overlaps nothing reserved. Returns null when refused.
   */
  add(el: ElementInit): MechanicElement | null;
  /** Floor cells free for elements (not on the path corridor, spots or other elements). */
  free(filter?: { room?: number; minClearance?: number; critical?: boolean }): Cell[];
  isFree(x: number, z: number): boolean;
  /** Rooms that can host elements (no start room; boss room only if `boss`). */
  rooms(opts?: { boss?: boolean; side?: boolean }): Room[];
  /** Mechanic slots ('M' spots) still free. */
  slots(room?: number): Spot[];
  disc(cx: number, cz: number, r: number): number[];
  rect(x: number, z: number, w: number, h: number): number[];
}

/** A monster to spawn (encounters, mechanics). */
export interface MonsterSpawn {
  /** Behaviour archetype id (the monsters system defines them). */
  readonly archetype: string;
  readonly rank: Rank;
  readonly position: Vector3;
  /** Monster level (also its item level). */
  readonly level: number;
  readonly depth: number;
  /** Pack id (members of one pack share it) and the room it guards. */
  readonly pack: number;
  readonly room: number;
  /** Boss genome (null for normal monsters: the monsters system generates one). */
  readonly genome: Genome | null;
  /** Elite-mod budget for magic/rare/boss monsters (SCALING.eliteBudget). */
  readonly eliteBudget: number;
}

/**
 * What the level asks of the rest of the game. Only `spawnMonster` is required; the rest
 * have defaults so a level runs in a lab (placeholder actors) and in the real game.
 */
export interface LevelHooks {
  /** Spawn one monster; return its actor (the level tracks it: packs, boss, kills). */
  spawnMonster(spec: MonsterSpawn): ActorLike | null;
  /** Echoes: replay `skill` as a ghost cast from `at` (combat owns skills). */
  replaySkill?(actor: ActorLike, skill: string, opts: { at: Vector3; facing: Vector3 | null; damageScale: number; tags: readonly string[] }): void;
  /**
   * Apply a mechanic's hit through the combat pipeline (mitigation, damage numbers, `hit` and
   * `kill` events). Default: `target.takeHit(hit)`, then the level emits `kill` itself.
   */
  applyHit?(target: ActorLike, hit: import('../../core/types').Hit): HitResult;
  /** Move an actor (Riftgates). Default: copies `to` into `actor.position`. */
  teleport?(actor: ActorLike, to: Vector3): void;
  /** Drop loot (chests, Collapse vaults and bonus loot). */
  dropLoot?(at: Vector3, opts: { rarity: Rarity; quantity: number; itemLevel: number; source: string }): void;
  /** The hero walked into the open exit portal. */
  onExit?(): void;
  /** An actor fell into a pit or void. Default: a lethal hit. */
  onFall?(actor: ActorLike): void;
}

/** Level-wide lighting multipliers mechanics may change (Gloom darkens, Bloodmoon tints). */
export interface LevelEnv {
  ambient: number;
  sun: number;
  /** Optional colour the ambient/sun/fog lerp toward (0..1 by `tintAmount`). */
  tint: number | null;
  tintAmount: number;
}

/**
 * The runtime context a mechanic's `install` receives: the core `LevelRuntimeContext` plus
 * the level's services. Everything visual or audible is optional (no-ops when headless).
 */
export interface MechanicLevel extends LevelRuntimeContext {
  readonly layout: Layout;
  readonly theme: LevelTheme;
  readonly root: Object3D;
  readonly hooks: LevelHooks;
  readonly env: LevelEnv;
  readonly elements: readonly MechanicElement[];
  elementsOf(mechanic: string): MechanicElement[];
  /** Seconds since the level started. */
  time(): number;
  hero(): ActorLike | null;
  // ---- services
  light(options: LightRequestOptions): LightHandle | null;
  burst(preset: string, at: Vector3 | readonly [number, number, number], options?: { count?: number; scale?: number; colors?: string[]; direction?: [number, number, number] }): void;
  sound(name: string, options?: { volume?: number; pitch?: number }): void;
  /** Emit a `mechanic` event on the bus. */
  emit(mechanic: string, event: string, at?: Vector3): void;
  // ---- world
  /** Register a hittable object (braziers, pylons): combat should include `level.targets()`. */
  addTarget(target: ActorLike): void;
  removeTarget(target: ActorLike): void;
  /** Change a cell at runtime (Collapse): nav, colliders and walkability follow. */
  setCell(x: number, z: number, value: number): void;
  isWalkable(x: number, z: number): boolean;
  /**
   * Deal mechanic damage (depth-scaled by the caller) to an actor, through
   * `hooks.applyHit` when the game has a combat pipeline. Returns what the hit did.
   */
  damage(target: ActorLike, amounts: Partial<Record<DamageType, number>>, mechanic: string, extra?: { knockback?: number; from?: Vector3; ailments?: Partial<Record<string, number>> }): HitResult | null;
  /** A timed stat source on an actor (expires by itself; re-applying refreshes it). */
  buff(actor: ActorLike, source: string, mods: readonly Mod[], seconds: number): void;
}

/** A level mechanic: the core `MechanicDef` plus placement and how to draw it on maps. */
export interface LevelMechanicDef extends MechanicDef {
  /** Map/legend colour (RGB hex). */
  readonly color: number;
  /** Places elements into the layout (data only; runs headless in the CLI). */
  place(ctx: PlaceContext): void;
  /** `level` is a `MechanicLevel` when built by `buildLevel`. */
  install(level: LevelRuntimeContext): MechanicRuntime;
}
