import type { Kit } from '../../../src/riftlight/town/kit';

/**
 * A stone archway: two coursed piers on plinths, impost caps, a ring of voussoirs
 * (alternating depth so each stone reads) and a proud keystone. Front faces +Z.
 */
export function build(kit: Kit): void {
  const pierX = 1.1; // pier centre
  const pierW = 0.6;
  const pierD = 0.8;
  const spring = 2.0; // springing line (arch centre height)
  const rIn = pierX - pierW / 2; // 0.8: opening half-width
  const rOut = pierX + pierW / 2; // 1.4
  const n = 9;

  for (const s of [-1, 1]) {
    const x = s * pierX;
    // plinth
    kit.box([pierW + 0.2, 0.3, pierD + 0.2], 'night', [x, 0.15, 0], { top: 'slate' });
    // coursed shaft: four courses, alternate slight offsets
    const courses = 4;
    const y0 = 0.3;
    const h = (spring - 0.15 - y0) / courses;
    for (let i = 0; i < courses; i++) {
      const wide = i % 2 === 0;
      kit.box([pierW + (wide ? 0.04 : 0), h - 0.02, pierD + (wide ? 0.04 : 0)], wide ? 'slate' : 'mist', [x, y0 + h * i + h / 2, 0]);
    }
    // impost cap
    kit.box([pierW + 0.18, 0.16, pierD + 0.18], 'mist', [x, spring - 0.07, 0], { top: 'white' });
  }

  // voussoirs
  const step = Math.PI / n;
  const tw = 2 * rOut * Math.tan(step / 2);
  const rMid = (rIn + rOut) / 2;
  for (let i = 0; i < n; i++) {
    const a = step * (i + 0.5);
    const key = i === (n - 1) / 2;
    const deep = (i - (n - 1) / 2) % 2 !== 0; // the key's neighbours sit proud and dark
    const depth = key ? pierD + 0.16 : deep ? pierD + 0.06 : pierD - 0.02;
    const len = key ? rOut - rIn + 0.18 : rOut - rIn;
    const r = key ? rMid + 0.06 : rMid;
    kit.box([len, key ? tw * 1.05 : tw, depth], key ? 'mist' : deep ? 'slate' : 'mist', [Math.cos(a) * r, spring + Math.sin(a) * r, 0], {
      rot: [0, 0, (a * 180) / Math.PI],
    });
  }

  // worn threshold step under the opening
  kit.box([rIn * 2 + 0.04, 0.08, pierD + 0.14], 'night', [0, 0.04, 0], { cast: false, top: 'slate' });

  kit.blockBox(-pierX, 0, pierW + 0.2, pierD + 0.2);
  kit.blockBox(pierX, 0, pierW + 0.2, pierD + 0.2);
}
