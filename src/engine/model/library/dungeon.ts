import { around, model } from '../helpers';
import type { Part, Vec3 } from '../types';

/**
 * A rounded lid's cross-section as an XY outline: a straight lip `lip` tall, then an arc of
 * sagitta `s` over the chord `2c`, in `k` steps, from y = `y0`.
 */
const archOutline = (c: number, s: number, lip: number, k = 6, y0 = 0): [number, number][] => {
  const r = (c * c + s * s) / (2 * s);
  const a = Math.asin(c / r);
  const arc = Array.from({ length: k + 1 }, (_, i): [number, number] => {
    const t = -a + (2 * a * i) / k;
    return [r * Math.sin(t), lip + s - r + r * Math.cos(t)];
  });
  return [[-c, y0], ...arc, [c, y0]];
};

export const chest = model({
  id: 'chest',
  about: 'Treasure chest: iron bands, a gold lock plate, a rounded lid on the pivot `lid` hinged at the back; `open` lifts it on a heap of gold',
  tags: ['dungeon', 'wood'],
  palette: { wood: 'orange', iron: 'night', gold: 'sand' },
  params: { open: [0, 0, 110] },
  parts: (p) => [
    { box: [0.86, 0.42, 0.56], at: [0, 0.21, 0], c: 'wood' },
    { box: [0.88, 0.06, 0.58], at: [0, 0.385, 0], c: 'iron' },
    { mirror: [{ box: [0.08, 0.418, 0.6], at: [0.27, 0.209, 0], c: 'iron' }] },
    { box: [0.18, 0.18, 0.03], at: [0, 0.32, 0.295], c: 'gold' },
    { ball: [0.7, 0.12, 0.42], at: [0, 0.475, 0], half: true, c: 'gold' },
    {
      name: 'lid',
      pivot: true,
      at: [0, 0.42, -0.28],
      rot: [-p.open!, 0, 0],
      group: [
        { slab: archOutline(0.29, 0.18, 0.04), depth: 0.9, at: [0, 0, 0.28], rot: [0, 90, 0], c: 'wood' },
        { mirror: [{ slab: archOutline(0.31, 0.19, 0.04, 6, 0.004), depth: 0.08, at: [0.27, 0, 0.28], rot: [0, 90, 0], c: 'iron' }] },
        { box: [0.1, 0.12, 0.03], at: [0, 0, 0.585], c: 'gold' },
      ],
    },
  ],
});

/** One long bone on the floor along X: a shaft and two darker knobs. */
const bone = (len: number): Part[] => [
  { cyl: [0.1, len, 0.1], rot: [0, 0, 90], at: [0, 0.065, 0], seg: 6, c: 'bone' },
  { mirror: [{ ball: [0.16, 0.13, 0.16], at: [len / 2, 0.065, 0], c: 'joint' }] },
];

export const bones = model({
  id: 'bones',
  about: 'Scatter of long bones round a skull on the floor, seeded; `n` bones over a `spread` metres wide',
  tags: ['dungeon', 'bone'],
  palette: { bone: 'white', joint: 'sand', socket: 'ink' },
  params: { n: [6, 2, 9], spread: [1.2, 0.8, 1.8] },
  parts: (p, rng) => {
    const out: Part[] = [];
    const s = p.spread! / 2;
    const skull: Vec3 = [rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)];
    out.push({
      name: 'skull',
      at: skull,
      rot: [0, rng.range(15, 75), 0],
      group: [
        { ball: [0.3, 0.26, 0.32], at: [0, 0.16, -0.01], seg: 8, c: 'bone' },
        { box: [0.18, 0.1, 0.13], at: [0, 0.05, 0.09], c: 'joint' },
        { mirror: [{ box: [0.08, 0.075, 0.03], at: [0.065, 0.16, 0.135], c: 'socket' }] },
      ],
    });
    const placed: [number, number][] = [[skull[0], skull[2]]];
    for (let i = 0; i < Math.round(p.n!); i++) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 12; tries++) {
        x = rng.range(-s, s);
        z = rng.range(-s, s);
        if (placed.every(([px, pz]) => Math.hypot(x - px, z - pz) > 0.3)) break;
      }
      placed.push([x, z]);
      out.push({ at: [x, 0, z], rot: [0, rng.range(0, 180), 0], group: bone(rng.range(0.34, 0.5)) });
    }
    return out;
  },
});

