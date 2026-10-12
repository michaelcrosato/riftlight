import { around, model } from '../helpers';

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

export const DRESSING = [crystal, rubble, glowcaps, standard];
