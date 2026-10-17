/**
 * Readability checks (docs/ASSETS.md *Checks*): a part hidden
 * inside another, coplanar faces of different colours (z-fighting), touching large masses too
 * close in lightness to read apart at 480×270, and, counted on the game's own pixels
 * (`rasterParts`), large parts of one colour that merge into a single block and glow that covers
 * too much of the model (Gate A's first run lost on both: docs/ASSETS.md *Gate A*). `validateModel`
 * adds them to its warnings; each kind is one line per container, colour or colour pair, so a big
 * model stays readable.
 */
import { Vector3 } from 'three/webgpu';
import { PALETTE } from '../palette';
import { bindingHex } from './build';
import type { CompiledPart } from './compile';
import type { ExpandedModel } from './expand';
import { oklab } from './oklab';
import { GAME_VIEW, gamePxPerMetre, rasterParts } from './view';

/** A part's own extents, scaled by its matrix and sorted (so turning a rod doesn't make it thick). */
export function partExtents(p: CompiledPart): number[] {
  const e = p.matrix.elements;
  const sx = Math.hypot(e[0]!, e[1]!, e[2]!);
  const sy = Math.hypot(e[4]!, e[5]!, e[6]!);
  const sz = Math.hypot(e[8]!, e[9]!, e[10]!);
  return [p.extent[0] * sx, p.extent[1] * sy, p.extent[2] * sz].sort((a, b) => a - b);
}

/** Kinds whose solid is convex: a part entirely inside one never shows. */
const CONVEX = new Set(['box', 'cyl', 'cone', 'ball', 'wedge']);
/** Lightness (OKLab L) two touching large masses need between them to read apart. */
export const MIN_LIGHTNESS_STEP = 0.08;
/** A mass is large when its two biggest extents are at least this (m): ~5 art pixels. */
const LARGE = 0.25;
/** Faces this close (m) and this parallel are one plane. */
const PLANE = 0.001;
/** One colour may cover at most this share of the model's pixels at game scale… */
export const MAX_ONE_COLOUR_SHARE = 0.4;
/** …when it joins at least this many large parts into one block. */
export const BLOCK_PARTS = 4;
/** A part counts toward a block when its second-biggest extent is at least this (m): ~4 art pixels. */
const BLOCK_PART = 0.2;
/** Glow draws flat (no shading): it may cover at most this share of the model's pixels… */
export const MAX_GLOW_SHARE = 0.15;
/** …once it is big enough to read as a shape (art pixels at the level zoom; an ember is less). */
const MIN_GLOW_PX = 30;

const r2 = (v: number) => Math.round(v * 100) / 100;
const colourName = (hex: number) => Object.entries(PALETTE).find(([, v]) => v === hex)?.[0] ?? `#${hex.toString(16).padStart(6, '0')}`;
const list = (labels: readonly string[]) => `${labels.slice(0, 4).join(', ')}${labels.length > 4 ? ', …' : ''}`;

interface World {
  readonly part: CompiledPart;
  readonly pts: Vector3[];
  readonly min: Vector3;
  readonly max: Vector3;
  /** The slot's colour, or a textured part's mean texel colour. */
  readonly hex: number;
  /** What it looks like: colour, glow and texture (equal looks don't fight or need contrast). */
  readonly look: string;
  /** A mirrored part's triangles wind the other way. */
  readonly flip: boolean;
}

interface Face {
  readonly i: number;
  readonly a: Vector3;
  readonly b: Vector3;
  readonly c: Vector3;
  readonly n: Vector3;
  readonly d: number;
  readonly min: Vector3;
  readonly max: Vector3;
}

/** A part's colour for messages: its PALETTE name or hex, or its texture. */
const nameOf = (x: World) => (x.part.tex && !x.part.glow ? `texture '${x.part.tex}'` : colourName(x.hex));

function worldOf(parts: readonly CompiledPart[], palette: ExpandedModel['palette'], texColour?: (id: string) => number): World[] {
  return parts.map((part) => {
    const pts: Vector3[] = [];
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < part.tris.length; i += 3) {
      const v = new Vector3(part.tris[i]!, part.tris[i + 1]!, part.tris[i + 2]!).applyMatrix4(part.matrix);
      pts.push(v);
      min.min(v);
      max.max(v);
    }
    const b = palette[part.slot];
    const tex = part.tex && !part.glow ? part.tex : '';
    const hex = tex && texColour ? texColour(tex) : b === undefined ? 0xff00ff : bindingHex(b);
    return { part, pts, min, max, hex, look: `${hex}|${part.glow}|${tex}`, flip: part.matrix.determinant() < 0 };
  });
}

