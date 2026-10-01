import { Vector3 } from 'three/webgpu';
import type { Mover } from '../actors/movers';
import type { StageWorld } from '../game/ports';

/**
 * A stage with a walkability grid (a level). Movers slide along blocked cells instead of
 * being pushed out of them, and fall into pits only when something shoves them in.
 */
export interface GridStage extends StageWorld {
  /** Can an actor stand at (x, z)? `pushed`: it is being knocked / blown (pits let it in). */
  walkable(x: number, z: number, pushed: boolean): boolean;
}

export function isGridStage(s: StageWorld | null): s is GridStage {
  return !!s && typeof (s as Partial<GridStage>).walkable === 'function';
}

/**
 * How actors move in Riftlight's stages: kinematic, fixed-step, no physics bodies (hundreds
 * are cheap). On a grid stage it slides along walls and never walks into a pit by itself;
 * a strong shove (`pushed()`: knockback, gusts, wells) can carry it over an edge, and the
 * level's fall check takes it from there. On any other stage (the town) it moves freely and
 * the stage's `collide` pushes it out of whatever it walked into. Leaps arc under gravity.
 */
export class StageMover implements Mover {
  readonly position = new Vector3();
  readonly grounded = true;
  /** Ground speed of the last step (m/s, after collisions). */
  speed = 0;
  private readonly prev = new Vector3();
  private vy = 0;

  constructor(
    public stage: StageWorld | null,
    at: Vector3 | readonly [number, number, number],
    readonly radius = 0.35,
    /** True while the actor is being shoved hard enough to go over an edge. */
    readonly pushed: () => boolean = () => false,
  ) {
    if (at instanceof Vector3) this.position.copy(at);
    else this.position.set(at[0], at[1], at[2]);
    this.prev.copy(this.position);
  }

  private ok(s: GridStage, x: number, z: number, pushed: boolean): boolean {
    const r = this.radius;
    return s.walkable(x, z, pushed) && s.walkable(x + r, z, pushed) && s.walkable(x - r, z, pushed) && s.walkable(x, z + r, pushed) && s.walkable(x, z - r, pushed);
  }

  move(vx: number, vz: number, dt: number, vy?: number): void {
    this.prev.copy(this.position);
    const p = this.position;
    const s = this.stage;
    if (isGridStage(s)) {
      const pushed = this.pushed();
      const nx = p.x + vx * dt;
      const nz = p.z + vz * dt;
      if (this.ok(s, nx, nz, pushed)) {
        p.x = nx;
        p.z = nz;
      } else if (this.ok(s, nx, p.z, pushed)) p.x = nx;
      else if (this.ok(s, p.x, nz, pushed)) p.z = nz;
    } else {
      p.x += vx * dt;
      p.z += vz * dt;
      s?.collide(p, this.radius);
    }
    this.speed = dt > 0 ? Math.hypot(p.x - this.prev.x, p.z - this.prev.z) / dt : 0;
    const ground = s?.groundY(p.x, p.z) ?? 0;
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
    this.speed = 0;
  }

  visual(alpha: number, out: Vector3): Vector3 {
    return out.lerpVectors(this.prev, this.position, alpha);
  }
}
