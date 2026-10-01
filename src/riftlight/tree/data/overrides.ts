/**
 * Hand-placed nodes and fixes. Applied after generation, so they win over the generator:
 * an override with an existing id patches that node (position, mods, name, links); a new id
 * adds a node (it needs x, y, name, kind and region). Use this for set pieces the generator
 * shouldn't decide, and for nudging a node the generator put somewhere awkward.
 */
import { flat, inc } from '../../core/mods';
import type { NodeOverride } from '../types';

export const OVERRIDES: readonly NodeOverride[] = [
  {
    // The heart of the wheel: one notable every start gate reaches.
    id: 'core:heart',
    name: 'Heart of the Rift',
    kind: 'notable',
    region: 'core',
    x: 0,
    y: 0,
    mods: [inc('damage', 0.08), inc('life', 0.05), flat('res.elemental', 0.05)],
    flavour: 'Every road out of the rift starts here.',
    link: ['start:might', 'start:edge', 'start:grace', 'start:guile', 'start:wit', 'start:zeal'],
  },
  {
    // Riftwalker sits at the very bottom of the wheel, under Guile, where the rift opens.
    id: 'k:riftwalker',
    x: 0,
    y: 2760,
  },
];
