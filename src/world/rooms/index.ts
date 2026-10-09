/**
 * Every room of Engine World, in wing order (the Atrium first). Add a room: write
 * `rooms/<id>.ts` exporting a `RoomDef`, list it here; the Atrium gives it a door, the room
 * list (G) a button, the e2e suite a visit.
 */
import { registerRooms } from '../shell';
import type { RoomDef } from '../types';
import { ATRIUM } from './atrium';
import { BODIES } from './bodies';
import { CAMERAS } from './cameras';
import { CLIPS } from './clips';
import { DESTRUCTION } from './destruction';
import { LIGHTS, PARTICLE_GARDEN } from './effects';
import { FEEL } from './feel';
import { FIELDS } from './fields';
import { FOLIAGE } from './foliage';
import { JOINTS } from './joints';
import { CONSOLES, FILTER_BENCH, LAYERS, TRANSITIONS_ROOM } from './looks';
import { MOVES } from './moves';
import { PLATFORMS } from './platforms';
import { SOFT } from './soft';
import { TRAILS } from './trails';
import { WATER } from './water';
import { WEATHER } from './weather';

export const ROOMS: readonly RoomDef[] = [
  ATRIUM,
  // movement & feel
  MOVES,
  FEEL,
  CAMERAS,
  // physics
  BODIES,
  JOINTS,
  SOFT,
  PLATFORMS,
  DESTRUCTION,
  FIELDS,
  // animation
  CLIPS,
  // effects
  LIGHTS,
  PARTICLE_GARDEN,
  WATER,
  WEATHER,
  FOLIAGE,
  TRAILS,
  // looks & filters
  CONSOLES,
  LAYERS,
  FILTER_BENCH,
  TRANSITIONS_ROOM,
];

registerRooms(ROOMS);
