/**
 * Palette mapping for imports (docs/plans/asset-system.md §7.3): source colours → a few palette
 * slots, each bound to a PALETTE entry. It works on a whole model (or a whole pack), never one
 * colour at a time, because a nearest match per colour turns pale wood into `white`:
 *
 * 1. **Cluster** the per-face colours in OKLab into 2–6 clusters, hue weighted up and lightness
 *    down (baked shading varies lightness most): near duplicates and the steps of a baked
 *    gradient join; colours further apart than the palette's closest pair stay apart.
 * 2. **Assign** clusters to entries, biggest area first, at the cost
 *    `ΔL² + (0.7·ΔC)² + (2.5·ΔH)²`, where ΔH is the hue chord `2·√(C₁C₂)·sin(Δh/2)` (it shrinks
 *    to nothing for greys, whose hue means nothing), plus a penalty when a grey and a colour swap
 *    and another for an entry a bigger cluster already took. Then move clusters one at a time
 *    while that lowers the total, so a big pale wood steps aside to `sand` when that lets a small
 *    pink cushion keep `orange` to itself.
 * 3. **Keep lightness order** within a hue family: a light and a dark wood stay light and dark.
 *
 * Slots take the material's name when it means something (`wood`, `metalDark`), else `c1`,
 * `c2`… by area. Deterministic: the same colours give the same slots, in any order.
 */
import { PALETTE, type PaletteColor } from '../../palette';
import { lch, oklab, oklabHex, type OkLab } from '../oklab';
import type { Slot } from '../types';

/** One source colour and how much of the model it covers. */
export interface ColourSample {
  /** sRGB, 0xrrggbb. */
  readonly hex: number;
  /** Area it covers (m²); weights the cluster centres and the order of assignment. */
  readonly area: number;
  /** The source material's name, for the slot's name. */
  readonly name?: string;
}

export interface ColourSlot {
  readonly slot: Slot;
  readonly colour: PaletteColor;
  /** The cluster's centre (area-weighted in OKLab), sRGB: `source.colours` keeps it. */
  readonly source: number;
  readonly area: number;
  /** The source colours that joined it (sRGB). */
  readonly members: readonly number[];
}

/** The mapping, as plain data. */
export interface ColourMap {
  /** Biggest area first. */
  readonly slots: readonly ColourSlot[];
  /** Source colour ('#rrggbb') → slot. */
  readonly of: Readonly<Record<string, Slot>>;
}

export interface MapOptions {
  /** Fewest clusters while there are that many distinct colours (default 2). */
  readonly min?: number;
  /** Most clusters (default 6; a pack shares one map, so it may take the palette's 16). */
  readonly max?: number;
}

/** Weights in the clustering distance: lightness down (baked gradients), hue up. */
const LIGHT_WEIGHT = 0.5;
const HUE_WEIGHT = 2;
/** Clusters closer than this join (below the palette's closest pair, navy and night at 0.051). */
export const MERGE_DISTANCE = 0.035;
/** Assignment cost weights: ΔL² + (C·ΔC)² + (H·ΔH)². */
const COST_C = 0.7;
const COST_H = 2.5;
/** Palette entries under this chroma are its neutrals (ink, night, slate, mist, white). */
const NEUTRAL_CHROMA = 0.06;
/**
 * A source colour is grey when its chroma, measured from true grey or from the palette's own
 * (blue-tinted) neutrals, whichever is nearer, is under the first value; a colour over the
 * second; a blend between. So slate is grey, and so is #808080, but a pale pink is a colour.
 */
const GREY_RAMP = [0.03, 0.05] as const;
/** Cost of mapping a grey to a colour or a colour to a grey. */
export const SWAP_PENALTY = 0.08;
/** Cost of taking an entry a bigger cluster already took (the two would read as one colour). */
export const REUSE_PENALTY = 0.05;
/** Hue difference (radians, ~35°) within which two colours are one family for lightness order. */
const FAMILY_HUE = 0.6;
/** Unique colours past which near-identical ones are pooled before clustering. */
const POOL_OVER = 256;

export const hexString = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

interface Cluster {
  L: number;
  a: number;
  b: number;
  w: number;
  members: number[];
  names: Map<string, number>;
}

const ENTRIES = (Object.entries(PALETTE) as [PaletteColor, number][]).map(([name, hex]) => {
  const lab = oklab(hex);
  return { name, lab, L: lab.L, neutral: lch(lab).C < NEUTRAL_CHROMA };
});
/** The palette's neutrals by lightness: the tint its greys have at each lightness. */
const AXIS = ENTRIES.filter((e) => e.neutral).sort((p, q) => p.L - q.L);

