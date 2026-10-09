/**
 * Things that float: each body is split into eight octants; each octant under the surface
 * pushes up, at its centre, by the weight of the water it displaces (how deep its own vertical
 * extent is in, whichever way the body is turned), so a body tilts with the waves, rights
 * itself and never loses its lift by flipping over; water drag slows it while it is in. Bodies lighter than the water (density below `density`) float, heavier ones
 * sink slowly. The surface is any height function: flat, `waterHeight` waves, a ripple field
 * (`render/water.ts`'s `WaterSurface.heightAt`).
 *
 *   const floaters = new Floaters(physics.world, (x, z) => water.covers(x, z) ? water.heightAt(x, z) : null);
 *   floaters.add(crate.body);
 *   // per fixed step, before the physics step (a game's fixedUpdate): floaters.step(dt)
 *
 * Masses here are the physics world's (density × m³), so water has density 1 by default.
 */
import type RAPIER_TYPE from '@dimforge/rapier3d';

export interface FloaterOptions {
  /** Water density in the world's mass units (default 1: a body of density 0.5 floats half in). */
  density?: number;
  /** How fast velocities die in the water (per second, times how deep it is in). Default 2.5. */
  drag?: number;
  /** Turning drag (per second). Default 1.6. */
  angularDrag?: number;
  /** Called when a body falls into the water fast enough to splash (speed m/s). */
  onSplash?: (x: number, y: number, z: number, speed: number) => void;
}

interface Floater {
  body: RAPIER_TYPE.RigidBody;
  /** Octant centres in the body's own space. */
  points: [number, number, number][];
  /** Volume per octant (m³), an octant's half extents, and the body's half height. */
  share: number;
  ext: [number, number, number];
  half: number;
  wet: boolean;
  /** Seconds since it was last in the water. */
  dry: number;
}

export class Floaters {
  readonly list: Floater[] = [];
  private readonly p = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly world: RAPIER_TYPE.World,
    private readonly surface: (x: number, z: number) => number | null,
    readonly o: FloaterOptions = {},
  ) {}

  /**
   * Float `body`: its first collider's shape sets the octants (its bounding box) and the volume
   * it can push aside (a box, ball, capsule, cylinder or cone; any other shape counts as a box).
   */
  add(body: RAPIER_TYPE.RigidBody): void {
    const [hx, hy, hz, volume] = measure(body.collider(0));
    const points: [number, number, number][] = [];
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) points.push([sx * hx, sy * hy, sz * hz]);
    this.list.push({ body, points, share: volume / 8, ext: [hx / 2, hy / 2, hz / 2], half: hy, wet: false, dry: 1 });
  }

  remove(body: RAPIER_TYPE.RigidBody): void {
    const i = this.list.findIndex((f) => f.body === body);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** How deep (0..1 of its height) a floater sits in the water now (tests, HUDs). */
  submerged(body: RAPIER_TYPE.RigidBody): number {
    const f = this.list.find((x) => x.body === body);
    if (!f) return 0;
    const t = body.translation();
    const s = this.surface(t.x, t.z);
    if (s === null) return 0;
    return Math.min(1, Math.max(0, (s - (t.y - f.half)) / (2 * f.half)));
  }

  /** One fixed step: buoyancy at each sample point under the surface, then drag. */
  step(dt: number): void {
    const g = -this.world.gravity.y;
    const rho = this.o.density ?? 1;
    const drag = this.o.drag ?? 2.5;
    const angDrag = this.o.angularDrag ?? 1.6;
    for (const f of this.list) {
      const b = f.body;
      if (!this.world.bodies.contains(b.handle)) continue;
      const t = b.translation();
      const q = b.rotation();
      let wet = 0;
      // an octant's vertical half extent, turned: |row y of the rotation| · its half extents
      const ry0 = Math.abs(2 * (q.x * q.y + q.w * q.z));
      const ry1 = Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
      const ry2 = Math.abs(2 * (q.y * q.z - q.w * q.x));
      const reach = ry0 * f.ext[0] + ry1 * f.ext[1] + ry2 * f.ext[2];
      for (const [lx, ly, lz] of f.points) {
        // the point in world space: rotate by q, add t
        const ix = q.w * lx + q.y * lz - q.z * ly;
        const iy = q.w * ly + q.z * lx - q.x * lz;
        const iz = q.w * lz + q.x * ly - q.y * lx;
        const iw = -q.x * lx - q.y * ly - q.z * lz;
        const wx = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y + t.x;
        const wy = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z + t.y;
        const wz = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x + t.z;
        const s = this.surface(wx, wz);
        if (s === null || wy - reach >= s) continue;
        // how much of this octant is under: 0 with its bottom at the surface, 1 with its top under
        const depth = Math.min(1, (s - (wy - reach)) / (2 * reach));
        wet += depth;
        const up = rho * g * f.share * depth * dt;
        this.p.x = wx;
        this.p.y = wy;
        this.p.z = wz;
        b.applyImpulseAtPoint({ x: 0, y: up, z: 0 }, this.p, true);
      }
      wet /= f.points.length;
      f.dry += dt;
      if (wet > 0) {
        // a splash when it comes down into the water fast, after a moment out of it (not every bob)
        if (!f.wet && f.dry > 0.25) {
          const v = b.linvel();
          if (v.y < -2.5) this.o.onSplash?.(t.x, t.y - f.half, t.z, -v.y);
        }
        f.dry = 0;
        const k = Math.max(0, 1 - drag * wet * dt);
        const a = Math.max(0, 1 - angDrag * wet * dt);
        const v = b.linvel();
        const w = b.angvel();
        b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
        b.setAngvel({ x: w.x * a, y: w.y * a, z: w.z * a }, true);
      }
      f.wet = wet > 0;
    }
  }
}

// Rapier's ShapeType values (the enum isn't loaded here: this file only imports types)
const BALL = 0;
const CUBOID = 1;
const CAPSULE = 2;
const CYLINDER = 10;
const CONE = 11;

/** A collider's half extents (its box, Y up) and volume (m³). */
export function measure(col: RAPIER_TYPE.Collider): [number, number, number, number] {
  const type = col.shapeType() as number;
  const he = type === CUBOID ? col.halfExtents() : null;
  if (he) {
    return [he.x, he.y, he.z, 8 * he.x * he.y * he.z];
  }
  const r = col.radius();
  if (type === BALL) return [r, r, r, (4 / 3) * Math.PI * r ** 3];
  const hh = col.halfHeight();
  if (type === CAPSULE) return [r, hh + r, r, Math.PI * r * r * 2 * hh + (4 / 3) * Math.PI * r ** 3];
  if (type === CYLINDER) return [r, hh, r, Math.PI * r * r * 2 * hh];
  if (type === CONE) return [r, hh, r, (Math.PI * r * r * 2 * hh) / 3];
  return [0.5, 0.5, 0.5, 1];
}
