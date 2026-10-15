import { type Object3D, Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import { type ActorRef, refOf, type Vec } from '../../core/saved';
import { type SavedSkill, saveSkill } from '../../skills/saved';
import type { ResolvedSkill } from '../../skills/types';
import type { Combat } from '../Combat';

/** What keeps a channel going, named as data (the hero: which keys). */
export type CastHold = string | readonly string[];

/** Extra input for one cast. */
export interface CastOptions {
  /** Combo step (0-based) of a strike chain; the last step of a chain is the finisher. */
  combo?: number;
  /** Channels keep going while this returns true (key held). */
  held?: () => boolean;
  /** What `held` tests, as data: a restore makes `held` again from it (`Combat.wire`). */
  hold?: CastHold;
  /** Live aim point for channels (beams follow the cursor). */
  aimNow?: () => Vector3;
  /** Seconds in the air for leap skills (from the clip timing); default castTime × 0.5. */
  airTime?: number;
  /** Set on the automatic repeats of multistrike / spell echo. */
  repeat?: number;
}

/**
 * A cast's closures made again on a restore (they are wiring, not state): the caster's owner
 * registers one with `Combat.wire` (the hero controller: `held` from the named keys, `aimNow`
 * its live aim).
 */
export type CastWiring = (saved: { readonly hold?: CastHold; readonly aimNow: boolean }) => Pick<CastOptions, 'held' | 'aimNow'>;

/** Cast options as data: the closures become what makes them again (`hold`, `aimNow: true`). */
export interface SavedCastOptions {
  readonly combo?: number;
  readonly airTime?: number;
  readonly repeat?: number;
  readonly hold?: CastHold;
  readonly aimNow?: boolean;
}

/** A cast as data (save-states): who, with what, where to. */
export interface SavedCast {
  readonly caster: ActorRef;
  readonly skill: SavedSkill;
  readonly aim: Vec;
  readonly dir: Vec;
  readonly opts: SavedCastOptions;
}

/**
 * A running effect as data (save-states): its kind (the key `RESTORE` makes it again by), the
 * cast that started it, and its own state beside them.
 */
export interface EffectState {
  readonly kind: string;
  readonly cast: SavedCast;
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
  /** It ends (finished, stopped, its caster left): visuals go, and what it held is given back. */
  dispose(): void;
  /** Its state as data (save-states); `RESTORE` in deliveries/index.ts makes it again. */
  save(): EffectState;
  /** Its visuals go and nothing else happens (a restore replaces it). */
  drop(): void;
}

/** Starts a delivery. Registered per Delivery kind in deliveries/index.ts. */
export type DeliveryImpl = (c: CastContext) => CombatEffect | null;

/** Makes a running effect again from `save()`'s data: its state and visuals, none of its start-up (no hits, sounds, bursts). */
export type EffectRestore = (c: CastContext, s: EffectState) => CombatEffect;

/** Options as data; refuses a closure nothing could make again. */
export function saveCastOptions(o: CastOptions): SavedCastOptions {
  if (o.held && o.hold === undefined) throw new Error('save-state: a cast held by a closure with no `hold` to make it again from');
  return {
    ...(o.combo !== undefined ? { combo: o.combo } : {}),
    ...(o.airTime !== undefined ? { airTime: o.airTime } : {}),
    ...(o.repeat !== undefined ? { repeat: o.repeat } : {}),
    ...(o.held ? { hold: o.hold } : {}),
    ...(o.aimNow ? { aimNow: true } : {}),
  };
}

export function saveCast(c: CastContext): SavedCast {
  return { caster: refOf(c.caster), skill: saveSkill(c.skill), aim: c.aim.toArray(), dir: c.dir.toArray(), opts: saveCastOptions(c.opts) };
}

/** A vector as data, and back. */
export const vec = (v: Vector3): Vec => v.toArray();
export const v3 = (v: Vec): Vector3 => new Vector3(v[0], v[1], v[2]);

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

  abstract save(): EffectState;

  /** The common part of `save()`: kind and cast. */
  protected saved(): EffectState {
    return { kind: this.kind, cast: saveCast(this.c) };
  }

  drop(): void {
    for (const v of this.visuals) v.removeFromParent();
    this.visuals.length = 0;
  }

  dispose(): void {
    this.drop();
  }
}
