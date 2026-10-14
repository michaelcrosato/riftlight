// Mesh import (docs/plans/asset-system.md §7.2): round trips of our own models through GLB.
// Every fixture is made here, at test time, from the library (principle 5: no binaries, no
// third-party content, no network): GLBs from GLTFExporter, atlases from encodePng.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync, inflateSync } from 'node:zlib';
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { encodePng } from '../../../../scripts/png';
import { loadPack } from '../../assets';
import { PALETTE } from '../../palette';
import { layoutModel, modelDef, prepareModel } from '../build';
import { ModelCatalog } from '../catalog';
import { modelTriangles, scoreFidelity, type ColouredTris } from '../fidelity';
import { MODEL_LIBRARY } from '../library';
import { isLicenceFile, licenceFileProblem, licenceProblem, OWN_LICENCE, packSourceProblems } from '../packs/licences';
import { TEXTURE_LIBRARY, TextureCatalog } from '../../texture';
import { packIndexEntry, packProblems, packTextures, parsePack, parsePackIndex } from '../packs/pack';
import type { ModelDef, Part, Prim } from '../types';
import { validateModel } from '../validate';
import { describeImport, fileId, groupParts, IMPORT_ID, importGltf, importPack, ImportError, mapColours, nameTags, nameWords, normalizeSource, readGltf, rebindColours, unzip, type Imported } from '.';

// GLTFExporter writes binary through FileReader, which Node lacks
(globalThis as { FileReader?: unknown }).FileReader ??= class {
  result: unknown = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const SOURCE = { url: 'src/engine/model/library', licence: OWN_LICENCE, author: 'riftlight' };
/** An imported def's parts (imports are never parametric). */
const partsOf = (d: ModelDef) => d.parts as readonly Part[];
const NAMES = Object.keys(PALETTE) as (keyof typeof PALETTE)[];
/** The atlas: the 16 palette colours in a 4×4 grid of 4×4-texel cells, row by row from the top. */
const ATLAS = (() => {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const hex = PALETTE[NAMES[(y >> 2) * 4 + (x >> 2)]!];
      data.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], (y * 16 + x) * 4);
    }
  }
  return new Uint8Array(encodePng({ width: 16, height: 16, data }));
})();

type Variant = 'materials' | 'vertex' | 'atlas-embedded' | 'atlas-uri';

/** A GLB's JSON and binary chunk, edited, written back. */
function patchGlb(glb: Uint8Array, edit: (json: Record<string, unknown[]>, bin: Uint8Array) => Uint8Array): Uint8Array {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as Record<string, unknown[]>;
  const bin = edit(json, glb.subarray(28 + jsonLen, 28 + jsonLen + dv.getUint32(20 + jsonLen, true)));
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jl = Math.ceil(text.length / 4) * 4;
  const bl = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(28 + jl + bl);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, out.length, true);
  o.setUint32(12, jl, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl);
  out.set(text, 20);
  o.setUint32(20 + jl, bl, true);
  o.setUint32(24 + jl, 0x004e4942, true);
  out.set(bin, 28 + jl);
  return out;
}

/** The atlas cell of a palette colour, as three UVs inside it (their centroid is the cell's middle). */
function cellUVs(hex: number): number[] {
  const k = NAMES.findIndex((n) => PALETTE[n] === hex);
  const [u, v] = [((k % 4) + 0.5) / 4, (Math.floor(k / 4) + 0.5) / 4];
  return [u - 0.06, v - 0.03, u + 0.06, v - 0.03, u, v + 0.06];
}

/**
 * A library model as a glTF scene, coloured the four ways kits do: a named flat material per
 * slot (glow ones unlit); one mesh with vertex colours; one mesh on a palette atlas, embedded
 * in the GLB or a `.gltf` with its buffer and atlas in files beside it (written to `dir`).
 */
