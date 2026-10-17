import type { Kit } from '../../../../riftlight/town/kit';

// A campfire ring: a circle of rough stones around an ash bed, logs laid in a star with
// their inner ends in the embers, flames rising from the middle, and two log benches
// around the back of the ring.
export function build(kit: Kit): void {
  // deterministic jitter
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const DEG = Math.PI / 180;

  // ash bed and glowing embers
  kit.disc(0.5, 10, 'night', [0, 0.02, 0]);
  kit.disc(0.34, 9, 'red', [0, 0.035, 0]);
  kit.disc(0.24, 8, 'orange', [0.02, 0.05, 0.02]);

  // stone ring
  const stones = 11;
  const R = 0.6;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + (rnd() - 0.5) * 0.15;
    const x = Math.cos(a) * R;
    const z = -Math.sin(a) * R;
    const big = i % 3 !== 1;
    const rB = big ? 0.15 : 0.12;
    const h = big ? 0.18 : 0.14;
    kit.cyl(rB * 0.6, rB, h, 6, i % 2 ? 'mist' : 'slate', [x, h / 2, z], {
      rot: [(rnd() - 0.5) * 12, rnd() * 60, (rnd() - 0.5) * 12],
    });
  }

  // star of logs: outer ends resting on the ash, inner ends raised in the fire
  const logs = 5;
  const L = 0.5;
  const r = 0.07;
  const rise = 14; // degrees the inner end is lifted
  const t = (90 - rise) * DEG; // tilt from vertical
  for (let i = 0; i < logs; i++) {
    const yawDeg = (i / logs) * 360 + 54;
    const y = yawDeg * DEG;
    // outer end position
    const ox = Math.cos(y) * 0.44;
    const oz = -Math.sin(y) * 0.44;
    const ux = -Math.sin(t) * Math.cos(y);
    const uy = Math.cos(t);
    const uz = Math.sin(t) * Math.sin(y);
    const c: [number, number, number] = [ox + ux * (L / 2), r + 0.02 + uy * (L / 2), oz + uz * (L / 2)];
    kit.cyl(r, r, L, 6, 'plum', c, { rot: [0, yawDeg, 90 - rise] });
    // pale cut end at the outer end of each log
    kit.cyl(r * 0.75, r * 0.75, 0.02, 6, 'sand', [c[0] - ux * (L / 2 + 0.005), c[1] - uy * (L / 2 + 0.005), c[2] - uz * (L / 2 + 0.005)], {
      rot: [0, yawDeg, 90 - rise],
    });
  }

  // flames: tongues lean back a little so their camera-facing sides catch the light;
  // an orange body, a pale sand core poking out in front, a white-hot heart
  const lean = (dx: number, dz: number): [number, number, number] => [-dz, 0, dx]; // tip toward (-x, -z)
  kit.cone(0.27, 0.76, 6, 'orange', [-0.06, 0.08 + 0.36, -0.06], { rot: lean(22, 22) });
  kit.cone(0.14, 0.52, 5, 'orange', [0.17, 0.08 + 0.22, -0.08], { rot: lean(-6, 32) });
  kit.cone(0.14, 0.52, 5, 'orange', [-0.08, 0.08 + 0.22, 0.17], { rot: lean(32, -6) });
  kit.cone(0.19, 0.62, 6, 'sand', [0.1, 0.08 + 0.28, 0.1], { rot: lean(24, 24) });
  kit.cone(0.1, 0.32, 5, 'white', [0.2, 0.08 + 0.14, 0.2], { rot: lean(26, 26) });
  kit.cone(0.08, 0.32, 5, 'sand', [0.2, 0.08 + 0.13, 0.04], { rot: lean(6, 30) });
  kit.cone(0.08, 0.32, 5, 'sand', [0.04, 0.08 + 0.13, 0.2], { rot: lean(30, 6) });

  // log benches around the back of the ring
  const bench = (x: number, z: number, yaw: number, len: number, rr: number) => {
    kit.frame(x, z, yaw, () => {
      kit.cyl(rr, rr * 1.04, len, 6, 'plum', [0, rr, 0], { rot: [30, 0, 90] });
      for (const s of [1, -1]) kit.cyl(rr * 0.78, rr * 0.78, 0.02, 6, 'sand', [s * (len / 2 + 0.005), rr, 0], { rot: [30, 0, 90] });
      kit.blockBox(0, 0, len, rr * 2);
    });
  };
  bench(0.15, -1.12, -6, 1.15, 0.16);
  bench(-1.12, 0.12, 84, 1.1, 0.16);

  kit.blockCircle(0, 0, 0.74);
}
