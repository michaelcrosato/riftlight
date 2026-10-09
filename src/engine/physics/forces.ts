/**
 * Forces in the world: zones that push (wind, an updraft fan, a current), pull (a gravity well,
 * a magnet) or drag (water, mud); conveyor belts; explosions. Dynamic bodies inside a zone get
 * its acceleration every fixed step; the character reads it too (`accelerationAt`), so the
 * same fan lifts crates and the hero.
 *
 *   physics.fields.add({ box: [1.5, 3, 1.5], at: [4, 3, 0], force: [0, 22, 0] });          // a fan
 *   physics.fields.add({ sphere: 5, at: [0, 1, 0], radial: -18, falloff: true });          // a well
 *   physics.fields.add({ box: [6, 2, 2], at: [0, 1, 6], force: [8, 0, 0], drag: 0.6 });    // a current
 *   physics.conveyor(beltCollider, [2.5, 0, 0]);                                             // a belt
 *   physics.explode([0, 0.5, 0], { radius: 4, impulse: 12 });
 */
import type RAPIER_TYPE from '@dimforge/rapier3d';

type Vec3 = readonly [number, number, number];

export interface FieldOptions {
  /** Half extents of a box zone, or the radius of a sphere zone. */
  box?: Vec3;
  sphere?: number;
  at: Vec3;
  /** A box zone's turn about Y (radians). */
  rotationY?: number;
  /** Acceleration (m/s²) in a direction: wind, an updraft (> 9.8 up lifts things), a current. */
  force?: Vec3;
  /** Acceleration away from the zone's centre (m/s²); negative pulls toward it (a well). */
  radial?: number;
  /** Weaker toward the edge (spheres: by distance; boxes: by height above the bottom). */
  falloff?: boolean;
  /** Pull velocities toward the field's own flow (0..1 per second-ish): water, mud. */
  drag?: number;
  /** Push the character too (default true). */
  character?: boolean;
  /** Push dynamic bodies (default true). */
  bodies?: boolean;
  enabled?: boolean;
  name?: string;
}

export interface Field extends FieldOptions {
  enabled: boolean;
  /** Stop and forget it. */
  remove(): void;
}

/** A pure acceleration query: what a field does at a point (no physics world needed). */
export function fieldAcceleration(f: FieldOptions, x: number, y: number, z: number, out: [number, number, number]): boolean {
  out[0] = out[1] = out[2] = 0;
  if (f.enabled === false) return false;
  const dx = x - f.at[0];
  const dy = y - f.at[1];
  const dz = z - f.at[2];
  let k = 1;
  if (f.sphere !== undefined) {
    const d = Math.hypot(dx, dy, dz);
    if (d > f.sphere) return false;
    if (f.falloff) k = 1 - d / f.sphere;
  } else if (f.box) {
    const a = -(f.rotationY ?? 0);
    const lx = dx * Math.cos(a) + dz * Math.sin(a);
    const lz = -dx * Math.sin(a) + dz * Math.cos(a);
    if (Math.abs(lx) > f.box[0] || Math.abs(dy) > f.box[1] || Math.abs(lz) > f.box[2]) return false;
    if (f.falloff) k = 1 - (dy + f.box[1]) / (2 * f.box[1]);
  } else return false;
  if (f.force) {
    out[0] += f.force[0] * k;
    out[1] += f.force[1] * k;
    out[2] += f.force[2] * k;
  }
  if (f.radial) {
    const d = Math.hypot(dx, dy, dz) || 1;
    out[0] += (dx / d) * f.radial * k;
    out[1] += (dy / d) * f.radial * k;
    out[2] += (dz / d) * f.radial * k;
  }
  return true;
}

/** The zones of a physics world. */
export class ForceFields {
  private list: Field[] = [];
  private readonly a: [number, number, number] = [0, 0, 0];
  private readonly sum: [number, number, number] = [0, 0, 0];

  get count(): number {
    return this.list.length;
  }

  get all(): readonly Field[] {
    return this.list;
  }

