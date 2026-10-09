/**
 * Terrain from a height function: a grid of heights drawn as a flat-shaded mesh coloured by
 * height and slope (beach, grass, rock, snow), and the same grid as a Rapier heightfield the
 * character walks on. `erode` runs hydraulic erosion: raindrops that roll downhill, pick up
 * soil where they speed up and drop it where they slow, carving gullies and filling valleys.
 *
 *   const land = new Terrain({ size: [40, 30], cells: [80, 60] });
 *   land.generate((x, z) => 4 * noise.fbm2(x * 0.04, z * 0.04));
 *   land.erode();                         // about one raindrop per grid point
 *   land.attach(physics);                 // the heightfield collider (again after a change)
 *   scene.add(land.mesh);
 *   land.heightAt(x, z);                  // what the collider says, between the grid points too
 *
 * The grid's cells are split into triangles the way Rapier splits its heightfield (the
 * diagonal from the cell's +x corner to its +z corner), so mesh, `heightAt` and collider agree.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, Vector3 } from 'three/webgpu';
import { seeded } from '../physics/fracture';
import { type Physics, RAPIER } from '../physics/Physics';
import { toonMaterial } from '../render/toon';

export interface TerrainBand {
  /** Heights below this (metres above the terrain's origin) take this colour. */
  below: number;
  color: number;
}

export interface TerrainOptions {
  /** Size in metres along x and z (default [32, 32]). */
  size?: readonly [number, number];
  /** Cells along x and z (default one per metre). */
  cells?: readonly [number, number];
  /** Where the middle of the grid's height 0 is (default the origin). */
  at?: readonly [number, number, number];
  /** Colour by height, lowest first; the last band takes everything above. */
  bands?: readonly TerrainBand[];
  /** Faces steeper than this (their normal's y below it) are rock. Default 0.72 (about 44°). */
  steep?: number;
  rock?: number;
}

export interface ErosionOptions {
  /** Raindrops to roll (default one per grid point). */
  droplets?: number;
  seed?: number;
  /** Steps a drop lives (default 40). */
  lifetime?: number;
  /** How much a drop keeps its direction instead of following the slope (0..1, default 0.05). */
  inertia?: number;
  /** Soil a drop can carry, per unit of speed, water and drop in height (default 4). */
  capacity?: number;
  /** Fraction of its spare capacity a drop digs up per step (default 0.3). */
  erode?: number;
  /** Fraction of its excess it lays down per step (default 0.3). */
  deposit?: number;
  /** Water lost per step (default 0.02). */
  evaporate?: number;
  /** How fast drops speed up downhill (default 4). */
  gravity?: number;
  /** Radius (whole cells) a drop digs over, so it carves gullies rather than pits (default 2). */
  radius?: number;
  /** Grid points along each edge left exactly as they are (default 0): where the land meets a floor or a wall. */
  margin?: number;
}

/** Sea, beach, grass, forest, rock, snow (the engine palette). */
export const TERRAIN_BANDS: readonly TerrainBand[] = [
  { below: -0.6, color: 0x29366f },
  { below: 0.15, color: 0xffcd75 },
  { below: 1.6, color: 0x38b764 },
  { below: 3, color: 0x257179 },
  { below: 4.6, color: 0x566c86 },
  { below: Infinity, color: 0xf4f4f4 },
];

export class Terrain {
  readonly nx: number;
  readonly nz: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly at: readonly [number, number, number];
  /** Heights at the grid points, row by row along z: `heights[ix + iz * (nx + 1)]`. */
  readonly heights: Float32Array;
  readonly mesh: Mesh;
  collider: RAPIER.Collider | null = null;
  private readonly bands: readonly TerrainBand[];
  private readonly steep: number;
  private readonly rock: number;
  private physics: Physics | null = null;

