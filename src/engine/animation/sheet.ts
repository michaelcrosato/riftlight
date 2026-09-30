import { AnimationMixer, type AnimationClip, type BufferGeometry, Color, type Material, type Mesh, type Object3D, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { drawText, GLYPH_H, textWidth } from './font';
import type { ClipReport } from './metrics';
import type { ClipDef, RigSpec } from './types';

/**
 * Contact sheets: render a clip to an RGBA image with a tiny software rasterizer — no
 * GPU, no DOM, so it runs in Node (the `npm run anim` CLI) and in the browser alike.
 *
 *   rows     views (side / front / top / three-quarter), columns = frames
 *   overlay  skeleton (right side orange, left cyan, centre yellow) and ground contacts
 *            (green bar = sole on the floor, red = through it)
 *   trails   one wide side-view panel with onion-skinned stick figures and the paths of
 *            the hands, feet and head; locomotion clips are drawn travelling at their
 *            authored speed, so a planted foot shows as a single point (sliding = smear)
 *
 * This is the main way an agent "looks" at an animation: render, read the PNG, adjust
 * numbers, repeat.
 */
export type ViewName = 'side' | 'front' | 'top' | 'three';

export interface SheetOptions {
  /** Authoring frames to show (default: the key frames, or 12 evenly spaced). */
  frames?: number[];
  views?: ViewName[];
  /** Pixels per metre (default 64). */
  scale?: number;
  skeleton?: boolean;
  trails?: boolean;
  /** Metrics to print under the sheet. */
  report?: ClipReport;
}

export interface SheetImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface View {
  name: ViewName;
  label: string;
  /** View direction, screen right, screen up. */
  f: Vector3;
  r: Vector3;
  u: Vector3;
}

function makeView(name: ViewName, label: string, f: Vector3, upHint: Vector3): View {
  f = f.clone().normalize();
  const r = new Vector3().crossVectors(f, upHint).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  return { name, label, f, r, u };
}

const VIEWS: Record<ViewName, View> = {
  side: makeView('side', 'SIDE', new Vector3(1, 0, 0), new Vector3(0, 1, 0)), // its right side, facing screen-right
  front: makeView('front', 'FRONT', new Vector3(0, 0, -1), new Vector3(0, 1, 0)),
  top: makeView('top', 'TOP', new Vector3(0, -1, 0), new Vector3(0, 0, 1)), // facing screen-up
  three: makeView('three', '3/4', new Vector3(1, -0.55, -1.1), new Vector3(0, 1, 0)),
};

const BG: RGB = [36, 40, 56];
const CELL_BG: RGB = [44, 49, 68];
const GRID: RGB = [58, 64, 88];
const GROUND: RGB = [140, 146, 170];
const TEXT: RGB = [230, 232, 240];
const DIM: RGB = [150, 156, 180];
const RIGHT: RGB = [239, 125, 87];
const LEFT: RGB = [115, 239, 247];
const CENTRE: RGB = [255, 205, 117];
const CONTACT: RGB = [56, 183, 100];
const BAD: RGB = [255, 70, 90];
const WARN: RGB = [255, 205, 117];

type RGB = [number, number, number];

interface Tri {
  v: Float32Array; // 9 floats, world space
  color: RGB;
  id: number;
}

interface Snapshot {
  frame: number;
  tris: Tri[];
  joints: Map<string, Vector3>;
  soles: { name: string; minY: number; min: Vector3; max: Vector3 }[];
  trace: Map<string, Vector3>;
}

/** Pose the model at each frame and capture its triangles, joints and contacts. */
function snapshots(model: Object3D, rig: RigSpec, clip: AnimationClip, frames: readonly number[], loop = false): Snapshot[] {
  const length = clip.duration * rig.fps;
  const mixer = new AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const meshes: Mesh[] = [];
  model.traverse((o) => {
    if ((o as Mesh).isMesh && o.visible) meshes.push(o as Mesh);
  });
  const out: Snapshot[] = [];
  const p = new Vector3();
  for (const frame of frames) {
    const f = loop ? frame % length : Math.min(frame, length - 1e-4);
    mixer.setTime(f / rig.fps);
    model.updateMatrixWorld(true);
    const tris: Tri[] = [];
    const soles: Snapshot['soles'] = [];
    meshes.forEach((mesh, mi) => {
      const geo = mesh.geometry as BufferGeometry;
      const pos = geo.getAttribute('position');
      const idx = geo.getIndex();
      const n = idx ? idx.count : pos.count;
      const color = colorOf(mesh.material);
      const world = new Float32Array(pos.count * 3);
      const lo = new Vector3(Infinity, Infinity, Infinity);
      const hi = new Vector3(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        world.set([p.x, p.y, p.z], i * 3);
        lo.min(p);
        hi.max(p);
      }
      for (let t = 0; t < n; t += 3) {
        const v = new Float32Array(9);
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(t + k) : t + k;
          v.set(world.subarray(vi * 3, vi * 3 + 3), k * 3);
        }
        tris.push({ v, color, id: mi + 1 });
      }
      if (rig.soles.includes(mesh.name)) soles.push({ name: mesh.name, minY: lo.y, min: lo, max: hi });
    });
    const joints = new Map<string, Vector3>();
    for (const j of rig.joints) joints.set(j, model.getObjectByName(j)!.getWorldPosition(new Vector3()));
    const trace = new Map<string, Vector3>();
    for (const t of rig.trace) {
      const o = model.getObjectByName(t);
      if (!o) continue;
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.computeBoundingBox();
        trace.set(t, m.geometry.boundingBox!.getCenter(new Vector3()).applyMatrix4(m.matrixWorld));
      } else trace.set(t, o.getWorldPosition(new Vector3()));
    }
    out.push({ frame, tris, joints, soles, trace });
  }
  action.stop();
  mixer.uncacheRoot(model);
  return out;
}

