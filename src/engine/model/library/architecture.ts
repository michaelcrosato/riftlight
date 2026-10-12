import { model } from '../helpers';
import type { Part } from '../types';

/** A mortar joint: one art pixel at game scale. */
const JOINT = 0.06;

/**
 * Stone blocks (slots `stone`, `stone2`) in running bond across `x` on a wall `d` deep (centred on
 * z = 0), in courses between the levels `ys`, the first being course `k` (odd courses are
 * `stone2` and shifted half a block), blocks about `len` long. Courses alternate shades rather
 * than blocks: at game scale a joint is under a pixel, and blocks checkered in running bond touch
 * their like corner to corner, chaining into one block. A single course (`ys` of two levels) has
 * nothing to chain with, so its blocks alternate instead (in one shade they'd read as one slab);
 * the rule is per call, so a course that carries on the courses of another call (a window's top
 * course over its jambs) passes `band` to keep its course's shade. Joints open between blocks
 * but not on the edges `open` names (the outside, an opening): put a `mortar` core behind them.
 * Walls, jambs, piers. `cut` leaves openings: `[x0, x1, y0?, y1?]` clears x0..x1 in the courses
 * whose middle lies between y0 and y1 (default all), the blocks it crosses cut back flush to its
 * edges. `run` names the ends that meet the next modular piece (it overrides `open`
 * there): a shifted course's half block stays bare, to make a whole block with the neighbour's,
 * and a whole block keeps half a joint, to make a whole joint with the neighbour's, so the bond
 * runs on across pieces.
 */
