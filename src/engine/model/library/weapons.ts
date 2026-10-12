import { model } from '../helpers';
import type { Part, Slot, Vec3 } from '../types';

export const greatsword = model({
  id: 'greatsword',
  about: 'Two-handed sword, gold guard, purple grip',
  tags: ['weapon', 'sword'],
  palette: { steel: 'mist', gold: 'sand', grip: 'plum' },
  parts: [
    {
      at: [0, 0.06, 0],
      group: [
        { slab: [[-0.06, 0], [0.06, 0], [0.06, 1.0], [0, 1.14], [-0.06, 1.0]], depth: 0.035, at: [0, 0.3, 0], c: 'steel' },
        { box: [0.34, 0.06, 0.08], at: [0, 0.28, 0], c: 'gold' },
        { mirror: [{ ball: [0.07, 0.07, 0.07], at: [0.18, 0.28, 0], c: 'gold' }] },
        { cyl: [0.06, 0.22, 0.06], at: [0, 0.14, 0], seg: 6, c: 'grip' },
        { ball: [0.08, 0.08, 0.08], at: [0, 0.01, 0], c: 'gold' },
      ],
    },
  ],
});

// One-hand weapons for a character's fist (Riftlight's hero holds these): each stands up along +Y
// from its pommel on the floor, its edges (or axe bit) facing ±X, with a `grip` anchor where the
// fist closes. A game turns +Y to its hand's grip axis. Sizes are written along the weapon from
// the grip (`w` across, `t` thick, `l` along, `z` the centre's distance from the grip), so they
// read like the weapon in the hand. Every slot named `grip` is the one to tint (a rarity colour).

/** A box `w` across, `t` thick and `l` long, centred `z` along the weapon from the grip (lifted by `base`). */
const bar = (base: number, w: number, t: number, l: number, z: number, c: Slot, x = 0): Part => ({ box: [w, l, t], at: [x, base + z, 0], c });
const gripAt = (base: number): { at: Vec3; rot: Vec3 } => ({ at: [0, base, 0], rot: [0, 0, 0] });

export const sword = model({
  id: 'sword',
  about: 'One-handed sword: white blade with a grey fuller, gold guard and pommel, a grip to tint',
  tags: ['weapon', 'sword', 'one-hand'],
  palette: { grip: 'plum', gold: 'sand', blade: 'white', fuller: 'mist' },
  anchors: { grip: gripAt(0.185) },
  parts: [
    bar(0.185, 0.06, 0.06, 0.2, -0.02, 'grip'),
    bar(0.185, 0.09, 0.09, 0.07, -0.15, 'gold'),
    bar(0.185, 0.3, 0.07, 0.07, 0.11, 'gold'),
    bar(0.185, 0.11, 0.035, 0.68, 0.48, 'blade'),
    bar(0.185, 0.06, 0.045, 0.6, 0.5, 'fuller'),
  ],
});

export const axe = model({
  id: 'axe',
  about: 'One-handed axe: a haft with a bearded head on its leading side (+X) and a spike behind',
  tags: ['weapon', 'axe', 'one-hand'],
  palette: { grip: 'plum', iron: 'slate', head: 'mist', bit: 'white' },
  anchors: { grip: gripAt(0.19) },
  parts: [
    bar(0.19, 0.06, 0.06, 0.74, 0.22, 'grip'),
    bar(0.19, 0.08, 0.08, 0.06, -0.16, 'iron'),
    bar(0.19, 0.1, 0.09, 0.16, 0.5, 'iron'),
    bar(0.19, 0.2, 0.05, 0.2, 0.5, 'head', 0.13),
    bar(0.19, 0.05, 0.06, 0.3, 0.48, 'bit', 0.24),
    bar(0.19, 0.1, 0.04, 0.06, 0.52, 'iron', -0.09),
  ],
});

