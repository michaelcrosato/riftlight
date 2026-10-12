/**
 * glTF and GLB → coloured source triangles, headless (docs/plans/asset-system.md §7.2). three's
 * `GLTFLoader` reads the geometry. It can't make images without a DOM, so this reads the file's
 * container itself first: its buffers (the GLB's own, data URIs, or files beside a `.gltf`) and
 * its texture images (embedded in a `bufferView` or beside the file), decoded by the engine's
 * PNG decoder. The textures are stripped before the loader sees the file; each face then takes
 * its colour from the material's base colour, its vertex colours and its texture, sampled at the
 * face's UV centroid, multiplied in linear light as glTF says.
 */
import { Color, LinearSRGBColorSpace, Matrix4, SRGBColorSpace, Vector3, type BufferAttribute, type InstancedMesh, type InterleavedBufferAttribute, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { decodePng, type Inflate, type RgbaImage } from '../../png';

/** A file a glTF names by `uri` (an external buffer or image), relative to the glTF itself. */
export type ReadFile = (uri: string) => Uint8Array;

/** A file the importer can't read, with what is wrong and what to do. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ReadOptions {
  /** Reads files beside the glTF (external buffers and images). */
  readonly readFile?: ReadFile;
  /** zlib inflate, for PNG textures (tools pass `node:zlib`'s `inflateSync`). */
  readonly inflate?: Inflate;
}

/** Where a run of triangles came from: one per (node, material). */
export interface SourceGroup {
  readonly node: string;
  readonly material: string;
  /** An unlit material (KHR_materials_unlit): its parts glow. */
  readonly unlit: boolean;
}

/** Triangles as the file has them: metres, +Y up, in the scene's frame. */
export interface SourceMesh {
  /** 9 numbers a triangle. */
  readonly positions: Float64Array;
  /** sRGB per triangle (0xrrggbb). */
  readonly colours: Uint32Array;
  /** Index into `groups` per triangle. */
  readonly group: Uint32Array;
  readonly groups: readonly SourceGroup[];
}

interface TexRef {
  readonly index: number;
  readonly texCoord?: number;
  readonly extensions?: { readonly KHR_texture_transform?: { readonly offset?: readonly number[]; readonly rotation?: number; readonly scale?: readonly number[]; readonly texCoord?: number } };
}
interface GltfJson {
  nodes?: { name?: string; mesh?: number }[];
  meshes?: { name?: string }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: TexRef } }[];
  textures?: { source?: number; sampler?: number; extensions?: Record<string, unknown> }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
  samplers?: { wrapS?: number; wrapT?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
/** Required extensions that leave geometry the loader can't read without a decoder. */
const UNSUPPORTED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression'];
/** Extensions about textures only: gone with the textures. */
const TEXTURE_EXTENSIONS = ['KHR_texture_transform', 'KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif'];
const REPEAT = 10497;
const MIRRORED = 33648;

function base64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A buffer's or an image's bytes from its uri: a data URI, or a file beside the glTF. */
function uriBytes(uri: string, o: ReadOptions, what: string): Uint8Array {
  const data = /^data:[^,]*?(;base64)?,(.*)$/s.exec(uri);
  if (data) return data[1] ? base64(data[2]!) : new TextEncoder().encode(decodeURIComponent(data[2]!));
  // a file beside the glTF, never a URL, another scheme or an absolute path
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || /^[\\/]/.test(uri)) throw new ImportError(`${what} is '${uri}': only files beside the glTF (or embedded data: URIs) are read`);
  if (!o.readFile) throw new ImportError(`${what} is the file '${uri}' beside the glTF, and no readFile was given to read it`);
  try {
    return o.readFile(decodeURIComponent(uri));
  } catch (e) {
    throw new ImportError(`${what} '${uri}' could not be read: ${(e as Error).message}`);
  }
}

