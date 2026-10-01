import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Quaternion, Vector3 } from 'three/webgpu';

export { RAPIER };

export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

interface Binding {
  body: RAPIER.RigidBody;
  object: Object3D;
  prevPos: Vector3;
  prevRot: Quaternion;
  currPos: Vector3;
  currRot: Quaternion;
}

export interface BoxOptions {
  position: [number, number, number];
  halfExtents: [number, number, number];
  rotationY?: number;
  friction?: number;
  density?: number;
}

/**
 * Rapier world with a fixed 60 Hz step and render interpolation.
 *
 * Physics owns the truth; visuals follow. Bound Object3Ds are *interpolated* between
 * the last two physics states for smooth motion. Pixel alignment is purely a camera /
 * presentation concern and never touches bodies here.
 */
export class Physics {
  readonly world: RAPIER.World;
  private readonly bindings: Binding[] = [];
  private readonly tags = new Map<number, Set<string>>();
  private accumulator = 0;
  /** Interpolation factor between the previous and current physics step, 0..1. */
  alpha = 0;
  steps = 0;
  // Reused by every ray cast (no per-call Ray / closure allocations).
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly predicates = new WeakMap<readonly string[], (c: RAPIER.Collider) => boolean>();

  private constructor(gravity: number) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  static async create(gravity = -24): Promise<Physics> {
    await RAPIER.init();
    return new Physics(gravity);
  }

  /**
   * Advance the simulation by real elapsed time. `fixedUpdate` runs before each fixed
   * step (apply forces, move kinematic characters there).
   */
  update(dt: number, fixedUpdate?: (dt: number) => void): void {
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= FIXED_DT) {
      for (const b of this.bindings) {
        b.prevPos.copy(b.currPos);
        b.prevRot.copy(b.currRot);
      }
      fixedUpdate?.(FIXED_DT);
      this.world.step();
      this.steps++;
      for (const b of this.bindings) this.readBody(b);
      this.accumulator -= FIXED_DT;
    }
    this.alpha = this.accumulator / FIXED_DT;
    for (const b of this.bindings) {
      b.object.position.lerpVectors(b.prevPos, b.currPos, this.alpha);
      b.object.quaternion.slerpQuaternions(b.prevRot, b.currRot, this.alpha);
    }
  }

  /** Make `object` follow `body` (interpolated). */
  bind(body: RAPIER.RigidBody, object: Object3D): void {
    const b: Binding = {
      body,
      object,
      prevPos: new Vector3(),
      prevRot: new Quaternion(),
      currPos: new Vector3(),
      currRot: new Quaternion(),
    };
    this.readBody(b);
    b.prevPos.copy(b.currPos);
    b.prevRot.copy(b.currRot);
    object.position.copy(b.currPos);
    object.quaternion.copy(b.currRot);
    this.bindings.push(b);
  }

  unbind(object: Object3D): void {
    const i = this.bindings.findIndex((b) => b.object === object);
    if (i >= 0) this.bindings.splice(i, 1);
  }

  addStaticBox(o: BoxOptions): RAPIER.Collider {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(...o.position)
        .setRotation(yRotation(o.rotationY ?? 0)),
    );
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...o.halfExtents).setFriction(o.friction ?? 0.8),
      body,
    );
  }

  addStaticCylinder(position: [number, number, number], halfHeight: number, radius: number): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...position));
    return this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius), body);
  }

  addDynamicBox(o: BoxOptions): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...o.position)
        .setRotation(yRotation(o.rotationY ?? 0))
        .setLinearDamping(0.5)
        .setAngularDamping(0.8),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...o.halfExtents)
        .setFriction(o.friction ?? 0.7)
        .setDensity(o.density ?? 1),
      body,
    );
    return body;
  }

  /**
   * Tag a collider with gameplay semantics the character controller understands:
   * 'climbable' (ladders/vines), 'pushable', 'grabbable', 'slippery', 'noLedge',
   * 'character', 'noCamera' (camera rays pass through). Games may add their own.
   */
  tag(collider: RAPIER.Collider, ...tags: string[]): RAPIER.Collider {
    let set = this.tags.get(collider.handle);
    if (!set) this.tags.set(collider.handle, (set = new Set()));
    for (const t of tags) set.add(t);
    return collider;
  }

  hasTag(collider: RAPIER.Collider | null | undefined, tag: string): boolean {
    return !!collider && (this.tags.get(collider.handle)?.has(tag) ?? false);
  }

  /** Distance along `dir` (unit) from `from` to the first collider not carrying any of `ignoreTags`. */
  raycast(from: Vector3, dir: Vector3, maxDistance: number, ignoreTags: readonly string[] = NO_TAGS): number | null {
    const hit = this.cast(from, dir, maxDistance, ignoreTags);
    return hit ? hit.timeOfImpact : null;
  }

  /** Shared ray + cached tag predicate (keyed by the `ignoreTags` array: pass a constant). */
  private cast(from: Vector3, dir: Vector3, maxDistance: number, ignoreTags: readonly string[], exclude?: RAPIER.RigidBody) {
    const ray = this.ray;
    ray.origin.x = from.x;
    ray.origin.y = from.y;
    ray.origin.z = from.z;
    ray.dir.x = dir.x;
    ray.dir.y = dir.y;
    ray.dir.z = dir.z;
    let predicate: ((c: RAPIER.Collider) => boolean) | undefined;
    if (ignoreTags.length) {
      predicate = this.predicates.get(ignoreTags);
      if (!predicate) {
        predicate = (c: RAPIER.Collider) => !ignoreTags.some((t) => this.hasTag(c, t));
        this.predicates.set(ignoreTags, predicate);
      }
    }
    return this.world.castRayAndGetNormal(ray, maxDistance, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, exclude, predicate);
  }

  /** Ray cast returning distance, hit collider and surface normal. */
  castRay(
    from: Vector3,
    dir: Vector3,
    maxDistance: number,
    ignoreTags: readonly string[] = NO_TAGS,
    exclude?: RAPIER.RigidBody,
  ): { distance: number; collider: RAPIER.Collider; normal: Vector3; point: Vector3 } | null {
    const hit = this.cast(from, dir, maxDistance, ignoreTags, exclude);
    if (!hit) return null;
    const n = hit.normal;
    return {
      distance: hit.timeOfImpact,
      collider: hit.collider,
      normal: new Vector3(n.x, n.y, n.z),
      point: from.clone().addScaledVector(dir, hit.timeOfImpact),
    };
  }

  /** Distance straight down from `origin` to the first collider (excluding `exclude`). */
  groundBelow(origin: Vector3, maxDistance = 20, exclude?: RAPIER.RigidBody): { y: number; distance: number } | null {
    const ray = this.ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, undefined, exclude);
    if (!hit) return null;
    return { y: origin.y - hit.timeOfImpact, distance: hit.timeOfImpact };
  }

  dispose(): void {
    this.bindings.length = 0;
    this.world.free();
  }

  private readBody(b: Binding): void {
    const t = b.body.translation();
    const r = b.body.rotation();
    b.currPos.set(t.x, t.y, t.z);
    b.currRot.set(r.x, r.y, r.z, r.w);
  }
}

const NO_TAGS: readonly string[] = [];

function yRotation(angle: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}
