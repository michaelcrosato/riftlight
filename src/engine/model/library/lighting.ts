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

/**
 * Tongues of a flame: [x, z, face width, height (of `h`), splay (degrees, + leans to the screen's
 * right), slot]. Back to front, so the tallest stands behind.
 */
const TONGUES: readonly [number, number, number, number, number, string][] = [
  [-0.08, -0.08, 0.5, 1, 0, 'mid'],
  [-0.2, 0.08, 0.34, 0.72, -22, 'outer'],
  [0.08, -0.2, 0.34, 0.64, 0, 'outer'],
  [0.08, 0.08, 0.38, 0.58, -4, 'core'],
];
/** A one-tongue flame (`tongues: 1`): fat and centred. */
const CANDLE: (typeof TONGUES)[number] = [0, 0, 0.42, 0.72, 0, 'core'];
/** Degrees each tongue leans back from the camera: its front face tips up into the key light. */
const LEAN = 38;

export const flame = model({
  id: 'flame',
  about: 'A fire\'s flame: 3-sided lit tongues, one face to the iso camera and leaned back into the light, a small glowing heart',
  tags: ['lighting', 'fire'],
  palette: { outer: 'orange', mid: 'orange', core: 'sand', heart: 'white' },
  // `tongues`: fewer read better small (under ~0.5 scale the cel outlines eat thin tips); 1 is a
  // candle's flame, one centred `core` tongue and no heart
  params: { h: [0.8, 0.3, 1.4], tongues: [4, 1, 4] },
  light: { at: [0, 0.4, 0], c: 'mid', intensity: 5, radius: 5, flicker: 'torch' },
  parts: (p) => {
    const s = Math.sqrt(p.h! / 0.8); // taller flames are narrower for their height
    const n = Math.round(p.tongues!);
    const tongues = n === 1 ? [CANDLE] : [[0, 3], [0, 1, 3], [0, 1, 2, 3]][n - 2]!.map((i) => TONGUES[i]!);
    return [
      // A 3-sided cone's flat face is local −X; yaw 125 turns it to the camera (+X +Z, a little
      // left of it, toward the light), and the lean tips it up: the game's camera sees that one
      // lit face and the back faces hide.
      ...tongues.map(([x, z, fw, k, splay, c]) => {
        const h = p.h! * k;
        const [w, d] = [fw * 0.6 * s, fw * s];
        const lift = (w / 2) * Math.sin((LEAN * Math.PI) / 180);
        return { at: [x * s, lift, z * s], rot: [0, 125, 0], group: [{ rot: [splay, 0, -LEAN], group: [{ cone: [w, h, d], at: [0, h / 2, 0], seg: 3, c }] }] } as const;
      }),
      // the heart sits on the front tongue's face, low down: white-hot where the fire is fed
      ...(n > 1 ? [{ ball: [0.22 * s, 0.2 * s, 0.22 * s], at: [0.1 * s, 0.2 * s, 0.1 * s], seg: 8, c: 'heart', glow: true } as const] : []),
    ];
  },
});

/**
 * The flame's slots onto a model's own: its tongues in `flame` (the light's colour), its front
 * tongue in `core`, its heart in `heart`. Re-bind those three to recolour the fire.
 */
const FIRE = { outer: 'flame', mid: 'flame' } as const;
/** A one-tongue flame is all `core`: every slot onto `flame`, so none is left over. */
const CANDLE_FIRE = { outer: 'flame', mid: 'flame', core: 'flame', heart: 'flame' } as const;

export const wallTorch = model({
  id: 'wall-torch',
  about: 'Torch in an iron wall sconce mounted at 1.3 m, its back on the wall at z = 0 and the stick tipped out',
  tags: ['lighting', 'fire', 'wall'],
  palette: { iron: 'night', plate: 'slate', wood: 'red', rag: 'plum', flame: 'orange', core: 'sand', heart: 'white' },
  floats: true,
  collider: 'none',
  anchors: { mount: [0, 1.3, 0] },
  light: { at: [0, 2.3, 0.45], c: 'flame', intensity: 2, radius: 5, flicker: 'torch' },
  // `turn`: the degrees a game turns the torch about Y to hang it on another wall (90: a wall
  // facing +X); its flame turns back by as much, so the lit faces still meet the camera
  params: { turn: [0, -180, 180] },
  parts: (p) => [
    { box: [0.22, 0.34, 0.05], at: [0, 1.3, 0.025], c: 'plate' },
    { box: [0.08, 0.08, 0.24], at: [0, 1.24, 0.17], c: 'iron' },
    { cyl: [0.17, 0.12, 0.17], at: [0, 1.28, 0.32], top: 1.4, seg: 6, c: 'iron' },
    {
      at: [0, 1.26, 0.32],
      rot: [15, 0, 0],
      group: [
        { cyl: [0.09, 0.4, 0.09], at: [0, 0.2, 0], seg: 6, c: 'wood' },
        { cyl: [0.15, 0.14, 0.15], at: [0, 0.43, 0], top: 1.2, seg: 6, c: 'rag' },
        // upright again (flames rise) and turned back, so its lit faces still meet the camera
        { use: 'flame', at: [0, 0.48, 0], rot: [-15, -p.turn!, 0], scale: 0.7, palette: FIRE },
      ],
    },
  ],
});

