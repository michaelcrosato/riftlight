import { type BufferGeometry, Group, type Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';
import { Physics } from '../physics/Physics';
import { glowMaterial, toonMaterial } from '../render/toon';
import {
  around,
  boxFrame,
  buildModel,
  checkModel,
  expandModel,
  gridOf,
  model,
  ModelCatalog,
  ModelError,
  MODEL_LIBRARY,
  primTriangles,
  ring,
  rowOf,
  scatterOf,
  svgOutlines,
  validateModel,
  type ModelDef,
  type Part,
  type Prim,
} from '.';
import { modelRng } from './expand';
import { addModelColliders } from './physics';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

function boundsOfTris(t: readonly number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, t[i]!);
    max[i % 3] = Math.max(max[i % 3]!, t[i]!);
  }
  return { min, max };
}

/** Signed volume of a closed triangle list: positive when every face points outward. */
function volume(t: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, k) => t[i + k]!) as number[];
    v += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6;
  }
  return v;
}

const tris = (p: Prim) => primTriangles(p, 'a').get('a')!;

function meshes(o: Group): Mesh[] {
  const out: Mesh[] = [];
  o.traverse((x) => {
    if ((x as Mesh).isMesh) out.push(x as Mesh);
  });
  return out;
}

const positions = (g: BufferGeometry) => g.getAttribute('position').array as Float32Array;

const def = (parts: Part[], extra: Partial<ModelDef> = {}): ModelDef => ({ id: 'test', about: 'a test model', tags: [], palette: { a: 'orange', b: 'slate' }, parts, ...extra });

describe('primitives fill their box', () => {
  const size = [0.8, 0.5, 0.6] as const;
  const cases: [string, Prim][] = [
    ['box', { box: size }],
    ['wedge', { wedge: size }],
    ['torus', { torus: size }],
    ['lump', { lump: size, seed: 4 }],
    ['ball', { ball: size }],
    ['ball seg 7', { ball: size, seg: 7 }],
    ['half ball', { ball: size, half: true }],
    ['cone', { cone: size, seg: 5 }],
    ['cyl top 0.5', { cyl: size, top: 0.5 }],
    ['cyl top 2 (wider top fills)', { cyl: size, top: 2 }],
  ];
  for (let n = 3; n <= 10; n++) cases.push([`cyl seg ${n}`, { cyl: size, seg: n }]);
  for (const [label, p] of cases) {
    it(label, () => {
      const b = boundsOfTris(tris(p));
      for (let k = 0; k < 3; k++) {
        expect(near(b.max[k]! - b.min[k]!, size[k]!, 1e-9)).toBe(true);
        expect(near(b.max[k]! + b.min[k]!, 0, 1e-9)).toBe(true); // centred
      }
    });
  }

  it('a regular n-gon prism is cyl with seg n, its first corner at +X', () => {
    // a hexagon of circumradius 1 starting at +X: 2 wide in x, √3 deep in z
    const t = tris({ cyl: [2, 1, Math.sqrt(3)], seg: 6 });
    const corners = new Set<string>();
    for (let i = 0; i < t.length; i += 3) if (near(t[i + 1]!, 0.5)) corners.add(`${t[i]!.toFixed(6)},${t[i + 2]!.toFixed(6)}`);
    const want = Array.from({ length: 6 }, (_, i) => `${Math.cos((i * Math.PI) / 3).toFixed(6)},${Math.sin((i * Math.PI) / 3).toFixed(6)}`.replace('-0.000000', '0.000000'));
    expect([...corners].map((c) => c.replace('-0.000000', '0.000000')).sort()).toEqual(want.sort());
  });

  it('[w, h, w] with seg 6 comes out ~15% stretched in z; seg 8 stays regular', () => {
    const r6 = ring(6);
    expect(Math.max(...r6.map((p) => p[1])) / Math.max(...r6.map((p) => p[0]))).toBeCloseTo(1, 9); // filled to the same box…
    const z = Math.max(...r6.map((p) => Math.abs(p[1])));
    expect(z / Math.sin(Math.PI / 3) / 0.5).toBeCloseTo(2 / Math.sqrt(3), 6); // …so z is stretched by 2/√3
    const r8 = ring(8);
    const radii = r8.map(([x, z2]) => Math.hypot(x, z2));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-9);
  });

  it('an odd ring keeps its bounds centred (its axis shifts slightly)', () => {
    const r5 = ring(5);
    expect(Math.max(...r5.map((p) => p[0])) + Math.min(...r5.map((p) => p[0]))).toBeCloseTo(0, 12);
    expect(r5[0]![0]).toBeCloseTo(0.5, 12); // the first corner is the +X extreme
  });
});