export function masonry(o: { x: [number, number]; ys: number[]; d: number; k?: number; len?: number; open?: { l?: boolean; r?: boolean; b?: boolean; t?: boolean }; run?: { l?: boolean; r?: boolean }; cut?: readonly (readonly number[])[]; band?: boolean }): Part[] {
  const [x0, x1] = o.x;
  const ys = o.ys;
  const out: Part[] = [];
  const j = JOINT / 2;
  const e = 1e-6;
  for (let r = 0; r + 1 < ys.length; r++) {
    const k = (o.k ?? 0) + r;
    const ya = ys[r]! + (r === 0 && o.open?.b ? 0 : j);
    const yb = ys[r + 1]! - (r + 2 === ys.length && o.open?.t ? 0 : j);
    const mid = (ys[r]! + ys[r + 1]!) / 2;
    const holes = (o.cut ?? []).filter(([, , y0 = -Infinity, y1 = Infinity]) => mid > y0 && mid < y1);
    const n = Math.max(1, Math.round((x1 - x0) / (o.len ?? 0.55)));
    const bl = (x1 - x0) / n;
    const shifted = n > 1 && k % 2 === 1;
    const cuts = shifted ? [x0, ...Array.from({ length: n }, (_, i) => x0 + (i + 0.5) * bl), x1] : Array.from({ length: n + 1 }, (_, i) => x0 + i * bl);
    const bareL = o.run?.l ? shifted : !!o.open?.l;
    const bareR = o.run?.r ? shifted : !!o.open?.r;
    for (let a = 0; a + 1 < cuts.length; a++) {
      // the block's span less the holes, [from, to, bare left, bare right]: an edge on a hole is bare
      let spans: [number, number, boolean, boolean][] = [[cuts[a]!, cuts[a + 1]!, a === 0 && bareL, a + 2 === cuts.length && bareR]];
      for (const [ca, cb] of holes) {
        spans = spans.flatMap(([s0, s1, l, rr]): [number, number, boolean, boolean][] => [
          ...(Math.min(s1, ca!) - s0 > e ? [[s0, Math.min(s1, ca!), l, rr || s1 > ca! - e] as [number, number, boolean, boolean]] : []),
          ...(s1 - Math.max(s0, cb!) > e ? [[Math.max(s0, cb!), s1, l || s0 < cb! + e, rr] as [number, number, boolean, boolean]] : []),
        ]);
      }
      for (const [s0, s1, l, rr] of spans) {
        const xa = s0 + (l ? 0 : j);
        const xb = s1 - (rr ? 0 : j);
        out.push({ box: [xb - xa, yb - ya, o.d], at: [(xa + xb) / 2, (ya + yb) / 2, 0], c: (ys.length === 2 && !o.band ? k + a : k) % 2 ? 'stone2' : 'stone' });
      }
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
      { mirror: masonry({ x: [w / 2 + 0.2, W / 2], ys: [top, H], d: t, k: below.length + band.length - 2, open: { r: true, t: true }, band: true }) },
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

// ---- Modular pieces: parts of buildings that line up on a 1 m grid ----

/** The modular pieces' wall thickness (m), the door's and the window's. */
const WALL = 0.3;
/** Their course height: eight to a 3 m storey, so pieces of one height line up course for course. */
const COURSE = 0.375;
/** Their block length: two to a metre, so the bond runs on across pieces set on the 1 m grid. */
const BLOCK = 0.5;
/** Their stone: blocks in two shades over dark mortar, dressed stone (lintels, sills, quoins, copings) warm. */
const STONE = { stone: 'mist', stone2: 'slate', mortar: 'night', dressed: 'sand' } as const;
/** Every edge bare: a piece's ends meet the next piece's, its foot the floor, its top the storey above. */
const BARE = { l: true, r: true, b: true, t: true } as const;
/** Both ends meet the next piece's on the grid: the bond runs on across them (`masonry`'s `run`). */
const RUN = { l: true, r: true } as const;
/** The levels of an `h` tall wall's courses. */
const coursesOf = (h: number) => levels(0, h, Math.max(1, Math.round(h / COURSE)));
/**
 * A mortar core for x0..x1, y0..y1 of a wall `d` deep, 2 cm in from its faces, ends, top and (off
 * the floor) foot, so the joints show it.
 */
const core = (x0: number, x1: number, y0: number, y1: number, d = WALL): Part => {
  const lo = y0 > 0 ? y0 + 0.02 : 0;
  return { box: [x1 - x0 - 0.04, y1 - 0.02 - lo, d - 0.04], at: [(x0 + x1) / 2, (y1 - 0.02 + lo) / 2, 0], c: 'mortar' };
};

export const stoneWall = model({
  id: 'stone-wall',
  about: 'Modular stone wall along X, `length` x 0.3 m centred on the origin, `height` 3 m to a storey: blocks in two shaded courses over dark mortar (one course alternates its blocks); its ends meet the next piece so the bond runs on across pieces set end to end on the 1 m grid',
  tags: ['architecture', 'stone', 'wall', 'modular'],
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night' },
  params: { length: [2, 0.5, 6], height: [3, 0.5, 5] },
  parts: (p) => {
    const L = p.length!;
    const ys = coursesOf(p.height!);
    // one block in one course has no joints of its own, so no core
    return [...(ys.length > 2 || Math.round(L / BLOCK) > 1 ? [core(-L / 2, L / 2, 0, p.height!)] : []), ...masonry({ x: [-L / 2, L / 2], ys, d: WALL, len: BLOCK, open: BARE, run: RUN })];
  },
});

export const wallCorner = model({
  id: 'wall-corner',
  about: 'Corner of the modular stone walls: a pier of dressed quoins on the origin, two `arm` m arms along -X and -Z (footprint 1.2 x 1.2 m at the default), `height` 3 m; turn it in 90-degree steps',
  tags: ['architecture', 'stone', 'wall', 'modular'],
  palette: STONE,
  params: { arm: [1, 0.5, 3], height: [3, 0.5, 5] },
  // a box round each stone, so the L stays open inside its corner
  collider: 'parts',
  parts: (p) => {
    const H = p.height!;
    const ys = coursesOf(H);
    const q = 0.42; // the pier, wider than the walls so the corner reads
    // an arm of one block in one course has no joints, so no core
    const arm = [...(ys.length > 2 || p.arm! - q / 2 > BLOCK * 1.5 ? [core(-p.arm!, -q / 2, 0, H)] : []), ...masonry({ x: [-p.arm!, -q / 2], ys, d: WALL, len: BLOCK, open: BARE, run: { l: true } })];
    const j = JOINT / 2;
    return [
      { group: arm },
      { group: arm, rot: [0, -90, 0] },
      ...(ys.length > 2 ? [{ box: [q - 0.04, H - 0.02, q - 0.04], at: [0, (H - 0.02) / 2, 0], c: 'mortar' } as const] : []),
      ...ys.slice(1).map((y, r): Part => {
        const ya = ys[r]! + (r ? j : 0);
        const yb = y - (r + 2 < ys.length ? j : 0);
        return { box: [q, yb - ya, q], at: [0, (ya + yb) / 2, 0], c: r % 2 ? 'stone' : 'dressed' };
      }),
    ];
  },
});

export const doorway = model({
  id: 'doorway',
  about: 'Modular stone wall along X (`length` x 0.3 m, like `stone-wall`) with a 1 m wide, 2.3 m high opening under a dressed lintel, open to colliders so actors walk through',
  tags: ['architecture', 'stone', 'wall', 'modular'],
  palette: STONE,
  params: { length: [2, 1.5, 5], height: [3, 2.7, 5] },
  // a box round each stone: the opening stays open (the threshold has none)
  collider: 'parts',
  parts: (p) => {
    const L = p.length!;
    const H = p.height!;
    const ys = coursesOf(H);
    const n = Math.round(L / BLOCK);
    const bl = L / n;
    const ow = Math.min(n - 1, Math.max(1, Math.round(1 / bl))) * bl; // whole blocks, so no sliver stones
    const head = ys[6]!; // the opening's head: six courses up
    return [
      core(-L / 2, -ow / 2, 0, H),
      core(ow / 2, L / 2, 0, H),
      core(-ow / 2 - 0.02, ow / 2 + 0.02, head + 0.03, H),
      ...masonry({ x: [-L / 2, L / 2], ys, d: WALL, len: BLOCK, open: BARE, run: RUN, cut: [[-ow / 2, ow / 2, 0, head], [-ow / 2 - bl / 2, ow / 2 + bl / 2, head, ys[7]!]] }),
      { box: [ow + bl - JOINT, ys[7]! - head - JOINT, WALL + 0.04], at: [0, (head + ys[7]!) / 2, 0], c: 'dressed', name: 'lintel' },
      { box: [ow, 0.05, WALL + 0.1], at: [0, 0.025, 0], c: 'stone2', name: 'threshold', collide: false },
    ];
  },
});

export const wideWindow = model({
  id: 'wide-window',
  about: 'Modular stone wall along X (`length` x 0.3 m, like `stone-wall`) with a window as wide as the wall less a block each side and three courses tall: glass between dressed mullions, a sill and a lintel; the glazed window blocks like the wall (its glass collides); map `glass`',
  tags: ['architecture', 'stone', 'wall', 'modular'],
  palette: { ...STONE, glass: 'navy' },
  params: { length: [3, 2, 5], height: [3, 2.7, 5] },
  // a box round each part, so the sill's ledge and the reveal are what an actor meets
  collider: 'parts',
  parts: (p) => {
    const L = p.length!;
    const H = p.height!;
    const ys = coursesOf(H);
    const bl = L / Math.round(L / BLOCK);
    const ow = L - 2 * bl;
    const sill = ys[3]!;
    const head = ys[6]!;
    const lights = Math.max(2, Math.round(ow / 0.7));
    return [
      core(-L / 2, L / 2, 0, sill),
      core(-L / 2, -ow / 2, 0, H),
      core(ow / 2, L / 2, 0, H),
      core(-ow / 2 - 0.02, ow / 2 + 0.02, head + 0.03, H),
      ...masonry({ x: [-L / 2, L / 2], ys, d: WALL, len: BLOCK, open: BARE, run: RUN, cut: [[-ow / 2, ow / 2, sill, head], [-ow / 2 - bl / 2, ow / 2 + bl / 2, head, ys[7]!]] }),
      { box: [ow + bl - JOINT, ys[7]! - head - JOINT, WALL + 0.04], at: [0, (head + ys[7]!) / 2, 0], c: 'dressed', name: 'lintel' },
      { box: [ow + 0.2, 0.12, WALL + 0.16], at: [0, sill + 0.03, 0.06], c: 'dressed', name: 'sill' },
      // the glass runs 3 cm into the sill and 5 mm into the jambs and lintel, 1.5 cm clear of the
      // mortar behind them (navy and night differ by under 0.01 in lightness); the mullions run 2.5
      // to 3.5 cm into the sill and lintel
      { box: [ow + 0.01, head - sill - 0.025, 0.04], at: [0, (sill + head) / 2 + 0.0475, -0.04], c: 'glass', name: 'glass' },
      ...Array.from({ length: lights - 1 }, (_, i): Part => ({ box: [0.1, head - sill, WALL - 0.1], at: [-ow / 2 + (ow * (i + 1)) / lights, (sill + head) / 2 + 0.055, 0], c: 'dressed' })),
    ];
  },
});

export const ruinedWall = model({
  id: 'ruined-wall',
  about: 'Ruin of the modular stone wall along X, `length` x 0.3 m: its courses broken off to a seeded jagged top under `height`, deepest at a seeded point; add `rubble` at its foot',
  tags: ['architecture', 'stone', 'wall', 'ruin', 'modular'],
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night' },
  params: { length: [2, 1, 5], height: [2.25, 1, 3] },
  // a box round each stone, so the broken top is what an actor climbs
  collider: 'parts',
  parts: (p, rng) => {
    const L = p.length!;
    const ys = coursesOf(p.height!);
    const n = ys.length - 1;
    // courses standing in each half-block column: a seeded dip, jagged a course either way
    const cols = Math.round(L / (BLOCK / 2));
    const dip = rng.range(0.35, 0.7);
    const deep = rng.range(0.25, 0.75);
    const lean = rng.range(-0.3, 0.3); // one end lower than the other
    const kept = Array.from({ length: cols }, (_, c) => {
      const t = (c + 0.5) / cols;
      const fall = dip * Math.exp(-(((t - deep) / 0.35) ** 2)) + Math.max(0, lean * (2 * t - 1));
      return Math.max(Math.min(2, n), Math.min(n, Math.round(n * (1 - fall) + rng.range(-0.9, 0.9)))); // two courses stand everywhere
    });
    // runs of columns of one height: each a hole above it and a core under it
    const runs: [number, number, number][] = [];
    kept.forEach((m, c) => {
      const last = runs[runs.length - 1];
      if (last && last[2] === m) last[1] = c + 1;
      else runs.push([c, c + 1, m]);
    });
    const x = (c: number) => -L / 2 + (c * L) / cols;
    return [
      // a core's end steps in 2 cm where the wall ends or its neighbour is lower, and out to meet a taller one's
      ...runs.map(([a, b, m], i): Part => {
        const xa = x(a) + (i && runs[i - 1]![2] > m ? -0.02 : 0.02);
        const xb = x(b) + (i + 1 < runs.length && runs[i + 1]![2] > m ? 0.02 : -0.02);
        const top = (m < n ? ys[m]! - JOINT / 2 : ys[n]!) - 0.02;
        return { box: [xb - xa, top, WALL - 0.04], at: [(xa + xb) / 2, top / 2, 0], c: 'mortar' };
      }),
      ...masonry({ x: [-L / 2, L / 2], ys, d: WALL, len: BLOCK, open: BARE, run: RUN, cut: runs.filter(([, , m]) => m < n).map(([a, b, m]) => [x(a), x(b), ys[m]!]) }),
    ];
  },
});

export const balcony = model({
  id: 'balcony',
  about: 'Wooden balcony to hang on a wall at z = 0, its deck 3 m up (a storey of `stone-wall`): boards on joists and knee braces, a baluster railing round three sides; footprint `width` x `depth` m',
  tags: ['architecture', 'wood', 'town', 'modular'],
  palette: { wood: 'orange', wood2: 'red', frame: 'plum' },
  params: { width: [2, 1, 4], depth: [1, 0.6, 1.5] },
  floats: true,
  // a box round each part: the deck carries actors, the railing stops them
  collider: 'parts',
  anchors: { wall: [0, 3, 0] },
  parts: (p) => {
    const W = p.width!;
    const D = p.depth!;
    const y = 3; // the deck's top
    const nb = Math.max(3, Math.round(D / 0.2));
    const bw = D / nb;
    const nj = Math.max(2, Math.round(W) + 1);
    const xs = Array.from({ length: nj }, (_, i) => -W / 2 + 0.12 + ((W - 0.24) * i) / (nj - 1)); // joists
    const top = y + 0.95; // the rail's top
    const post = 0.12;
    const bal = (from: number, to: number, at: (u: number) => [number, number]): Part[] => {
      const k = Math.max(1, Math.round((to - from) / 0.2));
      return Array.from({ length: k - 1 }, (_, i): Part => {
        const [bx, bz] = at(from + ((to - from) * (i + 1)) / k);
        return { box: [0.07, top - y - 0.08, 0.07], at: [bx, y + (top - y - 0.08) / 2, bz], c: 'frame' };
      });
    };
    const side = (s: number): Part[] => [
      { box: [post, top - y, post], at: [s * (W / 2 - post / 2), y + (top - y) / 2, D - post / 2], c: 'wood2' },
      { box: [post, top - y, post], at: [s * (W / 2 - post / 2), y + (top - y) / 2, post / 2], c: 'wood2' },
      { box: [0.1, 0.08, D - post * 2], at: [s * (W / 2 - post / 2), top - 0.04, D / 2], c: 'wood' },
      ...bal(post, D - post, (u) => [s * (W / 2 - post / 2), u]),
    ];
    return [
      ...Array.from({ length: nb }, (_, i): Part => ({ box: [W, 0.08, bw], at: [0, y - 0.04, bw * (i + 0.5)], c: i % 2 ? 'wood2' : 'wood' })),
      { box: [W, 0.12, 0.08], at: [0, y - 0.14, D - 0.04], c: 'frame', name: 'fascia' },
      // a joist out from the wall under each line of posts and between, a knee brace up to it from the wall
      ...xs.flatMap((x): Part[] => {
        const len = Math.hypot(D * 0.7, 0.75);
        return [
          { box: [0.12, 0.16, D - 0.08], at: [x, y - 0.16, (D - 0.08) / 2], c: 'frame' },
          { box: [0.1, 0.12, len], at: [x, y - 0.24 - 0.75 / 2, (D * 0.7) / 2], rot: [(-Math.atan2(0.75, D * 0.7) * 180) / Math.PI, 0, 0], c: 'frame' },
        ];
      }),
      ...side(1),
      ...side(-1),
      { box: [W - post * 2, 0.08, 0.1], at: [0, top - 0.04, D - post / 2], c: 'wood', name: 'rail' },
      ...bal(-W / 2 + post, W / 2 - post, (u) => [u, D - post / 2]),
    ];
  },
});

export const bridge = model({
  id: 'bridge',
  about: 'Wooden footbridge span along X, `length` x `width` m: seeded planks laid across two dark beams whose feet rest on the banks at y = 0, the deck 0.32 m up, a dark rail on low posts along each side; the deck carries actors and the rails stop them',
  tags: ['architecture', 'wood', 'nature', 'town', 'modular'],
  palette: { wood: 'orange', wood2: 'red', beam: 'plum' },
  params: { length: [3, 1, 8], width: [1.6, 1, 3] },
  // a box round each part: the planks carry actors, the rails and posts stop them at the sides
  collider: 'parts',
  parts: (p, rng) => {
    const L = p.length!;
    const W = p.width!;
    const n = Math.max(3, Math.round(L / 0.3));
    const pitch = L / n;
    const yaw = (Math.asin(0.05 / W) * 180) / Math.PI; // a plank's ends move at most 2.5 cm: the gaps stay open
    const deck = 0.32;
    const rail = 0.62; // the rails' top over the deck
    // a post stands on every few planks, 0.12 m in from the deck's edge: a plank ends at most 6 cm
    // short of the edge, so a post always stands on one, and at the narrowest the rails leave 0.64 m
    const zp = W / 2 - 0.12;
    const np = Math.max(2, Math.round(L / 1.2) + 1);
    const posts = Array.from({ length: np }, (_, j) => -L / 2 + pitch * (Math.round((j * (n - 1)) / (np - 1)) + 0.5));
    const span = posts[posts.length - 1]! - posts[0]!;
    return [
      { mirror: [{ box: [L, 0.25, 0.2], at: [0, 0.125, -W / 2 + 0.28], c: 'beam' }], axis: 'z' },
      ...Array.from({ length: n }, (_, i): Part => ({ box: [pitch - 0.06, 0.07, W - rng.range(0, 0.08)], at: [-L / 2 + pitch * (i + 0.5), deck - 0.035, rng.range(-0.02, 0.02)], rot: [0, rng.range(-yaw, yaw), 0], c: i % 2 ? 'wood2' : 'wood' })),
      // the rail dark like the posts: a red one would join the red planks into one block
      {
        mirror: [
          ...posts.map((x): Part => ({ box: [0.1, rail + 0.04, 0.1], at: [x, deck - 0.04 + (rail + 0.04) / 2, zp], c: 'beam' })),
          { box: [span + 0.16, 0.08, 0.12], at: [0, deck + rail - 0.02, zp], c: 'beam', name: 'rail' },
        ],
        axis: 'z',
      },
    ];
  },
});

export const chimney = model({
  id: 'chimney',
  about: 'Stone chimney stack, 0.9 x 0.6 m and `height` to its dressed cap: coursed blocks over mortar, two clay pots with dark flues; stand it against a gable or on a ridge',
  tags: ['architecture', 'stone', 'roof', 'town'],
  palette: { ...STONE, pot: 'orange', flue: 'ink' },
  params: { height: [2.5, 1, 5] },
  parts: (p) => {
    const H = p.height!;
    const [w, d] = [0.9, 0.6];
    return [
      core(-w / 2, w / 2, 0, H, d),
      ...masonry({ x: [-w / 2, w / 2], ys: coursesOf(H), d, len: 0.45, open: BARE }),
      { box: [w + 0.16, 0.16, d + 0.16], at: [0, H + 0.08, 0], c: 'dressed', name: 'cap' },
      { mirror: [{ cyl: [0.28, 0.46, 0.28], at: [0.2, H + 0.39, 0], top: 0.75, seg: 8, c: 'pot' }, { cyl: [0.15, 0.02, 0.15], at: [0.2, H + 0.63, 0], seg: 8, c: 'flue' }] },
    ];
  },
});

export const battlement = model({
  id: 'battlement',
  about: 'Crenellated parapet to sit on a wall top (y = 0 there): a dressed string course, a coursed breast wall and coping, `merlons` slit merlons one to each metre with half a crenel at each end so pieces line up; footprint `merlons` x 0.42 m',
  tags: ['architecture', 'stone', 'wall', 'castle', 'modular'],
  palette: { ...STONE, slit: 'ink' },
  params: { merlons: [3, 1, 8] },
  // a box round each stone, so the crenels stay open
  collider: 'parts',
  parts: (p) => {
    const n = Math.round(p.merlons!);
    const L = n; // a metre a merlon
    const sc = 0.15; // the string course
    const br = sc + 2 * COURSE; // the breast wall's top
    const m0 = br + 0.1; // the coping's top, the merlons' foot
    const m1 = m0 + 2 * COURSE;
    return [
      { box: [L, sc, WALL + 0.12], at: [0, sc / 2, 0], c: 'dressed', name: 'string course' },
      core(-L / 2, L / 2, sc, br),
      ...masonry({ x: [-L / 2, L / 2], ys: [sc, sc + COURSE, br], d: WALL, len: BLOCK, open: BARE, run: RUN }),
      { box: [L, 0.1, WALL + 0.06], at: [0, br + 0.05, 0], c: 'dressed', name: 'coping' },
      ...Array.from({ length: n }, (_, i): Part => {
        const x = -L / 2 + i + 0.5;
        return {
          name: 'merlon',
          group: [
            core(x - 0.25, x + 0.25, m0, m1),
            ...masonry({ x: [x - 0.25, x + 0.25], ys: [m0, m0 + COURSE, m1], d: WALL, len: BLOCK, open: BARE }),
            { box: [0.56, 0.08, WALL + 0.06], at: [x, m1 + 0.04, 0], c: 'dressed' },
            { box: [0.08, 0.42, WALL + 0.02], at: [x, (m0 + m1) / 2, 0], c: 'slit' },
          ],
        };
      }),
    ];
  },
});

export const trapdoor = model({
  id: 'trapdoor',
  about: 'Trapdoor on the floor, 1 x 1 m: a frame round a plank hatch with iron strap hinges and a brass ring, on the pivot `hatch` hinged at the back; `open` (degrees) lifts it off a dark pit that stays open to colliders',
  tags: ['architecture', 'wood', 'dungeon', 'floor'],
  palette: { wood: 'orange', wood2: 'red', frame: 'plum', iron: 'night', ring: 'sand', pit: 'ink' },
  params: { open: [0, 0, 110] },
  collider: 'parts',
  parts: (p) => {
    const f = 0.1; // the frame's boards
    const h = 0.06; // its height
    const o = 1 - 2 * f; // the opening
    const pw = o / 4;
    return [
      { box: [o, 0.01, o], at: [0, 0.005, 0], c: 'pit', name: 'pit', collide: false },
      { mirror: [{ box: [1, h, f], at: [0, h / 2, 0.5 - f / 2], c: 'frame' }], axis: 'z' },
      { mirror: [{ box: [f, h, o], at: [0.5 - f / 2, h / 2, 0], c: 'frame' }] },
      {
        name: 'hatch',
        pivot: true,
        at: [0, h, -o / 2],
        rot: [-p.open!, 0, 0],
        group: [
          ...Array.from({ length: 4 }, (_, i): Part => ({ box: [pw, 0.05, o - 0.01], at: [-o / 2 + pw * (i + 0.5), -0.025, o / 2], c: i % 2 ? 'wood2' : 'wood' })),
          { mirror: [{ box: [0.09, 0.02, o * 0.72], at: [0.2, 0.01, o * 0.36], c: 'iron' }] },
          { box: [0.12, 0.02, 0.1], at: [0, 0.01, o - 0.09], c: 'iron' },
          { torus: [0.18, 0.04, 0.18], at: [0, 0.04, o - 0.17], seg: 8, c: 'ring', name: 'ring' },
        ],
      },
    ];
  },
});

export const stoneSteps = model({
  id: 'stone-steps',
  about: 'Stone steps up to a landing: `steps` risers of 0.2 m climbing toward -Z between dark cheek walls with dressed copings, a 1 m landing at the back; footprint 2 x 2 m at the defaults',
  tags: ['architecture', 'stone', 'town', 'modular'],
  palette: { stone: 'mist', stone2: 'slate', cheek: 'night', dressed: 'sand' },
  params: { steps: [5, 2, 12], width: [1.4, 0.8, 3] },
  // a box round each step and cheek: actors step up the flight and the cheeks stay walls
  collider: 'parts',
  parts: (p) => {
    const n = Math.round(p.steps!);
    const w = p.width!;
    const [rise, go, land, cw] = [0.2, 0.25, 1, 0.3];
    const H = n * rise;
    const D = (n - 1) * go + land;
    const zf = D / 2; // the flight's foot
    const zl = zf - (n - 1) * go; // the landing's edge
    const zb = -D / 2;
    const top = 0.4; // the cheeks' height over the nosings
    const ct = 0.1; // the copings' thickness
    const cheek: [number, number][] = [[zf, 0], [zf, rise + top - ct], [zl, H + top - ct], [zb, H + top - ct], [zb, 0]];
    const coping: [number, number][] = [[zf + 0.04, rise + top - ct], [zf + 0.04, rise + top], [zl, H + top], [zb, H + top], [zb, H + top - ct], [zl, H + top - ct]];
    return [
      ...Array.from({ length: n - 1 }, (_, i): Part => ({ box: [w, rise * (i + 1), go], at: [0, (rise * (i + 1)) / 2, zf - go * (i + 0.5)], c: i % 2 ? 'stone2' : 'stone' })),
      { box: [w, H, land], at: [0, H / 2, zb + land / 2], c: n % 2 ? 'stone' : 'stone2', name: 'landing' },
      {
        mirror: [
          { slab: cheek, depth: cw, at: [w / 2 + cw / 2, 0, 0], rot: [0, -90, 0], c: 'cheek', name: 'cheek' },
          { slab: coping, depth: cw + 0.06, at: [w / 2 + cw / 2, 0, 0], rot: [0, -90, 0], c: 'dressed' },
        ],
      },
    ];
  },
});

export const timberWall = model({
  id: 'timber-wall',
  about: 'Timber-frame wall panel along X (Tudor), `length` x 0.3 m, `height` 3 m to a storey: white plaster between dark posts, plates, a rail and braces on a course of stone in two shades; lines up with `stone-wall`',
  tags: ['architecture', 'wood', 'wall', 'town', 'modular'],
  palette: { plaster: 'white', plate: 'ink', beam: 'plum', stone: 'mist', stone2: 'slate', mortar: 'night' },
  params: { length: [2, 1, 4], height: [3, 2, 4] },
  parts: (p) => {
    const L = p.length!;
    const H = p.height!;
    const b = 0.18; // a beam
    const s = COURSE; // the stone course's top
    const bays = Math.max(1, Math.round(L));
    const xs = Array.from({ length: bays + 1 }, (_, i) => -L / 2 + b / 2 + ((L - b) * i) / bays); // posts
    const rail = s + b + (H - s - 2 * b) * 0.45; // the rail's middle
    const brace = (x0: number, y0: number, x1: number, y1: number): Part => ({ box: [Math.hypot(x1 - x0, y1 - y0), b * 0.85, WALL - 0.02], at: [(x0 + x1) / 2, (y0 + y1) / 2, 0], rot: [0, 0, (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI], c: 'beam' });
    return [
      core(-L / 2, L / 2, 0, s),
      ...masonry({ x: [-L / 2, L / 2], ys: [0, s], d: WALL, len: BLOCK, open: BARE, run: RUN }),
      { box: [L - 0.04, H - s - 0.04, WALL - 0.06], at: [0, (s + H) / 2, 0], c: 'plaster', name: 'plaster' },
      { box: [L, b, WALL], at: [0, s + b / 2, 0], c: 'plate', name: 'sole plate' },
      { box: [L, b, WALL], at: [0, H - b / 2, 0], c: 'plate', name: 'top plate' },
      ...xs.map((x): Part => ({ box: [b, H - s - 2 * b, WALL], at: [x, (s + H) / 2, 0], c: 'beam' })),
      // in each bay a chevron of braces from the corners of its outer post (the one nearer the
      // wall's end) to the rail's middle: no brace joins two posts, so the frame reads as members
      ...xs.slice(1).flatMap((x, i): Part[] => {
        const [xa, xb] = [xs[i]! + b / 2, x - b / 2];
        const mid = (xa + xb) / 2;
        const outer = mid < 0 ? xa : xb;
        return [
          { box: [xb - xa, b * 0.85, WALL], at: [mid, rail, 0], c: 'plate', name: 'rail' },
          brace(outer, s + b, mid, rail - (b * 0.85) / 2),
          brace(outer, H - b, mid, rail + (b * 0.85) / 2),
        ];
      }),
    ];
  },
});

export const ARCHITECTURE = [door, framedWindow, column, stairs, fence, roof, gate, stoneWall, wallCorner, doorway, wideWindow, ruinedWall, balcony, bridge, chimney, battlement, trapdoor, stoneSteps, timberWall];
