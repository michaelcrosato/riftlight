import { BufferAttribute, BufferGeometry, Group, type Material, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { mergeStaticMeshes } from '../../../engine/render/merge';
import { toonMaterial } from '../../../engine/render/toon';
import { Rng } from '../../core/rng';
import type { LevelPlan } from '../plan';
import { buildProp, type PropGlow, tint } from '../themes/props';
import { FLOOR, type Layout, VOID, WALL } from './grid';

/**
 * Level geometry from a plan, built for the iso camera and pixel art:
 *
 *  - **Floors**: one quad per cell in a 2×2 flagstone pattern (two tones), with a darker
 *    trim along walls; cells at pits and voids get cliff sides (a lighter lip, then rock)
 *    that fall away into the fog.
 *  - **Walls**: only exposed faces are emitted (no hidden faces between wall cells). Back
 *    walls (floor on their camera side) are tall; front walls (between the camera and a
 *    floor) are cut low so the iso camera sees into rooms, Diablo-style. Every wall has a
 *    trim band and a cap. Ruins get broken, uneven heights. Lone wall cells become pillars.
 *  - **Props** are built by the theme's prop builders and merged with everything else by
 *    material (`mergeStaticMeshes`): a whole level is a handful of draw calls.
 *  - **Colliders**: wall and floor cells are merged into rectangles (greedy), so a level is
 *    one fixed body with a few hundred boxes, not thousands. Crumbling (dynamic) floor
 *    cells get one box each so they can be removed.
 */

const CLIFF = 7;
/** Walls facing the void outside the level stop a little below the floor (solid rock beyond). */
const FOOTING = 1;
const LIP = 0.35;
const LOW_WALL = 0.55;
const BAND = 0.16;

export interface ColliderBox {
  /** Centre and half extents (world). */
  readonly center: [number, number, number];
  readonly half: [number, number, number];
  /** Grid cell for single-cell dynamic boxes (-1 otherwise). */
  readonly cell: number;
}

export interface LevelGeometry {
  readonly root: Group;
  readonly glows: (PropGlow & { position: Vector3; kind: string })[];
  readonly colliders: { walls: ColliderBox[]; floors: ColliderBox[]; dynamic: ColliderBox[] };
  readonly drawables: number;
  readonly triangles: number;
}

/** Accumulates quads per material into one non-indexed BufferGeometry each. */
class QuadBatch {
  private readonly batches = new Map<Material, { pos: number[]; nor: number[] }>();

  quad(m: Material, a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], n: readonly number[]): void {
    let bt = this.batches.get(m);
    if (!bt) this.batches.set(m, (bt = { pos: [], nor: [] }));
    // Two triangles a-b-c, a-c-d (counter-clockwise seen from the normal side).
    for (const v of [a, b, c, a, c, d]) bt.pos.push(v[0]!, v[1]!, v[2]!);
    for (let k = 0; k < 6; k++) bt.nor.push(n[0]!, n[1]!, n[2]!);
  }

  /** Horizontal quad at height y covering [x0,x1]×[z0,z1], facing up. */
  top(m: Material, x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.quad(m, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0]);
  }

  /**
   * Vertical face of cell (x, z) on side (dx, dz) (the neighbour direction), from y0 to y1,
   * facing outward (toward the neighbour).
   */
  side(m: Material, x: number, z: number, dx: number, dz: number, y0: number, y1: number): void {
    if (y1 <= y0) return;
    if (dx === 1) this.quad(m, [x + 1, y0, z + 1], [x + 1, y0, z], [x + 1, y1, z], [x + 1, y1, z + 1], [1, 0, 0]);
    else if (dx === -1) this.quad(m, [x, y0, z], [x, y0, z + 1], [x, y1, z + 1], [x, y1, z], [-1, 0, 0]);
    else if (dz === 1) this.quad(m, [x, y0, z + 1], [x + 1, y0, z + 1], [x + 1, y1, z + 1], [x, y1, z + 1], [0, 0, 1]);
    else this.quad(m, [x + 1, y0, z], [x, y0, z], [x, y1, z], [x + 1, y1, z], [0, 0, -1]);
  }

  meshes(): Mesh[] {
    const out: Mesh[] = [];
    for (const [m, b] of this.batches) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.push(mesh);
    }
    return out;
  }
}

const hash = (x: number, z: number, s: number) => {
  let h = Math.imul(x * 374761393 + z * 668265263 + s * 2246822519, 3266489917);
  h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;
};

