// Trace (docs/assets/tracing.md): the reference an agent authors from, the verdict on
// what it wrote, and the exporter that turns code-built content into a source. Every source here
// is built at test time from our own code (no binaries, no network).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three/webgpu';
import { afterAll, describe, expect, it } from 'vitest';
import archwayTrace from './fixtures/trace/archway';
import campfireTrace from './fixtures/trace/campfire-ring';
import coinTrace from './fixtures/trace/coin';
import cartTrace from './fixtures/trace/hand-cart';
import marketTrace from './fixtures/trace/market';
import monsterTrace from './fixtures/trace/monster-7';
import obeliskTrace from './fixtures/trace/obelisk';
import smithyTrace from './fixtures/trace/smithy';
import tentTrace from './fixtures/trace/tent';
import treeTrace from './fixtures/trace/tree';
import vorgathTrace from './fixtures/trace/vorgath';
import rackTrace from './fixtures/trace/weapon-rack';
import { exportPath, glbProvenance, resolveSource, sourceGlb, TOWN_BUILDINGS } from '../../../scripts/trace/sources';
import { PALETTE } from '../palette';
import { ModelCatalog } from './catalog';
import { modelTriangles, scoreFidelity, type FidelityScore } from './fidelity';
import { normalizeSource, readGltf, type SourceMesh } from './import';
import { MODEL_LIBRARY } from './library';
import { OWN_LICENCE } from './packs/licences';
import { nearestEntry, paletteFloor, pieceColours, sourceFromModel, sourceFromObject, traceOffset, traceReference, traceVerdict, TRACE_THRESHOLDS, verdictLines, type TraceComponent } from './trace';
import { checkModel, MAX_MATERIALS } from './validate';
import type { ModelDef, Vec3 } from './types';

const ROOT = resolve(__dirname, '../../..');

/** A known mesh: a slab, a turned plank, an 8-sided post and a 6-sided cone, apart, one colour each. */
const KNOWN: ModelDef = {
  id: 'known',
  about: 'Four primitives apart, for the reference',
  tags: ['test'],
  palette: { stone: 'slate', wood: 'orange', post: 'red', roof: 'green' },
  parts: [
    { box: [1.2, 0.4, 0.6], at: [0, 0.2, 0], c: 'stone', name: 'slab' },
    { box: [0.8, 0.1, 0.2], at: [-1.5, 0.05, 0.3], rot: [0, 30, 0], c: 'wood', name: 'plank' },
    { cyl: [0.3, 1, 0.3], seg: 8, at: [1.5, 0.5, 0], c: 'post', name: 'post' },
    { cone: [0.6, 0.5, 0.52], seg: 6, at: [0, 0.65, 1.2], c: 'roof', name: 'roof' },
  ],
};

const piece = (ref: ReturnType<typeof traceReference>, node: string): TraceComponent => {
  const p = ref.components.find((c) => c.node === node);
  expect(p, `a piece from ${node}`).toBeTruthy();
  return p!;
};
const close = (a: readonly number[], b: readonly number[], d = 0.011) => a.forEach((v, i) => expect(Math.abs(v - b[i]!), `${a} vs ${b}`).toBeLessThanOrEqual(d));

