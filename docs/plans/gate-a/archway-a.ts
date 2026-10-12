import type { Kit } from '../../../src/riftlight/town/kit';

/**
 * A stone archway: two rusticated pillars on plinths, impost caps, a semicircular ring of
 * voussoirs with a proud keystone, and a threshold slab. Opening 2.0 m wide, ~3.1 m high.
 */
export function build(kit: Kit): void {
  const ri = 1.0; // inner radius = half the opening
  const ro = 1.6; // outer radius
  const px = (ri + ro) / 2; // pillar centre x
  const pw = ro - ri; // pillar width
  const depth = 0.62;
  const plinthH = 0.3;
  const spring = 2.3; // springing line (top of the impost)
  const impostH = 0.16;
  const shaftTop = spring - impostH;

  for (const s of [-1, 1]) {
    const x = s * px;
    // plinth
    kit.box([pw + 0.22, plinthH, depth + 0.22], 'slate', [x, plinthH / 2, 0], { top: 'mist' });
    // core (shows as dark mortar between the courses)
    kit.box([pw - 0.08, shaftTop - plinthH, depth - 0.08], 'night', [x, (plinthH + shaftTop) / 2, 0]);
    // rusticated courses
    const courses = 4;
    const ch = (shaftTop - plinthH) / courses;
    for (let i = 0; i < courses; i++) {
      const wide = i % 2 === 0;
      const w = wide ? pw + 0.04 : pw - 0.02;
      kit.box([w, ch - 0.05, (wide ? depth + 0.04 : depth - 0.02)], 'mist', [x, plinthH + ch * (i + 0.5), 0]);
    }
    // impost cap
    kit.box([pw + 0.16, impostH, depth + 0.16], 'slate', [x, spring - impostH / 2, 0], { top: 'mist' });
    kit.blockBox(x, 0, pw + 0.22, depth + 0.22);
  }

  // voussoirs: each wedge is two stepped blocks (inner and outer half, each sized to its own
  // chord) so the joints stay an even width; the keystone stands proud and darker.
  const n = 11;
  const seg = 180 / n;
  const half = (pw / 2) * 1.0;
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * seg;
    const t = (a * Math.PI) / 180;
    const key = i === (n - 1) / 2;
    const d = key ? depth + 0.14 : i % 2 === 0 ? depth + 0.04 : depth;
    const colour = key ? 'slate' : 'mist';
    for (const [r0, r1] of [
      [ri, ri + half],
      [ri + half, key ? ro + 0.2 : ro],
    ] as const) {
      const r = (r0 + r1) / 2;
      const chord = 2 * r * Math.sin(((seg / 2) * Math.PI) / 180) - 0.085 + (key ? 0.08 : 0);
      kit.box([r1 - r0 + 0.002, chord, d], colour, [r * Math.cos(t), spring + r * Math.sin(t), 0], { rot: [0, 0, a] });
    }
  }
  // dark backing ring so the joints read as mortar
  for (let i = 0; i < n * 2; i++) {
    const a = (i + 0.5) * (seg / 2);
    const t = (a * Math.PI) / 180;
    const rm = (ri + ro) / 2;
    const tang = 2 * ro * Math.sin(((seg / 4) * Math.PI) / 180);
    kit.box([pw - 0.1, tang, depth - 0.1], 'night', [rm * Math.cos(t), spring + rm * Math.sin(t), 0], { rot: [0, 0, a] });
  }

  // threshold slab under the opening
  kit.box([2 * ri, 0.06, depth + 0.1], 'slate', [0, 0.03, 0], { cast: false });
}