function facesOf(w: readonly World[]): Face[] {
  const out: Face[] = [];
  w.forEach((x, i) => {
    for (let k = 0; k + 2 < x.pts.length; k += 3) {
      const [a, b, c] = [x.pts[k]!, x.pts[k + 1]!, x.pts[k + 2]!];
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      if (n.lengthSq() < 1e-18) continue;
      n.normalize();
      if (x.flip) n.negate();
      out.push({ i, a, b, c, n, d: n.dot(a), min: a.clone().min(b).min(c), max: a.clone().max(b).max(c) });
    }
  });
  return out;
}

/**
 * Hidden parts, z-fighting faces and touching masses too close in lightness. `texColour` gives a
 * textured part's mean colour (else it counts as its slot's).
 */
export function readabilityWarnings(parts: readonly CompiledPart[], palette: ExpandedModel['palette'], floats = false, texColour?: (id: string) => number): string[] {
  const out: string[] = [];
  const w = worldOf(parts, palette, texColour);
  const faces = facesOf(w);
  const eps = 1e-4;

  // ---- hidden: every vertex of A inside convex B (same pivot: a moving part may come out)
  const planes = w.map((b, j) => (CONVEX.has(b.part.kind) ? faces.filter((f) => f.i === j).map((f) => ({ n: f.n, d: f.d })) : null));
  const inside = (i: number, j: number) => {
    const a = w[i]!;
    const b = w[j]!;
    if (a.min.x < b.min.x - eps || a.min.y < b.min.y - eps || a.min.z < b.min.z - eps || a.max.x > b.max.x + eps || a.max.y > b.max.y + eps || a.max.z > b.max.z + eps) return false;
    return a.pts.every((p) => planes[j]!.every((pl) => pl.n.dot(p) - pl.d <= eps));
  };
  const hiddenIn = new Map<number, Set<string>>();
  w.forEach((a, i) => {
    for (let j = 0; j < w.length; j++) {
      const b = w[j]!;
      if (i === j || !planes[j] || a.part.matrix === b.part.matrix || a.part.pivot !== b.part.pivot) continue;
      if (!inside(i, j)) continue;
      // two parts filling the same space: report the later one, once
      if (planes[i] && inside(j, i) && j > i) continue;
      const set = hiddenIn.get(j) ?? new Set<string>();
      set.add(a.part.label);
      hiddenIn.set(j, set);
      break;
    }
  });
  for (const [j, set] of hiddenIn) {
    const labels = [...set];
    const who = labels.length > 1 ? `${labels.length} parts (${list(labels)}) are` : `${labels[0]} is`;
    out.push(`${who} inside ${w[j]!.part.label}: at most a face flush with it shows; remove ${labels.length > 1 ? 'them' : 'it'} or move ${labels.length > 1 ? 'them' : 'it'} out`);
  }

  // ---- z-fighting: coplanar, same-facing, overlapping faces of different materials. Faces
  // that face the same way are sorted by plane offset and swept within 1 mm, so no plane is
  // split at a bucket edge. One line per colour pair: its part pairs and the planes they share.
  interface Fight {
    readonly pairs: Set<string>;
    readonly labels: string[];
    readonly planes: Map<string, number>;
  }
  const fights = new Map<string, Fight>();
  const byNormal = new Map<string, Face[]>();
  for (const f of faces) {
    const key = `${Math.round(f.n.x * 100)},${Math.round(f.n.y * 100)},${Math.round(f.n.z * 100)}`;
    const group = byNormal.get(key);
    if (group) group.push(f);
    else byNormal.set(key, [f]);
  }
  const sweep = (sorted: Face[]) => {
    for (let x = 0; x < sorted.length; x++) {
      const p = sorted[x]!;
      for (let y = x + 1; y < sorted.length && sorted[y]!.d - p.d <= PLANE; y++) {
        const q = sorted[y]!;
        if (p.i === q.i) continue;
        const pa = w[p.i]!;
        const qa = w[q.i]!;
        if (pa.look === qa.look || pa.part.matrix === qa.part.matrix) continue;
        if (p.n.dot(q.n) < 0.9999) continue;
        if (!floats && p.n.y < -0.999 && Math.abs(p.d) < PLANE) continue; // bottoms on the floor never show
        const t = PLANE; // the planes may be up to 1 mm apart
        if (p.max.x < q.min.x - t || q.max.x < p.min.x - t || p.max.y < q.min.y - t || q.max.y < p.min.y - t || p.max.z < q.min.z - t || q.max.z < p.min.z - t) continue;
        const [lo, hi] = p.i < q.i ? [p.i, q.i] : [q.i, p.i];
        const colours = [w[lo]!.look, w[hi]!.look].sort().join('/');
        const g = fights.get(colours) ?? { pairs: new Set<string>(), labels: [], planes: new Map<string, number>() };
        fights.set(colours, g);
        const pair = `${lo}|${hi}`;
        if (g.pairs.has(pair) || overlapArea(p, q) < 1e-6) continue;
        g.pairs.add(pair);
        if (g.labels.length < 4) g.labels.push(`${w[lo]!.part.label} (${nameOf(w[lo]!)}) and ${w[hi]!.part.label} (${nameOf(w[hi]!)})`);
        const plane = planeName(p);
        g.planes.set(plane, (g.planes.get(plane) ?? 0) + 1);
      }
    }
  };
  for (const group of byNormal.values()) sweep(group.sort((p, q) => p.d - q.d));
  for (const g of fights.values()) {
    if (!g.pairs.size) continue;
    const at = g.planes.size > 1 ? `on ${g.planes.size} planes` : `at ${[...g.planes.keys()][0]}`;
    const who = g.pairs.size > 1 ? `${g.pairs.size} pairs of parts (${g.labels.join(', ')}${g.pairs.size > 4 ? ', …' : ''}) share faces` : `${g.labels[0]} share a face`;
    out.push(`${who} ${at} (z-fighting): move one 2 mm or more, or give them one colour`);
  }

  // ---- touching large masses that won't read apart: one line per colour pair
  const ext = (x: World) => [x.max.x - x.min.x, x.max.y - x.min.y, x.max.z - x.min.z].sort((a, b) => a - b);
  const pairs = new Set<string>();
  w.forEach((a, i) => {
    w.forEach((b, j) => {
      if (j <= i || a.look === b.look || a.part.glow || b.part.glow) return;
      if (ext(a)[1]! < LARGE || ext(b)[1]! < LARGE) return;
      const gap = Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));
      if (gap > 0.01) return;
      const dl = Math.abs(oklab(a.hex).L - oklab(b.hex).L);
      const key = [a.look, b.look].sort().join('/');
      if (dl >= MIN_LIGHTNESS_STEP || pairs.has(key)) return;
      pairs.add(key);
      out.push(`${a.part.label} (${nameOf(a)}) and ${b.part.label} (${nameOf(b)}) touch but differ by only ${r2(dl)} in lightness (under ${MIN_LIGHTNESS_STEP}): they won't read apart at 480×270; pick colours further apart in lightness`);
    });
  });
  out.push(...gameScaleWarnings(w));
  return out;
}

