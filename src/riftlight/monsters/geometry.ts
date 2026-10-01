import {
  BoxGeometry,
  type BufferAttribute,
  Color,
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
import { abs, atan, float, floor, fract, fwidth, length, mod, positionGeometry, screenCoordinate, select, sin, time, uniform } from 'three/tsl';
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

/**
 * Toon material for a colour (shared, cached by the engine). Monsters pass their palette's
 * glow colour as `rim`: a hard rim light that keeps their silhouette readable on dark floors,
 * and every body material can pixel-dissolve (`BodyFx.dissolve`) when the corpse goes.
 */
export function bodyMaterial(hex: number, rim?: number): Material {
  return rim === undefined ? toonMaterial(hex) : toonMaterial(hex, { rim: rimTint(rim), dissolve: true });
}

/** The rim colour: the glow hue lifted toward white, so it reads as light rather than paint. */
function rimTint(hex: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const lift = (c: number) => Math.round((c + (255 - c) * 0.35) * 0.8);
  return (lift(r) << 16) | (lift(g) << 8) | lift(b);
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

const auraMaterials = new Map<number, MeshBasicNodeMaterial>();

/**
 * The elite / boss aura on the floor (TSL, shared per colour): a 1-pixel rim of dashes that
 * turn slowly around the body, a thin inner ring, and a sparse stipple between them that
 * breathes. Pixel-crisp at any size (`fwidth` of the ring's own radius), transparent and
 * depth-write-free, so it lies under the body and its shadow.
 */
export function auraMaterial(hex: number): Material {
  let m = auraMaterials.get(hex);
  if (m) return m;
  m = new MeshBasicNodeMaterial({ color: hex, transparent: true, depthWrite: false });
  m.name = `aura-${hex.toString(16).padStart(6, '0')}`;
  m.userData.shared = true;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  const p = positionGeometry;
  const r = length(p.xz);
  const px = fwidth(r);
  const turn = atan(p.z, p.x).div(Math.PI * 2).add(0.5); // 0..1 around
  const dash = fract(turn.mul(14).add(time.mul(0.35))).lessThan(0.55);
  const rim = r.greaterThan(float(1).sub(px.mul(2))).and(dash);
  const inner = abs(r.sub(0.74)).lessThan(px.mul(0.75));
  const sp = floor(screenCoordinate.xy);
  const breathe = sin(time.mul(3)).mul(0.5).add(0.5);
  const dots = mod(sp.x.add(sp.y.mul(2)), 4).lessThan(0.5).and(mod(sp.y, 2).lessThan(0.5)).and(r.greaterThan(0.74)).and(r.lessThan(0.97));
  const c = uniform(new Color(hex));
  const bright = uniform(new Color(hex).lerp(new Color(0xffffff), 0.45));
  m.colorNode = select(rim, bright, c);
  m.opacityNode = select(rim, float(1), select(inner, float(0.8), select(dots, breathe.mul(0.35).add(0.2), float(0))));
  auraMaterials.set(hex, m);
  const cached = m;
  m.addEventListener('dispose', () => {
    if (auraMaterials.get(hex) === cached) auraMaterials.delete(hex);
  });
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

