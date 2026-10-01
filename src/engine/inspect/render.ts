/**
 * GPU-free views of any Object3D for agents: a turntable (N yaw angles at one shared scale),
 * rig overlays (x-ray mesh + joints with names), and the inspection sheet that puts them
 * together with the counts and warnings. Built on the software canvas the animation contact
 * sheets use (animation/raster.ts): flat 3-band toon shading, cel outlines, vertex colours,
 * CPU skinning for SkinnedMesh, InstancedMesh instances. Runs in Node and in the browser.
 *
 *   const sheet = renderInspection(object, inspectObject(object, { joints }), { joints });
 */
import type { BufferAttribute, Color, InstancedMesh, InterleavedBufferAttribute, Material, Mesh, Object3D, SkinnedMesh } from 'three/webgpu';
import { Box3, Matrix4, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { Canvas, type Rect, type RGB, type SheetImage } from '../animation/raster';
import type { InspectReport, ReportDiff } from './report';

export const INSPECT_BG: RGB = [28, 31, 44];
const PANEL: RGB = [36, 40, 56];
const FLOOR: RGB = [48, 56, 80];
const FLOOR_LINE: RGB = [62, 72, 100];
const TEXT: RGB = [230, 232, 240];
const DIM: RGB = [150, 156, 180];
const WARN: RGB = [255, 205, 117];
const GOOD: RGB = [56, 183, 100];
const BAD: RGB = [255, 110, 120];
const RIGHT: RGB = [239, 125, 87];
const LEFT: RGB = [115, 239, 247];
const CENTRE: RGB = [255, 205, 117];

export interface ViewOptions {
  width?: number;
  height?: number;
  /** Degrees; 0 looks at the model's front (+Z), 90 at its left side (+X). */
  yaw?: number;
  /** Degrees down. */
  pitch?: number;
  /** World bounds to frame (shared across views so sizes compare); default the object's. */
  frame?: Box3;
  /** Pixels per metre (default: fit `frame` for any yaw). */
  scale?: number;
  label?: string;
  /** Joints to draw over the model (x-ray: the mesh is dimmed, joints always on top). */
  joints?: readonly string[];
  /** Write joint names next to the joints. */
  names?: boolean;
  /** Dim the shaded model towards the background (0..1), for rig views. */
  dim?: number;
}

interface Tri {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  color: RGB;
  unlit: boolean;
  id: number;
}

const vx = (attr: BufferAttribute | InterleavedBufferAttribute, i: number, out: Vector3) => out.fromBufferAttribute(attr, i);

function colourOf(m: Material, out: { r: number; g: number; b: number }): RGB {
  const c = (m as Material & { color?: Color }).color;
  if (!c) return [200, 200, 200];
  c.getRGB(out, SRGBColorSpace);
  return [out.r * 255, out.g * 255, out.b * 255];
}

/** Every triangle of every visible mesh in world space (skinned and instanced meshes resolved). */
export function worldTriangles(object: Object3D): Tri[] {
  object.updateMatrixWorld(true);
  const tris: Tri[] = [];
  const tmp = { r: 0, g: 0, b: 0 };
  let id = 0;
  object.traverse((x) => {
    const mesh = x as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    let hidden = false;
    for (let p: Object3D | null = mesh.parent; p; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    const colors = g.getAttribute('color');
    const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh) : null;
    if (skinned) skinned.skeleton.update();
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    const instances = inst ? inst.count : 1;
    const im = new Matrix4();
    const world = new Matrix4();
    for (let k = 0; k < instances; k++) {
      if (inst) {
        inst.getMatrixAt(k, im);
        world.multiplyMatrices(mesh.matrixWorld, im);
      } else world.copy(mesh.matrixWorld);
      id++;
      for (const grp of groups) {
        const m = materials[grp.materialIndex ?? 0] ?? materials[0]!;
        if (!m || m.visible === false) continue;
        const base = colourOf(m, tmp);
        const unlit = m.type.includes('Basic');
        const useVc = !!colors && (m as Material & { vertexColors?: boolean }).vertexColors;
        for (let t = grp.start; t + 2 < grp.start + grp.count && t + 2 < count; t += 3) {
          const ia = idx ? idx.getX(t) : t;
          const ib = idx ? idx.getX(t + 1) : t + 1;
          const ic = idx ? idx.getX(t + 2) : t + 2;
          const v = [ia, ib, ic].map((i) => {
            const p = new Vector3();
            if (skinned) skinned.getVertexPosition(i, p);
            else vx(pos, i, p);
            return p.applyMatrix4(world);
          });
          let color = base;
          if (useVc) {
            const cs = [ia, ib, ic].map((i) => [colors!.getX(i), colors!.getY(i), colors!.getZ(i)]);
            color = [0, 1, 2].map((ch) => (Math.pow((cs[0]![ch]! + cs[1]![ch]! + cs[2]![ch]!) / 3, 1 / 2.2) * 255 * base[ch]!) / 255) as RGB;
          }
          tris.push({ a: v[0]!, b: v[1]!, c: v[2]!, color, unlit, id });
        }
      }
    }
  });
  return tris;
}

/** A camera basis for a yaw/pitch view. */
function basis(yawDeg: number, pitchDeg: number) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const f = new Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  return { f, r, u };
}

