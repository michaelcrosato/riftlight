import type { Vec3 } from '../../../engine/animation';
import { flat, inc } from '../../core/mods';
import type { MonsterPartContext } from '../types';
import { ball, box, cone, cyl, horn, lump, pair, part, slab, taper } from './kit';

/**
 * Hands (left socket on the hand joint; −Y runs down the arm, +Z forward), weapons (right
 * hand; units = the monster's height, shaft carried forward and a little down) and feet
 * (on the sole's bottom: y = 0 is the floor while planted, so nothing goes below it).
 */
const DOWN: Vec3 = [180, 0, 0];

/** A knuckled fist (socket units): back of the hand, four knuckles, a thumb wrapped over. */
function fist(c: MonsterPartContext, w: number, color: 'secondary' | 'primary' | 'dark' = 'secondary'): void {
  lump(c, color, [0, -0.12 * w, 0.06 * w], [0.8 * w, 0.62 * w, 0.68 * w]);
  for (const [i, x] of [-0.27, -0.09, 0.09, 0.27].entries()) ball(c, color, [x * w, -0.36 * w, (0.3 - Math.abs(i - 1.5) * 0.03) * w], [0.22 * w, 0.2 * w, 0.22 * w]);
  ball(c, color, [0.36 * w, -0.16 * w, 0.24 * w], [0.2 * w, 0.32 * w, 0.2 * w], { rot: [30, 0, -20] });
}

export const HANDS = [
  part('hand.claws', 'Claws', ['hands'], ['beast', 'blood', 'undead', 'shadow', 'nature'], 1, [inc('crit.chance', 0.15), flat('chance.bleed', 0.1)], (c) => {
    box(c, 'secondary', [0, 0.02, 0.02], [0.62, 0.4, 0.46]);
    for (const x of [-0.24, 0, 0.24]) horn(c, 'bone', [x, -0.14, 0.12], 0.6, 0.2, -70, { rot: DOWN });
  }, { weight: 2 }),
  part('hand.fist', 'Great Fists', ['hands'], ['earth', 'construct', 'beast'], 1, [flat('knockback', 2), inc('damage', 0.08, ['melee'])], (c) => {
    fist(c, 1.08);
    // knuckle spikes and a cuff: a weapon, not a balloon
    for (const x of [-0.27, -0.09, 0.09, 0.27]) cone(c, 'bone', [x * 1.08, -0.5, 0.36], [0.1, 0.2, 0.1], { rot: [140, 0, 0] });
    cyl(c, 'dark', [0, 0.18, 0.02], [0.8, 0.16, 0.72]);
  }),
  /** The plans' default hands (cosmetic, never rolled). */
  part('hand.bare', 'Bare Hands', ['hands'], ['default'], 0, [], (c) => {
    box(c, 'secondary', [0, 0.02, 0.02], [0.6, 0.42, 0.44]);
    for (const x of [-0.2, 0, 0.2]) horn(c, 'bone', [x, -0.14, 0.1], 0.46, 0.16, -60, { rot: DOWN });
    horn(c, 'bone', [0.3, 0.0, 0.16], 0.3, 0.14, -40, { rot: [150, 0, -30] });
  }, { weight: 0 }),
  part('hand.knuckles', 'Knuckle Fists', ['hands'], ['default'], 0, [], (c) => fist(c, 0.92), { weight: 0 }),
  part('hand.pincers', 'Pincers', ['hands'], ['water', 'insect', 'earth'], 2, [flat('armour', 10), inc('damage', 0.1, ['melee'])], (c) => {
    ball(c, 'secondary', [0, -0.26, 0.1], [0.72, 0.72, 0.86]);
    horn(c, 'accent', [0, -0.5, 0.35], 1.3, 0.3, -80, { rot: [150, 0, 0] });
    horn(c, 'accent', [0, -0.6, 0.15], 1.0, 0.25, 60, { rot: [200, 0, 0] });
  }),
  part('hand.hooks', 'Scythe Arms', ['hands'], ['insect', 'shadow', 'void'], 2, [inc('attack.speed', 0.1), flat('chance.bleed', 0.15)], (c) => {
    slab(c, 'scythe', [[-0.12, 0], [0.12, 0], [0.2, -1.4], [0.0, -2.2], [-0.05, -1.3]], 0.1, 'accent', [0, -0.1, 0.1], [1, 1, 1], { rot: [-30, 90, 0] });
  }),
  part('hand.paws', 'Paws', ['hands'], ['beast', 'nature'], 0, [inc('move.speed', 0.04)], (c) => {
    lump(c, 'secondary', [0, -0.16, 0.08], [0.74, 0.56, 0.8]);
    for (const x of [-0.24, 0, 0.24]) cone(c, 'bone', [x, -0.36, 0.42], [0.14, 0.32, 0.14], { rot: [110, 0, 0] });
  }),
];