  constructor(o: TerrainOptions = {}) {
    [this.sizeX, this.sizeZ] = o.size ?? [32, 32];
    [this.nx, this.nz] = o.cells ?? [Math.max(1, Math.round(this.sizeX)), Math.max(1, Math.round(this.sizeZ))];
    this.at = o.at ?? [0, 0, 0];
    this.bands = o.bands ?? TERRAIN_BANDS;
    this.steep = o.steep ?? 0.72;
    this.rock = o.rock ?? 0x566c86;
    this.heights = new Float32Array((this.nx + 1) * (this.nz + 1));
    const tris = this.nx * this.nz * 2;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(tris * 9), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(tris * 9), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(tris * 9), 3));
    this.mesh = new Mesh(geometry, toonMaterial(0xffffff, { vertexColors: true }));
    this.mesh.position.set(...this.at);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.update();
  }

  /** Metres between grid points along x and z. */
  get cell(): [number, number] {
    return [this.sizeX / this.nx, this.sizeZ / this.nz];
  }

  /** World x, z of grid point (ix, iz). */
  pointX(ix: number): number {
    return this.at[0] - this.sizeX / 2 + ix * (this.sizeX / this.nx);
  }
  pointZ(iz: number): number {
    return this.at[2] - this.sizeZ / 2 + iz * (this.sizeZ / this.nz);
  }

  /** Fill the heights from `f(x, z)` (world x, z; metres above the terrain's origin), then redraw. */
  generate(f: (x: number, z: number) => number): this {
    for (let iz = 0; iz <= this.nz; iz++) for (let ix = 0; ix <= this.nx; ix++) this.heights[ix + iz * (this.nx + 1)] = f(this.pointX(ix), this.pointZ(iz));
    this.update();
    return this;
  }

  private h(ix: number, iz: number): number {
    return this.heights[ix + iz * (this.nx + 1)]!;
  }

  /**
   * Height of the surface at world (x, z), in world y: the triangle it is over, as the mesh and
   * the collider have it. Outside the grid: its nearest edge.
   */
  heightAt(x: number, z: number): number {
    const u = Math.min(this.nx - 1e-6, Math.max(0, ((x - this.at[0] + this.sizeX / 2) / this.sizeX) * this.nx));
    const v = Math.min(this.nz - 1e-6, Math.max(0, ((z - this.at[2] + this.sizeZ / 2) / this.sizeZ) * this.nz));
    const ix = Math.floor(u);
    const iz = Math.floor(v);
    const fu = u - ix;
    const fv = v - iz;
    const h00 = this.h(ix, iz);
    const h10 = this.h(ix + 1, iz); // +x
    const h01 = this.h(ix, iz + 1); // +z
    const h11 = this.h(ix + 1, iz + 1);
    // the diagonal from the +x corner to the +z corner (Rapier's)
    const y = fu + fv < 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
    return this.at[1] + y;
  }

  /** The surface's normal at world (x, z) (central differences over half a cell). */
  normalAt(x: number, z: number, out = new Vector3()): Vector3 {
    const [cx, cz] = this.cell;
    const ex = cx * 0.5;
    const ez = cz * 0.5;
    const dx = (this.heightAt(x + ex, z) - this.heightAt(x - ex, z)) / (2 * ex);
    const dz = (this.heightAt(x, z + ez) - this.heightAt(x, z - ez)) / (2 * ez);
    return out.set(-dx, 1, -dz).normalize();
  }

  /** Redraw the mesh from the heights (positions, flat normals, colours per face). */
  update(): void {
    const g = this.mesh.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const nor = g.getAttribute('normal') as BufferAttribute;
    const col = g.getAttribute('color') as BufferAttribute;
    const P = pos.array as Float32Array;
    const N = nor.array as Float32Array;
    const C = col.array as Float32Array;
    const [cx, cz] = this.cell;
    const x0 = -this.sizeX / 2;
    const z0 = -this.sizeZ / 2;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const n = new Vector3();
    const e1 = new Vector3();
    const e2 = new Vector3();
    const tint = new Color();
    let k = 0;
    const tri = (ax: number, az: number, bx: number, bz: number, qx: number, qz: number) => {
      a.set(x0 + ax * cx, this.h(ax, az), z0 + az * cz);
      b.set(x0 + bx * cx, this.h(bx, bz), z0 + bz * cz);
      c.set(x0 + qx * cx, this.h(qx, qz), z0 + qz * cz);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      const mid = (a.y + b.y + c.y) / 3;
      tint.setHex(n.y < this.steep ? this.rock : this.bandColor(mid));
      for (const p of [a, b, c]) {
        P[k] = p.x;
        P[k + 1] = p.y;
        P[k + 2] = p.z;
        N[k] = n.x;
        N[k + 1] = n.y;
        N[k + 2] = n.z;
        C[k] = tint.r;
        C[k + 1] = tint.g;
        C[k + 2] = tint.b;
        k += 3;
      }
    };
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        // counter-clockwise from above; split along the +x corner to +z corner diagonal
        tri(ix, iz, ix, iz + 1, ix + 1, iz);
        tri(ix + 1, iz + 1, ix + 1, iz, ix, iz + 1);
      }
    }
    pos.needsUpdate = nor.needsUpdate = col.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }

  private bandColor(h: number): number {
    for (const band of this.bands) if (h < band.below) return band.color;
    return this.bands[this.bands.length - 1]?.color ?? 0xffffff;
  }

  /**
   * Make (or remake, after `generate` / `erode`) the heightfield collider: a fixed body at the
   * terrain's origin. Returns it.
   */
  attach(physics: Physics): RAPIER.Collider {
    this.detach();
    this.physics = physics;
    // Rapier's heightfield: rows along z, columns along x, stored column by column
    const h = new Float32Array((this.nx + 1) * (this.nz + 1));
    for (let ix = 0; ix <= this.nx; ix++) for (let iz = 0; iz <= this.nz; iz++) h[iz + ix * (this.nz + 1)] = this.h(ix, iz);
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...this.at));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.heightfield(this.nz, this.nx, h, { x: this.sizeX, y: 1, z: this.sizeZ }).setFriction(0.8), body);
    return this.collider;
  }

  /** Remove the collider (the mesh stays). */
  detach(): void {
    if (this.collider && this.physics) this.physics.remove(this.collider);
    this.collider = null;
  }

  /** The collider and the mesh's geometry go (the shared material stays). */
  dispose(): void {
    this.detach();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }

  /**
   * Hydraulic erosion: `droplets` raindrops, each rolling downhill from a random point. A drop
   * carries soil up to a capacity that grows with its speed, water and how steeply it is
   * falling: below capacity it digs (over a small radius), above it, or going uphill, it drops
   * soil. It evaporates as it goes. Redraws when done; reattach the collider after.
   */
  erode(o: ErosionOptions = {}): void {
    const rand = seeded(o.seed ?? 1);
    const nx = this.nx;
    const nz = this.nz;
    const W = nx + 1;
    const H = this.heights;
    const inertia = o.inertia ?? 0.05;
    const capacity = o.capacity ?? 4;
    const erodeRate = o.erode ?? 0.3;
    const depositRate = o.deposit ?? 0.3;
    const evaporate = o.evaporate ?? 0.02;
    const gravity = o.gravity ?? 4;
    const lifetime = o.lifetime ?? 40;
    const radius = Math.max(1, Math.round(o.radius ?? 2));
    const margin = Math.max(0, Math.round(o.margin ?? 0));
    const kept = (gx: number, gz: number) => gx < margin || gz < margin || gx > nx - margin || gz > nz - margin;
    const minCapacity = 0.01;
    // the drop rules are tuned for gentle maps (the steepest step between grid points about
    // 0.05): work in that scale whatever the units, so a terrain in metres erodes the same way
    let steepest = 0;
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const i = ix + iz * W;
        if (ix < nx) steepest = Math.max(steepest, Math.abs(H[i + 1]! - H[i]!));
        if (iz < nz) steepest = Math.max(steepest, Math.abs(H[i + W]! - H[i]!));
      }
    }
    if (steepest < 1e-9) return; // flat: nothing runs anywhere
    const k = 0.05 / steepest;
    const original = margin > 0 ? Float32Array.from(H) : null; // the margin back bit for bit, not via the scale
    for (let i = 0; i < H.length; i++) H[i] = H[i]! * k;
    // height and gradient by bilinear interpolation, in grid units
    const sample = (x: number, z: number, out: [number, number, number]) => {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      const u = x - ix;
      const v = z - iz;
      const i = ix + iz * W;
      const h00 = H[i]!;
      const h10 = H[i + 1]!;
      const h01 = H[i + W]!;
      const h11 = H[i + W + 1]!;
      out[0] = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
      out[1] = (h10 - h00) * (1 - v) + (h11 - h01) * v;
      out[2] = (h01 - h00) * (1 - u) + (h11 - h10) * u;
      return out;
    };
    const s: [number, number, number] = [0, 0, 0];
    const s2: [number, number, number] = [0, 0, 0];
    // lay `amount` down at (x, z), shared between the four grid points around it
    const lay = (x: number, z: number, amount: number) => {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      const u = x - ix;
      const v = z - iz;
      const i = ix + iz * W;
      if (!kept(ix, iz)) H[i] = H[i]! + amount * (1 - u) * (1 - v);
      if (!kept(ix + 1, iz)) H[i + 1] = H[i + 1]! + amount * u * (1 - v);
      if (!kept(ix, iz + 1)) H[i + W] = H[i + W]! + amount * (1 - u) * v;
      if (!kept(ix + 1, iz + 1)) H[i + W + 1] = H[i + W + 1]! + amount * u * v;
    };
    const drops = o.droplets ?? (nx + 1) * (nz + 1);
    for (let d = 0; d < drops; d++) {
      let x = rand() * nx;
      let z = rand() * nz;
      let dx = 0;
      let dz = 0;
      let speed = 1;
      let water = 1;
      let sediment = 0;
      let gone = false;
      for (let life = 0; life < lifetime; life++) {
        const ix = Math.floor(x);
        const iz = Math.floor(z);
        const u = x - ix;
        const v = z - iz;
        sample(x, z, s);
        // turn toward downhill, keeping some of the old direction
        dx = dx * inertia - s[1] * (1 - inertia);
        dz = dz * inertia - s[2] * (1 - inertia);
        const len = Math.hypot(dx, dz);
        if (len < 1e-9) break; // flat: it soaks in
        dx /= len;
        dz /= len;
        const ox = x;
        const oz = z;
        x += dx;
        z += dz;
        if (x < 0 || z < 0 || x >= nx - 1e-6 || z >= nz - 1e-6) {
          gone = true; // off the edge, soil and all (a river carries it away)
          break;
        }
        const dh = sample(x, z, s2)[0] - s[0];
        const cap = Math.max(-dh * speed * water * capacity, minCapacity);
        if (sediment > cap || dh > 0) {
          // uphill: fill the hole behind it (at most the climb); else drop part of the excess
          const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositRate;
          sediment -= amount;
          lay(ox, oz, amount);
        } else {
          // dig, never deeper than the drop just fell, over the points within `radius`, and
          // never a point below where the drop now is (or the next drop there falls further,
          // digs deeper, and the hole runs away)
          const amount = Math.min((cap - sediment) * erodeRate, -dh);
          const px = ix + u;
          const pz = iz + v;
          const floor = s2[0];
          let total = 0;
          let dug = 0;
          for (let pass = 0; pass < 2; pass++) {
            for (let gz = Math.max(0, iz - radius + 1); gz <= Math.min(nz, iz + radius); gz++) {
              for (let gx = Math.max(0, ix - radius + 1); gx <= Math.min(nx, ix + radius); gx++) {
                if (kept(gx, gz)) continue;
                const w = Math.max(0, radius - Math.hypot(gx - px, gz - pz));
                if (pass === 0) total += w;
                else if (w > 0) {
                  const i = gx + gz * W;
                  const take = Math.min((amount * w) / total, Math.max(0, H[i]! - floor));
                  H[i] = H[i]! - take;
                  dug += take;
                }
              }
            }
            if (total <= 0) break;
          }
          sediment += dug; // what it really took
        }
        speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
        water *= 1 - evaporate;
      }
      // dried up (or stuck) on the map: what it still carries settles where it stopped
      if (!gone && sediment > 0) lay(Math.min(x, nx - 1e-6), Math.min(z, nz - 1e-6), sediment);
    }
    for (let i = 0; i < H.length; i++) H[i] = H[i]! / k;
    if (original) for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) if (kept(ix, iz)) H[ix + iz * W] = original[ix + iz * W]!;
    this.update();
  }
}