export const mace = model({
  id: 'mace',
  about: 'Flanged mace: an iron head with four flanges and a tip on a haft',
  tags: ['weapon', 'mace', 'one-hand'],
  palette: { grip: 'plum', gold: 'sand', iron: 'slate', flange: 'mist' },
  anchors: { grip: gripAt(0.17) },
  parts: [
    bar(0.17, 0.06, 0.06, 0.54, 0.14, 'grip'), // ends inside the head, short of the flanges
    bar(0.17, 0.08, 0.08, 0.06, -0.14, 'gold'),
    bar(0.17, 0.17, 0.17, 0.2, 0.5, 'iron'),
    bar(0.17, 0.27, 0.06, 0.15, 0.5, 'flange'),
    bar(0.17, 0.06, 0.27, 0.15, 0.5, 'flange'),
    bar(0.17, 0.07, 0.07, 0.08, 0.63, 'flange'),
  ],
});

export const sceptre = model({
  id: 'sceptre',
  about: 'Gold sceptre: a crown holding a cyan gem, a point above',
  tags: ['weapon', 'sceptre', 'one-hand', 'magic'],
  palette: { grip: 'sand', gold: 'sand', gem: 'cyan' },
  anchors: { grip: gripAt(0.16) },
  parts: [
    bar(0.16, 0.06, 0.06, 0.52, 0.14, 'grip'),
    bar(0.16, 0.08, 0.08, 0.06, -0.13, 'gold'),
    bar(0.16, 0.18, 0.18, 0.07, 0.42, 'gold'),
    bar(0.16, 0.12, 0.12, 0.14, 0.51, 'gem'),
    bar(0.16, 0.06, 0.06, 0.08, 0.61, 'gold'),
  ],
});

export const dagger = model({
  id: 'dagger',
  about: 'Dagger: a short white blade, gold guard and pommel',
  tags: ['weapon', 'dagger', 'one-hand'],
  palette: { grip: 'plum', gold: 'sand', blade: 'white' },
  anchors: { grip: gripAt(0.125) },
  parts: [
    bar(0.125, 0.06, 0.06, 0.14, -0.01, 'grip'),
    bar(0.125, 0.07, 0.07, 0.05, -0.1, 'gold'),
    bar(0.125, 0.17, 0.065, 0.06, 0.08, 'gold'),
    bar(0.125, 0.08, 0.03, 0.3, 0.25, 'blade'),
  ],
});

export const wand = model({
  id: 'wand',
  about: 'Wand: a teal shaft, a gold band and butt, a cyan gem at the tip',
  tags: ['weapon', 'wand', 'one-hand', 'magic'],
  palette: { grip: 'teal', gold: 'sand', gem: 'cyan' },
  anchors: { grip: gripAt(0.12) },
  parts: [
    bar(0.12, 0.06, 0.06, 0.38, 0.1, 'grip'),
    bar(0.12, 0.08, 0.08, 0.04, 0.22, 'gold'),
    bar(0.12, 0.09, 0.09, 0.11, 0.33, 'gem'),
    bar(0.12, 0.07, 0.07, 0.04, -0.1, 'gold'),
  ],
});

export const staff = model({
  id: 'staff',
  about: 'Staff: a long shaft held a third of the way up, a gold claw holding a cyan crystal',
  tags: ['weapon', 'staff', 'two-hand', 'magic'],
  palette: { grip: 'plum', iron: 'slate', gold: 'sand', gem: 'cyan' },
  anchors: { grip: gripAt(0.515) },
  parts: [
    bar(0.515, 0.065, 0.065, 1.55, 0.27, 'grip'),
    bar(0.515, 0.08, 0.08, 0.07, -0.48, 'iron'),
    bar(0.515, 0.09, 0.09, 0.05, 0.9, 'gold'),
    bar(0.515, 0.2, 0.06, 0.12, 1.08, 'gold'),
    bar(0.515, 0.13, 0.13, 0.2, 1.16, 'gem'),
  ],
});

