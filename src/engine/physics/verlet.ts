/**
 * Soft bodies by Verlet integration (position-based dynamics): cloth, ropes and pressure
 * blobs. Particles remember where they were; each step they keep moving by that difference
 * (velocity without storing it), gravity and wind push them, and then a few passes of
 * constraints pull them back into shape: distances along edges, pins, a volume for blobs,
 * and simple colliders (a floor, spheres, boxes). Cheap, stable at any time step, and it
 * looks right: flags flap, ropes swing and stretch a little, jelly wobbles.
 *
 *   const flag = clothGrid({ width: 2, height: 1.2, cols: 12, rows: 8, origin: [0, 3, 0], pin: 'left' });
 *   flag.wind = [4, 0, 1];
 *   flag.step(1 / 60);                   // per fixed step
 *   flag.spheres.push({ x, y, z, r });  // the hero pushes through it
 *
 * Pure (no three.js): the engine's `SoftMesh` (render/softMesh.ts) draws one. Unit-tested.
 */

export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** An axis-aligned box collider (centre and half extents). */
export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface VerletOptions {
  /** Constraint passes per step: more is stiffer. Default 8. */
  iterations?: number;
  /** Velocity kept per step (0..1). Default 0.99. */
  damping?: number;
}

export class VerletBody {
  readonly count: number;
  /** Positions, xyz per particle. */
  readonly pos: Float32Array;
  /** Last step's positions (velocity = pos − prev). */
  readonly prev: Float32Array;
  /** 0 for pinned particles. */
  readonly invMass: Float32Array;
  /** Where pinned particles are held (move them to drag a cloth by its corner). */
  readonly pinAt: Float32Array;
  /** Distance constraints: particle pairs, rest lengths and stiffness 0..1. */
  ea = new Uint32Array(0);
  eb = new Uint32Array(0);
  rest = new Float32Array(0);
  stiff = new Float32Array(0);
  /** Triangles (cloth and blobs): wind drag, volume and drawing. */
  tris = new Uint32Array(0);
  gravity: [number, number, number] = [0, -9.8, 0];
  /** Wind velocity (m/s): drags triangles (by their facing) or particles (ropes). */
  wind: [number, number, number] = [0, 0, 0];
  /** How much the wind varies in time and space (0..1). */
  gust = 0.4;
  /**
   * How hard the wind pushes. Cloth: acceleration per (m/s)² of wind hitting it squarely (light
   * cloth: high; canvas: low). Ropes: per m/s of speed relative to the wind.
   */
  drag = 1.2;
  /** Cloth: drag along its surface, as a share of `drag` (it streams a flag out). */
  skin = 0.15;
  iterations: number;
  damping: number;
  /** A floor plane every particle stays above (null: none). */
  floor: number | null = null;
  /** Ground friction: how much sideways motion a particle on the floor keeps. */
  friction = 0.8;
  readonly spheres: Sphere[] = [];
  readonly boxes: Box[] = [];
  /** Pressure blobs: the volume it tries to keep (0: off), and how hard. */
  restVolume = 0;
  pressure = 0;
  /** Seconds simulated (drives gusts). */
  time = 0;

  constructor(count: number, o: VerletOptions = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.prev = new Float32Array(count * 3);
    this.invMass = new Float32Array(count).fill(1);
    this.pinAt = new Float32Array(count * 3);
    this.iterations = o.iterations ?? 8;
    this.damping = o.damping ?? 0.99;
  }

  /** Place particle `i` (and stop it). */
  set(i: number, x: number, y: number, z: number): void {
    const k = i * 3;
    this.pos[k] = this.prev[k] = x;
    this.pos[k + 1] = this.prev[k + 1] = y;
    this.pos[k + 2] = this.prev[k + 2] = z;
  }

  /** Hold particle `i` where it is (or at x, y, z). */
  pin(i: number, x?: number, y?: number, z?: number): void {
    const k = i * 3;
    this.invMass[i] = 0;
    this.pinAt[k] = x ?? this.pos[k]!;
    this.pinAt[k + 1] = y ?? this.pos[k + 1]!;
    this.pinAt[k + 2] = z ?? this.pos[k + 2]!;
  }

  unpin(i: number): void {
    this.invMass[i] = 1;
  }