/** Pixels per metre that fit `frame` in a W×H view at every yaw (so a turntable keeps one scale). */
export function fitScale(frame: Box3, w: number, h: number, pitchDeg = 20): number {
  const size = frame.getSize(new Vector3());
  const horiz = Math.hypot(size.x, size.z);
  const p = (pitchDeg * Math.PI) / 180;
  const vert = size.y * Math.cos(p) + horiz * Math.sin(p);
  return Math.min((w - 14) / Math.max(0.05, horiz), (h - 14) / Math.max(0.05, vert));
}

/** Render one view of an object (or of precomputed triangles). */
export function renderView(object: Object3D, o: ViewOptions = {}, tris = worldTriangles(object)): SheetImage {
  const W = o.width ?? 160;
  const H = o.height ?? 160;
  const labelH = o.label ? 12 : 0;
  const { f, r, u } = basis(o.yaw ?? 30, o.pitch ?? 20);
  const frame = o.frame ?? new Box3().setFromObject(object, true);
  if (frame.isEmpty()) frame.set(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
  const scale = o.scale ?? fitScale(frame, W, H - labelH, o.pitch ?? 20);
  const centre = frame.getCenter(new Vector3());
  const proj = (p: Vector3): [number, number, number] => {
    const d = p.clone().sub(centre);
    return [W / 2 + d.dot(r) * scale, (H - labelH) / 2 - d.dot(u) * scale, -d.dot(f)];
  };
  const cv = new Canvas(W, H);
  cv.rect(0, 0, W, H, PANEL);
  const rect: Rect = { x: 0, y: 0, w: W, h: H - labelH };
  // floor: a grid square under the frame at y = 0, 1 m lines
  const half = Math.max(0.5, Math.ceil(Math.max(frame.max.x - frame.min.x, frame.max.z - frame.min.z) * 0.65 * 2) / 2);
  const fc = new Vector3(centre.x, 0, centre.z);
  const corner = (x: number, z: number) => proj(new Vector3(fc.x + x, 0, fc.z + z));
  const q = [corner(-half, -half), corner(half, -half), corner(half, half), corner(-half, half)];
  cv.tri(q[0]![0], q[0]![1], -1e6, q[1]![0], q[1]![1], -1e6, q[2]![0], q[2]![1], -1e6, FLOOR, 0, rect);
  cv.tri(q[0]![0], q[0]![1], -1e6, q[2]![0], q[2]![1], -1e6, q[3]![0], q[3]![1], -1e6, FLOOR, 0, rect);
  const step = half > 4 ? Math.ceil(half / 4) : 1;
  for (let k = -Math.floor(half); k <= half; k += step) {
    const a1 = corner(k, -half);
    const b1 = corner(k, half);
    const a2 = corner(-half, k);
    const b2 = corner(half, k);
    cv.line(a1[0], a1[1], b1[0], b1[1], FLOOR_LINE, 0.6);
    cv.line(a2[0], a2[1], b2[0], b2[1], FLOOR_LINE, 0.6);
  }
  const L = f.clone().multiplyScalar(-0.5).addScaledVector(u, 0.75).addScaledVector(r, -0.45).normalize();
  const n = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const dim = o.dim ?? 0;
  for (const t of tris) {
    e1.subVectors(t.b, t.a);
    e2.subVectors(t.c, t.a);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-18) continue;
    n.normalize();
    if (n.dot(f) > 0) n.negate();
    const d = Math.max(0, n.dot(L));
    const shade = t.unlit ? 1 : d > 0.55 ? 1 : d > 0.2 ? 0.72 : 0.42;
    const col: RGB = [0, 1, 2].map((ch) => t.color[ch]! * shade * (1 - dim) + PANEL[ch]! * dim) as RGB;
    const pa = proj(t.a);
    const pb = proj(t.b);
    const pc = proj(t.c);
    cv.tri(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pc[0], pc[1], pc[2], col, t.id, rect);
  }
  cv.outline(rect);
  if (o.joints?.length) drawJoints(cv, object, o.joints, proj, !!o.names, rect);
  if (o.label) cv.text(o.label.toUpperCase().slice(0, Math.floor(W / 6) - 1), 4, H - labelH + 3, DIM);
  return { width: W, height: H, data: cv.data };
}