function axisAt(L: number): { a: number; b: number } {
  const hi = AXIS.findIndex((e) => e.L >= L);
  if (hi <= 0) return AXIS[hi < 0 ? AXIS.length - 1 : 0]!.lab;
  const p = AXIS[hi - 1]!.lab;
  const q = AXIS[hi]!.lab;
  const t = (L - p.L) / (q.L - p.L);
  return { a: p.a + (q.a - p.a) * t, b: p.b + (q.b - p.b) * t };
}

/** 0 for a grey, 1 for a colour (see GREY_RAMP). */
function colourfulness(c: OkLab): number {
  const n = axisAt(c.L);
  const C = Math.min(Math.hypot(c.a, c.b), Math.hypot(c.a - n.a, c.b - n.b));
  return Math.min(1, Math.max(0, (C - GREY_RAMP[0]) / (GREY_RAMP[1] - GREY_RAMP[0])));
}

/** The hue chord: hue difference weighted by chroma, so greys have none. */
function hueChord(p: { C: number; h: number }, q: { C: number; h: number }): number {
  return 2 * Math.sqrt(p.C * q.C) * Math.abs(Math.sin((p.h - q.h) / 2));
}

type Lch = ReturnType<typeof lch>;

/** Clustering distance: lightness, chroma and the hue chord, lightness weighted down and hue up. */
function clusterDistance(P: Lch, Q: Lch): number {
  return Math.hypot(LIGHT_WEIGHT * (P.L - Q.L), P.C - Q.C, HUE_WEIGHT * hueChord(P, Q));
}

/** Assignment cost of a cluster at an entry (penalties aside from the grey swap). */
function entryCost(c: OkLab, e: OkLab, neutral: boolean): number {
  const P = lch(c);
  const Q = lch(e);
  const swap = SWAP_PENALTY * Math.abs(colourfulness(c) - (neutral ? 0 : 1));
  return (P.L - Q.L) ** 2 + (COST_C * (P.C - Q.C)) ** 2 + (COST_H * hueChord(P, Q)) ** 2 + swap;
}

function join(p: Cluster, q: Cluster): Cluster {
  const w = p.w + q.w;
  const names = new Map(p.names);
  for (const [n, a] of q.names) names.set(n, (names.get(n) ?? 0) + a);
  return { L: (p.L * p.w + q.L * q.w) / w, a: (p.a * p.w + q.a * q.w) / w, b: (p.b * p.w + q.b * q.w) / w, w, members: [...p.members, ...q.members].sort((x, y) => x - y), names };
}

/** Unique colours as one-colour clusters, in hex order (so input order never matters). */
function seed(samples: readonly ColourSample[]): Cluster[] {
  const byHex = new Map<number, Cluster>();
  const anyArea = samples.some((s) => s.area > 0);
  for (const s of samples) {
    const w = anyArea ? Math.max(0, s.area) : 1;
    let c = byHex.get(s.hex);
    if (!c) {
      const lab = oklab(s.hex);
      byHex.set(s.hex, (c = { ...lab, w: 0, members: [s.hex], names: new Map() }));
    }
    c.w += w;
    if (s.name) c.names.set(s.name, (c.names.get(s.name) ?? 0) + w);
  }
  let out = [...byHex.entries()].sort((x, y) => x[0] - y[0]).map(([, c]) => ({ ...c, w: c.w || 1e-12 }));
  // many colours (a pack, vertex-colour gradients): pool those in one OKLab cell (lightness
  // weighted as the distance weighs it), the cells doubling until at most POOL_OVER are left
  for (let cell = 0.01; out.length > POOL_OVER; cell *= 2) {
    const cells = new Map<string, Cluster>();
    for (const c of out) {
      const k = `${Math.round((c.L * LIGHT_WEIGHT) / cell)},${Math.round(c.a / cell)},${Math.round(c.b / cell)}`;
      const had = cells.get(k);
      cells.set(k, had ? join(had, c) : c);
    }
    out = [...cells.values()];
  }
  return out;
}

/** Agglomerative clustering on centres: join the closest pair while over `max`, or closer than MERGE_DISTANCE. */
function cluster(cs: Cluster[], min: number, max: number): Cluster[] {
  const out = [...cs];
  const n = out.length;
  const alive = out.map(() => true);
  const pts = out.map((c) => lch(c));
  // pair distances, kept: a join recomputes only the joined cluster's row
  const d = new Float64Array(n * n);
  const measure = (i: number, j: number) => (d[Math.min(i, j) * n + Math.max(i, j)] = clusterDistance(pts[i]!, pts[j]!));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) measure(i, j);
  for (let count = n; count > 1; count--) {
    let best = Infinity;
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) if (alive[j] && d[i * n + j]! < best) [best, bi, bj] = [d[i * n + j]!, i, j];
    }
    if (!(count > max || (count > min && best < MERGE_DISTANCE))) break;
    out[bi] = join(out[bi]!, out[bj]!);
    pts[bi] = lch(out[bi]!);
    alive[bj] = false;
    for (let k = 0; k < n; k++) if (alive[k] && k !== bi) measure(bi, k);
  }
  return out.filter((_, i) => alive[i]);
}

