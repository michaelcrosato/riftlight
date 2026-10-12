import type { Kit } from '../../../src/riftlight/town/kit';

/**
 * A campfire ring: a pit of ash and glowing coals inside a ring of rough stones, star-laid
 * firewood under a cluster of flame tongues, two log seats (back and left) and a small
 * stack of firewood to the right; the front (+Z) is left open.
 */
export function build(kit: Kit): void {
  const DEG = 180 / Math.PI;

  // Pit: a charred ash ring around a bed of glowing coals, with embers on it.
  kit.disc(0.56, 12, 'night', [0, 0.02, 0]);
  kit.disc(0.44, 10, 'ink', [0, 0.035, 0]);
  kit.disc(0.3, 10, 'red', [0, 0.05, 0], { receive: false });
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.2;
    const r = 0.2 + (i % 3) * 0.05;
    kit.box([0.08, 0.05, 0.08], i % 2 ? 'orange' : 'sand', [Math.cos(a) * r, 0.065, Math.sin(a) * r], {
      rot: [0, i * 29, 0],
      cast: false,
      receive: false,
    });
  }

  // Stone ring: chunky, slightly tipped boulders, nearly touching, slate and mist.
  const STONES = 12;
  const R = 0.68;
  for (let i = 0; i < STONES; i++) {
    const a = (i / STONES) * Math.PI * 2 + 0.1;
    const big = i % 3 !== 1;
    const r0 = big ? 0.17 : 0.14;
    const h = big ? 0.24 : 0.18;
    const tip = ((i * 37) % 11) - 5;
    kit.cyl(r0 * 0.78, r0, h, 6, i % 2 ? 'slate' : 'mist', [Math.cos(a) * R, h / 2 - 0.01, Math.sin(a) * R], {
      rot: [tip, -a * DEG + i * 23, -tip],
    });
  }

  // Firewood: stout logs laid like a star, outer cut ends pale, inner ends under the flames.
  const LOGS = 5;
  const L = 0.42;
  const lean = 74; // degrees from vertical
  for (let i = 0; i < LOGS; i++) {
    const a = (i / LOGS) * Math.PI * 2 + 0.16;
    const t = lean / DEG;
    const ax = -Math.sin(t) * Math.cos(a);
    const ay = Math.cos(t);
    const az = -Math.sin(t) * Math.sin(a);
    const baseR = 0.5;
    const bx = Math.cos(a) * baseR;
    const bz = Math.sin(a) * baseR;
    const c: [number, number, number] = [bx + (ax * L) / 2, 0.08 + (ay * L) / 2, bz + (az * L) / 2];
    kit.cyl(0.07, 0.08, L, 6, 'plum', c, { rot: [0, -a * DEG, lean] });
    kit.cyl(0.065, 0.065, 0.02, 6, 'sand', [bx - ax * 0.005, 0.08 - ay * 0.005, bz - az * 0.005], { rot: [0, -a * DEG, lean] });
  }

  // Flames: a few chunky tongues of different heights, splayed slightly outward so their
  // tips part: tall orange ones, a red one at the back, a sand one low at the front.
  const glow = { cast: false, receive: false };
  const SPLAY = 12 / DEG;
  for (const [x, z, r, h, c] of [
    [-0.02, -0.06, 0.24, 1.0, 'orange'],
    [0.16, -0.12, 0.18, 0.7, 'red'],
    [-0.18, -0.02, 0.2, 0.78, 'orange'],
    [0.16, 0.1, 0.19, 0.62, 'orange'],
    [-0.08, 0.16, 0.19, 0.55, 'sand'],
  ] as const) {
    const a = Math.atan2(z, x);
    const shift = Math.sin(SPLAY) * (h / 2);
    kit.cone(r, h, 6, c, [x + Math.cos(a) * shift, 0.05 + (Math.cos(SPLAY) * h) / 2, z + Math.sin(a) * shift], {
      ...glow,
      rot: [0, -a * DEG, -SPLAY * DEG],
    });
  }

  // Log seats behind and to the left of the fire (front-right left open), cut ends in sand.
  const SEAT_R = 0.2;
  const SEAT_L = 1.2;
  for (const [x, z, yaw] of [
    [0.1, -1.5, 0],
    [-1.5, 0.1, 90],
  ] as const) {
    kit.frame(x, z, yaw, () => {
      kit.cyl(SEAT_R, SEAT_R, SEAT_L, 8, 'plum', [0, SEAT_R, 0], { rot: [0, 0, 90] });
      for (const e of [-1, 1]) {
        kit.cyl(SEAT_R - 0.035, SEAT_R - 0.035, 0.02, 8, 'sand', [e * (SEAT_L / 2 + 0.005), SEAT_R, 0], { rot: [0, 0, 90] });
      }
      kit.blockBox(0, 0, SEAT_L, SEAT_R * 2);
    });
  }

  // A small stack of split firewood to the right, cut ends to the front.
  kit.frame(1.3, -0.3, 0, () => {
    const r = 0.1;
    const len = 0.62;
    for (const [x, y] of [
      [-0.105, r],
      [0.105, r],
      [0, r + 0.175],
    ] as const) {
      kit.cyl(r, r, len, 7, 'plum', [x, y, 0], { rot: [90, 0, 0] });
      for (const e of [-1, 1]) kit.cyl(r - 0.025, r - 0.025, 0.02, 7, 'sand', [x, y, e * (len / 2 + 0.005)], { rot: [90, 0, 0] });
    }
    kit.blockBox(0, 0, 0.42, len);
  });

  kit.blockCircle(0, 0, R + 0.14);
}
