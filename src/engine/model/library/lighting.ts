import { model } from '../helpers';

export const lampPost = model({
  id: 'lamp-post',
  about: 'Iron street lamp with a hanging lantern',
  tags: ['lighting', 'town'],
  palette: { iron: 'night', flame: 'sand' },
  light: { at: [0.42, 1.74, 0], c: 'flame', intensity: 6, radius: 6, flicker: 'candle' },
  parts: [
    { cyl: [0.3, 0.2, 0.3], at: [0, 0.1, 0], top: 0.6, c: 'iron' },
    { cyl: [0.09, 2.0, 0.09], at: [0, 1.1, 0], seg: 6, c: 'iron' },
    { box: [0.5, 0.06, 0.06], at: [0.22, 2.02, 0], c: 'iron' },
    {
      name: 'lantern',
      at: [0.42, 1.74, 0],
      group: [
        { box: [0.22, 0.04, 0.22], at: [0, -0.13, 0], c: 'iron' },
        { box: [0.16, 0.22, 0.16], c: 'flame', glow: true },
        { cyl: [0.32, 0.1, 0.32], at: [0, 0.16, 0], top: 0.25, seg: 4, rot: [0, 45, 0], c: 'iron' },
        { cyl: [0.06, 0.1, 0.06], at: [0, 0.25, 0], seg: 4, c: 'iron' },
      ],
    },
  ],
});

/** Tongues of a flame: [x, z, width, height (of `h`), slot]. Fat, 6-sided and splayed so their faces catch the light. */
const TONGUES: readonly [number, number, number, number, string][] = [
  [-0.02, -0.04, 0.46, 1, 'mid'],
  [0.15, -0.11, 0.34, 0.7, 'outer'],
  [-0.17, -0.02, 0.38, 0.78, 'mid'],
  [0.15, 0.09, 0.36, 0.62, 'mid'],
  [-0.07, 0.14, 0.36, 0.55, 'core'],
];

export const flame = model({
  id: 'flame',
  about: 'A fire\'s flame: fat lit tongues splayed apart, a small glowing heart (big glow reads flat)',
  tags: ['lighting', 'fire'],
  palette: { outer: 'red', mid: 'orange', core: 'sand', heart: 'white' },
  params: { h: [0.8, 0.3, 1.4] },
  light: { at: [0, 0.4, 0], c: 'mid', intensity: 5, radius: 5, flicker: 'torch' },
  parts: (p) => [
    ...TONGUES.map(([x, z, w, k, c]) => {
      const a = (Math.atan2(z, x) * 180) / Math.PI;
      return { group: [{ cone: [w, p.h! * k, w], at: [0, (p.h! * k) / 2, 0], rot: [0, 0, -12], seg: 6, c }], at: [x, 0.05, z], rot: [0, -a, 0] } as const;
    }),
    { ball: [0.14, 0.1, 0.14], at: [0.02, 0.05, 0.24], c: 'heart', glow: true },
  ],
});

export const LIGHTING = [lampPost, flame];
