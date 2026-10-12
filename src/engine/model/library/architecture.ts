import { model } from '../helpers';
import type { Part } from '../types';

/** A mortar joint: one art pixel at game scale. */
const JOINT = 0.06;

/**
 * Stone blocks (slots `stone`, `stone2`) in running bond across `x` on a wall `d` deep (centred on
 * z = 0), in courses between the levels `ys`, the first being course `k` (odd courses are
 * `stone2` and shifted half a block), blocks about `len` long. Courses alternate shades rather
 * than blocks: at game scale a joint is under a pixel, and blocks checkered in running bond touch
 * their like corner to corner, chaining into one block. Joints open between blocks but not on the
 * edges `open` names (the outside, an opening): put a `mortar` core behind them. Walls, jambs,
 * piers.
 */
export function masonry(o: { x: [number, number]; ys: number[]; d: number; k?: number; len?: number; open?: { l?: boolean; r?: boolean; b?: boolean; t?: boolean } }): Part[] {
  const [x0, x1] = o.x;
  const ys = o.ys;
  const out: Part[] = [];
  const j = JOINT / 2;
  for (let r = 0; r + 1 < ys.length; r++) {
    const k = (o.k ?? 0) + r;
    const ya = ys[r]! + (r === 0 && o.open?.b ? 0 : j);
    const yb = ys[r + 1]! - (r + 2 === ys.length && o.open?.t ? 0 : j);
    const n = Math.max(1, Math.round((x1 - x0) / (o.len ?? 0.55)));
    const bl = (x1 - x0) / n;
    const cuts = n > 1 && k % 2 ? [x0, ...Array.from({ length: n }, (_, i) => x0 + (i + 0.5) * bl), x1] : Array.from({ length: n + 1 }, (_, i) => x0 + i * bl);
    for (let a = 0; a + 1 < cuts.length; a++) {
      const xa = cuts[a]! + (a === 0 && o.open?.l ? 0 : j);
      const xb = cuts[a + 1]! - (a + 2 === cuts.length && o.open?.r ? 0 : j);
      out.push({ box: [xb - xa, yb - ya, o.d], at: [(xa + xb) / 2, (ya + yb) / 2, 0], c: k % 2 ? 'stone2' : 'stone' });
    }
  }
  return out;
}

/** `n` + 1 evenly spaced levels from `a` to `b`. */
export const levels = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

/** A post with a pyramid cap: `w` square, `h` tall to the cap's foot, at x. */
const post = (x: number, w: number, h: number, c = 'wood2'): Part[] => [
  { box: [w, h, w], at: [x, h / 2, 0], c },
  { cyl: [w * 1.15, w * 0.6, w * 1.15], at: [x, h + w * 0.3, 0], top: 0, seg: 4, rot: [0, 45, 0], c },
];

export const door = model({
  id: 'door',
  about: 'Plank door 2.2 m tall in a stone frame; the leaf is a pivot (`leaf`) hinged on the left, with iron straps and a brass ring handle',
  tags: ['architecture', 'stone', 'wood'],
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night', wood: 'orange', wood2: 'red', iron: 'night', brass: 'sand' },
  parts: () => {
    const ow = 1.0; // the opening
    const oh = 1.98;
    const jw = 0.24; // a jamb
    const d = 0.32; // the frame's depth (a wall's)
    const lw = ow - 0.06; // the leaf
    const pw = lw / 5;
    return [
      { mirror: [...masonry({ x: [-ow / 2 - jw, -ow / 2], ys: levels(0, oh, 4), d, open: { l: true, r: true, b: true } }), { box: [jw - 0.04, oh + 0.2, d - 0.04], at: [-ow / 2 - jw / 2, (oh + 0.2) / 2, 0], c: 'mortar' }] },
      { box: [ow + jw * 2, 0.22 - JOINT / 2, d], at: [0, oh + 0.22 / 2 + JOINT / 4, 0], c: 'stone2', name: 'lintel' },
      {
        name: 'leaf',
        pivot: true,
        at: [-ow / 2 + 0.03, 0, 0],
        group: [
          ...Array.from({ length: 5 }, (_, i): Part => ({ box: [pw, oh - 0.03, 0.06], at: [pw * (i + 0.5), (oh - 0.03) / 2, 0], c: i % 2 ? 'wood2' : 'wood' })),
          {
            mirror: [
              { box: [lw * 0.78, 0.09, 0.02], at: [lw * 0.39, 0.42, 0.04], c: 'iron' },
              { box: [lw * 0.78, 0.09, 0.02], at: [lw * 0.39, 1.55, 0.04], c: 'iron' },
              { box: [0.1, 0.16, 0.02], at: [lw - 0.13, 1.0, 0.04], c: 'iron' },
              { torus: [0.16, 0.05, 0.16], at: [lw - 0.13, 0.94, 0.07], rot: [90, 0, 0], seg: 8, c: 'brass', name: 'handle' },
            ],
            axis: 'z',
          },
        ],
      },
    ];
  },
});