describe('primitives face outward', () => {
  const closed: [string, Prim][] = [
    ['box', { box: [1, 2, 3] }],
    ['cyl', { cyl: [1, 1, 1], seg: 7 }],
    ['cyl top', { cyl: [1, 1, 1], top: 0.4 }],
    ['cone', { cone: [1, 1, 1] }],
    ['ball', { ball: [1, 1, 1] }],
    ['half ball', { ball: [1, 1, 1], half: true }],
    ['lump', { lump: [1, 1, 1] }],
    ['wedge', { wedge: [1, 1, 1] }],
    ['torus', { torus: [1, 0.2, 1] }],
    ['lathe', { lathe: [[0, 0], [0.3, 0], [0.4, 0.5], [0.2, 1], [0, 1]] }],
    ['lathe written top to bottom', { lathe: [[0, 1], [0.2, 1], [0.4, 0.5], [0.3, 0], [0, 0]] }],
    ['slab', { slab: [[0, 0], [1, 0], [0.5, 1]], depth: 0.2 }],
    ['slab clockwise', { slab: [[0, 0], [0.5, 1], [1, 0]], depth: 0.2 }],
    ['slab svg', { slab: 'M0 0 L1 0 Q1 1 0 1 Z', depth: 0.1 }],
    ['tube', { tube: [[0, 0, 0], [0, 0.5, 0.2], [0.3, 1, 0.2]], r: [0.1, 0.05] }],
  ];
  for (const [label, p] of closed) {
    it(label, () => {
      const t = tris(p);
      expect(t.length).toBeGreaterThan(0);
      expect(volume(t)).toBeGreaterThan(0);
      // no zero-area triangles survive
      for (let i = 0; i < t.length; i += 9) {
        const ux = t[i + 3]! - t[i]!;
        const uy = t[i + 4]! - t[i + 1]!;
        const uz = t[i + 5]! - t[i + 2]!;
        const vx = t[i + 6]! - t[i]!;
        const vy = t[i + 7]! - t[i + 1]!;
        const vz = t[i + 8]! - t[i + 2]!;
        expect(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)).toBeGreaterThan(1e-10);
      }
    });
  }

  it('open lathe profiles (pipes, bowls, vases) face out, written either way', () => {
    for (const prof of [[[0.3, 1], [0.3, 0]], [[0.3, 0], [0.3, 1]], [[0.3, 0], [0.25, 0.5], [0.3, 1]], [[0.3, 1], [0.25, 0.5], [0.3, 0]]] as [number, number][][]) {
      const t = tris({ lathe: prof });
      let out = 0;
      for (let i = 0; i < t.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.slice(i, i + 9) as number[];
        const n = [(by! - ay!) * (cz! - az!) - (bz! - az!) * (cy! - ay!), (bz! - az!) * (cx! - ax!) - (bx! - ax!) * (cz! - az!), (bx! - ax!) * (cy! - ay!) - (by! - ay!) * (cx! - ax!)];
        if (n[0]! * (ax! + bx! + cx!) + n[2]! * (az! + bz! + cz!) > 0) out++; // points away from the axis
      }
      expect(out, JSON.stringify(prof)).toBe(t.length / 9);
    }
  });

  it('a lathe touching the axis leaves no degenerate triangles', () => {
    const t = tris({ lathe: [[0, 0], [0.3, 0], [0.3, 1], [0, 1]], seg: 8 });
    expect(t.length / 9).toBe(8 * 4); // 8 bottom + 16 side + 8 top, none at the poles
  });

  it('svg paths: M L H V C Q Z, absolute and relative', () => {
    expect(svgOutlines('M0 0 H2 V1 h-2 z')).toEqual([[[0, 0], [2, 0], [2, 1], [0, 1]]]);
    expect(svgOutlines('M0 0 l1 0 l0 1 Z M5 5 L6 5 L6 6 Z')).toHaveLength(2);
    expect(svgOutlines('M0 0 C0 1 1 1 1 0 Z')[0]).toHaveLength(5);
    expect(() => svgOutlines('M0 0 A1 1 0 0 1 1 1 Z')).toThrow(/not supported/);
    expect(svgOutlines('M0 0 l1 0 l0 1 z m 2 0 l1 0 l0 1 z')[1]![0]).toEqual([2, 0]); // z goes back to the start
    expect(svgOutlines('M0 0 L1 0 L1 1 Z L2 0 L2 1 Z')).toEqual([[[0, 0], [1, 0], [1, 1]], [[0, 0], [2, 0], [2, 1]]]);
    expect(svgOutlines('M0 0 L1e+1 0 L1E1 1E1 Z')[0]).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(() => svgOutlines('M0 0 L1 0 L1 1 Z 5 5')).toThrow(/numbers after Z/); // not a hang
  });
});

