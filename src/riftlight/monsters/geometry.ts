import {
  BoxGeometry,
  type BufferAttribute,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  type Material,
  MeshBasicNodeMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../../engine/render/toon';

/**
 * Shared low-poly geometry and materials for monsters. Geometry is built once per key (unit
 * sized; meshes scale it) and marked `userData.shared`, so a hundred goblins share a few
 * dozen buffers and level unloads keep them. Materials are the engine's cached toon
 * materials (one per colour) plus unlit glow materials for eyes, cores and crystals.
 */
const geometries = new Map<string, BufferGeometry>();

export function cachedGeometry(key: string, make: () => BufferGeometry, mirror = false): BufferGeometry {
  const k = mirror ? `${key}|m` : key;
  let g = geometries.get(k);
  if (!g) {
    g = mirror ? mirrorGeometry(cachedGeometry(key, make)) : make();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.shared = true;
    geometries.set(k, g);
  }
  return g;
}

/** How many distinct geometries are cached (inspectors, leak checks). */
export function geometryCount(): number {
  return geometries.size;
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

const glowMaterials = new Map<number, MeshBasicNodeMaterial>();

/** Toon material for a colour (shared, cached by the engine). */
export function bodyMaterial(hex: number): Material {
  return toonMaterial(hex);
}

/** Unlit glow material (eyes, cores, crystals, auras): reads as emissive in the toon look. */
export function glowMaterial(hex: number): Material {
  let m = glowMaterials.get(hex);
  if (!m) {
    m = new MeshBasicNodeMaterial({ color: hex });
    m.name = `glow-${hex.toString(16).padStart(6, '0')}`;
    m.userData.shared = true;
    glowMaterials.set(hex, m);
    const cached = m;
    m.addEventListener('dispose', () => {
      if (glowMaterials.get(hex) === cached) glowMaterials.delete(hex);
    });
  }
  return m;
}

// ---------------------------------------------------------------- unit shapes

/** 1×1×1 box centred on the origin. */
export const unitBox = () => new BoxGeometry(1, 1, 1);
/** Sphere of diameter 1 (scale per axis for ellipsoids). */
export const unitSphere = () => new SphereGeometry(0.5, 8, 6);
/** Cylinder of diameter 1, height 1, along Y. */
export const unitCyl = () => new CylinderGeometry(0.5, 0.5, 1, 7);
/** Cone of diameter 1, height 1, tip at +Y. */
export const unitCone = () => new ConeGeometry(0.5, 1, 6);
/** Rounded lump of diameter 1. */
export const unitBlob = () => new IcosahedronGeometry(0.5, 1);
/** Flat disc of diameter 1, height 1 (soles of blobs). */
export const unitDisc = () => new CylinderGeometry(0.5, 0.5, 1, 10);
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
    const g = new CylinderGeometry(Math.max(rb, 0.001), ra, seg * 1.08, sides);
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

