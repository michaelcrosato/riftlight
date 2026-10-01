import { flag, flat, inc } from '../../core/mods';
import { ball, box, cone, cyl, horn, pair, part, slab, taper, teeth } from './kit';

/**
 * Jaws (on the Jaw joint at the hinge, extending forward; +X rotation opens them), eyes
 * (on eye sockets at the head's surface), horns (left/right sockets on the head) and
 * helms/crests (centre top). Units: the head size.
 */
/** Bodies with a skull for a lower jaw to hang from (not blobs or floating orbs). */
const SKULLED = ['biped', 'brute', 'quadruped', 'serpent', 'avian', 'hexapod', 'centipede'];

export const JAWS = [
  part('jaw.fangs', 'Fanged Jaw', ['jaw'], ['beast', 'blood', 'undead', 'nature'], 1, [flat('chance.bleed', 0.15)], (c) => {
    box(c, 'secondary', [0, -0.06, 0.24], [0.5, 0.14, 0.56]);
    box(c, 'dark', [0, 0.02, 0.22], [0.4, 0.04, 0.46]);
    teeth(c, 'bone', [-0.12, 0.02, 0.44], [0.12, 0.02, 0.44], 3, 0.06, 1);
    pair((sx) => cone(c, 'bone', [0.19 * sx, 0.1, 0.42], [0.09, 0.26, 0.09]));
  }, { plans: SKULLED }),
  /** The plans' default lower jaw (cosmetic, never rolled): a jaw with a row of small teeth. */
  part('jaw.plain', 'Lower Jaw', ['jaw'], ['default'], 0, [], (c) => {
    box(c, 'secondary', [0, -0.05, 0.22], [0.44, 0.12, 0.5]);
    box(c, 'dark', [0, 0.02, 0.2], [0.34, 0.04, 0.4]);
    teeth(c, 'bone', [-0.13, 0.01, 0.42], [0.13, 0.01, 0.42], 4, 0.05, 1);
  }, { plans: SKULLED, weight: 0 }),
  part('jaw.mandibles', 'Mandibles', ['jaw'], ['insect', 'poison', 'void'], 1, [flat('chance.poison', 0.15), inc('damage', 0.05, ['melee'])], (c) => {
    pair((sx) => horn(c, 'accent', [0.16 * sx, 0, 0.02], 0.5, 0.14, 70, { rot: [70, 0, 25 * sx] }));
  }),
  /** Crawlers' default mouthparts (cosmetic): a pair of short hooked mandibles. */
  part('jaw.mandibles.small', 'Mouthparts', ['jaw'], ['default'], 0, [], (c) => {
    pair((sx) => horn(c, 'bone', [0.12 * sx, 0, 0.02], 0.34, 0.14, 80, { rot: [76, 0, 30 * sx] }));
  }, { plans: ['hexapod', 'centipede'], weight: 0 }),
  /** Mouthless bodies' default (cosmetic): a dark gape with teeth above and below. */
  part('jaw.gape', 'Gape', ['jaw'], ['default'], 0, [], (c) => {
    box(c, 'dark', [0, 0.02, 0.0], [0.5, 0.16, 0.1]);
    teeth(c, 'bone', [-0.2, 0.1, 0.03], [0.2, 0.1, 0.03], 5, 0.06, -1);
    teeth(c, 'bone', [-0.16, -0.06, 0.03], [0.16, -0.06, 0.03], 4, 0.05, 1);
  }, { plans: ['blob', 'floater'], weight: 0 }),
  part('jaw.tusks', 'Tusked Jaw', ['jaw'], ['beast', 'earth', 'ice'], 1, [flat('knockback', 1.5), flat('armour', 5)], (c) => {
    box(c, 'secondary', [0, -0.07, 0.2], [0.58, 0.18, 0.5]);
    box(c, 'dark', [0, 0.02, 0.18], [0.44, 0.04, 0.4]);
    pair((sx) => horn(c, 'bone', [0.22 * sx, 0.0, 0.38], 0.5, 0.2, -70, { rot: [-10, 0, -18 * sx] }));
  }, { plans: SKULLED }),
  part('jaw.beak', 'Lower Beak', ['jaw'], ['beast', 'storm', 'nature'], 0, [inc('crit.chance', 0.05)], (c) => {
    taper(c, 0.2, 'accent', [0, -0.04, 0.2], [0.24, 0.42, 0.14], { rot: [90, 0, 0] });
  }),
  part('jaw.feelers', 'Face Feelers', ['jaw'], ['void', 'water', 'arcane'], 1, [inc('damage', 0.1, ['spell'])], (c) => {
    for (const x of [-0.15, -0.05, 0.05, 0.15]) taper(c, 0.3, 'secondary', [x, -0.2, 0.12], [0.08, 0.42, 0.08], { rot: [-20, 0, x * 60] });
  }, { plans: [...SKULLED, 'floater'] }),
];

