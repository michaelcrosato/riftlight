import { Box3, BufferAttribute, BufferGeometry, Color, Matrix3, type Matrix4, type Mesh, MeshBasicNodeMaterial, MeshToonNodeMaterial, type Node, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { attribute, clamp, dot, float, floor, fract, hash, length, materialEmissive, materialReference, max, mix, normalView, screenCoordinate, sin, step, vec3 } from 'three/tsl';
import { snappedClipPosition, toonGradient } from '../../engine/render/toon';
import { Rng } from '../core/rng';
import type { Genome } from '../core/types';
import { hullPoints } from './anim/ik';
import { hexToHsl, hslHex } from './palette';
import type { PaletteSlot } from './types';

/**
 * Monster skin: every monster body is drawn with ONE shared toon material whose colour
 * comes from vertex attributes, so a whole bestiary costs one shader (plus one unlit glow
 * material), and a joint's parts merge into one mesh whatever their colours: a monster is a
 * draw call or two per moving joint.
 *
 * Per vertex (written when the joint's pieces are merged, see `mergePieces`):
 *
 * - `color`  base colour (linear), `skinB` belly colour, `skinM` marking colour, `skinR` rim
 *   light colour (the palette's glow);
 * - `skinX`  xyz = position in the joint's space (m, genome scale 1: the pattern rides on the
 *   body and never swims), w = position along the piece's long axis (stripes and rings);
 * - `skinK`  x = belly signal (the vertex normal · the plan's belly direction; > 0.3 is
 *   belly), y = stripes per metre, z = spot cells per metre, w = marks glow (1 = emissive,
 *   elemental veins).
 *
 * The TSL below and `skinColour` (the same maths in JS, for the software rasterizers'
 * `triColors`) must agree.
 */
export type PatternKind = 'plain' | 'stripes' | 'spots' | 'rings' | 'veins';

export interface Skin {
  readonly kind: PatternKind;
  /** Marks per metre (stripes) or spot cells per metre. */
  readonly freq: number;
  /** Belly colour (counter-shading), marking colour. */
  readonly belly: number;
  readonly mark: number;
  /** Marks are emissive (veins). */
  readonly glowMarks: boolean;
  /** Belly direction in body space: [0,-1,0] for beasts, front-and-down for upright bodies. */
  readonly bellyDir: readonly [number, number, number];
  /** Rim light colour: the palette's glow lifted toward white, so it reads as light. */
  readonly rim: number;
}

const BELLY_EDGE = 0.3;
const STRIPE_DUTY = 0.4;
const VEIN_DUTY = 0.14;

// ---------------------------------------------------------------- materials

/**
 * The toon material with an emissive node and a `dissolve` amount of its own. A class (not
 * a plain instance with extra properties) so `clone()` (BodyFx's per-body flash and dissolve
 * copies) keeps both: NodeMaterial copies only the properties a new instance already has.
 */
class SkinToonMaterial extends MeshToonNodeMaterial {
  emissiveNode: Node | null = null;
  /** 0 = solid, 1 = gone (BodyFx.dissolve, on per-body clones). */
  dissolve = 0;
}

/** The glow parts' unlit material, dissolvable with the body. */
class SkinGlowMaterial extends MeshBasicNodeMaterial {
  dissolve = 0;
}

let skinMat: SkinToonMaterial | null = null;
let glowMat: SkinGlowMaterial | null = null;

/** Rim band (as the engine's toon `rim`): surfaces this far from facing the camera light up. */
const RIM_THRESHOLD = 0.45;

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL swizzles and operators aren't typed on Node */
function hash33(p: any): any {
  let p3: any = fract(p.mul(vec3(0.1031, 0.103, 0.0973)));
  p3 = p3.add(dot(p3, p3.yxz.add(33.33)));
  return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
}

/** Per-art-pixel dissolve: a mask and a 1-pixel glowing front (as the engine's toon `dissolve`). */
function dissolveNodes(): { mask: any; front: any } {
  const amount: any = materialReference('dissolve', 'float');
  const noise = hash(floor(screenCoordinate.x).add(floor(screenCoordinate.y).mul(1291)));
  return { mask: noise.greaterThanEqual(amount), front: step(noise, amount.add(0.08)).mul(step(0.001, amount)) };
}

/** The shared toon skin material (colour, belly, markings and rim light from vertex attributes). */
export function skinMaterial(): MeshToonNodeMaterial {
  if (skinMat) return skinMat;
  const base: any = attribute('color', 'vec3');
  const belly: any = attribute('skinB', 'vec3');
  const mark: any = attribute('skinM', 'vec3');
  const rim: any = attribute('skinR', 'vec3');
  const X: any = attribute('skinX', 'vec4');
  const K: any = attribute('skinK', 'vec4');
  const bellyM = step(BELLY_EDGE, K.x);
  // wavy, uneven stripes (a tiger's, not a bee's): the phase wanders with the position
  const wobble = sin(X.x.mul(K.y).mul(1.7).add(X.z.mul(K.y).mul(1.3)).add(X.w.mul(0.9))).mul(0.32);
  // glowing veins are thin cracks, stripes are bands
  const stripeM = step(fract(X.w.mul(K.y).add(wobble)), float(STRIPE_DUTY).sub(K.w.mul(STRIPE_DUTY - VEIN_DUTY))).mul(step(0.01, K.y));
  const p = X.xyz.mul(K.z);
  const h = hash33(floor(p));
  const spotM = step(length(fract(p).sub(h.mul(0.5).add(0.25))), h.x.mul(0.14).add(0.2)).mul(step(0.01, K.z));
  const markM = max(stripeM, spotM).mul(float(1).sub(bellyM));
  // rim light in the monster's glow colour: a silhouette that reads on dark floors
  const nz = clamp(normalView.z, 0, 1);
  const rimM = step(RIM_THRESHOLD, float(1).sub(nz)).mul(step(-0.15, normalView.y));
  const d = dissolveNodes();
  const m = new SkinToonMaterial({ gradientMap: toonGradient() });
  m.colorNode = mix(mix(base, belly, bellyM), mark, markM);
  m.emissiveNode = (materialEmissive as any).add(mark.mul(markM).mul(K.w)).add(rim.mul(rimM)).add(rim.mul(d.front.mul(2)));
  m.maskNode = d.mask;
  m.vertexNode = snappedClipPosition();
  m.name = 'monster-skin';
  m.userData.shared = true;
  skinMat = m;
  return m;
}

/** The shared unlit material for eyes, cores, crystals and flames (vertex colours). */
export function skinGlowMaterial(): MeshBasicNodeMaterial {
  if (glowMat) return glowMat;
  const m = new SkinGlowMaterial({ vertexColors: true });
  m.maskNode = dissolveNodes().mask;
  m.vertexNode = snappedClipPosition();
  m.name = 'monster-glow';
  m.userData.shared = true;
  glowMat = m;
  return m;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- pattern maths (JS twin)

const fr = (v: number) => v - Math.floor(v);

function hash33js(x: number, y: number, z: number): [number, number, number] {
  let a = fr(x * 0.1031);
  let b = fr(y * 0.103);
  let c = fr(z * 0.0973);
  const d = a * (b + 33.33) + b * (a + 33.33) + c * (c + 33.33);
  a += d;
  b += d;
  c += d;
  return [fr((a + b) * c), fr((a + a) * b), fr((b + a) * a)];
}

/** Which colour a point shows: 0 = base, 1 = belly, 2 = mark. Same maths as the shader. */
export function skinRegion(X: readonly [number, number, number, number], K: readonly [number, number, number, number]): 0 | 1 | 2 {
  if (K[0] >= BELLY_EDGE) return 1;
  if (K[1] > 0.01 && fr(X[3] * K[1] + Math.sin(X[0] * K[1] * 1.7 + X[2] * K[1] * 1.3 + X[3] * 0.9) * 0.32) <= STRIPE_DUTY - K[3] * (STRIPE_DUTY - VEIN_DUTY)) return 2;
  if (K[2] > 0.01) {
    const px = X[0] * K[2];
    const py = X[1] * K[2];
    const pz = X[2] * K[2];
    const h = hash33js(Math.floor(px), Math.floor(py), Math.floor(pz));
    const dx = fr(px) - (h[0] * 0.5 + 0.25);
    const dy = fr(py) - (h[1] * 0.5 + 0.25);
    const dz = fr(pz) - (h[2] * 0.5 + 0.25);
    if (Math.hypot(dx, dy, dz) <= h[0] * 0.14 + 0.2) return 2;
  }
  return 0;
}

// ---------------------------------------------------------------- genome → skin

/** Plans whose belly faces forward (upright) rather than down. */
const UPRIGHT = new Set(['biped', 'brute']);
const ELEMENTAL = ['fire', 'storm', 'void', 'crystal', 'arcane', 'ice'];

/**
 * The skin a genome wears. Genes `pattern` (kind), `patternScale` (frequency) and `markHue`
 * (marking colour) pick it; genomes saved before those genes existed get them from a hash
 * of their body shape, so pack mates (same shape, different seeds) still match.
 */
export function skinOf(g: Genome, tags: readonly string[] = []): Skin {
  const fallback = new Rng(`skin:${g.plan}:${g.parts.map((p) => p.part).join(',')}:${g.palette.primary}`);
  const gene = (name: string) => g.genes[name] ?? fallback.fork(name).next();
  const p = gene('pattern');
  const elemental = tags.some((t) => ELEMENTAL.includes(t));
  const big = g.rank === 'boss' || g.rank === 'rare';
  let kind: PatternKind = p < 0.22 ? 'plain' : p < 0.48 ? 'stripes' : p < 0.72 ? 'spots' : 'rings';
  // Elemental monsters of note wear their element in glowing veins.
  if (elemental && (big || p > 0.9)) kind = 'veins';
  const scale = gene('patternScale');
  const freq = kind === 'spots' ? 4 + scale * 4 : kind === 'veins' ? 3.2 + scale * 2.4 : 3 + scale * 3;
  const pal = g.palette;
  const [h, s, l] = hexToHsl(pal.primary);
  const [h2, s2, l2] = hexToHsl(pal.secondary);
  // Counter-shading: a lighter, softer belly between the two body colours.
  const belly = hslHex(mixHue(h, h2, 0.35), Math.min(s, s2) * 0.75, Math.min(0.88, Math.max(l, l2) + 0.14));
  const markGene = gene('markHue');
  // markings: a deep shade of the body colour, or of a hue between the body's two colours
  // (accents clash as stripes; the palette's dark reads as holes at 480×270)
  const mark = kind === 'veins' ? pal.glow : hslHex(markGene < 0.6 ? h : mixHue(h, h2, 0.5), Math.min(1, s + 0.1), Math.max(0.12, l - (markGene < 0.6 ? 0.2 : 0.16)));
  const bellyDir: [number, number, number] = UPRIGHT.has(g.plan) ? [0, -0.45, 0.89] : [0, -1, 0];
  return { kind, freq, belly, mark, glowMarks: kind === 'veins', bellyDir, rim: rimTint(pal.glow) };
}

/** The rim colour: the glow hue lifted toward white and dimmed, so it reads as light rather than paint. */
function rimTint(hex: number): number {
  const lift = (c: number) => Math.round((c + (255 - c) * 0.35) * 0.8);
  return (lift((hex >> 16) & 255) << 16) | (lift((hex >> 8) & 255) << 8) | lift(hex & 255);
}

function mixHue(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

// ---------------------------------------------------------------- pieces → merged meshes

/** One mesh worth of a part or body shape, before merging (geometry is the shared unit one). */
export interface Piece {
  readonly geometry: BufferGeometry;
  /** Transform in the joint's space. */
  readonly matrix: Matrix4;
  readonly hex: number;
  readonly slot: PaletteSlot;
  readonly glow: boolean;
  /** Takes the body pattern (belly and marks). */
  readonly patterned: boolean;
}

export interface Merged {
  skin: BufferGeometry | null;
  glow: BufferGeometry | null;
}

const _c = new Color();
const _nm = new Matrix3();
const _box = new Box3();
const _size = new Vector3();

/** A unit geometry's hull points (`hullPoints`), cached: pieces transform these. */
const hulls = new WeakMap<BufferGeometry, Float32Array>();
function unitHull(g: BufferGeometry): Float32Array {
  let h = hulls.get(g);
  if (!h) hulls.set(g, (h = hullPoints(g.getAttribute('position').array as ArrayLike<number>)));
  return h;
}

/**
 * Merge a joint's pieces into one skin geometry and one glow geometry, writing the skin
 * attributes and the rasterizers' `triColors` (one colour per triangle, at its centroid).
 */
export function mergePieces(pieces: readonly Piece[], skin: Skin): Merged {
  const lit = pieces.filter((p) => !p.glow);
  const glow = pieces.filter((p) => p.glow);
  return { skin: lit.length ? build(lit, skin, false) : null, glow: glow.length ? build(glow, skin, true) : null };
}

function triCount(g: BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

function build(pieces: readonly Piece[], skin: Skin, glow: boolean): BufferGeometry {
  let verts = 0;
  let tris = 0;
  for (const p of pieces) {
    verts += p.geometry.getAttribute('position').count;
    tris += triCount(p.geometry);
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const skB = glow ? null : new Float32Array(verts * 3);
  const skM = glow ? null : new Float32Array(verts * 3);
  const skR = glow ? null : new Float32Array(verts * 3);
  const skX = glow ? null : new Float32Array(verts * 4);
  const skK = glow ? null : new Float32Array(verts * 4);
  const index = verts > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3);
  const triColors = new Uint8Array(tris * 4);
  const belly = lin(skin.belly);
  const mark = lin(skin.mark);
  const rim = lin(skin.rim);
  const bd = new Vector3(...skin.bellyDir).normalize();
  const hullOut: number[] = [];
  const X = [0, 0, 0, 0] as [number, number, number, number];
  const K = [0, 0, 0, 0] as [number, number, number, number];
  let v0 = 0;
  let t = 0;
  pieces.forEach((piece, pieceIndex) => {
    const g = piece.geometry;
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    const m = piece.matrix;
    _nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const base = lin(piece.hex);
    // Stripe axis: the joint-space axis (Y or Z) the piece is longest along, so stripes run
    // round a limb or a torso and line up across every piece on the joint (absolute
    // coordinates). Roundish pieces stripe along the joint's Y (the bone).
    if (!g.boundingBox) g.computeBoundingBox();
    _box.copy(g.boundingBox!).applyMatrix4(m);
    _box.getSize(_size);
    const alongZ = _size.z > _size.y * 1.3 && _size.z > _size.x;
    const patterned = !glow && piece.patterned;
    const stripes = patterned && (skin.kind === 'stripes' || skin.kind === 'rings' || skin.kind === 'veins') ? skin.freq : 0;
    const spots = patterned && skin.kind === 'spots' ? skin.freq : 0;
    const glowMarks = skin.glowMarks ? 1 : 0;
    const e = m.elements;
    const ne = _nm.elements;
    const P = gp.array as ArrayLike<number>;
    const N = gn.array as ArrayLike<number>;
    const hull = unitHull(g);
    for (let i = 0; i < hull.length; i += 3) {
      const x = hull[i]!;
      const y = hull[i + 1]!;
      const z = hull[i + 2]!;
      hullOut.push(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[1]! * x + e[5]! * y + e[9]! * z + e[13]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!);
    }
    // vertices, transformed once
    const count = gp.count;
    for (let i = 0; i < count; i++) {
      const px = P[i * 3]!;
      const py = P[i * 3 + 1]!;
      const pz = P[i * 3 + 2]!;
      const x = e[0]! * px + e[4]! * py + e[8]! * pz + e[12]!;
      const y = e[1]! * px + e[5]! * py + e[9]! * pz + e[13]!;
      const z = e[2]! * px + e[6]! * py + e[10]! * pz + e[14]!;
      const qx = N[i * 3]!;
      const qy = N[i * 3 + 1]!;
      const qz = N[i * 3 + 2]!;
      let nx = ne[0]! * qx + ne[3]! * qy + ne[6]! * qz;
      let ny = ne[1]! * qx + ne[4]! * qy + ne[7]! * qz;
      let nz = ne[2]! * qx + ne[5]! * qy + ne[8]! * qz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const o3 = (v0 + i) * 3;
      pos[o3] = x;
      pos[o3 + 1] = y;
      pos[o3 + 2] = z;
      nor[o3] = nx;
      nor[o3 + 1] = ny;
      nor[o3 + 2] = nz;
      col[o3] = base[0];
      col[o3 + 1] = base[1];
      col[o3 + 2] = base[2];
      if (skB && skM && skR && skX && skK) {
        skB[o3] = belly[0];
        skB[o3 + 1] = belly[1];
        skB[o3 + 2] = belly[2];
        skM[o3] = mark[0];
        skM[o3 + 1] = mark[1];
        skM[o3 + 2] = mark[2];
        skR[o3] = rim[0];
        skR[o3 + 1] = rim[1];
        skR[o3 + 2] = rim[2];
        const o4 = (v0 + i) * 4;
        skX[o4] = x;
        skX[o4 + 1] = y;
        skX[o4 + 2] = z;
        skX[o4 + 3] = alongZ ? z : y;
        skK[o4] = patterned ? nx * bd.x + ny * bd.y + nz * bd.z : -2;
        skK[o4 + 1] = stripes;
        skK[o4 + 2] = spots;
        skK[o4 + 3] = glowMarks;
      }
    }
    // triangles (winding flipped for mirrored pieces) and the rasterizers' colour: the
    // pattern at each triangle's centroid
    const I = g.index ? (g.index.array as ArrayLike<number>) : null;
    const nt = triCount(g);
    for (let tri = 0; tri < nt; tri++) {
      const a = v0 + (I ? I[tri * 3]! : tri * 3);
      const b = v0 + (I ? I[tri * 3 + 1]! : tri * 3 + 1);
      const c = v0 + (I ? I[tri * 3 + 2]! : tri * 3 + 2);
      index[t * 3] = a;
      index[t * 3 + 1] = flip ? c : b;
      index[t * 3 + 2] = flip ? b : c;
      let rgb = piece.hex;
      let unlit = glow;
      if (skX && skK) {
        for (let k = 0; k < 4; k++) {
          X[k] = (skX[a * 4 + k]! + skX[b * 4 + k]! + skX[c * 4 + k]!) / 3;
          K[k] = (skK[a * 4 + k]! + skK[b * 4 + k]! + skK[c * 4 + k]!) / 3;
        }
        const region = skinRegion(X, K);
        if (region === 1) rgb = skin.belly;
        else if (region === 2) {
          rgb = skin.mark;
          unlit = skin.glowMarks;
        }
      }
      const t4 = t * 4;
      triColors[t4] = (rgb >> 16) & 255;
      triColors[t4 + 1] = (rgb >> 8) & 255;
      triColors[t4 + 2] = rgb & 255;
      triColors[t4 + 3] = (unlit ? 1 : 0) | ((pieceIndex % 127) << 1);
      t++;
    }
    v0 += count;
  });
  const out = new BufferGeometry();
  out.setIndex(new BufferAttribute(index, 1));
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  if (skB && skM && skR && skX && skK) {
    out.setAttribute('skinB', new BufferAttribute(skB, 3));
    out.setAttribute('skinM', new BufferAttribute(skM, 3));
    out.setAttribute('skinR', new BufferAttribute(skR, 3));
    out.setAttribute('skinX', new BufferAttribute(skX, 4));
    out.setAttribute('skinK', new BufferAttribute(skK, 4));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  out.userData.triColors = triColors;
  // the floor clamp's hull (anim/bake): the pieces' unit hulls, transformed
  out.userData.hull = new Float32Array(hullOut);
  return out;
}

/** Linear-space RGB of an sRGB hex (three's working colour space). */
function lin(hex: number): [number, number, number] {
  _c.setHex(hex);
  return [_c.r, _c.g, _c.b];
}

/** sRGB hex of a mesh's preset triangle colour (tests, inspectors). */
export function srgbOf(c: Color): number {
  const o = { r: 0, g: 0, b: 0 };
  c.getRGB(o, SRGBColorSpace);
  return (Math.round(o.r * 255) << 16) | (Math.round(o.g * 255) << 8) | Math.round(o.b * 255);
}

/** Meshes of a monster that use the shared skin (inspectors, tests). */
export function isSkinMesh(m: Mesh): boolean {
  return m.material === skinMat || m.material === glowMat;
}
