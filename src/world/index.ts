/**
 * Engine World (`?game=world`, `?game=world&room=<id>`): the engine's tech demo. See
 * docs/WORLD.md.
 */
import { DEFAULT_TOUCH_BUTTONS, type EngineOptions, type Game } from '../engine';
import { worldApi } from './api';
import { ROOMS } from './rooms';
import { RoomGame, roomById, WORLD_CAMERA } from './shell';

export { ROOMS } from './rooms';
export { RoomGame, shell, WORLD_CAMERA } from './shell';
export { worldApi } from './api';
export type { RoomDef, RoomLogic, RoomRuntime, Knob, Guide, PadDef, WingId } from './types';

/** Engine options Engine World is designed for (URL options still win). */
export const WORLD_OPTIONS: Partial<EngineOptions> = {
  aspect: 'fill',
  camera: { ...WORLD_CAMERA },
  touchButtons: [...DEFAULT_TOUCH_BUTTONS, { label: '?', code: 'KeyH', hint: 'how it works' }, { label: 'GO', code: 'KeyG', hint: 'rooms' }],
};

/** The first room: `?room=<id>`, else the Atrium. Also sets `window.__WORLD__`. */
export function worldGame(): Game {
  let id = 'atrium';
  try {
    id = new URLSearchParams(location.search).get('room') ?? id;
  } catch {
    /* no location (tools) */
  }
  (globalThis as { __WORLD__?: typeof worldApi }).__WORLD__ = worldApi;
  const def = roomById(id) ?? ROOMS[0]!;
  return new RoomGame(def, null);
}
