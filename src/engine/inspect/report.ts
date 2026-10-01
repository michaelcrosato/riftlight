/**
 * Asset inspection: counts, bounds, joints, clips and warnings for any Object3D, plus a
 * diff of two reports. Pure (no GPU, no DOM): `npm run inspect` and tests run it in Node.
 *
 *   const r = inspectObject(gltf.scene, { clips: gltf.animations, joints: HERO_RIG.joints });
 *   r.triangles; r.drawCalls; r.bounds.size; r.warnings
 *   const d = diffReports(before, after);   // deltas, added/removed joints, clips, materials
 */
import type { BufferGeometry, Material, Mesh, Object3D, SkinnedMesh, Texture } from 'three/webgpu';
import { Box3, Vector3 } from 'three/webgpu';

export interface ClipInfo {
  readonly name: string;
  /** Seconds. */
  readonly duration: number;
  readonly loop?: boolean;
  /** Animated tracks / joints (when known). */
  readonly tracks?: number;
  readonly frames?: number;
}

export interface InspectOptions {
  /** Display name. */
  readonly name?: string;
  /** Joint names when the rig is not a three Skeleton (rigid parts parented to joints). */
  readonly joints?: readonly string[];
  /** three AnimationClips or plain clip info. */
  readonly clips?: readonly ({ name: string; duration: number; tracks?: readonly unknown[] } | ClipInfo)[];
  /** Warning thresholds. */
  readonly limits?: Partial<InspectLimits>;
}

export interface InspectLimits {
  /** Largest bounds side (m) before "huge bounds". */
  readonly maxSize: number;
  /** Smallest bounds side (m) before "tiny". */
  readonly minSize: number;
  readonly maxMaterials: number;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
}

export const DEFAULT_LIMITS: InspectLimits = { maxSize: 40, minSize: 0.02, maxMaterials: 12, maxDrawCalls: 64, maxTriangles: 20000 };

export interface MeshInfo {
  readonly name: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly materials: number;
  readonly skinned: boolean;
  readonly instances: number;
}

export interface InspectReport {
  readonly name: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly meshes: number;
  readonly drawCalls: number;
  readonly materials: readonly { name: string; type: string; color: string | null; count: number }[];
  readonly textures: number;
  /** Distinct material type + colour pairs (what the engine's cached toon materials collapse to). */
  readonly colours: number;
  /** Distinct BufferGeometries (shared geometry is counted once here, every use in triangles). */
  readonly geometries: number;
  readonly nodes: number;
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[]; readonly size: readonly number[] };
  readonly joints: readonly string[];
  readonly skinned: boolean;
  readonly clips: readonly ClipInfo[];
  /** The heaviest meshes. */
  readonly topMeshes: readonly MeshInfo[];
  readonly warnings: readonly string[];
  /** Stable hash of geometry + structure: changes when the asset changes. */
  readonly fingerprint: string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const mats = (m: Material | Material[]): Material[] => (Array.isArray(m) ? m : [m]);
const TEXTURE_SLOTS = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap', 'lightMap', 'specularMap', 'envMap'] as const;

function trianglesOf(g: BufferGeometry): number {
  const idx = g.getIndex();
  return Math.floor((idx ? idx.count : (g.getAttribute('position')?.count ?? 0)) / 3);
}

/** Joints: explicit names, else Skeleton bones, else Bone nodes. */
export function jointsOf(object: Object3D, explicit?: readonly string[]): string[] {
  if (explicit?.length) return explicit.filter((n) => !!object.getObjectByName(n));
  const bones = new Set<string>();
  object.traverse((o) => {
    const sm = o as SkinnedMesh;
    if (sm.isSkinnedMesh && sm.skeleton) for (const b of sm.skeleton.bones) bones.add(b.name);
    if ((o as { isBone?: boolean }).isBone) bones.add(o.name);
  });
  return [...bones];
}

