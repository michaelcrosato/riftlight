import type { Kit } from '../../../src/riftlight/town/kit';

/**
 * A two-wheeled hand cart: an open plank bed on one axle between two big spoked wheels,
 * two shafts reaching forward (+Z) to a cross grip, and a prop stand under the front so it
 * rests level.
 */
export function build(kit: Kit): void {
  const R = 0.44; // wheel radius
  const WX = 0.64; // wheel centre x
  const WY = R; // wheel centre height (axle)

  // --- wheels ---
  for (const s of [1, -1]) {
    const x = s * WX;
    const N = 12;
    const rimMid = R - 0.04;
    const seg = 2 * R * Math.sin(Math.PI / N) * 1.08;
    for (let i = 0; i < N; i++) {
      const a = (i * 360) / N;
      const t = (a * Math.PI) / 180;
      // iron tyre (outer) and wooden felloe (inner)
      kit.box([0.1, 0.06, seg], 'night', [x, WY + rimMid * Math.cos(t), rimMid * Math.sin(t)], { rot: [a, 0, 0] });
      kit.box([0.08, 0.07, seg * 0.86], 'orange', [x, WY + (rimMid - 0.06) * Math.cos(t), (rimMid - 0.06) * Math.sin(t)], { rot: [a, 0, 0] });
    }
    // spokes
    for (let k = 0; k < 4; k++) {
      kit.box([0.05, 2 * (R - 0.08), 0.05], 'orange', [x, WY, 0], { rot: [k * 45, 0, 0] });
    }
    // hub
    kit.cyl(0.09, 0.09, 0.16, 8, 'plum', [x, WY, 0], { rot: [0, 0, 90] });
    kit.cyl(0.04, 0.04, 0.2, 6, 'slate', [x + s * 0.02, WY, 0], { rot: [0, 0, 90] });
  }

  // axle
  kit.cyl(0.04, 0.04, 2 * WX, 6, 'slate', [0, WY, 0], { rot: [0, 0, 90] });

  // --- bed ---
  const BW = 1.0; // bed width (x)
  const BD = 1.3; // bed depth (z)
  const BZ = -0.05; // bed centre z
  const floorY = 0.54;
  // axle blocks under the bed
  for (const s of [1, -1]) kit.box([0.1, 0.08, 0.16], 'plum', [s * 0.4, WY + 0.06, 0]);
  // floor
  kit.box([BW, 0.06, BD], 'orange', [0, floorY, BZ], { top: 'red' });
  // plank seams
  for (const x of [-0.16, 0.16]) kit.box([0.05, 0.01, BD - 0.1], 'plum', [x, floorY + 0.03, BZ]);
  // long frame beams under the floor
  for (const s of [1, -1]) kit.box([0.08, 0.08, BD + 0.1], 'plum', [s * 0.36, floorY - 0.06, BZ]);

  const sideH = 0.34;
  const sideY = floorY + 0.03 + sideH / 2;
  // side boards
  for (const s of [1, -1]) {
    kit.box([0.06, sideH, BD], 'orange', [s * (BW / 2 - 0.03), sideY, BZ], { top: 'sand' });
  }
  // back and front boards
  kit.box([BW - 0.12, sideH, 0.06], 'orange', [0, sideY, BZ - BD / 2 + 0.03], { top: 'sand' });
  kit.box([BW - 0.12, sideH * 0.8, 0.06], 'orange', [0, sideY - sideH * 0.1, BZ + BD / 2 - 0.03], { top: 'sand' });
  // corner posts
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      kit.box([0.08, sideH + 0.08, 0.08], 'plum', [sx * (BW / 2 - 0.02), sideY + 0.02, BZ + sz * (BD / 2 - 0.02)]);
    }
  }
  // iron straps around the bed sides
  for (const s of [1, -1]) {
    kit.box([0.07, 0.05, BD + 0.02], 'night', [s * (BW / 2 - 0.03), sideY - 0.04, BZ]);
  }

  // --- shafts and grip (towards +Z, the puller's side) ---
  const front = BZ + BD / 2;
  const shaftLen = 1.0;
  const hx = 0.34;
  for (const s of [1, -1]) {
    kit.box([0.08, 0.08, shaftLen + 0.4], 'orange', [s * hx, floorY - 0.06, front + shaftLen / 2 - 0.2]);
  }
  kit.cyl(0.04, 0.04, 2 * hx + 0.2, 6, 'sand', [0, floorY - 0.06, front + shaftLen - 0.04], { rot: [0, 0, 90] });

  // --- prop stand under the front ---
  for (const s of [1, -1]) {
    kit.box([0.07, floorY - 0.1, 0.07], 'plum', [s * hx, (floorY - 0.1) / 2, front - 0.08]);
  }
  kit.box([2 * hx, 0.05, 0.05], 'plum', [0, 0.2, front - 0.08]);

  kit.blockBox(0, BZ + 0.3, 2 * WX + 0.1, BD + shaftLen);
}
