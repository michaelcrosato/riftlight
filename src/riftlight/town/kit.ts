/**
 * A tiny construction kit for building places out of primitives: boxes, prisms, cones,
 * discs and roofs in palette colours, placed in a local frame (a building's own axes),
 * merged into one mesh per material at the end (`mergeStaticMeshes`), plus 2D blockers
 * (circles and rotated boxes) that the stage's `collide()` pushes actors out of.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  type Object3D,
  Shape,
  Vector2,
  Vector3,
} from 'three/webgpu';
// Direct module imports (not the engine index) so node tools can load this file without Rapier.
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { mergeStaticMeshes } from '../../engine/render/merge';
import { toonMaterial } from '../../engine/render/toon';

export type V3 = readonly [number, number, number];

export type Blocker =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; x: number; z: number; hw: number; hd: number; rot: number };

export interface PrimOptions {
  /** Euler rotation in degrees (XYZ). */
  rot?: V3;
  /** Different colour on the top face (boxes). */
  top?: PaletteColor;
  cast?: boolean;
  receive?: boolean;
  /** Keep it out of the merge (it will be animated): returned and parented to the frame. */
  dynamic?: boolean;
}

const DEG = Math.PI / 180;

/** Flat-shaded copy (faceted low-poly look for round primitives). */
export function faceted(geo: BufferGeometry): BufferGeometry {
  if (!geo.index) {
    geo.computeVertexNormals();
    return geo;
  }
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  geo.dispose();
  return g;
}

export const mat = (c: PaletteColor) => toonMaterial(PALETTE[c]);

/**
 * Collects static primitives and blockers. `frame(x, z, yawDeg)` opens a local frame
 * (a building's axes); primitives added inside it use local coordinates.
 */
export class Kit {
  readonly statics: Object3D[] = [];
  readonly blockers: Blocker[] = [];
  /** Dynamic meshes (not merged), already parented to their frame. */
  readonly dynamics = new Group();
  private stack: Group[] = [];

  constructor() {
    this.stack.push(new Group());
  }

  private get top(): Group {
    return this.stack[this.stack.length - 1]!;
  }

  /** Run `build` in a local frame at (x, z) turned by `yaw` degrees (local +Z = front). */
  frame(x: number, z: number, yaw: number, build: () => void, y = 0): Group {
    const g = new Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw * DEG;
    this.top.add(g);
    this.stack.push(g);
    try {
      build();
    } finally {
      this.stack.pop();
    }
    return g;
  }

  /** World position of a local point in the current frame. */
  world(local: V3): Vector3 {
    const v = new Vector3(...local);
    this.top.updateWorldMatrix(true, false);
    return v.applyMatrix4(this.top.matrixWorld);
  }

  /** World yaw (degrees) of the current frame. */
  worldYaw(): number {
    let yaw = 0;
    for (const g of this.stack) yaw += g.rotation.y;
    return yaw / DEG;
  }

  private place(mesh: Mesh, at: V3, o: PrimOptions): Mesh {
    mesh.position.set(...at);
    if (o.rot) mesh.rotation.set(o.rot[0] * DEG, o.rot[1] * DEG, o.rot[2] * DEG);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.receive ?? true;
    this.top.add(mesh);
    if (o.dynamic) {
      // Re-home under the dynamic group with its world transform baked into the object.
      this.top.updateWorldMatrix(true, true);
      const world = mesh.matrixWorld.clone();
      this.top.remove(mesh);
      world.decompose(mesh.position, mesh.quaternion, mesh.scale);
      this.dynamics.add(mesh);
    } else this.statics.push(mesh);
    return mesh;
  }

  box(size: V3, color: PaletteColor, at: V3, o: PrimOptions = {}): Mesh {
    const side = mat(color);
    const material = o.top ? [side, side, mat(o.top), side, side, side] : side;
    return this.place(new Mesh(new BoxGeometry(...size), material), at, o);
  }

  /** Cylinder / prism (few segments = prism), flat-shaded. */
  cyl(rTop: number, rBottom: number, h: number, segs: number, color: PaletteColor, at: V3, o: PrimOptions = {}): Mesh {
    return this.place(new Mesh(faceted(new CylinderGeometry(rTop, rBottom, h, segs)), mat(color)), at, o);
  }

  cone(r: number, h: number, segs: number, color: PaletteColor, at: V3, o: PrimOptions = {}): Mesh {
    return this.place(new Mesh(faceted(new ConeGeometry(r, h, segs)), mat(color)), at, o);
  }

