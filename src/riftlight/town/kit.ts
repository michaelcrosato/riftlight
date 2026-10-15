/**
 * A tiny construction kit for building places out of primitives: boxes, prisms, cones,
 * discs and roofs in palette colours, and library models (`model`: the engine's ModelDefs,
 * docs/ASSETS.md), placed in a local frame (a building's own axes), merged into one mesh per
 * material at the end (`mergeStaticMeshes`), plus 2D blockers (circles and rotated boxes) that
 * the stage's `collide()` pushes actors out of. New dressing comes from the library.
 */
import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  type Object3D,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three/webgpu';
// Direct module imports (not the engine index) so node tools can load this file without Rapier.
import { buildModel } from '../../engine/model/build';
import type { ModelBuild } from '../../engine/model/build';
import type { Binding } from '../../engine/model/expand';
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { mergeStaticMeshes } from '../../engine/render/merge';
import { toonMaterial } from '../../engine/render/toon';

export type V3 = readonly [number, number, number];

/** How `Kit.model` places a model. */
export interface ModelPlacement {
  /** Degrees about Y, in the current frame. */
  readonly yaw?: number;
  /** Uniform size (its blocker scales with it). */
  readonly scale?: number;
  readonly params?: Readonly<Record<string, number>>;
  readonly palette?: Readonly<Record<string, Binding>>;
  readonly seed?: number;
  /** False: no blocker from its footprint (add a circle at a trunk instead). */
  readonly block?: boolean;
  /** False: casts no shadow (ground tiles, flowers and such: the shadow pass skips them). */
  readonly cast?: boolean;
}

/**
 * What actors are pushed out of. A `low` box (water, a bridge's rails) stops walkers but not a
 * Blink, which goes over it (`Town.wall`), as a level's pits don't stop one.
 */
