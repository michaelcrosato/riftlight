// Combat: the hit pipeline (pure), the delivery runtime and the juice. See docs/GAME.md
// "Combat & skills".
export { Combat, chest, type AudioLike, type CombatOptions, type HitOptions, type ParticlesLike, type SummonFactory, type SummonRequest, type WallQuery } from './Combat';
export {
  ailmentChances,
  armourReduction,
  baseRanges,
  blockChance,
  convert,
  critChance,
  critMultiplier,
  expectedHit,
  hitChance,
  mitigate,
  mitigateDot,
  resistance,
  rollHit,
  scaleDamage,
  sumDamage,
  type AilmentApplication,
  type Damage,
  type DamageSpec,
  type Defender,
  type ExpectedHit,
  type Mitigated,
} from './damage';
export { AILMENTS, type AilmentDef, type AilmentKind } from './ailments';
export { DELIVERIES, type CastContext, type CastOptions, type CombatEffect, type DeliveryImpl } from './deliveries';
export { StatQuery } from './stats';
export { DamageNumbers, DAMAGE_COLORS } from './numbers';
export { CameraShake } from './shake';
export { LightService } from './lights';
export { COMBAT_PARTICLES, COMBAT_SFX, registerCombatFx } from './sfx';
export { MinionBrain, placeholderMinion } from './minions';
export { ACTOR_BASE, FINISHER } from './tuning';
