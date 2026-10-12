import { around, model } from '../helpers';
import type { Rng } from '../../random';
import type { Part, Vec3 } from '../types';
import { levels, masonry } from './architecture';

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

/**
 * A door `w` × `h` on its hinge at (±x, y, z), its back on the hinge line: `s` −1 hangs on the
 * left edge (door.l), 1 on the right (door.r). Raised `panels` ([y, height] from its centre), each
 * 0.145 m narrower than the door, and a handle by the free edge at `grip` (y from its centre).
 */
const door = (s: -1 | 1, [x, y, z]: Vec3, w: number, h: number, panels: readonly (readonly [number, number])[], grip = 0): Part => ({
  name: s < 0 ? 'door.l' : 'door.r',
  pivot: true,
  at: [x * s, y, z],
  group: [
    { box: [w, h, 0.03], at: [(-w / 2) * s, 0, 0.015], c: 'wood' },
    ...panels.map(([py, ph]): Part => ({ box: [w - 0.145, ph, 0.02], at: [(-w / 2) * s, py, 0.04], c: 'frame' })),
    { box: [0.06, 0.16, 0.05], at: [-(w - 0.04) * s, grip, 0.055], c: 'handle' },
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
    door(-1, [0.4, 0.52, 0.22], 0.395, 0.8, [[0, 0.6]]),
    door(1, [0.4, 0.52, 0.22], 0.395, 0.8, [[0, 0.6]]),
  ],
});