export const framedWindow = model({ // not `window`: that names the browser global
  id: 'window',
  about: 'Framed window with a cross mullion, a stone sill and lintel and two plank shutters open flat, in a short stone wall',
  tags: ['architecture', 'stone', 'wood'],
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night', wood: 'orange', wood2: 'red', glass: 'navy', iron: 'night' },
  params: { width: [0.8, 0.4, 2], height: [1, 0.5, 1.8] },
  parts: (p) => {
    const w = p.width!;
    const h = p.height!;
    const s = 0.9; // the sill's top
    const top = s + h; // the opening's top
    const lintel = 0.36;
    const t = 0.3; // the wall's depth
    const W = w * 2 + 0.4;
    const H = top + lintel;
    const below = levels(0, s, Math.max(1, Math.round(s / 0.32)));
    const band = levels(s, top, Math.max(1, Math.round(h / 0.34)));
    const fb = 0.08; // the frame's beams
    const fz = t / 2 - 0.09; // the frame's centre, set back from the face
    const sw = w / 2; // a shutter
    const shutter = (x: number): Part => ({
      at: [x, s + h / 2, t / 2 + 0.04],
      group: [
        { box: [sw - 0.02, h, 0.04], c: 'wood' },
        { box: [sw - 0.1, 0.1, 0.03], at: [0, h * 0.3, 0.035], c: 'wood2' },
        { box: [sw - 0.1, 0.1, 0.03], at: [0, -h * 0.3, 0.035], c: 'wood2' },
      ],
    });
    return [
      ...masonry({ x: [-W / 2, W / 2], ys: below, d: t, open: { l: true, r: true, b: true } }),
      { mirror: masonry({ x: [w / 2, W / 2], ys: band, d: t, k: below.length - 1, open: { l: true, r: true } }) },
      { mirror: masonry({ x: [w / 2 + 0.2, W / 2], ys: [top, H], d: t, k: below.length + band.length - 2, open: { r: true, t: true } }) },
      { box: [w + 0.4 - JOINT, lintel - JOINT / 2, t], at: [0, top + lintel / 2 + JOINT / 4, 0], c: 'stone2', name: 'lintel' },
      { mirror: [{ box: [(W - w) / 2 - 0.04, H - 0.02, t - 0.04], at: [(W + w) / 4, (H - 0.02) / 2, 0], c: 'mortar' }] },
      { box: [w + 0.04, s - 0.02, t - 0.04], at: [0, (s - 0.02) / 2, 0], c: 'mortar' },
      { box: [w + 0.2, 0.1, t + 0.09], at: [0, s - 0.05, 0.075], c: 'stone2', name: 'sill' },
      { mirror: [{ box: [fb, h, 0.1], at: [w / 2 - fb / 2, s + h / 2, fz], c: 'wood2' }] },
      { box: [w - fb * 2, fb, 0.1], at: [0, top - fb / 2, fz], c: 'wood2' },
      { box: [w - fb * 2, fb, 0.1], at: [0, s + fb / 2, fz], c: 'wood2' },
      { box: [0.06, h - fb * 2, 0.06], at: [0, s + h / 2, fz], c: 'wood2' },
      { box: [w - fb * 2, 0.06, 0.06], at: [0, s + h * 0.58, fz], c: 'wood2' },
      { box: [w - fb * 2 + 0.02, h - fb * 2 + 0.02, 0.02], at: [0, s + h / 2, fz], c: 'glass', name: 'glass' },
      { mirror: [shutter(w / 2 + sw / 2 + 0.02), { box: [0.12, 0.08, 0.08], at: [w / 2 + 0.03, s + h * 0.8, t / 2 + 0.04], c: 'iron' }, { box: [0.12, 0.08, 0.08], at: [w / 2 + 0.03, s + h * 0.2, t / 2 + 0.04], c: 'iron' }] },
    ];
  },
});