function colorOf(material: Material | Material[]): RGB {
  const m = (Array.isArray(material) ? material[0] : material) as Material & { color?: Color };
  const c = m?.color ?? new Color(0xcccccc);
  const out = { r: 0, g: 0, b: 0 };
  c.getRGB(out, SRGBColorSpace);
  return [out.r * 255, out.g * 255, out.b * 255];
}

/** Parent rig joint of each rig joint (skipping non-joint nodes). */
function boneList(model: Object3D, rig: RigSpec): [string, string][] {
  const bones: [string, string][] = [];
  for (const j of rig.joints) {
    let o = model.getObjectByName(j)!.parent;
    while (o && !rig.joints.includes(o.name)) o = o.parent;
    if (o) bones.push([o.name, j]);
  }
  return bones;
}

function sideColor(name: string): RGB {
  if (/R$/.test(name)) return RIGHT;
  if (/L$/.test(name)) return LEFT;
  return CENTRE;
}

export function defaultFrames(def: ClipDef, max = 12): number[] {
  const keys = [...new Set(def.keys.map((k) => k[0]))].filter((f) => !def.loop || f < def.frames);
  if (keys.length >= 3 && keys.length <= max) return keys;
  const n = Math.min(max, Math.floor(def.frames) + (def.loop ? 0 : 1));
  return Array.from({ length: n }, (_, i) => round1(def.loop ? (i * def.frames) / n : (i * def.frames) / Math.max(1, n - 1)));
}