function drawJoints(cv: Canvas, object: Object3D, joints: readonly string[], proj: (p: Vector3) => [number, number, number], names: boolean, rect: Rect): void {
  const set = new Set(joints);
  const pts = new Map<string, [number, number]>();
  for (const name of joints) {
    const j = object.getObjectByName(name);
    if (j) pts.set(name, proj(j.getWorldPosition(new Vector3())).slice(0, 2) as [number, number]);
  }
  const colourFor = (name: string): RGB => (/(R|Right|_r|\.R)$/.test(name) ? RIGHT : /(L|Left|_l|\.L)$/.test(name) ? LEFT : CENTRE);
  for (const name of joints) {
    const j = object.getObjectByName(name);
    let p = j?.parent ?? null;
    while (p && !set.has(p.name)) p = p.parent;
    const a = pts.get(name);
    const b = p ? pts.get(p.name) : undefined;
    if (a && b) cv.line(a[0], a[1], b[0], b[1], colourFor(name), 0.95);
  }
  const placed: Rect[] = [];
  for (const name of joints) {
    const a = pts.get(name);
    if (!a) continue;
    cv.rect(Math.round(a[0]) - 1, Math.round(a[1]) - 1, 3, 3, colourFor(name));
    if (!names) continue;
    const w = name.length * 6;
    const box: Rect = { x: Math.round(a[0]) + 4, y: Math.round(a[1]) - 3, w, h: 8 };
    if (box.x + w > rect.w) box.x = Math.round(a[0]) - 4 - w;
    if (placed.some((p) => p.x < box.x + box.w && box.x < p.x + p.w && p.y < box.y + box.h && box.y < p.y + p.h)) continue;
    placed.push(box);
    cv.rect(box.x - 1, box.y - 1, w + 1, 9, INSPECT_BG, 0.65);
    cv.text(name, box.x, box.y, colourFor(name));
  }
}

/** `angles` views around the model at one scale (0° = front). */
export function renderTurntable(object: Object3D, o: { angles?: number; size?: number; pitch?: number; frame?: Box3 } = {}): SheetImage[] {
  const n = o.angles ?? 8;
  const size = o.size ?? 150;
  const tris = worldTriangles(object);
  const frame = o.frame ?? new Box3().setFromObject(object, true);
  const scale = fitScale(frame.isEmpty() ? new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5)) : frame, size, size - 12, o.pitch ?? 20);
  return Array.from({ length: n }, (_, i) => {
    const yaw = Math.round((360 / n) * i);
    return renderView(object, { width: size, height: size, yaw, pitch: o.pitch ?? 20, frame, scale, label: `${yaw} DEG` }, tris);
  });
}

// ---------------------------------------------------------------- layout

export function row(images: readonly SheetImage[], gap = 4, bg: RGB = INSPECT_BG): SheetImage {
  const width = images.reduce((s, i) => s + i.width, 0) + gap * (images.length + 1);
  const height = Math.max(...images.map((i) => i.height)) + gap * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  let x = gap;
  for (const img of images) {
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((gap + y) * width + x) * 4);
    x += img.width + gap;
  }
  return { width, height, data };
}

