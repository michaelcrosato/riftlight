import type { Vec3 } from '../../../engine/animation';
import { flat, inc } from '../../core/mods';
import type { MonsterPartContext } from '../types';
import { ball, box, cone, cyl, horn, lump, part, slab, taper } from './kit';

/**
 * Hands (left socket on the hand joint; −Y runs down the arm, +Z forward), weapons (right
 * hand; units = the monster's height, shaft carried forward and a little down) and feet
 * (on the sole's bottom: y = 0 is the floor while planted, so nothing goes below it).
 */
const DOWN: Vec3 = [180, 0, 0];

export const HANDS = [
  part('hand.claws', 'Claws', ['hands'], ['beast', 'blood', 'undead', 'shadow', 'nature'], 1, [inc('crit.chance', 0.15), flat('chance.bleed', 0.1)], (c) => {
    for (const x of [-0.25, 0, 0.25]) horn(c, 'accent', [x, -0.1, 0.12], 0.65, 0.22, -60, { rot: DOWN });
  }, { weight: 2 }),
  part('hand.fist', 'Great Fists', ['hands'], ['earth', 'construct', 'beast'], 1, [flat('knockback', 2), inc('damage', 0.08, ['melee'])], (c) => {
    lump(c, 'secondary', [0, -0.15, 0.05], [1.35, 1.15, 1.35]);
    box(c, 'accent', [0, -0.35, 0.45], [1.0, 0.25, 0.3]);
  }),
  part('hand.pincers', 'Pincers', ['hands'], ['water', 'insect', 'earth'], 2, [flat('armour', 10), inc('damage', 0.1, ['melee'])], (c) => {
    ball(c, 'secondary', [0, -0.3, 0.1], [1.0, 1.0, 1.2]);
    horn(c, 'accent', [0, -0.5, 0.35], 1.3, 0.3, -80, { rot: [150, 0, 0] });
    horn(c, 'accent', [0, -0.6, 0.15], 1.0, 0.25, 60, { rot: [200, 0, 0] });
  }),
  part('hand.hooks', 'Scythe Arms', ['hands'], ['insect', 'shadow', 'void'], 2, [inc('attack.speed', 0.1), flat('chance.bleed', 0.15)], (c) => {
    slab(c, 'scythe', [[-0.12, 0], [0.12, 0], [0.2, -1.4], [0.0, -2.2], [-0.05, -1.3]], 0.1, 'accent', [0, -0.1, 0.1], [1, 1, 1], { rot: [-30, 90, 0] });
  }),
  part('hand.paws', 'Paws', ['hands'], ['beast', 'nature'], 0, [inc('move.speed', 0.04)], (c) => {
    ball(c, 'primary', [0, -0.2, 0.1], [1.1, 0.9, 1.2]);
    for (const x of [-0.3, 0, 0.3]) cone(c, 'accent', [x, -0.45, 0.55], [0.18, 0.4, 0.18], { rot: [110, 0, 0] });
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
    box(c, 'dark', [0, 0.22, 0], [1.3, 0.45, len(c) * 1.05]);
    box(c, 'accent', [0, 0.47, 0], [1.2, 0.08, len(c) * 0.95]);
  }),
  part('foot.talons', 'Talons', ['feet'], ['beast', 'storm', 'nature', 'undead'], 1, [inc('crit.chance', 0.05)], (c) => {
    const L = len(c);
    for (const x of [-0.35, 0, 0.35]) horn(c, 'accent', [x, 0.42, L * 0.42], 0.7, 0.22, 50, { rot: [90, 0, x * 40] });
    cone(c, 'accent', [0, 0.25, -L * 0.45], [0.25, 0.5, 0.25], { rot: [-100, 0, 0] });
  }),
  part('foot.claws', 'Clawed Feet', ['feet'], ['any'], 0, [inc('move.speed', 0.03)], (c) => {
    const L = len(c);
    for (const x of [-0.3, 0, 0.3]) cone(c, 'accent', [x, 0.18, L * 0.55], [0.22, 0.45, 0.22], { rot: [90, 0, 0] });
  }),
];

export const ORBS = [part('weapon.orb', 'Focus Orb', ['weapon'], ['arcane', 'void', 'crystal', 'ice'], 1, [inc('damage', 0.12, ['spell']), inc('projectile.speed', 0.15)], (c) => {
  ball(c, 'glow', [0, -0.05, 0.12], [0.12, 0.12, 0.12], { glow: true });
  cyl(c, 'accent', [0, -0.05, 0.12], [0.16, 0.02, 0.16], { rot: [70, 0, 0] });
})];