class Canvas {
  readonly data: Uint8ClampedArray;
  readonly depth: Float32Array;
  readonly ids: Uint16Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height).fill(-Infinity);
    this.ids = new Uint16Array(width * height);
    this.rect(0, 0, width, height, BG);
  }

  set(x: number, y: number, c: RGB, a = 1): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    d[i] = d[i]! + (c[0] - d[i]!) * a;
    d[i + 1] = d[i + 1]! + (c[1] - d[i + 1]!) * a;
    d[i + 2] = d[i + 2]! + (c[2] - d[i + 2]!) * a;
    d[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) this.set(xx, yy, c, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1, thick = 1): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (thick <= 1) this.set(x, y, c, a);
      else this.rect(Math.round(x - thick / 2), Math.round(y - thick / 2), thick, thick, c, a);
    }
  }

  text(s: string, x: number, y: number, c: RGB, scale = 1): void {
    drawText(s, x, y, (px, py) => this.set(px, py, c), scale);
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: RGB, id: number, clip: Rect): void {
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(clip.x, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(clip.x + clip.w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(clip.y, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(clip.y + clip.h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const k = y * this.width + x;
        if (z <= this.depth[k]!) continue;
        this.depth[k] = z;
        this.ids[k] = id;
        this.set(x, y, c);
      }
    }
  }

  /** Cel outlines: darken covered pixels whose neighbour belongs to another mesh. */
  outline(clip: Rect): void {
    const edges: number[] = [];
    for (let y = clip.y; y < clip.y + clip.h; y++) {
      for (let x = clip.x; x < clip.x + clip.w; x++) {
        const k = y * this.width + x;
        const id = this.ids[k]!;
        if (!id) continue;
        const n = [x > clip.x ? this.ids[k - 1] : 0, x < clip.x + clip.w - 1 ? this.ids[k + 1] : 0, y > clip.y ? this.ids[k - this.width] : 0, y < clip.y + clip.h - 1 ? this.ids[k + this.width] : 0];
        if (n.some((v) => v !== id)) edges.push(k);
      }
    }
    for (const k of edges) {
      const i = k * 4;
      const outer = [k - 1, k + 1, k - this.width, k + this.width].some((q) => this.ids[q] === 0);
      const f = outer ? 0.25 : 0.6;
      this.data[i] = this.data[i]! * f;
      this.data[i + 1] = this.data[i + 1]! * f;
      this.data[i + 2] = this.data[i + 2]! * f;
    }
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function project(v: View, x: number, y: number, z: number): [number, number, number] {
  return [x * v.r.x + y * v.r.y + z * v.r.z, x * v.u.x + y * v.u.y + z * v.u.z, -(x * v.f.x + y * v.f.y + z * v.f.z)];
}

function boundsOf(view: View, snaps: Snapshot[], travel: (frame: number) => number, includeGround: boolean): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const add = (x: number, y: number, z: number) => {
    const [sx, sy] = project(view, x, y, z);
    b.minX = Math.min(b.minX, sx);
    b.maxX = Math.max(b.maxX, sx);
    b.minY = Math.min(b.minY, sy);
    b.maxY = Math.max(b.maxY, sy);
  };
  for (const s of snaps) {
    const dz = travel(s.frame);
    for (const t of s.tris) for (let k = 0; k < 9; k += 3) add(t.v[k]!, t.v[k + 1]!, t.v[k + 2]! + dz);
  }
  if (includeGround && view.name !== 'top') {
    add(0, 0, 0);
  }
  const pad = 0.12;
  b.minX -= pad;
  b.maxX += pad;
  b.minY -= pad;
  b.maxY += pad;
  if (view.name === 'side' || view.name === 'front' || view.name === 'three') {
    // keep a sensible minimum frame so tiny poses don't zoom in
    const cx = (b.minX + b.maxX) / 2;
    const half = Math.max((b.maxX - b.minX) / 2, 0.55);
    b.minX = cx - half;
    b.maxX = cx + half;
  }
  return b;
}

/** Render a contact sheet for one clip. */
export function renderSheet(model: Object3D, rig: RigSpec, def: ClipDef, clip: AnimationClip, options: SheetOptions = {}): SheetImage {
  const scale = options.scale ?? 64;
  const frames = options.frames ?? defaultFrames(def);
  const views = (options.views ?? ['side', 'front', 'three', 'top']).map((v) => VIEWS[v]);
  const skeleton = options.skeleton ?? true;
  const trails = options.trails ?? true;
  const keyFrames = new Set(def.keys.map((k) => k[0]));
  const snaps = snapshots(model, rig, clip, frames);
  const cycles = def.loop && def.speed ? 2 : 1;
  const allFrames = Array.from({ length: Math.round(def.frames * cycles * 2) + 1 }, (_, i) => i / 2).filter((f) => !def.loop || f < def.frames * cycles);
  const trailSnaps = trails ? snapshots(model, rig, clip, allFrames, !!def.loop) : [];
  const bones = boneList(model, rig);
  const speed = def.speed ?? 0;
  const travel = (frame: number) => (speed * frame) / rig.fps;

  // ---- layout
  const M = 8;
  const labelW = 44;
  const header = 2 * GLYPH_H + 16 + 4;
  const cellLabel = GLYPH_H + 4;
  const rows = views.map((view) => {
    const b = boundsOf(view, snaps, () => 0, true);
    return { view, b, w: Math.ceil((b.maxX - b.minX) * scale), h: Math.ceil((b.maxY - b.minY) * scale) + cellLabel };
  });
  const cellsW = labelW + rows.reduce((m, r) => Math.max(m, r.w * frames.length + (frames.length - 1) * 2), 0);
  const trailView = VIEWS.side;
  const tb = trails ? boundsOf(trailView, trailSnaps, travel, true) : null;
  const trailScale = tb ? Math.min(scale * 2, (Math.max(cellsW, 600) - labelW) / (tb.maxX - tb.minX)) : scale;
  const trailH = tb ? Math.ceil((tb.maxY - tb.minY) * trailScale) + cellLabel : 0;
  const trailW = tb ? Math.ceil((tb.maxX - tb.minX) * trailScale) : 0;
  const lines = reportLines(def, options.report);
  const footer = lines.length * (GLYPH_H + 3) + 8;
  const width = M * 2 + Math.max(cellsW, labelW + trailW, textWidth(lines.reduce((a, l) => (l.text.length > a.length ? l.text : a), ''), 1), 400);
  const height = M * 2 + header + rows.reduce((s, r) => s + r.h + 6, 0) + (tb ? trailH + 10 : 0) + footer;
  const cv = new Canvas(width, height);

  // ---- header
  cv.text(def.name, M, M, TEXT, 2);
  const info = [
    `${def.frames} F @${rig.fps}FPS (${(def.frames / rig.fps).toFixed(2)}S)`,
    def.loop ? 'LOOP' : 'ONCE',
    def.speed ? `SPEED ${def.speed} M/S` : '',
    def.grounded ? 'GROUNDED' : '',
    def.fast ? 'FAST' : '',
    'SKELETON: R=ORANGE L=CYAN',
  ].filter(Boolean).join('  ');
  cv.text(info, M, M + 2 * GLYPH_H + 4, DIM);

  // ---- rows of cells
  let y = M + header;
  for (const row of rows) {
    cv.text(row.view.label, M, y + Math.floor(row.h / 2) - 4, TEXT);
    snaps.forEach((snap, i) => {
      const rect: Rect = { x: M + labelW + i * (row.w + 2), y, w: row.w, h: row.h - cellLabel };
      cv.rect(rect.x, rect.y, rect.w, rect.h, CELL_BG);
      const toScreen = (x: number, yy: number, z: number): [number, number, number] => {
        const [sx, sy, sz] = project(row.view, x, yy, z);
        return [rect.x + (sx - row.b.minX) * scale, rect.y + (row.b.maxY - sy) * scale, sz];
      };
      drawGround(cv, row.view, toScreen, rect);
      drawMesh(cv, row.view, snap, toScreen, rect, 0);
      cv.outline(rect);
      if (skeleton) drawSkeleton(cv, snap, bones, toScreen, 0.85);
      drawContacts(cv, row.view, snap, toScreen);
      const label = `${keyFrames.has(snap.frame) ? '*' : ''}${round1(snap.frame)}`;
      cv.text(label, rect.x + 2, rect.y + rect.h + 3, keyFrames.has(snap.frame) ? TEXT : DIM);
    });
    y += row.h + 6;
  }

  // ---- trails
  if (tb) {
    const rect: Rect = { x: M + labelW, y, w: trailW, h: trailH - cellLabel };
    cv.text('TRAIL', M, y + Math.floor(rect.h / 2) - 4, TEXT);
    cv.rect(rect.x, rect.y, rect.w, rect.h, CELL_BG);
    const toScreen = (x: number, yy: number, z: number): [number, number, number] => {
      const [sx, sy, sz] = project(trailView, x, yy, z);
      return [rect.x + (sx - tb.minX) * trailScale, rect.y + (tb.maxY - sy) * trailScale, sz];
    };
    drawGround(cv, trailView, toScreen, rect);
    // onion skin: stick figures at the sheet frames, old → new = blue → red
    snaps.forEach((snap, i) => {
      const t = snaps.length > 1 ? i / (snaps.length - 1) : 1;
      const col: RGB = [80 + 175 * t, 120, 255 - 175 * t];
      const moved = shift(snap, travel(snap.frame));
      for (const [a, b] of bones) {
        const pa = toScreen(...xyz(moved.joints.get(a)!));
        const pb = toScreen(...xyz(moved.joints.get(b)!));
        cv.line(pa[0], pa[1], pb[0], pb[1], col, 0.55);
      }
    });
    // paths
    for (const name of rig.trace) {
      const col = sideColor(name.replace(/(Glove|Shoe)/, ''));
      let prev: [number, number, number] | null = null;
      for (const s of trailSnaps) {
        const p = s.trace.get(name);
        if (!p) continue;
        const q = toScreen(p.x, p.y, p.z + travel(s.frame));
        if (prev) cv.line(prev[0], prev[1], q[0], q[1], col, 0.9, 2);
        prev = q;
      }
    }
    cv.text(speed ? `WORLD SPACE AT ${speed} M/S: A PLANTED FOOT IS A DOT, SLIDING SMEARS` : 'IN PLACE', rect.x + 2, rect.y + rect.h + 3, DIM);
    y += trailH + 10;
  }

  // ---- report
  for (const l of lines) {
    cv.text(l.text, M, y, l.color);
    y += GLYPH_H + 3;
  }
  return { width, height, data: cv.data };
}

function xyz(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

function shift(s: Snapshot, dz: number): Snapshot {
  if (!dz) return s;
  const joints = new Map<string, Vector3>();
  for (const [k, v] of s.joints) joints.set(k, v.clone().setZ(v.z + dz));
  return { ...s, joints };
}

type ToScreen = (x: number, y: number, z: number) => [number, number, number];

function drawGround(cv: Canvas, view: View, toScreen: ToScreen, rect: Rect): void {
  const clipLine = (a: [number, number, number], b: [number, number, number], c: RGB) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let i = 0; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n;
      const y = a[1] + ((b[1] - a[1]) * i) / n;
      if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) cv.set(x, y, c);
    }
  };
  const R = 6;
  for (let g = -R; g <= R; g += 0.5) {
    clipLine(toScreen(g, 0, -R), toScreen(g, 0, R), GRID);
    clipLine(toScreen(-R, 0, g), toScreen(R, 0, g), GRID);
  }
  if (view.name === 'side') clipLine(toScreen(0, 0, -R), toScreen(0, 0, R), GROUND);
  if (view.name === 'front') clipLine(toScreen(-R, 0, 0), toScreen(R, 0, 0), GROUND);
}