/** Wall height per cell: tall back walls, low front walls, broken ruins. */
export function wallHeights(layout: Layout, plan: LevelPlan, skip: Uint8Array): Float32Array {
  const W = layout.width;
  const H = layout.height;
  const h = new Float32Array(W * H);
  const tall = plan.theme.wallHeight;
  const isFloor = (x: number, z: number) => layout.cell(x, z) === FLOOR;
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (layout.cells[i] !== WALL || skip[i]) continue;
      // A floor on the far side from the camera (−x, −z): this wall hides it → cut low.
      // Two cells deep, so a thin wall between two rooms doesn't hide the far one either.
      const front = isFloor(x - 1, z) || isFloor(x, z - 1) || isFloor(x - 1, z - 1) || isFloor(x - 2, z) || isFloor(x, z - 2);
      let v = front ? LOW_WALL : tall;
      if (layout.style === 'ruins' && !front) v = Math.max(LOW_WALL + 0.2, tall * (0.45 + 0.55 * hash(x, z, 7)));
      if (layout.style === 'caves' && !front) v = tall * (0.8 + 0.35 * hash(x, z, 3));
      h[i] = v;
    }
  return h;
}

export function buildGeometry(plan: LevelPlan): LevelGeometry {
  const { layout, theme } = plan;
  const W = layout.width;
  const H = layout.height;
  const q = new QuadBatch();
  const root = new Group();
  root.name = `level:${plan.spec.name}`;

  const mat = {
    floor: toonMaterial(theme.palette.floor),
    floorAlt: toonMaterial(theme.floorAlt),
    edge: toonMaterial(tint(theme.palette.floor, -0.22)),
    lip: toonMaterial(tint(theme.palette.floor, -0.12)),
    cliff: toonMaterial(theme.cliff),
    wall: toonMaterial(theme.palette.wall),
    band: toonMaterial(tint(theme.trim, -0.15)),
    cap: toonMaterial(theme.trim),
  };

  // Cells drawn by someone else: solid mechanic elements (pylons, braziers...) and props.
  const skip = new Uint8Array(W * H);
  for (const e of plan.elements) if (e.block === 'solid') for (const c of e.cells) skip[c] = 1;
  for (const p of plan.props) if (p.blocks) skip[Math.floor(p.z) * W + Math.floor(p.x)] = 1;
  const dyn = plan.dynamicFloor;
  const heights = wallHeights(layout, plan, skip);
  const cellAt = (x: number, z: number) => layout.cell(x, z);
  const isWall = (x: number, z: number) => layout.inBounds(x, z) && layout.cells[z * W + x] === WALL && !skip[z * W + x];
  const lone = (x: number, z: number) => !isWall(x + 1, z) && !isWall(x - 1, z) && !isWall(x, z + 1) && !isWall(x, z - 1);
  const pillars: [number, number][] = [];

  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const c = layout.cells[i]!;
      const ground = c === FLOOR || skip[i] || (c === WALL && layout.style === 'bridges');
      if (c === VOID && !dyn[i]) continue;
      if (dyn[i] || ground) {
        // ---- floor top (dynamic floor: drawn by its mechanic)
        if (!dyn[i]) {
          const nearWall = DIRS.some(([dx, dz]) => isWall(x + dx, z + dz));
          const alt = (((x >> 1) + (z >> 1)) & 1) === 1;
          const flip = hash(x, z, 1) < 0.12;
          q.top(nearWall ? mat.edge : alt !== flip ? mat.floorAlt : mat.floor, x, z, x + 1, z + 1, 0);
        }
        // ---- cliffs toward the void (below a crumbling neighbour too, under its tile)
        const top = dyn[i] ? -0.4 : 0;
        for (const [dx, dz] of DIRS) {
          const n = cellAt(x + dx, z + dz);
          const nIdx = (z + dz) * W + x + dx;
          const nDyn = layout.inBounds(x + dx, z + dz) && dyn[nIdx] === 1;
          if (n === VOID && !nDyn) {
            q.side(mat.lip, x, z, dx, dz, top - LIP, top);
            q.side(mat.cliff, x, z, dx, dz, -CLIFF, top - LIP);
          } else if (nDyn && !dyn[i]) q.side(mat.cliff, x, z, dx, dz, -CLIFF, -0.4);
        }
        if (c !== WALL || skip[i]) continue;
      }
      if (c !== WALL || skip[i]) continue;
      // ---- walls
      if (lone(x, z) && layout.style !== 'town') {
        pillars.push([x, z]);
        continue;
      }
      const h = heights[i]!;
      q.top(mat.cap, x, z, x + 1, z + 1, h);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        const n = cellAt(nx, nz);
        let bottom: number;
        if (isWall(nx, nz)) {
          const hn = heights[nz * W + nx]!;
          if (hn >= h) continue;
          bottom = hn;
        } else if (n === VOID && !(layout.inBounds(nx, nz) && dyn[nz * W + nx])) bottom = -FOOTING;
        else bottom = 0;
        const bandFrom = Math.max(bottom, h - BAND);
        if (bottom < 0) {
          q.side(mat.cliff, x, z, dx, dz, bottom, Math.min(0, bandFrom));
          if (bandFrom > 0) q.side(mat.wall, x, z, dx, dz, 0, bandFrom);
        } else q.side(mat.wall, x, z, dx, dz, bottom, bandFrom);
        q.side(mat.band, x, z, dx, dz, bandFrom, h);
      }
    }
  }

  // ---- props (+ lone wall cells as pillars or rocks), merged with the level by material
  const rng = new Rng(plan.spec.seed).fork('props-build');
  const sources: Object3D[] = [];
  const glows: LevelGeometry['glows'] = [];
  const addProp = (kind: string, x: number, z: number, rot: number) => {
    const p = buildProp(kind, { theme, rng: rng.fork(`${kind}:${x}:${z}`) }, x, z, rot);
    sources.push(p.root);
    if (p.glow) {
      const pos = new Vector3(...p.glow.offset);
      p.root.localToWorld(pos);
      glows.push({ ...p.glow, position: pos, kind });
    }
  };
  for (const p of plan.props) addProp(p.kind, p.x, p.z, p.rot);
  const loneKind = layout.style === 'caves' ? 'rock' : 'pillar';
  for (const [x, z] of pillars) addProp(loneKind, x + 0.5, z + 0.5, 0);

  const meshes = [...q.meshes(), ...mergeStaticMeshes(sources)];
  let triangles = 0;
  for (const m of meshes) {
    m.name ||= 'level';
    const pos = m.geometry.getAttribute('position');
    triangles += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
  }

  return { root, glows, colliders: colliders(layout, dyn), drawables: meshes.length, triangles };
}

