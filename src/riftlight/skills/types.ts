import type { PaletteColor } from '../../engine/palette';
import type { Mod } from '../core/mods';
import type { Delivery, Effect, SkillDef, SupportDef } from '../core/types';
import type { DamageSpec } from '../combat/damage';

/** How a skill looks and sounds: data the delivery runtime reads (combat/deliveries). */
export interface SkillLook {
  /** Main colour of meshes and decals. */
  readonly color: PaletteColor;
  /** Glow / particle colours. */
  readonly glow?: readonly PaletteColor[];
  /** Projectile mesh. */
  readonly shape?: 'orb' | 'arrow' | 'shard' | 'bolt' | 'skull' | 'rock';
  /** Particle trail or burst preset (combat/fx.ts registers them). */
  readonly trail?: string;
  readonly burst?: string;
  /** Sounds by moment (names from combat/sfx.ts or the engine's SFX). */
  readonly sound?: { readonly cast?: string; readonly hit?: string; readonly travel?: string; readonly impact?: string };
  /** Dynamic light while the effect lives (a LightRequest). */
  readonly light?: { readonly color: PaletteColor; readonly intensity: number; readonly radius: number };
  /** Camera shake on impact (trauma 0..1). */
  readonly shake?: number;
}

/**
 * An active skill gem: the core `SkillDef` plus what the hero controller and the delivery
 * runtime need to play it. Everything is data; `buildSkill` resolves it against a character.
 */
export interface SkillGem extends SkillDef {
  /** Clips per combo step (a strike chain); otherwise `anim`. */
  readonly combo?: readonly string[];
  /** Repeats while the key is held (whirlwind, beams); cost is paid per second. */
  readonly channel?: boolean;
  /** Fraction of the cast (0..1) where it releases; default the clip's hit frame. */
  readonly hitAt?: number;
  /** Movement while casting, as a fraction of move speed (0 = rooted). */
  readonly moveDuringCast?: number;
  /** Base crit chance (spells; attacks use the weapon's). */
  readonly crit?: number;
  /** Projectiles/strikes that also burst on impact (explosive arrow, fireball). */
  readonly explode?: number;
  /** Leap to the aim point (clamped to `range`) before the delivery lands (leap slam). */
  readonly leap?: { readonly range: number; readonly height: number };
  /** Dash/blink: teleport instantly instead of travelling. */
  readonly teleport?: boolean;
  /** Ground zones (flame wall): a trap that burns while enemies stand in it, `tick` seconds apart. */
  readonly zone?: { readonly tick: number; readonly shape: 'circle' | 'wall' };
  /** Where an area lands: at the caster (default), the aim point, or ahead of the caster. */
  readonly target?: 'self' | 'aim' | 'ahead';
  /** Damage dealt per tick of channels/zones as a fraction of a full hit. */
  readonly tickDamage?: number;
  readonly look: SkillLook;
}

/** A support gem: core `SupportDef` plus exclusions and level growth. */
export interface SupportGem extends SupportDef {
  /** Skills with any of these tags can't use it (multistrike on channels). */
  readonly excludes?: readonly string[];
  /** Per gem level above 1 (values × (level − 1)). */
  readonly perLevel?: readonly Mod[];
}

/** A linked support, as an id or with its gem level. */
export type SupportLink = string | SupportGem | { readonly gem: string | SupportGem; readonly level: number };

/**
 * A skill resolved for one character with its supports: everything the runtime needs, with
 * support changes applied. Pure data (`buildSkill` is a pure function).
 */
export interface ResolvedSkill {
  readonly id: string;
  readonly def: SkillGem;
  readonly level: number;
  /** Effective tags (skill tags + tags added by supports). */
  readonly tags: readonly string[];
  /** Supports that apply, and linked ones that don't fit this skill. */
  readonly supports: readonly string[];
  readonly unsupported: readonly string[];
  /** Mods that apply to this skill only (supports, gem level): fold them in with StatQuery. */
  readonly mods: readonly Mod[];
  /** Mana per use (per second for channels). */
  readonly cost: number;
  readonly cooldown: number;
  /** Seconds per use after attack / cast speed. */
  readonly castTime: number;
  /** Attack or cast speed multiplier (clip playback rate scale). */
  readonly speed: number;
  /** Delivery with support changes and area applied (radii already scaled). */
  readonly delivery: Delivery;
  /** Area multiplier (radius scales by its square root). */
  readonly area: number;
  /** Skill effect duration multiplier. */
  readonly duration: number;
  /** Times the delivery repeats per use (multistrike, spell echo). */
  readonly repeats: number;
  /** Projectile speed multiplier. */
  readonly projectileSpeed: number;
  /** null for skills that deal no damage (buffs, movement, summons). */
  readonly damage: DamageSpec | null;
  readonly effects: readonly Effect[];
  /** Clips per use (combo steps); one entry for most skills. */
  readonly anims: readonly string[];
  readonly channel: boolean;
  readonly moveDuringCast: number;
}
