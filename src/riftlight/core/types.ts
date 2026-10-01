/**
 * Riftlight's shared contracts: the shapes every system agrees on. Systems import types
 * from here and talk through `GameEvents`; they don't import each other's internals.
 * See docs/GAME.md for the design language these follow.
 */
import type { Object3D, Vector3 } from 'three/webgpu';
import type { Entry } from './registry';
import type { Mod } from './mods';
import type { Rng } from './rng';
import type { StatSheet } from './mods';
import type { Rank } from './scaling';

// ------------------------------------------------------------------ combat

export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos';
export const DAMAGE_TYPES: readonly DamageType[] = ['physical', 'fire', 'cold', 'lightning', 'chaos'];

export type AilmentType = 'bleed' | 'poison' | 'ignite' | 'chill' | 'freeze' | 'shock' | 'stun';

export type Faction = 'hero' | 'monster' | 'neutral';

/** One hit, before mitigation. Amounts per damage type. */
export interface Hit {
  readonly source: ActorLike | null;
  readonly skill?: string;
  /** Tags of the skill/delivery: 'attack', 'spell', 'melee', 'projectile', 'area', 'fire', ... */
  readonly tags: readonly string[];
  readonly damage: Partial<Record<DamageType, number>>;
  readonly crit: boolean;
  /** Chance (0..1) per ailment to apply, decided by the attacker's stats. */
  readonly ailments?: Partial<Record<AilmentType, number>>;
  /** Knockback impulse (m/s) away from `from`. */
  readonly knockback?: number;
  readonly from?: Vector3;
  /** Hit-stop frames to freeze attacker and target (juice). */
  readonly hitStop?: number;
  /** Attacker's accuracy rating, checked against evasion (attacks only; absent = always hits). */
  readonly accuracy?: number;
  /** Resistance penetration per type (0..1), subtracted from the target's resistance. */
  readonly penetration?: Partial<Record<DamageType, number>>;
  /** Multipliers for the ailments this hit applies (1 = base). */
  readonly ailmentEffect?: number;
  readonly ailmentDuration?: number;
  /** Culling strike: a target left below this fraction of its life dies. */
  readonly cull?: number;
}

/** What a hit did after mitigation. */
export interface HitResult {
  readonly total: number;
  readonly byType: Partial<Record<DamageType, number>>;
  readonly crit: boolean;
  readonly killed: boolean;
  readonly blocked?: boolean;
  readonly evaded?: boolean;
  readonly ailments: readonly AilmentType[];
}

/** The minimal actor surface other systems may rely on (hero and monsters both). */
export interface ActorLike {
  readonly id: number;
  readonly faction: Faction;
  readonly stats: StatSheet;
  readonly position: Vector3;
  readonly radius: number;
  life: number;
  mana: number;
  readonly alive: boolean;
  level: number;
  /** Apply a hit; returns what happened. */
  takeHit(hit: Hit): HitResult;
  /** Movement impulse (knockback, wind, gravity wells). */
  push(impulse: Vector3): void;
}

// ------------------------------------------------------------------ skills

export type Delivery =
  | { kind: 'strike'; range: number; arc: number }
  | { kind: 'slam'; radius: number; delay: number }
  | { kind: 'projectile'; speed: number; count: number; spread: number; pierce: number; chain: number; range: number; fork?: number; homing?: number }
  | { kind: 'nova'; radius: number }
  | { kind: 'beam'; length: number; width: number; tick: number }
  | { kind: 'dash'; distance: number; hitWidth: number }
  | { kind: 'summon'; genome: 'minion' | string; count: number; duration: number }
  | { kind: 'aura'; radius: number }
  | { kind: 'trap'; radius: number; arm: number; duration: number };

export type Effect =
  | { kind: 'damage'; base: Partial<Record<DamageType, [number, number]>>; effectiveness?: number }
  | { kind: 'ailment'; ailment: AilmentType; chance: number }
  | { kind: 'knockback'; force: number }
  | { kind: 'buff'; mods: readonly Mod[]; duration: number; target: 'self' | 'allies' | 'enemies' }
  | { kind: 'light'; color: number; intensity: number; radius: number; duration: number }
  | { kind: 'sound'; sound: string }
  | { kind: 'particles'; preset: string; count?: number };

/** An active skill gem, as data. */
export interface SkillDef extends Entry {
  readonly name: string;
  readonly description: string;
  /** 'attack' | 'spell', + 'melee' | 'projectile' | 'area' | 'movement' | 'minion' | element... */
  readonly tags: readonly string[];
  readonly cost: number;
  readonly cooldown: number;
  /** Seconds at 100% attack/cast speed. */
  readonly castTime: number;
  /** Hero clip name to play (see src/game/hero/clips). */
  readonly anim: string;
  readonly delivery: Delivery;
  readonly effects: readonly Effect[];
  /** Per-gem-level growth (damage effectiveness etc.). */
  readonly perLevel?: readonly Mod[];
  readonly icon?: string;
}