/**
 * Eyes glow (unlit) in a dark socket under a hard brow: two bright pixels and a frown is
 * what makes a lump read as a creature at 480×270, and they read in the dark.
 */
export const EYES = [
  part('eye.pair', 'Glowing Eyes', ['eyes'], ['any'], 0, [], (c) => {
    ball(c, 'dark', [0, 0, -0.02], [0.24, 0.2, 0.1]);
    ball(c, 'glow', [0, -0.005, 0.015], [0.17, 0.14, 0.08], { glow: true });
    box(c, 'dark', [-0.01, 0.1, 0.02], [0.26, 0.06, 0.1], { rot: [0, 0, 16] });
  }, { weight: 3 }),
  part('eye.big', 'Big Eye', ['eyes'], ['beast', 'insect', 'arcane', 'water'], 0, [inc('aggro.radius', 0.1)], (c) => {
    ball(c, 'bone', [0, 0, 0], [0.27, 0.27, 0.16]);
    ball(c, 'glow', [0, 0, 0.055], [0.17, 0.17, 0.08], { glow: true });
    ball(c, 'dark', [0, 0, 0.085], [0.06, 0.12, 0.05]);
    box(c, 'dark', [-0.01, 0.13, 0.03], [0.28, 0.06, 0.1], { rot: [0, 0, 12] });
  }, { weight: 2 }),
  part('eye.cluster', 'Eye Cluster', ['eyes'], ['insect', 'void', 'poison', 'shadow'], 1, [inc('crit.chance', 0.1)], (c) => {
    ball(c, 'dark', [0.02, 0.03, -0.03], [0.3, 0.26, 0.08]);
    ball(c, 'glow', [0, 0, 0], [0.15, 0.15, 0.09], { glow: true });
    ball(c, 'glow', [0.11, 0.09, -0.03], [0.09, 0.09, 0.06], { glow: true });
    ball(c, 'glow', [-0.08, 0.12, -0.02], [0.08, 0.08, 0.05], { glow: true });
    ball(c, 'glow', [0.12, -0.07, -0.03], [0.07, 0.07, 0.05], { glow: true });
  }),
  part('eye.stalk', 'Eye Stalk', ['eyes'], ['insect', 'water', 'void', 'poison'], 1, [inc('aggro.radius', 0.25)], (c) => {
    taper(c, 0.6, 'primary', [0.02, 0.16, -0.02], [0.08, 0.34, 0.08], { rot: [10, 0, -15] });
    ball(c, 'bone', [0.06, 0.34, 0.0], [0.18, 0.18, 0.18]);
    ball(c, 'glow', [0.06, 0.34, 0.07], [0.11, 0.11, 0.07], { glow: true });
    box(c, 'dark', [0.06, 0.43, 0.03], [0.18, 0.04, 0.1], { rot: [0, 0, 12] });
  }),
  part('eye.slit', 'Slit Visor', ['eyes'], ['construct', 'undead', 'shadow', 'void'], 0, [], (c) => {
    box(c, 'dark', [0, 0, 0], [0.26, 0.1, 0.05]);
    box(c, 'glow', [0, 0, 0.02], [0.22, 0.045, 0.04], { glow: true, rot: [0, 0, 8] });
  }),
];

