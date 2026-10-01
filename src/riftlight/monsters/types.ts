/**
 * Monster-side types: the skeleton grammar a body plan produces, the richer part and
 * archetype entries, and what `buildMonster` returns. The cross-system contracts (Genome,
 * PartDef, Palette, ArchetypeDef, EliteModDef) live in core/types.ts; everything here
 * extends them. See docs/GAME.md "Monsters".
 */
import type { AnimationClip, BufferGeometry, Mesh, Object3D } from 'three/webgpu';
import type { ClipDef, RigSpec, Vec3 } from '../../engine/animation';
import type { RestPose } from '../../engine/animation/compile';
import type { Entry } from '../core/registry';
import type { Mod } from '../core/mods';
import type { ArchetypeDef, BodyPlanId, Genome, Palette, PartBuildContext, PartDef } from '../core/types';

export type { Genome, Palette } from '../core/types';

/** Which palette colour a mesh takes. */
export type PaletteSlot = keyof Palette;

/** Genome-level part slots. A slot holds one part; mirrored sockets share it. */
export type Slot =
  | 'head'
  | 'jaw'
  | 'eyes'
  | 'horns'
  | 'helm'
  | 'back'
  | 'shoulders'
  | 'wings'
  | 'tail'
  | 'hands'
  | 'weapon'
  | 'feet'
  | 'core'
  | 'tentacles';

export const SLOTS: readonly Slot[] = ['head', 'jaw', 'eyes', 'horns', 'helm', 'back', 'shoulders', 'wings', 'tail', 'hands', 'weapon', 'feet', 'core', 'tentacles'];

// ------------------------------------------------------------------ skeleton grammar

/** A joint of the generated rig. Rest rotation is identity apart from an optional yaw. */
export interface JointDef {
  readonly name: string;
  readonly parent: string | null;
  /** Position in the parent joint's space (m, at genome scale 1). */
  readonly pos: Vec3;
  /** Rest yaw about Y in degrees (splayed spider legs, wings). */
  readonly yaw?: number;
}

/** A body mesh the plan itself draws (torso, limbs, segments). Unit geometry scaled by `size`. */
export interface ShapeDef {
  readonly joint: string;
  readonly name: string;
  readonly kind: 'box' | 'sphere' | 'cyl' | 'cone' | 'taper' | 'blob' | 'disc';
  /** Size along x, y, z (m). */
  readonly size: Vec3;
  /** Centre in joint space. */
  readonly at: Vec3;
  /** Rotation, degrees XYZ. */
  readonly rot?: Vec3;
  readonly color: PaletteSlot;
  /** Top radius / bottom radius for 'taper'. */
  readonly taper?: number;
}

/** Where a part attaches. Sockets of the same `slot` share the genome's part for that slot. */
export interface SocketDef {
  readonly id: string;
  readonly slot: Slot;
  readonly joint: string;
  readonly at: Vec3;
  readonly rot?: Vec3;
  /** Characteristic size of the spot (m): head size, wing span, hand size... */
  readonly size: number;
  /** Right-side copy of a left-authored part (parts are authored for the character's left, +X). */
  readonly mirror?: boolean;
  /** Extra per-socket data (wing segment index, tail tip, chain joints...). */
  readonly data?: Readonly<Record<string, number | string | readonly string[]>>;
}

/**
 * One leg: Hip (yaw/roll) → Thigh → Shin → Foot (pitch), solved by monsters/anim/ik.ts. The
 * hip may hang from any joint; the solver accounts for that joint's animated transform.
 */
export interface LegDef {
  /** e.g. '0R' (pair 0 = front-most, right side). */
  readonly id: string;
  readonly side: 'R' | 'L';
  readonly pair: number;
  readonly parent: string;
  readonly hip: string;
  readonly upper: string;
  readonly lower: string;
  readonly foot: string;
  /** Sole mesh name (ground contact; metrics look at these). */
  readonly sole: string;
  /** Hip position in the parent's space. */
  readonly hipPos: Vec3;
  /** Rest yaw of the leg plane (deg): 0 = forward-swinging leg, ±90 = spider leg pointing sideways. */
  readonly splay: number;
  readonly upperLen: number;
  readonly lowerLen: number;
  /** Ankle (foot joint) height above the sole. */
  readonly ankle: number;
  /** +1 knee forward (human, insect knee up/out), −1 knee back (bird, hock). */
  readonly bend: 1 | -1;
  /** Foot position when standing (ground frame: x right-left, y = 0, z forward). */
  readonly rest: Vec3;
  /** Reach used for stride lengths. */
  readonly reach: number;
}

