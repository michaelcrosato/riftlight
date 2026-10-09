/**
 * Every room of Engine World, in wing order (the Atrium first). Add a room: write
 * `rooms/<id>.ts` exporting a `RoomDef`, list it here; the Atrium gives it a door, the room
 * list (G) a button, the e2e suite a visit.
 */
import { registerRooms } from '../shell';
import type { RoomDef } from '../types';
import { ATRIUM } from './atrium';
import { BODIES } from './bodies';
import { BULLETS } from './bullets';
import { CAMERAS } from './cameras';
import { CLIPS } from './clips';
import { CUTSCENE } from './cutscene';
import { DESTRUCTION } from './destruction';
import { DRIFT } from './drift';
import { DUNGEON } from './dungeon';
import { LIGHTS, PARTICLE_GARDEN } from './effects';
import { FEEL } from './feel';
import { FIELDS } from './fields';
import { FLOCKS } from './flocks';
import { FOLIAGE } from './foliage';
import { JOINTS } from './joints';
import { LEGS } from './legs';
import { CONSOLES, FILTER_BENCH, LAYERS, TRANSITIONS_ROOM } from './looks';
import { MOVES } from './moves';
import { PLATFORMS } from './platforms';
import { RAGDOLLS } from './ragdolls';
import { PLANTS_ROOM } from './plants';
import { REWIND } from './rewind';
import { ROBOTS } from './robots';
import { SANDBOX } from './sandbox';
import { SHADERS } from './shaders';
import { SWARM } from './swarm';
import { VIEWS } from './views';
import { TERRAIN } from './terrain';
import { SECONDARY } from './secondary';
import { SOFT } from './soft';
import { SOUNDS } from './sounds';
import { SPRITES } from './sprites';
import { STEALTH } from './stealth';
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
  SECONDARY,
  LEGS,
  RAGDOLLS,
  SPRITES,
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
  // genres
  STEALTH,
  FLOCKS,
  DRIFT,
  BULLETS,
  // workshop
  SANDBOX,
  REWIND,
  // procedural
  TERRAIN,
  DUNGEON,
  PLANTS_ROOM,
  // rendering lab
  SWARM,
  VIEWS,
  SHADERS,
  // ai & direction
  ROBOTS,
  CUTSCENE,
  SOUNDS,
];

registerRooms(ROOMS);
