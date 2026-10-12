import { model } from '../../../src/engine/model';

/** Where the three weapons stand along the rack (x, m). */
const SWORD_X = -0.44;
const SPEAR_X = 0;
const AXE_X = 0.44;
const BAR_Y = 0.98; // the top bar that the weapons lean on
const BACK_Z = -0.12; // the rack's back plane (uprights, top bar)
const FOOT: [number, number] = [0.06, 0.06]; // y, z where a weapon's butt stands on the trough floor
const LEAN = -8; // degrees about X: tops lean back onto the bar

export default model({
  id: 'weapon-rack',
  about: 'Wooden weapon rack: a sword, a spear and a double-bitted axe stand in a trough and lean on a notched top bar',
  tags: ['furniture', 'weapon', 'wood', 'town'],
  palette: { wood: 'orange', dark: 'red', steel: 'white', iron: 'slate', gold: 'sand', shaft: 'sand', grip: 'plum' },
  size: [1.62, 2.24, 0.6],
  parts: [
    // The rack: two feet, two uprights with caps, a top bar with notch pegs.
    { mirror: [{ box: [0.14, 0.1, 0.6], at: [0.72, 0.05, -0.02], c: 'dark' }] },
    { mirror: [{ box: [0.1, 1.08, 0.1], at: [0.72, 0.64, BACK_Z], c: 'wood' }] },
    { mirror: [{ cyl: [0.14, 0.1, 0.14], at: [0.72, 1.23, BACK_Z], top: 0.4, seg: 4, rot: [0, 45, 0], c: 'dark' }] },
    { box: [1.62, 0.1, 0.12], at: [0, BAR_Y, BACK_Z], c: 'dark', name: 'bar' },
    ...[SWORD_X, SPEAR_X, AXE_X].flatMap((x) => [
      { box: [0.07, 0.08, 0.14], at: [x - 0.13, BAR_Y, -0.03], c: 'dark' } as const,
      { box: [0.07, 0.08, 0.14], at: [x + 0.13, BAR_Y, -0.03], c: 'dark' } as const,
    ]),
    // The trough: a dark floor boxed in by orange boards; the butts stand inside.
    { box: [1.2, 0.06, 0.2], at: [0, 0.035, 0], c: 'dark', name: 'trough' },
    { mirror: [{ box: [1.3, 0.16, 0.06], at: [0, 0.08, 0.12], c: 'wood' }], axis: 'z' },
    { mirror: [{ box: [0.06, 0.16, 0.18], at: [0.62, 0.08, 0], c: 'wood' }] },

    // Sword, hilt up: the point rests in the trough, the guard sits on the bar's pegs.
    {
      name: 'sword',
      at: [SWORD_X, ...FOOT],
      rot: [LEAN, 0, 0],
      group: [
        { slab: [[-0.08, 0.14], [0, 0], [0.08, 0.14], [0.08, 1.0], [-0.08, 1.0]], depth: 0.06, c: 'steel' },
        { box: [0.44, 0.08, 0.1], at: [0, 1.04, 0], c: 'gold' },
        { mirror: [{ ball: [0.1, 0.1, 0.1], at: [0.23, 1.04, 0], c: 'gold' }] },
        { cyl: [0.08, 0.22, 0.08], at: [0, 1.19, 0], seg: 6, c: 'grip' },
        { ball: [0.14, 0.14, 0.14], at: [0, 1.35, 0], c: 'gold' },
      ],
    },

    // Spear, the tallest: a broad leaf head on a long pale shaft, a red tuft under the socket.
    {
      name: 'spear',
      at: [SPEAR_X, ...FOOT],
      rot: [LEAN, 0, 0],
      group: [
        { cyl: [0.08, 1.64, 0.08], at: [0, 0.82, 0], seg: 6, c: 'shaft' },
        { cone: [0.18, 0.2, 0.18], at: [0, 1.52, 0], rot: [180, 0, 0], seg: 6, c: 'dark' },
        { cyl: [0.1, 0.12, 0.1], at: [0, 1.66, 0], seg: 6, top: 0.7, c: 'iron' },
        { slab: [[0, 0], [0.12, 0.13], [0.09, 0.34], [0, 0.5], [-0.09, 0.34], [-0.12, 0.13]], depth: 0.06, at: [0, 1.7, 0], c: 'steel' },
      ],
    },

    // Axe: a broad double-bitted head on a haft that rises well past the bar.
    {
      name: 'axe',
      at: [AXE_X, ...FOOT],
      rot: [LEAN, 0, 0],
      group: [
        { cyl: [0.08, 1.46, 0.08], at: [0, 0.73, 0], seg: 6, c: 'shaft' },
        { box: [0.12, 0.2, 0.11], at: [0, 1.28, 0], c: 'iron' },
        {
          mirror: [
            { slab: [[0.05, -0.07], [0.12, -0.07], [0.24, -0.25], [0.32, -0.25], [0.32, 0.25], [0.24, 0.25], [0.12, 0.07], [0.05, 0.07]], depth: 0.06, at: [0, 1.28, 0], c: 'steel' },
          ],
        },
      ],
    },
  ],
});