export const cage = model({
  id: 'cage',
  about: 'Standing round iron cage: bars on a base, two hoops, a domed top with a ring, a gold padlock',
  tags: ['dungeon', 'iron'],
  palette: { iron: 'slate', bar: 'night', lock: 'sand' },
  anchors: { hang: [0, 2.19, 0] },
  parts: [
    { cyl: [1.2, 0.1, 1.2], at: [0, 0.05, 0], seg: 8, rot: [0, 22.5, 0], c: 'iron' },
    ...around(8, { cyl: [0.1, 1.5, 0.1], at: [0, 0.85, 0.47], seg: 4, rot: [0, 45, 0], c: 'bar' }),
    { torus: [1.08, 0.1, 1.08], at: [0, 0.85, 0], seg: 8, rot: [0, 22.5, 0], c: 'iron' },
    { torus: [1.08, 0.1, 1.08], at: [0, 1.6, 0], seg: 8, rot: [0, 22.5, 0], c: 'iron' },
    ...around(4, {
      tube: [[0, 1.6, 0.47], [0, 1.82, 0.38], [0, 1.96, 0.2], [0, 2.0, 0], [0, 1.96, -0.2], [0, 1.82, -0.38], [0, 1.6, -0.47]],
      r: 0.05,
      seg: 4,
      c: 'bar',
    }),
    { ball: [0.18, 0.14, 0.18], at: [0, 2.04, 0], c: 'iron' },
    { torus: [0.22, 0.07, 0.22], at: [0, 2.17, 0], rot: [90, 0, 0], seg: 6, c: 'iron' },
    { group: [{ box: [0.15, 0.17, 0.07], at: [0, 0.72, 0.555], c: 'lock' }], rot: [0, 45, 0] },
  ],
});

/** A coffin's outline in the floor plane (x, z), head at −Z, grown by `k` metres all round. */
const coffinOutline = (k = 0): [number, number][] => [
  [-0.2 - k, -0.95 - k],
  [0.2 + k, -0.95 - k],
  [0.33 + k, -0.5],
  [0.19 + k, 0.95 + k],
  [-0.19 - k, 0.95 + k],
  [-0.33 - k, -0.5],
];

export const coffin = model({
  id: 'coffin',
  about: 'Wooden coffin on the floor, head at -Z: a red body on a lighter plinth, a lighter lid on the pivot `lid`, iron handles',
  tags: ['dungeon', 'wood'],
  palette: { wood: 'red', lid: 'orange', iron: 'night' },
  parts: [
    { slab: coffinOutline(0.02), depth: 0.06, at: [0, 0.03, 0], rot: [90, 0, 0], c: 'lid' },
    { slab: coffinOutline(), depth: 0.38, at: [0, 0.19, 0], rot: [90, 0, 0], c: 'wood' },
    {
      name: 'lid',
      pivot: true,
      at: [0, 0.38, 0],
      group: [
        { slab: coffinOutline(0.03), depth: 0.07, at: [0, 0.035, 0], rot: [90, 0, 0], c: 'lid' },
        { slab: coffinOutline(-0.08), depth: 0.04, at: [0, 0.08, 0], rot: [90, 0, 0], c: 'wood' },
      ],
    },
    {
      mirror: [
        { box: [0.06, 0.07, 0.2], at: [0.335, 0.22, -0.3], rot: [0, -5, 0], c: 'iron' },
        { box: [0.06, 0.07, 0.2], at: [0.29, 0.22, 0.4], rot: [0, -5, 0], c: 'iron' },
      ],
    },
  ],
});

export const banner = model({
  id: 'banner',
  about: 'Wall banner on an iron pole, its back on a wall at z = 0: a pointed `cloth` (map it) with a gold trim and emblem',
  tags: ['dungeon', 'cloth'],
  palette: { cloth: 'red', trim: 'sand', pole: 'night' },
  params: { w: [0.8, 0.5, 1.2], h: [1.4, 0.8, 2] },
  floats: true,
  anchors: { wall: [0, 2.5, 0] },
  parts: (p) => {
    const w = p.w! / 2;
    const h = p.h!;
    const point = Math.min(0.3, w * 0.6);
    const cloth = (k: number): [number, number][] => [
      [-w - k, 0],
      [w + k, 0],
      [w + k, -h + point],
      [0, -h - k * 1.6],
      [-w - k, -h + point],
    ];
    return [
      { mirror: [{ box: [0.08, 0.08, 0.1], at: [w - 0.06, 2.5, 0.05], c: 'pole' }] },
      { cyl: [0.08, p.w! + 0.24, 0.08], at: [0, 2.5, 0.12], rot: [0, 0, 90], seg: 6, c: 'pole' },
      { mirror: [{ ball: [0.13, 0.13, 0.13], at: [w + 0.17, 2.5, 0.12], c: 'trim' }] },
      {
        at: [0, 2.48, 0],
        group: [
          { slab: cloth(0.05), depth: 0.03, at: [0, 0, 0.035], c: 'trim' },
          { slab: cloth(0), depth: 0.03, at: [0, -0.01, 0.06], c: 'cloth' },
          { slab: [[0, 0.2], [0.16, 0], [0, -0.2], [-0.16, 0]], depth: 0.02, at: [0, -h * 0.42, 0.08], c: 'trim' },
          { box: [p.w! + 0.06, 0.08, 0.02], at: [0, -0.22, 0.08], c: 'trim' },
        ],
      },
    ];
  },
});

