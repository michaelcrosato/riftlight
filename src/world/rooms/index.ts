/**
 * Every room of Engine World, in wing order (the Atrium first). Add a room: write
 * `rooms/<id>.ts` exporting a `RoomDef`, list it here; the Atrium gives it a door, the room
 * list (G) a button, the e2e suite a visit.
 */
import { registerRooms } from '../shell';
import type { RoomDef } from '../types';
import { ATRIUM } from './atrium';
import { CAMERAS } from './cameras';
import { CLIPS } from './clips';
import { LIGHTS, PARTICLE_GARDEN } from './effects';
import { FEEL } from './feel';
import { CONSOLES, FILTER_BENCH, LAYERS, TRANSITIONS_ROOM } from './looks';
import { MOVES } from './moves';

export const ROOMS: readonly RoomDef[] = [
  ATRIUM,
  // movement & feel
  MOVES,
  FEEL,
  CAMERAS,
  // animation
  CLIPS,
  // effects
  LIGHTS,
  PARTICLE_GARDEN,
  // looks & filters
  CONSOLES,
  LAYERS,
  FILTER_BENCH,
  TRANSITIONS_ROOM,
];

registerRooms(ROOMS);