/** The bow's half height and how far its tips curl back toward the archer (−Z here), in metres. */
export const BOW_SHAPE = { half: 0.6, curl: 0.17 } as const;

export const bow = model({
  id: 'bow',
  about: 'Recurve bow without its string (a game draws the string between the `tip.*` anchors): sand limbs, orange tips',
  tags: ['weapon', 'bow', 'two-hand'],
  palette: { grip: 'plum', limb: 'sand', tip: 'orange' },
  // stands on its lower tip, its belly at +Z; the limbs curl back toward the archer at −Z
  anchors: { grip: { at: [0, 0.62, 0], rot: [0, 0, 0] }, 'tip.top': [0, 0.62 + BOW_SHAPE.half, -BOW_SHAPE.curl], 'tip.bottom': [0, 0.62 - BOW_SHAPE.half, -BOW_SHAPE.curl] },
  parts: () => {
    const { half, curl } = BOW_SHAPE;
    const out: Part[] = [{ box: [0.07, 0.16, 0.08], at: [0, 0.62, 0], c: 'grip' }];
    const seg = 3;
    for (const s of [1, -1]) {
      for (let i = 0; i < seg; i++) {
        const z0 = (i / seg) * half;
        const z1 = ((i + 1) / seg) * half;
        const y0 = curl * (z0 / half) ** 2 - 0.03;
        const y1 = curl * (z1 / half) ** 2 - 0.03;
        const len = Math.hypot(z1 - z0, y1 - y0) + 0.02;
        // the limb along the bow (here +Y) with its curl toward the archer (−Z): turned about X
        const tilt = (-s * Math.atan2(y1 - y0, z1 - z0) * 180) / Math.PI;
        out.push({ box: [i === seg - 1 ? 0.064 : 0.06, len, 0.045], at: [0, 0.62 + (s * (z0 + z1)) / 2, -(y0 + y1) / 2], rot: [tilt, 0, 0], c: i === seg - 1 ? 'tip' : 'limb' });
      }
    }
    return out;
  },
});

type Pt = readonly [number, number];
/** An outline (`slab`) `depth` thick, its origin `z` along the weapon from the grip (lifted by `base`). */
const plate = (base: number, outline: readonly Pt[], depth: number, z: number, c: Slot, x = 0): Part => ({ slab: outline, depth, at: [x, base + z, 0], c });

export const spear = model({
  id: 'spear',
  about: 'Spear: a long shaft, a white leaf-shaped head with a steel midrib on an iron socket, an iron butt cap',
  tags: ['weapon', 'spear', 'polearm', 'two-hand'],
  palette: { grip: 'plum', iron: 'slate', gold: 'sand', blade: 'white', steel: 'mist' },
  params: { l: [2, 1.6, 2.4] },
  anchors: { grip: gripAt(0.62) },
  parts: (p) => {
    const g = 0.62;
    const top = p.l! - g; // the point, from the grip
    return [
      bar(g, 0.08, 0.08, 0.08, 0.04 - g, 'iron'),
      bar(g, 0.065, 0.065, p.l! - 0.46, (p.l! - 0.34) / 2 - g, 'grip'),
      bar(g, 0.095, 0.095, 0.04, top - 0.49, 'gold'),
      { cyl: [0.09, 0.16, 0.09], top: 0.7, seg: 6, at: [0, g + top - 0.4, 0], c: 'iron' },
      // a flat leaf head, broad enough to read as a blade at game scale, with a steel midrib
      plate(g, [[0, 0], [0.11, 0.1], [0.09, 0.22], [0, 0.42], [-0.09, 0.22], [-0.11, 0.1]], 0.04, top - 0.42, 'blade'),
      bar(g, 0.035, 0.06, 0.32, top - 0.23, 'steel'),
    ];
  },
});