export const HORNS = [
  part('horn.ram', 'Ram Horns', ['horns'], ['beast', 'earth', 'fire', 'blood'], 1, [flat('knockback', 2), flat('stun.threshold', 0.1)], (c) => {
    horn(c, 'bone', [0, 0, 0], 0.6, 0.22, 280, { rot: [0, 90, -40] });
  }),
  part('horn.bull', 'Bull Horns', ['horns'], ['beast', 'earth', 'blood', 'fire'], 1, [flat('knockback', 2.5), inc('damage', 0.05, ['charge'])], (c) => {
    horn(c, 'bone', [0, 0, 0], 0.78, 0.18, 100, { rot: [0, 0, -75] });
  }),
  part('horn.spike', 'Spike Horn', ['horns'], ['any'], 1, [flat('knockback', 1)], (c) => {
    cone(c, 'accent', [0, 0.18, 0], [0.14, 0.42, 0.14], { rot: [-15, 0, -25] });
  }, { weight: 2 }),
  part('horn.antlers', 'Antlers', ['horns'], ['nature', 'ice', 'beast', 'undead'], 2, [flat('knockback', 1.5), inc('life', 0.05)], (c) => {
    horn(c, 'bone', [0, 0, 0], 0.8, 0.11, -40, { rot: [0, 0, -35] });
    horn(c, 'bone', [0.16, 0.28, 0.0], 0.36, 0.08, 30, { rot: [30, 0, -10] });
    horn(c, 'bone', [0.3, 0.5, -0.1], 0.34, 0.07, 30, { rot: [-30, 0, -60] });
    horn(c, 'bone', [0.42, 0.62, 0.05], 0.28, 0.06, 30, { rot: [40, 0, -40] });
  }),
  part('horn.antennae', 'Antennae', ['horns'], ['insect', 'storm', 'arcane'], 0, [inc('aggro.radius', 0.15)], (c) => {
    horn(c, 'dark', [0, 0, 0], 0.7, 0.05, 80, { rot: [-10, 0, -25] });
    ball(c, 'glow', [0.3, 0.55, 0.38], [0.07, 0.07, 0.07], { glow: true });
  }),
  part('horn.demon', 'Demon Horns', ['horns'], ['fire', 'shadow', 'blood', 'void'], 2, [flat('knockback', 2), inc('damage', 0.08)], (c) => {
    horn(c, 'dark', [0, 0, 0], 0.85, 0.16, -110, { rot: [0, 0, -30] });
  }),
  part('spikes.head', 'Head Spikes', ['horns'], ['any'], 1, [flat('thorns', 4)], (c) => {
    cone(c, 'accent', [0, 0.1, 0], [0.1, 0.24, 0.1], { rot: [-30, 0, -30] });
    cone(c, 'accent', [0.08, 0.06, -0.16], [0.08, 0.2, 0.08], { rot: [-50, 0, -30] });
    cone(c, 'accent', [-0.04, 0.12, 0.14], [0.08, 0.18, 0.08], { rot: [0, 0, -20] });
  }),
];

export const HELMS = [
  part('helm.iron', 'Iron Helm', ['helm'], ['construct', 'earth', 'storm'], 1, [flat('armour', 20)], (c) => {
    box(c, 'dark', [0, -0.12, 0.02], [0.72, 0.3, 0.7]);
    box(c, 'dark', [0, -0.2, 0.36], [0.08, 0.34, 0.06]);
    box(c, 'accent', [0, 0.06, 0], [0.12, 0.08, 0.72]);
  }),
  part('helm.bone', 'Skull Cap', ['helm'], ['undead', 'beast', 'shadow'], 1, [flat('armour', 10), flat('res.chaos', 0.1)], (c) => {
    ball(c, 'secondary', [0, -0.06, 0.02], [0.66, 0.36, 0.66]);
    pair((sx) => cone(c, 'secondary', [0.2 * sx, 0.12, 0], [0.1, 0.22, 0.1], { rot: [0, 0, -30 * sx] }));
  }),
  part('helm.crown', 'Crown', ['helm'], ['arcane', 'undead', 'void', 'blood', 'boss'], 2, [inc('damage', 0.1), inc('life', 0.1)], (c) => {
    cyl(c, 'accent', [0, 0.02, 0], [0.5, 0.12, 0.5]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      cone(c, 'accent', [Math.sin(a) * 0.22, 0.16, Math.cos(a) * 0.22], [0.08, 0.18, 0.08]);
    }
    ball(c, 'glow', [0, 0.06, 0.25], [0.08, 0.08, 0.05], { glow: true });
  }, { weight: 0.5 }),
  part('crest.fin', 'Head Fin', ['helm'], ['water', 'beast', 'storm', 'poison'], 0, [inc('move.speed', 0.04)], (c) => {
    slab(c, 'fin', [[0, 0], [0.5, 0], [0.1, 0.55], [-0.15, 0.35]], 0.06, 'accent', [0, -0.05, -0.2], [1, 1, 1], { rot: [0, -90, 0] });
  }),
  part('crest.feather', 'Feather Crest', ['helm'], ['nature', 'storm', 'beast', 'arcane'], 0, [inc('evasion', 0.05)], (c) => {
    for (const a of [-25, 0, 25]) taper(c, 0.2, 'accent', [0, 0.18, -0.06], [0.08, 0.44, 0.04], { rot: [-30, 0, a] });
  }),
  part('crest.flame', 'Flame Crown', ['helm'], ['fire'], 1, [inc('fire.damage', 0.15), flat('res.fire', 0.2)], (c) => {
    cone(c, 'glow', [0, 0.18, 0], [0.26, 0.44, 0.26], { glow: true });
    pair((sx) => cone(c, 'glow', [0.15 * sx, 0.1, -0.05], [0.16, 0.3, 0.16], { glow: true, rot: [0, 0, -20 * sx] }));
  }),
];

export const SPECIAL = [
  part('helm.halo', 'Halo', ['helm'], ['arcane', 'storm', 'crystal'], 2, [flag('aura.halo'), inc('cast.speed', 0.1)], (c) => {
    cyl(c, 'glow', [0, 0.25, -0.05], [0.56, 0.04, 0.56], { glow: true });
  }, { weight: 0.4 }),
];