/** Point along the weapon's carry direction (forward and a little down). */
const D: Vec3 = [0, -0.34, 0.94];
const along = (t: number, off: Vec3 = [0, 0, 0]): Vec3 => [D[0] * t + off[0], D[1] * t + off[1], D[2] * t + off[2]];
const CARRY: Vec3 = [110, 0, 0];

export const WEAPONS = [
  part('weapon.club', 'Spiked Club', ['weapon'], ['beast', 'earth', 'blood', 'nature'], 1, [inc('damage', 0.15, ['melee']), flat('knockback', 1.5)], (c) => {
    taper(c, 1.6, 'dark', along(0.18), [0.045, 0.45, 0.045], { rot: CARRY });
    lump(c, 'secondary', along(0.42), [0.15, 0.2, 0.15], { rot: CARRY });
    for (const a of [0, 120, 240]) cone(c, 'accent', along(0.44, [Math.sin((a * Math.PI) / 180) * 0.07, 0, Math.cos((a * Math.PI) / 180) * 0.03]), [0.04, 0.09, 0.04], { rot: [0, 0, a - 90] });
  }),
  part('weapon.spear', 'Spear', ['weapon'], ['beast', 'water', 'storm', 'nature'], 1, [inc('damage', 0.1, ['melee']), flat('melee.range', 0.4)], (c) => {
    cyl(c, 'dark', along(0.22), [0.03, 1.1, 0.03], { rot: [100, 0, 0] });
    cone(c, 'accent', along(0.82), [0.07, 0.18, 0.04], { rot: [100, 0, 0] });
  }),
  part('weapon.staff', 'Staff', ['weapon'], ['arcane', 'fire', 'ice', 'storm', 'undead', 'void'], 1, [inc('damage', 0.15, ['spell']), inc('cast.speed', 0.1)], (c) => {
    cyl(c, 'dark', [0, 0.12, 0.02], [0.03, 0.95, 0.03]);
    ball(c, 'glow', [0, 0.62, 0.02], [0.1, 0.1, 0.1], { glow: true });
    for (const a of [0, 120, 240]) cone(c, 'accent', [Math.sin((a * Math.PI) / 180) * 0.05, 0.62, 0.02 + Math.cos((a * Math.PI) / 180) * 0.05], [0.03, 0.14, 0.03], { rot: [Math.cos((a * Math.PI) / 180) * 25, 0, -Math.sin((a * Math.PI) / 180) * 25] });
  }),
  part('weapon.axe', 'War Axe', ['weapon'], ['earth', 'blood', 'construct', 'ice'], 2, [inc('damage', 0.2, ['melee']), flat('chance.bleed', 0.1)], (c) => {
    cyl(c, 'dark', along(0.25), [0.035, 0.6, 0.035], { rot: CARRY });
    slab(c, 'axe', [[0, -0.1], [0.12, -0.16], [0.16, 0], [0.12, 0.16], [0, 0.1]], 0.025, 'accent', along(0.5, [0, 0.1, 0]), [1, 1, 1], { rot: [20, 90, 0] });
  }),
  part('weapon.blade', 'Cleaver', ['weapon'], ['construct', 'blood', 'shadow', 'undead'], 2, [inc('damage', 0.15, ['melee']), inc('attack.speed', 0.05)], (c) => {
    cyl(c, 'dark', along(0.06), [0.03, 0.14, 0.03], { rot: CARRY });
    box(c, 'accent', along(0.13), [0.14, 0.025, 0.03], { rot: CARRY });
    box(c, 'secondary', along(0.42), [0.05, 0.55, 0.11], { rot: CARRY });
  }),
];

const len = (c: MonsterPartContext) => Number(c.socket.data?.length ?? c.size * 2) / c.size;