export type Blocker =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; x: number; z: number; hw: number; hd: number; rot: number; low?: boolean };

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
const UP = new Vector3(0, 1, 0);

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
   * higher, overhanging by `over`; its gable ends in `gable`.
   */
  roof(w: number, d: number, y: number, h: number, color: PaletteColor, over = 0.3, trim?: PaletteColor, gable: PaletteColor = 'mist'): void {
    const half = d / 2 + over;
    const slope = Math.hypot(half, h);
    const angle = Math.atan2(h, half) / DEG;
    for (const s of [1, -1]) {
      this.box([w + over * 2, 0.14, slope + 0.05], color, [0, y + h / 2, (s * half) / 2], { rot: [s * angle, 0, 0] });
    }
    this.box([w + over * 2 + 0.1, 0.16, 0.22], trim ?? color, [0, y + h + 0.04, 0]);
    // gable ends: triangular walls
    for (const sx of [1, -1]) this.gable(sx * (w / 2 - 0.06), y, d, h, gable);
  }

  /** A triangular wall in the local YZ plane at x, base at `y`, `d` wide, `h` high. */
  gable(x: number, y: number, d: number, h: number, color: PaletteColor): Mesh {
    const shape = new Shape([new Vector2(-d / 2, 0), new Vector2(d / 2, 0), new Vector2(0, h)]);
    const geo = new ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    geo.translate(0, 0, -0.06);
    return this.place(new Mesh(faceted(geo), mat(color)), [x, y, 0], { rot: [0, 90, 0] });
  }

  /**
   * A library model (or a pack's, once loaded into the library) at `at` in the current frame,
   * turned `yaw` degrees and drawn `scale` times its size, merged with the rest; it blocks its
   * footprint (a box turned with it) unless `block` is false. Returns the build (its `light`,
   * anchors, bounds at scale 1).
   */
  model(id: string, at: V3, o: ModelPlacement = {}): ModelBuild {
    const b = buildModel(id, { ...(o.params ? { params: o.params } : {}), ...(o.palette ? { palette: o.palette } : {}), ...(o.seed !== undefined ? { seed: o.seed } : {}) });
    const k = o.scale ?? 1;
    b.object.position.set(...at);
    b.object.rotation.y = (o.yaw ?? 0) * DEG;
    b.object.scale.setScalar(k);
    if (o.cast === false) b.object.traverse((m) => (m.castShadow = false));
    this.top.add(b.object);
    this.statics.push(b.object); // a Group: build() merges its meshes and leaves their (shared) geometry alone
    if (o.block !== false) {
      const { min, max } = b.bounds;
      const centre = new Vector3(((min[0] + max[0]) / 2) * k, 0, ((min[2] + max[2]) / 2) * k).applyAxisAngle(UP, b.object.rotation.y).add(new Vector3(...at));
      const p = this.world([centre.x, 0, centre.z]);
      this.blockers.push({ kind: 'box', x: p.x, z: p.z, hw: ((max[0] - min[0]) / 2) * k, hd: ((max[2] - min[2]) / 2) * k, rot: this.worldYaw() * DEG + b.object.rotation.y });
    }
    return b;
  }

  /** A flat polygon on the ground: `points` are (x, z) in the current frame, its top at `y`, `holes` cut out of it. */
  slab(points: readonly (readonly [number, number])[], color: PaletteColor, y: number, o: PrimOptions & { holes?: readonly (readonly (readonly [number, number])[])[] } = {}): Mesh {
    const shape = new Shape(points.map(([x, z]) => new Vector2(x, -z)));
    for (const h of o.holes ?? []) shape.holes.push(new Path(h.map(([x, z]) => new Vector2(x, -z))));
    const geo = new ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return this.place(new Mesh(geo, mat(color)), [0, y, 0], { cast: false, ...o });
  }

  blockCircle(x: number, z: number, r: number): void {
    const p = this.world([x, 0, z]);
    this.blockers.push({ kind: 'circle', x: p.x, z: p.z, r });
  }

  /** A box blocker in the current frame's local coordinates (`low`: see `Blocker`). */
  blockBox(x: number, z: number, w: number, d: number, low = false): void {
    const p = this.world([x, 0, z]);
    this.blockers.push({ kind: 'box', x: p.x, z: p.z, hw: w / 2, hd: d / 2, rot: this.worldYaw() * DEG, ...(low ? { low } : {}) });
  }

  /**
   * Close the ground the camera can't see behind something standing on the local box (x, z, w,
   * d) that hides the hero up to `h` m tall at its back edge (a house's eaves, a tower's top): he
   * would be lost there. `view` is the camera's yaw (its screen axes, as `frame(..., yaw)` turns
   * them: local X right, local Z toward the camera) and pitch, in degrees. He is hidden where a ray
   * from his head (1.6 m) toward the camera runs into it, so the ground is closed from the box's
   * back edge (as the screen sees it) back by (h - 1.6) / tan(pitch), in screen-aligned slices
   * half a metre wide that follow that edge.
   */
  closeBehind(x: number, z: number, w: number, d: number, h: number, view: { readonly yaw: number; readonly pitch: number }): void {
    const depth = Math.max(0, h - 1.6) / Math.tan(view.pitch * DEG);
    if (depth <= 0) return;
    const yaw = view.yaw * DEG;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // world (x, z) → screen (right, up the screen = away from the camera), and back
    const toScreen = (p: Vector3): [number, number] => [p.x * c - p.z * s, -p.x * s - p.z * c];
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => toScreen(this.world([x + (a! * w) / 2, 0, z + (b! * d) / 2])));
    /** The footprint's back edge (highest screen y) at screen x `sx`. */
    const back = (sx: number): number => {
      let top = -Infinity;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = corners[i]!;
        const [bx, by] = corners[(i + 1) % 4]!;
        if (sx < Math.min(ax, bx) - 1e-9 || sx > Math.max(ax, bx) + 1e-9) continue;
        top = Math.max(top, Math.abs(bx - ax) < 1e-9 ? Math.max(ay, by) : ay + ((by - ay) * (sx - ax)) / (bx - ax));
      }
      return top;
    };
    const sx0 = Math.min(...corners.map((p) => p[0]));
    const sx1 = Math.max(...corners.map((p) => p[0]));
    const n = Math.max(1, Math.ceil((sx1 - sx0) / 0.5));
    for (let i = 0; i < n; i++) {
      const a = sx0 + ((sx1 - sx0) * i) / n;
      const b = sx0 + ((sx1 - sx0) * (i + 1)) / n;
      const inside = corners.filter((p) => p[0] > a && p[0] < b).map((p) => p[1]);
      const lo = Math.min(back(a), back(b)) - 0.3; // overlaps the footprint: no seam to squeeze through
      const hi = Math.max(back(a), back(b), ...inside) + depth;
      const cx = (a + b) / 2;
      const cy = (lo + hi) / 2;
      this.blockers.push({ kind: 'box', x: cx * c - cy * s, z: -cx * s - cy * c, hw: (b - a) / 2, hd: (hi - lo) / 2, rot: yaw });
    }
  }

  /**
   * Merge every static primitive (one mesh per material) and return the stage root. With `cell`,
   * statics merge per cell it names for the centre of their bounds on the ground (x, z), and
   * anything wider than `wide` m goes in a set of its own: a place bigger than the screen then
   * draws only the cells in view (frustum culling works per merged mesh).
   */
  build(cell?: (x: number, z: number) => string, wide = 12): Group {
    const root = new Group();
    root.name = 'kit';
    this.stack[0]!.updateWorldMatrix(true, true);
    if (cell) {
      const cells = new Map<string, Object3D[]>();
      const box = new Box3();
      const c = new Vector3();
      for (const s of this.statics) {
        box.setFromObject(s);
        box.getCenter(c);
        const key = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) > wide ? 'wide' : cell(c.x, c.z);
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(s);
      }
      for (const [key, list] of cells) {
        for (const m of mergeStaticMeshes(list)) {
          m.name = `${m.name}@${key}`;
          root.add(m);
        }
      }
    } else root.add(...mergeStaticMeshes(this.statics));
    for (const s of this.statics) (s as Mesh).geometry?.dispose();
    root.add(this.dynamics);
    return root;
  }
}

/** Push a circle (p.x, p.z, radius) out of blockers, in place. */
/** A circle of `radius` at (x, z) overlaps the blocker (by more than a millimetre). */
export function overlapsBlocker(x: number, z: number, radius: number, b: Blocker): boolean {
  const dx = x - b.x;
  const dz = z - b.z;
  const r = radius - 1e-3;
  if (b.kind === 'circle') return dx * dx + dz * dz < (b.r + r) ** 2;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const ox = Math.max(0, Math.abs(dx * c - dz * s) - b.hw);
  const oz = Math.max(0, Math.abs(dx * s + dz * c) - b.hd);
  return ox * ox + oz * oz < r * r;
}

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
