import { Box3, Color, type Material, type Mesh, type Object3D, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { analyzeClip, validateClip, type ClipReport, type SheetImage } from '../../engine/animation';
import { Canvas, outlineId, presetTriangleColour, type RGB } from '../../engine/animation/raster';
import { buildMonster } from './build';
import type { BuiltMonster, Genome } from './types';

/**
 * Inspectors (GAME.md rule 5): a GPU-free portrait renderer (the same software rasterizer
 * as the contact sheets, so it runs in Node and in the lab), image grids, and the clip
 * checks every monster must pass (the hero's metrics: no floor penetration, no sliding,
 * clean loops) plus build sanity (time, NaNs, bounds).
 */
export interface PortraitOptions {
  width?: number;
  height?: number;
  /** View yaw (deg, 0 = looking at its face) and pitch (deg down). */
  yaw?: number;
  pitch?: number;
  /** Fixed pixels per metre; default fits the model. */
  scale?: number;
  label?: string;
  sublabel?: string;
  skeleton?: readonly string[];
  /** Background colour. */
  bg?: RGB;
}

const BG: RGB = [36, 40, 56];
const FLOOR: RGB = [51, 60, 87];

/** Render an Object3D (as posed) to an RGBA image: flat-shaded toon-ish with outlines. */
export function renderPortrait(object: Object3D, o: PortraitOptions = {}): SheetImage {
  const W = o.width ?? 160;
  const H = o.height ?? 160;
  const yaw = ((o.yaw ?? 35) * Math.PI) / 180;
  const pitch = ((o.pitch ?? 22) * Math.PI) / 180;
  // camera basis: looking from (sin yaw, ., cos yaw) towards the origin
  const f = new Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  object.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  object.traverse((x) => {
    if ((x as Mesh).isMesh && x.visible) meshes.push(x as Mesh);
  });
  const box = new Box3().setFromObject(object, true);
  const proj = (p: Vector3): [number, number, number] => [p.dot(r), p.dot(u), -p.dot(f)];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : Math.min(box.min.y, 0), i & 4 ? box.max.z : box.min.z);
    const [x, y] = proj(c);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const textH = o.label ? 12 + (o.sublabel ? 10 : 0) : 0;
  const scale = o.scale ?? Math.min((W - 12) / Math.max(0.2, maxX - minX), (H - 12 - textH) / Math.max(0.2, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cv = new Canvas(W, H);
  cv.rect(0, 0, W, H, o.bg ?? BG);
  const toScreen = (p: Vector3): [number, number, number] => {
    const [x, y, z] = proj(p);
    return [W / 2 + (x - cx) * scale, (H - textH) / 2 + (cy - y) * scale, z];
  };
  const rect = { x: 0, y: 0, w: W, h: H - textH };
  // floor: a disc under the monster
  const rad = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.62;
  const centre = box.getCenter(new Vector3()).setY(0);
  const seg = 24;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = toScreen(centre);
    const p1 = toScreen(new Vector3(centre.x + Math.cos(a0) * rad, 0, centre.z + Math.sin(a0) * rad));
    const p2 = toScreen(new Vector3(centre.x + Math.cos(a1) * rad, 0, centre.z + Math.sin(a1) * rad));
    cv.tri(p0[0], p0[1], -1e6, p1[0], p1[1], -1e6, p2[0], p2[1], -1e6, FLOOR, 0, rect);
  }
  const L = f.clone().multiplyScalar(-0.5).addScaledVector(u, 0.75).addScaledVector(r, -0.45).normalize();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const n = new Vector3();
  meshes.forEach((mesh, mi) => {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    const count = idx ? idx.count : pos.count;
    const [cr, cg, cb] = colourOf(mesh.material);
    const unlit = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.type?.includes('Basic');
    for (let t = 0; t < count; t += 3) {
      const ia = idx ? idx.getX(t) : t;
      const ib = idx ? idx.getX(t + 1) : t + 1;
      const ic = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      n.crossVectors(e1, e2).normalize();
      if (n.dot(f) > 0) n.negate();
      // 3-band toon ramp, like TOON_BANDS
      const d = Math.max(0, n.dot(L));
      const preset = presetTriangleColour(geo.userData, t / 3);
      const shade = (preset ? preset.unlit : unlit) ? 1 : d > 0.55 ? 1 : d > 0.2 ? 0.72 : 0.42;
      const [r0, g0, b0] = preset ? preset.rgb : [cr, cg, cb];
      const pa = toScreen(a);
      const pb = toScreen(b);
      const pc = toScreen(c);
      cv.tri(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pc[0], pc[1], pc[2], [r0 * shade, g0 * shade, b0 * shade], outlineId(mi + 1, preset), rect);
    }
  });
  cv.outline(rect);
  if (o.skeleton?.length) {
    for (const name of o.skeleton) {
      const j = object.getObjectByName(name);
      if (!j?.parent) continue;
      let p: Object3D | null = j.parent;
      while (p && !o.skeleton.includes(p.name)) p = p.parent;
      if (!p) continue;
      const pa = toScreen(j.getWorldPosition(new Vector3()));
      const pb = toScreen(p.getWorldPosition(new Vector3()));
      const col: RGB = /R$/.test(name) ? [239, 125, 87] : /L$/.test(name) ? [115, 239, 247] : [255, 205, 117];
      cv.line(pa[0], pa[1], pb[0], pb[1], col, 0.9);
      cv.rect(Math.round(pa[0]) - 1, Math.round(pa[1]) - 1, 3, 3, col);
    }
  }
  if (o.label) cv.text(o.label.toUpperCase().slice(0, Math.floor(W / 6)), 3, H - textH + 2, [230, 232, 240]);
  if (o.sublabel) cv.text(o.sublabel.toUpperCase().slice(0, Math.floor(W / 6)), 3, H - 10, [150, 156, 180]);
  return { width: W, height: H, data: cv.data };
}

function colourOf(material: Material | Material[]): RGB {
  const m = (Array.isArray(material) ? material[0] : material) as Material & { color?: Color };
  const c = m?.color ?? new Color(0xcccccc);
  const out = { r: 0, g: 0, b: 0 };
  c.getRGB(out, SRGBColorSpace);
  return [out.r * 255, out.g * 255, out.b * 255];
}

/** Lay images out in a grid (cells sized to the largest image). */
export function grid(images: readonly SheetImage[], cols: number, gap = 2, bg: RGB = [20, 22, 32]): SheetImage {
  const cw = Math.max(...images.map((i) => i.width));
  const ch = Math.max(...images.map((i) => i.height));
  const rows = Math.ceil(images.length / cols);
  const width = cols * cw + (cols + 1) * gap;
  const height = rows * ch + (rows + 1) * gap;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  images.forEach((img, i) => {
    const x0 = gap + (i % cols) * (cw + gap);
    const y0 = gap + Math.floor(i / cols) * (ch + gap);
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y0 + y) * width + x0) * 4);
  });
  return { width, height, data };
}