export const spikes = model({
  id: 'spikes',
  about: 'Floor spike trap: an iron plate with `n` steel spikes in dark holes, the spikes on the pivot `spikes` to raise and lower',
  tags: ['dungeon', 'iron'],
  palette: { plate: 'night', rim: 'slate', hole: 'ink', spike: 'mist' },
  params: { n: [9, 4, 9], h: [0.4, 0.2, 0.55] },
  parts: (p) => {
    const n = Math.round(p.n!);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const step = 0.28;
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - r * cols);
      for (let c = 0; c < inRow; c++) cells.push([(c - (inRow - 1) / 2) * step, (r - (rows - 1) / 2) * step]);
    }
    return [
      { box: [1.0, 0.06, 1.0], at: [0, 0.03, 0], c: 'rim' },
      { box: [0.88, 0.09, 0.88], at: [0, 0.045, 0], c: 'plate' },
      ...cells.map(([x, z]): Part => ({ cyl: [0.25, 0.012, 0.25], at: [x, 0.096, z], seg: 8, c: 'hole' })),
      {
        name: 'spikes',
        pivot: true,
        group: cells.map(([x, z]): Part => ({ cone: [0.2, p.h!, 0.2], at: [x, 0.094 + p.h! / 2, z], rot: [0, 45, 0], seg: 4, c: 'spike' })),
      },
    ];
  },
});

/** A small diamond, `w` wide and `h` tall, as an XY outline: emblems, rune marks. */
const diamond = (w: number, h: number): [number, number][] => [[0, h / 2], [-w / 2, 0], [0, -h / 2], [w / 2, 0]];

export const altar = model({
  id: 'altar',
  about: 'Stone altar on a step: a pale slab top over a dark moulding and a carved body, a `cloth` runner (map it) laid along it and hanging down the front',
  tags: ['dungeon', 'stone', 'cloth', 'temple'],
  palette: { stone: 'mist', stone2: 'slate', dark: 'night', cloth: 'red', trim: 'sand' },
  params: { w: [1.6, 1, 2.4] },
  anchors: { top: [0, 1.03, 0] },
  parts: (p) => {
    const w = p.w!;
    const body = w - 0.24;
    const rw = Math.min(0.46, w * 0.32); // the runner
    const panel = body / 2 - rw / 2 - 0.16; // room for a carved panel either side of the runner
    return [
      { box: [w + 0.3, 0.14, 1.12], at: [0, 0.07, 0], c: 'stone2', name: 'step' },
      { box: [body, 0.66, 0.62], at: [0, 0.47, 0], c: 'stone', name: 'body' },
      ...(panel >= 0.14 ? [{ mirror: [{ box: [panel, 0.38, 0.03], at: [rw / 2 + 0.08 + panel / 2, 0.47, 0.31], c: 'stone2' }] } as const] : []),
      { box: [w - 0.12, 0.08, 0.72], at: [0, 0.84, 0], c: 'dark' },
      { box: [w, 0.12, 0.84], at: [0, 0.94, 0], c: 'stone', name: 'top' },
      // the runner: along the top, then down the front to a gold fringe
      { box: [rw, 0.025, 0.86], at: [0, 1.0125, 0.01], c: 'cloth', name: 'runner' },
      { box: [rw, 0.5, 0.025], at: [0, 0.775, 0.4425], c: 'cloth' },
      { box: [rw + 0.04, 0.07, 0.035], at: [0, 0.535, 0.445], c: 'trim' },
      { slab: diamond(0.16, 0.2), depth: 0.02, at: [0, 0.78, 0.46], c: 'trim' },
    ];
  },
});

export const sarcophagus = model({
  id: 'sarcophagus',
  about: 'Stone sarcophagus on a plinth, head at -Z: carved panels down a pale body, a dark lid (the pivot `lid`) carved with a lying effigy holding a gold sword (map `trim`)',
  tags: ['dungeon', 'stone', 'tomb'],
  palette: { stone: 'mist', stone2: 'slate', trim: 'sand' },
  parts: [
    { box: [1.04, 0.12, 2.3], at: [0, 0.06, 0], c: 'stone2', name: 'plinth' },
    { box: [0.88, 0.6, 2.14], at: [0, 0.42, 0], c: 'stone', name: 'body' },
    // carved panels: three down each side, one at the foot
    { mirror: [-0.68, 0, 0.68].map((z): Part => ({ box: [0.03, 0.34, 0.5], at: [0.44, 0.42, z], c: 'stone2' })) },
    { box: [0.56, 0.34, 0.03], at: [0, 0.42, 1.07], c: 'stone2' },
    {
      name: 'lid',
      pivot: true,
      at: [0, 0.72, 0],
      group: [
        { box: [0.98, 0.12, 2.24], at: [0, 0.06, 0], c: 'stone2' },
        // the effigy, lying on its back: a pillow and head, a robe narrowing to the feet
        { box: [0.5, 0.07, 0.3], at: [0, 0.155, -0.86], c: 'stone' },
        { ball: [0.26, 0.22, 0.3], at: [0, 0.29, -0.8], seg: 8, c: 'stone', name: 'head' },
        { slab: [[-0.25, -0.66], [0.25, -0.66], [0.19, 0.8], [-0.19, 0.8]], depth: 0.16, at: [0, 0.2, 0], rot: [90, 0, 0], c: 'stone', name: 'effigy' },
        { box: [0.3, 0.12, 0.1], at: [0, 0.34, 0.74], c: 'stone' },
        // the sword laid down the body, hilt under the folded hands
        { box: [0.08, 0.03, 0.82], at: [0, 0.295, 0.2], c: 'trim', name: 'sword' },
        { box: [0.28, 0.04, 0.07], at: [0, 0.3, -0.23], c: 'trim' },
        { box: [0.22, 0.08, 0.14], at: [0, 0.32, -0.34], c: 'stone' },
      ],
    },
  ],
});

