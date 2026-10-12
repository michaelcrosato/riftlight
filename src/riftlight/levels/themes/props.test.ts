import { type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { expandModel, MODEL_LIBRARY } from '../../../engine/model';
import { Rng } from '../../core/rng';
import { buildProp, fireMeshes, PROPS } from './props';
import { THEMES } from './themes';

type V3 = [number, number, number];

/** World positions of the meshes' vertices, relative to the cell centre (x, z) the prop stands on. */
function verts(meshes: readonly Mesh[], x: number, z: number): V3[] {
  const out: V3[] = [];
  const v = new Vector3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      out.push([v.x - x, v.y, v.z - z]);
    }
  }
  return out;
}

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};

const centroid = (vs: readonly V3[]): V3 => vs.reduce<V3>((c, v) => [c[0] + v[0] / vs.length, c[1] + v[1] / vs.length, c[2] + v[2] / vs.length], [0, 0, 0]);

/** The largest gap between two vertex lists once each is moved to its centroid (the same shape, facing the same way). */
function shapeGap(a: readonly V3[], b: readonly V3[]): number {
  if (a.length !== b.length) return Infinity;
  const ca = centroid(a);
  const cb = centroid(b);
  let gap = 0;
  for (let i = 0; i < a.length; i++) for (let k = 0; k < 3; k++) gap = Math.max(gap, Math.abs(a[i]![k]! - ca[k]! - (b[i]![k]! - cb[k]!)));
  return gap;
}

const theme = THEMES.get('ember-forge');
const ROTS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

describe('props', () => {
  it.each(['brazier', 'torch', 'candles'])('%s: its fire shows the camera the same faces however the prop is turned', (id) => {
    const fire = (rot: number) => verts(fireMeshes(buildProp(id, { theme, rng: new Rng(42).fork(id) }, 3.5, 7.5, rot).root), 3.5, 7.5);
    const v0 = fire(0);
    expect(v0.length, 'fire meshes').toBeGreaterThan(0);
    for (const rot of ROTS.slice(1)) expect(shapeGap(fire(rot), v0), `turned ${((rot * 180) / Math.PI).toFixed(0)}°`).toBeLessThan(1e-5);
  });

  it("every theme's brazier has a fire to put out: its flame, core and heart meshes (Embers hides them)", () => {
    for (const t of THEMES.all()) {
      const names = fireMeshes(buildProp('brazier', { theme: t, rng: new Rng(1) }, 0, 0).root).map((m) => m.name);
      expect(names.sort(), t.id).toEqual(['brazier:core', 'brazier:flame', 'brazier:heart:glow']);
    }
  });

  it('the wall torch hangs on the wall behind its cell (−z at rot 0, −x at rot π/2), its flame and light with it', () => {
    for (const [rot, axis] of [
      [0, 2],
      [Math.PI / 2, 0],
    ] as const) {
      const p = buildProp('torch', { theme, rng: new Rng(1) }, 0, 0, rot);
      const flame = centroid(verts(fireMeshes(p.root), 0, 0));
      const light = p.root.localToWorld(new Vector3(...p.glow!.offset));
      expect(flame[axis], `flame at rot ${rot}`).toBeLessThan(0);
      expect(light.getComponent(axis), `light at rot ${rot}`).toBeLessThan(0);
      expect(Math.abs(light.getComponent(2 - axis)), `light centred along its wall at rot ${rot}`).toBeLessThan(0.05);
    }
  });

  it("the torch's light reaches as far as the theme's torch", () => {
    for (const t of THEMES.all()) expect(buildProp('torch', { theme: t, rng: new Rng(1) }, 0, 0).glow!.radius, t.id).toBe(t.torch.radius);
  });

  it('themes list only props that exist; each prop names a library model and binds slots and params it has', () => {
    for (const t of THEMES.all()) for (const id of t.props) expect(PROPS.has(id), `${t.id} lists '${id}'`).toBe(true);
    for (const def of PROPS.all()) {
      expect(MODEL_LIBRARY.has(def.model), `${def.id}: model '${def.model}'`).toBe(true);
      const params = Object.keys(MODEL_LIBRARY.get(def.model).params ?? {});
      if (def.flame && def.flame !== 'fixed') expect(params, `${def.id}: flame param`).toContain(def.flame);
      for (const t of THEMES.all()) {
        const b = def.bind?.(t) ?? {};
        const slots = Object.keys(expandModel(def.model, b.params ? { params: b.params } : {}).palette);
        for (const k of Object.keys(b.palette ?? {})) expect(slots, `${def.id} in ${t.id}: slot '${k}'`).toContain(k);
        for (const k of Object.keys(b.params ?? {})) expect(params, `${def.id} in ${t.id}: param '${k}'`).toContain(k);
      }
    }
  });

  it('a blocking prop keeps to its one cell below head height: nothing under 1.8 m reaches past 0.75 m from its centre', () => {
    // actors collide with the blocked cell only (0.5 m from its centre); a canopy may spread above them
    for (const def of PROPS.all().filter((d) => d.blocks)) {
      const seen = new Set<string>();
      for (const t of THEMES.all()) {
        const b = def.bind?.(t) ?? {};
        const key = JSON.stringify([b.params, b.scale, b.at]); // colours don't change the shape
        if (seen.has(key)) continue;
        seen.add(key);
        let reach = 0;
        for (let s = 0; s < 16; s++) {
          const p = buildProp(def.id, { theme: t, rng: new Rng(s).fork(def.id) }, 0, 0, s * 0.7);
          for (const [x, y, z] of verts(meshesOf(p.root), 0, 0)) if (y > 0.05 && y < 1.8) reach = Math.max(reach, Math.hypot(x, z));
        }
        expect(reach, `${def.id} in ${t.id}`).toBeLessThanOrEqual(0.75);
      }
    }
  });
});
