/**
 * Things that sway in the wind: a copy of a mesh's material whose vertex shader leans
 * everything above a height along the wind, more the higher it is (squared: a trunk stays
 * put, the crown moves), with a slow sway, a faster flutter and its own phase. One shared
 * `WindUniforms` drives every swaying thing in a level, so a gust moves them all together.
 *
 *   const wind = new WindUniforms();
 *   swayObject(treeModel, wind, { height: 3, amount: 0.25, phase: 1.7 });
 *   // per frame: wind.update(time, [2, 0.5])
 */
import type { Material, Mesh, Object3D } from 'three/webgpu';
import { Vector2 } from 'three/webgpu';
import { float, max, positionGeometry, positionLocal, sin, uniform, vec3 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
export class WindUniforms {
  readonly time = uniform(0) as any;
  readonly wind = uniform(new Vector2()) as any;
  /** Per frame (game time); `wind` along x and z (its length is the strength). */
  update(time: number, wind: Vector2 | readonly [number, number]): void {
    this.time.value = time;
    if (wind instanceof Vector2) (this.wind.value as Vector2).copy(wind);
    else (this.wind.value as Vector2).set(wind[0], wind[1]);
  }
}

export interface SwayOptions {
  /** Height (in the mesh's own units) of its top: the lean is 0 at `base` and full there. */
  height: number;
  /** Where the lean starts (the trunk below stays still). Default 0. */
  base?: number;
  /** Lean at the top per unit of wind. Default 0.15. */
  amount?: number;
  /** Its own phase (radians): neighbours don't move in lockstep. */
  phase?: number;
}

/**
 * A room-owned copy of `material` that sways. For ordinary meshes: heights are in the mesh's
 * own space (`positionGeometry`), measured from its origin (an instanced mesh would need its
 * own per-instance base).
 */
export function swayMaterial(material: Material, wind: WindUniforms, o: SwayOptions): Material {
  const m = material.clone() as Material & { positionNode: unknown };
  m.userData.shared = false;
  const base = o.base ?? 0;
  const k = max(positionGeometry.y.sub(base), 0).div(o.height - base) as any;
  const t = wind.time.add(o.phase ?? 0);
  const sway = sin(t.mul(1.3)).mul(0.6).add(sin(t.mul(3.7)).mul(0.25)).add(0.55) as any;
  const lean = k.mul(k).mul(o.amount ?? 0.15).mul(sway) as any;
  m.positionNode = positionLocal.add(vec3(wind.wind.x.mul(lean), float(0), wind.wind.y.mul(lean)));
  return m;
}

/** Make every mesh under `root` sway (its materials replaced by swaying copies). */
export function swayObject(root: Object3D, wind: WindUniforms, o: SwayOptions): void {
  const done = new Map<Material, Material>();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const swap = (mat: Material) => {
      let s = done.get(mat);
      if (!s) {
        s = swayMaterial(mat, wind, o);
        done.set(mat, s);
      }
      return s;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