async function exportModel(id: string, variant: Variant, dir?: string): Promise<{ bytes: Uint8Array; readFile?: (uri: string) => Uint8Array }> {
  const def = modelDef(id);
  const { expansion, compiled } = prepareModel(def, {}, MODEL_LIBRARY);
  expect(compiled.pivots, `${id} has no pivots`).toEqual([]);
  const layout = layoutModel(compiled, expansion.model.palette);
  const scene = new Group();
  const geometry = (positions: Float32Array) => new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3));
  const lit = layout.meshes.filter((m) => !m.glow);
  for (const m of layout.meshes.filter((x) => x.glow || variant === 'materials')) {
    const mesh = new Mesh(geometry(m.positions), m.glow ? new MeshBasicMaterial({ color: new Color(m.hex), name: m.slot }) : new MeshStandardMaterial({ color: new Color(m.hex), name: m.slot }));
    mesh.name = m.slot;
    scene.add(mesh);
  }
  if (variant !== 'materials') {
    const positions = new Float32Array(lit.reduce((n, m) => n + m.positions.length, 0));
    const colours: number[] = [];
    const uvs: number[] = [];
    let at = 0;
    for (const m of lit) {
      positions.set(m.positions, at);
      at += m.positions.length;
      const c = new Color(m.hex); // linear, as glTF stores vertex colours
      for (let t = 0; t < m.positions.length / 9; t++) {
        for (let k = 0; k < 3; k++) colours.push(c.r, c.g, c.b);
        uvs.push(...cellUVs(m.hex));
      }
    }
    const g = geometry(positions);
    if (variant === 'vertex') g.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
    else g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    const mesh = new Mesh(g, new MeshStandardMaterial({ color: 0xffffff, vertexColors: variant === 'vertex', name: 'colormap' }));
    mesh.name = id;
    scene.add(mesh);
  }
  const glb = new Uint8Array((await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer);
  if (variant === 'materials' || variant === 'vertex') return { bytes: glb };
  // the exporter can't write images in Node: add the atlas to the file as a kit would have it
  let gltf: Record<string, unknown[]> = {};
  let binary: Uint8Array = new Uint8Array();
  const out = patchGlb(glb, (json, bin) => {
    const textured = (json.materials as { name: string; pbrMetallicRoughness: Record<string, unknown> }[]).find((m) => m.name === 'colormap')!;
    textured.pbrMetallicRoughness.baseColorTexture = { index: 0 };
    json.textures = [{ source: 0, sampler: 0 }];
    json.samplers = [{ magFilter: 9728, minFilter: 9728 }];
    if (variant === 'atlas-uri') {
      json.images = [{ uri: 'atlas.png' }];
      gltf = json;
      binary = bin;
      return bin;
    }
    const offset = Math.ceil(bin.length / 4) * 4;
    json.bufferViews!.push({ buffer: 0, byteOffset: offset, byteLength: ATLAS.length });
    json.images = [{ bufferView: json.bufferViews!.length - 1, mimeType: 'image/png' }];
    (json.buffers![0] as { byteLength: number }).byteLength = offset + ATLAS.length;
    const grown = new Uint8Array(offset + ATLAS.length);
    grown.set(bin);
    grown.set(ATLAS, offset);
    return grown;
  });
  if (variant === 'atlas-embedded') return { bytes: out };
  // a .gltf whose buffer and atlas are files beside it
  (gltf.buffers![0] as { uri?: string }).uri = 'model.bin';
  writeFileSync(join(dir!, 'model.bin'), binary);
  writeFileSync(join(dir!, 'atlas.png'), ATLAS);
  const readFile = (uri: string) => new Uint8Array(readFileSync(join(dir!, uri)));
  return { bytes: new TextEncoder().encode(JSON.stringify(gltf)), readFile };
}

/** Signed volume (m³) of triangles: positive when wound outward, negative inside out. */
function signedVolume(t: ColouredTris): number {
  const p = t.positions;
  let v = 0;
  for (let k = 0; k + 8 < p.length; k += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, i) => p[k + i]!);
    v += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6;
  }
  return v;
}

/** The original model's triangles, moved as the import moves its source (base on 0, footprint centred). */
function originalNormalized(id: string): ColouredTris {
  const t = modelTriangles(id);
  const p = Float64Array.from(t.positions as ArrayLike<number>);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) [lo[i % 3], hi[i % 3]] = [Math.min(lo[i % 3]!, p[i]!), Math.max(hi[i % 3]!, p[i]!)];
  const shift = [-(lo[0]! + hi[0]!) / 2, -lo[1]!, -(lo[2]! + hi[2]!) / 2];
  return { positions: p.map((v, i) => v + shift[i % 3]!), colours: t.colours };
}

