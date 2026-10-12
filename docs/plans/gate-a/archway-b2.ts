import { model } from '../../../src/engine/model';

/** The ring between radii `a` and `b` (m) from angle `t0` to `t1` (degrees) as an XY outline, its arcs in `k` straight steps. */
const ringBlock = (a: number, b: number, t0: number, t1: number, k = 1): [number, number][] => {
  const at = (r: number, t: number): [number, number] => [r * Math.cos((t * Math.PI) / 180), r * Math.sin((t * Math.PI) / 180)];
  const ts = Array.from({ length: k + 1 }, (_, i) => t0 + ((t1 - t0) * i) / k);
  return [...ts.map((t) => at(b, t)), ...ts.reverse().map((t) => at(a, t))];
};

export default model({
  id: 'archway',
  about: 'Free-standing stone archway to walk through: coursed piers on plinths, impost caps, a voussoir arch with a keystone (no collider: a box would close the opening)',
  tags: ['stone', 'building', 'gate'],
  collider: 'none',
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night' },
  params: { span: [1.8, 1.2, 3], rise: [1.8, 1.3, 2.6] },
  parts: (p, rng) => {
    const span = p.span!;
    const rise = p.rise!; // springing height
    const ring = 0.42;
    const depth = 0.6;
    const pier = ring + 0.06; // pier width, a touch wider than the ring
    const px = span / 2 + pier / 2 - 0.03; // pier centre x
    const plinth = 0.22;
    const cap = 0.16;
    const shaftTop = rise - cap;
    const shaft = shaftTop - plinth;
    const n = Math.max(3, Math.round(shaft / 0.34));
    const course = shaft / n;
    const joint = 0.06;
    const a = span / 2;
    const b = a + ring;
    const blocks = Math.round(span * 3 + 3.6) | 1; // odd, so a keystone sits at the crown
    const step = 180 / blocks;
    const gap = (joint / ((a + b) / 2)) * (180 / Math.PI);
    const pierParts = (side: number) => [
      { box: [pier + 0.14, plinth, depth + 0.14], at: [side * px, plinth / 2, 0], c: 'stone2' },
      { box: [pier - 0.08, shaft, depth - 0.08], at: [side * px, plinth + shaft / 2, 0], c: 'mortar' },
      ...Array.from({ length: n }, (_, i) => {
        const w = pier - rng.range(0, 0.04);
        return {
          box: [w, course - joint, depth + rng.range(-0.02, 0.02)],
          at: [side * (px + rng.range(-0.015, 0.015)), plinth + i * course + course / 2, 0],
          c: (i + (side > 0 ? 1 : 0)) % 2 ? 'stone2' : 'stone',
        } as const;
      }),
      { box: [pier + 0.12, cap, depth + 0.12], at: [side * px, shaftTop + cap / 2, 0], c: 'stone2' },
    ];
    return [
      ...pierParts(-1),
      ...pierParts(1),
      {
        name: 'arch',
        at: [0, rise, 0],
        group: [
          // mortar behind the joints, its feet lifted off the caps so no faces are shared
          { slab: ringBlock(a + 0.02, b - 0.02, 2, 178, blocks * 2), depth: depth - 0.08, c: 'mortar' },
          ...Array.from({ length: blocks }, (_, i) => {
            const key = i === (blocks - 1) / 2;
            return {
              slab: ringBlock(key ? a - 0.06 : a, key ? b + 0.08 : b, i * step + (i ? gap / 2 : 0), (i + 1) * step - (i < blocks - 1 ? gap / 2 : 0)),
              depth: key ? depth + 0.08 : depth,
              c: i % 2 ? 'stone2' : 'stone',
              ...(key ? { name: 'keystone' } : {}),
            } as const;
          }),
        ],
      },
    ];
  },
});
