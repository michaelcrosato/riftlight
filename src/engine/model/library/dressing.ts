import type { Rng } from '../../random';
import { around, model } from '../helpers';
import type { Part } from '../types';
import { polar } from './nature';

export const crystal = model({
  id: 'crystal',
  about: 'Crystal cluster: a glowing core shard ringed by dark facets, lighting its corner; map `glow` to recolour',
  tags: ['dressing', 'magic', 'cave', 'light'],
  palette: { glow: 'cyan', facet: 'teal', facet2: 'navy', base: 'mist' },
  light: { at: [0, 1.0, 0], c: 'glow', intensity: 2.5, radius: 4.5, flicker: 'pulse' },
  parts: (_, rng) => [
    { lump: [0.9, 0.16, 0.8], at: [0, 0.08, 0], seed: rng.int(1, 999), c: 'base', name: 'base' },
    // the core: a tall shard (only its upper part glows, so the glow stays a hot spot)
    { cone: [0.36, 0.7, 0.36], seg: 4, at: [0, 0.5, 0], rot: [0, rng.range(0, 90), 0], c: 'facet2', name: 'core' },
    { cone: [0.3, 0.55, 0.3], seg: 4, at: [0, 1.1, 0], rot: [0, rng.range(0, 90), 0], c: 'glow', glow: true, name: 'core' },
    ...around(3, (i) => ({ cone: [0.26, rng.range(0.55, 0.8), 0.26], seg: 4, at: [0.3, 0.42, 0], rot: [0, 30 * i, -28], c: i === 1 ? 'facet2' : 'facet', name: 'facets' })),
  ],
});

export const rubble = model({
  id: 'rubble',
  about: 'Rubble: a few fallen blocks, small enough to walk among; two greys',
  tags: ['dressing', 'stone', 'small'],
  palette: { stone: 'slate', stone2: 'mist' },
  parts: (_, rng) =>
    [0, 1, 2].map((i) => {
      // round a ring, so the blocks lie apart and each reads
      const s = rng.range(0.2, 0.34);
      const a = ((i * 120 + rng.range(-25, 25)) * Math.PI) / 180;
      const r = rng.range(0.26, 0.34);
      return { box: [s * 1.3, s, s], at: [r * Math.cos(a), s / 2, r * Math.sin(a)], rot: [0, rng.range(0, 90), 0], c: i === 1 ? 'stone2' : 'stone' };
    }),
});

export const glowcaps = model({
  id: 'glowcaps',
  about: 'Glowing mushrooms: three pale stalks under bright caps dotted with glowing spots, a soft pulsing light',
  tags: ['dressing', 'nature', 'cave', 'light'],
  palette: { stalk: 'sand', cap: 'lime', gill: 'green', spot: 'white' },
  light: { at: [0, 0.6, 0], c: 'cap', intensity: 1.6, radius: 3.5, flicker: 'pulse' },
  parts: (_, rng) =>
    [0, 1, 2].flatMap((i) => {
      const a = (i / 3) * 360 + rng.range(-20, 20);
      const r = rng.range(0.24, 0.32);
      const x = r * Math.cos((a * Math.PI) / 180);
      const z = r * Math.sin((a * Math.PI) / 180);
      const h = rng.range(0.25, 0.5);
      return [
        { cyl: [0.1, h, 0.1], seg: 6, at: [x, h / 2, z], c: 'stalk' },
        { cyl: [0.32, 0.05, 0.32], seg: 6, at: [x, h + 0.025, z], c: 'gill' },
        { ball: [0.36, 0.16, 0.36], half: true, seg: 6, at: [x, h + 0.05 + 0.08, z], c: 'cap' },
        // glowing spots: the hot spots (glow draws flat, so the cap itself stays lit)
        ...[0, 1].map((j) => ({ ball: [0.08, 0.06, 0.08], seg: 4, at: [x + (j ? -0.07 : 0.06), h + 0.05 + 0.14, z + (j ? 0.05 : -0.04)], c: 'spot', glow: true }) as const),
      ];
    }),
});

export const standard = model({
  id: 'standard',
  about: 'War banner on a standing pole: a stone foot, a crossbar and a long cloth with a hem; map `cloth`',
  tags: ['dressing', 'cloth', 'banner'],
  palette: { cloth: 'red', trim: 'sand', pole: 'night', foot: 'slate' },
  params: { h: [2.4, 1.6, 3.2] },
  parts: (p) => {
    const h = p.h!;
    return [
      { box: [0.42, 0.18, 0.42], at: [0, 0.09, 0], c: 'foot' },
      { box: [0.12, h, 0.12], at: [0, h / 2, 0], c: 'pole' },
      { box: [0.9, 0.1, 0.12], at: [0, h - 0.1, 0.06], c: 'pole' },
      { mirror: [{ ball: [0.12, 0.12, 0.12], at: [0.48, h - 0.1, 0.06], c: 'trim' }] },
      { box: [0.7, h * 0.42, 0.06], at: [0, h - 0.15 - (h * 0.42) / 2, 0.14], c: 'cloth' },
      { box: [0.7, 0.12, 0.08], at: [0, h - 0.15 - h * 0.42 - 0.06, 0.14], c: 'trim' },
    ];
  },
});