/** Inscription lines on a stone's face (z = `z`), the first at `y`: `n` lines narrowing down. */
const inscription = (w: number, y: number, z: number, n: number): Part[] =>
  Array.from({ length: n }, (_, i): Part => ({ box: [w * (i ? 0.42 : 0.6), 0.07, 0.012], at: [0, y - i * 0.12, z], c: 'carve' }));

export const tombstone = model({
  id: 'tombstone',
  about: 'Headstone on a low base with a tuft of moss (map `moss`), seeded lean: `shape` 0 a rounded top with an inscription, 1 a ringed cross, 2 a capped slab with a sunk panel; `h` is the height of the stone above its 0.12 m base',
  tags: ['dungeon', 'stone', 'grave'],
  palette: { stone: 'mist', stone2: 'slate', carve: 'night', moss: 'green' },
  params: { shape: [0, 0, 2], h: [0.9, 0.6, 1.3] },
  parts: (p, rng) => {
    const shape = Math.round(p.shape!);
    const h = p.h! * rng.range(0.94, 1.06);
    const w = (0.5 + h * 0.15) * rng.range(0.92, 1.08);
    const t = 0.14; // the stone's thickness
    const z = t / 2; // its face
    const stone: Part[] =
      shape === 0
        ? [{ slab: archOutline(w / 2, w * 0.24, h - w * 0.24, 6), depth: t, c: 'stone', name: 'stone' }, ...inscription(w, h * 0.66, z, 2)]
        : shape === 1
          ? [
              { box: [0.18, h, t], at: [0, h / 2, 0], c: 'stone', name: 'stone' },
              { box: [w, 0.18, t], at: [0, h * 0.7, 0], c: 'stone' },
              { torus: [w * 0.8, 0.09, w * 0.8], at: [0, h * 0.7, 0], rot: [90, 0, 0], seg: 10, c: 'stone2', name: 'ring' },
              { cyl: [0.12, 0.024, 0.12], at: [0, h * 0.7, z], rot: [90, 0, 0], seg: 8, c: 'carve' },
            ]
          : [
              { box: [w, h - 0.07, t], at: [0, (h - 0.07) / 2, 0], c: 'stone', name: 'stone' },
              { box: [w + 0.08, 0.07, t + 0.06], at: [0, h - 0.035, 0], c: 'stone2', name: 'cap' },
              { box: [w * 0.66, h * 0.44, 0.012], at: [0, h * 0.5, z], c: 'stone2' },
              ...inscription(w * 0.8, h * 0.6, z + 0.006, 2),
            ];
    const side = rng.chance(0.5) ? 1 : -1;
    return [
      { box: [w + 0.16, 0.12, t + 0.2], at: [0, 0.06, 0], c: 'stone2', name: 'base' },
      { at: [0, 0.12, 0], rot: [rng.range(-5, 2), rng.range(-6, 6), rng.range(-3, 3)], group: stone },
      { lump: [0.24, 0.09, 0.16], at: [side * (w / 2 - 0.02), 0.13, z + 0.06], rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c: 'moss', name: 'moss' },
    ];
  },
});

/** A skull facing +Z on y = 0: a cranium, a jaw in another bone shade, dark eye sockets. */
const skull = (c: string, jaw: string): Part[] => [
  { ball: [0.28, 0.25, 0.3], at: [0, 0.16, -0.02], seg: 8, c },
  { box: [0.17, 0.07, 0.12], at: [0, 0.035, 0.05], c: jaw },
  { mirror: [{ box: [0.075, 0.07, 0.03], at: [0.055, 0.15, 0.11], c: 'socket' }] },
];
/** The skull pile's bone shades, cycled: with two, stacked skulls of one shade join into a block. */
const SHADES = ['bone', 'bone2', 'bone3'];