  /** Set the edges (pairs of particle indices) with rest lengths from the current positions. */
  setEdges(pairs: readonly (readonly [number, number, number?])[]): void {
    const n = pairs.length;
    this.ea = new Uint32Array(n);
    this.eb = new Uint32Array(n);
    this.rest = new Float32Array(n);
    this.stiff = new Float32Array(n);
    pairs.forEach(([a, b, s], i) => {
      this.ea[i] = a;
      this.eb[i] = b;
      this.rest[i] = this.distance(a, b);
      this.stiff[i] = s ?? 1;
    });
  }

  distance(a: number, b: number): number {
    const p = this.pos;
    return Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
  }

  /** Signed volume enclosed by the triangles (blobs; needs a closed, outward-wound surface). */
  volume(): number {
    const p = this.pos;
    const t = this.tris;
    let v = 0;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i]! * 3;
      const b = t[i + 1]! * 3;
      const c = t[i + 2]! * 3;
      // a · (b × c) / 6
      v += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
    }
    return v;
  }

  /** Centre of mass (average position). */
  center(out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < this.count; i++) {
      x += this.pos[i * 3]!;
      y += this.pos[i * 3 + 1]!;
      z += this.pos[i * 3 + 2]!;
    }
    out[0] = x / this.count;
    out[1] = y / this.count;
    out[2] = z / this.count;
    return out;
  }

  /** Push every particle by a velocity change (an explosion, a kick). */
  impulse(vx: number, vy: number, vz: number, dt: number, near?: { x: number; y: number; z: number; r: number }): void {
    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      const k = i * 3;
      let f = 1;
      if (near) {
        const d = Math.hypot(this.pos[k]! - near.x, this.pos[k + 1]! - near.y, this.pos[k + 2]! - near.z);
        if (d > near.r) continue;
        f = 1 - d / near.r;
      }
      this.prev[k] = this.prev[k]! - vx * dt * f;
      this.prev[k + 1] = this.prev[k + 1]! - vy * dt * f;
      this.prev[k + 2] = this.prev[k + 2]! - vz * dt * f;
    }
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const { pos, prev, invMass } = this;
    const n = this.count;
    const acc = this.forces(dt);
    const d = this.damping;
    const dt2 = dt * dt;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (invMass[i] === 0) {
        pos[k] = prev[k] = this.pinAt[k]!;
        pos[k + 1] = prev[k + 1] = this.pinAt[k + 1]!;
        pos[k + 2] = prev[k + 2] = this.pinAt[k + 2]!;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const x = pos[k + c]!;
        const v = (x - prev[k + c]!) * d;
        prev[k + c] = x;
        pos[k + c] = x + v + (this.gravity[c]! + acc[k + c]!) * dt2;
      }
    }
    for (let it = 0; it < this.iterations; it++) {
      this.solveEdges();
      if (this.restVolume > 0 && this.pressure > 0) this.solveVolume();
      this.collide();
    }
  }

  private accBuf = new Float32Array(0);
  private areaBuf = new Float32Array(0);

  /**
   * Wind. Cloth (triangles): each triangle is pushed along its normal by the wind hitting it
   * (pressure, growing with the relative speed squared) and along its surface by skin drag,
   * shared out to its corners by area, so the acceleration doesn't depend on how finely the
   * cloth is cut. Ropes (no triangles): each particle is pulled toward the wind's speed.
   */
  private forces(dt: number): Float32Array {
    if (this.accBuf.length !== this.count * 3) {
      this.accBuf = new Float32Array(this.count * 3);
      this.areaBuf = new Float32Array(this.count);
    }
    const acc = this.accBuf;
    acc.fill(0);
    const { pos, prev, tris } = this;
    const wl = Math.hypot(...this.wind);
    if (wl > 0) {
      const t = this.time;
      if (tris.length) {
        const area = this.areaBuf;
        area.fill(0);
        for (let i = 0; i < tris.length; i += 3) {
          const a = tris[i]! * 3;
          const b = tris[i + 1]! * 3;
          const c = tris[i + 2]! * 3;
          // gusts: the wind's strength varies along it and in time
          const g = 1 + this.gust * Math.sin(t * 3.1 + pos[a]! * 1.7 + pos[a + 2]! * 1.3) * Math.sin(t * 1.3 + pos[a + 1]! * 2.1);
          // the triangle's velocity relative to the air
          let rx = 0;
          let ry = 0;
          let rz = 0;
          for (const p of [a, b, c]) {
            rx += (pos[p]! - prev[p]!) / dt;
            ry += (pos[p + 1]! - prev[p + 1]!) / dt;
            rz += (pos[p + 2]! - prev[p + 2]!) / dt;
          }
          rx = this.wind[0] * g - rx / 3;
          ry = this.wind[1] * g - ry / 3;
          rz = this.wind[2] * g - rz / 3;
          const rl = Math.hypot(rx, ry, rz);
          // area-weighted normal: (b − a) × (c − a) / 2
          const ux = pos[b]! - pos[a]!;
          const uy = pos[b + 1]! - pos[a + 1]!;
          const uz = pos[b + 2]! - pos[a + 2]!;
          const vx = pos[c]! - pos[a]!;
          const vy = pos[c + 1]! - pos[a + 1]!;
          const vz = pos[c + 2]! - pos[a + 2]!;
          let nx = (uy * vz - uz * vy) / 2;
          let ny = (uz * vx - ux * vz) / 2;
          let nz = (ux * vy - uy * vx) / 2;
          const ar = Math.hypot(nx, ny, nz);
          if (ar < 1e-12) continue;
          nx /= ar;
          ny /= ar;
          nz /= ar;
          // pressure along the normal, by how squarely it hits; skin drag along the surface
          const rn = nx * rx + ny * ry + nz * rz;
          const k = (this.drag * rl * ar) / 3;
          const fx = k * (rn * nx + this.skin * (rx - rn * nx));
          const fy = k * (rn * ny + this.skin * (ry - rn * ny));
          const fz = k * (rn * nz + this.skin * (rz - rn * nz));
          for (const p of [a, b, c]) {
            acc[p] = acc[p]! + fx;
            acc[p + 1] = acc[p + 1]! + fy;
            acc[p + 2] = acc[p + 2]! + fz;
            area[p / 3] = area[p / 3]! + ar / 3;
          }
        }
        // force per particle's share of the area: an acceleration of the cloth itself
        for (let i = 0; i < this.count; i++) {
          const w = area[i]!;
          if (w > 0) for (let c = 0; c < 3; c++) acc[i * 3 + c] = acc[i * 3 + c]! / w;
        }
      } else {
        for (let i = 0; i < this.count; i++) {
          const k = i * 3;
          const g = 1 + this.gust * Math.sin(t * 2.3 + i * 0.7);
          for (let c = 0; c < 3; c++) acc[k + c] = acc[k + c]! + (this.wind[c]! * g - (pos[k + c]! - prev[k + c]!) / dt) * this.drag;
        }
      }
    }
    return acc;
  }

  private solveEdges(): void {
    const { pos, invMass, ea, eb, rest, stiff } = this;
    for (let e = 0; e < ea.length; e++) {
      const a = ea[e]!;
      const b = eb[e]!;
      const wa = invMass[a]!;
      const wb = invMass[b]!;
      const w = wa + wb;
      if (w === 0) continue;
      const ka = a * 3;
      const kb = b * 3;
      const dx = pos[kb]! - pos[ka]!;
      const dy = pos[kb + 1]! - pos[ka + 1]!;
      const dz = pos[kb + 2]! - pos[ka + 2]!;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      const diff = ((len - rest[e]!) / (len * w)) * stiff[e]!;
      pos[ka] = pos[ka]! + dx * diff * wa;
      pos[ka + 1] = pos[ka + 1]! + dy * diff * wa;
      pos[ka + 2] = pos[ka + 2]! + dz * diff * wa;
      pos[kb] = pos[kb]! - dx * diff * wb;
      pos[kb + 1] = pos[kb + 1]! - dy * diff * wb;
      pos[kb + 2] = pos[kb + 2]! - dz * diff * wb;
    }
  }

  /** Blobs: push every surface particle along its normal until the volume is back. */
  private solveVolume(): void {
    const v = Math.abs(this.volume());
    const err = (this.restVolume - v) / this.restVolume;
    if (Math.abs(err) < 1e-4) return;
    const { pos, invMass } = this;
    const k = err * this.pressure * 0.15;
    const c = this.center();
    for (let i = 0; i < this.count; i++) {
      if (invMass[i] === 0) continue;
      const p = i * 3;
      const dx = pos[p]! - c[0];
      const dy = pos[p + 1]! - c[1];
      const dz = pos[p + 2]! - c[2];
      // radial push (the surface's normals point away from the middle for a round blob)
      pos[p] = pos[p]! + dx * k;
      pos[p + 1] = pos[p + 1]! + dy * k;
      pos[p + 2] = pos[p + 2]! + dz * k;
    }
  }

  private collide(): void {
    const { pos, prev, invMass } = this;
    for (let i = 0; i < this.count; i++) {
      if (invMass[i] === 0) continue;
      const k = i * 3;
      if (this.floor !== null && pos[k + 1]! < this.floor) {
        pos[k + 1] = this.floor;
        // friction: lose some of the sideways motion
        pos[k] = prev[k]! + (pos[k]! - prev[k]!) * this.friction;
        pos[k + 2] = prev[k + 2]! + (pos[k + 2]! - prev[k + 2]!) * this.friction;
      }
      for (const s of this.spheres) {
        const dx = pos[k]! - s.x;
        const dy = pos[k + 1]! - s.y;
        const dz = pos[k + 2]! - s.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= s.r * s.r) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const push = (s.r - d) / d;
        pos[k] = pos[k]! + dx * push;
        pos[k + 1] = pos[k + 1]! + dy * push;
        pos[k + 2] = pos[k + 2]! + dz * push;
      }
      for (const b of this.boxes) {
        const dx = pos[k]! - b.x;
        const dy = pos[k + 1]! - b.y;
        const dz = pos[k + 2]! - b.z;
        const px = b.hx - Math.abs(dx);
        const py = b.hy - Math.abs(dy);
        const pz = b.hz - Math.abs(dz);
        if (px <= 0 || py <= 0 || pz <= 0) continue;
        // out along the shallowest axis
        if (px < py && px < pz) pos[k] = b.x + Math.sign(dx || 1) * b.hx;
        else if (py < pz) pos[k + 1] = b.y + Math.sign(dy || 1) * b.hy;
        else pos[k + 2] = b.z + Math.sign(dz || 1) * b.hz;
      }
    }
  }
}

