import { ball, box, cone, cyl, lump, pair, part, slab } from './kit';

/**
 * Archetype marks: cosmetic parts (no mods, no cost, never rolled) that `ARCHETYPE_LOOKS`
 * (looks.ts) puts on a body so its behaviour reads from its shape: the bomber's glowing sac,
 * the tank's plates, the caster's rune, the charger's ram brow. A mark only goes on a slot
 * the genome left empty, so it never fights the monster's own parts. Socket spaces are the
 * slots' (back: +Y out of the body, Z along the spine; core: on the chest, +Z forward;
 * helm: on the crown of the head).
 */
const MARK = ['mark'];
const W = { weight: 0 };

export const MARKS = [
  part('mark.ram', 'Ram Brow', ['helm'], MARK, 0, [], (c) => {
    box(c, 'bone', [0, -0.08, 0.26], [0.62, 0.14, 0.34], { rot: [-34, 0, 0] });
    pair((sx) => cone(c, 'bone', [0.24 * sx, -0.06, 0.36], [0.12, 0.26, 0.12], { rot: [62, 0, -12 * sx] }));
  }, W),

  part('mark.rune', 'Rune Sigil', ['core'], MARK, 0, [], (c) => {
    cyl(c, 'dark', [0, 0, 0.02], [1.2, 0.12, 1.2], { rot: [90, 0, 0] });
    box(c, 'glow', [0, 0, 0.1], [0.7, 0.14, 0.06], { glow: true, rot: [0, 0, 45] });
    box(c, 'glow', [0, 0, 0.1], [0.7, 0.14, 0.06], { glow: true, rot: [0, 0, -45] });
    ball(c, 'glow', [0, 0, 0.12], [0.3, 0.3, 0.12], { glow: true });
  }, W),

  part('mark.motes', 'Summoning Motes', ['helm'], MARK, 0, [], (c) => {
    for (const [x, y, z, s] of [[0.42, 0.34, 0.08, 0.13], [-0.42, 0.42, -0.04, 0.11], [0, 0.62, -0.3, 0.12], [0.18, 0.7, 0.24, 0.08]] as const) ball(c, 'glow', [x, y, z], [s, s, s], { glow: true });
    cyl(c, 'glow', [0, 0.38, 0], [0.9, 0.025, 0.9], { glow: true, rot: [8, 0, 6] });
  }, W),

  part('mark.sac', 'Volatile Sac', ['core'], MARK, 0, [], (c) => {
    ball(c, 'glow', [0, -0.15, 0.32], [1.5, 1.35, 1.2], { glow: true });
    for (const a of [-40, 0, 40]) cyl(c, 'dark', [0, -0.15, 0.32], [1.56, 0.08, 1.26], { rot: [0, a, 90] });
    cyl(c, 'dark', [0, -0.15, 0.32], [1.56, 0.08, 1.26]);
  }, W),

  part('mark.plates', 'Armour Plates', ['back'], MARK, 0, [], (c) => {
    [-0.3, 0, 0.3].forEach((z, i) => {
      lump(c, 'dark', [0, 0.1 - i * 0.02, z], [0.7 - i * 0.08, 0.16, 0.36], { rot: [-12, 0, 0] });
      pair((sx) => ball(c, 'bone', [(0.3 - i * 0.04) * sx, 0.16 - i * 0.02, z + 0.06], [0.06, 0.06, 0.06]));
    });
  }, W),

  part('mark.quills', 'Quills', ['back'], MARK, 0, [], (c) => {
    for (const [x, z, a] of [[0, -0.1, -40], [0.14, 0.05, -50], [-0.14, 0.05, -50], [0.08, 0.2, -58], [-0.08, 0.2, -58], [0, 0.32, -64]] as const)
      cone(c, x === 0 ? 'bone' : 'dark', [x, 0.2, z], [0.06, 0.62, 0.06], { rot: [a, 0, -x * 80] });
  }, W),

  part('mark.fins', 'Blade Fins', ['back'], MARK, 0, [], (c) => {
    pair((sx) => slab(c, 'fin', [[0, 0], [0.4, 0], [0.1, 0.42]], 0.04, 'secondary', [0.1 * sx, 0.05, 0.1], [1, 1, 1], { rot: [0, -90, 24 * sx] }));
  }, W),

  part('mark.spines', 'Spine Ridge', ['back'], MARK, 0, [], (c) => {
    for (let i = 0; i < 5; i++) cone(c, 'bone', [0, 0.08, 0.36 - i * 0.18], [0.1, 0.24 + (i === 1 || i === 2 ? 0.08 : 0), 0.14], { rot: [-30, 0, 0] });
  }, W),

  part('mark.obelisk', 'Runestones', ['back'], MARK, 0, [], (c) => {
    cone(c, 'dark', [0, 0.36, 0], [0.26, 0.8, 0.26]);
    box(c, 'glow', [0, 0.36, 0.06], [0.06, 0.4, 0.02], { glow: true });
    pair((sx) => {
      cone(c, 'dark', [0.2 * sx, 0.22, -0.12], [0.18, 0.5, 0.18], { rot: [0, 0, -20 * sx] });
      ball(c, 'glow', [0.2 * sx, 0.24, -0.04], [0.08, 0.08, 0.04], { glow: true });
    });
  }, W),
];