describe('buildModel', () => {
  it('merges to one mesh per material, faceted, with shared geometry when cached', () => {
    const b = buildModel('market-stall');
    expect(b.report.draws).toBe(b.report.materials);
    const ms = meshes(b.object);
    expect(ms).toHaveLength(b.report.draws);
    for (const m of ms) {
      expect(m.geometry.getIndex()).toBeNull();
      expect(m.geometry.userData.shared).toBe(true);
      expect(m.material).toBe(toonMaterial((m.material as unknown as { color: { getHex(): number } }).color.getHex()));
    }
    expect(buildModel('market-stall').report.cached).toBe(true);
    expect(meshes(buildModel('market-stall').object)[0]!.geometry).toBe(ms[0]!.geometry);
  });

  it('is deterministic', () => {
    const a = meshes(buildModel('well', { palette: { roof: 'teal' } }).object).map((m) => Array.from(positions(m.geometry)));
    const b = meshes(buildModel(MODEL_LIBRARY.get('well'), { palette: { roof: 'teal' }, catalog: new ModelCatalog(MODEL_LIBRARY.all()) }).object).map((m) => Array.from(positions(m.geometry)));
    expect(a).toEqual(b);
  });

  it('glow parts are unlit, shared materials of their own', () => {
    const b = buildModel('lamp-post');
    const glow = meshes(b.object).filter((m) => m.name.endsWith(':glow'));
    expect(glow).toHaveLength(1);
    expect(glow[0]!.material).toBe(glowMaterial(PALETTE.sand));
    expect(glowMaterial(PALETTE.sand).userData.shared).toBe(true);
    expect(glow[0]!.castShadow).toBe(false);
  });

  it('mirror keeps faces outward (and doubles the volume)', () => {
    const one = def([{ box: [0.2, 0.3, 0.4], at: [0.5, 0.2, 0], rot: [10, 30, 20] }]);
    const two = def([{ mirror: [{ box: [0.2, 0.3, 0.4], at: [0.5, 0.2, 0], rot: [10, 30, 20] }] }], { id: 'test2' });
    const z = def([{ mirror: [{ box: [0.2, 0.3, 0.4], at: [0, 0.2, 0.5], rot: [10, 30, 20] }], axis: 'z' }], { id: 'test3' });
    const v1 = volume(positions(meshes(buildModel(one).object)[0]!.geometry));
    expect(v1).toBeCloseTo(0.024, 6);
    expect(volume(positions(meshes(buildModel(two).object)[0]!.geometry))).toBeCloseTo(2 * v1, 6);
    expect(volume(positions(meshes(buildModel(z).object)[0]!.geometry))).toBeCloseTo(2 * v1, 6);
    expect(buildModel(two).bounds.min[0]).toBeCloseTo(-buildModel(two).bounds.max[0], 9);
  });

  it('on: sits a part on the top of the named one, `at` an offset from there', () => {
    const b = buildModel(def([{ name: 'base', box: [1, 0.5, 1], at: [0.2, 0.25, 0] }, { on: 'base', box: [0.2, 0.2, 0.2], at: [0.1, 0, 0], c: 'b' }]));
    const top = meshes(b.object).find((m) => m.name === 'test:b')!;
    top.geometry.computeBoundingBox();
    const bb = top.geometry.boundingBox!;
    expect(bb.min.y).toBeCloseTo(0.5, 6);
    expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(0.3, 6); // float32 buffers
    expect(b.bounds.max[1]).toBeCloseTo(0.7, 9);
  });

  it('on: chains, groups and mirrored twins', () => {
    const b = buildModel(
      def([
        { name: 'table', box: [1, 0.1, 1], at: [0, 0.75, 0] },
        { name: 'box', on: 'table', box: [0.3, 0.3, 0.3] },
        { on: 'box', group: [{ ball: [0.1, 0.1, 0.1], at: [0, 0.05, 0] }] },
        { mirror: [{ name: 'post', box: [0.1, 0.4, 0.1], at: [0.4, 0.2, 0] }, { on: 'post', ball: [0.1, 0.1, 0.1], c: 'b' }] },
      ]),
    );
    expect(b.bounds.max[1]).toBeCloseTo(0.8 + 0.3 + 0.1, 9);
    const knobs = meshes(b.object).find((m) => m.name === 'test:b')!;
    knobs.geometry.computeBoundingBox();
    expect(knobs.geometry.boundingBox!.min.y).toBeCloseTo(0.4, 6);
    expect(knobs.geometry.boundingBox!.min.x).toBeCloseTo(-0.45, 6); // the left one sits on the left post
  });

  it('use: places another model, mapping slots, inheriting same-name slots, keeping its own colours', () => {
    const cup = model({ id: 'cup', about: 'cup', tags: [], palette: { clay: 'red', wood: 'orange' }, parts: [{ cyl: [0.1, 0.12, 0.1], at: [0, 0.06, 0], c: 'clay' }, { box: [0.05, 0.05, 0.05], at: [0, 0.145, 0], c: 'wood' }] });
    const table = model({
      id: 'table',
      about: 'table',
      tags: [],
      palette: { wood: 'sand', glaze: 'blue' },
      parts: [
        { name: 'top', box: [1, 0.1, 1], at: [0, 0.7, 0] },
        { use: 'cup', on: 'top', palette: { clay: 'glaze' } },
        { use: 'cup', at: [0.3, 0.75, 0] },
      ],
    });
    const catalog = new ModelCatalog([cup, table]);
    const e = expandModel('table', { catalog });
    expect(JSON.parse(JSON.stringify(e))).toStrictEqual(e); // plain JSON, no undefined keys
    expect(JSON.stringify(e)).not.toContain('"use"');
    expect(e.palette).toEqual({ wood: 'sand', glaze: 'blue', 'cup.clay': 'red' });
    const b = buildModel('table', { catalog });
    const hexes = meshes(b.object).map((m) => (m.material as unknown as { color: { getHex(): number } }).color.getHex());
    expect(new Set(hexes)).toEqual(new Set([PALETTE.sand, PALETTE.blue, PALETTE.red]));
    expect(b.bounds.max[1]).toBeCloseTo(0.75 + 0.17, 9);
  });

  it('a group\'s c is the default slot inside it', () => {
    const e = expandModel(def([{ c: 'b', group: [{ box: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }, { box: [0.2, 0.2, 0.2], at: [0.2, 0.1, 0], c: 'a' }] }]));
    const g = e.parts[0] as unknown as { group: { c: string }[] };
    expect(g.group.map((p) => p.c)).toEqual(['b', 'a']);
  });

  it('use: two of its slots mapped onto one of ours keep all their faces', () => {
    const v = '0 0 0,1000 0 0,0 1000 0,0 0 1000';
    const tet = model({ id: 'tet', about: '', tags: [], palette: { a: 'red', b: 'blue' }, source: { url: 'test', licence: 'CC0-1.0' }, parts: [{ mesh: { v, f: { a: '0 2 1,0 1 3', b: '0 3 2,1 2 3' } } }] });
    const one = model({ id: 'one', about: '', tags: [], palette: { x: 'sand' }, parts: [{ use: 'tet', palette: { a: 'x', b: 'x' } }] });
    const catalog = new ModelCatalog([tet, one]);
    expect(buildModel('one', { catalog }).report.tris).toBe(4);
    expect(validateModel('one', { catalog }).problems).toEqual([]); // the import's source is its own
  });

  it('params and seeds: params reach the parts; the rng is per seed; only unseeded builds are cached', () => {
    const post = model({ id: 'post', about: 'post', tags: [], palette: { a: 'slate' }, params: { h: [1, 0.5, 2] }, parts: (p) => [{ box: [0.2, p.h!, 0.2], at: [0, p.h! / 2, 0] }] });
    const rocks = model({ id: 'rocks', about: 'rocks', tags: [], palette: { a: 'slate' }, parts: (_p, rng) => [{ lump: [0.4, 0.3, 0.4], at: [rng.range(-1, 1), 0.15, 0] }] });
    const catalog = new ModelCatalog([post, rocks]);
    expect(buildModel('post', { catalog }).bounds.size[1]).toBeCloseTo(1, 9);
    expect(buildModel('post', { catalog, params: { h: 2 } }).bounds.size[1]).toBeCloseTo(2, 9);
    expect(buildModel('post', { catalog, params: { h: 2 } }).report).toMatchObject({ seeded: false, cached: true });
    const a = buildModel('rocks', { catalog, seed: 1 });
    expect(a.report.seeded).toBe(true);
    expect(buildModel('rocks', { catalog, seed: 1 }).report.cached).toBe(false);
    expect(buildModel('rocks', { catalog, seed: 1 }).bounds).toEqual(a.bounds);
    expect(buildModel('rocks', { catalog, seed: 2 }).bounds.min[0]).not.toBeCloseTo(a.bounds.min[0], 6);
    const geo = meshes(a.object)[0]!.geometry;
    expect(geo.userData.shared).toBeUndefined(); // the level that places it owns it
    // reading the state is reading the rng too
    const sneaky = model({ id: 'sneaky', about: '', tags: [], palette: { a: 'slate' }, parts: (_p, rng) => [{ box: [0.2, 0.2 + (rng.state % 7) / 10, 0.2], at: [0, 0.5, 0] }] });
    expect(buildModel(sneaky, { seed: 1 }).report.seeded).toBe(true);
  });

  it('pivots stay movable: draws = materials per pivot, named groups at their frame', () => {
    const frame: Part = { box: [1.2, 2.2, 0.1], at: [0, 1.1, 0] };
    const door = def([
      frame,
      { name: 'leaf', pivot: true, at: [-0.45, 0, 0.1], rot: [0, 20, 0], group: [{ box: [0.9, 2, 0.06], at: [0.45, 1, 0] }, { ball: [0.08, 0.08, 0.08], at: [0.8, 1, 0.05], c: 'b' }] },
    ]);
    const b = buildModel(door);
    const leaf = b.object.getObjectByName('leaf')!;
    expect(leaf).toBeInstanceOf(Group);
    expect(leaf.position.toArray()).toEqual([-0.45, 0, 0.1]);
    expect(leaf.rotation.y).toBeCloseTo((20 * Math.PI) / 180, 9);
    expect(meshes(leaf as Group)).toHaveLength(2);
    expect(b.report.draws).toBe(3); // root 'a', leaf 'a' and leaf 'b'
    // world positions are the same as without the pivot
    const flat = buildModel(def([frame, { at: [-0.45, 0, 0.1], rot: [0, 20, 0], group: [{ box: [0.9, 2, 0.06], at: [0.45, 1, 0] }, { ball: [0.08, 0.08, 0.08], at: [0.8, 1, 0.05], c: 'b' }] }], { id: 'flat' }));
    expect(b.bounds.min[0]).toBeCloseTo(flat.bounds.min[0], 9);
    expect(b.bounds.max[2]).toBeCloseTo(flat.bounds.max[2], 9);
  });

  it('anchors, colliders and the light request', () => {
    const lamp = buildModel('lamp-post');
    expect(lamp.light).toEqual({ at: [0.42, 1.74, 0], color: PALETTE.sand, intensity: 6, radius: 6, flicker: 'candle' });
    expect(buildModel('lamp-post', { light: { color: 0xff8800, intensity: 3 } }).light).toMatchObject({ color: 0xff8800, intensity: 3, radius: 6 });
    expect(() => buildModel('lamp-post', { light: { c: 'nope' } })).toThrow(/slot 'nope'/); // after a cached build too
    const c = lamp.colliders[0]!;
    expect(c.kind).toBe('box');
    if (c.kind === 'box') expect(c.half[1] * 2).toBeCloseTo(lamp.bounds.size[1], 9);
    const sword = buildModel(def([{ box: [0.1, 1, 0.1], at: [0, 0.5, 0] }], { id: 'grip', anchors: { grip: { at: [0, 0.1, 0], rot: [0, 0, 90] }, tip: [0, 1, 0] }, collider: 'hull' }));
    expect(sword.anchors).toEqual({ grip: { at: [0, 0.1, 0], rot: [0, 0, 90] }, tip: { at: [0, 1, 0], rot: [0, 0, 0] } });
    expect(sword.colliders[0]).toMatchObject({ kind: 'hull' });
    expect((sword.colliders[0] as { points: readonly number[] }).points).toHaveLength(8 * 3);
    expect(buildModel(def([{ box: [1, 1, 1], at: [0, 0.5, 0] }], { id: 'none', collider: 'none' })).colliders).toEqual([]);
  });

  it('addModelColliders: static colliders where the model stands', async () => {
    const physics = await Physics.create();
    const crate = buildModel('crate');
    const [col] = addModelColliders(physics, crate, [3, 0, 2], Math.PI / 2);
    expect(col!.translation().x).toBeCloseTo(3, 6);
    expect(col!.translation().y).toBeCloseTo(crate.bounds.size[1] / 2, 2);
    // off-centre: a part at +X ends up where three's rotation.y = yaw puts it (−Z for a quarter turn)
    const side = buildModel(def([{ box: [0.4, 0.4, 0.4], at: [1, 0.2, 0] }], { id: 'side' }));
    const [moved] = addModelColliders(physics, side, [0, 0, 0], Math.PI / 2);
    expect(moved!.translation().x).toBeCloseTo(0, 6);
    expect(moved!.translation().z).toBeCloseTo(-1, 6);
    const hull = buildModel(def([{ box: [1, 1, 1], at: [0, 0.5, 0] }], { id: 'h', collider: 'hull' }));
    expect(addModelColliders(physics, hull, [0, 0, 0])).toHaveLength(1);
    expect(physics.counts().colliders).toBe(3);
  });

  it('throws a ModelError naming every problem', () => {
    expect.assertions(2);
    expect(() => buildModel(def([{ box: [1, 1, 1], c: 'nope' }]))).toThrow(ModelError);
    try {
      buildModel(def([{ box: [1, 1, 1], c: 'nope' }, { use: 'nothing' }]));
    } catch (e) {
      expect((e as ModelError).problems).toHaveLength(2);
    }
  });
});