export const column = model({
  id: 'column',
  about: 'Stone column: a square plinth and moulded base, a tapering shaft, a flared capital under a square abacus',
  tags: ['architecture', 'stone'],
  palette: { stone: 'mist', stone2: 'slate' },
  params: { height: [2.6, 1, 5] },
  collider: 'cyl',
  parts: (p) => {
    const H = p.height!;
    const d = 0.3 + H * 0.05; // the shaft's foot
    const base = 0.26; // plinth and moulding
    const cap = 0.28; // capital and abacus
    return [
      { box: [d * 1.4, 0.16, d * 1.4], at: [0, 0.08, 0], c: 'stone', name: 'plinth' },
      { cyl: [d * 1.2, 0.1, d * 1.2], at: [0, 0.21, 0], top: 0.85, seg: 10, c: 'stone2' },
      { cyl: [d, H - base - cap, d], at: [0, base + (H - base - cap) / 2, 0], top: 0.86, seg: 10, c: 'stone', name: 'shaft' },
      { cyl: [d * 1.2, 0.14, d * 1.2], at: [0, H - cap + 0.07, 0], top: 1 / 0.72, seg: 10, c: 'stone2', name: 'capital' },
      { box: [d * 1.4, 0.14, d * 1.4], at: [0, H - 0.07, 0], c: 'stone', name: 'abacus' },
    ];
  },
});

export const stairs = model({
  id: 'stairs',
  about: 'Flight of stone steps climbing toward the back (-Z), one box per step from the floor, shades alternating so each edge reads',
  tags: ['architecture', 'stone'],
  palette: { stone: 'mist', stone2: 'slate' },
  params: { steps: [6, 2, 16], width: [1.2, 0.6, 3], rise: [0.18, 0.12, 0.25] },
  collider: 'hull',
  parts: (p) => {
    const n = Math.round(p.steps!);
    const go = 0.3; // the going: each tread's depth
    return Array.from({ length: n }, (_, i): Part => ({ box: [p.width!, p.rise! * (i + 1), go], at: [0, (p.rise! * (i + 1)) / 2, (n * go) / 2 - go * (i + 0.5)], c: i % 2 ? 'stone2' : 'stone' }));
  },
});

export const fence = model({
  id: 'fence',
  about: 'Wooden fence along X: square posts with pyramid caps about every metre, two rails nailed across their fronts',
  tags: ['architecture', 'wood'],
  palette: { wood: 'orange', wood2: 'red' },
  params: { length: [3, 1, 8] },
  parts: (p) => {
    const L = p.length!;
    const n = Math.max(1, Math.round(L)); // spans
    return [
      ...Array.from({ length: n + 1 }, (_, i) => post(-L / 2 + (L * i) / n, 0.12, 0.95)).flat(),
      { box: [L + 0.12, 0.12, 0.06], at: [0, 0.4, 0.09], c: 'wood' },
      { box: [L + 0.12, 0.12, 0.06], at: [0, 0.78, 0.09], c: 'wood' },
    ];
  },
});