/** A support gem: modifies any linked skill whose tags match `requires`. */
export interface SupportDef extends Entry {
  readonly name: string;
  readonly description: string;
  readonly requires: readonly string[];
  readonly mods: readonly Mod[];
  /** Structural changes: extra projectiles, chain, area, multistrike... */
  readonly changes?: Partial<{ projectiles: number; chain: number; pierce: number; fork: number; area: number; repeats: number; addTags: readonly string[] }>;
  readonly costMultiplier?: number;
}

// ------------------------------------------------------------------ passive tree

export type PassiveKind = 'start' | 'small' | 'notable' | 'keystone' | 'mastery' | 'socket';

export interface PassiveNode extends Entry {
  readonly name: string;
  readonly kind: PassiveKind;
  readonly mods: readonly Mod[];
  /** Layout position in tree space. */
  readonly x: number;
  readonly y: number;
  readonly links: readonly string[];
  /** Region / cluster for theming and validation. */
  readonly region: string;
  readonly flavour?: string;
}

// ------------------------------------------------------------------ loot

export type ItemSlot = 'weapon' | 'offhand' | 'helm' | 'body' | 'gloves' | 'boots' | 'amulet' | 'ring' | 'belt' | 'gem' | 'currency';
export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';

export interface ItemBase extends Entry {
  readonly name: string;
  readonly slot: ItemSlot;
  /** Minimum item level to drop. */
  readonly level: number;
  /** Implicit mods. */
  readonly implicit: readonly Mod[];
  /** Weapon/armour base stats (e.g. physical damage range, armour). */
  readonly base: Readonly<Record<string, number | [number, number]>>;
  /** Visual: which model/mesh builder and palette slot to use when dropped/equipped. */
  readonly look?: string;
}

export interface AffixTier {
  readonly level: number;
  readonly mods: readonly { stat: string; kind: Mod['kind']; min: number; max: number; tags?: readonly string[]; when?: string }[];
}

export interface Affix extends Entry {
  readonly name: string;
  readonly type: 'prefix' | 'suffix';
  /** Item slots / base tags it can roll on ('weapon', 'armour', 'jewellery', 'melee'...). */
  readonly on: readonly string[];
  /** Mods sharing a group can't both roll. */
  readonly group: string;
  readonly tiers: readonly AffixTier[];
}

export interface RolledAffix {
  readonly id: string;
  readonly tier: number;
  readonly mods: readonly Mod[];
}

export interface Item {
  readonly uid: string;
  readonly base: string;
  readonly rarity: Rarity;
  readonly level: number;
  readonly name: string;
  readonly affixes: readonly RolledAffix[];
  readonly unique?: string;
  /** Skill/support gem items: which gem and its level. */
  readonly gem?: { id: string; level: number; support: boolean };
  readonly quantity?: number;
  /** Corrupted (vaal-like orb): no further crafting. */
  readonly corrupted?: boolean;
  /** Extra implicit mods added after the roll (corruption), shown with the base implicit. */
  readonly implicits?: readonly RolledAffix[];
}

export interface UniqueDef extends Entry {
  readonly name: string;
  readonly base: string;
  readonly mods: readonly Mod[];
  readonly flavour: string;
  readonly level: number;
}

// ------------------------------------------------------------------ monsters ("Spore")

export type BodyPlanId = 'biped' | 'quadruped' | 'hexapod' | 'serpent' | 'floater' | 'blob' | 'brute' | string;

/** A hand-made part that attaches to a socket. */
export interface PartDef extends Entry {
  /** Socket kinds it fits: 'head', 'back', 'shoulder', 'tail', 'arm', 'leg', 'jaw', 'eye'... */
  readonly fits: readonly string[];
  /** Builds the part's meshes (toon materials from the palette) under `parent`. */
  build(ctx: PartBuildContext): void;
  /** Stat/behaviour mods the part grants (horns: +knockback, wings: +move.speed...). */
  readonly mods?: readonly Mod[];
  /** Power budget cost. */
  readonly cost?: number;
}

export interface PartBuildContext {
  readonly parent: Object3D;
  readonly palette: Palette;
  readonly scale: number;
  readonly rng: Rng;
  readonly mirror: boolean;
}

export interface Palette {
  readonly primary: number;
  readonly secondary: number;
  readonly accent: number;
  readonly glow: number;
  readonly dark: number;
}

export interface Genome {
  readonly seed: number;
  readonly plan: BodyPlanId;
  readonly parts: readonly { socket: string; part: string }[];
  /** Body proportions in 0..1 gene space (length, girth, leg length, neck, ...). */
  readonly genes: Readonly<Record<string, number>>;
  readonly palette: Palette;
  readonly scale: number;
  readonly archetype: string;
  readonly elite: readonly string[];
  readonly rank: Rank;
}

/** A behaviour archetype: a brain plus the skills it uses. */
export interface ArchetypeDef extends Entry {
  readonly name: string;
  /** Body plans it suits. */
  readonly plans: readonly BodyPlanId[];
  readonly skills: readonly string[];
  readonly mods: readonly Mod[];
}