export interface ArmDef {
  readonly side: 'R' | 'L';
  readonly arm: string;
  readonly forearm: string;
  readonly hand: string;
  readonly length: number;
}

/** Semantic joint roles: what the animation templates and runtime layers address. */
export interface Roles {
  readonly root: string;
  readonly spine: readonly string[];
  readonly chest: string | null;
  readonly neck: readonly string[];
  readonly head: string | null;
  readonly jaw: string | null;
  readonly tail: readonly string[];
  readonly wings: { readonly R: readonly string[]; readonly L: readonly string[] } | null;
  readonly tentacles: readonly (readonly string[])[];
  /** Body segments (serpent, centipede), front to back. */
  readonly segments: readonly string[];
  /** The main mass that squashes (blob) / bobs (floater). */
  readonly mass: string | null;
}

export type Locomotion = 'legs' | 'hop' | 'slither' | 'float' | 'blob';

/** Gait for N legs: each leg's phase offset, stance fraction and cadence. */
export interface GaitDef {
  readonly frames: number;
  /** Fraction of the cycle each foot is planted. */
  readonly stance: number;
  /** Phase offset per leg id (0..1). */
  readonly phase: Readonly<Record<string, number>>;
  /** Stride as a fraction of leg reach. */
  readonly stride: number;
  /** Swing lift as a fraction of leg reach. */
  readonly lift: number;
  /** Body bob (m) and bobs per cycle. */
  readonly bob: number;
  readonly bobs?: number;
  /** Forward lean (deg). */
  readonly lean?: number;
  /** Hop height (m) for hopping gaits (both feet leave together). */
  readonly hop?: number;
}

/** What a body plan's grammar produces from genes and parts. */
export interface Skeleton {
  readonly plan: BodyPlanId;
  readonly joints: readonly JointDef[];
  readonly shapes: readonly ShapeDef[];
  readonly sockets: readonly SocketDef[];
  readonly legs: readonly LegDef[];
  readonly arms: readonly ArmDef[];
  readonly roles: Roles;
  readonly locomotion: Locomotion;
  readonly gaits: { readonly walk: GaitDef; readonly run: GaitDef };
  /** Base pose every clip starts from (spine lean, neck, arms...), degrees by joint. */
  readonly stance: Readonly<Record<string, Vec3>>;
  /** Approximate size at genome scale 1. */
  readonly height: number;
  readonly radius: number;
  readonly length: number;
}

// ------------------------------------------------------------------ plans and parts

export interface GeneDef {
  readonly mean: number;
  readonly spread: number;
}

/** What a plan needs from the chosen parts while it builds its skeleton. */
export interface PlanContext {
  readonly genes: Readonly<Record<string, number>>;
  /** Which slots carry a part. */
  has(slot: Slot): boolean;
  /** Anchors of the chosen head part (unit head space). */
  readonly head: HeadAnchors;
}

/** Points on a head part, in unit head space (head ~1 m: x ±0.5, y 0..1, z ±0.5). */
export interface HeadAnchors {
  /** Left eyes (+X); mirrored to the right. Centre eyes have x = 0. */
  readonly eyes: readonly Vec3[];
  readonly horns: Vec3;
  readonly jaw: Vec3 | null;
  readonly crest: Vec3;
  /** Head extent (unit space) for neck joins and framing. */
  readonly size: Vec3;
}

export interface BodyPlanDef extends Entry {
  readonly id: BodyPlanId;
  readonly name: string;
  readonly description: string;
  readonly genes: Readonly<Record<string, GeneDef>>;
  /** Chance (0..1) that a slot gets a part; slots missing here never do. 'head' and 'eyes' are required when listed with 1. */
  readonly slots: Partial<Readonly<Record<Slot, number>>>;
  /** Stat mods for the body type (serpent: evasion, brute: life...). */
  readonly mods: readonly Mod[];
  /** Scale range at genome scale = 1 multiplier. */
  readonly baseScale: number;
  build(ctx: PlanContext): Skeleton;
}

/** Context a part's build gets: the core context plus mesh helpers bound to the socket. */
export interface MonsterPartContext extends PartBuildContext {
  readonly socket: SocketDef;
  /** Socket size (m). */
  readonly size: number;
  /**
   * Add a mesh on the socket's joint. `make` builds the unit geometry once (cached under
   * `key`); `at`/`rot`/`scale` place it relative to the socket (left-authored, mirrored
   * automatically on right sockets). Returns the mesh.
   */
  add(key: string, make: () => BufferGeometry, color: PaletteSlot, opts?: MeshOpts): Mesh;
  /** Joint names of chains (tail, tentacle, wing) owned by this socket. */
  readonly chain: readonly string[];
  /** Object for a chain joint. */
  joint(name: string): Object3D;
}

