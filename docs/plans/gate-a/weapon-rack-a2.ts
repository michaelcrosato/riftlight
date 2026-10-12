import type { Kit } from '../../../src/riftlight/town/kit';

type P = [number, number, number];

/**
 * A wooden weapon rack holding three weapons: a sword (hilt up), a spear and a
 * double-bitted axe. Their butts stand in a trough at the bottom and they lean back
 * against a notched top rail, heads standing clear above it. Proportions are chunky on
 * purpose: at game scale a metre is under 20 pixels, so anything thinner than ~0.1 m
 * turns into outline. Origin at the centre of the footprint, floor y = 0, front +Z.
 */
export function build(kit: Kit): void {
  const px = 1.05; // post centre x
  const railY = 0.9; // top rail height
  const railZ = -0.18;

  // --- frame ---------------------------------------------------------------
  for (const sx of [-1, 1]) {
    // sled foot (front to back), upright, cap
    kit.box([0.18, 0.12, 0.8], 'plum', [sx * px, 0.06, -0.02], { top: 'red' });
    kit.box([0.16, 0.92, 0.16], 'red', [sx * px, 0.12 + 0.46, railZ]);
    kit.box([0.24, 0.1, 0.24], 'plum', [sx * px, 1.09, railZ]);
  }
  // top rail with notch pegs in front (each weapon sits between two pegs)
  kit.box([2 * px + 0.04, 0.14, 0.14], 'red', [0, railY, railZ], { top: 'orange' });
  for (const x of [-0.82, -0.38, -0.16, 0.16, 0.38, 0.82]) {
    kit.box([0.07, 0.12, 0.14], 'plum', [x, railY, railZ + 0.13], { top: 'red' });
  }
  // bottom trough: a box with a dark slot in the top
  kit.box([2 * px + 0.04, 0.2, 0.4], 'orange', [0, 0.22, 0.04], { top: 'sand' });
  kit.box([2 * px - 0.24, 0.04, 0.22], 'ink', [0, 0.32, 0.06]);

  // --- weapons: each leans back from its butt in the trough onto the top rail ------
  const butt = { y: 0.3, z: 0.12 };
  const lean = Math.atan2(butt.z - (railZ + 0.14), railY - butt.y); // top towards -Z
  const rot: P = [(-lean * 180) / Math.PI, 0, 0];
  const along = (x: number, s: number): P => [x, butt.y + s * Math.cos(lean), butt.z - s * Math.sin(lean)];

  // sword (left), point down in the trough, cross-hilt up
  {
    const x = -0.6;
    kit.box([0.2, 1.2, 0.06], 'white', along(x, 0.6), { rot });
    kit.box([0.06, 1.1, 0.08], 'mist', along(x, 0.62), { rot });
    kit.box([0.56, 0.1, 0.12], 'sand', along(x, 1.24), { rot });
    kit.box([0.1, 0.3, 0.1], 'plum', along(x, 1.44), { rot });
    kit.box([0.16, 0.14, 0.16], 'sand', along(x, 1.64), { rot });
  }

  // spear (middle), the tallest, with a broad leaf head
  {
    const x = 0;
    kit.cyl(0.065, 0.065, 1.8, 6, 'sand', along(x, 0.9), { rot });
    kit.cyl(0.08, 0.08, 0.1, 6, 'red', along(x, 1.7), { rot });
    kit.cyl(0.08, 0.06, 0.12, 6, 'slate', along(x, 1.84), { rot });
    // leaf-shaped head: two four-sided pyramids base to base
    kit.cone(0.17, 0.48, 4, 'white', along(x, 2.16), { rot: [rot[0], 45, 0] });
    kit.cone(0.17, 0.14, 4, 'mist', along(x, 1.85), { rot: [rot[0] + 180, 45, 0] });
  }

  // double-bitted axe (right)
  {
    const x = 0.6;
    const s = 1.4;
    kit.cyl(0.06, 0.06, s + 0.18, 6, 'orange', along(x, (s + 0.18) / 2), { rot });
    kit.cyl(0.075, 0.075, 0.24, 6, 'plum', along(x, 0.22), { rot });
    const c = along(x, s);
    kit.box([0.16, 0.26, 0.16], 'slate', c, { rot });
    // each bit: a triangular prism flaring from the haft to a steel edge
    const r = 0.22;
    for (const sx of [-1, 1]) {
      kit.cyl(r, r, 0.08, 3, 'mist', [x + sx * (r + 0.04), c[1], c[2]], { rot: [90 + rot[0], sx > 0 ? 30 : 90, 0] });
      kit.box([0.07, 1.8 * r, 0.1], 'white', [x + sx * (1.5 * r + 0.04), c[1], c[2]], { rot });
    }
  }

  kit.blockBox(0, -0.02, 2 * px + 0.24, 0.8);
}
