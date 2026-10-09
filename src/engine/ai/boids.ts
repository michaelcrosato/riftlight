/**
 * Flocking (Reynolds' boids) and steering: each agent looks at its neighbours and steers by
 * three rules (separation: don't crowd, alignment: fly where they fly, cohesion: stay with
 * them) plus goals (seek a point, flee a threat), staying inside bounds and out of obstacles.
 * Neighbours come from a spatial hash, so a few hundred agents stay cheap. Pure (typed
 * arrays in, typed arrays out); seeded; unit-tested.
 *
 *   const flock = new Boids(120, { bounds: { min: [-10, 1, -10], max: [10, 6, 10] }, seed: 3 });
 *   flock.seek = [0, 3, 0];          // or null
 *   flock.flee = { at: heroPos, radius: 4 };
 *   flock.step(dt);                  // then read flock.pos / flock.vel (xyz per agent)
 */
import { seeded } from '../physics/fracture';

type Vec3 = [number, number, number];

export interface BoidOptions {
  /** Agents stay inside this box (they steer back in near its walls). */
  bounds?: { min: Vec3; max: Vec3 };
  /** Neighbour radius (m). Default 2. */
  view?: number;
  /** Desired gap (m): closer neighbours push apart. Default 0.8. */
  space?: number;
  maxSpeed?: number;
  minSpeed?: number;
  /** Steering acceleration limit (m/s²). */
  maxForce?: number;
  /** Rule weights. */
  separation?: number;
  alignment?: number;
  cohesion?: number;
  /** Keep to a horizontal plane (fish in a pond, sheep on a field): y never changes. */
  flat?: boolean;
  /** How far inside the bounds the push back in starts (m). Default the view radius; small for a tight pen. */
  margin?: number;
  seed?: number;
}

export class Boids {
  readonly count: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  o: Required<Omit<BoidOptions, 'bounds' | 'seed'>> & { bounds: BoidOptions['bounds'] };
  /** A point everyone is drawn toward (null: none). */
  seek: Vec3 | null = null;
  seekWeight = 0.6;
  /** A threat to scatter from. */
  flee: { at: Vec3; radius: number } | null = null;
  fleeWeight = 3;
  /** Spheres to steer around (x, y, z, r). */
  obstacles: { x: number; y: number; z: number; r: number }[] = [];
  private readonly acc: Float32Array;
  private readonly cells = new Map<number, number[]>();
  private readonly spare: number[][] = [];
  private readonly force: [number, number, number] = [0, 0, 0];
  private readonly rand: () => number;

