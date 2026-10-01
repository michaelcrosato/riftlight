import { flat, inc } from '../../core/mods';
import type { HeadAnchors } from '../types';
import { ball, box, cone, horn, limb, lump, pair, part, slab, taper, teeth, turned } from './kit';

/**
 * Heads. Unit head space: the head joint sits where the neck joins; the head spans about
 * x ±0.5, y 0..1 and z −0.45..0.55 (forward). Each head declares anchors for eyes, horns,
 * the crest (helm slot) and the jaw hinge, so the other face parts land on it.
 *
 * Every head is a *face*: a skull mass that takes the body pattern, brows that sit over
 * the eye anchors (so the glowing eyes read as a glare at 480×270), and a mouth: an upper
 * jaw with teeth over a dark gape, so the jaw part (or the plan's plain jaw) bites below it.
 */
const A = (a: Partial<HeadAnchors> & Pick<HeadAnchors, 'eyes'>): HeadAnchors => ({
  horns: [0.26, 0.82, 0.02],
  jaw: [0, 0.2, 0.18],
  crest: [0, 0.92, 0],
  size: [1, 1, 1],
  ...a,
});

const P = { pattern: true };

export const HEADS = [
  part('head.snout', 'Beast Snout', ['head'], ['beast', 'nature', 'blood', 'earth'], 0, [], (c) => {
    lump(c, 'primary', [0, 0.52, 0.0], [0.66, 0.58, 0.62], P);
    // muzzle, nose, gape and fangs
    limb(c, 0.72, 0, 'primary', [0, 0.38, 0.36], [0.46, 0.48, 0.36], { rot: [-84, 0, 0], pattern: true });
    ball(c, 'dark', [0, 0.45, 0.62], [0.17, 0.12, 0.12]);
    box(c, 'dark', [0, 0.22, 0.36], [0.34, 0.06, 0.42]);
    teeth(c, 'bone', [-0.13, 0.25, 0.54], [0.13, 0.25, 0.54], 2, 0.07, -1, true);
    pair((sx) => {
      box(c, 'primary', [0.15 * sx, 0.68, 0.3], [0.2, 0.07, 0.14], { rot: [0, 0, 16 * sx] });
      cone(c, 'primary', [0.25 * sx, 0.86, -0.1], [0.2, 0.32, 0.12], { rot: [-18, 0, -24 * sx] });
      cone(c, 'dark', [0.25 * sx, 0.84, -0.07], [0.1, 0.2, 0.06], { rot: [-18, 0, -24 * sx] });
      cone(c, 'secondary', [0.33 * sx, 0.36, -0.02], [0.14, 0.26, 0.12], { rot: [0, 0, -100 * sx] });
    });
  }, { anchors: A({ eyes: [[0.2, 0.6, 0.29]], jaw: [0, 0.2, 0.22], horns: [0.24, 0.78, 0.0] }), plans: ['quadruped', 'biped', 'brute', 'serpent', 'avian'] }),

  part('head.lizard', 'Lizard Skull', ['head'], ['beast', 'water', 'poison', 'fire', 'nature'], 0, [], (c) => {
    lump(c, 'primary', [0, 0.38, 0.06], [0.58, 0.42, 0.66], P);
    limb(c, 0.7, 0, 'primary', [0, 0.32, 0.46], [0.42, 0.42, 0.26], { rot: [-88, 0, 0], pattern: true });
    box(c, 'dark', [0, 0.17, 0.4], [0.32, 0.05, 0.42]);
    teeth(c, 'bone', [-0.15, 0.2, 0.3], [-0.12, 0.2, 0.62], 4, 0.05, -1);
    teeth(c, 'bone', [0.15, 0.2, 0.3], [0.12, 0.2, 0.62], 4, 0.05, -1);
    pair((sx) => {
      box(c, 'secondary', [0.2 * sx, 0.55, 0.22], [0.16, 0.08, 0.2], { rot: [0, 0, 14 * sx] });
      box(c, 'dark', [0.1 * sx, 0.43, 0.68], [0.05, 0.04, 0.04]);
    });
    [-0.1, 0.06, 0.22].forEach((z, i) => cone(c, 'secondary', [0, 0.6 - i * 0.02, -z], [0.08, 0.16 - i * 0.03, 0.12], { rot: [-25, 0, 0] }));
  }, { anchors: A({ eyes: [[0.22, 0.48, 0.24]], jaw: [0, 0.18, 0.0], horns: [0.2, 0.58, -0.05], crest: [0, 0.6, -0.05] }), plans: ['quadruped', 'serpent', 'biped', 'centipede'] }),

  part('head.skull', 'Bare Skull', ['head'], ['undead', 'shadow'], 0, [flat('res.chaos', 0.1)], (c) => {
    ball(c, 'bone', [0, 0.56, 0.0], [0.68, 0.66, 0.7]);
    box(c, 'bone', [0, 0.3, 0.2], [0.48, 0.26, 0.44]);
    pair((sx) => {
      ball(c, 'dark', [0.15 * sx, 0.5, 0.29], [0.2, 0.2, 0.12]);
      box(c, 'bone', [0.24 * sx, 0.36, 0.22], [0.12, 0.1, 0.24], { rot: [0, 0, 10 * sx] });
    });
    cone(c, 'dark', [0, 0.36, 0.42], [0.08, 0.12, 0.05], { rot: [180, 0, 0] });
    box(c, 'dark', [0, 0.2, 0.33], [0.36, 0.05, 0.12]);
    teeth(c, 'bone', [-0.15, 0.24, 0.42], [0.15, 0.24, 0.42], 5, 0.05, -1);
  }, { anchors: A({ eyes: [[0.15, 0.5, 0.3]], jaw: [0, 0.2, 0.08] }) }),

  part('head.beak', 'Beaked Head', ['head'], ['beast', 'storm', 'nature', 'void'], 0, [inc('crit.chance', 0.1)], (c) => {
    ball(c, 'primary', [0, 0.48, 0], [0.62, 0.62, 0.64], P);
    // a hooked raptor beak and a glare
    horn(c, 'accent', [0, 0.44, 0.24], 0.52, 0.42, -70, { rot: [70, 0, 0] });
    taper(c, 0.2, 'accent', [0, 0.36, 0.4], [0.26, 0.36, 0.18], { rot: [90, 0, 0] });
    pair((sx) => box(c, 'dark', [0.17 * sx, 0.64, 0.24], [0.2, 0.08, 0.16], { rot: [0, 0, 18 * sx] }));
    box(c, 'secondary', [0, 0.76, -0.1], [0.12, 0.16, 0.36]);
  }, { anchors: A({ eyes: [[0.22, 0.54, 0.22]], jaw: [0, 0.32, 0.26], crest: [0, 0.8, -0.05] }), plans: ['avian', 'biped', 'quadruped', 'serpent'] }),

  part('head.maw', 'Great Maw', ['head'], ['beast', 'void', 'blood', 'poison'], 1, [inc('damage', 0.1, ['melee'])], (c) => {
    lump(c, 'primary', [0, 0.56, 0.08], [0.84, 0.48, 0.86], P);
    box(c, 'dark', [0, 0.32, 0.14], [0.72, 0.1, 0.74]);
    teeth(c, 'bone', [-0.32, 0.36, 0.48], [0.32, 0.36, 0.48], 6, 0.08, -1, true);
    pair((sx) => {
      teeth(c, 'bone', [0.36 * sx, 0.36, 0.38], [0.38 * sx, 0.36, -0.1], 3, 0.07, -1);
      box(c, 'secondary', [0.2 * sx, 0.84, 0.3], [0.22, 0.08, 0.16], { rot: [0, 0, 14 * sx] });
    });
    [-0.2, 0.0, 0.2].forEach((z) => cone(c, 'secondary', [0, 0.84, -z], [0.1, 0.16, 0.12], { rot: [-20, 0, 0] }));
  }, { anchors: A({ eyes: [[0.24, 0.76, 0.32]], jaw: [0, 0.3, -0.18], horns: [0.3, 0.74, -0.05], crest: [0, 0.76, -0.1] }) }),

  part('head.insect', 'Insect Head', ['head'], ['insect', 'poison', 'void'], 0, [flat('armour', 10)], (c) => {
    ball(c, 'primary', [0, 0.4, 0.1], [0.64, 0.54, 0.68], P);
    ball(c, 'secondary', [0, 0.6, -0.02], [0.48, 0.18, 0.56]);
    box(c, 'dark', [0, 0.25, 0.4], [0.34, 0.16, 0.14]);
    pair((sx) => box(c, 'dark', [0.16 * sx, 0.56, 0.34], [0.18, 0.06, 0.1], { rot: [0, 0, 20 * sx] }));
  }, { anchors: A({ eyes: [[0.25, 0.46, 0.3]], jaw: [0, 0.22, 0.42], horns: [0.12, 0.6, 0.38], crest: [0, 0.66, 0] }), plans: ['hexapod', 'centipede', 'biped', 'brute', 'quadruped', 'serpent', 'avian'] }),

  part('head.cyclops', 'Cyclops Head', ['head'], ['earth', 'beast', 'void', 'construct'], 1, [inc('aggro.radius', 0.2)], (c) => {
    lump(c, 'primary', [0, 0.5, 0.02], [0.7, 0.8, 0.64], P);
    // one great socket under a heavy single brow
    ball(c, 'dark', [0, 0.56, 0.3], [0.34, 0.3, 0.12]);
    box(c, 'primary', [0, 0.74, 0.3], [0.56, 0.12, 0.16], P);
    box(c, 'dark', [0, 0.24, 0.3], [0.4, 0.06, 0.12]);
    teeth(c, 'bone', [-0.16, 0.27, 0.36], [0.16, 0.27, 0.36], 4, 0.06, -1);
    pair((sx) => cone(c, 'primary', [0.36 * sx, 0.56, 0], [0.14, 0.26, 0.1], { rot: [0, 0, -95 * sx] }));
  }, { anchors: A({ eyes: [[0, 0.56, 0.36]], jaw: [0, 0.2, 0.1], horns: [0.28, 0.86, 0] }) }),

  part('head.horned', 'Horned Head', ['head'], ['fire', 'beast', 'blood', 'shadow'], 2, [flat('knockback', 2)], (c) => {
    lump(c, 'primary', [0, 0.48, 0.04], [0.64, 0.62, 0.62], P);
    limb(c, 0.8, 0, 'primary', [0, 0.32, 0.38], [0.44, 0.36, 0.32], { rot: [-84, 0, 0], pattern: true });
    ball(c, 'dark', [0, 0.38, 0.55], [0.18, 0.1, 0.08]);
    box(c, 'dark', [0, 0.18, 0.36], [0.32, 0.05, 0.3]);
    teeth(c, 'bone', [-0.12, 0.21, 0.5], [0.12, 0.21, 0.5], 3, 0.06, -1, true);
    pair((sx) => {
      box(c, 'dark', [0.16 * sx, 0.66, 0.34], [0.22, 0.08, 0.12], { rot: [0, 0, 18 * sx] });
      horn(c, 'bone', [0.28 * sx, 0.7, 0], 0.8, 0.16, 120, { rot: [-20, 0, -70 * sx] });
    });
  }, { anchors: A({ eyes: [[0.18, 0.56, 0.36]], jaw: [0, 0.18, 0.2], horns: [0.12, 0.92, -0.1] }) }),

  part('head.helmed', 'Iron Visage', ['head'], ['construct', 'earth', 'storm'], 1, [flat('armour', 25)], (c) => {
    box(c, 'secondary', [0, 0.48, 0.02], [0.64, 0.72, 0.62]);
    box(c, 'dark', [0, 0.55, 0.32], [0.52, 0.12, 0.04]);
    box(c, 'glow', [0, 0.55, 0.34], [0.42, 0.05, 0.04], { glow: true });
    box(c, 'primary', [0, 0.88, 0.02], [0.7, 0.1, 0.68]);
    box(c, 'primary', [0, 0.92, 0.0], [0.1, 0.14, 0.72]);
    box(c, 'dark', [0, 0.28, 0.32], [0.4, 0.22, 0.04]);
    for (const x of [-0.12, 0, 0.12]) box(c, 'primary', [x, 0.28, 0.34], [0.04, 0.2, 0.04]);
    pair((sx) => {
      box(c, 'primary', [0.33 * sx, 0.42, 0], [0.06, 0.44, 0.44]);
      ball(c, 'bone', [0.36 * sx, 0.42, 0.12], [0.06, 0.06, 0.06]);
    });
  }, { anchors: A({ eyes: [], jaw: null, horns: [0.3, 0.84, 0] }) }),

  part('head.orb', 'Wisp Orb', ['head'], ['arcane', 'fire', 'void', 'storm', 'ice', 'crystal'], 0, [inc('cast.speed', 0.1)], (c) => {
    ball(c, 'glow', [0, 0.5, 0], [0.56, 0.56, 0.56], { glow: true });
    // broken shell plates orbit the core: the light shows through the gaps
    for (const [x, y, z, rx, rz] of [
      [0.3, 0.62, 0.1, 0, -40],
      [-0.3, 0.62, 0.1, 0, 40],
      [0, 0.86, -0.05, -10, 0],
      [0.26, 0.28, -0.12, 30, -130],
      [-0.26, 0.28, -0.12, 30, 130],
      [0, 0.52, -0.36, -80, 0],
    ] as const)
      lump(c, 'primary', [x, y, z], [0.36, 0.14, 0.32], { rot: [rx, 0, rz], pattern: true });
    box(c, 'dark', [0, 0.32, 0.4], [0.24, 0.05, 0.06]);
  }, { anchors: A({ eyes: [[0.16, 0.56, 0.42]], jaw: [0, 0.3, 0.38], horns: [0.3, 0.86, 0.06], crest: [0, 0.98, 0] }), plans: ['floater', 'blob'] }),

  part('head.eyeball', 'Floating Eye', ['head'], ['arcane', 'void', 'shadow', 'blood'], 1, [inc('aggro.radius', 0.3), inc('damage', 0.1, ['spell'])], (c) => {
    ball(c, 'bone', [0, 0.5, 0], [0.96, 0.96, 0.96]);
    ball(c, 'accent', [0, 0.5, 0.34], [0.56, 0.56, 0.34]);
    ball(c, 'glow', [0, 0.5, 0.47], [0.3, 0.3, 0.16], { glow: true });
    ball(c, 'dark', [0, 0.5, 0.53], [0.1, 0.24, 0.08]);
    // heavy lids in the body colour: a glare instead of a ball
    lump(c, 'primary', [0, 0.84, 0.12], [0.86, 0.36, 0.76], { rot: [-24, 0, 0], pattern: true });
    lump(c, 'primary', [0, 0.18, 0.1], [0.8, 0.3, 0.72], { rot: [14, 0, 0], pattern: true });
    pair((sx) => cone(c, 'primary', [0.42 * sx, 0.5, -0.1], [0.16, 0.34, 0.16], { rot: [0, 0, -90 * sx] }));
  }, { anchors: A({ eyes: [], jaw: [0, 0.2, 0.34], horns: [0.3, 0.84, -0.05], crest: [0, 1.0, -0.05] }), plans: ['floater'] }),

  part('head.jelly', 'Jelly Bell', ['head'], ['water', 'ice', 'poison', 'arcane', 'storm'], 0, [flat('res.lightning', 0.15)], (c) => {
    turned(c, 'bell', [[0.0, 1.0], [0.28, 0.96], [0.44, 0.8], [0.5, 0.5], [0.47, 0.3], [0.32, 0.26], [0.0, 0.3]], 'primary', [0, 0, 0], [1, 1, 1], P);
    turned(c, 'frill', [[0.5, 0.3], [0.56, 0.22], [0.4, 0.18], [0.2, 0.22]], 'secondary', [0, 0, 0], [1, 1, 1]);
    ball(c, 'glow', [0, 0.55, 0], [0.42, 0.36, 0.42], { glow: true });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ball(c, 'glow', [Math.sin(a) * 0.5, 0.3, Math.cos(a) * 0.5], [0.07, 0.07, 0.07], { glow: true });
    }
  }, { anchors: A({ eyes: [[0.2, 0.5, 0.42]], jaw: null, horns: [0.25, 0.86, 0.05], crest: [0, 1.0, 0] }), plans: ['floater'] }),

  part('head.wraith', 'Hooded Wraith', ['head'], ['undead', 'shadow', 'void', 'ice'], 1, [flat('evasion', 30)], (c) => {
    slab(c, 'hood', [[-0.5, 0], [0.5, 0], [0.42, 0.7], [0, 1.08], [-0.42, 0.7]], 0.84, 'primary', [0, 0, -0.06], [1, 1, 1], P);
    slab(c, 'hoodtip', [[-0.2, 0], [0.2, 0], [0, 0.36]], 0.2, 'primary', [0, 0.92, -0.38], [1, 1, 1], { rot: [-60, 0, 0] });
    box(c, 'dark', [0, 0.46, 0.33], [0.6, 0.64, 0.06]);
    pair((sx) => box(c, 'secondary', [0.31 * sx, 0.46, 0.35], [0.06, 0.64, 0.06]));
  }, { anchors: A({ eyes: [[0.13, 0.52, 0.36]], jaw: null, horns: [0.3, 0.78, -0.05], crest: [0, 1.02, -0.05] }), plans: ['biped', 'floater', 'brute'] }),
];
