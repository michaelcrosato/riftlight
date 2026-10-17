import type { Kit } from '../../../../riftlight/town/kit';

/**
 * A stone archway: two block-coursed piers on plinths, impost caps, a semicircular ring of
 * voussoirs with a proud keystone, and a flagstone threshold. Walk-through along Z.
 */
export function build(kit: Kit): void {
  const span = 2.3; // clear opening
  const pier = 0.62; // pier width (x)
  const depth = 0.8; // wall depth (z)
  const spring = 2.0; // springing line (top of impost)
  const rIn = span / 2;
  const ring = 0.5; // voussoir depth (radial)
  const rOut = rIn + ring;
  const px = rIn + pier / 2; // pier centre x

  // threshold flagstones between the piers
  kit.box([span, 0.06, depth], 'slate', [0, 0.03, 0], { cast: false });

  for (const s of [-1, 1]) {
    const x = s * px;
    // plinth
    kit.box([pier + 0.2, 0.3, depth + 0.2], 'slate', [x, 0.15, 0], { top: 'mist' });
    // coursed pier: block courses, alternately proud in x and in z (quoins)
    const courses = 4;
    const y0 = 0.3;
    const y1 = spring - 0.22;
    const h = (y1 - y0) / courses;
    for (let i = 0; i < courses; i++) {
      const wide = i % 2 === 0;
      kit.box([pier + (wide ? 0.06 : -0.02), h - 0.04, depth + (wide ? -0.02 : 0.06)], 'mist', [x, y0 + h * (i + 0.5), 0]);
    }
    // mortar core so the joints read dark
    kit.box([pier - 0.06, y1 - y0, depth - 0.06], 'night', [x, (y0 + y1) / 2, 0]);
    // impost cap
    kit.box([pier + 0.18, 0.22, depth + 0.18], 'slate', [x, spring - 0.11, 0], { top: 'mist' });
    kit.blockBox(x, 0, pier + 0.2, depth + 0.2);
  }

  // voussoir ring (semicircle) with a keystone on top
  const n = 11;
  const rMid = (rIn + rOut) / 2;
  const step = Math.PI / n;
  const deg = 180 / Math.PI;
  for (let i = 0; i < n; i++) {
    const a = step * (i + 0.5);
    const key = i === (n - 1) / 2;
    const chord = 2 * rOut * Math.sin(step / 2) - 0.05;
    if (key) {
      kit.box([ring + 0.2, chord + 0.08, depth + 0.12], 'slate', [Math.cos(a) * (rMid + 0.1), spring + Math.sin(a) * (rMid + 0.1), 0], { rot: [0, 0, a * deg], top: 'mist' });
    } else {
      kit.box([ring, chord, depth], 'mist', [Math.cos(a) * rMid, spring + Math.sin(a) * rMid, 0], { rot: [0, 0, a * deg] });
    }
    // dark backing so the joints between voussoirs read as mortar
    kit.box([ring - 0.04, 2 * rMid * Math.sin(step / 2) + 0.03, depth - 0.06], 'night', [Math.cos(a) * rMid, spring + Math.sin(a) * rMid, 0], { rot: [0, 0, a * deg] });
  }
}