export const stalagmites = model({
  id: 'stalagmites',
  about: 'Cluster of 3-5 stalagmites on a slate rock mound: the tallest mist under a white wet tip, the rest slate and mist by turns, each tip paler (seeded); `h` is the tallest',
  tags: ['dressing', 'stone', 'cave'],
  palette: { stone: 'slate', stone2: 'mist', tip: 'mist', tip2: 'white', base: 'slate' },
  params: { h: [1.4, 0.6, 2.5] },
  parts: (p, rng) => {
    const h = p.h!;
    const n = rng.int(3, 5);
    const phase = rng.range(0, 360);
    return [
      { lump: [h * 0.8, h * 0.16, h * 0.7], at: [0, h * 0.08, 0], seed: rng.int(1, 999), c: 'base', name: 'base' },
      ...Array.from({ length: n }, (_, i): Part => {
        const sh = h * (i ? rng.range(0.4, 0.75) : 1);
        const w = Math.max(0.16, sh * 0.3);
        const a = phase + (360 * i) / Math.max(1, n - 1) + rng.range(-20, 20);
        const [x, z] = polar(a, i ? h * rng.range(0.2, 0.3) : 0);
        const dark = i % 2 === 1; // slate under a mist tip, or mist under a white one (the tallest, so it catches the eye)
        return {
          at: [x, i ? w * 0.06 : 0, z], // tilted, a foot's edge would dip into the floor
          rot: i ? [rng.range(-6, 6), rng.range(0, 60), rng.range(-6, 6)] : [0, rng.range(0, 60), 0],
          name: 'spires',
          group: [
            { cyl: [w, sh * 0.62, w], at: [0, sh * 0.31, 0], top: 0.5, seg: 6, c: dark ? 'stone' : 'stone2' },
            { cone: [w * 0.5, sh * 0.38, w * 0.5], at: [0, sh * 0.81, 0], seg: 6, c: dark ? 'tip' : 'tip2' },
          ],
        };
      }),
    ];
  },
});

/** A strip `w` wide from `a` to `b` as an SVG subpath (several make one slab of threads). */
const strip = ([ax, ay]: readonly [number, number], [bx, by]: readonly [number, number], w: number): string => {
  const l = Math.hypot(bx - ax, by - ay) || 1;
  const [nx, ny] = [(-(by - ay) / l) * (w / 2), ((bx - ax) / l) * (w / 2)];
  const f = (v: number) => v.toFixed(4);
  return `M ${f(ax + nx)} ${f(ay + ny)} L ${f(bx + nx)} ${f(by + ny)} L ${f(bx - nx)} ${f(by - ny)} L ${f(ax - nx)} ${f(ay - ny)} Z`;
};