export function inspectObject(object: Object3D, o: InspectOptions = {}): InspectReport {
  const limits = { ...DEFAULT_LIMITS, ...o.limits };
  object.updateMatrixWorld(true);
  const warnings: string[] = [];
  const materialUse = new Map<Material, number>();
  const textures = new Set<Texture>();
  const geometries = new Set<BufferGeometry>();
  const meshes: MeshInfo[] = [];
  let tris = 0;
  let verts = 0;
  let drawCalls = 0;
  let nodes = 0;
  let degenerate = 0;
  let nan = 0;
  const noNormals: string[] = [];
  const nonUniform: string[] = [];
  const mirrored: string[] = [];
  let skinned = false;
  let hash = 2166136261;
  const mix = (v: number) => {
    hash = Math.imul(hash ^ (Math.round(v * 1e4) | 0), 16777619) >>> 0;
  };
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  object.traverse((x) => {
    nodes++;
    const s = x.scale;
    const mx = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    if (mx > 0 && x.children.length && (Math.abs(Math.abs(s.x) - mx) > 1e-3 * mx || Math.abs(Math.abs(s.y) - mx) > 1e-3 * mx || Math.abs(Math.abs(s.z) - mx) > 1e-3 * mx)) nonUniform.push(x.name || x.type);
    if (s.x * s.y * s.z < 0) mirrored.push(x.name || x.type);
    const mesh = x as Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const instances = (mesh as { isInstancedMesh?: boolean; count?: number }).isInstancedMesh ? ((mesh as { count?: number }).count ?? 1) : 1;
    const t = trianglesOf(g);
    const ms = mats(mesh.material);
    const groups = g.groups.length ? g.groups.length : 1;
    tris += t * instances;
    verts += pos.count * instances;
    drawCalls += Array.isArray(mesh.material) ? groups : 1; // groups only split draws with a material array
    geometries.add(g);
    if ((mesh as SkinnedMesh).isSkinnedMesh) skinned = true;
    for (const m of ms) {
      materialUse.set(m, (materialUse.get(m) ?? 0) + 1);
      for (const slot of TEXTURE_SLOTS) {
        const tex = (m as unknown as Record<string, Texture | null | undefined>)[slot];
        if (tex && (tex as Texture).isTexture) textures.add(tex);
      }
    }
    if (!g.getAttribute('normal')) noNormals.push(mesh.name || 'mesh');
    meshes.push({ name: mesh.name || mesh.parent?.name || 'mesh', triangles: t * instances, vertices: pos.count * instances, materials: ms.length, skinned: !!(mesh as SkinnedMesh).isSkinnedMesh, instances });
    // degenerate triangles, NaNs and the fingerprint (local space: the geometry itself)
    const idx = g.getIndex();
    for (let i = 0; i < t; i++) {
      const ia = idx ? idx.getX(i * 3) : i * 3;
      const ib = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
      const ic = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      if (![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(Number.isFinite)) {
        nan++;
        continue;
      }
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      if (area < 1e-9) degenerate++;
    }
    for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 64))) mix(pos.getX(i) + 3 * pos.getY(i) + 7 * pos.getZ(i));
    mix(t);
    mix(pos.count);
    const wp = mesh.getWorldPosition(new Vector3());
    mix(wp.x + 3 * wp.y + 7 * wp.z);
  });

  const box = new Box3().setFromObject(object, true);
  const empty = box.isEmpty();
  const size = empty ? new Vector3() : box.getSize(new Vector3());
  const joints = jointsOf(object, o.joints);
  for (const j of joints) for (const ch of j) mix(ch.charCodeAt(0));

  // joints that drive nothing: skinned → no vertex weight on the bone; rigid → no mesh below it
  const unweighted: string[] = [];
  if (skinned) {
    const used = new Set<string>();
    object.traverse((x) => {
      const sm = x as SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const si = sm.geometry.getAttribute('skinIndex');
      const sw = sm.geometry.getAttribute('skinWeight');
      if (!si || !sw) return;
      for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0) used.add(sm.skeleton.bones[si.getComponent(i, k)]?.name ?? '');
    });
    for (const j of joints) if (!used.has(j)) unweighted.push(j);
  } else {
    for (const j of joints) {
      const node = object.getObjectByName(j);
      let drives = false;
      node?.traverse((x) => {
        if ((x as Mesh).isMesh) drives = true;
      });
      if (!drives) unweighted.push(j);
    }
  }

  const clips: ClipInfo[] = (o.clips ?? []).map((cl) => ('tracks' in cl && Array.isArray(cl.tracks) ? { name: cl.name, duration: r3(cl.duration), tracks: cl.tracks.length } : { ...(cl as ClipInfo), duration: r3(cl.duration) }));
  for (const cl of clips) mix(cl.duration + cl.name.length);

  // ---- warnings
  if (!meshes.length) warnings.push('no meshes');
  if (degenerate) warnings.push(`${degenerate} degenerate triangles (zero area)`);
  if (nan) warnings.push(`${nan} triangles with NaN/Infinity positions`);
  if (noNormals.length) warnings.push(`missing normals on ${noNormals.length} meshes (${noNormals.slice(0, 4).join(', ')}): toon shading needs them`);
  const colours = new Set([...materialUse.keys()].map((m) => `${m.type}:${(m as Material & { color?: { getHexString(): string } }).color?.getHexString() ?? ''}`)).size;
  if (colours > limits.maxMaterials) warnings.push(`${colours} distinct materials (> ${limits.maxMaterials}): every material is a pipeline and a draw call`);
  else if (materialUse.size > limits.maxMaterials) warnings.push(`${materialUse.size} material objects for ${colours} distinct colours: share them (the engine's toon re-shade does, by colour)`);
  if (drawCalls > limits.maxDrawCalls) warnings.push(`${drawCalls} draw calls (> ${limits.maxDrawCalls}): merge static parts by material`);
  if (tris > limits.maxTriangles) warnings.push(`${tris} triangles (> ${limits.maxTriangles}) for a pixel-art asset`);
  if (!empty && Math.max(size.x, size.y, size.z) > limits.maxSize) warnings.push(`huge bounds ${size.toArray().map(r3).join(' × ')} m (> ${limits.maxSize} m): wrong units?`);
  if (!empty && Math.max(size.x, size.y, size.z) < limits.minSize) warnings.push(`tiny bounds ${size.toArray().map(r3).join(' × ')} m: wrong units?`);
  if (!empty && box.min.y < -0.05 * Math.max(1, size.y)) warnings.push(`extends ${r3(-box.min.y)} m below the floor (y = 0)`);
  if (nonUniform.length) warnings.push(`non-uniform scale on ${nonUniform.length} nodes with children (${nonUniform.slice(0, 4).join(', ')}): their children's rotations shear`);
  if (mirrored.length) warnings.push(`negative scale on ${mirrored.length} nodes (${mirrored.slice(0, 4).join(', ')}): flips triangle winding`);
  if (unweighted.length) warnings.push(`${unweighted.length} joints ${skinned ? 'with no vertex weights' : 'with no mesh under them'} (${unweighted.slice(0, 6).join(', ')}${unweighted.length > 6 ? ', …' : ''})`);
  for (const cl of clips) if (!(cl.duration > 0)) warnings.push(`clip ${cl.name} has no length`);

  const materials = [...materialUse].map(([m, count]) => {
    const col = (m as Material & { color?: { getHexString(): string } }).color;
    return { name: m.name || '(unnamed)', type: m.type, color: col ? `#${col.getHexString()}` : null, count };
  });
  return {
    name: o.name ?? (object.name || 'object'),
    triangles: tris,
    vertices: verts,
    meshes: meshes.length,
    drawCalls,
    materials,
    textures: textures.size,
    colours,
    geometries: geometries.size,
    nodes,
    bounds: { min: empty ? [0, 0, 0] : box.min.toArray().map(r3), max: empty ? [0, 0, 0] : box.max.toArray().map(r3), size: size.toArray().map(r3) },
    joints,
    skinned,
    clips,
    topMeshes: [...meshes].sort((x, y) => y.triangles - x.triangles).slice(0, 8),
    warnings,
    fingerprint: hash.toString(16).padStart(8, '0'),
  };
}