function drawMesh(cv: Canvas, view: View, snap: Snapshot, toScreen: ToScreen, rect: Rect, dz: number): void {
  const L = view.f.clone().multiplyScalar(-0.6).addScaledVector(view.u, 0.7).addScaledVector(view.r, -0.4).normalize();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const n = new Vector3();
  for (const t of snap.tris) {
    const v = t.v;
    e1.set(v[3]! - v[0]!, v[4]! - v[1]!, v[5]! - v[2]!);
    e2.set(v[6]! - v[0]!, v[7]! - v[1]!, v[8]! - v[2]!);
    n.crossVectors(e1, e2).normalize();
    if (n.dot(view.f) > 0) n.negate();
    const shade = 0.5 + 0.5 * Math.max(0, n.dot(L));
    const c: RGB = [t.color[0] * shade, t.color[1] * shade, t.color[2] * shade];
    const a = toScreen(v[0]!, v[1]!, v[2]! + dz);
    const b = toScreen(v[3]!, v[4]!, v[5]! + dz);
    const d = toScreen(v[6]!, v[7]!, v[8]! + dz);
    cv.tri(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2], c, t.id, rect);
  }
}

function drawSkeleton(cv: Canvas, snap: Snapshot, bones: [string, string][], toScreen: ToScreen, alpha: number): void {
  for (const [a, b] of bones) {
    const pa = toScreen(...xyz(snap.joints.get(a)!));
    const pb = toScreen(...xyz(snap.joints.get(b)!));
    cv.line(pa[0], pa[1], pb[0], pb[1], sideColor(b), alpha);
  }
  for (const [name, p] of snap.joints) {
    const q = toScreen(p.x, p.y, p.z);
    cv.rect(Math.round(q[0]) - 1, Math.round(q[1]) - 1, 3, 3, sideColor(name), alpha);
  }
}