export const cobweb = model({
  id: 'cobweb',
  about: 'Corner cobweb, hung where two walls (the back at z = 0, the left at x = 0) meet the ceiling at `h`: a white fan of five threads out of a dense hub, crossed by three sagging rings (seeded); it spreads `r` along each wall and r/2 down it (small webs: four threads, two rings)',
  tags: ['dressing', 'dungeon', 'cave', 'wall'],
  palette: { web: 'white' },
  params: { h: [2.6, 1.6, 4], r: [1, 0.5, 1.5] },
  floats: true,
  collider: 'none',
  parts: (p, rng) => {
    // The web lies in the plane x + 2y + z = 2h through the corner: leaning out from the walls, it
    // faces the game camera within 13° and catches the light (square to the camera it shades a
    // band darker), and it meets each wall along a line 1 down for 2 across, so its fan opens 78°
    // in its plane (80° on screen). In its own frame it hangs down -Y from the corner, +X across.
    // One slab of strips, one colour: threads 2 art pixels wide keep a light middle inside their
    // cel outlines (thinner ones draw as dark lines), and the gaps between them hold 2-3 pixels.
    const L = (p.r! * Math.sqrt(5)) / 2; // a thread along a wall: r across it, r/2 down
    const small = p.r! < 0.75;
    const w = 0.068 + 0.037 * L;
    const half = (Math.acos(1 / 5) * 90) / Math.PI; // half the angle between the wall lines, 39.2°
    const n = small ? 4 : 5;
    // the outer two run just inside the walls; the inner ones wander a little
    const spokes = Array.from({ length: n }, (_, i) => -(half - 2) + (2 * (half - 2) * i) / (n - 1) + (i && i < n - 1 ? rng.range(-4, 4) : 0));
    const at = (deg: number, r: number): [number, number] => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r];
    const rings = (small ? [0.5, 0.95] : [0.4, 0.68, 0.96]).flatMap((k) => {
      const r = L * (k + rng.range(-0.03, 0.03));
      // each span sags toward the hub, past the straight chord between its threads
      return spokes.slice(1).flatMap((d, i) => {
        const mid = (d + spokes[i]!) / 2;
        const rm = r * (Math.cos((((d - spokes[i]!) / 2) * Math.PI) / 180) - rng.range(0.07, 0.12));
        return [strip(at(spokes[i]!, r), at(mid, rm), w * 0.85), strip(at(mid, rm), at(d, r), w * 0.85)];
      });
    });
    const hub = `M 0 0 L ${at(spokes[0]!, L * 0.12).join(' ')} L ${at(0, L * 0.1).join(' ')} L ${at(spokes[n - 1]!, L * 0.12).join(' ')} Z`;
    return [
      {
        at: [0, p.h!, 0],
        rot: [0, 45, 0],
        group: [
          {
            rot: [-54.736, 0, 0], // the fan's middle runs (1, -1, 1): 35.26° below level
            group: [{ slab: [hub, ...spokes.map((d) => strip([0, 0], at(d, L), w)), ...rings].join(' '), depth: 0.02, c: 'web', name: 'web' }],
          },
        ],
      },
    ];
  },
});

/** A blob outline (XY): `n` points round an ellipse `rx` by `ry`, each pushed in or out by up to `k`. */
const blob = (rx: number, ry: number, k: number, rng: Rng, n = 12): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    const s = 1 + rng.range(-k, k);
    return [Math.cos(a) * rx * s, Math.sin(a) * ry * s];
  });

export const puddle = model({
  id: 'puddle',
  about: 'Puddle on the floor: a flat seeded blob of `water` 5 mm deep with a little pool off its side and lighter `shine` glints; map `water` for blood, slime or oil; `w` is its width',
  tags: ['dressing', 'water', 'dungeon', 'cave', 'town'],
  palette: { water: 'blue', shine: 'sky' },
  params: { w: [1.2, 0.4, 2.5] },
  collider: 'none',
  parts: (p, rng) => {
    const w = p.w!;
    const side = rng.range(0, 2 * Math.PI);
    const flat: [number, number, number] = [-90, 0, 0]; // an XY outline laid on the floor
    return [
      { slab: blob(w / 2, w * 0.36, 0.16, rng), depth: 0.005, at: [0, 0.0025, 0], rot: flat, c: 'water', name: 'water' },
      { slab: blob(w * 0.16, w * 0.12, 0.14, rng, 8), depth: 0.005, at: [Math.cos(side) * w * 0.46, 0.0025, Math.sin(side) * w * 0.32], rot: flat, c: 'water' },
      // glints: strokes along the screen's horizontal, a long one over a short one
      { box: [Math.max(0.1, w * 0.24), 0.008, 0.1], at: [-w * 0.06, 0.004, -w * 0.1], rot: [0, 45, 0], c: 'shine', name: 'shine' },
      { box: [Math.max(0.07, w * 0.12), 0.008, 0.1], at: [w * 0.02, 0.004, -w * 0.01], rot: [0, 45, 0], c: 'shine', name: 'shine' },
    ];
  },
});

export const mineRail = model({
  id: 'mine-rail',
  about: 'Mine-cart track, 1 m along x so pieces tile end to end: two mist rails on red sleepers; `gauge` between the rails',
  tags: ['dressing', 'iron', 'cave', 'mine'],
  palette: { rail: 'mist', sleeper: 'red' },
  params: { gauge: [0.6, 0.45, 0.9], sleepers: [2, 1, 4] },
  collider: 'none',
  parts: (p) => {
    const g = p.gauge!;
    const n = Math.round(p.sleepers!);
    return [
      // evenly spaced, half a space in from each end, so tiled pieces keep the spacing
      ...Array.from({ length: n }, (_, i): Part => ({ box: [0.16, 0.08, g + 0.36], at: [(i + 0.5) / n - 0.5, 0.04, 0], c: 'sleeper', name: 'sleepers' })),
      { mirror: [{ box: [1, 0.1, 0.08], at: [0, 0.125, g / 2], c: 'rail', name: 'rails' }], axis: 'z' },
    ];
  },
});

export const DRESSING = [crystal, rubble, glowcaps, standard, stalagmites, cobweb, puddle, mineRail];
