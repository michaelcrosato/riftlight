import { type BufferGeometry, Color, type Material, MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, atan, float, floor, fract, fwidth, length, mod, positionGeometry, screenCoordinate, select, sin, time, uniform } from 'three/tsl';
import { mirrorGeometry } from '../../engine/model/geometry';
import { toonMaterial } from '../../engine/render/toon';

/**
 * Shared low-poly geometry and materials for monsters. Geometry is built once per key (unit
 * sized; meshes scale it) and marked `userData.shared`, so a hundred goblins share a few
 * dozen buffers and level unloads keep them. The unit shapes themselves (boxes, spheres,
 * limbs, horns, lathes) are the engine's (src/engine/model/geometry.ts). Materials: the
 * engine's cached toon materials (`bodyMaterial`) and the elite aura.
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
