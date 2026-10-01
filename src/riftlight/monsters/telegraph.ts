import { CircleGeometry, Group, type Material, Mesh, MeshBasicNodeMaterial, PlaneGeometry, RingGeometry } from 'three/webgpu';
import type { TelegraphSpec } from './brains/skills';
import { cachedGeometry } from './geometry';

/**
 * Telegraph decals for big attacks: a flat outline on the floor showing exactly where the
 * hit lands, filled from the centre as the wind-up runs out (fill reaches the edge on the
 * hit frame). Circle (slams, novas, leap landings), cone (breaths, swipes) and line
 * (charges, snipes). Faces +Z like the monster; place it with `object.position` /
 * `object.rotation.y`.
 */
export interface Telegraph {
  readonly object: Group;
  /** 0 = just started, 1 = the hit lands now. */
  update(progress: number): void;
  dispose(): void;
}

const materials = new Map<string, MeshBasicNodeMaterial>();
function decalMaterial(hex: number, opacity: number): Material {
  const key = `${hex}:${opacity}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshBasicNodeMaterial({ color: hex, transparent: true, opacity, depthWrite: false });
    m.name = `telegraph-${hex.toString(16)}-${opacity}`;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.userData.shared = true;
    materials.set(key, m);
  }
  return m;
}

export function createTelegraph(spec: TelegraphSpec, color = 0xef7d57, scale = 1): Telegraph {
  const object = new Group();
  object.name = `Telegraph:${spec.shape}`;
  const size = spec.size * scale;
  let edge: Mesh;
  let fill: Mesh;
  if (spec.shape === 'circle') {
    edge = new Mesh(cachedGeometry('t:ring', () => new RingGeometry(0.9, 1, 32).rotateX(-Math.PI / 2)), decalMaterial(color, 0.85));
    fill = new Mesh(cachedGeometry('t:disc', () => new CircleGeometry(1, 32).rotateX(-Math.PI / 2)), decalMaterial(color, 0.3));
    edge.scale.setScalar(size);
  } else if (spec.shape === 'cone') {
    const arc = ((spec.width ?? 90) * Math.PI) / 180;
    const key = `t:cone:${Math.round(spec.width ?? 90)}`;
    const make = (inner: number) => () => new RingGeometry(inner, 1, 16, 1, Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2);
    edge = new Mesh(cachedGeometry(`${key}:edge`, make(0.92)), decalMaterial(color, 0.85));
    fill = new Mesh(cachedGeometry(`${key}:fill`, make(0.001)), decalMaterial(color, 0.3));
    edge.scale.setScalar(size);
  } else {
    const w = spec.width ?? 1;
    const plane = () => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    edge = new Mesh(cachedGeometry('t:line', plane), decalMaterial(color, 0.25));
    fill = new Mesh(cachedGeometry('t:line', plane), decalMaterial(color, 0.55));
    edge.scale.set(w, 1, size);
    fill.userData.line = [w, size];
  }
  edge.position.y = 0.02;
  fill.position.y = 0.025;
  edge.renderOrder = 2;
  fill.renderOrder = 3;
  object.add(edge, fill);
  const update = (p: number) => {
    const t = Math.min(1, Math.max(0.02, p));
    if (fill.userData.line) {
      const [w, l] = fill.userData.line as [number, number];
      fill.scale.set(w, 1, l * t);
    } else fill.scale.setScalar(size * t);
  };
  update(0);
  return { object, update, dispose: () => object.removeFromParent() };
}
