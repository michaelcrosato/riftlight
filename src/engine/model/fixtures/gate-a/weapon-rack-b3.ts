import { model } from '../..'; // also: around, rowOf, gridOf, scatterOf, boxFrame
import type { Part } from '../../types';

/** Where the weapons stand: the board's top (m), and the top rail's top, low so the heads stand clear above it. */
const FLOOR = 0.16;
const RAIL = 0.78;
/**
 * The posts' centres (±x) and the weapons' (left to right: spear, greataxe, longsword): tallest to
 * the left, so under the iso camera (from the front right) the heads step down toward the viewer
 * instead of piling up, and wide enough apart that the greataxe's bits clear both neighbours.
 */
const POST = 0.9;
const SLOTS = [-0.56, 0, 0.56] as const;

/** A broad longsword standing on its point, its blade through a slot in the rail, the hilt (a cross) well above it. */
const longsword = (x: number): Part => {
  const tip = FLOOR;
  const guard = 1.0; // the guard's underside
  const w = 0.095; // half the blade's width: broad, so it keeps a light face inside its outline at game scale
  return {
    name: 'longsword',
    at: [x, 0, 0],
    group: [
      { slab: [[0, tip], [w, tip + 0.16], [w, guard + 0.02], [-w, guard + 0.02], [-w, tip + 0.16]], depth: 0.04, c: 'blade', name: 'blade' },
      { box: [0.46, 0.08, 0.1], at: [0, guard + 0.04, 0], c: 'gold', name: 'guard' },
      { mirror: [{ ball: [0.11, 0.11, 0.11], at: [0.24, guard + 0.04, 0], c: 'gold' }] },
      { cyl: [0.08, 0.26, 0.08], seg: 6, at: [0, guard + 0.21, 0], c: 'dark', name: 'grip' },
      { ball: [0.13, 0.13, 0.13], at: [0, guard + 0.39, 0], c: 'gold' },
    ],
  };
};

export default model({
  id: 'weapon-rack',
  about: 'Standing weapon rack, 2 m wide: two posts on runner feet, a base board and a low top rail holding three weapons upright: a 2 m spear, a greataxe and a broad longsword on its point, gold hilt up',
  tags: ['props', 'weapon', 'rack', 'wood', 'town', 'dungeon'],
  size: [1.96, 2.16, 0.56],
  palette: { wood: 'orange', frame: 'red', dark: 'plum', haft: 'sand', gold: 'sand', iron: 'slate', steel: 'mist', blade: 'white' },
  parts: (): Part[] => [
    // the stand
    { mirror: [{ box: [0.14, 0.1, 0.56], at: [POST, 0.05, 0], c: 'dark', name: 'foot' }] },
    { mirror: [{ box: [0.12, RAIL - 0.06, 0.12], at: [POST, 0.08 + (RAIL - 0.06) / 2, 0], c: 'frame', name: 'post' }] },
    { mirror: [{ box: [0.16, 0.05, 0.16], at: [POST, RAIL + 0.025, 0], c: 'dark', name: 'cap' }] },
    { box: [2 * POST - 0.06, 0.06, 0.3], at: [0, FLOOR - 0.03, 0], c: 'frame', name: 'board' },
    { box: [2 * POST + 0.1, 0.1, 0.13], at: [0, RAIL - 0.05, 0], c: 'wood', name: 'rail' },
    // the weapons: library models on pale ash hafts, their heads all white so they keep a light face
    // inside the outline at game scale (the spear 1.25× its shortest, for a head broad enough to read)
    { use: 'spear', at: [SLOTS[0], FLOOR, 0], params: { l: 1.6 }, scale: 1.25, palette: { grip: 'haft', iron: 'iron', gold: 'iron', blade: 'blade', steel: 'blade' }, name: 'spear' },
    { use: 'greataxe', at: [SLOTS[1], FLOOR, 0], palette: { grip: 'haft', iron: 'iron', head: 'blade', bit: 'steel', gold: 'iron' }, name: 'greataxe' },
    longsword(SLOTS[2]),
  ],
});
