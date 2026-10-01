import { Registry, type Entry } from '../../core/registry';
import type { SpotTag } from './grid';

/**
 * Room templates: hand-made ASCII stencils, placed by the graph grammar (generate.ts).
 * A stencil is the room's *interior*; the generator walls it in (or leaves void around it,
 * for bridges). Rotations and mirrors are generated, so draw each shape once.
 *
 *   .  floor              ~  pit (void inside the room)        P  pillar (a 1-cell wall)
 *   S  spawn (monster pack)  T  treasure (chest)   H  shrine   M  mechanic slot (preferred
 *   B  boss spawn            E  entrance (hero start)          X  exit portal    o  prop spot
 *   (space)  not part of the room (rounded or irregular shapes)
 *
 * Tags: the role it can play (`start`, `combat`, `treasure`, `shrine`, `boss`, `hall`) and
 * the layout styles it suits (`dungeon`, `caves`, `ruins`, `arena`, `bridges`, `town`). Add a
 * room by adding an entry; generators query by tags and pick by weight.
 */
export interface RoomTemplate extends Entry {
  readonly rows: readonly string[];
}

const ALL_STYLES = ['dungeon', 'caves', 'ruins', 'arena', 'bridges', 'town'];

export const ROOM_TEMPLATES = new Registry<RoomTemplate>('room template', [
  // ------------------------------------------------------------ start
  {
    id: 'start-hall',
    tags: ['start', 'dungeon', 'ruins', 'town', 'arena'],
    rows: [
      '.........', //
      '.o.....o.',
      '.........',
      '....E....',
      '.........',
      '.o.....o.',
      '.........',
    ],
  },
  {
    id: 'start-grotto',
    tags: ['start', 'caves', 'bridges', 'arena'],
    rows: [
      '  .....  ', //
      ' ....... ',
      '...o.o...',
      '....E....',
      '.........',
      ' ..o.... ',
      '  .....  ',
    ],
  },
  // ------------------------------------------------------------ combat
  {
    id: 'pillared-hall',
    tags: ['combat', 'dungeon', 'ruins', 'town'],
    weight: 3,
    rows: [
      '.............', //
      '.P...S...S.P.',
      '.............',
      '...M.....M...',
      '.............',
      '.P..S.....oP.',
      '.............',
    ],
  },
  {
    id: 'cross',
    tags: ['combat', 'dungeon', 'ruins', 'caves'],
    weight: 2,
    rows: [
      '    .....    ', //
      '    ..S..    ',
      '    .....    ',
      '.............',
      '.S..M...M..S.',
      '.............',
      '    .....    ',
      '    ..S..    ',
      '    .....    ',
    ],
  },
  {
    id: 'pit-room',
    tags: ['combat', 'dungeon', 'bridges', 'ruins'],
    weight: 2,
    rows: [
      '.............', //
      '.S.........S.',
      '.............',
      '...~~~~~~~...',
      '.M.~~~~~~~.M.',
      '...~~~~~~~...',
      '.............',
      '.o...S.....o.',
      '.............',
    ],
  },
  {
    id: 'round-chamber',
    tags: ['combat', 'caves', 'dungeon', 'bridges', 'arena'],
    weight: 3,
    rows: [
      '   .......   ', //
      '  .........  ',
      ' ....S.S.... ',
      '.............',
      '....M...M....',
      '......S......',
      '.............',
      ' ........o.. ',
      '  .........  ',
      '   .......   ',
    ],
  },
  {
    id: 'gallery',
    tags: ['combat', 'dungeon', 'ruins', 'town'],
    weight: 2,
    rows: [
      '.................', //
      '.P....P...P....P.',
      '...S....M....S...',
      '.................',
      '...M....S....M...',
      '.P....P...P....P.',
      '.................',
    ],
  },
  {
    id: 'small-chamber',
    tags: ['combat', ...ALL_STYLES],
    weight: 2,
    rows: [
      '.........', //
      '..S...S..',
      '.........',
      '...M.M...',
      '.........',
      '....S....',
      '.........',
    ],
  },
  {
    id: 'twin-pits',
    tags: ['combat', 'caves', 'bridges'],
    rows: [
      ' ........... ', //
      '..S.......S..',
      '.~~~.....~~~.',
      '.~~~..M..~~~.',
      '.............',
      '...M..S..M...',
      ' ........... ',
    ],
  },
  {
    id: 'cavern',
    tags: ['combat', 'caves'],
    weight: 3,
    rows: [
      '  .........    ', //
      ' ...S.......   ',
      '.......M.....  ',
      '...............',
      '..M.....S....M.',
      ' .............. ',
      '   ....S.....  ',
      '    .......    ',
    ],
  },
  {
    id: 'courtyard',
    tags: ['combat', 'ruins', 'town'],
    weight: 2,
    rows: [
      '...............', //
      '.S...........S.',
      '...PP.....PP...',
      '...P...M...P...',
      '.......S.......',
      '...P...M...P...',
      '...PP.....PP...',
      '.S.....o.....S.',
      '...............',
    ],
  },
  // ------------------------------------------------------------ connectors
  {
    id: 'hall',
    tags: ['hall', 'dungeon', 'ruins', 'town', 'caves'],
    rows: [
      '.......', //
      '...o...',
      '.......',
      '..M.M..',
      '.......',
    ],
  },
  {
    id: 'island',
    tags: ['hall', 'bridges', 'arena'],
    rows: [
      ' ..... ', //
      '.......',
      '..M.M..',
      '.......',
      ' ..... ',
    ],
  },
  // ------------------------------------------------------------ side rooms
  {
    id: 'vault',
    tags: ['treasure', ...ALL_STYLES],
    rows: [
      ' ....... ', //
      '.........',
      '..o.T.o..',
      '.........',
      ' ..S.... ',
    ],
  },
  {
    id: 'reliquary',
    tags: ['treasure', 'dungeon', 'ruins', 'town'],
    rows: [
      '.......', //
      '.P.T.P.',
      '.......',
      '.o...o.',
      '.......',
    ],
  },
  {
    id: 'shrine-room',
    tags: ['shrine', ...ALL_STYLES],
    rows: [
      ' ....... ', //
      '..o...o..',
      '.........',
      '....H....',
      '.........',
      '..o...o..',
      ' ....... ',
    ],
  },
  // ------------------------------------------------------------ boss arenas
  {
    id: 'grand-arena',
    tags: ['boss', 'dungeon', 'ruins', 'caves', 'arena', 'town'],
    weight: 2,
    rows: [
      '     .........     ', //
      '   .............   ',
      '  ...............  ',
      ' ....P.......P.... ',
      ' ................. ',
      '.......S...S.......',
      '.........B.........',
      '.......M...M.......',
      ' ................. ',
      ' ....P.......P.... ',
      '  ...............  ',
      '   ......X......   ',
      '     .........     ',
    ],
  },
  {
    id: 'pit-arena',
    tags: ['boss', 'dungeon', 'bridges', 'arena', 'caves'],
    weight: 2,
    rows: [
      '...................', //
      '..P.............P..',
      '......S.....S......',
      '....~~~.....~~~....',
      '....~~~..B..~~~....',
      '....~~~.....~~~....',
      '......M.....M......',
      '..P.............P..',
      '.........X.........',
      '...................',
    ],
  },
]);