export const skullPile = model({
  id: 'skull-pile',
  about: 'Stacked pile of skulls facing out round a dark heap, in three bone shades so stacked skulls read apart, seeded; `n` skulls in up to three tiers',
  tags: ['dungeon', 'bone'],
  palette: { bone: 'white', bone2: 'sand', bone3: 'mist', socket: 'ink', heap: 'night' },
  params: { n: [7, 4, 9] },
  parts: (p, rng) => {
    const n = Math.round(p.n!);
    const mid = n >= 6 ? Math.round((n - 1) * 0.36) : 0;
    const low = n - 1 - mid;
    const r1 = Math.max(0.22, (low * 0.3) / (2 * Math.PI));
    const r2 = Math.max(0.14, Math.min(r1 - 0.08, (mid * 0.3) / (2 * Math.PI)));
    const topY = mid ? 0.32 : 0.16;
    const shade = (i: number) => SHADES[i % 3]!;
    const ring = (count: number, r: number, y: number, k: number): Part[] =>
      around(
        count,
        (i) => ({
          at: [0, y, r],
          rot: [rng.range(-8, 2), rng.range(-12, 12), rng.range(-5, 5)],
          group: skull(shade(k + i), shade(k + i + 1)),
        }),
        { phase: rng.range(0, 360) },
      );
    return [
      { ball: [r1 * 2 + 0.04, topY + 0.08, r1 * 2 + 0.04], at: [0, (topY + 0.08) / 2, 0], half: true, seg: 8, c: 'heap', name: 'heap' },
      ...ring(low, r1, 0, 0),
      ...(mid ? ring(mid, r2, 0.16, low) : []),
      // on top, facing the camera
      { at: [0, topY, 0], rot: [rng.range(-6, 2), 45 + rng.range(-15, 15), 0], group: skull(shade(n - 1), shade(n)), name: 'top' },
    ];
  },
});

export const wallChains = model({
  id: 'wall-chains',
  about: 'Iron chains hung from ring bolts on a wall plate at 2 m, its back on a wall at z = 0, a shackle on each; `n` chains about `len` metres long (seeded)',
  tags: ['dungeon', 'iron', 'wall'],
  palette: { plate: 'slate', iron: 'night', link: 'slate', link2: 'mist' },
  params: { n: [2, 1, 3], len: [1, 0.4, 1.5] },
  floats: true,
  collider: 'none',
  anchors: { wall: [0, 2, 0] },
  parts: (p, rng) => {
    const n = Math.round(p.n!);
    const step = 0.5;
    const pitch = 0.17; // a link's drop: chunky, or a chain is a hairline at 480×270
    return [
      { box: [(n - 1) * step + 0.34, 0.2, 0.05], at: [0, 2, 0.025], c: 'plate', name: 'plate' },
      ...Array.from({ length: n }, (_, k): Part => {
        const links = Math.max(3, Math.round((p.len! * rng.range(0.85, 1.05)) / pitch));
        const y = (i: number) => 1.9 - i * pitch;
        return {
          at: [(k - (n - 1) / 2) * step, 0, 0],
          group: [
            { box: [0.12, 0.12, 0.08], at: [0, 2, 0.09], c: 'iron' },
            // links in two greys: a pale diamond ring facing out, then a darker one edge on (a plate: the budget)
            ...Array.from({ length: links }, (_, i): Part =>
              i % 2
                ? { box: [0.065, 0.22, 0.15], at: [0, y(i), 0.13], c: 'link' }
                : { torus: [0.17, 0.065, 0.25], at: [0, y(i), 0.13], rot: [90, 0, 0], seg: 4, c: 'link2' },
            ),
            { torus: [0.26, 0.08, 0.26], at: [0, y(links) - 0.02, 0.14], rot: [70, 0, 0], seg: 8, c: 'link2', name: 'shackle' },
          ],
        };
      }),
    ];
  },
});

export const portcullis = model({
  id: 'portcullis',
  about: 'Iron portcullis for a doorway: slate bars ending in steel spikes, dark cross bands over them, all on the pivot `grate` to raise it; `w` x `h` metres',
  tags: ['dungeon', 'iron', 'door'],
  palette: { bar: 'slate', band: 'night', tip: 'mist' },
  params: { w: [1.4, 0.8, 3], h: [2.2, 1.6, 3.2] },
  // shut, it closes the doorway: one box; a game that raises it drops or moves the collider
  collider: 'box',
  parts: (p) => {
    const w = p.w!;
    const h = p.h!;
    const n = Math.max(4, Math.round(w / 0.24) + 1); // bars
    const bands = Math.max(3, Math.round(h / 0.6));
    const spike = 0.16;
    const bx = (i: number) => -w / 2 + 0.05 + (i * (w - 0.1)) / (n - 1);
    const by = (j: number) => 0.4 + (j * (h - 0.46)) / (bands - 1);
    return [
      {
        name: 'grate',
        pivot: true,
        group: [
          ...Array.from({ length: n }, (_, i): Part => ({ box: [0.1, h - spike, 0.1], at: [bx(i), spike + (h - spike) / 2, 0], c: 'bar' })),
          ...Array.from({ length: n }, (_, i): Part => ({ cone: [0.13, spike, 0.13], at: [bx(i), spike / 2, 0], rot: [180, 45, 0], seg: 4, c: 'tip' })),
          ...Array.from({ length: bands }, (_, j): Part => ({ box: [w, 0.12, 0.06], at: [0, by(j), 0.08], c: 'band' })),
        ],
      },
    ];
  },
});