describe('traceReference', () => {
  const src = sourceFromModel(KNOWN);
  const ref = traceReference(src);

  it('measures the bounds, the nodes and the materials', () => {
    expect(ref.triangles).toBe(src.group.length);
    close(ref.bounds.min, [-1.9, 0, -0.3]); // the plank turned 30°: 0.4 cos 30° + 0.05 sin 30° out from x = -1.5
    close(ref.bounds.max, [1.65, 1, 1.46]);
    expect(ref.nodes.map((n) => n.name).sort()).toEqual(['plank', 'post', 'roof', 'slab']);
    expect(ref.materials.map((m) => m.name).sort()).toEqual(['post', 'roof', 'stone', 'wood']); // a def's materials are its slots
    const slab = ref.nodes.find((n) => n.name === 'slab')!;
    close(slab.at, [0, 0.2, 0]);
    close(slab.size, [1.2, 0.4, 0.6]);
    expect(slab.colours).toEqual(['#566c86']);
    // each colour on its palette entry
    expect(Object.fromEntries(ref.colours.map((c) => [c.source, c.colour]))).toEqual({ '#566c86': 'slate', '#ef7d57': 'orange', '#b13e53': 'red', '#38b764': 'green' });
  });

  it('finds every connected piece, biggest first, and the primitive each one is', () => {
    expect(ref.components).toHaveLength(4);
    expect(ref.components.map((c) => c.name)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(ref.components[0]!.node).toBe('slab');
    const slab = piece(ref, 'slab');
    expect(slab.shape).toEqual({ prim: { box: [1.2, 0.4, 0.6], at: [0, 0.2, 0] }, match: 'exact' });
    expect(slab.fill).toBe(1);
    expect(slab.palette).toBe('slate');
    const post = piece(ref, 'post');
    expect(post.shape?.match).toBe('exact');
    expect(post.shape?.prim).toMatchObject({ cyl: [0.3, 1, 0.3], seg: 8, at: [1.5, 0.5, 0] });
    expect(post.fill).toBeCloseTo(0.83, 2); // an octagon fills 2√2/π... of its square: (2√2 r²)/(4 r²)
    const roof = piece(ref, 'roof');
    expect(roof.shape).toEqual({ prim: { cone: [0.6, 0.5, 0.52], seg: 6, at: [0, 0.65, 1.2] }, match: 'exact' });
  });

  it('turns a box when a turned one is tighter, and keeps the axis-aligned one beside it', () => {
    const plank = piece(ref, 'plank');
    expect(plank.turned).toBeTruthy();
    close(plank.turned!.size, [0.8, 0.1, 0.2]);
    expect(Math.abs(plank.turned!.rot![1])).toBeCloseTo(30, 0);
    expect(plank.box.size[0]).toBeGreaterThan(0.75); // the axis-aligned box of a turned plank is wider
    expect(plank.box.size[2]).toBeGreaterThan(0.5);
    const prim = plank.shape!.prim as { box: Vec3; at: Vec3 };
    expect(plank.shape!.match).toBe('exact');
    close(prim.box, [0.8, 0.1, 0.2], 0.0015); // within the importer's 1.5 mm
    close(prim.at, [-1.5, 0.05, 0.3], 0.0015);
    expect(piece(ref, 'slab').turned).toBeUndefined(); // already axis-aligned
  });

  it('reads the primitives three.js builds (caps with centre points): a tapered prism exactly, an odd cone closely', () => {
    const g = new Group();
    const trunk = new Mesh(new CylinderGeometry(0.14, 0.2, 0.9, 6), new MeshStandardMaterial({ color: PALETTE.plum }));
    trunk.position.set(0, 0.45, 0);
    trunk.name = 'trunk';
    const top = new Mesh(new ConeGeometry(0.85, 1.1, 7), new MeshStandardMaterial({ color: PALETTE.teal }));
    top.position.set(0, 1.5, 0); // clear of the trunk: a shared vertex (cap centre to cone base) would join them into one piece
    top.name = 'top';
    g.add(trunk, top);
    const r = traceReference(sourceFromObject(g));
    const t = piece(r, 'trunk').shape!;
    expect(t.match).toBe('exact');
    expect(t.prim).toMatchObject({ seg: 6, top: 0.7 });
    expect('cyl' in t.prim && t.prim.cyl[1]).toBeCloseTo(0.9, 3);
    const c = piece(r, 'top').shape!;
    expect(c.match).toBe('close'); // an odd ring keeps its bounds centred, so its apex sits a little off the source's
    expect('cone' in c.prim && c.prim.seg).toBe(7);
  });

  it('gives a piece of several colours all of them, a pointed piece its axis-aligned box, and caps the palette at 8', () => {
    // a box with a top of its own colour (the Kit's `top:`): one piece, two colours
    const g = new Group();
    const side = new MeshStandardMaterial({ color: PALETTE.orange });
    const top = new MeshStandardMaterial({ color: PALETTE.sand });
    g.add(new Mesh(new BoxGeometry(1, 0.6, 0.8), [side, side, top, side, side, side]));
    const crate = traceReference(sourceFromObject(g)).components;
    expect(crate).toHaveLength(1);
    expect(crate[0]!.colours.map((c) => c.palette)).toEqual(['orange', 'sand']);
    expect(pieceColours(crate[0]!)).toMatch(/^orange \d+% \+ sand \d+%$/);
    // two cones on one ring (a spear head): no turn along a facet, only its own axes
    const head: ModelDef = { id: 'head', about: 'Two cones on one ring', tags: ['test'], palette: { m: 'mist' }, parts: [{ cone: [0.3, 0.4, 0.3], seg: 6, at: [0, 0.6, 0] }, { cone: [0.3, 0.4, 0.3], seg: 6, at: [0, 0.2, 0], rot: [180, 0, 0] }] };
    const heads = traceReference(sourceFromModel(head)).components;
    expect(heads.map((c) => c.tris)).toEqual([20]); // the shared ring welds both cones (10 triangles each) into one piece
    const spear = heads[0];
    expect(spear!.turned).toBeUndefined();
    close(spear!.box.size, [0.3, 0.8, 0.3], 0.011);
    // ten colours: the pasted palette keeps to 8 (more warns), the closest joined
    const names = ['ink', 'plum', 'red', 'orange', 'sand', 'lime', 'green', 'teal', 'navy', 'blue'] as const;
    const many: ModelDef = { id: 'many', about: 'Ten colours', tags: ['test'], palette: Object.fromEntries(names.map((n) => [n, n])), parts: names.map((n, i) => ({ box: [0.3, 0.3, 0.3] as const, at: [i * 0.5, 0.15, 0] as const, c: n })) };
    const r = traceReference(sourceFromModel(many));
    expect(r.colours.length).toBe(MAX_MATERIALS);
    expect(r.components.every((c) => r.colours.some((s) => s.slot === c.slot))).toBe(true); // every piece pastes with a slot the palette has
  });

  it('fits a box to each convex hull it is given', () => {
    const corners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].flatMap((z) => [x * 2, y, z * 0.5])));
    const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
    const h = traceReference(src, { hulls: [{ vertices: corners, indices: faces }] }).hulls!;
    expect(h).toHaveLength(1);
    expect(h[0]!.box).toEqual({ at: [1, 0.5, 0.25], size: [2, 1, 0.5] });
    expect(h[0]!.fill).toBe(1);
    expect(ref.hulls).toBeNull(); // none given, none made up
  });
});

