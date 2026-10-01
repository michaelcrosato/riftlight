import { type BufferGeometry, CircleGeometry, Group, type Material, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { abs, color, float, floor, fwidth, length, max, min, mod, positionGeometry, screenCoordinate, select, time } from 'three/tsl';
import { PALETTE } from '../../engine/palette';
import type { DamageType } from '../core/types';

/** The decal's shape (a monster skill's `TelegraphSpec` fits). */
export interface TelegraphShape {
  readonly shape: 'circle' | 'cone' | 'line';
  /** Circle radius / cone length / line length (m). */
  readonly size: number;
  /** Cone angle (deg) or line width (m). */
  readonly width?: number;
  /** Where the caller places it (ignored here: position `object`). */
  readonly at?: 'self' | 'target';
}

const geometries = new Map<string, BufferGeometry>();
function cachedGeometry(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geometries.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geometries.set(key, g);
  }
  return g;
}

/**
 * Telegraph decals for big attacks: a thin pixel rim on the floor showing exactly where the
 * hit lands, and a sweep that fills it from the centre (circles, cones) or the caster (lines)
 * as the wind-up runs out: the sweep's front reaches the rim on the hit frame. Circle (slams,
 * novas, leap landings), cone (breaths, swipes) and line (charges, snipes). Faces +Z like
 * the monster; place it with `object.position` / `object.rotation.y`.
 *
 * Drawn in TSL so it stays pixel-crisp at any size: the rim is 2 art pixels wide whatever the
 * radius (measured with `fwidth` of the decal's own coordinates), the area is a sparse
 * screen-door stipple instead of a translucent disc (the floor, the actors' contact shadows
 * and other effects stay readable through it), and the sweep is a denser stipple with a bright
 * front. The last 20% of the wind-up blinks the rim white and fills the stipple in: dodge now.
 * Colours follow the damage type (`TELEGRAPH_COLORS`). Decals are transparent and never write
 * depth, so actors standing on them draw over them (no z-fighting, no decal over a body).
 * Materials are shared per shape × colour (a fixed small set: no shader builds mid-fight
 * after the first of each).
 */
export interface Telegraph {
  readonly object: Group;
  /** 0 = just started, 1 = the hit lands now. */
  update(progress: number): void;
  /** Recolour (the attack's damage type is known after the decal went down). */
  tint?(color: TelegraphColor): void;
  dispose(): void;
}

/** A damage type, or a raw hex colour (rim and sweep share it). */
export type TelegraphColor = DamageType | number;

/** Rim (bright) and sweep (deeper) colour per damage type. */
export const TELEGRAPH_COLORS: Readonly<Record<DamageType, { rim: number; fill: number }>> = {
  physical: { rim: PALETTE.sand, fill: PALETTE.orange },
  fire: { rim: PALETTE.orange, fill: PALETTE.red },
  cold: { rim: PALETTE.cyan, fill: PALETTE.sky },
  lightning: { rim: PALETTE.white, fill: PALETTE.blue },
  chaos: { rim: PALETTE.lime, fill: PALETTE.green },
};

/** The telegraph colour for a skill's tags: its first element, else physical. */
export function telegraphType(tags: readonly string[]): DamageType {
  for (const t of ['fire', 'cold', 'lightning', 'chaos'] as const) if (tags.includes(t)) return t;
  return 'physical';
}