export interface EliteModDef extends Entry {
  readonly name: string;
  readonly mods: readonly Mod[];
  /** Behaviour hook id the brain understands ('teleport', 'splitOnDeath', 'shield', ...). */
  readonly behaviour?: string;
  readonly glow?: number;
  readonly cost: number;
}

// ------------------------------------------------------------------ levels

export interface ThemeDef extends Entry {
  readonly name: string;
  readonly palette: { floor: number; wall: number; accent: number; fog: number; sky: number; light: number };
  readonly ambient: number;
  readonly sun: number;
  /** Prop kinds this theme scatters ('pillar', 'crate', 'bones', 'crystal', ...). */
  readonly props: readonly string[];
  readonly song?: string;
  readonly filters?: readonly string[];
}

/** A level mechanic: one per designed level, combined in later levels and rifts. */
export interface MechanicDef extends Entry {
  readonly name: string;
  readonly description: string;
  /** How a casual player clears without it / how speedrunners exploit it (shown in the codex). */
  readonly bypass: string;
  readonly exploit: string;
  /** Mechanics it must not be combined with. */
  readonly excludes?: readonly string[];
  /** Places its elements into a generated layout and returns its runtime. */
  install(level: LevelRuntimeContext): MechanicRuntime;
}

export interface MechanicRuntime {
  update?(dt: number): void;
  /** Called for every actor every fixed step (wind push, ice friction, wells...). */
  affect?(actor: ActorLike, dt: number): void;
  dispose?(): void;
}

/** What a mechanic gets to work with. Implemented by the level system. */
export interface LevelRuntimeContext {
  readonly rng: Rng;
  readonly depth: number;
  readonly layout: LayoutLike;
  readonly scene: Object3D;
  readonly events: GameEventBus;
  actors(): readonly ActorLike[];
}

/** Grid layout produced by the level generator (cells of 1 m). */
export interface LayoutLike {
  readonly width: number;
  readonly height: number;
  /** 0 = void/pit, 1 = floor, 2 = wall. */
  cell(x: number, z: number): number;
  readonly rooms: readonly { id: number; x: number; z: number; w: number; h: number; tags: readonly string[] }[];
  readonly start: { x: number; z: number };
  readonly exit: { x: number; z: number };
  /** Floor cells on the critical path start → exit. */
  readonly path: readonly { x: number; z: number }[];
}

export interface LevelSpec {
  readonly depth: number;
  readonly name: string;
  readonly mechanics: readonly string[];
  readonly theme: string;
  readonly seed: number;
  readonly layout: { style: string; rooms: number; size: number };
  readonly archetypes: readonly string[];
  readonly boss: Genome | null;
}

// ------------------------------------------------------------------ events & save

export interface GameEvents extends Record<string, unknown> {
  hit: { target: ActorLike; result: HitResult; hit: Hit };
  kill: { target: ActorLike; killer: ActorLike | null; rank: Rank; depth: number };
  loot: { item: Item; at: Vector3 };
  gold: { amount: number; at: Vector3 };
  xp: { amount: number; level: number };
  levelUp: { level: number };
  skill: { actor: ActorLike; skill: string };
  mechanic: { id: string; event: string; at?: Vector3 };
  levelClear: { depth: number; time: number };
  death: { actor: ActorLike };
  /** A skill or effect wants a dynamic light (see LightRequest). A light pool claims it. */
  light: LightRequest;
}

/**
 * A short-lived dynamic light asked for by a projectile, explosion or aura. Combat emits
 * it on the bus as `light`; the level's light pool sets `claimed = true` and drives a pooled
 * light from it until `duration` runs out or `alive()` returns false. When nobody claims it,
 * combat falls back to a plain three.js PointLight of its own.
 */
export interface LightRequest {
  readonly color: number;
  readonly intensity: number;
  /** Reach in metres (PointLight distance). */
  readonly radius: number;
  /** Where the light is now; read every frame. */
  position(): Vector3;
  /** Seconds; <= 0 means "until alive() returns false". Intensity fades over the last 30%. */
  readonly duration: number;
  /** Optional: keep the light while this is true (a projectile in flight). */
  alive?(): boolean;
  /** Set by whoever fulfils the request. */
  claimed?: boolean;
}

export type GameEventBus = import('./events').EventBus<GameEvents>;

export interface SaveData {
  readonly version: 1;
  hero: {
    level: number;
    xp: number;
    gold: number;
    allocated: string[];
    equipment: Partial<Record<string, Item>>;
    inventory: Item[];
    skills: { slot: number; gem: Item | null; supports: (Item | null)[] }[];
  };
  stash: Item[];
  /**
   * Where each item sits, by uid: inventory cells, or a stash tab and cells. Optional;
   * items without a position are packed into the first free cells on load.
   */
  positions?: Record<string, { tab?: number; x: number; y: number }>;
  /** Highest depth cleared; designed levels unlock in order, rifts after 12. */
  deepest: number;
  difficulty: DifficultyTuning;
  seed: number;
  settings: Record<string, unknown>;
}

export interface DifficultyTuning {
  playerDamage: number;
  playerLife: number;
  playerSpeed: number;
  enemyDamage: number;
  enemyLife: number;
  enemySpeed: number;
}