export const wardrobe = model({
  id: 'wardrobe',
  about: 'Tall wardrobe (1.96 m): two doors with long and short raised panels on hinges (pivots door.l, door.r), brass handles, a crown on top; map `wood`',
  tags: ['furniture', 'wood', 'storage', 'town'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', handle: 'sand' },
  parts: [
    { box: [0.94, 0.1, 0.5], at: [0, 0.05, -0.01], c: 'joint' },
    { mirror: [{ box: [0.05, 1.78, 0.56], at: [0.475, 0.99, 0], c: 'frame' }] },
    { box: [0.9, 1.76, 0.03], at: [0, 0.99, -0.265], c: 'frame' },
    { box: [0.88, 1.68, 0.01], at: [0, 1.0, -0.245], c: 'joint' },
    { box: [0.9, 0.04, 0.53], at: [0, 0.12, 0.005], c: 'frame' },
    { box: [0.9, 0.05, 0.53], at: [0, 1.855, 0.005], c: 'frame' },
    { box: [1.1, 0.08, 0.64], at: [0, 1.92, 0.01], c: 'wood', name: 'top' },
    door(-1, [0.45, 1.0, 0.28], 0.445, 1.66, [[0.33, 0.86], [-0.47, 0.52]]),
    door(1, [0.45, 1.0, 0.28], 0.445, 1.66, [[0.33, 0.86], [-0.47, 0.52]]),
  ],
});

/**
 * The joint round a drawer front (m): at game scale a thinner one is under a pixel, and fronts,
 * joints and pulls break up into speckle.
 */
const DRAWER_JOINT = 0.1;

/**
 * A drawer front `w` wide in a slot `slot` tall (the front is the slot less a joint), its face 1 cm
 * proud of the carcass at `at`, with one wide brass pull in the middle. A front further proud draws its
 * edges in another shade band, and a pair of small pulls draws as specks.
 */
const drawerFront = (at: Vec3, w: number, slot: number): Part => ({
  name: 'drawer',
  at,
  group: [
    { box: [w, slot - DRAWER_JOINT, 0.01], at: [0, 0, 0.005], c: 'wood' },
    { box: [0.22, 0.1, 0.04], at: [0, 0, 0.03], c: 'handle' },
  ],
});

export const desk = model({
  id: 'desk',
  about: 'Writing desk, 0.76 m tall: a board top over a block of two drawers with brass pulls on the right, two legs and a dark back panel on the left; `length` (m)',
  tags: ['furniture', 'wood', 'table', 'town'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', handle: 'sand' },
  params: { length: [1.2, 1, 1.6] },
  anchors: { top: [0, 0.76, 0] },
  parts: (p) => {
    const l = p.length!;
    const px = l / 2 - 0.23; // the drawer block's centre
    const lx = -l / 2 + 0.06; // the legs'
    const [k0, k1] = [lx + 0.035, px - 0.21]; // the knee space
    // two drawers between 0.1 and 0.69 m, the joints round them as wide as the dresser's
    const slot = (0.59 - DRAWER_JOINT) / 2;
    return [
      { box: [l, 0.04, 0.64], at: [0, 0.74, 0], c: 'wood', name: 'top' },
      { box: [l - 0.06, 0.03, 0.58], at: [0, 0.705, 0], c: 'joint' },
      { box: [0.42, 0.59, 0.58], at: [px, 0.395, 0], c: 'frame', name: 'drawers' },
      { box: [0.38, 0.57, 0.01], at: [px, 0.4, 0.295], c: 'joint' }, // dark joints between the fronts
      { box: [0.38, 0.1, 0.5], at: [px, 0.05, -0.02], c: 'joint' },
      ...Array.from({ length: 2 }, (_, i): Part => drawerFront([px, 0.1 + DRAWER_JOINT / 2 + slot * (i + 0.5), 0.3], 0.34, slot)),
      { mirror: [{ box: [0.07, 0.69, 0.07], at: [lx, 0.345, 0.25], c: 'frame' }], axis: 'z' },
      { box: [0.05, 0.07, 0.44], at: [lx, 0.14, 0], c: 'joint' },
      { box: [k1 - k0, 0.32, 0.03], at: [(k0 + k1) / 2, 0.53, -0.25], c: 'joint' },
      { box: [k1 - k0, 0.07, 0.03], at: [(k0 + k1) / 2, 0.655, 0.27], c: 'frame' },
    ];
  },
});

export const dresser = model({
  id: 'dresser',
  about: 'Chest of drawers: `drawers` (2-5) stacked fronts, 0.3 m each, with a wide brass pull apiece in a dark carcass under a lighter top, on a plinth; `width` (m)',
  tags: ['furniture', 'wood', 'storage', 'town'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', handle: 'sand' },
  params: { drawers: [3, 2, 5], width: [0.9, 0.6, 1.2] },
  parts: (p) => {
    const n = Math.round(p.drawers!);
    const w = p.width!;
    const dh = 0.3; // a drawer's slot: a front and a joint
    const h = n * dh + DRAWER_JOINT;
    return [
      { box: [w - 0.06, 0.1, 0.42], at: [0, 0.05, -0.01], c: 'joint' },
      { box: [w, h, 0.46], at: [0, 0.1 + h / 2, 0], c: 'frame', name: 'carcass' },
      { box: [w - 0.05, h - 0.01, 0.01], at: [0, 0.1 + h / 2, 0.235], c: 'joint' }, // dark joints between the fronts
      { box: [w + 0.06, 0.05, 0.5], at: [0, 0.125 + h, 0.01], c: 'wood', name: 'top' },
      ...Array.from({ length: n }, (_, i): Part => drawerFront([0, 0.1 + DRAWER_JOINT / 2 + dh * (i + 0.5), 0.24], w - 0.1, dh)),
    ];
  },
});

/** The throne's crest over its back (x across, y up from the back's top): a stepped gold pediment. */
const CREST: [number, number][] = [[-0.33, 0], [0.33, 0], [0.33, 0.08], [0.12, 0.2], [0, 0.3], [-0.12, 0.2], [-0.33, 0.08]];

export const throne = model({
  id: 'throne',
  about: 'Throne, 1.96 m to its crest: a high dark panelled back between red posts under a gold crest and finials, gold-tipped arms, a cushioned seat on a plinth; map `cushion`',
  tags: ['furniture', 'wood', 'seat', 'royal', 'town', 'dungeon'],
  palette: { wood: 'red', panel: 'plum', gold: 'sand', cushion: 'blue' },
  anchors: { seat: [0, 0.56, 0.04] },
  parts: [
    { box: [1.0, 0.1, 0.9], at: [0, 0.05, -0.02], c: 'wood', name: 'plinth' },
    { box: [0.76, 0.36, 0.62], at: [0, 0.28, 0.02], c: 'panel', name: 'seat' },
    { box: [0.78, 0.06, 0.02], at: [0, 0.42, 0.34], c: 'gold' },
    { box: [0.66, 0.1, 0.56], at: [0, 0.51, 0.04], c: 'cushion', name: 'cushion' },
    { mirror: [{ box: [0.12, 1.52, 0.12], at: [0.38, 0.84, -0.26], c: 'wood' }] }, // their feet in the plinth
    { box: [0.64, 1.2, 0.06], at: [0, 1.06, -0.28], c: 'panel', name: 'back' },
    { box: [0.46, 0.78, 0.06], at: [0, 1.0, -0.22], c: 'cushion' },
    { slab: CREST, depth: 0.08, at: [0, 1.66, -0.28], c: 'gold', name: 'crest' },
    { mirror: [{ ball: [0.16, 0.16, 0.16], at: [0.38, 1.68, -0.26], c: 'gold' }] },
    { mirror: [{ box: [0.1, 0.08, 0.64], at: [0.38, 0.8, 0.02], c: 'wood' }] },
    { mirror: [{ box: [0.1, 0.34, 0.1], at: [0.38, 0.59, 0.27], c: 'wood' }] },
    { mirror: [{ ball: [0.13, 0.13, 0.13], at: [0.38, 0.84, 0.34], c: 'gold' }] },
  ],
});

export const armchair = model({
  id: 'armchair',
  about: 'Upholstered armchair, seat at 0.52 m: a padded back and rolled arms in `cloth` (map it), lighter `cushion`s, a dark skirt and short wooden feet',
  tags: ['furniture', 'cloth', 'seat', 'town'],
  palette: { cloth: 'blue', cushion: 'sky', trim: 'navy', wood: 'red' },
  anchors: { seat: [0, 0.52, 0.08] },
  parts: [
    { mirror: [{ mirror: [{ box: [0.08, 0.08, 0.08], at: [0.34, 0.04, 0.32], c: 'wood' }], axis: 'z' }] },
    { box: [0.86, 0.06, 0.8], at: [0, 0.11, 0], c: 'trim' },
    { box: [0.84, 0.3, 0.78], at: [0, 0.25, 0], c: 'cloth', name: 'base' },
    { box: [0.56, 0.12, 0.6], at: [0, 0.46, 0.08], c: 'cushion', name: 'seat' },
    { box: [0.84, 0.62, 0.16], at: [0, 0.71, -0.31], c: 'cloth', name: 'back' },
    { box: [0.56, 0.44, 0.1], at: [0, 0.74, -0.17], rot: [-8, 0, 0], c: 'cushion' },
    { mirror: [{ box: [0.14, 0.24, 0.62], at: [0.35, 0.52, 0.08], c: 'trim' }] },
    { mirror: [{ cyl: [0.18, 0.64, 0.18], at: [0.35, 0.66, 0.08], rot: [90, 0, 0], seg: 6, c: 'cloth' }] },
  ],
});

export const rug = model({
  id: 'rug',
  about: 'Rug, 14 mm thick: a `field` inside a `border` (map both), a gold line and a diamond medallion, fringes across the ends of its `length`',
  tags: ['furniture', 'cloth', 'floor', 'town'],
  palette: { field: 'red', border: 'navy', trim: 'sand', fringe: 'white' },
  params: { length: [2, 1.2, 3], width: [1.4, 0.8, 2] },
  collider: 'none',
  // each layer 2 mm over the one below, so no two tops share a plane
  parts: (p) => {
    const l = p.length!;
    const w = p.width!;
    const m = Math.min(l, w) * 0.34; // the medallion's side
    return [
      { mirror: [{ box: [0.1, 0.004, w - 0.12], at: [l / 2 + 0.04, 0.002, 0], c: 'fringe' }] },
      { box: [l, 0.006, w], at: [0, 0.003, 0], c: 'border', name: 'border' },
      { box: [l - 0.2, 0.008, w - 0.2], at: [0, 0.004, 0], c: 'trim' },
      { box: [l - 0.28, 0.01, w - 0.28], at: [0, 0.005, 0], c: 'field', name: 'field' },
      { box: [m, 0.012, m], at: [0, 0.006, 0], rot: [0, 45, 0], c: 'trim', name: 'medallion' },
      { box: [m / 2, 0.014, m / 2], at: [0, 0.007, 0], rot: [0, 45, 0], c: 'border' },
    ];
  },
});

export const fireplace = model({
  id: 'fireplace',
  about: 'Stone fireplace, its back on a wall at z = 0: coursed jambs, a lintel and a wooden mantel round a sooty firebox of charred logs and glowing embers (seeded); `chimney` (m) raises a stone breast above the mantel',
  tags: ['furniture', 'stone', 'fire', 'light', 'town'],
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night', soot: 'ink', wood: 'red', log: 'plum', ember: 'orange', hot: 'sand' },
  params: { chimney: [0.9, 0, 1.4] },
  light: { at: [0, 0.3, 0.45], c: 'ember', intensity: 2, radius: 5, flicker: 'brazier' },
  anchors: { mantel: [0, 1.26, 0.3] },
  parts: (p, rng) => {
    const ow = 0.84; // the opening
    const jw = 0.34; // a jamb
    const d = 0.5; // the surround's depth
    const top = 0.97; // the lintel's foot
    const W = ow + 2 * jw;
    const ch = p.chimney!;
    const bw = ow + 0.36; // the breast
    return [
      { box: [W + 0.2, 0.08, d + 0.28], at: [0, 0.04, (d + 0.28) / 2], c: 'stone', name: 'hearthstone' },
      {
        mirror: [
          {
            name: 'jamb',
            at: [(ow + jw) / 2, 0, d / 2],
            group: [
              ...masonry({ x: [-jw / 2, jw / 2], ys: levels(0.08, top - 0.03, 3), d, k: 1, open: { l: true, r: true, b: true } }),
              { box: [jw - 0.04, top - 0.11, d - 0.04], at: [0, (top + 0.11) / 2, 0], c: 'mortar' },
            ],
          },
        ],
      },
      { box: [W, 0.21, d], at: [0, top + 0.105, d / 2], c: 'stone', name: 'lintel' },
      { box: [W + 0.18, 0.08, d + 0.1], at: [0, top + 0.25, (d + 0.1) / 2], c: 'wood', name: 'mantel' },
      ...(ch > 0
        ? [
            {
              name: 'breast',
              at: [0, 0, (d - 0.12) / 2],
              group: [
                ...masonry({ x: [-bw / 2, bw / 2], ys: levels(top + 0.29, top + 0.29 + ch, Math.max(1, Math.round(ch / 0.32))), d: d - 0.12, open: { l: true, r: true, b: true, t: true } }),
                { box: [bw - 0.04, ch - 0.06, d - 0.16], at: [0, top + 0.29 + ch / 2, 0], c: 'mortar' },
              ],
            } as const,
          ]
        : []),
      // the firebox: soot on the back, the sides and the floor
      { box: [ow, top - 0.08, 0.04], at: [0, (top + 0.08) / 2, 0.02], c: 'soot' },
      { mirror: [{ box: [0.03, top - 0.1, d - 0.07], at: [ow / 2 - 0.015, (top + 0.1) / 2, 0.04 + (d - 0.07) / 2], c: 'soot' }] },
      { box: [ow, 0.02, d - 0.04], at: [0, 0.09, 0.04 + (d - 0.04) / 2], c: 'soot', name: 'hearth' },
      { cyl: [0.1, 0.52, 0.1], at: [0, 0.15, 0.17], rot: [0, 13, 90], seg: 6, c: 'log' },
      { cyl: [0.1, 0.48, 0.1], at: [0.02, 0.15, 0.2], rot: [0, -15, 90], seg: 6, c: 'log' },
      // embers: small hot spots in front of the logs and one on them (glow draws flat)
      ...Array.from({ length: 6 }, (_, i): Part => {
        const s = rng.range(0.07, 0.11);
        return { lump: [s, s * 0.6, s], at: [-0.3 + i * 0.12 + rng.range(-0.03, 0.03), 0.1 + s * 0.3, rng.range(0.3, 0.4)], seed: rng.int(1, 999), c: i % 3 ? 'ember' : 'hot', glow: true, name: 'embers' };
      }),
      { lump: [0.1, 0.06, 0.1], at: [0.01, 0.23, 0.19], seed: rng.int(1, 999), c: 'hot', glow: true, name: 'embers' },
    ];
  },
});

/** A wall shelf's bracket seen from the side (x out from the wall, y up from under the board). */
const BRACKET: [number, number][] = [[0, 0], [0.2, 0], [0.2, -0.04], [0.04, -0.2], [0, -0.2]];

/**
 * What stands on a wall shelf `w` long whose top is at `y`: seeded runs of two to four books and
 * corked jars, left to right with gaps, until the next one won't fit.
 */
function shelfClutter(w: number, y: number, rng: Rng): Part[] {
  const out: Part[] = [];
  const end = w / 2 - 0.05;
  let x = -w / 2 + rng.range(0.05, 0.12);
  let jar = rng.chance(0.5);
  for (;;) {
    if (jar) {
      const r = rng.range(0.13, 0.17);
      const h = rng.range(0.14, 0.22);
      if (x + r > end) break;
      out.push({ cyl: [r, h, r], at: [x + r / 2, y + h / 2, 0.12], top: 0.8, seg: 8, c: 'jar' });
      out.push({ cyl: [r * 0.55, 0.05, r * 0.55], at: [x + r / 2, y + h + 0.025, 0.12], seg: 6, c: 'cork' });
      x += r;
    } else {
      if (x + 0.15 > end) break; // room for two books at least: one alone looks lost
      const n = rng.int(2, 4);
      const first = rng.int(0, 1);
      for (let i = 0; i < n && x + 0.075 < end; i++) {
        const t = rng.range(0.045, 0.07);
        const h = rng.range(0.17, 0.24);
        const d = rng.range(0.14, 0.18);
        out.push({ box: [t, h, d], at: [x + t / 2, y + h / 2, 0.02 + d / 2], c: (i + first) % 2 ? 'book2' : 'book' });
        x += t;
      }
    }
    x += rng.range(0.06, 0.14);
    jar = !jar;
  }
  return out;
}

export const wallShelf = model({
  id: 'wall-shelf',
  about: 'Wall shelf, its back on a wall at z = 0 and its top at 1.4 m: a board on two brackets holding seeded books and corked jars; `width` (m)',
  tags: ['furniture', 'wood', 'wall', 'books', 'town'],
  palette: { wood: 'orange', frame: 'red', jar: 'mist', cork: 'red', book: 'blue', book2: 'green' },
  params: { width: [0.9, 0.5, 1.4] },
  floats: true,
  collider: 'none',
  anchors: { mount: [0, 1.4, 0] },
  parts: (p, rng) => {
    const w = p.width!;
    return [
      { box: [w, 0.04, 0.24], at: [0, 1.38, 0.12], c: 'wood', name: 'board' },
      { box: [w - 0.1, 0.1, 0.03], at: [0, 1.31, 0.015], c: 'frame' },
      { mirror: [{ slab: BRACKET, depth: 0.05, at: [w / 2 - 0.12, 1.36, 0], rot: [0, -90, 0], c: 'frame' }] },
      ...shelfClutter(w, 1.4, rng),
    ];
  },
});

export const roundTable = model({
  id: 'round-table',
  about: 'Round table, 0.75 m tall: a ten-sided top over a dark rim on a pedestal and four feet; `d` is its diameter (m)',
  tags: ['furniture', 'wood', 'table', 'town'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum' },
  params: { d: [1, 0.7, 1.4] },
  collider: 'cyl',
  anchors: { top: [0, 0.75, 0] },
  parts: (p) => {
    const d = p.d!;
    return [
      { cyl: [d, 0.05, d], at: [0, 0.725, 0], seg: 10, c: 'wood', name: 'top' },
      { cyl: [d - 0.12, 0.035, d - 0.12], at: [0, 0.6825, 0], seg: 10, c: 'joint' },
      { cyl: [0.26, 0.06, 0.26], at: [0, 0.635, 0], seg: 8, c: 'frame' },
      { cyl: [0.14, 0.405, 0.14], at: [0, 0.4025, 0], seg: 8, c: 'frame', name: 'pedestal' },
      { cyl: [0.26, 0.12, 0.26], at: [0, 0.14, 0], top: 0.7, seg: 8, c: 'joint' },
      ...around(4, { box: [0.09, 0.08, d * 0.36], at: [0, 0.04, 0.05 + d * 0.18], c: 'frame' }, { phase: 45 }),
    ];
  },
});

/** A washbasin's profile, (radius, height) turned about Y: a foot, a flared bowl, a rolled rim, the inside down to a flat bottom. */
const BASIN: [number, number][] = [[0, 0], [0.1, 0], [0.12, 0.02], [0.2, 0.1], [0.22, 0.13], [0.19, 0.13], [0.1, 0.05], [0, 0.05]];

export const washstand = model({
  id: 'washstand',
  about: 'Washstand, 0.8 m tall: a white basin of water on a board with a splashback, four legs and a low shelf',
  tags: ['furniture', 'wood', 'water', 'town'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', basin: 'white', water: 'sky' },
  parts: [
    { box: [0.64, 0.04, 0.46], at: [0, 0.78, 0], c: 'wood', name: 'top' },
    { box: [0.64, 0.18, 0.04], at: [0, 0.89, -0.21], c: 'frame', name: 'splashback' },
    { mirror: [{ mirror: [{ box: [0.06, 0.76, 0.06], at: [0.27, 0.38, 0.18], c: 'frame' }], axis: 'z' }] },
    { mirror: [{ box: [0.48, 0.08, 0.03], at: [0, 0.72, 0.18], c: 'joint' }], axis: 'z' },
    { mirror: [{ box: [0.03, 0.08, 0.3], at: [0.27, 0.72, 0], c: 'joint' }] },
    { box: [0.54, 0.03, 0.36], at: [0, 0.2, 0], c: 'wood' },
    { lathe: BASIN, at: [0, 0.8, 0.03], seg: 10, c: 'basin', name: 'basin' },
    { cyl: [0.27, 0.02, 0.27], at: [0, 0.885, 0.03], seg: 10, c: 'water' },
  ],
});

/** A cradle's rocker (x across the cradle, y up): an arc of radius 0.8 m under a flat top at 0.2 m. */
const ROCKER: [number, number][] = [
  ...Array.from({ length: 9 }, (_, i): [number, number] => {
    const x = -0.4 + (0.8 * i) / 8;
    return [x, 0.8 - Math.sqrt(0.64 - x * x)];
  }),
  [0.4, 0.2],
  [-0.4, 0.2],
];
/** The cradle's headboard (x across, y up): arched over the pillow. */
const HEADBOARD: [number, number][] = [[-0.25, 0], [0.25, 0], [0.25, 0.48], [0.17, 0.56], [0, 0.6], [-0.17, 0.56], [-0.25, 0.48]];

export const cradle = model({
  id: 'cradle',
  about: 'Wooden cradle, head at -X: its ends stand on two dark curved rockers wider than the body; an arched headboard, low sides, a mattress, a pillow and a blue blanket turned down',
  tags: ['furniture', 'wood', 'cloth', 'town'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum', sheet: 'mist', pillow: 'white', blanket: 'blue', fold: 'sky' },
  parts: [
    { mirror: [{ slab: ROCKER, depth: 0.06, at: [0.415, 0, 0], rot: [0, 90, 0], c: 'joint', name: 'rocker' }] },
    { slab: HEADBOARD, depth: 0.05, at: [-0.415, 0.2, 0], rot: [0, 90, 0], c: 'frame', name: 'headboard' },
    { box: [0.05, 0.38, 0.5], at: [0.415, 0.39, 0], c: 'frame' },
    { box: [0.78, 0.025, 0.44], at: [0, 0.2175, 0], c: 'joint' },
    { mirror: [{ box: [0.78, 0.3, 0.04], at: [0, 0.38, 0.23], c: 'wood' }], axis: 'z' },
    { box: [0.74, 0.12, 0.38], at: [0, 0.29, 0], c: 'sheet', name: 'mattress' },
    { ball: [0.18, 0.08, 0.28], at: [-0.27, 0.39, 0], seg: 8, c: 'pillow', name: 'pillow' },
    { box: [0.44, 0.05, 0.39], at: [0.13, 0.375, 0], c: 'blanket', name: 'blanket' },
    { box: [0.07, 0.06, 0.4], at: [-0.12, 0.383, 0], c: 'fold' },
  ],
});

/**
 * One panel of a folding screen, `w` wide from its hinge at x = 0 toward +x (`s` 1) or −x (−1):
 * two stiles to the floor, three rails, a tall `wood` infill over a short `joint` one.
 */
const screenPanel = (w: number, s: 1 | -1): Part[] => [
  { box: [0.07, 1.7, 0.07], at: [0.035 * s, 0.85, 0], c: 'frame' },
  { box: [0.07, 1.7, 0.07], at: [(w - 0.035) * s, 0.85, 0], c: 'frame' },
  ...[0.16, 0.62, 1.6].map((y): Part => ({ box: [w - 0.14, 0.07, 0.05], at: [(w / 2) * s, y, 0], c: 'frame' })),
  { box: [w - 0.14, 0.91, 0.025], at: [(w / 2) * s, 1.11, 0], c: 'wood' },
  { box: [w - 0.14, 0.39, 0.025], at: [(w / 2) * s, 0.39, 0], c: 'joint' },
];

export const foldingScreen = model({
  id: 'folding-screen',
  about: 'Folding screen of three wooden panels 1.7 m tall, hinged in a zigzag: `fold` turns the outer two (degrees; 0 stands it flat)',
  tags: ['furniture', 'wood', 'town'],
  palette: { wood: 'orange', frame: 'red', joint: 'plum' },
  params: { fold: [35, 0, 80] },
  parts: (p) => [
    { name: 'panel', at: [-0.25, 0, 0], group: screenPanel(0.5, 1) },
    { name: 'panel.l', at: [-0.25, 0, 0], rot: [0, p.fold!, 0], group: screenPanel(0.5, -1) },
    { name: 'panel.r', at: [0.25, 0, 0], rot: [0, p.fold!, 0], group: screenPanel(0.5, 1) },
  ],
});

export const FURNITURE = [table, chair, bench, stool, bed, bookshelf, cabinet, wardrobe, desk, dresser, throne, armchair, rug, fireplace, wallShelf, roundTable, washstand, cradle, foldingScreen];