export interface MeshOpts {
  at?: Vec3;
  rot?: Vec3;
  scale?: number | Vec3;
  /** Emissive (unlit) material: crystals, cores, eyes. */
  glow?: boolean;
  /** Attach to this joint instead of the socket's. Coordinates are then in that joint's space. */
  joint?: string;
  name?: string;
}

export interface MonsterPartDef extends PartDef {
  readonly name: string;
  readonly tags: readonly string[];
  readonly fits: readonly Slot[];
  /** Plans the part suits (default: any plan with the slot). */
  readonly plans?: readonly BodyPlanId[];
  /** Head parts: their anchor points. */
  readonly anchors?: HeadAnchors;
  /** Extra animations this part enables ('TailWhip' for clubs and stingers...). */
  readonly anims?: readonly string[];
  build(ctx: MonsterPartContext): void;
}

// ------------------------------------------------------------------ archetypes

export interface BrainParams {
  /** Distance at which it notices the hero (m). */
  readonly aggro: number;
  /** Distance from home at which it gives up and returns (m). */
  readonly leash: number;
  /** Preferred distance band to the target (m). */
  readonly range: readonly [number, number];
  /** Tendency (0..1) to circle the target instead of standing still. */
  readonly strafe: number;
  /** Back off after attacking (hit and run), seconds. */
  readonly retreat: number;
  /** Flee below this life fraction (0 = never). */
  readonly flee: number;
  /** Move speed multiplier vs the plan's walk. */
  readonly speed: number;
  /** Never moves (totems). */
  readonly rooted?: boolean;
  /** Seconds between decisions. */
  readonly think: number;
}

export interface MonsterArchetypeDef extends ArchetypeDef {
  readonly description: string;
  /** Plan weights: which bodies suit the behaviour. */
  readonly planWeights: Readonly<Record<string, number>>;
  /** Skill roles; 'melee' resolves to bite/claw/weapon per body. */
  readonly skills: readonly string[];
  readonly brain: BrainParams;
  /** Pack size range. */
  readonly pack: readonly [number, number];
  /** Genome scale multiplier (swarm small, tank big). */
  readonly scale: number;
  /** Part tags it prefers (tank: 'armour', caster: 'arcane'). */
  readonly prefers: readonly string[];
}

// ------------------------------------------------------------------ build output

/** Monster clip: a ClipDef plus what combat and the runtime need. */
export interface MonsterClipDef extends ClipDef {
  /** 'idle' | 'move' | 'attack' | 'hit' | 'death' | 'spawn'. */
  readonly kind: ClipKind;
  /** Hit frame (30 fps): when damage lands. Attack clips only. */
  readonly hit?: number;
  /** Telegraph start / wind-up end, frames (anticipation window). */
  readonly windup?: readonly [number, number];
}

export type ClipKind = 'idle' | 'move' | 'attack' | 'hit' | 'death' | 'spawn';

/** Per-clip metadata (also on `clip.userData`: kind, hit (s), hitFrame, windup (s), speed). */
export interface ClipMeta {
  readonly name: string;
  readonly kind: ClipKind;
  readonly frames: number;
  readonly loop: boolean;
  readonly speed: number | null;
  readonly hitFrame: number | null;
  /** Seconds from clip start to the hit, at playback rate 1. */
  readonly hitTime: number | null;
  readonly windup: readonly [number, number] | null;
}

export interface BuiltMonster {
  readonly genome: Genome;
  /** Root object (scaled by genome.scale). Joints are named Object3Ds under it. */
  readonly object: Object3D;
  readonly rig: RigSpec;
  /** Rest transforms captured before posing: compile extra clips against this. */
  readonly rest: RestPose;
  readonly skeleton: Skeleton;
  readonly defs: readonly MonsterClipDef[];
  readonly clips: readonly AnimationClip[];
  readonly meta: Readonly<Record<string, ClipMeta>>;
  /** Every mod the monster carries: plan + parts + archetype + elite + rank. */
  readonly stats: readonly Mod[];
  /** Resolved skill ids (MONSTER_SKILLS) in priority order. */
  readonly skills: readonly string[];
  /** Footprint radius and height (m, world, scale applied). */
  readonly radius: number;
  readonly height: number;
  /** Power spent on parts, for inspectors. */
  readonly cost: number;
  /** Milliseconds the build took. */
  readonly ms: number;
}
