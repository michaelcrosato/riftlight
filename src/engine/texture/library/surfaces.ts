import { textureDef } from '../helpers';

export const planks = textureDef({
  id: 'planks',
  about: 'Floor boards with gaps and staggered butt joints',
  tags: ['wood', 'floor', 'surface'],
  size: [16, 16],
  tile: true,
  palette: { gap: 'plum', wood: 'red', wood2: 'orange' },
  layers: [{ pattern: 'planks', colors: ['gap', 'wood', 'wood2'], w: 4, length: 16, grain: 0.3, seed: 3 }],
});

export const bricks = textureDef({
  id: 'bricks',
  about: 'Stone bricks in courses over dark mortar, a lit top edge on each',
  tags: ['stone', 'wall', 'surface'],
  size: [16, 16],
  tile: true,
  palette: { mortar: 'night', stone: 'slate', stone2: 'mist' },
  layers: [{ pattern: 'bricks', colors: ['mortar', 'stone', 'stone2'], w: 8, h: 4, seed: 2 }],
});

export const cobbles = textureDef({
  id: 'cobbles',
  about: 'Rounded cobblestones with dark joints',
  tags: ['stone', 'floor', 'road', 'surface'],
  size: [16, 16],
  tile: true,
  palette: { joint: 'night', stone: 'slate', stone2: 'mist' },
  layers: [{ pattern: 'cobbles', colors: ['joint', 'stone', 'stone2'], cells: 3, gap: 1, seed: 4 }],
});

export const floorTiles = textureDef({
  id: 'floor-tiles',
  about: 'Square flagstones with thin joints',
  tags: ['stone', 'floor', 'surface'],
  size: [16, 16],
  tile: true,
  palette: { joint: 'slate', tile: 'mist', tile2: 'white' },
  layers: [{ pattern: 'tiles', colors: ['joint', 'tile', 'tile2'], w: 8, h: 8, seed: 5 }],
});

export const dirt = textureDef({
  id: 'dirt',
  about: 'Packed earth in three tones with a few pebbles',
  tags: ['ground', 'floor', 'surface'],
  size: [16, 16],
  tile: true,
  palette: { dark: 'plum', earth: 'red', pebble: 'sand' },
  layers: [
    { pattern: 'noise', colors: ['dark', 'earth'], scale: 2, octaves: 2, seed: 6 },
    { pattern: 'scatter', colors: 'pebble', count: 3, size: 1, seed: 6 },
  ],
});

export const grass = textureDef({
  id: 'grass',
  about: 'Short grass in two greens with lighter blades',
  tags: ['ground', 'floor', 'surface', 'nature'],
  size: [16, 16],
  tile: true,
  palette: { dark: 'green', light: 'lime' },
  layers: [
    { pattern: 'noise', colors: ['dark', 'light'], scale: 2, octaves: 1, seed: 7 },
    { pattern: 'scatter', colors: 'light', count: 6, size: 1, shape: 'blade', seed: 8 },
  ],
});

export const SURFACES = [planks, bricks, cobbles, floorTiles, dirt, grass];