describe('helpers return parts', () => {
  it('around turns copies about Y (r pushes along +Z first)', () => {
    const parts = around(4, { box: [0.1, 0.1, 0.1] }, { r: 1, phase: 90 });
    expect(parts).toHaveLength(4);
    const b = buildModel(def(parts, { floats: true }));
    expect(b.bounds.size[0]).toBeCloseTo(2.1, 9);
    expect(b.bounds.size[2]).toBeCloseTo(2.1, 9);
  });

  it('rowOf, gridOf, scatterOf and boxFrame', () => {
    expect(buildModel(def(rowOf(3, [0.5, 0, 0], (i) => ({ box: [0.1, 0.1 * (i + 1), 0.1], at: [0, 0.05 * (i + 1), 0] })))).bounds.size).toEqual([1.1, 0.30000000000000004, 0.1]);
    expect(buildModel(def(gridOf(2, 3, [1, 2], { box: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }))).bounds.size.map((v) => Math.round(v * 100) / 100)).toEqual([1.2, 0.2, 4.2]);
    const s1 = scatterOf(5, [4, 4], 7, () => ({ box: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }));
    expect(s1).toEqual(scatterOf(5, [4, 4], 7, () => ({ box: [0.2, 0.2, 0.2], at: [0, 0.1, 0] })));
    expect(JSON.stringify(s1)).not.toEqual(JSON.stringify(scatterOf(5, [4, 4], 8, () => ({ box: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }))));
    const frame = boxFrame({ size: [1, 0.5, 0.8], beam: 0.1, at: [0, 0.25, 0], c: 'b' });
    expect(frame.group).toHaveLength(12);
    const b = buildModel(def([frame]));
    expect(b.bounds.size.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0.5, 0.8]);
  });
});

