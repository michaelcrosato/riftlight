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

export const WEAPONS = [greatsword, sword, axe, mace, sceptre, dagger, wand, staff, bow];
