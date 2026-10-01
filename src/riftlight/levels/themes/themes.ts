import { Registry } from '../../core/registry';
import type { ThemeDef } from '../../core/types';
import type { FlickerPreset } from '../../../engine/render/lights';

/**
 * Level themes: palettes, light, fog, props, music and an optional filter look. A theme is
 * pure data (`LevelTheme` extends the core `ThemeDef`); the geometry builder, prop builders
 * and the level runtime read it. Rifts shift a theme's palette (themes/palette.ts).
 *
 * Colour rules for pixel art at 480×270: floors are mid-dark and low-saturation so actors
 * and effects read on top; walls are darker than floors (silhouettes against the floor);
 * `trim` (wall caps, floor edges) and `accent` are the theme's signature colours; `light`
 * is the colour of its torches and lanterns. Ambient + sun stay low in dark themes so the
 * dynamic lights carry the mood.
 */
export interface LevelTheme extends ThemeDef {
  readonly palette: {
    readonly floor: number;
    readonly wall: number;
    readonly accent: number;
    readonly fog: number;
    readonly sky: number;
    readonly light: number;
  };
  /** Second floor tone (flagstone pattern). */
  readonly floorAlt: number;
  /** Wall caps and the edge trim along wall bases. */
  readonly trim: number;
  /** Cliff sides of pits and voids. */
  readonly cliff: number;
  /** Ambient (`ambient`, a colour) and sun (`sun`, a colour) intensities. */
  readonly ambientIntensity: number;
  readonly sunIntensity: number;
  /** Fog distances past the camera's focus distance (ortho: deepens pits and voids). */
  readonly fog: { readonly near: number; readonly far: number };
  /** Torches, braziers and lanterns of this theme. */
  readonly torch: { readonly intensity: number; readonly radius: number; readonly flicker: FlickerPreset };
  /** Props scattered per 100 floor cells. */
  readonly propDensity: number;
  /** Wall height (back walls; front walls are cut low so the iso camera sees in). */
  readonly wallHeight: number;
}