export const warhammer = model({
  id: 'warhammer',
  about: 'Two-handed war hammer: an iron head with a steel striking face (+X), a back spike and a top spike, on a long haft',
  tags: ['weapon', 'hammer', 'mace', 'two-hand'],
  palette: { grip: 'plum', iron: 'slate', steel: 'mist', gold: 'sand' },
  anchors: { grip: gripAt(0.36) },
  parts: [
    bar(0.36, 0.085, 0.085, 0.07, -0.325, 'iron'),
    bar(0.36, 0.065, 0.065, 1.11, 0.245, 'grip'),
    bar(0.36, 0.085, 0.085, 0.05, 0.65, 'gold'),
    bar(0.36, 0.24, 0.16, 0.17, 0.79, 'iron'),
    bar(0.36, 0.08, 0.2, 0.2, 0.79, 'steel', 0.14),
    { cone: [0.12, 0.22, 0.12], seg: 4, at: [-0.22, 1.15, 0], rot: [0, 0, 90], c: 'steel' },
    { cone: [0.09, 0.16, 0.09], seg: 4, at: [0, 1.305, 0], c: 'steel' },
  ],
});

/** The greataxe's right bit and the white edge along it, from the haft (x = 0) at the head's middle. */
const GREAT_BIT: readonly Pt[] = [[0.04, 0.08], [0.2, 0.13], [0.29, 0.19], [0.33, 0.08], [0.345, 0], [0.33, -0.08], [0.29, -0.19], [0.2, -0.13], [0.04, -0.08]];
const GREAT_EDGE: readonly Pt[] = [[0.28, 0.17], [0.3, 0.22], [0.36, 0.1], [0.38, 0], [0.36, -0.1], [0.3, -0.22], [0.28, -0.17], [0.32, -0.08], [0.335, 0], [0.32, 0.08]];

export const greataxe = model({
  id: 'greataxe',
  about: 'Two-handed greataxe: a double-bitted grey head with white edges on an iron socket, a long haft',
  tags: ['weapon', 'axe', 'two-hand'],
  palette: { grip: 'plum', iron: 'slate', head: 'mist', bit: 'white', gold: 'sand' },
  anchors: { grip: gripAt(0.38) },
  parts: [
    bar(0.38, 0.085, 0.085, 0.08, -0.34, 'iron'),
    bar(0.38, 0.065, 0.065, 1.28, 0.32, 'grip'),
    bar(0.38, 0.085, 0.085, 0.04, 0.64, 'gold'),
    bar(0.38, 0.11, 0.1, 0.32, 0.82, 'iron'),
    { mirror: [plate(0.38, GREAT_BIT, 0.04, 0.82, 'head'), plate(0.38, GREAT_EDGE, 0.048, 0.82, 'bit')] },
  ],
});

export const halberd = model({
  id: 'halberd',
  about: 'Halberd: a long pole, iron langets, a grey axe blade with a white edge (+X), a back hook and a white top spike',
  tags: ['weapon', 'halberd', 'polearm', 'two-hand'],
  palette: { grip: 'plum', iron: 'slate', head: 'mist', edge: 'white' },
  params: { l: [2.1, 1.8, 2.4] },
  anchors: { grip: gripAt(0.7) },
  parts: (p) => {
    const g = 0.7;
    const top = p.l! - g;
    const h = top - 0.55; // the blade's middle, from the grip
    return [
      bar(g, 0.08, 0.08, 0.08, 0.04 - g, 'iron'),
      bar(g, 0.065, 0.065, p.l! - 0.36, (p.l! - 0.24) / 2 - g, 'grip'),
      bar(g, 0.09, 0.08, 0.5, top - 0.5, 'iron'),
      plate(g, [[-0.035, 0], [0.035, 0], [0.05, 0.07], [0, 0.42], [-0.05, 0.07]], 0.035, top - 0.42, 'edge'),
      plate(g, [[0.03, 0.13], [0.13, 0.13], [0.3, 0.22], [0.3, -0.18], [0.13, -0.1], [0.03, -0.12]], 0.04, h, 'head'),
      bar(g, 0.05, 0.062, 0.43, h + 0.02, 'edge', 0.3),
      plate(g, [[-0.03, 0.06], [-0.22, -0.04], [-0.27, -0.13], [-0.03, -0.05]], 0.035, h, 'head'),
    ];
  },
});