// ------------------------------------------------------------------ builders

export interface ClothOptions {
  width: number;
  height: number;
  /** Particles across and down (≥ 2). */
  cols: number;
  rows: number;
  /** The top-left corner. The cloth lies in the plane spanned by `across` and `down`. */
  origin: readonly [number, number, number];
  /** Direction along the top edge (unit). Default +X. */
  across?: readonly [number, number, number];
  /** Direction from the top edge to the bottom one (unit). Default −Y (hanging); +Z lays it flat. */
  down?: readonly [number, number, number];
  /** Pinned particles: the whole top edge, its two corners, the left edge (a flag), or none. */
  pin?: 'top' | 'corners' | 'left' | 'none';
  /** Shear and bend springs (0..1 stiffness). Default 0.8 / 0.3. */
  shear?: number;
  bend?: number;
  iterations?: number;
}

/** A sheet of cloth: a grid of particles with structural, shear and bend edges, two triangles per cell. */
export function clothGrid(o: ClothOptions): VerletBody & { cols: number; rows: number; uv: Float32Array } {
  const { cols, rows } = o;
  const body = new VerletBody(cols * rows, { iterations: o.iterations ?? 10 }) as VerletBody & { cols: number; rows: number; uv: Float32Array };
  body.cols = cols;
  body.rows = rows;
  const [ax, ay, az] = o.across ?? [1, 0, 0];
  const [dx, dy, dz] = o.down ?? [0, -1, 0];
  const uv = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      body.set(i, o.origin[0] + ax * u * o.width + dx * v * o.height, o.origin[1] + ay * u * o.width + dy * v * o.height, o.origin[2] + az * u * o.width + dz * v * o.height);
      uv[i * 2] = u;
      uv[i * 2 + 1] = 1 - v;
    }
  body.uv = uv;
  const id = (c: number, r: number) => r * cols + c;
  const edges: [number, number, number?][] = [];
  const shear = o.shear ?? 0.8;
  const bend = o.bend ?? 0.3;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) edges.push([id(c, r), id(c + 1, r)]);
      if (r + 1 < rows) edges.push([id(c, r), id(c, r + 1)]);
      if (c + 1 < cols && r + 1 < rows) {
        edges.push([id(c, r), id(c + 1, r + 1), shear]);
        edges.push([id(c + 1, r), id(c, r + 1), shear]);
      }
      if (c + 2 < cols) edges.push([id(c, r), id(c + 2, r), bend]);
      if (r + 2 < rows) edges.push([id(c, r), id(c, r + 2), bend]);
    }
  body.setEdges(edges);
  const tris: number[] = [];
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      tris.push(id(c, r), id(c, r + 1), id(c + 1, r));
      tris.push(id(c + 1, r), id(c, r + 1), id(c + 1, r + 1));
    }
  body.tris = new Uint32Array(tris);
  const pin = o.pin ?? 'top';
  if (pin === 'top') for (let c = 0; c < cols; c++) body.pin(id(c, 0));
  if (pin === 'corners') {
    body.pin(id(0, 0));
    body.pin(id(cols - 1, 0));
  }
  if (pin === 'left') for (let r = 0; r < rows; r++) body.pin(id(0, r));
  return body;
}

