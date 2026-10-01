/**
 * Hand-made cluster shapes: tiny graphs in local units. +y points away from the tree's
 * centre (the generator rotates each cluster to face outwards), so the entry sits at -y.
 * Neighbouring nodes are ~50–60 units apart; a shape fits in a box of about ±110.
 *
 * Slot keys become part of node ids ('might3.1.a'), so keep a key's meaning when editing a
 * shape (stable ids), and add new keys rather than renaming old ones.
 */
import { Registry } from '../../core/registry';
import type { ShapeDef, ShapeSlot } from '../types';

const s = (key: string, x: number, y: number): ShapeSlot => ({ key, kind: 'small', x, y });
const n = (key: string, x: number, y: number): ShapeSlot => ({ key, kind: 'notable', x, y });
const m = (key: string, x: number, y: number): ShapeSlot => ({ key, kind: 'mastery', x, y });
const chain = (...keys: string[]): [string, string][] => keys.slice(1).map((k, i) => [keys[i]!, k]);

export const SHAPES = new Registry<ShapeDef>('shape', [
  {
    // A straight walk to one notable.
    id: 'line',
    tags: ['n1'],
    slots: [s('e', 0, -100), s('a', 0, -45), s('b', 0, 10), n('N1', 0, 70)],
    links: chain('e', 'a', 'b', 'N1'),
  },
  {
    // A curling hook to one notable.
    id: 'hook',
    tags: ['n1'],
    slots: [s('e', 0, -105), s('a', -25, -55), s('b', -40, 0), s('c', -15, 50), n('N1', 40, 80)],
    links: chain('e', 'a', 'b', 'c', 'N1'),
  },
  {
    // A ring with the notable at its far side: two ways round.
    id: 'loop',
    tags: ['n1'],
    slots: [s('e', 0, -105), s('l1', -55, -70), s('l2', -80, -10), s('l3', -55, 50), n('N1', 0, 80), s('r3', 55, 50), s('r2', 80, -10), s('r1', 55, -70)],
    links: [...chain('e', 'l1', 'l2', 'l3', 'N1', 'r3', 'r2', 'r1'), ['r1', 'e']],
  },
  {
    // A ring around a mastery, one notable beyond it.
    id: 'wheel1',
    tags: ['n1', 'mastery'],
    slots: [s('e', 0, -62), s('r1', 54, -31), s('r2', 54, 31), s('r3', 0, 62), s('r4', -54, 31), s('r5', -54, -31), m('M', 0, 0), n('N1', 0, 120)],
    links: [...chain('e', 'r1', 'r2', 'r3', 'r4', 'r5'), ['r5', 'e'], ['r3', 'M'], ['r3', 'N1']],
  },
  {
    // Two branches, a notable at the end of each.
    id: 'fork',
    tags: ['n2'],
    slots: [s('e', 0, -105), s('a', 0, -50), s('l1', -50, -10), s('l2', -75, 45), n('N1', -85, 100), s('r1', 50, -10), s('r2', 75, 45), n('N2', 85, 100)],
    links: [...chain('e', 'a', 'l1', 'l2', 'N1'), ...chain('a', 'r1', 'r2', 'N2')],
  },
  {
    // A ring whose sides are notables: pass through one to reach the other.
    id: 'ring2',
    tags: ['n2'],
    slots: [s('e', 0, -105), s('l1', -55, -70), n('N1', -85, -5), s('l3', -55, 55), s('t', 0, 85), s('r3', 55, 55), n('N2', 85, -5), s('r1', 55, -70)],
    links: [...chain('e', 'l1', 'N1', 'l3', 't', 'r3', 'N2', 'r1'), ['r1', 'e']],
  },
  {
    // A ring around a mastery with a notable on each shoulder.
    id: 'wheel2',
    tags: ['n2', 'mastery'],
    slots: [s('e', 0, -62), s('r1', 54, -31), s('r2', 54, 31), s('r3', 0, 62), s('r4', -54, 31), s('r5', -54, -31), m('M', 0, 0), n('N1', -100, 85), n('N2', 100, 85)],
    links: [...chain('e', 'r1', 'r2', 'r3', 'r4', 'r5'), ['r5', 'e'], ['r3', 'M'], ['r4', 'N1'], ['r2', 'N2']],
  },
  {
    // A long zig-zag with a notable halfway and one at the end.
    id: 'zigzag',
    tags: ['n2'],
    slots: [s('e', 0, -110), s('a', 32, -68), s('b', 40, -15), n('N1', 0, 25), s('c', -40, 60), s('d', -30, 108), n('N2', 20, 125)],
    links: chain('e', 'a', 'b', 'N1', 'c', 'd', 'N2'),
  },
  {
    // Two ways into a notable, then on to a second.
    id: 'diamond',
    tags: ['n2'],
    slots: [s('e', 0, -105), s('l', -50, -55), s('r', 50, -55), n('N1', 0, -5), s('c', 0, 50), n('N2', 0, 105)],
    links: [['e', 'l'], ['e', 'r'], ['l', 'N1'], ['r', 'N1'], ['N1', 'c'], ['c', 'N2']],
  },
  {
    // A hub splitting three ways, a notable on each spoke.
    id: 'trident',
    tags: ['n3'],
    slots: [s('e', 0, -105), s('h', 0, -50), s('a', -55, -15), n('N1', -100, 35), s('b', 0, 15), n('N2', 0, 80), s('c', 55, -15), n('N3', 100, 35)],
    links: [['e', 'h'], ['h', 'a'], ['a', 'N1'], ['h', 'b'], ['b', 'N2'], ['h', 'c'], ['c', 'N3']],
  },
  {
    // Stat clusters (no notable): what a slot becomes when no themed cluster is left.
    id: 'stat4',
    tags: ['n0'],
    slots: [s('e', 0, -60), s('a', -42, 0), s('b', 42, 0), s('c', 0, 60)],
    links: [['e', 'a'], ['e', 'b'], ['a', 'c'], ['b', 'c']],
  },
  {
    id: 'stat3',
    tags: ['n0'],
    slots: [s('e', 0, -55), s('a', 0, 0), s('b', 0, 55)],
    links: chain('e', 'a', 'b'),
  },
]);

/** Number of notable slots in a shape. */
export function notableSlots(shape: ShapeDef): number {
  return shape.slots.filter((x) => x.kind === 'notable').length;
}
