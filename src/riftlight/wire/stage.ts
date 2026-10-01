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

  /** How many of the four edge probes stand on blocked cells. */
  private blocked(s: GridStage, x: number, z: number, pushed: boolean): number {
    const r = this.radius;
    return +!s.walkable(x + r, z, pushed) + +!s.walkable(x - r, z, pushed) + +!s.walkable(x, z + r, pushed) + +!s.walkable(x, z - r, pushed);
  }

  /**
   * Pressing (nearly) straight into a wall corner (a doorway or a one-cell corridor
   * a little off its centre line). Push the step's end out of the blocked cells it overlaps,
   * as a circle would, so the actor rounds the corner instead of sticking to it.
   */
  private round(s: GridStage, nx: number, nz: number, step: number, pushed: boolean): boolean {
    const r = this.radius + 0.01;
    let x = nx;
    let z = nz;
    for (let pass = 0; pass < 2; pass++) {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (!s.walkable(cx + 0.5, cz + 0.5, pushed)) return false; // the centre itself is in a wall
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dz) || s.walkable(cx + dx + 0.5, cz + dz + 0.5, pushed)) continue;
          const qx = Math.max(cx + dx, Math.min(cx + dx + 1, x));
          const qz = Math.max(cz + dz, Math.min(cz + dz + 1, z));
          const d = Math.hypot(x - qx, z - qz);
          if (d >= r || d < 1e-6) continue;
          x = qx + ((x - qx) / d) * r;
          z = qz + ((z - qz) / d) * r;
        }
    }
    // ease toward it at walking pace (no snap); line up first if the corner is still in the way
    const p = this.position;
    let dx = x - p.x;
    let dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return false;
    if (d > step) {
      dx *= step / d;
      dz *= step / d;
    }
    for (const [ax, az] of [[dx, dz], [dx, 0], [0, dz]] as const) {
      if (Math.hypot(ax, az) < step * 0.1 || !this.ok(s, p.x + ax, p.z + az, pushed)) continue;
      p.x += ax;
      p.z += az;
      return true;
    }
    return false;
  }

  move(vx: number, vz: number, dt: number, vy?: number): void {
    this.prev.copy(this.position);
    const p = this.position;
    const s = this.stage;
    if (isGridStage(s)) {
      const pushed = this.pushed();
      const nx = p.x + vx * dt;
      const nz = p.z + vz * dt;
      if (!this.ok(s, p.x, p.z, pushed) && s.walkable(p.x, p.z, pushed)) {
        // the floor changed under it (a Collapse tile dropped next to it): every step from
        // here would fail the edge probes, so any step that stays on floor and overlaps no
        // more blocked cells is allowed (it walks off the edge instead of freezing there)
        if (s.walkable(nx, nz, pushed) && this.blocked(s, nx, nz, pushed) <= this.blocked(s, p.x, p.z, pushed)) {
          p.x = nx;
          p.z = nz;
        }
      } else if (this.ok(s, nx, nz, pushed)) {
        p.x = nx;
        p.z = nz;
      } else {
        // slide along the wall when that keeps a fair share of the step; pressing (nearly)
        // straight into a corner rounds it instead
        const step = Math.hypot(vx, vz) * dt;
        const xs = Math.abs(vx * dt) >= step * 0.3 && this.ok(s, nx, p.z, pushed);
        const zs = Math.abs(vz * dt) >= step * 0.3 && this.ok(s, p.x, nz, pushed);
        if (xs) p.x = nx;
        else if (zs) p.z = nz;
        else if (!this.round(s, nx, nz, step, pushed)) {
          if (this.ok(s, nx, p.z, pushed)) p.x = nx;
          else if (this.ok(s, p.x, nz, pushed)) p.z = nz;
        }
      }
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