/** Greedy rectangles of cells matching `want` (rows first, then grow down). */
export function greedyRects(w: number, h: number, want: (i: number) => boolean): { x: number; z: number; w: number; h: number }[] {
  const used = new Uint8Array(w * h);
  const out: { x: number; z: number; w: number; h: number }[] = [];
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (used[i] || !want(i)) continue;
      let rw = 1;
      while (x + rw < w && !used[i + rw] && want(i + rw)) rw++;
      let rh = 1;
      outer: while (z + rh < h) {
        for (let k = 0; k < rw; k++) {
          const j = (z + rh) * w + x + k;
          if (used[j] || !want(j)) break outer;
        }
        rh++;
      }
      for (let dz = 0; dz < rh; dz++) for (let k = 0; k < rw; k++) used[(z + dz) * w + x + k] = 1;
      out.push({ x, z, w: rw, h: rh });
    }
  return out;
}

function colliders(layout: Layout, dyn: Uint8Array): LevelGeometry['colliders'] {
  const W = layout.width;
  const H = layout.height;
  const walls = greedyRects(W, H, (i) => layout.cells[i] === WALL).map((r) => ({
    center: [r.x + r.w / 2, 1.25, r.z + r.h / 2] as [number, number, number],
    half: [r.w / 2, 2.25, r.h / 2] as [number, number, number],
    cell: -1,
  }));
  const floors = greedyRects(W, H, (i) => layout.cells[i] === FLOOR && !dyn[i]).map((r) => ({
    center: [r.x + r.w / 2, -0.5, r.z + r.h / 2] as [number, number, number],
    half: [r.w / 2, 0.5, r.h / 2] as [number, number, number],
    cell: -1,
  }));
  const dynamic: ColliderBox[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!dyn[i]) continue;
    const x = i % W;
    const z = (i - x) / W;
    dynamic.push({ center: [x + 0.5, -0.5, z + 0.5], half: [0.5, 0.5, 0.5], cell: i });
  }
  return { walls, floors, dynamic };
}