function drawContacts(cv: Canvas, view: View, snap: Snapshot, toScreen: ToScreen): void {
  if (view.name === 'top') return;
  for (const s of snap.soles) {
    if (s.minY > 0.03) continue;
    const col = s.minY < -0.03 ? BAD : CONTACT;
    const a = toScreen(s.min.x, 0, s.min.z);
    const b = toScreen(s.max.x, 0, s.max.z);
    const c = toScreen(s.min.x, 0, s.max.z);
    const d = toScreen(s.max.x, 0, s.min.z);
    const x0 = Math.min(a[0], b[0], c[0], d[0]);
    const x1 = Math.max(a[0], b[0], c[0], d[0]);
    const y0 = Math.max(a[1], b[1], c[1], d[1]);
    cv.rect(Math.round(x0), Math.round(y0) + 1, Math.max(2, Math.round(x1 - x0)), 3, col);
  }
}

function reportLines(def: ClipDef, report: ClipReport | undefined): { text: string; color: RGB }[] {
  const lines: { text: string; color: RGB }[] = [];
  if (def.notes) lines.push({ text: def.notes, color: DIM });
  if (!report) return lines;
  lines.push({
    text: `SOLE MIN ${cm(report.minSoleY)}  SLIDE ${report.footSlide.toFixed(2)} M/S  SEAM ${report.loopSeam.toFixed(1)}°  PELVIS ${cm(report.pelvisY[0])}..${cm(report.pelvisY[1])}  FASTEST ${report.maxAngularSpeed.joint} ${report.maxAngularSpeed.degPerSec.toFixed(0)}°/S`,
    color: TEXT,
  });
  for (const p of report.problems) lines.push({ text: `PROBLEM: ${p}`, color: BAD });
  for (const w of report.warnings) lines.push({ text: `WARN: ${w}`, color: WARN });
  if (!report.problems.length && !report.warnings.length) lines.push({ text: 'OK: NO PROBLEMS', color: CONTACT });
  return lines;
}

function cm(m: number): string {
  return `${(m * 100).toFixed(0)}CM`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
