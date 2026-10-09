/**
 * A meadow: thousands of grass blades in one instanced draw, bent by the vertex shader. Wind
 * leans every blade and sends gusts across the field as visible waves; up to four pushers
 * (the hero, a ball) part and flatten the blades around them. Blades are two crossed
 * triangles (they read from any side), toon-lit as if they were the ground (an up normal), so
 * they take the same light bands and shadows as the floor they stand on.
 *
 *   const grass = new GrassField({ area: [12, 8], at: [0, 0, 0], count: 6000 });
 *   scene.add(grass);
 *   // per frame: grass.update(t); grass.push(0, hero.position, 0.9)
 *   grass.wind.set(2.5, 0.5);       // m/s-ish: direction and strength
 */
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Vector2, type Vector3Like } from 'three/webgpu';
import { attribute, color, dot, float, floor, length, max, mix, normalize, positionGeometry, positionLocal, sin, transformNormalToView, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { seeded } from '../physics/fracture';
import { toonMaterial } from './toon';

export const MAX_PUSHERS = 4;

export interface GrassOptions {
  /** Width (x) and depth (z) of the patch, m. */
  area: readonly [number, number];
  /** Centre of the patch on the ground. */
  at: readonly [number, number, number];
  count: number;
  /** Blade heights (m): shortest and tallest. Default [0.25, 0.55]. */
  height?: readonly [number, number];
  /** Blade width at the root (m). Default 0.07. */
  width?: number;
  /** Colours (hex): roots and tips. */
  base?: number;
  tip?: number;
  /** Where blades grow (world x, z); default everywhere in the patch. */
  mask?: (x: number, z: number) => boolean;
  /** Ground height under a blade (default: the patch's y). */
  ground?: (x: number, z: number) => number;
  seed?: number;
}

/** Two crossed triangles, root at y = 0, tip at y = 1. */
function bladeGeometry(width: number): BufferGeometry {
  const w = width / 2;
  const p = new Float32Array([-w, 0, 0, w, 0, 0, 0, 1, 0, 0, 0, -w, 0, 0, w, 0, 1, 0]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
export class GrassField extends InstancedMesh {
  /** Wind along x and z (its length is the strength). */
  readonly wind = new Vector2(1.5, 0.4);
  /** How far blades lean per unit of wind (m at the tip). Default 0.12. */
  sway = 0.12;
  private readonly uTime = uniform(0) as any;
  private readonly uWind = uniform(new Vector2()) as any;
  private readonly uSway = uniform(0.12) as any;
  private readonly uPush = Array.from({ length: MAX_PUSHERS }, () => uniform(vec4(0, -1e4, 0, 0)) as any);
  /** Blades actually placed (the mask can leave fewer than `count`). */
  readonly blades: number;

  constructor(o: GrassOptions) {
    const geometry = bladeGeometry(o.width ?? 0.07);
    const material = toonMaterial(o.base ?? 0x38b764).clone();
    material.userData.shared = false;
    super(geometry, material, o.count);
    this.frustumCulled = false;
    this.receiveShadow = true;
    this.castShadow = false;
    // place the blades: position and height in the instance matrix, the root (and a phase) as an attribute
    const rand = seeded(o.seed ?? 3);
    const [w, d] = o.area;
    const [hmin, hmax] = o.height ?? [0.25, 0.55];
    const roots = new Float32Array(o.count * 4);
    const m = new Matrix4();
    let n = 0;
    for (let tries = 0; n < o.count && tries < o.count * 4; tries++) {
      const x = o.at[0] + (rand() - 0.5) * w;
      const z = o.at[2] + (rand() - 0.5) * d;
      if (o.mask && !o.mask(x, z)) continue;
      const y = o.ground ? o.ground(x, z) : o.at[1];
      const h = hmin + (hmax - hmin) * rand();
      m.makeScale(1, h, 1).setPosition(x, y, z);
      this.setMatrixAt(n, m);
      roots.set([x, z, rand() * Math.PI * 2, h], n * 4);
      n++;
    }
    this.count = n;
    this.blades = n;
    geometry.setAttribute('aRoot', new InstancedBufferAttribute(roots, 4));
    const root = attribute('aRoot', 'vec4') as any;
    // the blade's own 0..1 height (positionLocal is already placed by the instance matrix here)
    const y01 = positionGeometry.y as any;
    const k = y01.mul(y01) as any; // 0 at the root, 1 at the tip
    const windDir = normalize(this.uWind.add(vec2(1e-4, 0))) as any;
    const strength = length(this.uWind) as any;
    // a steady lean, a flutter per blade, and gusts that roll across the field along the wind
    const gust = sin(dot(root.xy, windDir).mul(0.45).sub(this.uTime.mul(2.2))).mul(0.5).add(0.5) as any;
    const flutter = sin(this.uTime.mul(5.3).add(root.z)).mul(0.15) as any;
    const lean = strength.mul(this.uSway).mul(gust.mul(0.8).add(0.4).add(flutter)) as any;
    let off: any = vec3(windDir.x.mul(lean), lean.mul(-0.25), windDir.y.mul(lean));
    for (const P of this.uPush) {
      const dxz = root.xy.sub(P.xz) as any;
      const dist = max(length(dxz), 1e-3) as any;
      const push = max(float(1).sub(dist.div(max(P.w, 1e-3))), 0) as any;
      const dir = dxz.div(dist) as any;
      off = off.add(vec3(dir.x.mul(push).mul(0.5), push.mul(-0.55), dir.y.mul(push).mul(0.5)));
    }
    // after instancing the position is in metres: the offset is too, full at the tip
    material.positionNode = positionLocal.add(off.mul(k));
    material.normalNode = transformNormalToView(vec3(0, 1, 0));
    const base = color(o.base ?? 0x38b764);
    const tip = color(o.tip ?? 0xa7f070);
    material.colorNode = mix(base, tip, floor(y01.mul(3)).div(2).min(1));
  }

  /** Pusher `i` (0..3): blades within `radius` of `at` part and flatten (radius 0: none). */
  push(i: number, at: Vector3Like | null, radius = 0.8): void {
    const u = this.uPush[i];
    if (!u) return;
    if (!at || radius <= 0) u.value.set(0, -1e4, 0, 0);
    else u.value.set(at.x, at.y, at.z, radius);
  }

  /** Per frame (game time). */
  update(time: number): void {
    this.uTime.value = time;
    (this.uWind.value as Vector2).copy(this.wind);
    this.uSway.value = this.sway;
  }

  dispose(): this {
    this.geometry.dispose();
    (this.material as { dispose(): void }).dispose();
    return this;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