export const lever = model({
  id: 'lever',
  about: 'Floor lever: a steel handle with a red knob (map `knob`) on the pivot `handle`, hinged between iron cheeks on a stone block; `angle` throws it (+ toward the front)',
  tags: ['dungeon', 'iron', 'mechanism'],
  palette: { stone: 'mist', iron: 'night', slot: 'ink', axle: 'slate', handle: 'mist', knob: 'red' },
  params: { angle: [-30, -40, 40] },
  anchors: { pivot: [0, 0.38, 0] },
  parts: (p) => [
    { box: [0.56, 0.18, 0.46], at: [0, 0.09, 0], c: 'stone', name: 'block' },
    { box: [0.34, 0.08, 0.36], at: [0, 0.22, 0], c: 'iron' },
    { box: [0.1, 0.012, 0.28], at: [0, 0.266, 0], c: 'slot' },
    { mirror: [{ box: [0.06, 0.22, 0.18], at: [0.12, 0.35, 0], c: 'iron' }] },
    { cyl: [0.1, 0.36, 0.1], at: [0, 0.38, 0], rot: [0, 0, 90], seg: 6, c: 'axle', name: 'axle' },
    {
      name: 'handle',
      pivot: true,
      at: [0, 0.38, 0],
      rot: [p.angle!, 0, 0],
      group: [
        { box: [0.11, 0.78, 0.11], at: [0, 0.39, 0], c: 'handle' },
        { ball: [0.22, 0.22, 0.22], at: [0, 0.84, 0], seg: 8, c: 'knob', name: 'knob' },
      ],
    },
  ],
});

export const pressurePlate = model({
  id: 'pressure-plate',
  about: 'Pressure plate: a pale stone tile raised a few centimetres in a dark groove and a slate frame, a red mark on it (map `mark`); the tile is the pivot `plate` to press; `size` metres square',
  tags: ['dungeon', 'stone', 'trap', 'mechanism'],
  palette: { frame: 'slate', groove: 'ink', plate: 'mist', mark: 'red' },
  params: { size: [0.9, 0.5, 1.4] },
  collider: 'none', // walked over: a game watches it with a sensor
  parts: (p) => {
    const s = p.size!;
    return [
      { box: [s, 0.04, s], at: [0, 0.02, 0], c: 'frame', name: 'frame' },
      { box: [s - 0.12, 0.046, s - 0.12], at: [0, 0.023, 0], c: 'groove' },
      {
        name: 'plate',
        pivot: true,
        group: [
          { box: [s - 0.2, 0.08, s - 0.2], at: [0, 0.04, 0], c: 'plate' },
          { box: [s * 0.3, 0.014, s * 0.3], at: [0, 0.087, 0], rot: [0, 45, 0], c: 'mark', name: 'mark' },
        ],
      },
    ];
  },
});

const SQ2 = Math.SQRT2;

export const obelisk = model({
  id: 'obelisk',
  about: 'Stone obelisk on stepped plinths: a tapering shaft, a dark pyramidion and a dark band of small glowing runes (map `rune`, which also lights it); `h` is its height',
  tags: ['dungeon', 'stone', 'monument', 'magic', 'light'],
  palette: { stone: 'mist', stone2: 'slate', band: 'night', rune: 'cyan' },
  params: { h: [3.2, 2.2, 5] },
  // the runes sit at about 1.5–3 m over `h`'s range; the light (which can't follow a param) between
  light: { at: [0, 2.2, 0.5], c: 'rune', intensity: 1.5, radius: 4, flicker: 'pulse' },
  parts: (p) => {
    const h = p.h!;
    const f = 0.4 + h * 0.04; // the shaft's foot, face to face
    const base = 0.62;
    const top = f * 0.58;
    const cap = top * 0.9;
    const len = h - base - cap;
    const wAt = (y: number) => f + ((top - f) * (y - base)) / len;
    const y0 = base + len * 0.56; // the band
    const y1 = y0 + 0.26;
    const bw = wAt(y0) + 0.05;
    const yr = (y0 + y1) / 2;
    const face = (wAt(yr) + 0.05) / 2;
    return [
      { box: [f * 2.3, 0.2, f * 2.3], at: [0, 0.1, 0], c: 'stone2', name: 'step' },
      { box: [f * 1.8, 0.2, f * 1.8], at: [0, 0.3, 0], c: 'stone' },
      { box: [f * 1.35, 0.22, f * 1.35], at: [0, 0.51, 0], c: 'stone2', name: 'plinth' },
      { cyl: [f * SQ2, len, f * SQ2], at: [0, base + len / 2, 0], top: top / f, seg: 4, rot: [0, 45, 0], c: 'stone', name: 'shaft' },
      { cone: [top * SQ2 + 0.02, cap, top * SQ2 + 0.02], at: [0, h - cap / 2, 0], seg: 4, rot: [0, 45, 0], c: 'stone2', name: 'pyramidion' },
      { cyl: [bw * SQ2, y1 - y0, bw * SQ2], at: [0, yr, 0], top: (wAt(y1) + 0.05) / bw, seg: 4, rot: [0, 45, 0], c: 'band', name: 'band' },
      // the runes: small hot spots on each face of the band, a stroke between two diamonds
      ...around(4, () => ({
        at: [0, yr, face],
        group: [
          { slab: diamond(0.11, 0.14), depth: 0.03, at: [-0.11, 0, 0], c: 'rune', glow: true },
          { box: [0.06, 0.15, 0.03], c: 'rune', glow: true },
          { slab: diamond(0.11, 0.14), depth: 0.03, at: [0.11, 0, 0], c: 'rune', glow: true },
        ],
      })),
    ];
  },
});