// ---------------------------------------------------------------- diff

export interface ReportDiff {
  readonly a: string;
  readonly b: string;
  /** Numeric fields: [a, b, b − a]. */
  readonly counts: Readonly<Record<string, readonly [number, number, number]>>;
  readonly joints: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly clips: { readonly added: readonly string[]; readonly removed: readonly string[]; readonly changed: readonly string[] };
  readonly materials: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly warnings: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly same: boolean;
}

const setDiff = (a: readonly string[], b: readonly string[]) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

export function diffReports(a: InspectReport, b: InspectReport): ReportDiff {
  const num = (f: (r: InspectReport) => number): readonly [number, number, number] => [f(a), f(b), r3(f(b) - f(a))];
  const counts = {
    triangles: num((r) => r.triangles),
    vertices: num((r) => r.vertices),
    meshes: num((r) => r.meshes),
    drawCalls: num((r) => r.drawCalls),
    materials: num((r) => r.materials.length),
    textures: num((r) => r.textures),
    joints: num((r) => r.joints.length),
    clips: num((r) => r.clips.length),
    'size.x': num((r) => r.bounds.size[0]!),
    'size.y': num((r) => r.bounds.size[1]!),
    'size.z': num((r) => r.bounds.size[2]!),
    warnings: num((r) => r.warnings.length),
  };
  const durA = new Map(a.clips.map((c) => [c.name, c.duration]));
  const changed = b.clips.filter((c) => durA.has(c.name) && Math.abs(durA.get(c.name)! - c.duration) > 1e-3).map((c) => `${c.name} ${durA.get(c.name)}s → ${c.duration}s`);
  const key = (m: InspectReport['materials'][number]) => `${m.name} ${m.color ?? ''}`.trim();
  return {
    a: a.name,
    b: b.name,
    counts,
    joints: setDiff(a.joints, b.joints),
    clips: { ...setDiff(a.clips.map((c) => c.name), b.clips.map((c) => c.name)), changed },
    materials: setDiff(a.materials.map(key), b.materials.map(key)),
    warnings: setDiff(a.warnings, b.warnings),
    same: a.fingerprint === b.fingerprint,
  };
}