/** Spot tag per stencil character. */
export const SPOT_CHARS: Readonly<Record<string, SpotTag>> = {
  S: 'spawn',
  T: 'treasure',
  H: 'shrine',
  M: 'mechanic',
  B: 'boss',
  E: 'entrance',
  X: 'exit',
  o: 'prop',
};

/** A stencil cell after rotation: what the generator carves. */
export type StencilCell = 'floor' | 'pit' | 'pillar' | null;

export interface Stencil {
  readonly template: string;
  readonly w: number;
  readonly h: number;
  /** Row-major w × h. */
  readonly cells: readonly StencilCell[];
  readonly spots: readonly { x: number; z: number; tag: SpotTag }[];
}

/** Parse a template, rotated by `rot` quarter turns and optionally mirrored. */
export function stencil(t: RoomTemplate, rot = 0, mirror = false): Stencil {
  const rows = t.rows;
  const h0 = rows.length;
  const w0 = Math.max(...rows.map((r) => r.length));
  const at = (x: number, z: number) => rows[z]?.[x] ?? ' ';
  const turns = ((rot % 4) + 4) % 4;
  const w = turns % 2 ? h0 : w0;
  const h = turns % 2 ? w0 : h0;
  const cells: StencilCell[] = [];
  const spots: { x: number; z: number; tag: SpotTag }[] = [];
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      // Inverse-map (x, z) in the output to the source.
      let sx: number;
      let sz: number;
      const mx = mirror ? w - 1 - x : x;
      if (turns === 0) [sx, sz] = [mx, z];
      else if (turns === 1) [sx, sz] = [z, w - 1 - mx];
      else if (turns === 2) [sx, sz] = [w - 1 - mx, h - 1 - z];
      else [sx, sz] = [h - 1 - z, mx];
      const ch = at(sx, sz);
      const cell: StencilCell = ch === ' ' ? null : ch === '~' ? 'pit' : ch === 'P' || ch === '#' ? 'pillar' : 'floor';
      cells.push(cell);
      const tag = SPOT_CHARS[ch];
      if (tag) spots.push({ x, z, tag });
    }
  }
  return { template: t.id, w, h, cells, spots };
}

/** Templates for a graph role in a style. */
export function templatesFor(role: string, style: string): RoomTemplate[] {
  const found = ROOM_TEMPLATES.query({ all: [role, style] });
  return found.length ? found : ROOM_TEMPLATES.query({ all: [role] });
}
