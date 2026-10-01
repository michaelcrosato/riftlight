import RAPIER from '@dimforge/rapier3d';
import { Vector3 } from 'three/webgpu';

/** Trigger volume shape (half extents / radius in world units). */
export type TriggerShape =
  | { box: [number, number, number] }
  | { sphere: number }
  | { capsule: { halfHeight: number; radius: number } }
  | { cylinder: { halfHeight: number; radius: number } };

export interface TriggerOptions {
  /** Called once when a collider starts overlapping the volume. */
  onEnter?(other: RAPIER.Collider, trigger: Trigger): void;
  /** Called once when it stops overlapping (or leaves the world). */
  onExit?(other: RAPIER.Collider, trigger: Trigger): void;
  /** Only colliders carrying this tag (e.g. 'character', which PlatformerCharacter sets). */
  tag?: string;
  /** Extra filter: return false to ignore a collider. */
  filter?(other: RAPIER.Collider): boolean;
  /** Also report colliders on fixed bodies (level geometry). Default false. */
  includeStatic?: boolean;
  /** Remove the trigger after its first enter (pickups). */
  once?: boolean;
  /** Rotation about Y in radians. */
  rotationY?: number;
}

/**
 * A sensor volume with enter/exit callbacks. It is not a collider in the world: after
 * every fixed step Physics runs an intersection query for it and diffs the result, so a
 * trigger never blocks the character controller, ray casts or camera rays.
 * Create with `physics.trigger(shape, at, options)`.
 */
export class Trigger {
  /** World position; move it freely (moving platforms, carried zones). */
  readonly position: Vector3;
  /** Colliders inside the volume right now, by handle. */
  readonly inside = new Map<number, RAPIER.Collider>();
  /** A disabled trigger reports nothing (everything inside exits on the next step). */
  enabled = true;
  removed = false;
  readonly shape: RAPIER.Shape;
  private readonly rotation: RAPIER.Rotation;

  constructor(
    readonly def: TriggerShape,
    at: readonly [number, number, number] | Vector3,
    readonly options: TriggerOptions,
    private readonly detach: (t: Trigger) => void,
  ) {
    this.position = at instanceof Vector3 ? at.clone() : new Vector3(at[0], at[1], at[2]);
    this.shape = makeShape(def);
    const a = options.rotationY ?? 0;
    this.rotation = { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
  }

  /** Stop reporting and leave the world (no exit callbacks). */
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.inside.clear();
    this.detach(this);
  }

  /** Physics: refresh overlaps after a step and fire callbacks. */
  update(world: RAPIER.World, accept: (c: RAPIER.Collider) => boolean): void {
    if (this.removed) return;
    const now = new Map<number, RAPIER.Collider>();
    const o = this.options;
    if (this.enabled) {
      const p = this.position;
      world.intersectionsWithShape(
        { x: p.x, y: p.y, z: p.z },
        this.rotation,
        this.shape,
        (c) => {
          if (accept(c) && (!o.filter || o.filter(c))) now.set(c.handle, c);
          return true;
        },
        o.includeStatic ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_FIXED,
      );
    }
    for (const [h, c] of this.inside) {
      if (now.has(h)) continue;
      this.inside.delete(h);
      o.onExit?.(c, this);
      if (this.removed) return;
    }
    for (const [h, c] of now) {
      if (this.inside.has(h)) continue;
      this.inside.set(h, c);
      o.onEnter?.(c, this);
      if (o.once) this.remove();
      if (this.removed) return;
    }
  }

  /** Physics: a collider left the world while inside. */
  forget(handle: number): void {
    const c = this.inside.get(handle);
    if (!c) return;
    this.inside.delete(handle);
    this.options.onExit?.(c, this);
  }
}

function makeShape(def: TriggerShape): RAPIER.Shape {
  if ('box' in def) return new RAPIER.Cuboid(...def.box);
  if ('sphere' in def) return new RAPIER.Ball(def.sphere);
  if ('capsule' in def) return new RAPIER.Capsule(def.capsule.halfHeight, def.capsule.radius);
  return new RAPIER.Cylinder(def.cylinder.halfHeight, def.cylinder.radius);
}