  /** Flat disc / polygon lying on the ground (y = top surface). */
  disc(r: number, segs: number, color: PaletteColor, at: V3, o: PrimOptions = {}): Mesh {
    return this.cyl(r, r, 0.04, segs, color, [at[0], at[1] - 0.02, at[2]], { cast: false, ...o });
  }

  /**
   * A gabled roof over a w × d footprint (ridge along local X), eaves at `y`, ridge `h`
   * higher, overhanging by `over`.
   */
  roof(w: number, d: number, y: number, h: number, color: PaletteColor, over = 0.3, trim?: PaletteColor): void {
    const half = d / 2 + over;
    const slope = Math.hypot(half, h);
    const angle = Math.atan2(h, half) / DEG;
    for (const s of [1, -1]) {
      this.box([w + over * 2, 0.14, slope + 0.05], color, [0, y + h / 2, (s * half) / 2], { rot: [s * angle, 0, 0] });
    }
    this.box([w + over * 2 + 0.1, 0.16, 0.22], trim ?? color, [0, y + h + 0.04, 0]);
    // gable ends: triangular walls
    for (const sx of [1, -1]) this.gable(sx * (w / 2 - 0.06), y, d, h, 'mist');
  }

  /** A triangular wall in the local YZ plane at x, base at `y`, `d` wide, `h` high. */
  gable(x: number, y: number, d: number, h: number, color: PaletteColor): Mesh {
    const shape = new Shape([new Vector2(-d / 2, 0), new Vector2(d / 2, 0), new Vector2(0, h)]);
    const geo = new ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    geo.translate(0, 0, -0.06);
    return this.place(new Mesh(faceted(geo), mat(color)), [x, y, 0], { rot: [0, 90, 0] });
  }

  blockCircle(x: number, z: number, r: number): void {
    const p = this.world([x, 0, z]);
    this.blockers.push({ kind: 'circle', x: p.x, z: p.z, r });
  }

  /** A box blocker in the current frame's local coordinates. */
  blockBox(x: number, z: number, w: number, d: number): void {
    const p = this.world([x, 0, z]);
    this.blockers.push({ kind: 'box', x: p.x, z: p.z, hw: w / 2, hd: d / 2, rot: this.worldYaw() * DEG });
  }

  /** Merge every static primitive (one mesh per material) and return the stage root. */
  build(): Group {
    const root = new Group();
    root.name = 'kit';
    this.stack[0]!.updateWorldMatrix(true, true);
    root.add(...mergeStaticMeshes(this.statics));
    for (const s of this.statics) (s as Mesh).geometry?.dispose();
    root.add(this.dynamics);
    return root;
  }
}

/** Push a circle (p.x, p.z, radius) out of blockers, in place. */
export function collideBlockers(p: Vector3, radius: number, blockers: readonly Blocker[]): void {
  for (const b of blockers) {
    if (b.kind === 'circle') {
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      const min = b.r + radius;
      if (d < min && d > 1e-6) {
        p.x = b.x + (dx / d) * min;
        p.z = b.z + (dz / d) * min;
      } else if (d <= 1e-6) p.x = b.x + min;
    } else {
      // into the box's frame (three's rotation about Y: x' = x cos + z sin, z' = -x sin + z cos)
      const c = Math.cos(b.rot);
      const s = Math.sin(b.rot);
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const cx = Math.max(-b.hw, Math.min(b.hw, lx));
      const cz = Math.max(-b.hd, Math.min(b.hd, lz));
      const ox = lx - cx;
      const oz = lz - cz;
      const d = Math.hypot(ox, oz);
      let nx: number;
      let nz: number;
      if (d > 1e-6) {
        if (d >= radius) continue;
        nx = cx + (ox / d) * radius;
        nz = cz + (oz / d) * radius;
      } else {
        // centre inside the box: out through the nearest side
        const px = b.hw - Math.abs(lx);
        const pz = b.hd - Math.abs(lz);
        if (px < pz) {
          nx = Math.sign(lx || 1) * (b.hw + radius);
          nz = lz;
        } else {
          nx = lx;
          nz = Math.sign(lz || 1) * (b.hd + radius);
        }
      }
      p.x = b.x + nx * c + nz * s;
      p.z = b.z - nx * s + nz * c;
    }
  }
}
