// Engine World headless, for tests: one engine per test file (the World shell is one per process),
// rooms loaded one after another with `__WORLD__.goto`, as a page does. Node only: imports node.ts.
import type { Engine } from '../engine';
import { headlessGame } from '../riftlight/headless';
import { worldApi, WORLD_OPTIONS, worldGame } from './index';
import type { RoomGame } from './shell';

/** How long a World test may take: boots and room loads are a few hundred ms each in Node. */
export const WORLD_T = 30_000;

/** Engine World headless, first in `room` (the Atrium by default). Dispose the engine when done. */
export async function headlessWorld(room = 'atrium', seed = 1): Promise<{ engine: Engine; w: typeof worldApi }> {
  const engine = await headlessGame(worldGame({ room, from: null }), { ...WORLD_OPTIONS, seed });
  return { engine, w: worldApi };
}

/** The room's own hooks (`logic.api`), untyped as the e2e suite used them (each room has its own). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RoomApi = any;
export function roomApi(w: typeof worldApi): RoomApi {
  return w.room as unknown as RoomApi;
}

/** The room on screen (`engine.game`). */
export function roomGame(engine: Engine): RoomGame {
  return engine.game as RoomGame;
}

/** Put the hero at `at` facing `facing` (the room's visitor). */
export function teleport(engine: Engine, at: [number, number, number], facing = 0): void {
  roomGame(engine).visitor!.teleport(at, facing);
}

/** Push the stick (the analog input) along the ground direction (dx, dz), camera-relative as movement is. */
export function stick(engine: Engine, dx: number, dz: number): void {
  const { right, forward } = engine.camera.groundBasis();
  engine.input.analog.x = dx * right.x + dz * right.z;
  engine.input.analog.y = dx * forward.x + dz * forward.z;
}

/** Let go of the stick. */
export function release(engine: Engine): void {
  engine.input.analog.x = engine.input.analog.y = 0;
}
