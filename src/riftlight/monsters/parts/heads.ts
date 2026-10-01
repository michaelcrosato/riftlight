import { flat, inc } from '../../core/mods';
import type { HeadAnchors } from '../types';
import { ball, box, cone, horn, lump, pair, part, slab, taper, turned } from './kit';

/**
 * Heads. Unit head space: the head joint sits where the neck joins; the head spans about
 * x ±0.5, y 0..1 and z −0.45..0.55 (forward). Each head declares anchors for eyes, horns,
 * the crest (helm slot) and the jaw hinge, so the other face parts land on it.
 */
const A = (a: Partial<HeadAnchors> & Pick<HeadAnchors, 'eyes'>): HeadAnchors => ({
  horns: [0.26, 0.82, 0.02],
  jaw: [0, 0.2, 0.18],
  crest: [0, 0.92, 0],
  size: [1, 1, 1],
  ...a,
});

export const HEADS = [
  part('head.snout', 'Beast Snout', ['head'], ['beast', 'nature', 'blood', 'earth'], 0, [], (c) => {
    box(c, 'primary', [0, 0.45, 0.02], [0.66, 0.58, 0.66]);
    box(c, 'primary', [0, 0.36, 0.42], [0.46, 0.34, 0.5]);
    box(c, 'dark', [0, 0.48, 0.68], [0.2, 0.12, 0.08]);
    box(c, 'secondary', [0, 0.25, 0.4], [0.4, 0.12, 0.46]);
    pair((sx) => cone(c, 'primary', [0.22 * sx, 0.82, -0.08], [0.2, 0.3, 0.14], { rot: [-15, 0, -20 * sx] }));
  }, { anchors: A({ eyes: [[0.2, 0.58, 0.33]], jaw: [0, 0.2, 0.22], horns: [0.24, 0.78, 0.0] }), plans: ['quadruped', 'biped', 'brute', 'serpent', 'avian'] }),

  part('head.lizard', 'Lizard Skull', ['head'], ['beast', 'water', 'poison', 'fire', 'nature'], 0, [], (c) => {
    box(c, 'primary', [0, 0.36, 0.1], [0.56, 0.42, 0.7]);
    box(c, 'primary', [0, 0.32, 0.55], [0.4, 0.26, 0.42]);
    box(c, 'secondary', [0, 0.56, 0.0], [0.34, 0.08, 0.5]);
    pair((sx) => box(c, 'dark', [0.13 * sx, 0.42, 0.74], [0.06, 0.05, 0.05]));
  }, { anchors: A({ eyes: [[0.22, 0.5, 0.26]], jaw: [0, 0.2, 0.0], horns: [0.2, 0.58, -0.05], crest: [0, 0.6, -0.05] }), plans: ['quadruped', 'serpent', 'biped', 'centipede'] }),

  part('head.skull', 'Bare Skull', ['head'], ['undead', 'shadow'], 0, [flat('res.chaos', 0.1)], (c) => {
    ball(c, 'secondary', [0, 0.52, 0.02], [0.66, 0.66, 0.7]);
    box(c, 'secondary', [0, 0.3, 0.2], [0.46, 0.24, 0.44]);
    pair((sx) => box(c, 'dark', [0.15 * sx, 0.5, 0.31], [0.18, 0.16, 0.06]));
    box(c, 'dark', [0, 0.36, 0.42], [0.08, 0.1, 0.04]);
    box(c, 'secondary', [0, 0.2, 0.36], [0.36, 0.06, 0.08]);
  }, { anchors: A({ eyes: [[0.15, 0.5, 0.3]], jaw: [0, 0.2, 0.08] }) }),

  part('head.beak', 'Beaked Head', ['head'], ['beast', 'storm', 'nature', 'void'], 0, [inc('crit.chance', 0.1)], (c) => {
    ball(c, 'primary', [0, 0.45, 0], [0.6, 0.62, 0.62]);
    taper(c, 0.15, 'accent', [0, 0.42, 0.46], [0.26, 0.5, 0.26], { rot: [90, 0, 0] });
    box(c, 'secondary', [0, 0.72, -0.08], [0.12, 0.16, 0.36]);
  }, { anchors: A({ eyes: [[0.24, 0.52, 0.18]], jaw: [0, 0.32, 0.26], crest: [0, 0.78, -0.05] }), plans: ['avian', 'biped', 'quadruped', 'serpent'] }),

  part('head.maw', 'Great Maw', ['head'], ['beast', 'void', 'blood', 'poison'], 1, [inc('damage', 0.1, ['melee'])], (c) => {
    box(c, 'primary', [0, 0.52, 0.12], [0.8, 0.44, 0.84]);
    box(c, 'secondary', [0, 0.32, 0.14], [0.72, 0.06, 0.74]);
    for (let i = 0; i < 4; i++) cone(c, 'secondary', [-0.27 + i * 0.18, 0.24, 0.46], [0.08, 0.16, 0.08], { rot: [180, 0, 0] });
    pair((sx) => cone(c, 'secondary', [0.32 * sx, 0.22, 0.2], [0.07, 0.14, 0.07], { rot: [180, 0, 0] }));
  }, { anchors: A({ eyes: [[0.24, 0.76, 0.34]], jaw: [0, 0.3, -0.18], horns: [0.3, 0.74, -0.05], crest: [0, 0.76, -0.1] }) }),

  part('head.insect', 'Insect Head', ['head'], ['insect', 'poison', 'void'], 0, [flat('armour', 10)], (c) => {
    ball(c, 'primary', [0, 0.38, 0.12], [0.62, 0.52, 0.66]);
    box(c, 'secondary', [0, 0.62, 0.0], [0.42, 0.1, 0.52]);
    ball(c, 'dark', [0, 0.26, 0.42], [0.3, 0.2, 0.2]);
  }, { anchors: A({ eyes: [[0.25, 0.46, 0.32]], jaw: [0, 0.22, 0.42], horns: [0.12, 0.6, 0.38], crest: [0, 0.66, 0] }) }),

  part('head.cyclops', 'Cyclops Head', ['head'], ['earth', 'beast', 'void', 'construct'], 1, [inc('aggro.radius', 0.2)], (c) => {
    box(c, 'primary', [0, 0.5, 0.04], [0.66, 0.78, 0.62]);
    box(c, 'dark', [0, 0.72, 0.34], [0.5, 0.08, 0.08]);
    box(c, 'secondary', [0, 0.18, 0.18], [0.5, 0.2, 0.46]);
  }, { anchors: A({ eyes: [[0, 0.56, 0.36]], jaw: [0, 0.2, 0.1], horns: [0.28, 0.86, 0] }) }),

  part('head.horned', 'Horned Head', ['head'], ['fire', 'beast', 'blood', 'shadow'], 2, [flat('knockback', 2)], (c) => {
    box(c, 'primary', [0, 0.45, 0.06], [0.62, 0.62, 0.62]);
    box(c, 'primary', [0, 0.32, 0.42], [0.42, 0.3, 0.32]);
    box(c, 'dark', [0, 0.66, 0.36], [0.5, 0.08, 0.06]);
    pair((sx) => horn(c, 'accent', [0.28 * sx, 0.7, 0], 0.8, 0.16, 120, { rot: [-20, 0, -70 * sx] }));
  }, { anchors: A({ eyes: [[0.18, 0.56, 0.37]], jaw: [0, 0.18, 0.2], horns: [0.12, 0.92, -0.1] }) }),

  part('head.helmed', 'Iron Visage', ['head'], ['construct', 'earth', 'storm'], 1, [flat('armour', 25)], (c) => {
    box(c, 'secondary', [0, 0.48, 0.02], [0.64, 0.7, 0.62]);
    box(c, 'dark', [0, 0.54, 0.32], [0.5, 0.1, 0.04]);
    box(c, 'glow', [0, 0.54, 0.335], [0.4, 0.04, 0.04], { glow: true });
    box(c, 'primary', [0, 0.86, 0.02], [0.7, 0.08, 0.68]);
    pair((sx) => box(c, 'primary', [0.33 * sx, 0.4, 0], [0.06, 0.4, 0.4]));
  }, { anchors: A({ eyes: [], jaw: null, horns: [0.3, 0.84, 0] }) }),

  part('head.orb', 'Wisp Orb', ['head'], ['arcane', 'fire', 'void', 'storm', 'ice', 'crystal'], 0, [inc('cast.speed', 0.1)], (c) => {
    lump(c, 'primary', [0, 0.5, 0], [0.96, 0.96, 0.96]);
    lump(c, 'secondary', [0, 0.9, -0.12], [0.5, 0.36, 0.5]);
    ball(c, 'glow', [0, 0.5, 0], [0.5, 0.5, 0.5], { glow: true });
  }, { anchors: A({ eyes: [[0.18, 0.56, 0.44]], jaw: [0, 0.3, 0.38], horns: [0.3, 0.86, 0.06], crest: [0, 0.98, 0] }), plans: ['floater', 'blob'] }),

  part('head.eyeball', 'Floating Eye', ['head'], ['arcane', 'void', 'shadow', 'blood'], 1, [inc('aggro.radius', 0.3), inc('damage', 0.1, ['spell'])], (c) => {
    ball(c, 'secondary', [0, 0.5, 0], [1, 1, 1]);
    ball(c, 'accent', [0, 0.5, 0.36], [0.56, 0.56, 0.36]);
    ball(c, 'glow', [0, 0.5, 0.47], [0.26, 0.26, 0.18], { glow: true });
    ball(c, 'dark', [0, 0.5, 0.52], [0.12, 0.2, 0.1]);
    pair((sx) => box(c, 'primary', [0.3 * sx, 0.82, 0.18], [0.3, 0.06, 0.2], { rot: [0, 0, -25 * sx] }));
  }, { anchors: A({ eyes: [], jaw: [0, 0.2, 0.34], horns: [0.3, 0.84, -0.05], crest: [0, 1.0, -0.05] }), plans: ['floater'] }),

  part('head.jelly', 'Jelly Bell', ['head'], ['water', 'ice', 'poison', 'arcane', 'storm'], 0, [flat('res.lightning', 0.15)], (c) => {
    turned(c, 'bell', [[0.0, 1.0], [0.28, 0.96], [0.44, 0.8], [0.5, 0.5], [0.47, 0.3], [0.32, 0.26], [0.0, 0.3]], 'primary', [0, 0, 0], [1, 1, 1]);
    turned(c, 'frill', [[0.5, 0.3], [0.56, 0.22], [0.4, 0.18], [0.2, 0.22]], 'secondary', [0, 0, 0], [1, 1, 1]);
    ball(c, 'glow', [0, 0.55, 0], [0.4, 0.34, 0.4], { glow: true });
  }, { anchors: A({ eyes: [[0.2, 0.5, 0.42]], jaw: null, horns: [0.25, 0.86, 0.05], crest: [0, 1.0, 0] }), plans: ['floater'] }),

  part('head.wraith', 'Hooded Wraith', ['head'], ['undead', 'shadow', 'void', 'ice'], 1, [flat('evasion', 30)], (c) => {
    slab(c, 'hood', [[-0.5, 0], [0.5, 0], [0.42, 0.7], [0, 1.05], [-0.42, 0.7]], 0.8, 'primary', [0, 0, -0.05], [1, 1, 1]);
    box(c, 'dark', [0, 0.45, 0.32], [0.56, 0.6, 0.06]);
  }, { anchors: A({ eyes: [[0.13, 0.52, 0.36]], jaw: null, horns: [0.3, 0.78, -0.05], crest: [0, 1.02, -0.05] }), plans: ['biped', 'floater', 'brute'] }),
];