describe('scoring a trace', () => {
  const lib = (defs: ModelDef[]) => new ModelCatalog([...MODEL_LIBRARY.all(), ...defs]);
  const cylinder: ModelDef = { id: 'drum', about: 'A drum', tags: ['test'], palette: { c: 'orange' }, parts: [{ cyl: [1, 1, 1], seg: 12, at: [0, 0.5, 0] }] };
  const asBox: ModelDef = { ...cylinder, id: 'drum-box', parts: [{ box: [1, 1, 1], at: [0, 0.5, 0] }] };
  const recoloured: ModelDef = { ...cylinder, id: 'drum-blue', palette: { c: 'blue' } };
  const catalog = lib([cylinder, asBox, recoloured]);
  const source = modelTriangles(cylinder, { catalog });

  it('scores a perfect trace 1.0 / 1.0 / 0 and passes it', () => {
    const s = scoreFidelity(source, modelTriangles(cylinder, { catalog }));
    expect([s.iou, s.iouClose, s.colour]).toEqual([1, 1, 0]);
    expect(traceVerdict(s).pass).toBe(true);
  });

  it('scores a box traced for a cylinder lower, and a wrong colour on the colour check', () => {
    const box = scoreFidelity(source, modelTriangles(asBox, { catalog }));
    expect(box.iou).toBeLessThan(0.99);
    expect(box.iouClose).toBeLessThan(0.95);
    expect(box.iouClose).toBeLessThan(box.iou + 0.02); // close up sees the corners best
    const blue = scoreFidelity(source, modelTriangles(recoloured, { catalog }));
    expect(blue.iou).toBe(1);
    const v = traceVerdict(blue);
    expect(v.pass).toBe(false);
    expect(v.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(['colour']);
  });

  it('knows the best colour score a palette trace can reach: 0 on palette colours, above it off them', () => {
    const src = sourceFromModel(cylinder, { catalog });
    expect(paletteFloor(src)).toBe(0);
    const pink = { ...src, colours: src.colours.map(() => 0xcc667f) }; // a monster's own pink: nearest entry red
    const floor = paletteFloor(pink);
    expect(floor).toBeGreaterThan(0.05);
    expect(floor).toBeCloseTo(scoreFidelity(pink, { positions: pink.positions, colours: Array.from(pink.colours, () => PALETTE.red) }).colour, 3);
    // each colour on its nearest entry, not where the importer's mapper (which keeps hues apart) puts
    // it: monster seed 7's hide, belly and glow, which the mapper sends to sand, lime and green
    const seven = [0xb3a680, 0xc6c69f, 0x66ff66];
    expect(seven.map(nearestEntry)).toEqual(['mist', 'sand', 'lime']);
    const hide = { ...src, colours: src.colours.map((_, i) => seven[i % 3]!) };
    const nearest = scoreFidelity(hide, { positions: hide.positions, colours: Array.from(hide.colours, (c) => PALETTE[nearestEntry(c)]) }).colour;
    const mapped = scoreFidelity(hide, { positions: hide.positions, colours: Array.from(hide.colours, (c) => PALETTE[(['sand', 'lime', 'green'] as const)[seven.indexOf(c)]!]) }).colour;
    expect(paletteFloor(hide)).toBeCloseTo(nearest, 4);
    expect(nearest).toBeLessThan(mapped - 0.02);
  });

  it('tells a trace drawn in the wrong frame from a wrong shape', () => {
    const drum = modelTriangles(cylinder, { catalog });
    const moved = { positions: Array.from(drum.positions, (v, i) => (i % 3 === 2 ? v + 0.25 : v)), colours: drum.colours };
    const off = traceOffset(source, moved);
    close(off, [0, 0, 0.25], 0.001);
    const s = scoreFidelity(source, moved);
    expect(s.bounds).toEqual([0, 0, 0]); // same size: only the offset says what is wrong
    expect(verdictLines(s, traceVerdict(s), off).join('\n')).toMatch(/centre offset 0 x 0 x \+0\.25 m .*sits apart from the source/);
    expect(verdictLines(s, traceVerdict(s), traceOffset(source, drum)).join('\n')).not.toMatch(/apart/);
  });

  it('lets the thresholds decide, each check at its limit', () => {
    const score = (iou: number, iouClose: number, colour: number): FidelityScore => ({ iou, iouClose, colour, bounds: [0, 0, 0], views: [] });
    const { iou, iouClose, colour } = TRACE_THRESHOLDS;
    expect(traceVerdict(score(iou, iouClose, colour)).pass).toBe(true); // the limits themselves pass
    expect(traceVerdict(score(iou - 0.001, 1, 0)).checks.map((c) => c.pass)).toEqual([false, true, true]);
    expect(traceVerdict(score(1, iouClose - 0.001, 0)).checks.map((c) => c.pass)).toEqual([true, false, true]);
    expect(traceVerdict(score(1, 1, colour + 0.001)).checks.map((c) => c.pass)).toEqual([true, true, false]);
    expect(traceVerdict(score(0.9, 0.9, 0), { iou: 0.95, iouClose: 0.5, colour: 0.1 }).pass).toBe(false); // other thresholds apply
    expect(TRACE_THRESHOLDS).toEqual({ iou: 0.85, iouClose: 0.85, colour: 0.04 }); // tuned on Phase 6's ten traces (docs/assets/tracing.md)
    // off the palette the colour limit sits on the source's floor
    const off = traceVerdict(score(1, 1, 0.12), TRACE_THRESHOLDS, 0.1);
    expect(off.pass).toBe(true);
    expect(off.checks[2]).toMatchObject({ limit: 0.14, floor: 0.1, pass: true });
    expect(traceVerdict(score(1, 1, 0.141), TRACE_THRESHOLDS, 0.1).pass).toBe(false);
    expect(traceVerdict(score(1, 1, 0.05)).pass).toBe(false); // on the palette, 0.04 is the limit
    const view = (scale: 'game' | 'close') => ({ yaw: 45, scale, ppm: 20, iou: 1, colour: 0.12, pixels: { source: 1, translation: 1, both: 1 } });
    expect(verdictLines({ ...score(1, 1, 0.12), views: [view('game'), view('close')] }, off).join('\n')).toMatch(/<= 0\.14 +pass +\(the palette floor 0\.1 \+ 0\.04\)/);
  });
});

/** Every triangle's colour, and the bounds, of a source mesh. */
function summary(m: SourceMesh): { tris: number; colours: string[]; min: Vec3; max: Vec3 } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) [lo[i % 3], hi[i % 3]] = [Math.min(lo[i % 3]!, m.positions[i]!), Math.max(hi[i % 3]!, m.positions[i]!)];
  return { tris: m.group.length, colours: Array.from(m.colours, (c) => c.toString(16)).sort(), min: lo as unknown as Vec3, max: hi as unknown as Vec3 };
}

