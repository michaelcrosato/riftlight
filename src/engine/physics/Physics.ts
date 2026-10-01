import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { Trigger, type TriggerOptions, type TriggerShape } from './Trigger';

export { RAPIER, Trigger, type TriggerOptions, type TriggerShape };

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
  private readonly triggers: Trigger[] = [];
  /** Character controllers created on `world`, so `clear()` can free them. */
  private readonly controllers = new Set<RAPIER.KinematicCharacterController>();
  private accumulator = 0;
  /** Interpolation factor between the previous and current physics step, 0..1. */
  alpha = 0;
  steps = 0;

  private constructor(gravity: number) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    // Track character controllers (created by PlatformerCharacter & co. directly on the
    // world) so a level unload frees them too.
    const world = this.world;
    const create = world.createCharacterController.bind(world);
    const remove = world.removeCharacterController.bind(world);
    world.createCharacterController = (offset: number) => {
      const c = create(offset);
      this.controllers.add(c);
      return c;
    };
    world.removeCharacterController = (c: RAPIER.KinematicCharacterController) => {
      this.controllers.delete(c);
      remove(c);
    };
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
      this.updateTriggers();
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
  raycast(from: Vector3, dir: Vector3, maxDistance: number, ignoreTags: string[] = []): number | null {
    const hit = this.castRay(from, dir, maxDistance, ignoreTags);
    return hit ? hit.distance : null;
  }

  /** Ray cast returning distance, hit collider and surface normal. */
  castRay(
    from: Vector3,
    dir: Vector3,
    maxDistance: number,
    ignoreTags: string[] = [],
    exclude?: RAPIER.RigidBody,
  ): { distance: number; collider: RAPIER.Collider; normal: Vector3; point: Vector3 } | null {
    const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const predicate = ignoreTags.length ? (c: RAPIER.Collider) => !ignoreTags.some((t) => this.hasTag(c, t)) : undefined;
    const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, exclude, predicate);
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
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, undefined, exclude);
    if (!hit) return null;
    return { y: origin.y - hit.timeOfImpact, distance: hit.timeOfImpact };
  }

  /**
   * A trigger volume with enter/exit callbacks (pickups, checkpoints, kill zones, doors).
   * Checked after every fixed step against dynamic and kinematic bodies (the character
   * included); set `includeStatic` for level geometry. Never blocks movement or rays.
   *
   *   physics.trigger({ sphere: 0.6 }, [0, 1, 6], { tag: 'character', once: true, onEnter: () => collect() });
   */
  trigger(shape: TriggerShape, at: readonly [number, number, number] | Vector3, options: TriggerOptions = {}): Trigger {
    const t = new Trigger(shape, at, options, (x) => {
      const i = this.triggers.indexOf(x);
      if (i >= 0) this.triggers.splice(i, 1);
    });
    this.triggers.push(t);
    return t;
  }

  /** Run every trigger's overlap query now (Physics.update does this after each step). */
  updateTriggers(): void {
    if (this.triggers.length === 0) return;
    for (const t of [...this.triggers]) {
      const tag = t.options.tag;
      t.update(this.world, tag ? (c) => this.hasTag(c, tag) : () => true);
    }
  }

  /**
   * Remove a rigid body (with its colliders and any bound Object3D binding) or a single
   * collider. Removing a collider whose fixed body has no other colliders removes that
   * body too (what `addStaticBox` & co. create). Tags and trigger overlaps are cleaned up.
   */
  remove(target: RAPIER.RigidBody | RAPIER.Collider): void {
    if (target instanceof RAPIER.Collider) {
      if (!this.world.colliders.contains(target.handle)) return;
      const body = target.parent();
      this.forgetCollider(target.handle);
      this.world.removeCollider(target, true);
      if (body && body.isFixed() && body.numColliders() === 0) this.remove(body);
      return;
    }
    if (!this.world.bodies.contains(target.handle)) return;
    for (let i = 0; i < target.numColliders(); i++) this.forgetCollider(target.collider(i).handle);
    for (let i = this.bindings.length - 1; i >= 0; i--) if (this.bindings[i]!.body === target) this.bindings.splice(i, 1);
    this.world.removeRigidBody(target);
  }

  /**
   * Empty the world: every body, collider, joint, character controller, trigger, tag and
   * binding goes, and the step accumulator resets. The `world` object itself is kept.
   */
  clear(): void {
    this.triggers.length = 0;
    const bodies: RAPIER.RigidBody[] = [];
    this.world.bodies.forEach((b) => bodies.push(b));
    for (const b of bodies) this.world.removeRigidBody(b);
    const loose: RAPIER.Collider[] = [];
    this.world.colliders.forEach((c) => loose.push(c));
    for (const c of loose) this.world.removeCollider(c, false);
    for (const c of [...this.controllers]) this.world.removeCharacterController(c);
    this.bindings.length = 0;
    this.tags.clear();
    this.accumulator = 0;
    this.alpha = 0;
  }

  /** Sizes of everything Physics tracks (leak checks, debug UI). */
  counts(): { bodies: number; colliders: number; tags: number; bindings: number; triggers: number; controllers: number } {
    return {
      bodies: this.world.bodies.len(),
      colliders: this.world.colliders.len(),
      tags: this.tags.size,
      bindings: this.bindings.length,
      triggers: this.triggers.length,
      controllers: this.controllers.size,
    };
  }

  dispose(): void {
    this.clear();
    this.world.free();
  }

  private forgetCollider(handle: number): void {
    this.tags.delete(handle);
    for (const t of [...this.triggers]) t.forget(handle);
  }

  private readBody(b: Binding): void {
    const t = b.body.translation();
    const r = b.body.rotation();
    b.currPos.set(t.x, t.y, t.z);
    b.currRot.set(r.x, r.y, r.z, r.w);
  }
}

function yRotation(angle: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}
