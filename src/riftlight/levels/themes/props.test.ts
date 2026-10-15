import { type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { expandModel, MODEL_LIBRARY } from '../../../engine/model';
import { Rng } from '../../core/rng';
import { loadPacksSync } from '../../nodePacks';
import { buildProp, fireMeshes, fitSlots, propModels, PROPS } from './props';
import { THEMES } from './themes';

// the props' variants are pack models (riftlight/packs.ts), in the library as the game has them
loadPacksSync();

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

/**
 * How far from (0, 0) the meshes' surface reaches between heights `lo` and `hi`: each triangle cut
 * to that band (its corners inside it and where its edges cross `lo` and `hi`), so a low-poly
 * model whose corners all sit above and below the band still counts where its sides pass through.
 */
function bandReach(meshes: readonly Mesh[], lo: number, hi: number): number {
  let reach = 0;
  const tri = [new Vector3(), new Vector3(), new Vector3()];
  const at = (v: Vector3) => (reach = Math.max(reach, Math.hypot(v.x, v.z)));
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const p = m.geometry.getAttribute('position');
    const index = m.geometry.index;
    const n = index ? index.count : p.count;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) tri[k]!.fromBufferAttribute(p, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
      for (let k = 0; k < 3; k++) {
        const a = tri[k]!;
        const b = tri[(k + 1) % 3]!;
        if (a.y >= lo && a.y <= hi) at(a);
        for (const y of [lo, hi]) if ((a.y - y) * (b.y - y) < 0) at(a.clone().lerp(b, (y - a.y) / (b.y - a.y)));
      }
    }
  }
  return reach;
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
      // its variants: pack models that exist, for designed themes, never on a prop whose fire faces the camera
      if (def.variants?.length) expect(def.flame, `${def.id}: a flame prop with variants`).toBeUndefined();
      for (const v of def.variants ?? []) {
        expect(MODEL_LIBRARY.has(v.model), `${def.id}: variant '${v.model}'`).toBe(true);
        for (const id of v.themes) expect(THEMES.has(id), `${def.id}: variant '${v.model}' names theme '${id}'`).toBe(true);
      }
      for (const t of THEMES.all()) {
        for (const m of propModels(def, t)) {
          // a variant's pack helper binds the pack's shared slots: what's left for the model must not be nothing
          const asked = m.bind?.(t) ?? {};
          const b = m.model === def.model ? asked : fitSlots(m.model, asked);
          if (asked.palette) expect(Object.keys(b.palette ?? {}).length, `${def.id} (${m.model}) in ${t.id}: binds none of its slots`).toBeGreaterThan(0);
          const own = Object.keys(MODEL_LIBRARY.get(m.model).params ?? {});
          const slots = Object.keys(expandModel(m.model, b.params ? { params: b.params } : {}).palette);
          for (const k of Object.keys(b.palette ?? {})) expect(slots, `${def.id} (${m.model}) in ${t.id}: slot '${k}'`).toContain(k);
          for (const k of Object.keys(b.params ?? {})) expect(own, `${def.id} (${m.model}) in ${t.id}: param '${k}'`).toContain(k);
        }
      }
    }
  });

  it('a prop wears its variants in their themes only, picked from its own seed, the same every time', () => {
    const forge = THEMES.get('ember-forge');
    const crypt = THEMES.get('gloom-crypt');
    const worn = (theme: typeof forge, seed: number) => {
      const p = buildProp('barrel', { theme, rng: new Rng(seed) }, 0, 0);
      const names: string[] = [];
      p.root.traverse((o) => (o as Mesh).isMesh && names.push(o.name));
      return names.some((n) => n.startsWith('kenney-mini-dungeon/barrel')) ? 'pack' : 'own';
    };
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const forgeLooks = seeds.map((s) => worn(forge, s));
    expect(forgeLooks).toContain('pack');
    expect(forgeLooks).toContain('own');
    expect(seeds.map((s) => worn(forge, s))).toEqual(forgeLooks);
    // the crypt doesn't list the barrel's variant: always its own
    expect(new Set(seeds.map((s) => worn(crypt, s)))).toEqual(new Set(['own']));
    // and a rift's shift of the forge dresses as the forge does
    expect(propModels(PROPS.get('barrel'), { ...forge, id: 'ember-forge~h40c105s110' }).length).toBe(2);
  });

  it('a blocking prop keeps to its one cell below head height: nothing under 1.8 m reaches past 0.75 m from its centre', () => {
    // actors collide with the blocked cell only (0.5 m from its centre); a canopy may spread above them
    for (const def of PROPS.all().filter((d) => d.blocks)) {
      const seen = new Set<string>();
      for (const t of THEMES.all()) {
        propModels(def, t).forEach((m, variant) => {
          const b = m.bind?.(t) ?? {};
          const key = JSON.stringify([m.model, b.params, b.scale, b.at]); // colours don't change the shape
          if (seen.has(key)) return;
          seen.add(key);
          let reach = 0;
          for (let s = 0; s < 16; s++) {
            const p = buildProp(def.id, { theme: t, rng: new Rng(s).fork(def.id), variant }, 0, 0, s * 0.7);
            reach = Math.max(reach, bandReach(meshesOf(p.root), 0.05, 1.8));
          }
          expect(reach, `${def.id} (${m.model}) in ${t.id}`).toBeLessThanOrEqual(0.75);
        });
      }
    }
  });
});