/** A material name as a slot name when it means something ('metal_dark' → 'metalDark'), else null. */
export function slotName(name: string | undefined): string | null {
  if (!name) return null;
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !GENERIC.test(w));
  while (words.length > 1 && words[0]!.length === 1) words.shift(); // M_Wood → Wood
  if (!words.length || words[0]!.length < 2) return null;
  const slot = words[0]!.toLowerCase() + words.slice(1).map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join('');
  return /^[a-z][A-Za-z0-9]{1,15}$/.test(slot) ? slot : null;
}
/** Words that name no colour: what exporters call a material when nobody named it. */
const GENERIC = /^(mat|mats|material|materials|default|defaultmaterial|colormap|colourmap|color|colour|atlas|texture|tex|palette|lambert\d*|phong\d*|blinn\d*|standard|surface|shader|principled|bsdf|none|null|untitled|unnamed|new|initialshadinggroup|scene|object|mesh|node)$/i;

/**
 * Entries for clusters (biggest first): each takes its cheapest, a taken one costing
 * REUSE_PENALTY more; then single moves while the total (costs plus REUSE_PENALTY per cluster
 * sharing an entry) drops, best move first.
 */
function assign(order: readonly Cluster[]): number[] {
  const cost = order.map((c) => ENTRIES.map((e) => entryCost(c, e.lab, e.neutral)));
  const pick: number[] = [];
  for (const row of cost) {
    let at = 0;
    row.forEach((v, k) => {
      if (v + (pick.includes(k) ? REUSE_PENALTY : 0) < row[at]! + (pick.includes(at) ? REUSE_PENALTY : 0)) at = k;
    });
    pick.push(at);
  }
  const total = (p: readonly number[]) => p.reduce((s, k, i) => s + cost[i]![k]!, 0) + REUSE_PENALTY * (p.length - new Set(p).size);
  for (let round = 0; round < 64; round++) {
    let best = total(pick) - 1e-9;
    let move: [number, number] | null = null;
    for (let i = 0; i < pick.length; i++) {
      for (let k = 0; k < ENTRIES.length; k++) {
        if (k === pick[i]) continue;
        const t = total(pick.map((x, j) => (j === i ? k : x)));
        if (t < best) [best, move] = [t, [i, k]];
      }
    }
    if (!move) break;
    pick[move[0]] = move[1];
  }
  return pick;
}

/** Map source colours to palette slots (see the file comment). */
export function mapColours(samples: readonly ColourSample[], o: MapOptions = {}): ColourMap {
  const clusters = cluster(seed(samples), o.min ?? 2, o.max ?? 6);
  const order = [...clusters].sort((p, q) => q.w - p.w || p.members[0]! - q.members[0]!);
  const pick = assign(order);
  // lightness order within a family: swap entries until no lighter cluster sits on a darker entry
  const fam = order.map((c) => ({ grey: colourfulness(c) < 0.5, h: lch(c).h }));
  const sameFamily = (i: number, j: number) => fam[i]!.grey === fam[j]!.grey && (fam[i]!.grey || Math.abs(Math.sin((fam[i]!.h - fam[j]!.h) / 2)) < Math.sin(FAMILY_HUE / 2));
  for (let pass = 0, swapped = true; swapped && pass < order.length ** 2; pass++) {
    swapped = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        if (!sameFamily(i, j)) continue;
        const ds = order[i]!.L - order[j]!.L;
        const de = ENTRIES[pick[i]!]!.L - ENTRIES[pick[j]!]!.L;
        if (ds * de < 0) {
          [pick[i], pick[j]] = [pick[j]!, pick[i]!];
          swapped = true;
        }
      }
    }
  }
  // slot names: the biggest material's name when it means something, else c1, c2… by area
  const used = new Set<string>();
  const unique = (base: string) => {
    let s = base;
    for (let k = 2; used.has(s); k++) s = `${base}${k}`;
    used.add(s);
    return s;
  };
  const named = order.map((c) => slotName([...c.names].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0]?.[0])).map((n) => (n ? unique(n) : null));
  let generic = 0;
  const slots: ColourSlot[] = order.map((c, i) => ({
    slot: named[i] ?? unique(`c${++generic}`),
    colour: ENTRIES[pick[i]!]!.name,
    source: oklabHex(c),
    area: c.w,
    members: c.members,
  }));
  const of: Record<string, Slot> = {};
  for (const s of slots) for (const m of s.members) of[hexString(m)] = s.slot;
  return { slots, of };
}