/** Every trace in fixtures/trace/ and the source it was traced from (Phase 6's ten and the two proofs). */
const TRACES = [
  [treeTrace, 'asset:tree'],
  [cartTrace, 'gate-a:hand-cart-a'],
  [archwayTrace, 'gate-a:archway-a'],
  [campfireTrace, 'gate-a:campfire-a'],
  [rackTrace, 'gate-a:weapon-rack-a'],
  [smithyTrace, 'town:smithy'],
  [marketTrace, 'town:market'],
  [tentTrace, 'town:tent'],
  [obeliskTrace, 'town:obelisk'],
  [coinTrace, 'asset:coin'],
  [vorgathTrace, 'monster:vorgath'],
  [monsterTrace, 'monster:7'],
] as const;

describe('the traces (fixtures/trace/)', () => {
  // a drift guard: each still scores what its `source.fidelity` records, passes, and checks clean
  // (importing them here also type-checks them)
  it('lists every trace in the folder', () => {
    const files = readdirSync(join(ROOT, 'src/engine/model/fixtures/trace')).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3));
    expect(TRACES.map(([d]) => d.id).sort()).toEqual(files.sort());
  });
  for (const [draft, spec] of TRACES) {
    it(`${draft.id} scores what it records against ${spec}`, async () => {
      const src = await resolveSource(spec, { root: ROOT });
      expect(draft.source?.url).toBe(src.provenance.url);
      expect(draft.source?.tool).toBe('trace');
      const mesh = normalizeSource(src.mesh);
      const score = scoreFidelity({ positions: mesh.positions, colours: mesh.colours }, modelTriangles(draft));
      const floor = paletteFloor(mesh);
      const f = draft.source!.fidelity!;
      // to a few pixels: V8's Math differs in the last bit between Node versions
      expect(Math.abs(score.iou - f.iou!)).toBeLessThan(0.002);
      expect(Math.abs(score.iouClose - f.iouClose!)).toBeLessThan(0.002);
      expect(Math.abs(score.colour - f.colour!)).toBeLessThan(0.002);
      close(score.bounds, f.bounds!, 0.002);
      expect(traceVerdict(score, TRACE_THRESHOLDS, floor).pass).toBe(true);
      expect(traceOffset({ positions: mesh.positions, colours: mesh.colours }, modelTriangles(draft)).every((d) => Math.abs(d) < 0.01)).toBe(true);
      const check = checkModel(draft);
      expect([check.problems, check.warnings]).toEqual([[], []]);
    }, 30_000);
  }
});