describe('checks', () => {
  const problems = (d: ModelDef, opts = {}) => validateModel(d, opts).problems;
  const warnings = (d: ModelDef) => validateModel(d).warnings;
  const ok: Part = { box: [0.5, 0.5, 0.5], at: [0, 0.25, 0] };

  it('a clean model has no problems or warnings', () => {
    expect(validateModel(def([ok]))).toMatchObject({ problems: [], warnings: [] });
  });
  it('undeclared slot', () => expect(problems(def([{ ...ok, c: 'gold' }]))[0]).toMatch(/slot 'gold'.*does not declare.*a, b/));
  it('unknown palette name', () => expect(problems(def([ok], { palette: { a: 'brown' as 'red' } }))[0]).toMatch(/'a' is "brown", not a PALETTE colour/));
  it('unknown tex', () => {
    expect(problems(def([{ ...ok, tex: 'planks' }]))[0]).toMatch(/texture 'planks'/);
    expect(problems(def([{ ...ok, tex: 'planks' }]), { textures: (id: string) => id === 'planks' })).toEqual([]);
  });
  it('malformed mesh', () => {
    const src = { url: 'test', licence: 'CC0-1.0' };
    expect(problems(def([{ mesh: { v: '0 0 0,1000 0 0,0 1000', f: { a: '0 1 2' } } }], { source: src }))[0]).toMatch(/vertex "0 1000"/);
    expect(problems(def([{ mesh: { v: '0 0 0,1000 0 0,0 1000 0', f: { a: '0 1 3' } } }], { source: src }))[0]).toMatch(/face "0 1 3"/);
  });
  it('NaN', () => expect(problems(def([{ box: [0.5, Number.NaN, 0.5], at: [0, 0.25, 0] }])).join()).toMatch(/NaN/));
  it('empty', () => expect(problems(def([]))[0]).toMatch(/empty/));
  it('below the floor (unless it floats)', () => {
    expect(problems(def([{ box: [0.5, 0.5, 0.5], at: [0, 0.2, 0] }]))[0]).toMatch(/0.05 m below the floor/);
    expect(problems(def([{ box: [0.5, 0.5, 0.5], at: [0, 0.2, 0] }], { floats: true }))).toEqual([]);
    expect(problems(def([{ box: [0.5, 0.5, 0.5], at: [0, 0.245, 0] }]))).toEqual([]); // within 1 cm
  });
  it('outside the declared size', () => {
    expect(problems(def([ok], { size: [0.4, 0.5, 0.5] }))[0]).toMatch(/exceed the declared size/);
    expect(problems(def([ok], { size: [0.46, 0.5, 0.5] }))).toEqual([]); // within 10%
  });
  it('on naming no part', () => expect(problems(def([ok, { on: 'tabel', box: [0.1, 0.1, 0.1] }]))[0]).toMatch(/sits on 'tabel', which no part is named/));
  it('a use cycle, and an unknown use', () => {
    const a = model({ id: 'ca', about: '', tags: [], palette: { a: 'red' }, parts: [{ use: 'cb' }] });
    const b = model({ id: 'cb', about: '', tags: [], palette: { a: 'red' }, parts: [{ use: 'ca' }] });
    expect(problems(a, { catalog: new ModelCatalog([a, b]) }).join()).toMatch(/use cycle: ca → cb → ca/);
    expect(problems(def([{ use: 'nothing' }]))[0]).toMatch(/model 'nothing'/);
  });
  it('params out of range, or unknown', () => {
    const d = def([ok], { params: { h: [1, 0.5, 2] } });
    expect(problems(d, { params: { h: 3 } })[0]).toMatch(/'h' = 3 is outside its range 0.5..2/);
    expect(problems(d, { params: { w: 1 } })[0]).toMatch(/'w' is not one of the model's params \(h\)/);
  });
  it('param defaults outside their range, or min above max', () => {
    expect(problems(def([ok], { params: { h: [10, 1, 5] } }))[0]).toMatch(/'h' defaults to 10, outside its own range 1..5/);
    expect(problems(def([ok], { params: { h: [1, 5, 1] } }))[0]).toMatch(/min 5 above max 1/);
  });
  it('sizes that aren\'t positive, seg out of range, an unknown mirror axis, NaN in anchors', () => {
    expect(problems(def([{ box: [-1, 1, 1], at: [0, 0.5, 0] }])).join()).toMatch(/size \[-1,1,1\]: a box kind takes \[w, h, d\], each above 0/);
    expect(problems(def([{ cyl: [1, 1, 1], at: [0, 0.5, 0], seg: 500 }])).join()).toMatch(/seg 500: use a whole number of sides from 3 to 64/);
    expect(problems(def([{ mirror: [ok], axis: 'y' as 'x' }])).join()).toMatch(/axis 'y'/);
    expect(problems(def([ok], { anchors: { grip: [0, Number.NaN, 0] } })).join()).toMatch(/NaN/);
  });
  it('on naming an empty group', () => {
    expect(problems(def([ok, { name: 'mark', group: [] }, { on: 'mark', box: [0.1, 0.1, 0.1] }])).join()).toMatch(/'mark', which has no triangles/);
  });
  it('on naming one of its own parts', () => {
    expect(problems(def([{ name: 'g', on: 'inner', group: [{ name: 'inner', box: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }, { box: [0.2, 0.2, 0.2], at: [0.2, 0.1, 0] }] }])).join()).toMatch(/one of its own parts/);
  });
  it('an import without source, or with a licence that is not allowed', () => {
    const mesh: Part = { mesh: { v: '0 0 0,1000 0 0,0 1000 0', f: { a: '0 1 2' } } };
    expect(problems(def([mesh]))[0]).toMatch(/no `source`/);
    expect(problems(def([mesh], { source: { url: 'x', licence: 'CC-BY-SA-4.0' } }))[0]).toMatch(/licence 'CC-BY-SA-4.0' is not allowed/);
    expect(problems(def([mesh], { source: { url: 'x', licence: 'CC-BY-4.0', author: 'someone' } }))[0]).toMatch(/licence 'CC-BY-4.0' is not allowed/); // until #49 approves a pack
    expect(problems(def([mesh], { source: { url: 'x', licence: 'CC0-1.0' } }))).toEqual([]);
  });

  it('warns: floating parts, rods, triangle budget, too many materials', () => {
    expect(warnings(def([ok, { box: [0.2, 0.2, 0.2], at: [0, 1, 0] }]))[0]).toMatch(/^box at parts\[1\] floats 0.4 m from the rest of the model/);
    expect(warnings(def([ok, { box: [0.2, 0.2, 0.2], at: [1, 0.1, 0] }]))).toEqual([]); // standing on the floor beside it is fine
    expect(validateModel(def([{ box: [0.5, 0.5, 0.5], at: [0, 1, 0] }, { box: [0.2, 0.2, 0.2], at: [1, 1, 0] }], { floats: true })).warnings[0]).toMatch(/^box at parts\[1\] floats 0.65 m/);
    expect(warnings(def([ok, { box: [0.04, 0.5, 0.05], at: [0, 0.75, 0] }]))[0]).toMatch(/0.04 × 0.05 m across: rods under 0.06 m/);
    expect(warnings(def([ok, { box: [0.6, 0.02, 0.6], at: [0, 0.51, 0] }]))).toEqual([]); // a plate is fine
    expect(warnings(def([{ ball: [0.4, 0.4, 0.4], at: [0, 0.2, 0], seg: 24 }])).join()).toMatch(/triangles is over the budget of 300/);
    const six = ['red', 'orange', 'sand', 'lime', 'green', 'teal', 'navy'] as const;
    const palette = Object.fromEntries(six.map((c) => [c, c]));
    expect(warnings(def(six.map((c, i) => ({ box: [0.2, 0.2, 0.2], at: [i * 0.2, 0.1, 0], c })), { palette })).join()).toMatch(/7 materials \(over 6\)/);
  });

  it('checkModel builds each param at its min and max, at 3 seeds when the rng is read', () => {
    const tall = model({ id: 'tall', about: '', tags: [], palette: { a: 'red' }, params: { h: [1, 0.5, 4] }, size: [0.5, 2, 0.5], parts: (p) => [{ box: [0.5, p.h!, 0.5], at: [0, p.h! / 2, 0] }] });
    const r = checkModel(tall);
    expect(r.problems).toEqual([expect.stringMatching(/exceed the declared size.*\(h=4\)$/)]);
    // clean at seed 1 (its first draw), below the floor at any other: the sweep must catch it
    const first = modelRng('shaky', 1).next();
    const shaky = model({ id: 'shaky', about: '', tags: [], palette: { a: 'red' }, parts: (_p, rng) => [{ box: [0.5, 0.5, 0.5], at: [0, rng.next() === first ? 0.25 : 0.1, 0] }] });
    expect(validateModel(shaky).problems).toEqual([]);
    expect(checkModel(shaky).problems).toEqual([expect.stringMatching(/below the floor.*\(seed 2\)$/)]); // once, from the first build that shows it
  });

  it('each model draws from its own stream per seed, so seeds 1-3 differ in earnest', () => {
    expect(modelRng('a', 1).next()).not.toBe(modelRng('b', 1).next());
    const draws = [1, 2, 3].map((seed) => modelRng('shaky', seed).next());
    expect(Math.min(...draws)).toBeLessThan(0.5);
    expect(Math.max(...draws)).toBeGreaterThan(0.5);
  });

  it('the built-in library has no problems', () => {
    for (const d of MODEL_LIBRARY.all()) expect(checkModel(d).problems, d.id).toEqual([]);
  });

  it('the catalog finds by tags and words', () => {
    expect(MODEL_LIBRARY.find({ tags: ['container'] }).map((d) => d.id).sort()).toEqual(['barrel', 'crate']);
    expect(MODEL_LIBRARY.find({ text: 'lantern' }).map((d) => d.id)).toEqual(['lamp-post']);
    expect(() => MODEL_LIBRARY.add({ ...MODEL_LIBRARY.get('crate') })).toThrow(/already/);
  });
});