  add(o: FieldOptions): Field {
    const f: Field = {
      ...o,
      enabled: o.enabled ?? true,
      remove: () => {
        this.list = this.list.filter((x) => x !== f);
      },
    };
    this.list.push(f);
    return f;
  }

  clear(): void {
    this.list = [];
  }

  /** Total acceleration at a point from every field that pushes the character. Returns `out`. */
  accelerationAt(x: number, y: number, z: number, out: [number, number, number], who: 'character' | 'bodies' = 'character'): [number, number, number] {
    out[0] = out[1] = out[2] = 0;
    for (const f of this.list) {
      if (!f.enabled || f[who] === false) continue;
      if (!fieldAcceleration(f, x, y, z, this.a)) continue;
      out[0] += this.a[0];
      out[1] += this.a[1];
      out[2] += this.a[2];
    }
    return out;
  }

  /** The strongest drag (and its flow) at a point for the character or the bodies: water, mud. */
  dragAt(x: number, y: number, z: number, who: 'character' | 'bodies' = 'bodies'): { drag: number; flow: [number, number, number] } | null {
    let best: Field | null = null;
    for (const f of this.list) {
      if (!f.enabled || !f.drag || f[who] === false) continue;
      if (!fieldAcceleration(f, x, y, z, this.a)) continue;
      if (!best || f.drag > (best.drag ?? 0)) best = f;
    }
    if (!best) return null;
    return { drag: best.drag!, flow: [best.force?.[0] ?? 0, 0, best.force?.[2] ?? 0] };
  }

  /** Push every dynamic body inside a field (one fixed step). */
  step(world: RAPIER_TYPE.World, dt: number): void {
    if (this.list.length === 0) return;
    world.bodies.forEach((b) => {
      if (!b.isDynamic()) return;
      const t = b.translation();
      this.accelerationAt(t.x, t.y, t.z, this.sum, 'bodies');
      const [ax, ay, az] = this.sum;
      const drag = this.dragAt(t.x, t.y, t.z, 'bodies');
      if (ax === 0 && ay === 0 && az === 0 && !drag) return;
      const m = b.mass();
      // waking: a crate left resting on a fan starts to float
      if (ax !== 0 || ay !== 0 || az !== 0) b.applyImpulse({ x: ax * m * dt, y: ay * m * dt, z: az * m * dt }, true);
      if (drag) {
        const v = b.linvel();
        const k = Math.min(1, drag.drag * dt * 4);
        b.setLinvel({ x: v.x + (drag.flow[0] * 0.2 - v.x) * k, y: v.y * (1 - k), z: v.z + (drag.flow[2] * 0.2 - v.z) * k }, true);
      }
    });
  }
}

export interface ExplosionOptions {
  radius?: number;
  /** Speed change (m/s) at the centre, fading to 0 at the radius. Default 10. */
  impulse?: number;
  /** Extra upward share (0..1): blasts throw things up. Default 0.4. */
  up?: number;
}

/**
 * Push every dynamic body within `radius` of `at` away from it (a speed change, so light and
 * heavy things fly alike). Returns how many were hit.
 */
export function explode(world: RAPIER_TYPE.World, at: Vec3, o: ExplosionOptions = {}): number {
  const r = o.radius ?? 4;
  const dv = o.impulse ?? 10;
  const up = o.up ?? 0.4;
  let n = 0;
  world.bodies.forEach((b) => {
    if (!b.isDynamic()) return;
    const t = b.translation();
    const dx = t.x - at[0];
    const dy = t.y - at[1];
    const dz = t.z - at[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > r) return;
    const k = (1 - d / r) * dv * b.mass();
    const l = d || 1;
    b.applyImpulse({ x: (dx / l) * k, y: (dy / l) * k + k * up, z: (dz / l) * k }, true);
    // a tumble, different per body but the same every run (no Math.random; the golden ratio
    // spreads the bodies' order evenly over -0.5..0.5)
    const spin = ((n * 0.618034) % 1) - 0.5;
    b.applyTorqueImpulse({ x: spin * k * 0.05, y: 0, z: -spin * k * 0.04 }, true);
    n++;
  });
  return n;
}