/** A GLB or .gltf file's JSON and every buffer's bytes. */
function readContainer(bytes: Uint8Array, o: ReadOptions): { json: GltfJson; buffers: Uint8Array[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json: GltfJson;
  let bin: Uint8Array | null = null;
  if (bytes.length >= 12 && view.getUint32(0, true) === GLB_MAGIC) {
    if (view.getUint32(4, true) !== 2) throw new ImportError(`GLB version ${view.getUint32(4, true)}: only glTF 2.0 is supported`);
    let text = '';
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = view.getUint32(at, true);
      const type = view.getUint32(at + 4, true);
      const chunk = bytes.subarray(at + 8, at + 8 + size);
      if (type === CHUNK_JSON) text = new TextDecoder().decode(chunk);
      else if (type === CHUNK_BIN && !bin) bin = chunk;
      at += 8 + size;
    }
    if (!text) throw new ImportError('the GLB has no JSON chunk');
    json = JSON.parse(text) as GltfJson;
  } else {
    try {
      json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
    } catch {
      throw new ImportError('not a glTF file: neither GLB nor glTF JSON');
    }
  }
  const unsupported = (json.extensionsRequired ?? []).filter((e) => UNSUPPORTED.includes(e));
  if (unsupported.length) throw new ImportError(`its meshes are compressed (${unsupported.join(', ')}): re-export them uncompressed`);
  const buffers = (json.buffers ?? []).map((b, i) => {
    if (b.uri === undefined) {
      if (!bin) throw new ImportError(`buffer ${i} has no uri and the file has no binary chunk`);
      return bin;
    }
    return uriBytes(b.uri, o, `buffer ${i}`);
  });
  return { json, buffers };
}

/** One GLB holding the geometry and nothing about textures, for GLTFLoader. */
function geometryGlb(json: GltfJson, buffers: readonly Uint8Array[]): ArrayBuffer {
  const offsets: number[] = [];
  let size = 0;
  for (const b of buffers) {
    offsets.push(size);
    size += Math.ceil(b.length / 4) * 4;
  }
  const bin = new Uint8Array(size);
  buffers.forEach((b, i) => bin.set(b, offsets[i]));
  const strip = structuredClone(json) as GltfJson & Record<string, unknown>;
  strip.buffers = size ? [{ byteLength: size }] : [];
  strip.bufferViews = (json.bufferViews ?? []).map((v) => ({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + offsets[v.buffer]! }));
  delete strip.images;
  delete strip.textures;
  delete strip.samplers;
  // every texture reference, wherever a material or an extension keeps one
  const drop = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k.endsWith('Texture') && v && typeof v === 'object' && 'index' in v) delete (o as Record<string, unknown>)[k];
      else drop(v);
    }
  };
  drop(strip.materials);
  strip.extensionsUsed = json.extensionsUsed?.filter((e) => !TEXTURE_EXTENSIONS.includes(e));
  strip.extensionsRequired = json.extensionsRequired?.filter((e) => !TEXTURE_EXTENSIONS.includes(e));
  const text = new TextEncoder().encode(JSON.stringify(strip));
  const jsonLen = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + (size ? 8 + size : 0));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(text, 20);
  if (size) {
    dv.setUint32(20 + jsonLen, size, true);
    dv.setUint32(24 + jsonLen, CHUNK_BIN, true);
    out.set(bin, 28 + jsonLen);
  }
  return out.buffer;
}

/** A texture's image, decoded once; null when its material has no base-colour texture. */
interface Atlas {
  readonly img: RgbaImage;
  readonly wrap: readonly [number, number];
  readonly texCoord: number;
  /** KHR_texture_transform as a 2×3 matrix: u' = m0 u + m1 v + m2, v' = m3 u + m4 v + m5. */
  readonly transform: readonly number[];
}

