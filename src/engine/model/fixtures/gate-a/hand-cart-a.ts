import type { Kit } from '../../../../riftlight/town/kit';

/**
 * A two-wheeled hand cart: an open plank bed balanced over one axle, two big iron-tyred
 * spoked wheels, two shafts running forward (+Z) to a cross handle, and a prop leg pair at
 * the front so it rests level.
 */
export function build(kit: Kit): void {
  const R = 0.5; // wheel radius (axle height)
  const wheelX = 0.6;
  const bedW = 0.96; // outer width (X)
  const bedZ0 = -0.8; // rear edge
  const bedZ1 = 0.5; // front edge
  const bedL = bedZ1 - bedZ0;
  const bedCz = (bedZ0 + bedZ1) / 2;
  const floorY = 0.62; // top of the bed floor
  const sideH = 0.3;

  // --- chassis: two long rails that become the shafts, plus cross bearers
  const railX = 0.36;
  const railY = floorY - 0.1;
  const shaftEnd = 1.45;
  for (const s of [1, -1]) {
    const len = shaftEnd - bedZ0;
    kit.box([0.08, 0.09, len], 'red', [s * railX, railY, bedZ0 + len / 2]);
  }
  // cross handle joining the shaft ends
  kit.cyl(0.04, 0.04, railX * 2 + 0.22, 6, 'red', [0, railY + 0.01, shaftEnd - 0.04], { rot: [0, 0, 90] });

  // --- axle under the bed
  const axleZ = -0.14;
  kit.box([bedW - 0.1, 0.08, 0.12], 'night', [0, R + 0.0, axleZ]);
  kit.cyl(0.035, 0.035, wheelX * 2 + 0.14, 6, 'night', [0, R, axleZ], { rot: [0, 0, 90] });

  // --- bed floor (light planks seen from above)
  kit.box([bedW, 0.06, bedL], 'orange', [0, floorY - 0.03, bedCz], { top: 'sand' });
  for (const x of [-0.14, 0.14]) kit.box([0.025, 0.01, bedL - 0.1], 'orange', [x, floorY + 0.004, bedCz]);

  // --- side boards
  const boardT = 0.06;
  for (const s of [1, -1]) {
    kit.box([boardT, sideH, bedL], 'orange', [s * (bedW / 2 - boardT / 2), floorY + sideH / 2, bedCz], { top: 'sand' });
    // plank seam
    kit.box([boardT + 0.02, 0.03, bedL - 0.04], 'red', [s * (bedW / 2 - boardT / 2), floorY + sideH * 0.5, bedCz]);
  }
  // front board and tailgate
  for (const z of [bedZ1 - boardT / 2, bedZ0 + boardT / 2]) {
    kit.box([bedW - boardT * 2, sideH, boardT], 'orange', [0, floorY + sideH / 2, z], { top: 'sand' });
    kit.box([bedW - boardT * 2, 0.03, boardT + 0.02], 'red', [0, floorY + sideH * 0.5, z]);
  }
  // iron corner straps
  for (const sx of [1, -1])
    for (const z of [bedZ0 + 0.03, bedZ1 - 0.03]) {
      kit.box([0.08, sideH + 0.02, 0.08], 'night', [sx * (bedW / 2 - 0.03), floorY + sideH / 2, z]);
    }

  // --- front prop legs (so the cart rests level)
  const legZ = bedZ1 - 0.08;
  for (const s of [1, -1]) {
    kit.box([0.07, railY, 0.07], 'red', [s * railX, railY / 2, legZ]);
  }

  // --- wheels: iron tyre over a wooden felloe, spokes, hub
  const N = 16;
  const ring = (r: number, t: number, w: number, color: 'slate' | 'orange', x: number) => {
    const seg = 2 * r * Math.sin(Math.PI / N) * 1.12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 360;
      const ang = (a * Math.PI) / 180;
      kit.box([w, t, seg], color, [x, R + r * Math.cos(ang), axleZ + r * Math.sin(ang)], { rot: [a, 0, 0] });
    }
  };
  for (const s of [1, -1]) {
    const x = s * wheelX;
    ring(R - 0.02, 0.04, 0.09, 'slate', x);
    ring(R - 0.075, 0.07, 0.07, 'orange', x);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 360 + 22.5;
      const ang = (a * Math.PI) / 180;
      const rr = (R - 0.1) / 2;
      kit.box([0.04, R - 0.1, 0.05], 'orange', [x, R + rr * Math.cos(ang), axleZ + rr * Math.sin(ang)], { rot: [a, 0, 0] });
    }
    kit.cyl(0.1, 0.1, 0.15, 8, 'night', [x, R, axleZ], { rot: [0, 0, 90] });
  }

  kit.blockBox(0, (bedZ0 + shaftEnd) / 2, wheelX * 2 + 0.2, shaftEnd - bedZ0);
}