export const flail = model({
  id: 'flail',
  about: 'Flail: a short handle, an iron chain of links held straight out as in a swing, a steel ball with white spikes',
  tags: ['weapon', 'flail', 'mace', 'one-hand'],
  palette: { grip: 'plum', gold: 'sand', iron: 'slate', ball: 'mist', spike: 'white' },
  params: { links: [3, 2, 4] },
  anchors: { grip: gripAt(0.2) },
  parts: (p) => {
    const n = Math.round(p.links!);
    // links 0.11 m long, every 0.08 m, turned a quarter each; the first hangs from the collar
    const link = (i: number): Part => ({ torus: [0.11, 0.025, 0.07], seg: 6, at: [0, 0.5 + i * 0.08, 0], rot: i % 2 ? [0, 0, 90] : [0, 90, 90], c: 'iron' });
    const ball = 0.5 + (n - 1) * 0.08 + 0.055 + 0.085; // the ball's centre (m), sunk into the last link
    const spike = (rot: Vec3): Part => ({ group: [{ cone: [0.07, 0.09, 0.07], seg: 4, at: [0, 0.13, 0] }], rot, c: 'spike' });
    return [
      bar(0.2, 0.085, 0.085, 0.06, -0.17, 'gold'),
      bar(0.2, 0.065, 0.065, 0.38, 0.03, 'grip'),
      bar(0.2, 0.085, 0.085, 0.07, 0.22, 'iron'),
      ...Array.from({ length: n }, (_, i) => link(i)),
      {
        at: [0, ball, 0],
        group: [{ ball: [0.2, 0.2, 0.2], seg: 8, c: 'ball' }, spike([0, 0, 0]), spike([90, 0, 0]), spike([-90, 0, 0]), spike([0, 0, 90]), spike([0, 0, -90])],
      },
    ];
  },
});

export const scythe = model({
  id: 'scythe',
  about: 'War scythe: a long snath with a side handle, a grey crescent blade sweeping out to +X with a white edge underneath',
  tags: ['weapon', 'scythe', 'polearm', 'two-hand'],
  palette: { grip: 'plum', iron: 'slate', blade: 'mist', edge: 'white' },
  anchors: { grip: gripAt(0.75) },
  parts: [
    bar(0.75, 0.08, 0.08, 0.07, -0.715, 'iron'),
    bar(0.75, 0.065, 0.065, 1.61, 0.105, 'grip'),
    { box: [0.06, 0.06, 0.2], at: [0, 1.05, 0.12], c: 'grip' },
    bar(0.75, 0.1, 0.09, 0.12, 0.87, 'iron'),
    // the blade's spine on top, its edge (the white strip) underneath, curving down to the point
    plate(0.75, [[0, 0.06], [0.2, 0.1], [0.42, 0.08], [0.62, 0.02], [0.76, -0.135], [0.62, -0.07], [0.42, -0.03], [0.2, -0.02], [0, -0.05]], 0.035, 0.87, 'blade', 0.03),
    plate(0.75, [[0.02, -0.073], [0.2, -0.045], [0.42, -0.055], [0.62, -0.095], [0.81, -0.16], [0.64, -0.05], [0.42, -0.005], [0.2, 0.005], [0.02, -0.027]], 0.042, 0.87, 'edge', 0.03),
  ],
});