  constructor(count: number, o: BoidOptions = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.acc = new Float32Array(count * 3);
    this.o = {
      bounds: o.bounds,
      view: o.view ?? 2,
      space: o.space ?? 0.8,
      maxSpeed: o.maxSpeed ?? 4,
      minSpeed: o.minSpeed ?? 1.2,
      maxForce: o.maxForce ?? 6,
      separation: o.separation ?? 1.6,
      alignment: o.alignment ?? 1,
      cohesion: o.cohesion ?? 0.8,
      flat: o.flat ?? false,
      margin: o.margin ?? o.view ?? 2,
    };
    this.rand = seeded(o.seed ?? 1);
    const b = o.bounds ?? { min: [-5, 0, -5], max: [5, 4, 5] };
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) this.pos[i * 3 + c] = b.min[c]! + this.rand() * (b.max[c]! - b.min[c]!);
      const a = this.rand() * Math.PI * 2;
      this.vel[i * 3] = Math.cos(a) * this.o.minSpeed;
      this.vel[i * 3 + 1] = this.o.flat ? 0 : (this.rand() - 0.5) * 0.5;
      this.vel[i * 3 + 2] = Math.sin(a) * this.o.minSpeed;
    }
  }

  /** Average distance to the nearest neighbour (tests, tools). */
  spacing(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      let best = Infinity;
      for (let j = 0; j < this.count; j++) if (i !== j) best = Math.min(best, this.dist(i, j));
      sum += best;
    }
    return sum / this.count;
  }

  /** Average speed and how lined up the headings are (0 random, 1 all the same way). */
  order(): { speed: number; alignment: number } {
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let speed = 0;
    for (let i = 0; i < this.count; i++) {
      const s = Math.hypot(this.vel[i * 3]!, this.vel[i * 3 + 1]!, this.vel[i * 3 + 2]!) || 1;
      speed += s;
      vx += this.vel[i * 3]! / s;
      vy += this.vel[i * 3 + 1]! / s;
      vz += this.vel[i * 3 + 2]! / s;
    }
    return { speed: speed / this.count, alignment: Math.hypot(vx, vy, vz) / this.count };
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.hash();
    const { pos, vel, acc, o } = this;
    acc.fill(0);
    const view2 = o.view * o.view;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      let n = 0;
      let ax = 0;
      let ay = 0;
      let az = 0; // alignment
      let cx = 0;
      let cy = 0;
      let cz = 0; // cohesion
      let sx = 0;
      let sy = 0;
      let sz = 0; // separation
      const v = o.view;
      const gx = Math.floor(pos[k]! / v);
      const gy = Math.floor(pos[k + 1]! / v);
      const gz = Math.floor(pos[k + 2]! / v);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (let oz = -1; oz <= 1; oz++) {
            const list = this.cells.get(((gx + ox + 512) * 1024 + (gy + oy + 512)) * 1024 + (gz + oz + 512));
            if (!list) continue;
            for (const j of list) {
              if (j === i) continue;
              const q = j * 3;
              let dx = pos[q]! - pos[k]!;
              const dy = pos[q + 1]! - pos[k + 1]!;
              let dz = pos[q + 2]! - pos[k + 2]!;
              let d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > view2) continue;
              if (d2 === 0) {
                // two on the same spot: as if a millimetre apart, opposite ways along a direction fixed by the pair
                const a = ((Math.min(i, j) * 7919 + Math.max(i, j) * 104729) % 360) * (Math.PI / 180);
                const side = i < j ? 1 : -1;
                dx = Math.cos(a) * side * 1e-3;
                dz = Math.sin(a) * side * 1e-3;
                d2 = 2e-6;
              }
              n++;
              ax += vel[q]!;
              ay += vel[q + 1]!;
              az += vel[q + 2]!;
              cx += dx;
              cy += dy;
              cz += dz;
              if (d2 < o.space * o.space) {
                const inv = 1 / d2;
                sx -= dx * inv;
                sy -= dy * inv;
                sz -= dz * inv;
              }
            }
          }
      const f = this.force;
      f[0] = f[1] = f[2] = 0;
      if (n > 0) {
        this.steer(ax / n, ay / n, az / n, k, o.alignment);
        this.steer(cx, cy, cz, k, o.cohesion);
        this.steer(sx, sy, sz, k, o.separation);
      }
      if (this.seek) this.steer(this.seek[0] - pos[k]!, this.seek[1] - pos[k + 1]!, this.seek[2] - pos[k + 2]!, k, this.seekWeight);
      if (this.flee) {
        const [tx, ty, tz] = this.flee.at;
        const dx = pos[k]! - tx;
        const dy = pos[k + 1]! - ty;
        const dz = pos[k + 2]! - tz;
        const d = Math.hypot(dx, dy, dz);
        if (d < this.flee.radius && d > 0) this.steer(dx, dy, dz, k, this.fleeWeight * (1 - d / this.flee.radius));
      }
      let fx = f[0];
      let fy = f[1];
      let fz = f[2];
      for (const ob of this.obstacles) {
        const dx = pos[k]! - ob.x;
        const dy = pos[k + 1]! - ob.y;
        const dz = pos[k + 2]! - ob.z;
        const d = Math.hypot(dx, dy, dz);
        const reach = ob.r + o.view * 0.75;
        if (d < reach && d > 0) {
          const w = 3 * (1 - (d - ob.r) / (reach - ob.r));
          fx += (dx / d) * o.maxForce * w;
          fy += (dy / d) * o.maxForce * w;
          fz += (dz / d) * o.maxForce * w;
        }
      }
      const b = o.bounds;
      if (b) {
        const margin = o.margin;
        for (let c = 0; c < 3; c++) {
          if (c === 1 && o.flat) continue; // a flat flock has no height to keep
          const p = pos[k + c]!;
          const lo = p - b.min[c]!;
          const hi = b.max[c]! - p;
          // both sides add up (a box thinner than two margins pushes from both)
          const push = (lo < margin ? 1 - lo / margin : 0) - (hi < margin ? 1 - hi / margin : 0);
          if (c === 0) fx += push * o.maxForce * 2;
          else if (c === 1) fy += push * o.maxForce * 2;
          else fz += push * o.maxForce * 2;
        }
      }
      if (o.flat) fy = 0; // nothing vertical counts toward the force limit
      const fl = Math.hypot(fx, fy, fz);
      const lim = o.maxForce * 3;
      const s = fl > lim ? lim / fl : 1;
      acc[k] = fx * s;
      acc[k + 1] = o.flat ? 0 : fy * s;
      acc[k + 2] = fz * s;
    }
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      for (let c = 0; c < 3; c++) vel[k + c] = vel[k + c]! + acc[k + c]! * dt;
      const sp = Math.hypot(vel[k]!, vel[k + 1]!, vel[k + 2]!);
      if (sp > o.maxSpeed) {
        for (let c = 0; c < 3; c++) vel[k + c] = (vel[k + c]! * o.maxSpeed) / sp;
      } else if (sp < o.minSpeed && sp > 1e-6) {
        for (let c = 0; c < 3; c++) vel[k + c] = (vel[k + c]! * o.minSpeed) / sp;
      }
      for (let c = 0; c < 3; c++) pos[k + c] = pos[k + c]! + vel[k + c]! * dt;
      const b = o.bounds;
      if (b) for (let c = 0; c < 3; c++) pos[k + c] = Math.min(b.max[c]!, Math.max(b.min[c]!, pos[k + c]!));
    }
  }

  /** Steering toward a direction at full speed (desired − velocity, each axis capped), times `w`, added to `f`. */
  private steer(dx: number, dy: number, dz: number, k: number, w: number): void {
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-9 || w === 0) return;
    const o = this.o;
    const s = o.maxSpeed / l;
    const m = o.maxForce;
    const f = this.force;
    f[0] += Math.max(-m, Math.min(m, dx * s - this.vel[k]!)) * w;
    f[1] += Math.max(-m, Math.min(m, dy * s - this.vel[k + 1]!)) * w;
    f[2] += Math.max(-m, Math.min(m, dz * s - this.vel[k + 2]!)) * w;
  }

  private dist(i: number, j: number): number {
    const p = this.pos;
    return Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!);
  }

  private key(x: number, y: number, z: number): number {
    const v = this.o.view;
    return ((Math.floor(x / v) + 512) * 1024 + (Math.floor(y / v) + 512)) * 1024 + (Math.floor(z / v) + 512);
  }

  private hash(): void {
    // empty the buckets back into a pool: buckets for cells nobody is in any more don't linger
    for (const list of this.cells.values()) {
      list.length = 0;
      this.spare.push(list);
    }
    this.cells.clear();
    for (let i = 0; i < this.count; i++) {
      const k = this.key(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = this.spare.pop() ?? []));
      list.push(i);
    }
  }
}
