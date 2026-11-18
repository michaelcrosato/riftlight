/**
 * Engine World (`?game=world`, `?game=world&room=<id>`): the engine's tech demo. See
 * docs/WORLD.md.
 */
import type { EngineOptions, Game } from '../engine';
import { WORLD_TOUCH_BUTTONS } from './controls';
import { worldApi } from './api';
import { ROOMS } from './rooms';
import { RoomGame, roomById, WORLD_CAMERA } from './shell';

export { ROOMS } from './rooms';
export { RoomGame, shell, WORLD_CAMERA } from './shell';
export { worldApi } from './api';
export type { RoomDef, RoomLogic, RoomRuntime, Knob, Guide, PadDef, WingId } from './types';
export { WORLD_CONTROLS, WORLD_KEYS, WORLD_TOUCH_BUTTONS } from './controls';

/** Engine options Engine World is designed for (URL options still win). */
export const WORLD_OPTIONS: Partial<EngineOptions> = {
  aspect: 'fill',
  camera: { ...WORLD_CAMERA },
  // the hero's moves, the menu, the room list, the guide and three slots for a room's own (controls.ts)
  touchButtons: [...WORLD_TOUCH_BUTTONS],
  // no DOM ⚙: the menu's Tweak and settings has the player's settings, on a pad and a phone too
  settings: { button: false },
};

/** The first room: once the engine runs it, `window.__WORLD__` exists (and stays, room to room). */
class FirstRoom extends RoomGame {
  ready(): void {
    (globalThis as { __WORLD__?: typeof worldApi }).__WORLD__ = worldApi;
  }
}

/**
 * The first room: `args.room` (the page's `?room=<id>`), else the Atrium, entered by the door
 * `args.from` (a recording's `RoomGame.args`). Sets `window.__WORLD__` once it runs. A `room` that
 * names no room (a wing's id, a typo) opens the Atrium with a console warning.
 */
export function worldGame(args: { room?: string; from?: string | null } = worldArgsFromUrl()): Game {
  const def = roomById(args.room ?? 'atrium');
  if (!def) console.warn(`[world] ?room=${args.room} names no room (a wing's id is not one; the rooms: ROOMS in src/world/rooms, docs/WORLD.md): opening the Atrium`);
  return new FirstRoom(def ?? ROOMS[0]!, args.from ?? null);
}

/** `?room=<id>` from the page (nothing in Node). */
export function worldArgsFromUrl(search = typeof location === 'undefined' ? '' : location.search): { room?: string } {
  const room = new URLSearchParams(search).get('room');
  return room ? { room } : {};
}