export const FEET = [
  part('foot.hooves', 'Hooves', ['feet'], ['beast', 'earth', 'fire', 'blood'], 0, [inc('move.speed', 0.05), flat('knockback', 0.5)], (c) => {
    // a cloven hoof under a fetlock tuft
    const L = len(c);
    pair((sx) => taper(c, 0.8, 'dark', [0.26 * sx, 0.24, L * 0.08], [0.6, 0.48, L * 0.9]));
    lump(c, 'secondary', [0, 0.58, -L * 0.05], [1.25, 0.34, L * 0.8]);
  }),
  /** Crawlers' default leg tips (cosmetic): a chitin claw at the end of every leg. */
  part('foot.tip', 'Leg Tips', ['feet'], ['default'], 0, [], (c) => {
    const L = len(c);
    cone(c, 'dark', [0, 0.6, L * 0.2], [0.9, 1.4, 0.9], { rot: [160, 0, 0] });
    cone(c, 'bone', [0, 0.25, L * 0.45], [0.4, 0.9, 0.4], { rot: [100, 0, 0] });
  }, { weight: 0 }),
  /** Birds' default feet (cosmetic): three toes forward, one back. */
  part('foot.bird', 'Bird Feet', ['feet'], ['default'], 0, [], (c) => {
    const L = len(c);
    for (const a of [-28, 0, 28]) taper(c, 0.3, 'accent', [Math.sin((a * Math.PI) / 180) * L * 0.4, 0.22, L * 0.25 + Math.cos((a * Math.PI) / 180) * L * 0.4], [0.24, L * 0.95, 0.2], { rot: [90, a, 0] });
    taper(c, 0.3, 'accent', [0, 0.22, -L * 0.3], [0.22, L * 0.6, 0.2], { rot: [-90, 0, 0] });
    for (const a of [-28, 0, 28]) cone(c, 'bone', [Math.sin((a * Math.PI) / 180) * L * 0.86, 0.14, L * 0.25 + Math.cos((a * Math.PI) / 180) * L * 0.86], [0.14, 0.28, 0.14], { rot: [100, a, 0] });
  }, { weight: 0 }),
  /** A beast's default paws (cosmetic, never rolled): a pad and three clawed toes. */
  part('foot.paw', 'Paws', ['feet'], ['default'], 0, [], (c) => {
    const L = len(c);
    lump(c, 'secondary', [0, 0.36, L * 0.2], [1.1, 0.72, L * 0.95]);
    for (const x of [-0.3, 0, 0.3]) {
      ball(c, 'secondary', [x, 0.26, L * 0.62], [0.34, 0.46, 0.4]);
      cone(c, 'bone', [x, 0.16, L * 0.62 + 0.26], [0.14, 0.28, 0.14], { rot: [100, 0, 0] });
    }
  }, { weight: 0 }),
  /** The plans' default feet (cosmetic, never rolled): toes with small claws. */
  part('foot.bare', 'Toes', ['feet'], ['default'], 0, [], (c) => {
    const L = len(c);
    for (const x of [-0.3, 0, 0.3]) {
      ball(c, 'secondary', [x, 0.3, L * 0.5], [0.34, 0.42, 0.44]);
      cone(c, 'bone', [x, 0.16, L * 0.5 + 0.28], [0.16, 0.3, 0.16], { rot: [90, 0, 0] });
    }
  }, { weight: 0 }),
  part('foot.talons', 'Talons', ['feet'], ['beast', 'storm', 'nature', 'undead'], 1, [inc('crit.chance', 0.05)], (c) => {
    const L = len(c);
    for (const x of [-0.35, 0, 0.35]) horn(c, 'bone', [x, 0.42, L * 0.42], 0.7, 0.22, 50, { rot: [90, 0, x * 40] });
    cone(c, 'bone', [0, 0.25, -L * 0.45], [0.25, 0.5, 0.25], { rot: [-100, 0, 0] });
  }),
  part('foot.claws', 'Clawed Feet', ['feet'], ['any'], 0, [inc('move.speed', 0.03)], (c) => {
    const L = len(c);
    for (const x of [-0.3, 0, 0.3]) {
      ball(c, 'secondary', [x, 0.3, L * 0.45], [0.34, 0.4, 0.46]);
      cone(c, 'bone', [x, 0.2, L * 0.55 + 0.3], [0.2, 0.5, 0.2], { rot: [90, 0, 0] });
    }
  }),
];

export const ORBS = [part('weapon.orb', 'Focus Orb', ['weapon'], ['arcane', 'void', 'crystal', 'ice'], 1, [inc('damage', 0.12, ['spell']), inc('projectile.speed', 0.15)], (c) => {
  ball(c, 'glow', [0, -0.05, 0.12], [0.12, 0.12, 0.12], { glow: true });
  cyl(c, 'accent', [0, -0.05, 0.12], [0.16, 0.02, 0.16], { rot: [70, 0, 0] });
})];