export const crossbow = model({
  id: 'crossbow',
  about: 'Crossbow, strung and cocked: a stock with its butt on the floor, a steel prod across the front, an iron stirrup, the string drawn back to the nut',
  tags: ['weapon', 'crossbow', 'two-hand'],
  palette: { grip: 'plum', iron: 'slate', prod: 'mist', gold: 'sand', string: 'white' },
  // the bolt's groove faces +Z; the string runs from the prod's tips back to the nut on top of the stock
  anchors: { grip: gripAt(0.32) },
  parts: [
    { box: [0.08, 0.3, 0.12], at: [0, 0.15, -0.02], c: 'grip' },
    bar(0.32, 0.07, 0.07, 0.5, 0.21, 'grip'),
    { box: [0.03, 0.08, 0.07], at: [0, 0.36, -0.07], c: 'gold' }, // the trigger, under the stock
    { box: [0.08, 0.06, 0.04], at: [0, 0.5, 0.05], c: 'gold' }, // the nut
    bar(0.32, 0.1, 0.09, 0.1, 0.42, 'iron'),
    { mirror: [{ box: [0.34, 0.065, 0.055], at: [0.19, 0.696, 0], rot: [0, 0, -8], c: 'prod' }] },
    { torus: [0.14, 0.03, 0.12], seg: 6, at: [0, 0.84, 0], rot: [90, 0, 0], c: 'iron' },
    // the string drawn back to the nut, built in (unlike the bow's, which a game draws between its
    // tips): two ribbons deep enough to read, deliberately thicker than a real string
    { mirror: [{ box: [0.4, 0.025, 0.062], at: [0.18, 0.586, 0.03], rot: [0, 0, 25.5], c: 'string' }] },
  ],
});

// Shields stand on their rim with the face toward +Z and a handle on the back; the `grip` anchor
// sits on the handle (+Y along it). Their `grip` slot is the handle and the painted device on the
// face, so a game's tint shows from the front.

/** A handle on a shield's back at height `y`, the board's back face at `z`: two standoffs (`iron`) and the grip. */
const handle = (y: number, z: number, iron: Slot): Part[] => [
  { box: [0.065, 0.065, 0.05], at: [0, y + 0.08, z - 0.025], c: iron },
  { box: [0.065, 0.065, 0.05], at: [0, y - 0.08, z - 0.025], c: iron },
  { box: [0.06, 0.2, 0.035], at: [0, y, z - 0.0675], c: 'grip' },
];

/** The round shield's radius; its centre (and the handle) is 2 cm higher, where the rim stands on the floor. */
const SHIELD_R = 0.35;

export const roundShield = model({
  id: 'round-shield',
  about: 'Round shield: a red board with two painted quarters, a steel rim and boss; a handle on the back',
  tags: ['weapon', 'shield', 'offhand'],
  palette: { board: 'red', grip: 'sand', steel: 'mist' },
  anchors: { grip: { at: [0, SHIELD_R + 0.02, -0.0825], rot: [0, 0, 0] } },
  parts: () => {
    const r = SHIELD_R;
    const y = r + 0.02;
    const R = r - 0.02; // the paint ends under the rim
    const k = Math.SQRT1_2 * R;
    const quarter = (s: number): Part => ({ slab: [[0, 0], [s * R, 0], [s * k, s * k], [0, s * R]], depth: 0.006, at: [0, y, 0.02], c: 'grip' });
    return [
      { cyl: [2 * r, 0.03, 2 * r], seg: 8, at: [0, y, 0], rot: [90, 0, 0], c: 'board' },
      { torus: [2 * r + 0.04, 0.06, 2 * r + 0.04], seg: 8, at: [0, y, 0], rot: [90, 0, 0], c: 'steel' },
      quarter(1),
      quarter(-1),
      { ball: [r * 0.5, 0.08, r * 0.5], half: true, seg: 8, at: [0, y, 0.063], rot: [90, 0, 0], c: 'steel' },
      ...handle(y, -0.015, 'steel'),
    ];
  },
});

/** The kite shield's right half: from the point at the bottom up the side, over the top to the middle. */
const KITE: readonly Pt[] = [[0, 0], [0.09, 0.14], [0.17, 0.3], [0.24, 0.48], [0.28, 0.64], [0.3, 0.8], [0.29, 0.9], [0.22, 0.97], [0.11, 1], [0, 1.01]];

