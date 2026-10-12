import { model } from '../../../src/engine/model'; // also: around, rowOf, gridOf, scatterOf, boxFrame

/** Spring line of the arch, its inner and outer radii, and how many voussoirs make the half-circle. */
const SPRING = 2.0;
const R_IN = 0.9;
const R_OUT = 1.4;
const BLOCKS = 9;
const GAP = 2.4; // degrees between voussoirs

const rad = (d: number) => (d * Math.PI) / 180;
const pt = (r: number, deg: number): [number, number] => [r * Math.cos(rad(deg)), r * Math.sin(rad(deg))];

/** A ring block from angle t0 to t1 (degrees, CCW from +X), as a CCW profile. */
const voussoir = (t0: number, t1: number, rIn = R_IN, rOut = R_OUT) => [pt(rIn, t0), pt(rOut, t0), pt(rOut, t1), pt(rIn, t1)];

const step = 180 / BLOCKS;
const keyIndex = Math.floor(BLOCKS / 2);

export default model({
  id: 'archway',
  about: 'Freestanding stone archway: two block pillars, a voussoir arch and a jutting keystone',
  tags: ['stone', 'gate', 'ruin'],
  palette: { stone: 'mist', dark: 'slate', moss: 'teal' },
  size: [3, 3.56, 0.8],
  parts: [
    // Pillars: plinth, shaft of stacked courses, impost capital.
    {
      mirror: [
        { box: [0.7, 0.3, 0.8], at: [1.15, 0.15, 0], c: 'dark' },
        { box: [0.5, 0.4, 0.6], at: [1.15, 0.5, 0], c: 'stone' },
        { box: [0.54, 0.38, 0.64], at: [1.15, 0.89, 0], c: 'stone' },
        { box: [0.5, 0.4, 0.6], at: [1.15, 1.28, 0], c: 'stone' },
        { box: [0.54, 0.36, 0.64], at: [1.15, 1.66, 0], c: 'stone' },
        { box: [0.66, 0.14, 0.76], at: [1.15, 1.91, 0], c: 'dark' },
      ],
    },
    // The arch ring.
    ...Array.from({ length: BLOCKS }, (_, i) => i)
      .filter((i) => i !== keyIndex)
      .map((i) => ({
        slab: voussoir(i === 0 ? 0 : i * step + GAP / 2, i === BLOCKS - 1 ? 180 : (i + 1) * step - GAP / 2),
        depth: i % 2 ? 0.6 : 0.54,
        at: [0, SPRING - 0.02, 0] as const,
        c: 'stone',
      })),
    // Keystone: taller and jutting out front and back.
    {
      name: 'keystone',
      slab: voussoir(keyIndex * step + GAP / 2, (keyIndex + 1) * step - GAP / 2, R_IN - 0.1, R_OUT + 0.2),
      depth: 0.74,
      at: [0, SPRING - 0.02, 0],
      c: 'stone',
    },
    // A patch of moss on the crown.
    { lump: [0.44, 0.12, 0.4], at: [-0.42, 3.28, 0.06], rot: [0, 0, 22], seed: 3, c: 'moss' },
  ],
});
