import type { Kit } from '../../../../riftlight/town/kit';

/**
 * A two-wheeled hand cart: an open plank bed on an iron-tyred, spoked wheel pair, two long
 * shafts running out to the front (+Z) joined by a grip bar, and a prop leg under the shafts
 * so it stands level when parked.
 */
export function build(kit: Kit): void {
  const R = 0.53; // wheel radius
  const AXLE_Y = R;
  const WHEEL_X = 0.6;
  const BED_W = 0.92;
  const BED_L = 1.3;
  const BED_Z = -0.1; // bed centre (wheels sit a little forward of it, under the load)
  const FLOOR_Y = 0.64;
  const SIDE_H = 0.32;

  // --- wheels: iron tyre ring, wooden spokes, hub ---
  const N = 14;
  const ringR = R - 0.035;
  const seg = 2 * ringR * Math.sin(Math.PI / N) + 0.03;
  for (const sx of [1, -1]) {
    const x = sx * WHEEL_X;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * 360;
      const a = (t * Math.PI) / 180;
      kit.box([0.08, 0.07, seg], 'night', [x, AXLE_Y + ringR * Math.cos(a), ringR * Math.sin(a)], { rot: [t, 0, 0] });
    }
    for (let i = 0; i < 4; i++) {
      kit.box([0.05, 2 * ringR, 0.05], 'sand', [x, AXLE_Y, 0], { rot: [i * 45 + 22.5, 0, 0] });
    }
    kit.cyl(0.09, 0.09, 0.16, 8, 'slate', [x, AXLE_Y, 0], { rot: [0, 0, 90] });
  }
  // axle
  kit.cyl(0.035, 0.035, 2 * WHEEL_X + 0.1, 6, 'ink', [0, AXLE_Y, 0], { rot: [0, 0, 90] });
  // axle blocks under the bed
  const blockBot = AXLE_Y - 0.05;
  const blockTop = FLOOR_Y - 0.035;
  for (const sx of [1, -1]) kit.box([0.1, blockTop - blockBot, 0.18], 'plum', [sx * 0.32, (blockTop + blockBot) / 2, 0]);

  // --- shafts: run under the bed and out the front as handles ---
  const SHAFT_X = 0.3;
  const shaftBack = BED_Z - BED_L / 2 - 0.05;
  const shaftFront = 1.55;
  const shaftLen = shaftFront - shaftBack;
  for (const sx of [1, -1]) {
    kit.box([0.1, 0.1, shaftLen], 'orange', [sx * SHAFT_X, FLOOR_Y - 0.08, shaftBack + shaftLen / 2], { top: 'sand' });
  }
  // grip bar across the handle ends
  kit.cyl(0.05, 0.05, 2 * SHAFT_X + 0.2, 6, 'sand', [0, FLOOR_Y - 0.08, shaftFront - 0.1], { rot: [0, 0, 90] });

  // prop leg under the shafts (A-frame stand)
  const LEG_Z = 0.85;
  for (const sx of [1, -1]) {
    kit.box([0.07, FLOOR_Y - 0.08, 0.07], 'plum', [sx * SHAFT_X, (FLOOR_Y - 0.12) / 2, LEG_Z]);
  }
  kit.box([2 * SHAFT_X, 0.05, 0.05], 'plum', [0, 0.18, LEG_Z]);

  // --- bed ---
  kit.box([BED_W, 0.06, BED_L], 'orange', [0, FLOOR_Y, BED_Z]);
  // floor plank seams
  for (const x of [-0.21, 0, 0.21]) kit.box([0.04, 0.01, BED_L - 0.1], 'red', [x, FLOOR_Y + 0.032, BED_Z]);
  const sideY = FLOOR_Y + 0.03 + SIDE_H / 2;
  // long sides
  for (const sx of [1, -1]) {
    kit.box([0.05, SIDE_H, BED_L], 'orange', [sx * (BED_W / 2 - 0.025), sideY, BED_Z]);
  }
  // front and back boards
  for (const sz of [1, -1]) {
    kit.box([BED_W, SIDE_H, 0.05], 'orange', [0, sideY, BED_Z + sz * (BED_L / 2 - 0.025)]);
  }
  // plank seam on every side
  const seamY = FLOOR_Y + 0.03 + SIDE_H * 0.5;
  for (const sx of [1, -1]) kit.box([0.02, 0.035, BED_L - 0.02], 'red', [sx * (BED_W / 2 + 0.005), seamY, BED_Z]);
  for (const sz of [1, -1]) kit.box([BED_W - 0.02, 0.035, 0.02], 'red', [0, seamY, BED_Z + sz * (BED_L / 2 + 0.005)]);
  // top rails
  const railY = FLOOR_Y + 0.03 + SIDE_H + 0.02;
  for (const sx of [1, -1]) kit.box([0.08, 0.04, BED_L + 0.04], 'sand', [sx * (BED_W / 2 - 0.025), railY, BED_Z]);
  for (const sz of [1, -1]) kit.box([BED_W + 0.04, 0.04, 0.08], 'sand', [0, railY, BED_Z + sz * (BED_L / 2 - 0.025)]);
  // corner and middle stakes
  for (const sx of [1, -1]) {
    for (const z of [-BED_L / 2, 0, BED_L / 2]) {
      kit.box([0.07, SIDE_H + 0.06, 0.07], 'plum', [sx * (BED_W / 2 + 0.005), sideY + 0.01, BED_Z + z * (z === 0 ? 1 : 0.97)]);
    }
  }

  kit.blockBox(0, 0.2, 2 * WHEEL_X + 0.1, 2.0);
}