/** A rope from `from` to `to` in `segments` (the first particle pinned; `pinEnd` pins the last). */
export function ropeLine(from: readonly [number, number, number], to: readonly [number, number, number], segments: number, o: { pinEnd?: boolean; slack?: number; iterations?: number } = {}): VerletBody {
  const n = segments + 1;
  const body = new VerletBody(n, { iterations: o.iterations ?? 16, damping: 0.995 });
  body.drag = 0.35;
  const slack = o.slack ?? 1;
  for (let i = 0; i < n; i++) {
    const u = i / segments;
    // with slack > 1 the rope starts hanging lower in the middle (a catenary-ish sag)
    const sag = slack > 1 ? Math.sin(u * Math.PI) * (slack - 1) * Math.hypot(to[0] - from[0], to[2] - from[2]) * 0.5 : 0;
    body.set(i, from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u - sag, from[2] + (to[2] - from[2]) * u);
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < segments; i++) edges.push([i, i + 1]);
  body.setEdges(edges);
  // rest length: the straight distance shared out, times the slack
  const each = (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / segments) * slack;
  body.rest.fill(each);
  body.pin(0);
  if (o.pinEnd) body.pin(n - 1);
  return body;
}

/**
 * A pressure blob: a sphere of particles (latitude × longitude rings plus poles) with edges
 * along and across, that keeps its volume. `pressure` 0..1 sets how firm it is.
 */
