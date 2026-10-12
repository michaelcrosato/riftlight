import type { Kit } from '../../../src/riftlight/town/kit';

/**
 * A campfire ring: eleven rough stones around a scorched ash bed, five logs laid in a star with
 * their inner ends raised over a glowing coal bed, and a layered flame (orange, sand, white)
 * rising from the middle. About 1.6 m across, 0.75 m tall.
 */
export function build(kit: Kit): void {
  // ash bed and scorched ground
  kit.disc(0.78, 12, 'night', [0, 0.02, 0]);
  kit.disc(0.5, 10, 'ink', [0, 0.035, 0]);

  // stone ring: uneven faceted stones, alternating tones
  const stones = 11;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + 0.15;
    const r = 0.62 + (i % 3 === 0 ? 0.03 : -0.01);
    const big = i % 2 === 0;
    const rb = big ? 0.17 : 0.14;
    const h = big ? 0.22 : 0.17;
    const color = i % 3 === 1 ? 'mist' : 'slate';
    kit.cyl(rb * 0.6, rb, h, 5, color, [Math.cos(a) * r, h / 2, Math.sin(a) * r], {
      rot: [(i % 2 ? 6 : -5), (i * 47) % 360, (i % 3 ? -7 : 4)],
    });
  }

  // logs radiating from the centre like a star, inner ends raised on each other, pale cut ends out
  const logs = 5;
  const logLen = 0.6;
  const lift = 14; // degrees the inner end is raised
  const mid = 0.3; // distance of the log's middle from the centre
  for (let i = 0; i < logs; i++) {
    const yaw = (i / logs) * 360 + 18;
    kit.frame(0, 0, yaw, () => {
      const y = 0.1 + Math.sin((lift * Math.PI) / 180) * (logLen / 2) * 0.6;
      kit.cyl(0.075, 0.085, logLen, 6, 'plum', [0, y, mid], { rot: [90 - lift, 0, 0] });
      const endZ = mid + (logLen / 2) * Math.cos((lift * Math.PI) / 180) + 0.006;
      const endY = y - (logLen / 2) * Math.sin((lift * Math.PI) / 180);
      kit.cyl(0.075, 0.075, 0.02, 6, 'sand', [0, endY, endZ], { rot: [90 - lift, 0, 0] });
    });
  }

  // glowing coal bed under the logs (flat, so it catches the light)
  kit.disc(0.34, 8, 'red', [0, 0.05, 0]);
  kit.disc(0.2, 7, 'orange', [0, 0.06, 0], { rot: [0, 20, 0] });

  // flames in layers, squat so their faces catch the light: an orange skirt, tongues splaying
  // outwards like a crown, a sand body and a white heart at the front
  kit.cone(0.28, 0.4, 7, 'orange', [0, 0.34, 0]);
  const tongues: [number, number, number][] = [
    // [azimuth deg, height, radius]
    [10, 0.44, 0.11],
    [80, 0.36, 0.11],
    [150, 0.48, 0.12],
    [215, 0.4, 0.11],
    [285, 0.46, 0.12],
  ];
  for (const [az, h, r] of tongues) {
    kit.frame(0, 0, az, () => {
      kit.cone(r, h, 5, 'orange', [0, 0.22 + h / 2, 0.16], { rot: [22, 0, 0] });
    });
  }
  kit.cone(0.23, 0.5, 6, 'sand', [0, 0.47, 0], { rot: [0, 15, 0] });
  kit.cone(0.1, 0.34, 5, 'sand', [0.12, 0.42, -0.08], { rot: [-12, 0, 12] });
  kit.cone(0.12, 0.3, 5, 'white', [0.02, 0.42, 0.13], { rot: [14, 0, 0] });

  // glowing embers on the ash
  const embers: [number, number][] = [
    [0.32, 0.14],
    [-0.3, 0.2],
    [0.12, -0.34],
    [-0.22, -0.26],
    [0.05, 0.36],
  ];
  for (const [x, z] of embers) kit.box([0.08, 0.04, 0.07], 'orange', [x, 0.06, z], { rot: [0, (x * 300) % 90, 0] });

  kit.blockCircle(0, 0, 0.75);
}
