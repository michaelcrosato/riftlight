import { around, model } from '../helpers';
import type { Rng } from '../../random';
import type { Part } from '../types';

/**
 * `n` boards along x, `len` long, side by side across `d` with `gap` between them, their tops at
 * `y`: a table top or a seat. Lay them over a `joint` board 1 cm lower so the gaps read dark.
 */
const planks = (n: number, len: number, d: number, y: number, t: number, gap: number, c: string): Part[] => {
  const w = (d - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i): Part => ({ box: [len, t, w], at: [0, y - t / 2, -d / 2 + w / 2 + i * (w + gap)], c }));
};

export const table = model({
  id: 'table',
  about: 'Plank-top table, 0.75 m tall, on four square legs with a dark apron under the top',
  tags: ['furniture', 'wood'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum' },
  params: { length: [1.4, 0.8, 2.4], width: [0.8, 0.6, 1.2] },
  anchors: { top: [0, 0.75, 0] },
  parts: (p) => {
    const len = p.length!;
    const wid = p.width!;
    const x = len / 2 - 0.12;
    const z = wid / 2 - 0.1;
    return [
      ...planks(Math.min(3, Math.max(2, Math.round(wid / 0.26))), len, wid, 0.75, 0.05, 0.05, 'wood'),
      { box: [len - 0.08, 0.035, wid - 0.08], at: [0, 0.7225, 0], c: 'joint' },
      { mirror: [{ mirror: [{ box: [0.09, 0.7, 0.09], at: [x, 0.35, z], c: 'frame' }], axis: 'z' }] },
      { mirror: [{ box: [2 * x, 0.1, 0.03], at: [0, 0.645, z], c: 'joint' }], axis: 'z' },
      { mirror: [{ box: [0.03, 0.1, 2 * z], at: [x, 0.645, 0], c: 'joint' }] },
    ];
  },
});

export const chair = model({
  id: 'chair',
  about: 'Wooden chair, seat at 0.45 m on four legs, the back legs rising into a two-rail back',
  tags: ['furniture', 'wood'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum' },
  anchors: { seat: [0, 0.45, 0] },
  parts: [
    { box: [0.46, 0.05, 0.44], at: [0, 0.425, 0], c: 'wood', name: 'seat' },
    { box: [0.4, 0.07, 0.38], at: [0, 0.365, 0], c: 'joint' },
    { mirror: [{ box: [0.06, 0.42, 0.06], at: [0.18, 0.21, 0.17], c: 'frame' }] },
    { mirror: [{ box: [0.06, 0.98, 0.06], at: [0.18, 0.49, -0.18], c: 'frame' }] },
    { box: [0.4, 0.14, 0.05], at: [0, 0.87, -0.18], c: 'wood', name: 'back' },
    { box: [0.3, 0.1, 0.04], at: [0, 0.66, -0.18], c: 'wood' },
    { mirror: [{ box: [0.05, 0.06, 0.34], at: [0.18, 0.14, -0.005], c: 'joint' }] },
  ],
});

/** A bench trestle's outline (x across the seat, y up), notched at the foot. */
const TRESTLE: [number, number][] = [[-0.15, 0], [-0.06, 0], [0, 0.1], [0.06, 0], [0.15, 0], [0.15, 0.4], [-0.15, 0.4]];

export const bench = model({
  id: 'bench',
  about: 'Backless plank bench, seat at 0.45 m on two notched board trestles and a dark stretcher',
  tags: ['furniture', 'wood'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum' },
  params: { length: [1.4, 0.8, 2.4] },
  anchors: { seat: [0, 0.45, 0] },
  parts: (p) => {
    const len = p.length!;
    const x = len / 2 - 0.18;
    return [
      ...planks(2, len, 0.36, 0.45, 0.06, 0.06, 'wood'),
      { box: [len - 0.1, 0.045, 0.28], at: [0, 0.4175, 0], c: 'joint' },
      { mirror: [{ slab: TRESTLE, depth: 0.07, at: [x, 0, 0], rot: [0, 90, 0], c: 'frame' }] },
      { box: [2 * x, 0.08, 0.06], at: [0, 0.16, 0], c: 'joint' },
    ];
  },
});

export const stool = model({
  id: 'stool',
  about: 'Round stool: an eight-sided seat at 0.5 m on four splayed legs and a dark ring',
  tags: ['furniture', 'wood'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum' },
  collider: 'cyl',
  anchors: { seat: [0, 0.5, 0] },
  parts: [
    { cyl: [0.4, 0.06, 0.4], at: [0, 0.47, 0], seg: 8, c: 'wood', name: 'seat' },
    { cyl: [0.3, 0.04, 0.3], at: [0, 0.42, 0], seg: 8, c: 'joint' },
    ...around(4, { cyl: [0.08, 0.45, 0.08], at: [0, 0.228, 0.15], rot: [-8, 0, 0], seg: 6, c: 'frame' }),
    { torus: [0.38, 0.06, 0.38], at: [0, 0.17, 0], seg: 8, c: 'joint' },
  ],
});

export const bed = model({
  id: 'bed',
  about: 'Single bed (1 x 2 m): wooden frame and headboard, a mattress, a white pillow and a blue blanket turned down',
  tags: ['furniture', 'wood', 'cloth'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', sheet: 'mist', pillow: 'white', blanket: 'blue', fold: 'sky' },
  parts: [
    { mirror: [{ box: [0.08, 1.0, 0.08], at: [0.47, 0.5, -0.96], c: 'frame' }] },
    { mirror: [{ box: [0.08, 0.55, 0.08], at: [0.47, 0.275, 0.96], c: 'frame' }] },
    { box: [0.86, 0.43, 0.05], at: [0, 0.645, -0.96], c: 'wood', name: 'headboard' },
    { box: [0.86, 0.1, 0.06], at: [0, 0.91, -0.96], c: 'frame' },
    { box: [0.86, 0.16, 0.05], at: [0, 0.42, 0.96], c: 'wood' },
    { mirror: [{ box: [0.05, 0.14, 1.84], at: [0.465, 0.29, 0], c: 'wood' }] },
    { box: [0.88, 0.05, 1.84], at: [0, 0.305, 0], c: 'joint' },
    { box: [0.88, 0.16, 1.84], at: [0, 0.41, 0], c: 'sheet', name: 'mattress' },
    { ball: [0.64, 0.14, 0.32], at: [0, 0.53, -0.7], seg: 8, c: 'pillow', name: 'pillow' },
    { box: [0.92, 0.15, 1.26], at: [0, 0.445, 0.3], c: 'blanket', name: 'blanket' },
    { box: [0.94, 0.04, 0.16], at: [0, 0.53, -0.26], c: 'fold' },
  ],
});

/** Book colours, cycled so neighbours never match. */
const BOOKS = ['book', 'book2', 'book3', 'book4'];

/**
 * One bay of books between x = ±0.4 on a shelf whose top is at `y`, `room` high: standing books
 * of seeded thickness, height and depth, now and then a lying stack, and a book leaning on the
 * last one when there is space.
 */
function shelfOfBooks(y: number, room: number, rng: Rng): Part[] {
  const out: Part[] = [];
  let colour = rng.int(0, 3);
  const next = () => (colour = (colour + rng.int(1, 3)) % 4);
  const back = -0.12;
  let x = -0.395 + rng.range(0, 0.04);
  let stacked = false;
  let lastH = 0;
  const end = 0.395 - rng.range(0.04, 0.2);
  while (x < end) {
    if (!stacked && x > -0.3 && end - x > 0.3 && rng.chance(0.18)) {
      stacked = true;
      const n = rng.int(2, 3);
      const len = rng.range(0.19, 0.24);
      let h = y;
      for (let i = 0; i < n; i++) {
        const t = rng.range(0.04, 0.06);
        const d = rng.range(0.17, 0.21);
        out.push({ box: [len - 0.02 * i, t, d], at: [x + len / 2 + rng.range(0, 0.015), h + t / 2, back + d / 2], c: BOOKS[next()]! });
        h += t;
      }
      x += len + 0.03;
      lastH = 0;
      continue;
    }
    const t = rng.range(0.045, 0.075);
    const h = rng.range(0.2, Math.min(0.32, room - 0.05));
    const d = rng.range(0.18, 0.24);
    out.push({ box: [t, h, d], at: [x + t / 2, y + h / 2, back + d / 2], c: BOOKS[next()]! });
    x += t;
    lastH = h;
  }
  // a book leaning on the last standing one, its foot on the shelf and its top on its neighbour
  if (lastH > 0 && 0.395 - x > 0.16 && rng.chance(0.6)) {
    const a = rng.range(14, 22) * (Math.PI / 180);
    const t = rng.range(0.045, 0.065);
    const h = Math.min(rng.range(0.22, 0.3), lastH / Math.cos(a));
    const d = rng.range(0.18, 0.22);
    const cx = x + (t / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
    const cy = y + (t / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
    out.push({ box: [t, h, d], at: [cx, cy, back + d / 2], rot: [0, 0, (a * 180) / Math.PI], c: BOOKS[next()]! });
  }
  return out;
}

/** The bookshelf's four bays: each one's floor (a shelf's top, m) and the room above it. */
const BAYS: [number, number][] = [[0.12, 0.38], [0.54, 0.38], [0.96, 0.38], [1.38, 0.38]];

export const bookshelf = model({
  id: 'bookshelf',
  about: 'Tall bookshelf (1.8 m), four bays of seeded books in four colours, standing, stacked and leaning',
  tags: ['furniture', 'wood', 'books'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', book: 'blue', book2: 'green', book3: 'sand', book4: 'white' },
  parts: (_p, rng) => [
    { mirror: [{ box: [0.05, 1.76, 0.32], at: [0.425, 0.88, 0], c: 'frame' }] },
    { box: [0.84, 1.72, 0.03], at: [0, 0.88, -0.14], c: 'joint', name: 'back' },
    { box: [0.8, 0.08, 0.03], at: [0, 0.04, 0.145], c: 'joint' },
    { box: [0.96, 0.05, 0.36], at: [0, 1.775, 0], c: 'wood', name: 'top' },
    { box: [0.8, 0.04, 0.29], at: [0, 0.1, 0.005], c: 'wood' },
    ...BAYS.slice(1).map(([y]): Part => ({ box: [0.8, 0.04, 0.29], at: [0, y - 0.02, 0.005], c: 'wood' })),
    ...BAYS.flatMap(([y, room], i) => shelfOfBooks(y, room, rng.fork(i))),
  ],
});

/** A cabinet door on its hinge: `s` −1 hangs on the left edge (door.l), 1 on the right (door.r). */
const door = (s: -1 | 1): Part => ({
  name: s < 0 ? 'door.l' : 'door.r',
  pivot: true,
  at: [0.4 * s, 0.52, 0.22],
  group: [
    { box: [0.395, 0.8, 0.03], at: [-0.1975 * s, 0, 0.015], c: 'wood' },
    { box: [0.25, 0.6, 0.02], at: [-0.1975 * s, 0, 0.04], c: 'frame' },
    { box: [0.06, 0.16, 0.05], at: [-0.355 * s, 0, 0.055], c: 'handle' },
  ],
});

export const cabinet = model({
  id: 'cabinet',
  about: 'Wooden cupboard, 1 m tall: two panelled doors on hinges (pivots door.l, door.r), brass handles, a shelf inside',
  tags: ['furniture', 'wood'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', handle: 'sand' },
  parts: [
    { box: [0.84, 0.08, 0.38], at: [0, 0.04, -0.01], c: 'joint' },
    { mirror: [{ box: [0.05, 0.88, 0.44], at: [0.425, 0.52, 0], c: 'frame' }] },
    { box: [0.84, 0.86, 0.03], at: [0, 0.52, -0.2], c: 'frame' },
    { box: [0.79, 0.8, 0.01], at: [0, 0.52, -0.18], c: 'joint' },
    { box: [0.83, 0.04, 0.41], at: [0, 0.1, 0.01], c: 'frame' },
    { box: [0.8, 0.03, 0.38], at: [0, 0.52, -0.02], c: 'wood' },
    { box: [0.98, 0.06, 0.5], at: [0, 0.99, 0.01], c: 'wood', name: 'top' },
    door(-1),
    door(1),
  ],
});

export const FURNITURE = [table, chair, bench, stool, bed, bookshelf, cabinet];
