import {
  BoxGeometry,
  type BufferAttribute,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly unit geometry for the engine's procedural bodies (Riftlight's monsters build on it):
 * unit shapes that meshes scale, limbs, horns, lathes and extrusions. Each call returns a fresh
 * geometry; callers cache it (the monsters' `cachedGeometry`). ModelDefs have their own
 * box-filling primitives (./prims.ts).
 */

// ---------------------------------------------------------------- unit shapes

/** 1×1×1 box centred on the origin. */
export const unitBox = () => new BoxGeometry(1, 1, 1);
/** Sphere of diameter 1 (scale per axis for ellipsoids). */
export const unitSphere = () => new SphereGeometry(0.5, 8, 6);
/** A low-poly sphere for small details (joints, knuckles, toes, eyes): a few pixels on screen. */
export const unitSphereLo = () => new SphereGeometry(0.5, 6, 4);
/** Detail spheres smaller than this (m, at genome scale 1) use `unitSphereLo`. */
export const SMALL_SPHERE = 0.16;
/** Cylinder of diameter 1, height 1, along Y. */
export const unitCyl = () => new CylinderGeometry(0.5, 0.5, 1, 7);
/** A small four-sided spike (teeth, toe claws): base diameter 1, height 1, tip at +Y, no base. */
export const unitTooth = () => new ConeGeometry(0.5, 1, 4, 1, true);
/** Cone of diameter 1, height 1, tip at +Y. */
export const unitCone = () => new ConeGeometry(0.5, 1, 6);
/** Rounded lump of diameter 1. */
export const unitBlob = () => new IcosahedronGeometry(0.5, 1);
/** Flat disc of diameter 1, height 1 (soles of blobs). */
export const unitDisc = () => new CylinderGeometry(0.5, 0.5, 1, 10);
/**
 * A limb segment of height 1 along Y (−0.5..0.5) with rounded ends: top radius 0.5, bottom
 * radius 0.5 × `ratio`, and a muscle `bulge` (fraction of the radius) a third of the way
 * down. Thighs, upper arms, necks and tails read as flesh instead of pipes.
 */
export const limbGeometry = (ratio: number, bulge: number) => () => {
  const rt = 0.5;
  const rb = 0.5 * ratio;
  const r = (t: number) => rb + (rt - rb) * t + bulge * 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (0.6 + 0.4 * t);
  // the ends close on a pinhole, not a pole (a zero radius makes zero-area triangles)
  const pts: [number, number][] = [
    [rb * 0.06, -0.5],
    [rb * 0.78, -0.46],
  ];
  for (const t of [0, 0.35, 0.7, 1]) pts.push([r(t), -0.38 + t * 0.76]);
  pts.push([rt * 0.78, 0.46], [rt * 0.06, 0.5]);
  return lathe(pts, 6);
};

/** Tapered cylinder: top radius = `ratio` × bottom radius. */
export const taperCyl = (ratio: number) => () => new CylinderGeometry(0.5 * ratio, 0.5, 1, 6);

/**
 * A horn / claw / tail spike: tapered segments along an arc, base at the origin pointing
 * +Y, curling towards +Z by `curl` degrees in total (negative curls back).
 */
export function arcHorn(length: number, r0: number, r1: number, curl: number, segments = 4, sides = 5): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const seg = length / segments;
  let x = 0;
  let y = 0;
  let angle = 0;
  const step = (curl * Math.PI) / 180 / segments;
  for (let i = 0; i < segments; i++) {
    const ra = r0 + ((r1 - r0) * i) / segments;
    const rb = r0 + ((r1 - r0) * (i + 1)) / segments;
    // open segments (only the base is capped): a horn is a tube, its inner caps never show
    const g = new CylinderGeometry(Math.max(rb, 0.001), ra, seg * 1.08, sides, 1, i > 0);
    g.translate(0, seg / 2, 0);
    g.rotateX(angle + step / 2);
    g.translate(0, y, x);
    parts.push(g);
    y += Math.cos(angle + step / 2) * seg;
    x += Math.sin(angle + step / 2) * seg;
    angle += step;
  }
  return merged(parts);
}

/** Lathe profile [radius, height][] around Y. */
export function lathe(profile: readonly (readonly [number, number])[], sides = 8): BufferGeometry {
  return new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), sides);
}

/** Extruded flat shape (x, y points), `depth` thick, centred on z. */
export function extrude(points: readonly (readonly [number, number])[], depth: number): BufferGeometry {
  const s = new Shape(points.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

export function torus(radius: number, tube: number, sides = 10, arc = Math.PI * 2): BufferGeometry {
  return new TorusGeometry(radius, tube, 4, sides, arc);
}

/** Merge geometries (all made non-indexed so mixed inputs merge cleanly). */
export function merged(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    return g;
  });
  const g = mergeGeometries(flat, false);
  if (!g) throw new Error('merged: incompatible geometries');
  g.computeVertexNormals();
  return g;
}

/** Translate/rotate/scale a fresh geometry and return it (for building merged shapes). */
export function placed(g: BufferGeometry, at: readonly [number, number, number] = [0, 0, 0], rot: readonly [number, number, number] = [0, 0, 0], scale: number | readonly [number, number, number] = 1): BufferGeometry {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  g.scale(s[0]!, s[1]!, s[2]!);
  const d = Math.PI / 180;
  if (rot[0]) g.rotateX(rot[0] * d);
  if (rot[1]) g.rotateY(rot[1] * d);
  if (rot[2]) g.rotateZ(rot[2] * d);
  g.translate(at[0], at[1], at[2]);
  return g;
}

/** A copy mirrored across X (winding flipped so faces stay outward). */
export function mirrorGeometry(src: BufferGeometry): BufferGeometry {
  const g = src.clone();
  g.scale(-1, 1, 1);
  const index = g.getIndex();
  if (index) {
    const a = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2]!, a[i + 1]!];
    index.needsUpdate = true;
  } else {
    const pos = g.getAttribute('position');
    for (const name of Object.keys(g.attributes)) {
      const attr = g.getAttribute(name) as BufferAttribute;
      const n = attr.itemSize;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < pos.count; i += 3) {
        for (let k = 0; k < n; k++) [arr[(i + 1) * n + k], arr[(i + 2) * n + k]] = [arr[(i + 2) * n + k]!, arr[(i + 1) * n + k]!];
      }
      attr.needsUpdate = true;
    }
  }
  g.computeVertexNormals();
  return g;
}
