import type { WingDef, WingId } from './types';

/** The wings of Engine World, in the order the Atrium and the room list show them. */
export const WINGS: readonly WingDef[] = [
  { id: 'hub', title: 'Atrium', about: 'The hub: a door for every room.', color: 'sand' },
  { id: 'movement', title: 'Movement & Feel', about: 'The character controller, cameras and game feel.', color: 'lime' },
  { id: 'physics', title: 'Physics Lab', about: 'Rigid bodies, joints, ropes, cloth, destruction, forces.', color: 'orange' },
  { id: 'animation', title: 'Animation Lab', about: 'Clips as data, blends, IK, procedural and secondary motion.', color: 'sky' },
  { id: 'effects', title: 'Visual Effects', about: 'Lights, particles, water, weather, wind, fog, screen effects.', color: 'cyan' },
  { id: 'looks', title: 'Looks & Filters', about: 'Pixel art, palettes, consoles, displays, per-layer looks, transitions.', color: 'red' },
  { id: 'genres', title: 'Genre Wing', about: 'Whole little games on the same engine.', color: 'blue' },
  { id: 'workshop', title: 'Workshop', about: 'Build, break and rewind.', color: 'plum' },
  { id: 'procedural', title: 'Procedural', about: 'Worlds made by rules and a seed: terrain, dungeons, plants.', color: 'green' },
  { id: 'rendering', title: 'Rendering Lab', about: 'The GPU at work: compute shaders, render targets, mirrors, shaders written in TSL.', color: 'cyan' },
  { id: 'direction', title: 'AI & Direction', about: 'Agents that decide, scenes that are directed, sounds that have a place.', color: 'orange' },
];

export function wing(id: WingId): WingDef {
  return WINGS.find((w) => w.id === id) ?? WINGS[0]!;
}