export function column(images: readonly SheetImage[], bg: RGB = INSPECT_BG): SheetImage {
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((s, i) => s + i.height, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  let y = 0;
  for (const img of images) {
    for (let r = 0; r < img.height; r++) data.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), (y + r) * width * 4);
    y += img.height;
  }
  return { width, height, data };
}

export interface Line {
  text: string;
  color?: RGB;
}

/** A text panel: lines wrapped to the width, at least `minHeight` tall. */
export function textBox(lines: readonly Line[], width: number, minHeight = 0, title?: string): SheetImage {
  const per = Math.floor((width - 16) / 6);
  const out: Line[] = [];
  for (const l of lines) {
    let s = l.text;
    let first = true;
    if (!s) out.push({ text: '' });
    while (s.length) {
      const room = per - (first ? 0 : 2);
      let cut = s.length <= room ? s.length : s.lastIndexOf(' ', room);
      if (cut <= 0) cut = room;
      out.push({ text: (first ? '' : '  ') + s.slice(0, cut), color: l.color });
      s = s.slice(cut).trimStart();
      first = false;
    }
  }
  const top = title ? 22 : 8;
  const H = Math.max(minHeight, top + out.length * 10 + 6);
  const c = new Canvas(width, H);
  c.rect(0, 0, width, H, PANEL);
  if (title) c.text(title, 8, 8, TEXT);
  out.forEach((l, i) => c.text(l.text, 8, top + i * 10, l.color ?? DIM));
  return { width, height: H, data: c.data };
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : `${+v.toFixed(2)}`);

/** The report as text lines (counts, bounds, joints, clips, warnings). */
export function reportLines(r: InspectReport, maxClips = 24): Line[] {
  const lines: Line[] = [
    { text: `triangles ${r.triangles}   vertices ${r.vertices}   meshes ${r.meshes}   draw calls ${r.drawCalls}`, color: TEXT },
    { text: `materials ${r.materials.length} (${r.colours} colours)   textures ${r.textures}   geometries ${r.geometries}   nodes ${r.nodes}`, color: TEXT },
    { text: `bounds ${r.bounds.size.map(fmt).join(' x ')} m   min ${r.bounds.min.map(fmt).join(' ')}   max ${r.bounds.max.map(fmt).join(' ')}`, color: TEXT },
    { text: `joints ${r.joints.length}${r.skinned ? ' (skinned)' : r.joints.length ? ' (rigid parts on joints)' : ''}   clips ${r.clips.length}   fingerprint ${r.fingerprint}`, color: TEXT },
    { text: '' },
  ];
  if (r.warnings.length) for (const w of r.warnings) lines.push({ text: `! ${w}`, color: WARN });
  else lines.push({ text: 'no warnings', color: GOOD });
  lines.push({ text: '' });
  if (r.materials.length) lines.push({ text: `materials: ${r.materials.slice(0, 16).map((m) => `${m.name}${m.color ? ` ${m.color}` : ''}${m.count > 1 ? ` x${m.count}` : ''}`).join(', ')}${r.materials.length > 16 ? ', ...' : ''}` });
  if (r.clips.length) {
    lines.push({ text: '' });
    const shown = r.clips.slice(0, maxClips).map((c) => `${c.name} ${fmt(c.duration)}s${c.loop ? ' loop' : ''}`);
    lines.push({ text: `clips: ${shown.join(', ')}${r.clips.length > maxClips ? `, +${r.clips.length - maxClips} more` : ''}` });
  }
  return lines;
}