/** Rune glyphs as glowing marks centred on 0 (x, y), on a face at z = 0. */
const GLYPHS: readonly ((c: string) => Part[])[] = [
  (c) => [{ box: [0.06, 0.18, 0.03], c, glow: true }, { box: [0.06, 0.1, 0.03], at: [0.04, 0.04, 0], rot: [0, 0, -45], c, glow: true }],
  (c) => [{ slab: diamond(0.13, 0.16), depth: 0.03, c, glow: true }],
  (c) => [{ box: [0.06, 0.17, 0.03], rot: [0, 0, 32], c, glow: true }, { box: [0.06, 0.17, 0.03], rot: [0, 0, -32], c, glow: true }],
  (c) => [{ box: [0.06, 0.18, 0.03], c, glow: true }, { box: [0.06, 0.09, 0.03], at: [-0.035, 0.05, 0], rot: [0, 0, 45], c, glow: true }, { box: [0.06, 0.09, 0.03], at: [0.035, 0.05, 0], rot: [0, 0, -45], c, glow: true }],
];

export const runeStone = model({
  id: 'rune-stone',
  about: 'Standing stone of seeded outline on a few pale footing stones: a dark carved strip down its face holding small glowing runes (map `rune`, which also lights it); `h` is its height',
  tags: ['dungeon', 'stone', 'magic', 'light', 'nature'],
  palette: { stone: 'slate', foot: 'mist', carve: 'night', rune: 'cyan' },
  params: { h: [1.8, 1.2, 2.6] },
  light: { at: [0, 1, 0.5], c: 'rune', intensity: 1.4, radius: 3.5, flicker: 'pulse' },
  parts: (p, rng) => {
    const h = p.h! * rng.range(0.94, 1.06);
    const hw = (0.3 + h * 0.04) * rng.range(0.92, 1.08);
    const t = 0.36;
    const outline: [number, number][] = [
      [-hw, 0],
      [hw, 0],
      [hw + rng.range(0, 0.06), h * rng.range(0.3, 0.45)],
      [hw * rng.range(0.72, 0.86), h * rng.range(0.8, 0.88)],
      [hw * rng.range(-0.1, 0.3), h],
      [-hw * rng.range(0.55, 0.75), h * rng.range(0.9, 0.95)],
      [-hw - rng.range(0, 0.05), h * rng.range(0.45, 0.6)],
    ];
    const strip = h * 0.56;
    const sy = h * 0.42; // the strip's centre
    const n = Math.max(3, Math.round(strip / 0.24));
    const first = rng.int(0, GLYPHS.length - 1);
    return [
      { slab: outline, depth: t, c: 'stone', name: 'stone' },
      { box: [0.2, strip, 0.03], at: [0, sy, t / 2], c: 'carve', name: 'strip' },
      ...Array.from({ length: n }, (_, i): Part => ({ at: [0, sy + strip / 2 - (strip * (i + 0.5)) / n, t / 2 + 0.015], group: GLYPHS[(first + i) % GLYPHS.length]!('rune') })),
      ...[-1, 1].map((s, i): Part => ({ lump: [0.44, 0.22, 0.38], at: [s * (hw + 0.04), 0.11, 0.14 - 0.24 * i], rot: [0, rng.range(0, 360), 0], seed: rng.int(1, 999), c: 'foot' })),
    ];
  },
});