const tmp = mkdtempSync(join(tmpdir(), 'riftlight-import-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function roundTrip(id: string, variant: Variant): Promise<Imported> {
  const dir = mkdtempSync(join(tmp, `${id}-`));
  const { bytes, readFile } = await exportModel(id, variant, dir);
  return importGltf(bytes, { id: `${id}-import`, source: { ...SOURCE, file: `${id}.glb` }, inflate: inflateSync, readFile });
}

const ROUND_TRIP = ['barrel', 'crate', 'well', 'market-stall', 'statue', 'lamp-post'];
const VARIANTS: Variant[] = ['materials', 'vertex', 'atlas-embedded', 'atlas-uri'];

describe('round trip: our def → GLB → import', () => {
  for (const id of ROUND_TRIP) {
    it(`${id}: IoU ≥ 0.98 at every view, exact colours, a clean check, every colour source`, async () => {
      for (const variant of VARIANTS) {
        const r = await roundTrip(id, variant);
        const what = `${id} (${variant})`;
        // every face read its colour exactly (material, vertex colours or atlas texel)
        const palette = new Set<number>(Object.values(PALETTE));
        expect([...new Set(r.source.colours)].filter((hex) => !palette.has(hex)).map((h) => h.toString(16)), what).toEqual([]);
        // the importer's own score: the def against the GLB it came from. Colours agree but for
        // the odd pixel where two faces nearly touch and welding to the millimetre swaps them
        for (const v of r.fidelity.views) expect(v.iou, `${what}: ${v.scale} yaw ${v.yaw}`).toBeGreaterThanOrEqual(0.98);
        expect(r.fidelity.colour, what).toBeLessThan(0.001);
        expect(r.def.source!.fidelity).toEqual({ iou: r.fidelity.iou, iouClose: r.fidelity.iouClose, colour: r.fidelity.colour, bounds: r.fidelity.bounds });
        // and against the original def itself: the same silhouettes in the same colours
        const back = scoreFidelity(originalNormalized(id), modelTriangles(r.def));
        for (const v of back.views) expect(v.iou, `${what} vs the original: ${v.scale} yaw ${v.yaw}`).toBeGreaterThanOrEqual(0.98);
        expect(back.colour, `${what} vs the original`).toBeLessThan(0.001);
        for (const b of back.bounds) expect(Math.abs(b), `${what} bounds`).toBeLessThanOrEqual(0.002);
        // faces wound as the original's (the rasterizer draws both sides, so IoU can't see this)
        const [vo, vi] = [signedVolume(originalNormalized(id)), signedVolume(modelTriangles(r.def))];
        expect(Math.abs(vi - vo), `${what}: signed volume ${vi.toFixed(4)} vs ${vo.toFixed(4)} m³`).toBeLessThan(0.02 * Math.abs(vo));
        // each slot maps back to the palette entry its source colour is
        for (const [slot, entry] of Object.entries(r.def.palette)) expect(PALETTE[entry], `${what}: slot ${slot}`).toBe(parseInt(r.def.source!.colours![slot]!.slice(1), 16));
        expect(validateModel(r.def).problems, what).toEqual([]);
        expect(r.report.triangles - r.report.dropped, what).toBeGreaterThan(0);
      }
    });
  }

  it('names slots after named materials, parts after nodes, and keeps glow', async () => {
    const barrel = await roundTrip('barrel', 'materials');
    expect(barrel.def.palette).toEqual({ wood: 'orange', band: 'slate', lid: 'red' });
    expect(partsOf(barrel.def).map((p) => (p as Prim).name)).toEqual(['wood', 'band', 'lid']);
    const lamp = await roundTrip('lamp-post', 'materials');
    const glow = partsOf(lamp.def).filter((p) => (p as Prim).glow);
    expect(glow.length).toBeGreaterThan(0);
    expect(new Set(glow.map((p) => ('mesh' in p ? Object.keys(p.mesh.f) : [(p as Prim).c])).flat())).toEqual(new Set(['flame']));
    // one mesh coloured by an atlas: generic slots, one per colour
    const atlas = await roundTrip('barrel', 'atlas-embedded');
    expect(Object.keys(atlas.def.palette)).toEqual(['c1', 'c2', 'c3']);
    expect(Object.values(atlas.def.palette).sort()).toEqual(['orange', 'red', 'slate']);
  });

  it('recognises exact boxes and cyls, and keeps the rest as meshes', async () => {
    const crate = await roundTrip('crate', 'materials');
    const body = partsOf(crate.def).find((p) => 'box' in p && (p as Prim).c === 'wood') as { box: number[]; at: number[] } | undefined;
    expect(body?.box).toEqual([0.68, 0.68, 0.68]);
    expect(body?.at).toEqual([0, 0.36, 0]);
    const barrel = await roundTrip('barrel', 'materials');
    const lid = partsOf(barrel.def).find((p) => (p as Prim).name === 'lid') as { cyl?: number[]; seg?: number };
    expect(lid.cyl).toEqual([0.48, 0.03, 0.48]);
    expect(lid.seg).toBe(10);
    expect('mesh' in partsOf(barrel.def).find((p) => (p as Prim).name === 'wood')!).toBe(true); // a lathe stays a mesh
  });
});

describe('groupParts: primitives only where the test is exact', () => {
  /** A part compiled to positions (metres) and one slot per triangle. */
  const tris = (part: Part) => {
    const t = modelTriangles({ id: 't', about: '', tags: [], palette: { a: 'red' }, parts: [part] });
    return { positions: t.positions, slots: Array.from({ length: t.colours.length }, () => 'a') };
  };
  const one = (part: Part) => {
    const t = tris(part);
    return groupParts(t.positions, t.slots).parts;
  };

  it('a turned box comes back as that box', () => {
    const [p] = one({ box: [0.5, 0.3, 0.2], at: [0.1, 0.4, -0.2], rot: [10, 20, 30] }) as unknown as [{ box: number[]; at: number[]; rot: number[] }];
    expect(p.box).toEqual([0.5, 0.3, 0.2]);
    expect(p.at).toEqual([0.1, 0.4, -0.2]);
    for (const [k, v] of [10, 20, 30].entries()) expect(Math.abs(p.rot[k]! - v)).toBeLessThan(0.1); // millimetre corners: a hundredth of a degree or so
  });

  it('a regular n-gon prism (and a stretched one, as cyl makes them) comes back as a cyl', () => {
    for (const seg of [3, 5, 6, 8, 12]) {
      const [p] = one({ cyl: [0.4, 0.5, 0.3], seg, at: [0, 0.25, 0], rot: [0, 15, 0] }) as unknown as [{ cyl: number[]; seg: number }];
      expect(p.seg, `seg ${seg}`).toBe(seg);
      expect(p.cyl, `seg ${seg}`).toEqual([0.4, 0.5, 0.3]);
    }
    const [lying] = one({ cyl: [0.12, 1.4, 0.12], at: [0, 1.55, 0], rot: [0, 0, 90], seg: 6 }) as unknown as [{ cyl: number[]; seg: number }];
    expect(lying.seg).toBe(6);
  });

  it('anything else stays a mesh: a tapered cyl, a moved corner, a missing face, mixed colours', () => {
    expect('mesh' in one({ cyl: [0.4, 0.5, 0.4], top: 0.5, seg: 8 })[0]!).toBe(true);
    const box = tris({ box: [0.5, 0.5, 0.5], at: [0, 0.25, 0] });
    const moved = Array.from(box.positions as ArrayLike<number>);
    for (let i = 0; i < moved.length; i += 3) if (moved[i] === 0.25 && moved[i + 1] === 0.5 && moved[i + 2] === 0.25) moved[i] = 0.254; // one corner 4 mm out
    expect('mesh' in groupParts(moved, box.slots).parts[0]!).toBe(true);
    expect('mesh' in groupParts(Array.from(box.positions as ArrayLike<number>).slice(9), box.slots.slice(1)).parts[0]!).toBe(true);
    expect('mesh' in groupParts(box.positions, box.slots.map((s, i) => (i ? s : 'b'))).parts[0]!).toBe(true);
  });

  it('welds to the millimetre and drops what collapses', () => {
    const p = [0, 0, 0, 0.0004, 0, 0, 0, 0.001, 0]; // the first two corners weld: degenerate
    const out = groupParts([...p, 0, 0, 0, 1, 0, 0, 0, 1, 0], ['a', 'a']);
    expect(out.dropped).toBe(1);
    expect(out.parts).toEqual([{ mesh: { v: '-500 -500 0,500 -500 0,-500 500 0', f: { a: '0 1 2' } }, at: [0.5, 0.5, 0] }]);
  });
});

describe('readGltf', () => {
  it('keeps the faces of a mirrored node outward', async () => {
    const box = new Mesh(new BoxGeometry(0.4, 0.2, 0.3), new MeshStandardMaterial({ color: new Color(PALETTE.red), name: 'paint' }));
    box.name = 'lid';
    box.scale.set(-1, 1, 1);
    box.position.set(0, 0.1, 0);
    const glb = new Uint8Array((await new GLTFExporter().parseAsync(box, { binary: true })) as ArrayBuffer);
    const r = await importGltf(glb, { id: 'mirrored', source: SOURCE });
    // a box comes back only when its volume is positive: wound outward
    expect(partsOf(r.def)).toEqual([{ box: [0.4, 0.2, 0.3], at: [0, 0.1, 0], c: 'paint', name: 'lid' }]);
  });
});

describe('slot names an object already has', () => {
  it("materials called 'constructor', 'valueOf' and 'toString' import, check and `use` cleanly", async () => {
    const scene = new Group();
    (['constructor', 'valueOf', 'toString'] as const).forEach((name, i) => {
      const cone = new Mesh(new ConeGeometry(0.2, 0.5, 7), new MeshStandardMaterial({ color: new Color([PALETTE.red, PALETTE.blue, PALETTE.green][i]!), name }));
      cone.name = name;
      cone.position.set(i * 0.5, 0.25, 0);
      scene.add(cone);
    });
    const glb = new Uint8Array((await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer);
    const r = await importGltf(glb, { id: 'cones', source: SOURCE });
    expect(r.def.palette).toEqual({ constructor: 'red', valueOf: 'blue', toString: 'green' });
    expect(partsOf(r.def).map((p) => Object.keys((p as { mesh: { f: object } }).mesh.f))).toEqual([['constructor'], ['valueOf'], ['toString']]);
    expect(r.fidelity.iou).toBeGreaterThanOrEqual(0.98);
    expect(validateModel(r.def).problems).toEqual([]);
    // and placed by another model, whose own slots map onto them
    const catalog = new ModelCatalog([...MODEL_LIBRARY.all(), r.def]);
    const shelf = { id: 'shelf', about: 'cones on a board', tags: [], palette: { board: 'orange' as const, constructor: 'red' as const }, parts: [{ box: [1.6, 0.1, 0.5], at: [0, 0.05, 0], c: 'board' }, { use: 'cones', at: [0, 0.1, 0] }] as Part[] };
    expect(validateModel(shelf, { catalog }).problems).toEqual([]);
    // its `valueOf` mapped onto the board's slot, `constructor` onto ours of that name, `toString` kept as cones.toString
    const mapped = { ...shelf, parts: [shelf.parts[0]!, { use: 'cones', at: [0, 0.1, 0], palette: { valueOf: 'board' } }] as Part[] };
    expect(validateModel(mapped, { catalog }).problems).toEqual([]);
    expect(new Set(Array.from(modelTriangles(mapped, { catalog }).colours))).toEqual(new Set([PALETTE.orange, PALETTE.red, PALETTE.green]));
  });
});

describe('normalizeSource', () => {
  it('scales, turns the front to +Z, puts the base on y = 0 and centres the footprint', () => {
    const src = { positions: Float64Array.from([10, 5, 20, 12, 7, 20, 10, 5, 24]), colours: Uint32Array.of(0), group: Uint32Array.of(0), groups: [{ node: 'n', material: '', unlit: false }] };
    expect(Array.from(normalizeSource(src, { scale: 0.5 }).positions)).toEqual([-0.5, 0, -1, 0.5, 1, -1, -0.5, 0, 1]);
    // front +x: the source's +X becomes +Z
    expect(Array.from(normalizeSource(src, { front: '+x' }).positions)).toEqual([2, 0, -1, 2, 2, 1, -2, 0, -1]);
    expect(() => normalizeSource(src, { scale: 0 })).toThrow(/scale 0 must be a number above 0/);
  });
});

describe('import errors say what to do', () => {
  it('refuses compressed meshes, other image formats and missing files', async () => {
    const { bytes } = await exportModel('crate', 'atlas-embedded');
    const draco = patchGlb(bytes, (json, bin) => ((json.extensionsRequired = ['KHR_draco_mesh_compression']), bin));
    await expect(readGltf(draco, { inflate: inflateSync })).rejects.toThrow(/compressed \(KHR_draco_mesh_compression\): re-export them uncompressed/);
    const jpeg = patchGlb(bytes, (json, bin) => ((json.images = [{ uri: 'atlas.jpg', mimeType: 'image/jpeg' }]), bin));
    await expect(readGltf(jpeg, { inflate: inflateSync, readFile: () => Uint8Array.of(0xff, 0xd8, 0xff) })).rejects.toThrow(/not a PNG \(image\/jpeg\): only PNG textures are supported/);
    await expect(readGltf(jpeg, { inflate: inflateSync })).rejects.toThrow(ImportError);
    await expect(readGltf(new TextEncoder().encode('hello'))).rejects.toThrow(/not a glTF file/);
    // only files beside the glTF: never a URL, another scheme or an absolute path
    for (const uri of ['https://example.test/atlas.png', 'file:///tmp/atlas.png', '/etc/atlas.png', 'C:/atlas.png']) {
      const away = patchGlb(bytes, (json, bin) => ((json.images = [{ uri }]), bin));
      await expect(readGltf(away, { inflate: inflateSync, readFile: () => ATLAS }), uri).rejects.toThrow(/only files beside the glTF \(or embedded data: URIs\) are read/);
    }
  });
});

/** A zip archive of files (stored or deflated), as kits ship. */
function zip(files: Record<string, Uint8Array>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  Object.entries(files).forEach(([name, data], i) => {
    const deflate = i % 2 === 1;
    const body = deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const n = new TextEncoder().encode(name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(8, deflate ? 8 : 0, true);
    h.setUint32(18, body.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, n.length, true);
    local.push(new Uint8Array(h.buffer), n, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, deflate ? 8 : 0, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + body.length;
  });
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...local, ...central, new Uint8Array(end.buffer)]));
}

describe('packs', () => {
  it('imports every model of a zipped pack with one shared colour map', async () => {
    const files: Record<string, Uint8Array> = { 'Kit/License.txt': new TextEncoder().encode('CC0') };
    for (const id of ['barrel', 'crate', 'well']) files[`Kit/Models/${id === 'well' ? 'Stone Well' : id}.glb`] = (await exportModel(id, 'materials')).bytes;
    const archive = unzip(zip(files), (b) => new Uint8Array(inflateRawSync(b)));
    expect([...archive.keys()]).toEqual(Object.keys(files));
    expect([...archive.values()].map((b) => b.length)).toEqual(Object.values(files).map((b) => b.length));
    const pack = await importPack(archive, { pack: 'test-kit', source: SOURCE, inflate: inflateSync });
    expect(pack.skipped).toEqual([]);
    expect(pack.models.map((m) => m.def.id)).toEqual(['test-kit/barrel', 'test-kit/crate', 'test-kit/stone-well']);
    // the same source colour is the same slot and entry in every model
    const wood = pack.models.map((m) => Object.entries(m.def.source!.colours!).find(([, hex]) => hex === '#ef7d57')![0]);
    expect(new Set(wood).size).toBe(1);
    for (const m of pack.models) {
      expect(m.def.source).toMatchObject({ pack: 'test-kit', licence: OWN_LICENCE, file: expect.stringMatching(/^Kit\/Models\//) });
      expect(m.fidelity.iou).toBeGreaterThanOrEqual(0.98);
      expect(validateModel(m.def).problems).toEqual([]);
    }
    expect(fileId('Models/Chair Desk.glb')).toBe('chair-desk');
    expect(fileId('wallCornerHalf.gltf')).toBe('wall-corner-half');
    expect(fileId('___.glb')).toBe('model');
    // ids name files: nothing that could climb out of public/packs or .scratch
    expect(['chair', 'kit/chair-2', '3d'].filter((id) => IMPORT_ID.test(id))).toHaveLength(3);
    expect(['../x', 'kit/../x', 'Kit', 'a/b/c', '/abs', '', 'kit/', 'a b'].filter((id) => IMPORT_ID.test(id))).toEqual([]);
  });

  it('a pack names and tags its models from their files, and re-binds the slots the agent picked', async () => {
    const files: Record<string, Uint8Array> = {};
    for (const id of ['barrel', 'crate']) files[`Kit/${id === 'crate' ? 'woodCrate_large' : 'barrel'}.glb`] = (await exportModel(id, 'materials')).bytes;
    const plain = await importPack(new Map(Object.entries(files)), { pack: 'test-kit', source: SOURCE, inflate: inflateSync });
    const slot = Object.entries(plain.models[0]!.def.source!.colours!).find(([, hex]) => hex === '#ef7d57')![0];
    expect(plain.models[0]!.def.palette[slot]).toBe('orange');
    const pack = await importPack(new Map(Object.entries(files)), { pack: 'test-kit', source: SOURCE, inflate: inflateSync, title: 'Test Kit 1.0', tags: ['props'], palette: { [slot]: 'red' } });
    const crate = pack.models.find((m) => m.def.id === 'test-kit/wood-crate-large')!.def;
    expect(crate.about).toBe('Wood crate large (imported from Test Kit 1.0: woodCrate_large.glb)');
    expect(crate.tags).toEqual(['imported', 'test-kit', 'props', 'container', 'wood']);
    expect(pack.models.find((m) => m.def.id === 'test-kit/barrel')!.def.tags).toEqual(['imported', 'test-kit', 'props', 'container', 'wood']);
    // the picked slot is red in every model that has it, and the source colour stays recorded
    for (const m of pack.models) if (m.def.palette[slot]) expect([m.def.palette[slot], m.def.source!.colours![slot]]).toEqual(['red', '#ef7d57']);
    for (const m of pack.models) expect(validateModel(m.def).problems).toEqual([]);
    // a slot the map doesn't have, or a colour that isn't an entry, is an error, never a silent no-op
    await expect(importPack(new Map(Object.entries(files)), { pack: 'test-kit', source: SOURCE, inflate: inflateSync, palette: { nope: 'red' } })).rejects.toThrow(/re-binds slot 'nope', which the colour map doesn't have/);
    const map = mapColours([{ hex: 0xef7d57, area: 1, name: 'wood' }, { hex: 0x333c57, area: 1, name: 'iron' }]);
    expect(() => rebindColours(map, { wood: 'mauve' as never })).toThrow(/'mauve', which isn't a PALETTE entry/);
    expect(rebindColours(map, { wood: 'green' }).slots.find((s) => s.slot === 'wood')!.colour).toBe('green');
    expect(map.slots.find((s) => s.slot === 'wood')!.colour).not.toBe('green'); // the map itself is left alone
  });

  it('names read as words and add the library\'s tags', () => {
    expect(nameWords('tree-pine-default-a')).toBe('Tree pine default a');
    expect(nameWords('bookcaseClosed_wide')).toBe('Bookcase closed wide');
    expect(nameTags('tree-pine-default-a')).toEqual(['nature', 'tree', 'plant']);
    expect(nameTags('chair-desk')).toEqual(['furniture', 'seat', 'table']);
    expect(nameTags('rocks-tall')).toEqual(['nature', 'stone']); // plurals count
    expect(nameTags('kitchen-stove-electric')).toEqual(['furniture', 'kitchen']);
    expect(nameTags('wall-narrow-stairs')).toEqual(['architecture', 'wall', 'stairs']);
    expect(nameTags('potion-red')).toEqual(['loot', 'potion', 'consumable']);
    expect(nameTags('zzz-unknown')).toEqual([]);
    expect(nameTags('tower-constructor-toString')).toEqual(['architecture', 'tower']); // words that name Object's own members add nothing
    expect(nameTags('tree-leaves')).toEqual(['nature', 'tree', 'plant']);
    expect(describeImport('knight', { pack: 'tiny', title: 'Tiny Dungeon', tags: ['sprite', 'character'] })).toEqual({ about: 'Knight (imported from Tiny Dungeon)', tags: ['imported', 'tiny', 'sprite', 'character'] });
    expect(describeImport('x')).toEqual({ about: 'X (imported)', tags: ['imported'] });
  });

  it('a pack file can carry textures; the index lists every pack', async () => {
    const r = await roundTrip('crate', 'materials');
    const tex = { ...TEXTURE_LIBRARY.get('bricks'), id: 'test-pack/bricks', source: { ...SOURCE, pack: 'test-pack' } };
    const file = { pack: 'test-pack', title: 'Test Pack', about: 'a test', source: SOURCE, models: [{ ...r.def, source: { ...r.def.source!, pack: 'test-pack' } }], textures: [tex] };
    const pack = parsePack(file);
    expect(packTextures(pack).get('test-pack/bricks')).toBe(tex);
    expect(packProblems(pack)).toEqual([]);
    expect(packProblems({ ...pack, textures: [{ ...tex, source: SOURCE }] }).join()).toMatch(/'test-pack\/bricks' says it comes from no pack/);
    expect(() => parsePack({ ...file, textures: [{ id: 'x' }] })).toThrow(/textures\[0\] is not a TextureDef/);
    expect(() => parsePack({ ...file, textures: 'x' })).toThrow(/`textures` is not a list/);
    expect(parsePack({ ...file, textures: [] }).textures).toBeUndefined();
    expect(packTextures(parsePack({ ...file, textures: undefined })).all()).toEqual([]);
    // loadPack hands the textures to a texture catalog of yours
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(file))));
    try {
      const textures = new TextureCatalog();
      const models = await loadPack('/packs/test-pack-textures.json', { textures });
      expect(models.all().map((d) => d.id)).toEqual(['crate-import']);
      expect(textures.all().map((d) => d.id)).toEqual(['test-pack/bricks']);
    } finally {
      vi.unstubAllGlobals();
    }
    const entry = packIndexEntry(pack);
    expect(entry).toEqual({ id: 'test-pack', title: 'Test Pack', about: 'a test', file: 'test-pack.json', models: 1, textures: 1, licence: SOURCE.licence, author: SOURCE.author, url: SOURCE.url });
    expect(parsePackIndex({ packs: [entry] }).packs).toEqual([entry]);
    expect(() => parsePackIndex({})).toThrow(/not a pack index/);
    expect(() => parsePackIndex({ packs: [{ title: 'x' }] })).toThrow(/packs\[0\] has no id and file/);
  });

  it('loadPack fetches a pack file once and hands back its catalog', async () => {
    const r = await roundTrip('crate', 'materials');
    const file = { pack: 'test-pack', about: 'a test', source: SOURCE, models: [r.def] };
    const fetch = vi.fn(async () => new Response(JSON.stringify(file)));
    vi.stubGlobal('fetch', fetch);
    try {
      const into = new ModelCatalog();
      const catalog = await loadPack('/packs/test-pack.json', { into });
      expect(catalog.all().map((d) => d.id)).toEqual(['crate-import']);
      expect(into.get('crate-import')).toBe(catalog.get('crate-import'));
      await loadPack('/packs/test-pack.json');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(validateModel('crate-import', { catalog }).problems).toEqual([]);
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{"pack":"x"}')));
      await expect(loadPack('/packs/broken.json')).rejects.toThrow(/pack \/packs\/broken.json: no `source` with url and licence/);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(() => parsePack({ pack: 'p', source: SOURCE, models: [{ id: 'x' }] })).toThrow(/models\[0\] is not a ModelDef/);
  });

  it('licences: our own work anywhere; anyone else\'s only from an approved pack, CC0 included', () => {
    const src = (licence: string, pack?: string, url = 'https://example.test/kit.zip') => ({ url, licence, ...(pack ? { pack } : {}) });
    const own = (url: string) => ({ url, licence: OWN_LICENCE });
    expect(licenceProblem(own('scripts/generate-assets.mjs'))).toBeNull();
    expect(licenceProblem(src(''))).toMatch(/has no licence/);
    expect(licenceProblem({ url: '', licence: OWN_LICENCE })).toMatch(/has no url/);
    expect(licenceProblem(src('CC-BY-NC-4.0'))).toMatch(/licence 'CC-BY-NC-4.0' is not allowed/);
    // a single third-party file, even CC0, says which approved source it comes from (#49)
    expect(licenceProblem(src('CC0-1.0'))).toMatch(/licence 'CC0-1.0' is not allowed without an approved pack \(it names no pack/);
    expect(licenceProblem(src('CC-BY-4.0'))).toMatch(/not allowed without an approved pack \(it names no pack/);
    expect(licenceProblem(src('CC-BY-4.0', 'icons'))).toMatch(/pack 'icons', which is not approved/);
    const approved = [{ id: 'icons', url: 'u', sha256: 'h', licence: 'CC-BY-4.0', author: 'a', homepage: 'h', approved: 'https://github.com/michaelcrosato/riftlight/issues/49#issuecomment-1' }];
    expect(licenceProblem(src('CC-BY-4.0', 'icons'), approved)).toBeNull();
    expect(licenceProblem(src('CC-BY-4.0', 'icons'), [{ ...approved[0]!, approved: '' }])).toMatch(/not approved/);
    // our own work points inside this repository: a path in it, or its GitHub URL
    for (const url of ['src/engine/model/library', 'public/assets/tree.glb', 'https://github.com/michaelcrosato/riftlight/blob/main/scripts/generate-assets.mjs']) expect(licenceProblem(own(url)), url).toBeNull();
    for (const url of ['https://kenney.nl/assets/furniture-kit', 'http://github.com/michaelcrosato/riftlight/', 'https://github.com/michaelcrosato/riftlight-fork/x', 'https://github.com/someone/else', 'file:///home/x.glb', '/home/user/x.glb', '../elsewhere/x.glb', 'C:/x.glb', 'kenney.nl/assets/furniture-kit', '//kenney.nl/kit', 'https://github.com/michaelcrosato/riftlight/../../kenney/kit', 'https://github.com/michaelcrosato/riftlight/%2e%2e/%2e%2e/kenney/kit'])
      expect(licenceProblem(own(url)), url).toMatch(/own work with an outside source/);
    // the check reports it on the model
    const mesh: Part = { mesh: { v: '0 0 0,1000 0 0,0 1000 0', f: { a: '0 1 2' } } };
    const def = (source: { url: string; licence: string }) => ({ id: 'x', about: 'x', tags: [], palette: { a: 'red' as const }, parts: [mesh], source });
    expect(validateModel(def(src(''))).problems.join()).toMatch(/has no licence/);
    expect(validateModel(def(src('CC0-1.0'))).problems.join()).toMatch(/not allowed without an approved pack/);
    expect(validateModel(def(own('https://kenney.nl/kit'))).problems.join()).toMatch(/own work with an outside source/);
    expect(validateModel(def(own('src/engine/model/library'))).problems).toEqual([]);
  });

  it('a third-party pack needs its own approved PACK_SOURCES entry, whatever its licence', () => {
    const src = (licence: string, pack?: string, url = 'https://example.test/kit.zip') => ({ url, licence, ...(pack ? { pack } : {}) });
    const entry = { id: 'kit', url: 'u', sha256: 'a'.repeat(64), licence: 'CC0-1.0', author: 'a', homepage: 'h', approved: 'https://github.com/michaelcrosato/riftlight/issues/49#issuecomment-123' };
    // CC0 in a pack nobody approved: refused (it is someone else's pack)
    expect(licenceProblem(src('CC0-1.0', 'thirdparty'))).toMatch(/pack 'thirdparty', which is not approved/);
    expect(licenceProblem(src('CC0-1.0', 'kit'), [entry])).toBeNull();
    expect(licenceProblem(src('CC0-1.0', 'kit'), [{ ...entry, approved: '' }])).toMatch(/pack 'kit', which is not approved/);
    expect(licenceProblem(src('CC0-1.0', 'kit'), [{ ...entry, approved: 'https://github.com/someone/else/issues/1' }])).toMatch(/pack 'kit', which is not approved/);
    expect(licenceProblem(src('CC0-1.0', 'kit'), [{ ...entry, licence: 'CC-BY-4.0' }])).toMatch(/approved for CC-BY-4.0, not CC0-1.0/);
    // our own pack needs no entry
    expect(licenceProblem(src(OWN_LICENCE, 'ours', 'src/engine/model/library'))).toBeNull();
    // the check reports it on the model, and on the pack file
    const model = { id: 'thirdparty/well', about: 'x', tags: [], palette: { a: 'red' as const }, parts: [{ mesh: { v: '0 0 0,1000 0 0,0 1000 0', f: { a: '0 1 2' } } }] as Part[], source: src('CC0-1.0', 'thirdparty') };
    expect(validateModel(model).problems.join()).toMatch(/pack 'thirdparty', which is not approved/);
    expect(packProblems({ pack: 'thirdparty', about: '', source: src('CC0-1.0'), models: [] }).join()).toMatch(/pack 'thirdparty', which is not approved/);
    expect(packProblems({ pack: 'ours', about: '', source: src(OWN_LICENCE, undefined, 'scripts'), models: [{ ...model, id: 'ours/well', source: src(OWN_LICENCE, 'other', 'scripts') }] }).join()).toMatch(/'ours\/well' says it comes from pack 'other'/);
    expect(packProblems({ pack: 'ours', about: '', source: src(OWN_LICENCE, undefined, 'scripts'), models: [{ ...model, id: 'ours/well', source: src(OWN_LICENCE, 'ours', 'scripts') }] })).toEqual([]);
  });

  it('every PACK_SOURCES entry links an approval on #49, pins a sha256 and names a known licence', () => {
    expect(packSourceProblems()).toEqual([]);
    const good = { id: 'kit', url: 'https://example.test/kit.zip', sha256: 'ab'.repeat(32), licence: 'CC0-1.0', author: 'a', homepage: 'https://example.test', approved: 'https://github.com/michaelcrosato/riftlight/issues/49#issuecomment-123' };
    expect(packSourceProblems([good])).toEqual([]);
    const bad = packSourceProblems([{ ...good, id: 'Kit/..', sha256: 'abc', licence: 'CC-BY-SA-4.0', approved: 'https://github.com/michaelcrosato/riftlight/issues/50#issuecomment-1' }, good, good]);
    expect(bad.join('\n')).toMatch(/its id must match/);
    expect(bad.join('\n')).toMatch(/64 lower-case hex/);
    expect(bad.join('\n')).toMatch(/licence 'CC-BY-SA-4.0' is not one of/);
    expect(bad.join('\n')).toMatch(/approved must link the owner's comment on #49/);
    expect(bad.join('\n')).toMatch(/pack 'kit' is listed twice/);
    // the import settings an agent writes: tags, slot re-bindings and 2D sheets
    expect(packSourceProblems([{ ...good, title: 'Kit', tags: ['props'], palette: { wood: 'orange' }, sheets: [{ file: 'Sheet.png', grid: [16, 16], names: ['grass', '', 'knight'], tiles: ['grass'], tags: ['sprite'], palette: { c2: 'sand' } }] }])).toEqual([]);
    const wrong = packSourceProblems([{ ...good, tags: ['Props'], palette: { wood: 'brown' as never }, sheets: [{ file: '', grid: [16, 0] as [number, number], names: ['a', 'B', 'a'], tiles: ['grass'], tags: ['x y'], palette: { c1: 'beige' as never } }] }]).join('\n');
    for (const re of [/tag 'Props' isn't lower-case/, /binds slot 'wood' to 'brown', which isn't a PALETTE entry/, /a sheet needs the file/, /grid must be \[width, height\]/, /cell name 'B' isn't lower-case/, /cell name 'a' is given twice/, /tiles names 'grass', which no cell is called/, /tag 'x y' isn't lower-case/, /sheet '': palette binds slot 'c1' to 'beige'/]) expect(wrong).toMatch(re);
    expect(packSourceProblems([{ ...good, scale: 2 }])).toEqual([]);
    for (const scale of [0, -1, Number.NaN]) expect(packSourceProblems([{ ...good, scale }]).join(), String(scale)).toMatch(/scale .* isn't a number above 0/);
  });

  it('a download must name its licence in a licence file, and nothing more restrictive', () => {
    const f = (text: string, name = 'Kit/License.txt') => ({ name, text });
    expect(['Kit/License.txt', 'LICENSE', 'copying.md', 'Kit/Models/chair.glb', 'licenses/CC0.txt'].map(isLicenceFile)).toEqual([true, true, true, false, true]);
    expect(licenceFileProblem('CC0-1.0', [f('License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/')])).toBeNull();
    expect(licenceFileProblem('CC0-1.0', [f('These assets are in the public domain.')])).toMatch(/names CC0-1.0/);
    expect(licenceFileProblem('CC0-1.0', [])).toMatch(/no licence file/);
    expect(licenceFileProblem('CC0-1.0', [f('CC0'), f('Some models: CC BY-NC 4.0', 'Kit/extra/LICENSE')])).toMatch(/LICENSE names terms that aren't allowed \(BY-NC\)/);
    expect(licenceFileProblem('CC-BY-4.0', [f('Licensed under CC BY 4.0, credit the author')])).toBeNull();
    expect(licenceFileProblem('CC-BY-4.0', [f('Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)')])).not.toBeNull();
    expect(licenceFileProblem('CC-BY-4.0', [f('CC0')])).toMatch(/names CC-BY-4.0/);
  });
});