function atlasOf(json: GltfJson, buffers: readonly Uint8Array[], material: number, o: ReadOptions, cache: Map<number, RgbaImage>): Atlas | null {
  const ref = json.materials?.[material]?.pbrMetallicRoughness?.baseColorTexture;
  if (!ref) return null;
  const tex = json.textures?.[ref.index];
  if (!tex) throw new ImportError(`material ${material} names texture ${ref.index}, which the file doesn't have`);
  if (tex.source === undefined) throw new ImportError(`texture ${ref.index} is only in ${Object.keys(tex.extensions ?? {}).join(', ') || 'no format'}: only PNG textures are supported; re-export them as PNG`);
  let img = cache.get(tex.source);
  if (!img) {
    const def = json.images?.[tex.source];
    if (!def) throw new ImportError(`texture ${ref.index} names image ${tex.source}, which the file doesn't have`);
    const what = `image ${tex.source}${def.name ? ` ('${def.name}')` : ''}`;
    let bytes: Uint8Array;
    if (def.bufferView !== undefined) {
      const v = json.bufferViews?.[def.bufferView];
      if (!v) throw new ImportError(`${what} names bufferView ${def.bufferView}, which the file doesn't have`);
      bytes = buffers[v.buffer]!.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    } else if (def.uri !== undefined) bytes = uriBytes(def.uri, o, what);
    else throw new ImportError(`${what} has neither a uri nor a bufferView`);
    if (!o.inflate) throw new ImportError(`${what} is a texture, and no inflate was given to decode PNGs`);
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new ImportError(`${what} is not a PNG (${def.mimeType ?? 'unknown type'}): only PNG textures are supported; re-export them as PNG`);
    img = decodePng(bytes, o.inflate);
    cache.set(tex.source, img);
  }
  const s = tex.sampler !== undefined ? json.samplers?.[tex.sampler] : undefined;
  const t = ref.extensions?.KHR_texture_transform;
  const [ou, ov] = t?.offset ?? [0, 0];
  const [su, sv] = t?.scale ?? [1, 1];
  const r = t?.rotation ?? 0;
  const [c, sn] = [Math.cos(r), Math.sin(r)];
  // T · R · S, as the extension defines it
  const transform = [c * su!, sn * sv!, ou!, -sn * su!, c * sv!, ov!];
  return { img, wrap: [s?.wrapS ?? REPEAT, s?.wrapT ?? REPEAT], texCoord: t?.texCoord ?? ref.texCoord ?? 0, transform };
}

/** Texel coordinate along one axis for a wrap mode (nearest texel). */
function wrapTexel(t: number, size: number, mode: number): number {
  let f: number;
  if (mode === REPEAT) f = t - Math.floor(t);
  else if (mode === MIRRORED) {
    const m = t - 2 * Math.floor(t / 2);
    f = m > 1 ? 2 - m : m;
  } else f = Math.min(1, Math.max(0, t));
  return Math.min(size - 1, Math.floor(f * size));
}

/** The atlas's texel (sRGB bytes) at a UV, glTF's way up (v = 0 is the image's top row). */
function texel(a: Atlas, u: number, v: number): [number, number, number] {
  const m = a.transform;
  const x = wrapTexel(m[0]! * u + m[1]! * v + m[2]!, a.img.width, a.wrap[0]);
  const y = wrapTexel(m[3]! * u + m[4]! * v + m[5]!, a.img.height, a.wrap[1]);
  const i = (y * a.img.width + x) * 4;
  return [a.img.data[i]!, a.img.data[i + 1]!, a.img.data[i + 2]!];
}

type Associations = Map<object, { nodes?: number; meshes?: number; materials?: number }>;