describe('trace sources and export-glb', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const read = (bytes: Uint8Array) => readGltf(bytes, { inflate: (b) => new Uint8Array(inflateSync(b)) });

  it('exports a Kit build (gate-a:) and reads it back: same triangles, colours and bounds, its provenance carried', async () => {
    const src = await resolveSource('gate-a:hand-cart-a', { root: ROOT });
    expect(src.provenance).toEqual({ url: 'src/engine/model/fixtures/gate-a/hand-cart-a.ts', licence: OWN_LICENCE, author: 'riftlight' });
    const bytes = await sourceGlb(src);
    const back = await read(bytes);
    const [a, b] = [summary(src.mesh), summary(back)];
    expect(b.tris).toBe(a.tris);
    expect(b.colours).toEqual(a.colours);
    close(b.min, a.min, 1e-5);
    close(b.max, a.max, 1e-5);
    expect(new Set(back.groups.map((g) => g.material))).toEqual(new Set(['orange', 'red', 'slate', 'sand', 'night'])); // named after the PALETTE colours
    expect(glbProvenance(bytes)).toMatchObject({ spec: 'gate-a:hand-cart-a', url: 'src/engine/model/fixtures/gate-a/hand-cart-a.ts', licence: OWN_LICENCE });
    // where export-glb writes (a trace-src/ folder in a root's .scratch/), the file traces as its code, pinned by its hash
    mkdirSync(join(dir, '.scratch', 'trace-src'), { recursive: true });
    const file = join(dir, '.scratch', 'trace-src', 'cart.glb');
    writeFileSync(file, bytes);
    const again = await resolveSource(file, { root: dir });
    expect(again.provenance).toEqual({ ...src.provenance, sha256: createHash('sha256').update(bytes).digest('hex') });
    expect(summary(again.mesh).tris).toBe(a.tris);
    // elsewhere in .scratch/ (the import cache keeps downloads there, a trace-src/ inside it too) it is not
    for (const at of [['import-cache'], [], ['import-cache', 'trace-src'], ['import-cache', 'kit', 'trace-src']]) {
      mkdirSync(join(dir, '.scratch', ...at), { recursive: true });
      const cached = join(dir, '.scratch', ...at, 'kit.glb');
      writeFileSync(cached, bytes);
      expect((await resolveSource(cached, { root: dir })).provenance, at.join('/')).toMatchObject({ url: '', licence: '', file: 'kit.glb' });
    }
    expect([exportPath('.scratch/trace-src/a.glb'), exportPath('.scratch/e2e/model/trace-src/a.glb'), exportPath('.scratch/a.glb'), exportPath('.scratch/import-cache/a.glb'), exportPath('trace-src/a.glb'), exportPath('.scratch/trace-src/../a.glb'), exportPath('.scratch/import-cache/trace-src/a.glb'), exportPath('.scratch/x/trace-src\\a.glb')]).toEqual([true, true, false, false, false, false, false, false]);
    // a file named with a backslash, and a symlink into trace-src/, are not where export-glb writes
    if (process.platform !== 'win32') {
      mkdirSync(join(dir, '.scratch', 'x'), { recursive: true });
      writeFileSync(join(dir, '.scratch', 'x', 'trace-src\\kit.glb'), bytes);
      expect((await resolveSource(join(dir, '.scratch', 'x', 'trace-src\\kit.glb'), { root: dir })).provenance).toMatchObject({ url: '', licence: '' });
      symlinkSync(join(dir, '.scratch', 'import-cache', 'kit.glb'), join(dir, '.scratch', 'trace-src', 'link.glb'));
      expect((await resolveSource(join(dir, '.scratch', 'trace-src', 'link.glb'), { root: dir })).provenance).toMatchObject({ url: '', licence: '' });
    }
    // anywhere else, what a file says of itself is not trusted
    const outside = await resolveSource(file, { root: ROOT });
    expect(outside.provenance).toMatchObject({ url: '', licence: '', file: 'cart.glb' });
    expect(outside.notes.join()).toMatch(/pass --licence <spdx> --source <url>/);
    mkdirSync(join(dir, 'models'), { recursive: true });
    writeFileSync(join(dir, 'models', 'cart.glb'), bytes);
    writeFileSync(join(dir, 'models', 'dropped.glb'), bytes);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', 'models/cart.glb'], { cwd: dir });
    expect((await resolveSource(join(dir, 'models', 'cart.glb'), { root: dir })).provenance).toMatchObject({ url: 'models/cart.glb', licence: OWN_LICENCE }); // a file git tracks is itself the source
    expect((await resolveSource(join(dir, 'models', 'dropped.glb'), { root: dir })).provenance).toMatchObject({ url: '', licence: '' }); // one dropped in untracked may be anyone's
    if (process.platform !== 'win32') {
      writeFileSync(join(dir, 'models', 'c*.glb'), bytes); // a name git would read as a glob matching the tracked cart
      expect((await resolveSource(join(dir, 'models', 'c*.glb'), { root: dir })).provenance).toMatchObject({ url: '', licence: '' });
    }
    // a tracked file overwritten with another model's bytes is no longer what git has
    const crate = await sourceGlb({ spec: 'crate', name: 'crate', mesh: sourceFromModel(MODEL_LIBRARY.get('crate')), provenance: { url: 'x', licence: OWN_LICENCE }, notes: [] });
    writeFileSync(join(dir, 'models', 'cart.glb'), crate);
    expect((await resolveSource(join(dir, 'models', 'cart.glb'), { root: dir })).provenance).toMatchObject({ url: '', licence: '' });
  }, 30_000);

  it('keeps glow unlit through the GLB, and a def source keeps its part names', async () => {
    const glow: ModelDef = { id: 'lamp', about: 'A lamp', tags: ['test'], palette: { pole: 'night', light: 'sand' }, parts: [{ box: [0.1, 1, 0.1], at: [0, 0.5, 0], c: 'pole', name: 'pole' }, { box: [0.3, 0.3, 0.3], at: [0, 1.15, 0], c: 'light', glow: true, name: 'bulb' }] };
    const mesh = sourceFromModel(glow);
    const back = await read(await sourceGlb({ spec: 'lamp', name: 'lamp', mesh, provenance: { url: 'here', licence: OWN_LICENCE }, notes: [] }));
    expect(back.groups.map((g) => [g.node, g.unlit]).sort()).toEqual([['bulb', true], ['pole', false]]);
  });

  it('builds every town building, each in its own frame', async () => {
    // every entry: Town's private builders aren't type-checked, so a renamed one shows up here
    for (const name of Object.keys(TOWN_BUILDINGS)) {
      const b = summary((await resolveSource(`town:${name}`, { root: ROOT })).mesh);
      expect(b.tris, name).toBeGreaterThan(0);
      for (const v of [...b.min, ...b.max]) expect(Number.isFinite(v), name).toBe(true);
      // in town each stands 5 m or more from the plaza's centre; in its own frame, on its origin
      const centre = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
      expect(Math.hypot(centre[0]!, centre[1]!), `${name} centred on its own origin`).toBeLessThan(2.5);
    }
    // and turned back: in town the smithy stands turned 88° (its world box ~5 x 6.8), a house to face the plaza
    const smithy = summary((await resolveSource('town:smithy', { root: ROOT })).mesh);
    close([smithy.max[0] - smithy.min[0], smithy.max[2] - smithy.min[2]], [6.8, 4.97], 0.02);
    const house = summary((await resolveSource('town:house-teal', { root: ROOT })).mesh);
    close([house.max[0] - house.min[0]], [4.9], 0.02); // the ridge trim, w + 2 × overhang + 0.1, along its own x
    expect((await resolveSource('town:smithy', { root: ROOT })).provenance.url).toBe('src/riftlight/town/Town.ts');
    await expect(resolveSource('town:nowhere', { root: ROOT })).rejects.toThrow(/no town building 'nowhere'/);
  }, 120_000);

  it('names the Town method a building needs when it is gone', async () => {
    const entries = TOWN_BUILDINGS as Record<string, { method: string; framed: boolean }>;
    const before = entries.market!;
    entries.market = { ...before, method: 'marketStall' }; // as if Town.ts renamed it
    try {
      await expect(resolveSource('town:market', { root: ROOT })).rejects.toThrow(/town:market builds with Town\.marketStall\(kit, …\), which src\/riftlight\/town\/Town\.ts no longer has/);
    } finally {
      entries.market = before;
    }
  }, 60_000);

  it('builds a monster body without its rank ring', async () => {
    const boss = await resolveSource('monster:vorgath', { root: ROOT });
    expect(boss.mesh.groups.some((g) => g.node === 'EliteAura')).toBe(false); // a rank's ground ring, not the body
    expect(boss.mesh.group.length).toBeGreaterThan(1000);
    expect(boss.provenance.url).toBe('src/riftlight/monsters');
  }, 60_000);

  it('reads a generated asset and a pack model, each with its own provenance', async () => {
    const tree = await resolveSource('asset:tree', { root: ROOT });
    expect(tree.provenance).toMatchObject({ url: 'public/assets/tree.glb', licence: OWN_LICENCE, file: 'tree.glb' });
    expect(tree.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(tree.mesh.groups.map((g) => g.node).sort()).toEqual(['Leaves_High', 'Leaves_Low', 'Trunk']);
    // a pack's model keeps its own provenance (someone else's stays theirs)
    const crate = MODEL_LIBRARY.get('crate');
    const own = { url: 'src/engine/model/library/containers.ts', licence: OWN_LICENCE, author: 'riftlight' };
    writeFileSync(join(dir, 'kit.json'), JSON.stringify({ pack: 'kit', about: 'test', source: own, models: [{ ...crate, id: 'kit/crate', source: { ...own, pack: 'kit', tool: 'import', fidelity: { iou: 1 } } }] }));
    const packed = await resolveSource('pack:kit/crate', { root: ROOT, packs: dir });
    expect(packed.provenance).toEqual({ ...own, pack: 'kit' });
    expect(summary(packed.mesh).tris).toBe(modelTriangles('crate').colours.length);
    await expect(resolveSource('gate-a:../../etc', { root: ROOT })).rejects.toThrow(/name a file in src\/engine\/model\/fixtures\/gate-a/);
  });
});