/** Stack images vertically. */
export function stack(images: readonly SheetImage[], bg: RGB = [36, 40, 56]): SheetImage {
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((s, i) => s + i.height, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  let y = 0;
  for (const img of images) {
    for (let row = 0; row < img.height; row++) data.set(img.data.subarray(row * img.width * 4, (row + 1) * img.width * 4), (y + row) * width * 4);
    y += img.height;
  }
  return { width, height, data };
}

// ---------------------------------------------------------------- checks

export interface MonsterCheck {
  genome: Genome;
  /** `buildMonster` time (ms); a second build of the same shape; generating + compiling every clip of the shape. */
  ms: number;
  msCached: number;
  clipMs: number;
  clips: (ClipReport & { errors: string[] })[];
  problems: string[];
  warnings: string[];
}

/**
 * Build a genome and check it: every clip validated and measured (`analyzeClip` on an
 * unscaled copy), no NaNs anywhere, sane bounds and budget.
 */
export function checkMonster(genome: Genome, built?: BuiltMonster): MonsterCheck {
  const m = built ?? buildMonster(genome);
  const t0 = performance.now();
  const defs = m.defs;
  const compiled = m.clips;
  const clipMs = performance.now() - t0;
  const t = performance.now();
  const probe = buildMonster(genome).object;
  const msCached = performance.now() - t;
  probe.scale.setScalar(1);
  probe.updateMatrixWorld(true);
  const problems: string[] = [];
  const warnings: string[] = [];
  const clips = defs.map((def, i) => {
    const errors = validateClip(def, m.rig);
    const report = analyzeClip(probe, m.rig, def, compiled[i]!);
    for (const e of errors) problems.push(`${def.name}: ${e}`);
    for (const p of report.problems) problems.push(`${def.name}: ${p}`);
    for (const w of report.warnings) warnings.push(`${def.name}: ${w}`);
    for (const k of def.keys) for (const [j, v] of Object.entries(k[1])) if (JSON.stringify(v).includes('null')) problems.push(`${def.name}: NaN in ${j} at f${k[0]}`);
    return { ...report, errors };
  });
  const box = new Box3().setFromObject(m.object, true);
  const size = box.getSize(new Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) problems.push('bounds are not finite');
  if (size.y < 0.15 || size.y > 12) problems.push(`height ${size.y.toFixed(2)} m out of range`);
  if (box.min.y < -0.05) problems.push(`rest pose goes ${(-box.min.y * 100).toFixed(0)} cm below the floor`);
  if (!(m.radius > 0) || !(m.height > 0)) problems.push('radius/height not positive');
  return { genome, ms: m.ms, msCached, clipMs, clips, problems, warnings };
}