export const roof = model({
  id: 'roof',
  about: 'Gable roof to sit on walls (y = 0 is the wall top): two pitched slabs of tile courses, stone gable ends, a ridge beam',
  tags: ['architecture', 'roof', 'stone', 'wood'],
  palette: { tile: 'red', tile2: 'plum', stone: 'mist', wood: 'orange' },
  params: { width: [4, 1.5, 10], depth: [3, 1.5, 8], pitch: [40, 15, 60] },
  floats: true,
  parts: (p) => {
    const W = p.width!;
    const hd = p.depth! / 2;
    const a = (p.pitch! * Math.PI) / 180;
    const R = hd * Math.tan(a); // the ridge's height
    const over = 0.3; // the eaves' overhang
    const t = 0.1; // the slabs' thickness
    const L = (hd + over) / Math.cos(a); // a slab's length, ridge to eave
    const rows = Math.max(2, Math.round(L / 0.42));
    const rl = L / rows;
    const slab: Part[] = Array.from({ length: rows }, (_, i): Part => {
      const u = rl * (i + 0.5); // down the slope from the ridge
      return { box: [W + 0.5, t, rl], at: [0, R - u * Math.sin(a) + (t / 2) * Math.cos(a), u * Math.cos(a) + (t / 2) * Math.sin(a)], rot: [p.pitch!, 0, 0], c: i % 2 ? 'tile2' : 'tile' };
    });
    return [
      { mirror: slab, axis: 'z' },
      { mirror: [{ slab: [[-hd, 0], [hd, 0], [0, R]], depth: 0.2, at: [W / 2 - 0.1, 0, 0], rot: [0, 90, 0], c: 'stone', name: 'gable' }] },
      { box: [W + 0.7, 0.18, 0.18], at: [0, R + t * Math.cos(a) + 0.05, 0], c: 'wood', name: 'ridge' }, // sits in the slabs' notch
    ];
  },
});

export const gate = model({
  id: 'gate',
  about: 'Wooden yard gate between two capped posts: a picket leaf (pivot `leaf`, hinged on the left) with rails, a brace and an iron latch',
  tags: ['architecture', 'wood'],
  palette: { wood: 'orange', wood2: 'red', iron: 'night' },
  parts: () => {
    const gw = 1.2; // the opening
    const pw = 0.16; // a post
    const lw = gw - 0.06; // the leaf
    const lh = 1.05;
    const n = 7; // pickets
    const step = (lw - 0.1) / (n - 1);
    const brace = Math.hypot(lw - 0.16, lh - 0.4);
    return [
      ...post(-gw / 2 - pw / 2, pw, 1.35),
      ...post(gw / 2 + pw / 2, pw, 1.35),
      {
        name: 'leaf',
        pivot: true,
        at: [-gw / 2 + 0.03, 0.08, 0],
        group: [
          ...Array.from({ length: n }, (_, i): Part => ({ slab: [[-0.05, 0], [0.05, 0], [0.05, lh - 0.06], [0, lh], [-0.05, lh - 0.06]], depth: 0.04, at: [0.05 + step * i, 0, 0.03], c: 'wood' })),
          { box: [lw, 0.1, 0.04], at: [lw / 2, 0.22, -0.01], c: 'wood2' },
          { box: [lw, 0.1, 0.04], at: [lw / 2, lh - 0.25, -0.01], c: 'wood2' },
          { box: [brace, 0.1, 0.04], at: [lw / 2, (lh - 0.03) / 2, -0.01], rot: [0, 0, (Math.atan2(lh - 0.4, lw - 0.16) * 180) / Math.PI], c: 'wood2' },
          { box: [0.16, 0.07, 0.07], at: [0, 0.22, -0.01], c: 'iron' },
          { box: [0.16, 0.07, 0.07], at: [0, lh - 0.25, -0.01], c: 'iron' },
          { box: [0.16, 0.07, 0.06], at: [lw, lh - 0.4, 0.06], c: 'iron', name: 'latch' },
        ],
      },
    ];
  },
});

export const ARCHITECTURE = [door, framedWindow, column, stairs, fence, roof, gate];