function colorsOf(c: TelegraphColor): { rim: number; fill: number } {
  return typeof c === 'number' ? { rim: c, fill: c } : (TELEGRAPH_COLORS[c] ?? TELEGRAPH_COLORS.physical);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL nodes aren't usefully typed
type Node = any;

type Shape = 'circle' | 'cone' | 'line';
type Role = 'rim' | 'fill';

/** Art-pixel stipple masks (screen space: one fragment per art pixel in pixel mode). */
function stipple(density: 'sparse' | 'dots' | 'checker'): Node {
  const p = floor(screenCoordinate.xy);
  if (density === 'checker') return mod(p.x.add(p.y), 2).lessThan(0.5);
  if (density === 'dots') return mod(p.x, 2).lessThan(0.5).and(mod(p.y, 2).lessThan(0.5));
  // one pixel in eight, on a diagonal that crawls outward (the zone feels live, not printed)
  return mod(p.x.add(p.y.mul(3)).add(floor(time.mul(10))), 8).lessThan(0.5).and(mod(p.y, 2).lessThan(0.5));
}

/**
 * Distance (in decal units) from the fragment to the shape's edge, and the size of one art
 * pixel in the same units. `front` is the sweep's leading edge only (the outer arc / far end).
 */
function edge(shape: Shape, arc: number, front: boolean): { d: Node; px: Node } {
  const p = positionGeometry;
  if (shape === 'circle') {
    const r = length(p.xz);
    return { d: float(1).sub(r), px: fwidth(r) };
  }
  if (shape === 'cone') {
    const r = length(p.xz);
    const outer = float(1).sub(r);
    if (front) return { d: outer, px: fwidth(r) };
    const h = Math.min(Math.PI * 0.999, arc / 2);
    // distance to the nearer side: z·sin(h) − |x|·cos(h) (≥ 0 inside the wedge)
    const side = p.z.mul(Math.sin(h)).sub(abs(p.x).mul(Math.cos(h)));
    return { d: min(outer, side), px: fwidth(r) };
  }
  // line: x ∈ [-0.5, 0.5], z ∈ [0, 1], scaled non-uniformly: measure each axis in its own pixels
  const fx = max(fwidth(p.x), 1e-6);
  const fz = max(fwidth(p.z), 1e-6);
  const far = float(1).sub(p.z).div(fz);
  if (front) return { d: far, px: float(1) };
  const sides = float(0.5).sub(abs(p.x)).div(fx);
  return { d: min(min(sides, far), p.z.div(fz)), px: float(1) };
}

const materials = new Map<string, MeshBasicNodeMaterial>();

function decalMaterial(shape: Shape, arc: number, role: Role, rim: number, fill: number, hot: boolean): Material {
  const key = `${shape}:${shape === 'cone' ? Math.round((arc * 180) / Math.PI) : 0}:${role}:${rim}:${fill}:${hot ? 1 : 0}`;
  let m = materials.get(key);
  if (m) return m;
  m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.name = `telegraph-${key}`;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.userData.shared = true;
  const { d, px } = edge(shape, arc, role === 'fill');
  const ink = color(PALETTE.ink);
  const rimC = color(hot ? PALETTE.white : rim);
  const fillC = color(fill);
  if (role === 'rim') {
    // 2 px rim, 1 px ink line inside it (contrast on bright floors), sparse stipple inside
    const onRim = d.lessThan(px.mul(2));
    const onInk = d.lessThan(px.mul(3));
    const area = stipple(hot ? 'dots' : 'sparse');
    m.colorNode = select(onRim, rimC, select(onInk, ink, fillC));
    m.opacityNode = select(onRim, float(1), select(onInk, float(0.55), select(area, float(hot ? 0.7 : 0.55), float(0))));
  } else {
    // the sweep: a bright 1 px front, a stipple behind it
    const onFront = d.lessThan(px);
    const area = stipple(hot ? 'checker' : 'dots');
    m.colorNode = select(onFront, color(rim), fillC);
    m.opacityNode = select(onFront, float(0.95), select(area, float(hot ? 0.6 : 0.42), float(0)));
  }
  materials.set(key, m);
  return m;
}

const circleGeometry = () => new CircleGeometry(1, 48).rotateX(-Math.PI / 2);
/** A wedge centred on +Z (CircleGeometry's angle 0 is +X; after rotateX(−90°) angle −90° is +Z). */
const coneGeometry = (arc: number) => () => new CircleGeometry(1, Math.max(8, Math.round((arc * 24) / Math.PI)), -Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2);
const lineGeometry = () => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);

export function createTelegraph(spec: TelegraphShape, tint: TelegraphColor = 'physical', scale = 1, o: { zone?: boolean } = {}): Telegraph {
  const object = new Group();
  object.name = `Telegraph:${spec.shape}`;
  const size = spec.size * scale;
  const shape = spec.shape;
  const arc = shape === 'cone' ? ((spec.width ?? 90) * Math.PI) / 180 : 0;
  let geometry: BufferGeometry;
  if (shape === 'circle') geometry = cachedGeometry('t:disc', circleGeometry);
  else if (shape === 'cone') geometry = cachedGeometry(`t:wedge:${Math.round(spec.width ?? 90)}`, coneGeometry(arc));
  else geometry = cachedGeometry('t:line', lineGeometry);
  let colors = colorsOf(tint);
  let hot = false;
  const rim = new Mesh(geometry, decalMaterial(shape, arc, 'rim', colors.rim, colors.fill, false));
  const fill = new Mesh(geometry, decalMaterial(shape, arc, 'fill', colors.rim, colors.fill, false));
  rim.name = 'TelegraphRim';
  fill.name = 'TelegraphSweep';
  const w = spec.width ?? 1;
  if (shape === 'line') rim.scale.set(w, 1, size);
  else rim.scale.setScalar(size);
  // under every actor (opaque, drawn first), over the floor; rim over its own sweep
  rim.position.y = 0.025;
  fill.position.y = 0.02;
  rim.renderOrder = -2;
  fill.renderOrder = -3;
  for (const m of [rim, fill]) {
    m.castShadow = false;
    m.receiveShadow = false;
  }
  object.add(rim, fill);
  const paint = (h: boolean) => {
    hot = h;
    rim.material = decalMaterial(shape, arc, 'rim', colors.rim, colors.fill, h);
    fill.material = decalMaterial(shape, arc, 'fill', colors.rim, colors.fill, h);
  };
  let last = 0;
  const update = (p: number) => {
    // a zone (a lasting hazard) shows its whole area, calm: rim and stipple, no countdown
    const t = o.zone ? 1 : Math.min(1, Math.max(0.02, p));
    last = t;
    if (shape === 'line') fill.scale.set(w, 1, size * t);
    else fill.scale.setScalar(size * t);
    // the last 20%: blink (every ~1/16 of the wind-up), then hold hot on the hit
    const h = !o.zone && t >= 0.8 && (t >= 0.97 || Math.floor(t * 32) % 2 === 0);
    if (h !== hot) paint(h);
  };
  update(0);
  return {
    object,
    update,
    tint: (c) => {
      colors = colorsOf(c);
      paint(hot);
      update(last);
    },
    dispose: () => object.removeFromParent(),
  };
}
