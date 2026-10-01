import type { Object3D, Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import type { ResolvedSkill } from '../../skills/types';
import type { Combat } from '../Combat';

/** Extra input for one cast. */
export interface CastOptions {
  /** Combo step (0-based) of a strike chain; the last step of a chain is the finisher. */
  combo?: number;
  /** Channels keep going while this returns true (key held). */
  held?: () => boolean;
  /** Live aim point for channels (beams follow the cursor). */
  aimNow?: () => Vector3;
  /** Seconds in the air for leap skills (from the clip timing); default castTime × 0.5. */
  airTime?: number;
  /** Set on the automatic repeats of multistrike / spell echo. */
  repeat?: number;
}

/** Everything a delivery needs to start. */
export interface CastContext {
  readonly combat: Combat;
  readonly caster: Actor;
  readonly skill: ResolvedSkill;
  /** Ground point aimed at (y = caster's feet). */
  readonly aim: Vector3;
  /** Unit horizontal direction from the caster toward the aim. */
  readonly dir: Vector3;
  readonly opts: CastOptions;
}

/** A running delivery: projectiles in flight, a telegraphed slam, a channel, a trap... */
export interface CombatEffect {
  readonly kind: string;
  readonly caster: Actor;
  readonly skill: string;
  /** One fixed step; false = finished (then disposed). */
  step(dt: number): boolean;
  /** Per rendered frame: purely visual animation. */
  render?(dt: number): void;
  dispose(): void;
}

/** Starts a delivery. Registered per Delivery kind in deliveries/index.ts. */
export type DeliveryImpl = (c: CastContext) => CombatEffect | null;

/** Base for effects with visuals under the combat root. */
export abstract class EffectBase implements CombatEffect {
  abstract readonly kind: string;
  readonly caster: Actor;
  readonly skill: string;
  protected readonly visuals: Object3D[] = [];
  age = 0;

  constructor(protected readonly c: CastContext) {
    this.caster = c.caster;
    this.skill = c.skill.id;
  }

  protected show<T extends Object3D>(o: T): T {
    this.c.combat.root.add(o);
    this.visuals.push(o);
    return o;
  }

  abstract step(dt: number): boolean;

  dispose(): void {
    for (const v of this.visuals) v.removeFromParent();
    this.visuals.length = 0;
  }
}