export function softBlob(center: readonly [number, number, number], radius: number, o: { rings?: number; segments?: number; pressure?: number; stiffness?: number } = {}): VerletBody {
  const rings = o.rings ?? 6;
  const segs = o.segments ?? 10;
  const count = 2 + (rings - 1) * segs;
  const body = new VerletBody(count, { iterations: 8, damping: 0.985 });
  const [cx, cy, cz] = center;
  body.set(0, cx, cy + radius, cz); // north pole
  for (let r = 1; r < rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      body.set(1 + (r - 1) * segs + s, cx + radius * Math.sin(phi) * Math.cos(th), cy + radius * Math.cos(phi), cz + radius * Math.sin(phi) * Math.sin(th));
    }
  }
  const south = count - 1;
  body.set(south, cx, cy - radius, cz);
  const ring = (r: number, s: number) => 1 + (r - 1) * segs + (((s % segs) + segs) % segs);
  const edges: [number, number, number?][] = [];
  const tris: number[] = [];
  const k = o.stiffness ?? 0.9;
  for (let s = 0; s < segs; s++) {
    edges.push([0, ring(1, s), k]);
    tris.push(0, ring(1, s + 1), ring(1, s));
    edges.push([south, ring(rings - 1, s), k]);
    tris.push(south, ring(rings - 1, s), ring(rings - 1, s + 1));
  }
  for (let r = 1; r < rings; r++)
    for (let s = 0; s < segs; s++) {
      edges.push([ring(r, s), ring(r, s + 1), k]);
      if (r + 1 < rings) {
        edges.push([ring(r, s), ring(r + 1, s), k]);
        edges.push([ring(r, s), ring(r + 1, s + 1), k * 0.8]);
        tris.push(ring(r, s), ring(r, s + 1), ring(r + 1, s));
        tris.push(ring(r, s + 1), ring(r + 1, s + 1), ring(r + 1, s));
      }
    }
  // a few long struts through the middle keep it from folding flat
  for (let s = 0; s < segs; s++) edges.push([ring(Math.floor(rings / 2), s), ring(Math.floor(rings / 2), s + Math.floor(segs / 2)), 0.05]);
  body.setEdges(edges);
  body.tris = new Uint32Array(tris);
  body.restVolume = Math.abs(body.volume());
  body.pressure = o.pressure ?? 0.6;
  return body;
}
