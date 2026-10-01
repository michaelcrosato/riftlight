import { Vector3 } from 'three/webgpu';
import type { CharacterController } from '../../engine/physics/CharacterController';
import type { Physics } from '../../engine/physics/Physics';
import type { LayoutLike } from '../core/types';

/**
 * How an actor moves on the floor. The hero uses the engine's Rapier
 * CharacterController (`ControllerMover`); monsters use a cheap kinematic mover against a
 * walkability query the level provides (`GridMover` + `WalkableQuery`). Both are fixed-step
 * truth with render interpolation.
 */
export interface Mover {
  /** Feet position after the last fixed step. */
  readonly position: Vector3;
  /** True when standing on something. */
  readonly grounded: boolean;
  /** Move by a horizontal velocity (m/s) for one fixed step; `vy` overrides vertical speed when set (leaps). */
  move(vx: number, vz: number, dt: number, vy?: number): void;
  teleport(x: number, y: number, z: number): void;
  /** Feet between the previous and current step (render). */
  visual(alpha: number, out: Vector3): Vector3;
  dispose?(): void;
}

/** What the level answers about its floor. Implemented by the level system (see `layoutWalkable`). */
export interface WalkableQuery {
  walkable(x: number, z: number): boolean;
  /** Floor height (default 0). */
  height?(x: number, z: number): number;
}

/** A flat open floor, optionally bounded (the test arena). */
export function openFloor(halfSize = Infinity): WalkableQuery {
  return { walkable: (x, z) => Math.abs(x) <= halfSize && Math.abs(z) <= halfSize };
}

/** A generated layout's floor cells (1 = floor) as a walkability query; `origin` is the world position of cell (0, 0). */
export function layoutWalkable(layout: LayoutLike, origin: { x: number; z: number } = { x: 0, z: 0 }): WalkableQuery {
  return { walkable: (x, z) => layout.cell(Math.floor(x - origin.x), Math.floor(z - origin.z)) === 1 };
}

/**
 * Kinematic mover over a walkability query: slides along blocked axes, never enters a
 * non-walkable cell, keeps a radius from edges. No physics bodies, so hundreds are cheap.
 */
export class GridMover implements Mover {
  readonly position = new Vector3();
  readonly grounded = true;
  private readonly prev = new Vector3();
  private vy = 0;

  constructor(
    private readonly floor: WalkableQuery,
    at: Vector3 | readonly [number, number, number],
    private readonly radius = 0.4,
  ) {
    if (at instanceof Vector3) this.position.copy(at);
    else this.position.set(at[0], at[1], at[2]);
    this.prev.copy(this.position);
  }

  private ok(x: number, z: number): boolean {
    const r = this.radius;
    const f = this.floor;
    return f.walkable(x, z) && f.walkable(x + r, z) && f.walkable(x - r, z) && f.walkable(x, z + r) && f.walkable(x, z - r);
  }

  move(vx: number, vz: number, dt: number, vy?: number): void {
    this.prev.copy(this.position);
    const p = this.position;
    const nx = p.x + vx * dt;
    const nz = p.z + vz * dt;
    if (this.ok(nx, nz)) {
      p.x = nx;
      p.z = nz;
    } else if (this.ok(nx, p.z)) p.x = nx;
    else if (this.ok(p.x, nz)) p.z = nz;
    const ground = this.floor.height?.(p.x, p.z) ?? 0;
    if (vy !== undefined) this.vy = vy;
    if (this.vy !== 0 || p.y > ground) {
      this.vy -= 30 * dt;
      p.y += this.vy * dt;
      if (p.y <= ground) {
        p.y = ground;
        this.vy = 0;
      }
    } else p.y = ground;
  }

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.prev.copy(this.position);
    this.vy = 0;
  }

  visual(alpha: number, out: Vector3): Vector3 {
    return out.lerpVectors(this.prev, this.position, alpha);
  }
}

/** The engine's Rapier character controller (walls, steps, slopes) as a Mover. */
export class ControllerMover implements Mover {
  readonly position = new Vector3();
  private readonly wish = new Vector3();
  private readonly footOffset: number;

  /** `controller` must be built with `speed: 1` (the wish is the velocity). */
  constructor(
    readonly controller: CharacterController,
    private readonly physics?: Physics,
  ) {
    const shape = controller.collider.shape as unknown as { halfHeight: number; radius: number };
    this.footOffset = shape.halfHeight + shape.radius;
    const t = controller.body.translation();
    this.position.set(t.x, t.y - this.footOffset, t.z);
  }

  get grounded(): boolean {
    return this.controller.grounded;
  }

  move(vx: number, vz: number, dt: number, vy?: number): void {
    const c = this.controller;
    c.velocity.x = vx;
    c.velocity.z = vz;
    if (vy !== undefined) c.velocity.y = vy;
    // jumpHeld = true: plain gravity on the way up (no short-hop), so leaps follow their arc.
    c.setInput(this.wish.set(vx, 0, vz), false, true);
    c.fixedUpdate(dt);
    // The body gets there on this step's world.step(); report where it is going.
    const next = c.body.nextTranslation();
    this.position.set(next.x, next.y - this.footOffset, next.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.controller.teleport([x, y, z]);
    this.position.set(x, y, z);
  }

  visual(alpha: number, out: Vector3): Vector3 {
    return out.copy(this.controller.interpolatedFeet(alpha));
  }

  dispose(): void {
    if (!this.physics) return;
    this.physics.world.removeCharacterController(this.controller.controller);
    this.physics.remove(this.controller.body);
  }
}