export const kiteShield = model({
  id: 'kite-shield',
  about: 'Kite shield: a tall teardrop, its field split in two colours down the middle, a steel rim; a handle on the back',
  tags: ['weapon', 'shield', 'offhand'],
  palette: { rim: 'mist', grip: 'white', field: 'blue' },
  anchors: { grip: { at: [0, 0.62, -0.0875], rot: [0, 0, 0] } },
  parts: () => {
    const c = 0.62; // the field's inset shrinks toward here, the handle's height
    const side = (sx: number, s: number): Pt[] => KITE.map(([x, y]) => [sx * x * s, c + (y - c) * s] as const);
    const full = [...side(1, 1), ...side(-1, 1).reverse().slice(1, -1)];
    return [
      { slab: full, depth: 0.04, c: 'rim' },
      { slab: side(1, 0.88), depth: 0.04, at: [0, 0, 0.006], c: 'field' },
      { slab: side(-1, 0.88), depth: 0.04, at: [0, 0, 0.006], c: 'grip' },
      ...handle(c, -0.02, 'rim'),
    ];
  },
});

/** Two vanes of an arrow's fletching, either side of the shaft: widest near the nock (the top), tapering down. */
const VANE: readonly Pt[] = [[-0.006, 0], [0.006, 0], [0.036, 0.1], [0.036, 0.13], [0.006, 0.155], [-0.006, 0.155], [-0.036, 0.13], [-0.036, 0.1]];

export const quiver = model({
  id: 'quiver',
  about: 'Quiver of arrows: a leather tube with dark bands and a rim, the fletchings of a few arrows (seeded) standing out of its mouth',
  tags: ['weapon', 'quiver', 'gear'],
  palette: { grip: 'red', trim: 'plum', fletch: 'white', fletch2: 'sand' },
  params: { arrows: [6, 3, 8] },
  // the body is the `grip` slot a game tints; `mount` is where it straps on (a back or a hip)
  anchors: { mount: { at: [0, 0.3, -0.07], rot: [0, 0, 0] } },
  parts: (p, rng) => {
    const n = Math.round(p.arrows!);
    const arrow = (i: number): Part => {
      const a = i * 2.4; // the golden angle, so the arrows spread over the mouth
      const d = 0.05 * Math.sqrt((i + 0.5) / n);
      const lean = rng.range(6, 14); // splayed out from the middle
      return {
        at: [Math.cos(a) * d, 0.62 + rng.range(0, 0.03), Math.sin(a) * d],
        rot: [Math.sin(a) * lean, rng.range(0, 90), -Math.cos(a) * lean],
        c: i % 2 ? 'fletch2' : 'fletch',
        group: [{ slab: VANE, depth: 0.012, at: [0, -0.08, 0] }, { slab: VANE, depth: 0.012, at: [0, -0.08, 0], rot: [0, 90, 0] }],
      };
    };
    return [
      { cyl: [0.15, 0.5, 0.15], top: 1.15, seg: 8, at: [0, 0.29, 0], c: 'grip' },
      { cyl: [0.145, 0.06, 0.145], seg: 8, at: [0, 0.03, 0], c: 'trim' },
      { cyl: [0.148, 0.04, 0.148], seg: 8, at: [0, 0.2, 0], c: 'trim' },
      { cyl: [0.158, 0.04, 0.158], seg: 8, at: [0, 0.44, 0], c: 'trim' },
      { torus: [0.166, 0.03, 0.166], seg: 8, at: [0, 0.54, 0], c: 'trim' },
      ...Array.from({ length: n }, (_, i) => arrow(i)),
    ];
  },
});

export const WEAPONS = [greatsword, sword, axe, mace, sceptre, dagger, wand, staff, bow, spear, warhammer, crossbow, roundShield, kiteShield, greataxe, halberd, flail, scythe, quiver];