export const pillory = model({
  id: 'pillory',
  about: 'Wooden pillory on a stone footing: a capped post, a split yoke at neck height with a head hole and two hand holes, the upper board on the pivot `yoke` hinged at the left, an iron hasp and a gold lock (map `lock`)',
  tags: ['dungeon', 'wood', 'town'],
  palette: { wood: 'orange', wood2: 'red', stone: 'mist', iron: 'night', hole: 'ink', lock: 'sand' },
  parts: () => {
    const bw = 1.16; // the yoke's boards
    const y = 1.4; // the split, at neck height
    const z = 0.13;
    const holes: [number, number][] = [[0, 0.2], [-0.36, 0.13], [0.36, 0.13]];
    // each hole in two halves, one in each board, so opening the yoke takes its halves with it
    const half = (x: number, d: number, up: boolean, dy: number): Part => ({
      slab: Array.from({ length: 7 }, (_, k): [number, number] => {
        const a = ((up ? k : k + 6) * Math.PI) / 6;
        return [x + (d / 2) * Math.cos(a), dy + (d / 2) * Math.sin(a)];
      }),
      depth: 0.12,
      at: [0, 0, 0],
      c: 'hole',
    });
    return [
      { box: [0.56, 0.22, 0.56], at: [0, 0.11, 0], c: 'stone', name: 'footing' },
      { box: [0.16, 1.66, 0.16], at: [0, 1.05, 0], c: 'wood2', name: 'post' },
      { cyl: [0.3, 0.14, 0.3], at: [0, 1.95, 0], top: 0, seg: 4, rot: [0, 45, 0], c: 'wood2' },
      { box: [bw, 0.2, 0.1], at: [0, y - 0.11, z], c: 'wood' },
      { group: holes.map(([x, d]) => half(x, d, false, 0)), at: [0, y, z] },
      {
        name: 'yoke',
        pivot: true,
        at: [-bw / 2, y + 0.01, z],
        group: [
          { box: [bw, 0.2, 0.1], at: [bw / 2, 0.1, 0], c: 'wood' },
          ...holes.map(([x, d]) => half(x + bw / 2, d, true, -0.01)),
          { box: [0.08, 0.18, 0.12], at: [bw - 0.06, 0.1, 0], c: 'iron', name: 'hasp' },
        ],
      },
      { box: [0.08, 0.46, 0.12], at: [-bw / 2 + 0.06, y, z], c: 'iron', name: 'hinge' },
      { box: [0.1, 0.12, 0.05], at: [bw / 2 - 0.06, y - 0.06, z + 0.08], c: 'lock', name: 'lock' },
    ];
  },
});

export const pitGrate = model({
  id: 'pit-grate',
  about: 'Pit in the floor like a well head: a low curb of stones in two greys round a black hole, under an iron ring and grate of crossed bars (the pivot `grate`); `r` is the hole\'s radius',
  tags: ['dungeon', 'stone', 'iron', 'trap'],
  palette: { stone: 'mist', stone2: 'slate', hole: 'ink', iron: 'night' },
  params: { r: [0.6, 0.4, 1] },
  collider: 'cyl',
  parts: (p) => {
    const r = p.r!;
    const curb = 0.26;
    const d = 0.24; // the curb's thickness
    // an even count, so the two shades alternate all the way round
    const n = 2 * Math.max(4, Math.round((Math.PI * (r + d / 2)) / 0.36));
    const tan = Math.tan(Math.PI / n);
    // one curb stone in the floor plane (x, z), tapered to the ring with a 3 cm joint each side
    const block: [number, number][] = [[-r * tan + 0.015, r], [r * tan - 0.015, r], [(r + d) * tan - 0.015, r + d], [-(r + d) * tan + 0.015, r + d]];
    const R = r + 0.04; // the bars' ends, on the ring
    const k = Math.max(2, Math.round(R / 0.2)); // bars each side of the middle
    const offs = Array.from({ length: 2 * k - 1 }, (_, i) => ((i - (k - 1)) * R) / k);
    const y = curb + 0.035;
    return [
      ...around(n, (i) => ({ slab: block, depth: curb, at: [0, curb / 2, 0], rot: [90, 0, 0], c: i % 2 ? 'stone2' : 'stone' })),
      { cyl: [2 * r + 0.06, curb - 0.06, 2 * r + 0.06], at: [0, (curb - 0.06) / 2, 0], seg: 12, c: 'hole', name: 'hole' },
      {
        name: 'grate',
        pivot: true,
        c: 'iron',
        group: [
          { torus: [2 * r + 0.14, 0.06, 2 * r + 0.14], at: [0, curb + 0.03, 0], seg: 12, name: 'ring' },
          ...offs.map((o): Part => ({ box: [2 * Math.sqrt(R * R - o * o), 0.06, 0.07], at: [0, y, o] })),
          ...offs.map((o): Part => ({ box: [0.07, 0.06, 2 * Math.sqrt(R * R - o * o)], at: [o, y + 0.005, 0] })),
        ],
      },
    ];
  },
});

export const DUNGEON = [chest, bones, cage, coffin, banner, spikes, altar, sarcophagus, tombstone, skullPile, wallChains, portcullis, lever, pressurePlate, obelisk, runeStone, pillory, pitGrate];
