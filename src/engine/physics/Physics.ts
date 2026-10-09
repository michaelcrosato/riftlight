import RAPIER from '@dimforge/rapier3d';
import { Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { explode, type ExplosionOptions, ForceFields } from './forces';
import { type KinematicBody, type Mover, type MoverOptions, Movers } from './movers';
import { initRapier } from './rapierWasm';
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
  /** Reused copy of `triggers` while their callbacks may add or remove triggers. */
  private readonly triggerSnapshot: Trigger[] = [];
  /** Bumped by clear(): a step loop that sees it change stops (the world it stepped is gone). */
  private generation = 0;
  /** Character controllers created on `world`, so `clear()` can free them. */
  private readonly controllers = new Set<RAPIER.KinematicCharacterController>();
  private accumulator = 0;
  /** Interpolation factor between the previous and current physics step, 0..1. */
  alpha = 0;
  steps = 0;
  /**
   * Zones that push, pull or drag (wind, fans, wells, currents): dynamic bodies get them every
   * step, `PlatformerCharacter` reads them (physics/forces.ts).
   */
  readonly fields = new ForceFields();
  /** Kinematic movers (lifts, shuttles, turntables), posed before every fixed step (`addMover`). */
  private readonly movers = new Movers();
  /** Conveyor belts: collider handle → belt velocity (`conveyor`). */
  private readonly belts = new Map<number, [number, number, number]>();
  private readonly stepListeners = new Set<() => void>();
  private readonly firstStepListeners = new Set<() => void>();
  /** Milliseconds Rapier took for one step (smoothed): what a pile of bodies costs. */
  stepMs = 0;
  private readonly gravityY: number;
  private readonly solverIterations: number;
  // Reused by every ray cast (no per-call Ray / closure allocations).
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly predicates = new WeakMap<readonly string[], (c: RAPIER.Collider) => boolean>();
  private readonly from = new Vector3();

  private constructor(gravity: number) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    this.gravityY = gravity;
    this.solverIterations = this.world.numSolverIterations;
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

  /** Loads Rapier's wasm on first use (a separate, streamed .wasm file), then builds a world. */
  static async create(gravity = -24): Promise<Physics> {
    await initRapier();
    return new Physics(gravity);
  }

  /**
   * Advance the simulation by real elapsed time. `fixedUpdate` runs before each fixed
   * step (apply forces, move kinematic characters there).
   */
  update(dt: number, fixedUpdate?: (dt: number) => void): void {
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * MAX_STEPS_PER_FRAME);
    const generation = this.generation;
    while (this.accumulator >= FIXED_DT) {
      for (const b of this.bindings) {
        b.prevPos.copy(b.currPos);
        b.prevRot.copy(b.currRot);
      }
      // movers first: whoever stands on one reads where it goes this step
      this.movers.step((this.steps + 1) * FIXED_DT);
      fixedUpdate?.(FIXED_DT);
      if (generation !== this.generation) break; // clear() ran inside the step: stop
      this.fields.step(this.world, FIXED_DT);
      this.stepBelts();
      const t0 = performance.now();
      this.world.step();
      this.stepMs += (performance.now() - t0 - this.stepMs) * 0.1;
      this.steps++;
      // listeners before the bindings read their bodies: a body a listener moves after the step
      // (a rewind, a correction) is drawn where it put it
      for (const f of this.firstStepListeners) f();
      for (const f of this.stepListeners) f();
      for (const b of this.bindings) this.readBody(b);
      this.updateTriggers();
      if (generation !== this.generation) break; // a trigger callback cleared the world
      this.accumulator -= FIXED_DT;
    }
    this.alpha = this.accumulator / FIXED_DT;
    for (const b of this.bindings) {
      b.object.position.lerpVectors(b.prevPos, b.currPos, this.alpha);
      b.object.quaternion.slerpQuaternions(b.prevRot, b.currRot, this.alpha);
    }
  }

  /** Seconds of physics simulated (fixed steps × 1/60): the clock movers run on. */
  get time(): number {
    return this.steps * FIXED_DT;
  }

  /**
   * Run `f` after every fixed step, before bound meshes (`bind`) read their bodies. Listeners
   * run in the order they were added (instanced bodies keep their last two poses, a ragdoll
   * holds its joint limits); `{ first: true }` runs `f` ahead of all of those, for something
   * that puts bodies somewhere else after the step (a rewind) and must be what they all see.
   * Returns an unsubscribe.
   */
  onStep(f: () => void, o: { first?: boolean } = {}): () => void {
    const set = o.first ? this.firstStepListeners : this.stepListeners;
    set.add(f);
    return () => set.delete(f);
  }

  /**
   * Drive a kinematic body (`RigidBodyDesc.kinematicPositionBased()`) along a path, spinning or
   * swinging, as a pure function of its own clock (physics/movers.ts), which starts at 0 now:
   * the same however fast frames come. The character rides it. Removing the body stops it.
   *
   *   physics.addMover(lift, { path: [[0, 0, 0], [0, 4, 0]], speed: 1.5, hold: 1 });
   */
  addMover(body: KinematicBody, options: MoverOptions): Mover {
    // its clock starts now, and it starts where that clock says (no jump on the first step)
    const m = this.movers.add(body, options, this.time);
    this.movers.pose(body, options, 0, false);
    // a mesh bound before this would draw its first frame from the old pose
    for (const b of this.bindings) {
      if ((b.body as unknown) !== body) continue;
      this.readBody(b);
      b.prevPos.copy(b.currPos);
      b.prevRot.copy(b.currRot);
      b.object.position.copy(b.currPos);
      b.object.quaternion.copy(b.currRot);
    }
    return m;
  }

  /**
   * Make a collider a conveyor belt moving at `velocity` (m/s, world axes): dynamic bodies
   * touching it are dragged along, the character standing on it is carried.
   */
  conveyor(collider: RAPIER.Collider, velocity: readonly [number, number, number] | null): void {
    if (velocity) this.belts.set(collider.handle, [velocity[0], velocity[1], velocity[2]]);
    else this.belts.delete(collider.handle);
  }

  /** A conveyor's velocity, by collider handle (null: not a belt). */
  beltVelocity(handle: number): readonly [number, number, number] | null {
    return this.belts.get(handle) ?? null;
  }

  /** Push every dynamic body near `at` away from it (physics/forces.ts). Returns how many. */
  explode(at: readonly [number, number, number] | Vector3, o: ExplosionOptions = {}): number {
    const p: [number, number, number] = at instanceof Vector3 ? [at.x, at.y, at.z] : [at[0], at[1], at[2]];
    return explode(this.world, p, o);
  }

  private stepBelts(): void {
    if (this.belts.size === 0) return;
    for (const [handle, v] of this.belts) {
      const belt = this.world.getCollider(handle);
      if (!belt) {
        this.belts.delete(handle);
        continue;
      }
      this.world.contactPairsWith(belt, (other) => {
        const b = other.parent();
        if (!b || !b.isDynamic()) return;
        const lv = b.linvel();
        const k = Math.min(1, 8 * FIXED_DT); // pulled toward the belt's speed, like friction
        b.setLinvel({ x: lv.x + (v[0] - lv.x) * k, y: lv.y, z: lv.z + (v[2] - lv.z) * k }, true);
      });
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

  /**
   * Straight up from (x, y, z), at most `maxDistance` (a ceiling, a lift coming down): like
   * `castDown`, `out.y` is the hit height.
   */
  castUp(
    x: number,
    y: number,
    z: number,
    maxDistance: number,
    out: { y: number; nx: number; ny: number; nz: number; id: number },
    ignoreTags: readonly string[] = NO_TAGS,
    exclude?: RAPIER.RigidBody,
  ): boolean {
    this.from.set(x, y, z);
    const hit = this.cast(this.from, UPWARD, maxDistance, ignoreTags, exclude);
    if (!hit) return false;
    out.y = y + hit.timeOfImpact;
    out.nx = hit.normal.x;
    out.ny = hit.normal.y;
    out.nz = hit.normal.z;
    out.id = hit.collider.handle;
    return true;
  }

  /**
   * Straight down from (x, y, z), at most `maxDistance`, skipping colliders with any of
   * `ignoreTags` (pass a constant array) and `exclude`. Fills `out` (hit height, normal,
   * collider handle) without allocating; returns whether something was hit.
   */
  castDown(
    x: number,
    y: number,
    z: number,
    maxDistance: number,
    out: { y: number; nx: number; ny: number; nz: number; id: number },
    ignoreTags: readonly string[] = NO_TAGS,
    exclude?: RAPIER.RigidBody,
  ): boolean {
    this.from.set(x, y, z);
    const hit = this.cast(this.from, DOWN, maxDistance, ignoreTags, exclude);
    if (!hit) return false;
    out.y = y - hit.timeOfImpact;
    out.nx = hit.normal.x;
    out.ny = hit.normal.y;
    out.nz = hit.normal.z;
    out.id = hit.collider.handle;
    return true;
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

  /**
   * A trigger volume with enter/exit callbacks (pickups, checkpoints, kill zones, doors).
   * Checked after every fixed step against dynamic and kinematic bodies (the character
   * included); set `includeStatic` for level geometry. Never blocks movement or rays.
   *
   *   physics.trigger({ sphere: 0.6 }, [0, 1, 6], { tag: 'character', once: true, onEnter: () => collect() });
   */
  trigger(shape: TriggerShape, at: readonly [number, number, number] | Vector3, options: TriggerOptions = {}): Trigger {
    const tag = options.tag;
    const accept = tag ? (c: RAPIER.Collider) => this.hasTag(c, tag) : () => true;
    const t = new Trigger(shape, at, options, accept, (x) => {
      const i = this.triggers.indexOf(x);
      if (i >= 0) this.triggers.splice(i, 1);
    });
    this.triggers.push(t);
    return t;
  }

  /** Run every trigger's overlap query now (Physics.update does this after each step). */
  updateTriggers(): void {
    const n = this.triggers.length;
    if (n === 0) return;
    const list = this.triggerSnapshot;
    for (let i = 0; i < n; i++) list[i] = this.triggers[i]!;
    list.length = n;
    const generation = this.generation;
    for (let i = 0; i < n; i++) {
      list[i]!.update(this.world); // skips triggers removed by an earlier callback
      if (generation !== this.generation) break;
    }
    list.length = 0;
  }

  /**
   * Remove a rigid body (with its colliders and any bound Object3D binding) or a single
   * collider. Removing a collider whose fixed body has no other colliders removes that
   * body too (what `addStaticBox` & co. create). Tags and trigger overlaps are cleaned up.
   */
  remove(target: RAPIER.RigidBody | RAPIER.Collider): void {
    if (target instanceof RAPIER.Collider) {
      if (!target.isValid()) return; // already removed (a handle alone can name a newer collider)
      const body = target.parent();
      this.forgetCollider(target.handle);
      this.world.removeCollider(target, true);
      if (body && body.isFixed() && body.numColliders() === 0) this.remove(body);
      return;
    }
    if (!target.isValid()) return; // already removed (its slot may hold a newer body)
    this.movers.removeBody(target); // a mover stepping a removed body would crash Rapier
    for (let i = 0; i < target.numColliders(); i++) this.forgetCollider(target.collider(i).handle);
    for (let i = this.bindings.length - 1; i >= 0; i--) if (this.bindings[i]!.body === target) this.bindings.splice(i, 1);
    this.world.removeRigidBody(target);
  }

  /**
   * Empty the world: every body, collider, joint, character and vehicle controller, trigger, tag, binding,
   * mover, field and belt goes; gravity and the solver's iterations go back to their defaults
   * and the step accumulator resets. The `world` object itself is kept.
   */
  clear(): void {
    this.generation++;
    for (const t of this.triggers) t.removed = true; // an in-flight updateTriggers skips them
    this.triggers.length = 0;
    const bodies: RAPIER.RigidBody[] = [];
    this.world.bodies.forEach((b) => bodies.push(b));
    for (const b of bodies) this.world.removeRigidBody(b);
    const loose: RAPIER.Collider[] = [];
    this.world.colliders.forEach((c) => loose.push(c));
    for (const c of loose) this.world.removeCollider(c, false);
    for (const c of [...this.controllers]) this.world.removeCharacterController(c);
    for (const v of [...this.world.vehicleControllers]) this.world.removeVehicleController(v);
    this.bindings.length = 0;
    this.tags.clear();
    this.movers.clear();
    this.fields.clear();
    this.belts.clear();
    this.stepListeners.clear();
    this.firstStepListeners.clear();
    // a level that changed gravity or the solver leaves the next one the defaults
    this.world.gravity = { x: 0, y: this.gravityY, z: 0 };
    this.world.numSolverIterations = this.solverIterations;
    this.stepMs = 0;
    this.accumulator = 0;
    this.alpha = 0;
  }

  /** Sizes of everything Physics tracks (leak checks, debug UI). */
  counts(): {
    bodies: number;
    colliders: number;
    joints: number;
    tags: number;
    bindings: number;
    triggers: number;
    controllers: number;
    vehicles: number;
    movers: number;
    fields: number;
    belts: number;
  } {
    return {
      bodies: this.world.bodies.len(),
      colliders: this.world.colliders.len(),
      joints: this.world.impulseJoints.len() + this.world.multibodyJoints.len(),
      tags: this.tags.size,
      bindings: this.bindings.length,
      triggers: this.triggers.length,
      controllers: this.controllers.size,
      vehicles: this.world.vehicleControllers.size,
      movers: this.movers.count,
      fields: this.fields.count,
      belts: this.belts.size,
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

const NO_TAGS: readonly string[] = [];
const DOWN = new Vector3(0, -1, 0);
const UPWARD = new Vector3(0, 1, 0);

function yRotation(angle: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}
