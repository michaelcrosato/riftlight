import type { Vector3 } from 'three/webgpu';
import type { Rng } from '../../core/rng';
import type { ActorLike, HitResult } from '../../core/types';
import type { TelegraphSpec } from './skills';

/**
 * What a monster brain drives. The integration step implements this over the real combat
 * `Actor` (movement, skills, effects); brains only ever talk to this interface, so they run
 * the same in the game, in headless sims and in unit tests (see brains.test in
 * monsters.test.ts for a fake one).
 */
export interface MonsterBody {
  readonly actor: ActorLike;
  /** Walk towards a point at `speed` × the archetype's move speed (0 = stop). */
  moveTo(target: Vector3, speed?: number): void;
  stop(): void;
  face(target: Vector3): void;
  /**
   * Start a skill (MONSTER_SKILLS id) at a target. Returns false if it can't start (busy,
   * on cooldown, out of mana...). The body plays the skill's clip and applies its effects at
   * the clip's hit frame.
   */
  useSkill(id: string, target: ActorLike | Vector3 | null): boolean;
  /** True while a skill animation is playing (the brain waits). */
  busy(): boolean;
  /** Seconds until a skill is ready (0 = ready). */
  cooldown(id: string): number;
  /** Optional hooks; brains skip what a body doesn't implement. */
  teleport?(to: Vector3): void;
  /** Show a telegraph decal for `seconds` (wind-up of a big attack). */
  telegraph?(spec: TelegraphSpec, from: Vector3, to: Vector3, seconds: number): void;
  /** Wind-up glow 0..1 on the monster. */
  setGlow?(amount: number): void;
  /** Toggle a StatSheet condition ('shielded', 'lowLife', 'frenzy'...). */
  setCondition?(name: string, on: boolean): void;
  /** Ask the world to do something: spawn adds, leave a trail, fire a nova... */
  emit?(event: MonsterEvent): void;
}

/** Requests brains and elite behaviours make of the world (the integration step handles them). */
export type MonsterEvent =
  | { type: 'summon'; at: Vector3; count: number; archetype?: string; scale?: number }
  | { type: 'split'; at: Vector3; count: number; scale: number }
  | { type: 'nova'; at: Vector3; radius: number; damage: string; ailment?: string }
  | { type: 'trail'; at: Vector3; damage: string; duration: number }
  | { type: 'aura'; radius: number; effect: string; on: boolean }
  | { type: 'beam'; count: number; length: number; speed: number; on: boolean }
  | { type: 'strike'; at: Vector3; radius: number; delay: number; damage: string }
  | { type: 'pull'; at: Vector3; radius: number; force: number }
  | { type: 'shield'; on: boolean; amount: number }
  | { type: 'clone'; at: Vector3; count: number }
  | { type: 'phase'; phase: number }
  | { type: 'hazard'; id: string; at: Vector3; data?: Readonly<Record<string, number | string>> }
  | { type: 'roar'; at: Vector3 }
  | { type: 'heal'; amount: number };

/** What brains can ask about the world around them. */
export interface BrainWorld {
  /** Game time in seconds. */
  readonly time: number;
  readonly rng: Rng;
  /** Hostile actors within `radius` of `of` (usually just the hero), nearest first. */
  enemies(of: ActorLike, radius: number): readonly ActorLike[];
  /** Other monster brains within `radius` (pack alerts, frenzy, flanking). */
  allies(of: ActorLike, radius: number): readonly BrainLike[];
}

/** The part of a brain other brains and behaviours see. */
export interface BrainLike {
  readonly body: MonsterBody;
  readonly archetype: string;
  alert(target: ActorLike): void;
  onAllyDeath?(ally: BrainLike): void;
}

export type ActionId = 'idle' | 'wander' | 'approach' | 'strafe' | 'retreat' | 'attack' | 'flee' | 'leash';

export interface Decision {
  readonly action: ActionId;
  readonly score: number;
  readonly skill?: string;
}

export type { HitResult };