/**
 * What the game's camera sees, from the front (yaw 45°) and the far side (225°): a connected
 * region of one colour holding several large parts reads as one block, and big glow reads as a
 * flat cut-out. Each is reported once, at its worst view.
 */
function gameScaleWarnings(w: readonly World[]): string[] {
  const out: string[] = [];
  // a textured part shows its texels, never a flat block: it keys alone
  const key = w.map((x, i) => (x.look.endsWith('|') ? x.look : `tex|${i}`));
  const large = w.map((x) => partExtents(x.part)[1]! >= BLOCK_PART);
  const blocks = new Map<string, { share: number; parts: number; labels: string[] }>();
  let glow = 0;
  for (const yaw of [GAME_VIEW.yaw, GAME_VIEW.yaw + 180]) {
    const { width, ids, scale } = rasterParts(w.map((x) => x.pts), yaw);
    let total = 0;
    let lit = 0;
    for (const id of ids) {
      if (!id) continue;
      total++;
      if (w[id - 1]!.part.glow) lit++;
    }
    if (!total) continue;
    if (lit >= MIN_GLOW_PX * (scale / gamePxPerMetre(GAME_VIEW.zooms.level)) ** 2) glow = Math.max(glow, lit / total);
    const seen = new Uint8Array(ids.length);
    for (let k = 0; k < ids.length; k++) {
      if (!ids[k] || seen[k]) continue;
      const kk = key[ids[k]! - 1]!;
      const parts = new Set<number>();
      const stack = [k];
      seen[k] = 1;
      let n = 0;
      while (stack.length) {
        const q = stack.pop()!;
        n++;
        parts.add(ids[q]! - 1);
        const x = q % width;
        for (const j of [x > 0 ? q - 1 : -1, x < width - 1 ? q + 1 : -1, q - width, q + width]) {
          if (j < 0 || j >= ids.length || seen[j] || !ids[j] || key[ids[j]! - 1] !== kk) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      const big = [...parts].filter((i) => large[i]);
      const share = n / total;
      if (big.length < BLOCK_PARTS || share < MAX_ONE_COLOUR_SHARE || (blocks.get(kk)?.share ?? 0) >= share) continue;
      blocks.set(kk, { share, parts: big.length, labels: [...new Set(big.map((i) => w[i]!.part.label))].sort() });
    }
  }
  for (const [kk, b] of blocks) {
    const name = colourName(Number(kk.split('|')[0]));
    out.push(`${b.parts} large ${name} parts (${list(b.labels)}) join into one block, ${Math.round(b.share * 100)}% of the model at game scale: at 480×270 they read as a single shape; give some of them a second colour or a darker shade (alternate the stones or planks, add a trim, or dark joints behind them)`);
  }
  if (glow > MAX_GLOW_SHARE) {
    const labels = [...new Set(w.filter((x) => x.part.glow).map((x) => x.part.label))];
    out.push(`glow parts (${list(labels)}) cover ${Math.round(glow * 100)}% of the model at game scale: glow draws as one flat colour, so a big glow part reads as a solid shape; keep glow for small hot spots (embers, a flame's core) and build the rest from lit parts (see the flame model)`);
  }
  return out;
}

function planeName(p: Face): string {
  if (Math.abs(p.n.y) > 0.99) return `y = ${r2(p.d * Math.sign(p.n.y))}`;
  if (Math.abs(p.n.x) > 0.99) return `x = ${r2(p.d * Math.sign(p.n.x))}`;
  if (Math.abs(p.n.z) > 0.99) return `z = ${r2(p.d * Math.sign(p.n.z))}`;
  return 'a slanted plane';
}

/** Area shared by two coplanar triangles (clipped in the plane's 2D coordinates). */
function overlapArea(p: Face, q: Face): number {
  const u = Math.abs(p.n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const e1 = u.cross(p.n).normalize();
  const e2 = p.n.clone().cross(e1);
  const to2 = (v: Vector3): [number, number] => [v.dot(e1), v.dot(e2)];
  let poly = [p.a, p.b, p.c].map(to2);
  const clip = [q.a, q.b, q.c].map(to2);
  const area2 = (t: [number, number][]) => t.reduce((s, v, i) => s + v[0] * t[(i + 1) % t.length]![1] - t[(i + 1) % t.length]![0] * v[1], 0);
  if (area2(clip) < 0) clip.reverse();
  for (let i = 0; i < 3 && poly.length; i++) {
    const [ax, ay] = clip[i]!;
    const [bx, by] = clip[(i + 1) % 3]!;
    const side = (v: [number, number]) => (bx - ax) * (v[1] - ay) - (by - ay) * (v[0] - ax);
    const next: [number, number][] = [];
    for (let k = 0; k < poly.length; k++) {
      const c = poly[k]!;
      const d = poly[(k + 1) % poly.length]!;
      const sc = side(c);
      const sd = side(d);
      if (sc >= 0) next.push(c);
      if (sc >= 0 !== sd >= 0) {
        const t = sc / (sc - sd);
        next.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]);
      }
    }
    poly = next;
  }
  return poly.length >= 3 ? Math.abs(area2(poly)) / 2 : 0;
}