export const THEMES = new Registry<LevelTheme>('theme', [
  {
    id: 'ember-forge',
    name: 'Ember Forge',
    tags: ['fire', 'warm', 'indoor'],
    palette: { floor: 0x5a3c34, wall: 0x2e1d22, accent: 0xef7d57, fog: 0x1a0d10, sky: 0x120709, light: 0xffa040 },
    floorAlt: 0x4c3029,
    trim: 0xa34a34,
    cliff: 0x24141a,
    ambient: 0x7a3a50,
    ambientIntensity: 0.55,
    sun: 0xffcd75,
    sunIntensity: 0.9,
    fog: { near: 6, far: 30 },
    torch: { intensity: 7, radius: 7, flicker: 'brazier' },
    props: ['brazier', 'pillar', 'crate', 'rubble', 'banner'],
    propDensity: 2.2,
    wallHeight: 2.2,
    song: 'forge',
  },
  {
    id: 'gloom-crypt',
    name: 'Gloom Crypt',
    tags: ['dark', 'cold', 'indoor', 'undead'],
    palette: { floor: 0x3c4156, wall: 0x1d2032, accent: 0x73eff7, fog: 0x0a0b13, sky: 0x06070d, light: 0x9fe6ff },
    floorAlt: 0x33374b,
    trim: 0x5a6a8a,
    cliff: 0x141626,
    ambient: 0x3a4a8a,
    ambientIntensity: 0.4,
    sun: 0x94b0c2,
    sunIntensity: 0.35,
    fog: { near: 4, far: 26 },
    torch: { intensity: 5, radius: 6, flicker: 'candle' },
    props: ['bones', 'statue', 'pillar', 'lantern', 'rubble'],
    propDensity: 2.4,
    wallHeight: 2.4,
    song: 'crypt',
    filters: ['vignette'],
  },
  {
    id: 'gale-cliffs',
    name: 'Gale Cliffs',
    tags: ['outdoor', 'bright', 'wind'],
    palette: { floor: 0x7d9160, wall: 0x5e5848, accent: 0x41a6f6, fog: 0x8fbfe0, sky: 0x6fa8d8, light: 0xfff0c0 },
    floorAlt: 0x6e8254,
    trim: 0xc8bf98,
    cliff: 0x4a4438,
    ambient: 0xb0d0f0,
    ambientIntensity: 1.0,
    sun: 0xfff4d8,
    sunIntensity: 2.4,
    fog: { near: 8, far: 40 },
    torch: { intensity: 4, radius: 6, flicker: 'torch' },
    props: ['rock', 'tree', 'banner', 'rubble', 'pillar'],
    propDensity: 2.0,
    wallHeight: 1.6,
    song: 'gale',
  },
  {
    id: 'frostglass-caverns',
    name: 'Frostglass Caverns',
    tags: ['cold', 'ice', 'cave'],
    palette: { floor: 0x6a88aa, wall: 0x2a3a62, accent: 0x73eff7, fog: 0x0d1830, sky: 0x091226, light: 0x9ff0ff },
    floorAlt: 0x5c7a9c,
    trim: 0xa8e4ff,
    cliff: 0x1c2848,
    ambient: 0x4a6ad0,
    ambientIntensity: 0.7,
    sun: 0xc8e8ff,
    sunIntensity: 0.8,
    fog: { near: 6, far: 30 },
    torch: { intensity: 4, radius: 6, flicker: 'pulse' },
    props: ['crystal', 'rock', 'bones'],
    propDensity: 2.6,
    wallHeight: 2.4,
    song: 'frost',
  },
  {
    id: 'thornweave-jungle',
    name: 'Thornweave Jungle',
    tags: ['nature', 'green', 'outdoor'],
    palette: { floor: 0x4c6a36, wall: 0x22341c, accent: 0xa7f070, fog: 0x0f1f0e, sky: 0x0b170b, light: 0xd8ff8a },
    floorAlt: 0x415c2e,
    trim: 0x86b048,
    cliff: 0x1a2814,
    ambient: 0x3a8a6a,
    ambientIntensity: 0.7,
    sun: 0xe8f0a0,
    sunIntensity: 1.3,
    fog: { near: 6, far: 30 },
    torch: { intensity: 4, radius: 6, flicker: 'torch' },
    props: ['tree', 'mushroom', 'rock', 'statue', 'rubble'],
    propDensity: 3.2,
    wallHeight: 2.0,
    song: 'jungle',
  },
  {
    id: 'stormspire-peaks',
    name: 'Stormspire Peaks',
    tags: ['storm', 'outdoor', 'lightning'],
    palette: { floor: 0x6a6e80, wall: 0x343748, accent: 0xffe066, fog: 0x1b1d2f, sky: 0x141626, light: 0xbfd8ff },
    floorAlt: 0x5c6072,
    trim: 0xaab2d4,
    cliff: 0x24263a,
    ambient: 0x5a6aa0,
    ambientIntensity: 0.7,
    sun: 0xd0d8ff,
    sunIntensity: 1.0,
    fog: { near: 6, far: 32 },
    torch: { intensity: 4, radius: 6, flicker: 'strobe' },
    props: ['pillar', 'rock', 'banner', 'rubble'],
    propDensity: 2.0,
    wallHeight: 2.0,
    song: 'storm',
  },
  {
    id: 'mire-swamp',
    name: 'Mire Swamp',
    tags: ['nature', 'swamp', 'outdoor'],
    palette: { floor: 0x535636, wall: 0x2a2c1a, accent: 0xb8c060, fog: 0x191b0f, sky: 0x111309, light: 0xe0e890 },
    floorAlt: 0x484b2e,
    trim: 0x7c7c48,
    cliff: 0x1e2012,
    ambient: 0x4a6a4a,
    ambientIntensity: 0.75,
    sun: 0xc8c890,
    sunIntensity: 1.0,
    fog: { near: 5, far: 28 },
    torch: { intensity: 4, radius: 6, flicker: 'candle' },
    props: ['tree', 'mushroom', 'bones', 'rock'],
    propDensity: 3.0,
    wallHeight: 1.8,
    song: 'mire',
  },
  {
    id: 'echo-halls',
    name: 'Echo Halls',
    tags: ['arcane', 'indoor', 'marble'],
    palette: { floor: 0x7a6a8c, wall: 0x382c48, accent: 0xc890ff, fog: 0x130f1b, sky: 0x0d0a13, light: 0xe0c8ff },
    floorAlt: 0x6c5c7e,
    trim: 0xd2c2ee,
    cliff: 0x261e32,
    ambient: 0x7a3a8a,
    ambientIntensity: 0.65,
    sun: 0xe8e0ff,
    sunIntensity: 0.95,
    fog: { near: 6, far: 30 },
    torch: { intensity: 5, radius: 6, flicker: 'spell' },
    props: ['statue', 'pillar', 'banner', 'crystal'],
    propDensity: 2.0,
    wallHeight: 2.4,
    song: 'echo',
  },
  {
    id: 'rift-nexus',
    name: 'Rift Nexus',
    tags: ['arcane', 'void', 'rift'],
    palette: { floor: 0x4a3668, wall: 0x22183c, accent: 0xff4fc8, fog: 0x160a26, sky: 0x0c0618, light: 0xff80e0 },
    floorAlt: 0x402e5c,
    trim: 0xd050b8,
    cliff: 0x24183c,
    ambient: 0x7a4ab0,
    ambientIntensity: 0.9,
    sun: 0xd8b8ff,
    sunIntensity: 1.1,
    fog: { near: 6, far: 34 },
    torch: { intensity: 5, radius: 6, flicker: 'spell' },
    props: ['crystal', 'pillar', 'rubble'],
    propDensity: 2.2,
    wallHeight: 2.0,
    song: 'nexus',
  },
  {
    id: 'bloodmoon-cathedral',
    name: 'Bloodmoon Cathedral',
    tags: ['blood', 'gothic', 'indoor'],
    palette: { floor: 0x5a4049, wall: 0x2a1a21, accent: 0xff4060, fog: 0x1c090e, sky: 0x140509, light: 0xff6a50 },
    floorAlt: 0x4c343d,
    trim: 0xb13e53,
    cliff: 0x1c1016,
    ambient: 0x8a2a3a,
    ambientIntensity: 0.6,
    sun: 0xff9080,
    sunIntensity: 0.9,
    fog: { near: 5, far: 28 },
    torch: { intensity: 6, radius: 6, flicker: 'torch' },
    props: ['pillar', 'statue', 'banner', 'bones', 'brazier'],
    propDensity: 2.2,
    wallHeight: 2.6,
    song: 'bloodmoon',
  },
  {
    id: 'gravewell-observatory',
    name: 'Gravewell Observatory',
    tags: ['arcane', 'cosmic', 'indoor'],
    palette: { floor: 0x414b6c, wall: 0x1c2238, accent: 0x9a7aff, fog: 0x080a18, sky: 0x05060f, light: 0xc0b0ff },
    floorAlt: 0x384262,
    trim: 0xe8b860,
    cliff: 0x12162a,
    ambient: 0x3a4a9a,
    ambientIntensity: 0.65,
    sun: 0xd8d0ff,
    sunIntensity: 0.9,
    fog: { near: 6, far: 32 },
    torch: { intensity: 5, radius: 6, flicker: 'pulse' },
    props: ['pillar', 'crystal', 'statue', 'lantern'],
    propDensity: 2.0,
    wallHeight: 2.4,
    song: 'gravewell',
  },
  {
    id: 'collapse-ruins',
    name: 'Collapse Ruins',
    tags: ['ruins', 'earth', 'outdoor'],
    palette: { floor: 0x7a6a58, wall: 0x463a30, accent: 0xffcd75, fog: 0x1d1711, sky: 0x15110c, light: 0xffd8a0 },
    floorAlt: 0x6c5c4b,
    trim: 0xb8a080,
    cliff: 0x2e261e,
    ambient: 0x7a6a5a,
    ambientIntensity: 0.7,
    sun: 0xffe0b0,
    sunIntensity: 1.2,
    fog: { near: 6, far: 32 },
    torch: { intensity: 5, radius: 6, flicker: 'torch' },
    props: ['rubble', 'pillar', 'statue', 'crate', 'bones'],
    propDensity: 2.6,
    wallHeight: 2.0,
    song: 'ruins',
  },
]);

export function getTheme(id: string): LevelTheme {
  return THEMES.get(id);
}