/** Read a glTF or GLB file: every triangle in the scene, coloured, grouped by node and material. */
export async function readGltf(bytes: Uint8Array, o: ReadOptions = {}): Promise<SourceMesh> {
  const { json, buffers } = readContainer(bytes, o);
  const gltf = await new GLTFLoader().parseAsync(geometryGlb(json, buffers), '');
  const assoc = gltf.parser.associations as unknown as Associations;
  const images = new Map<number, RgbaImage>();
  const atlases = new Map<number, Atlas | null>();
  const groups: SourceGroup[] = [];
  const groupIndex = new Map<string, number>();
  const positions: number[] = [];
  const colours: number[] = [];
  const group: number[] = [];
  const tmp = new Color();
  const v = [new Vector3(), new Vector3(), new Vector3()];
  const m = new Matrix4();
  const im = new Matrix4();

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj: Object3D) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    let nodeObj: Object3D | null = mesh;
    while (nodeObj && assoc.get(nodeObj)?.nodes === undefined) nodeObj = nodeObj.parent;
    const nodeIndex = nodeObj ? assoc.get(nodeObj)!.nodes! : -1;
    const nodeDef = json.nodes?.[nodeIndex];
    const meshIndex = assoc.get(mesh)?.meshes ?? nodeDef?.mesh;
    const node = nodeDef?.name || (meshIndex !== undefined ? json.meshes?.[meshIndex]?.name : undefined) || `node${nodeIndex}`;
    const material = mesh.material as Material & { color?: Color; vertexColors?: boolean; isMeshBasicMaterial?: boolean };
    const matIndex = assoc.get(material)?.materials ?? -1;
    const key = `${nodeIndex}|${matIndex}`;
    let g = groupIndex.get(key);
    if (g === undefined) {
      groupIndex.set(key, (g = groups.length));
      groups.push({ node, material: json.materials?.[matIndex]?.name ?? '', unlit: material.isMeshBasicMaterial === true });
    }
    if (!atlases.has(matIndex)) atlases.set(matIndex, matIndex >= 0 ? atlasOf(json, buffers, matIndex, o, images) : null);
    const atlas = atlases.get(matIndex)!;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as BufferAttribute | InterleavedBufferAttribute | undefined;
    if (!pos) return;
    const idx = geo.getIndex();
    const count = idx ? idx.count : pos.count;
    const vc = material.vertexColors ? (geo.getAttribute('color') as BufferAttribute | undefined) : undefined;
    const uv = atlas ? (geo.getAttribute(atlas.texCoord ? `uv${atlas.texCoord}` : 'uv') as BufferAttribute | undefined) : undefined;
    if (atlas && !uv) throw new ImportError(`node '${node}' has a textured material but no TEXCOORD_${atlas.texCoord}`);
    const base = material.color ?? new Color(1, 1, 1);
    const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh) : null;
    if (skinned) skinned.skeleton.update();
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      m.copy(mesh.matrixWorld);
      if (inst) m.multiply(inst.getMatrixAt(k, im));
      const flip = m.determinant() < 0; // mirrored: keep the faces outward
      for (let t = 0; t + 2 < count; t += 3) {
        const ids = [0, 1, 2].map((j) => (idx ? idx.getX(t + j) : t + j));
        if (flip) [ids[1], ids[2]] = [ids[2]!, ids[1]!];
        ids.forEach((id, j) => {
          if (skinned) skinned.getVertexPosition(id, v[j]!);
          else v[j]!.fromBufferAttribute(pos, id);
          v[j]!.applyMatrix4(m);
          positions.push(v[j]!.x, v[j]!.y, v[j]!.z);
        });
        // linear base × vertex colour × texel, back to sRGB
        let [r, gg, b] = [base.r, base.g, base.b];
        if (vc) {
          const avg = (c: 'getX' | 'getY' | 'getZ') => ids.reduce((s, id) => s + vc[c](id), 0) / 3;
          [r, gg, b] = [r * avg('getX'), gg * avg('getY'), b * avg('getZ')];
        }
        if (atlas && uv) {
          const [tu, tv] = [ids.reduce((s, id) => s + uv.getX(id), 0) / 3, ids.reduce((s, id) => s + uv.getY(id), 0) / 3];
          const [tr, tg, tb] = texel(atlas, tu, tv);
          tmp.setRGB(tr / 255, tg / 255, tb / 255, SRGBColorSpace);
          [r, gg, b] = [r * tmp.r, gg * tmp.g, b * tmp.b];
        }
        colours.push(tmp.setRGB(r, gg, b, LinearSRGBColorSpace).getHex(SRGBColorSpace));
        group.push(g);
      }
    }
  });
  if (!colours.length) throw new ImportError('the file has no triangles (no meshes in its default scene)');
  return { positions: new Float64Array(positions), colours: new Uint32Array(colours), group: new Uint32Array(group), groups };
}