/** The inspection sheet: title, turntable, rig front + side with names, the report. */
export function renderInspection(object: Object3D, r: InspectReport, o: { angles?: number; size?: number; joints?: readonly string[]; subtitle?: string; notes?: readonly string[] } = {}): SheetImage {
  const size = o.size ?? 150;
  const views = renderTurntable(object, { angles: o.angles ?? 8, size });
  const turn = row(views);
  const joints = o.joints ?? r.joints;
  const big = 300;
  const tris = worldTriangles(object);
  const frame = new Box3().setFromObject(object, true);
  const scale = fitScale(frame.isEmpty() ? new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5)) : frame, big, big - 12, 8);
  const rigViews = joints.length
    ? [
        renderView(object, { width: big, height: big, yaw: 0, pitch: 8, frame, scale, joints, names: true, dim: 0.6, label: `rig front (${joints.length} joints)` }, tris),
        renderView(object, { width: big, height: big, yaw: 90, pitch: 8, frame, scale, joints, names: true, dim: 0.6, label: 'rig side' }, tris),
      ]
    : [renderView(object, { width: big, height: big, yaw: 0, pitch: 8, frame, scale, label: 'front (no joints)' }, tris), renderView(object, { width: big, height: big, yaw: 0, pitch: 89, frame, label: 'top' }, tris)];
  const panelW = Math.max(300, turn.width - 2 * big - 16);
  const notes: Line[] = o.notes?.length ? [{ text: '' }, ...o.notes.map((text) => ({ text, color: TEXT }))] : [];
  const panel = textBox([...reportLines(r), ...notes], panelW, big, 'COUNTS AND WARNINGS');
  const lower = row([...rigViews, panel]);
  const title = textBox([{ text: o.subtitle ?? '', color: DIM }], Math.max(turn.width, lower.width) - 8, 0, r.name.toUpperCase());
  return column([row([title]), turn, lower]);
}

/** The B − A table of a diff as a panel. */
export function diffPanel(d: ReportDiff, width: number): SheetImage {
  const lines: Line[] = [{ text: d.same ? 'identical fingerprints' : 'changed', color: d.same ? GOOD : WARN }];
  for (const [k, [x, y, dd]] of Object.entries(d.counts)) {
    if (dd === 0) continue;
    // costs: red when they grow, green when they shrink; other counts are neutral
    const cost = ['triangles', 'vertices', 'meshes', 'drawCalls', 'materials', 'textures', 'warnings'].includes(k);
    lines.push({ text: `${k.padEnd(10)} ${fmt(x).padStart(8)} > ${fmt(y).padEnd(8)} ${dd > 0 ? '+' : ''}${fmt(dd)}`, color: cost ? (dd > 0 ? BAD : GOOD) : TEXT });
  }
  if (lines.length === 1) lines.push({ text: 'no count changes' });
  const list = (label: string, s: { added: readonly string[]; removed: readonly string[] }) => {
    if (s.added.length) lines.push({ text: `+ ${label}: ${s.added.join(', ')}`, color: TEXT });
    if (s.removed.length) lines.push({ text: `- ${label}: ${s.removed.join(', ')}`, color: TEXT });
  };
  list('joints', d.joints);
  list('clips', d.clips);
  if (d.clips.changed.length) lines.push({ text: `~ clip lengths: ${d.clips.changed.join(', ')}`, color: TEXT });
  list('materials', d.materials);
  list('warnings', d.warnings);
  return row([textBox(lines, width - 8, 0, 'B - A')]);
}

/** A one-line title bar. */
export function titleBar(title: string, width: number, sub = ''): SheetImage {
  return row([textBox(sub ? [{ text: sub, color: DIM }] : [], width - 8, 0, title.toUpperCase())]);
}

const summary = (r: InspectReport) => `${r.triangles} tris, ${r.drawCalls} draws, ${r.joints.length} joints, ${r.clips.length} clips, ${r.bounds.size.map(fmt).join('x')} m`;

/** Two assets (or versions) side by side at one scale, with the count deltas. */
export function renderDiff(a: { object: Object3D; report: InspectReport }, b: { object: Object3D; report: InspectReport }, d: ReportDiff, o: { angles?: number; size?: number } = {}): SheetImage {
  const n = o.angles ?? 4;
  const size = o.size ?? 150;
  const frame = new Box3().setFromObject(a.object, true).union(new Box3().setFromObject(b.object, true));
  const ra = row(renderTurntable(a.object, { angles: n, size, frame }));
  const rb = row(renderTurntable(b.object, { angles: n, size, frame }));
  const w = Math.max(ra.width, rb.width);
  return column([titleBar(`A: ${a.report.name}`, w, summary(a.report)), ra, titleBar(`B: ${b.report.name}`, w, summary(b.report)), rb, diffPanel(d, w)]);
}