export const brazier = model({
  id: 'brazier',
  about: 'Iron fire bowl on a pedestal, heaped with coals and burning',
  tags: ['lighting', 'fire'],
  palette: { iron: 'night', trim: 'slate', rim: 'mist', coal: 'red', flame: 'orange', core: 'sand', heart: 'white' },
  light: { at: [0, 1.58, 0], c: 'flame', intensity: 2.5, radius: 6, flicker: 'brazier' },
  parts: [
    { cyl: [0.5, 0.08, 0.5], at: [0, 0.04, 0], seg: 8, c: 'iron' },
    { cyl: [0.16, 0.52, 0.16], at: [0, 0.34, 0], top: 0.7, seg: 6, c: 'trim' },
    { cyl: [0.8, 0.26, 0.8], at: [0, 0.73, 0], top: 1.7, seg: 8, c: 'iron' },
    { torus: [0.86, 0.07, 0.86], at: [0, 0.86, 0], seg: 8, c: 'rim' },
    { ball: [0.66, 0.16, 0.66], at: [0, 0.86, 0], half: true, c: 'coal' },
    { use: 'flame', at: [0, 0.93, 0], params: { h: 0.7 }, scale: 0.9, palette: FIRE }, // on the coals, clear of the rim
  ],
});

export const candles = model({
  id: 'candles',
  about: 'Three wax candles of different heights in a puddle of wax, each with a one-tongue flame (seeded)',
  tags: ['lighting', 'fire'],
  palette: { wax: 'white', puddle: 'mist', flame: 'sand' },
  light: { at: [0, 0.95, 0], c: 'flame', intensity: 1.2, radius: 3.5, flicker: 'candle' },
  parts: (_, rng) => {
    // [x, z, lowest, highest]: spread along the screen's horizontal (+X −Z) so the game camera
    // sees three: the tallest behind in the middle, a middle one left, the shortest right and in front
    const spots: [number, number, number, number][] = [
      [-0.06, -0.1, 0.44, 0.56],
      [-0.2, 0.1, 0.28, 0.38],
      [0.2, -0.04, 0.14, 0.22],
    ];
    return [
      { cyl: [0.62, 0.04, 0.5], at: [0, 0.02, 0], rot: [0, -40, 0], seg: 8, c: 'puddle' },
      ...spots.flatMap(([x, z, lo, hi]) => {
        const h = rng.range(lo, hi);
        const w = rng.range(0.15, 0.17);
        return [
          { cyl: [w, h, w], at: [x, 0.04 + h / 2, z], seg: 6, c: 'wax' },
          { use: 'flame', at: [x, 0.02 + h, z], params: { tongues: 1 }, scale: rng.range(0.52, 0.6), palette: CANDLE_FIRE },
        ] as const;
      }),
    ];
  },
});

export const hangingLantern = model({
  id: 'hanging-lantern',
  about: 'Iron lantern with glowing glass, hung at 1.7 m on a chain from a ceiling plate; a side, not a post, faces the camera',
  tags: ['lighting'],
  palette: { iron: 'night', trim: 'slate', flame: 'sand' },
  floats: true,
  collider: 'none',
  anchors: { hook: [0, 2.675, 0] },
  light: { at: [0, 1.91, 0], c: 'flame', intensity: 1.8, radius: 5, flicker: 'candle' },
  parts: [
    { box: [0.32, 0.05, 0.32], at: [0, 1.725, 0], rot: [0, 45, 0], c: 'trim' },
    { rot: [0, 45, 0], group: [{ mirror: [{ mirror: [{ box: [0.06, 0.32, 0.06], at: [0.13, 1.91, 0.13], c: 'iron' }], axis: 'z' }] }] },
    { box: [0.2, 0.32, 0.2], at: [0, 1.91, 0], rot: [0, 45, 0], c: 'flame', glow: true },
    { box: [0.32, 0.05, 0.32], at: [0, 2.095, 0], rot: [0, 45, 0], c: 'trim' },
    { cyl: [0.4, 0.14, 0.4], at: [0, 2.19, 0], top: 0.3, seg: 4, c: 'iron' },
    ...[0, 1, 2].map((i) => ({ torus: [0.1, 0.06, 0.14], at: [0, 2.32 + i * 0.12, 0], rot: [90, i % 2 ? 90 : 0, 0], seg: 6, c: 'trim' }) as const),
    { box: [0.2, 0.05, 0.2], at: [0, 2.65, 0], c: 'iron' },
  ],
});

export const LIGHTING = [lampPost, flame, wallTorch, brazier, candles, hangingLantern];
