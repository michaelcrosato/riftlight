/**
 * Every game this repository runs, in one table: the page (`src/main.ts`, `?game=<id>`) starts one
 * from it, and `npm run replay` rebuilds the game a recording was made in (by `rec.game`, the
 * `Game.name`, and `rec.args`, its `Game.args`) with the options it was designed for: without
 * them (its camera above all) a replay would aim through another camera.
 */
import type { EngineOptions, Game } from './engine';
import { Playground } from './game/playground';
import { Sandbox } from './game/sandbox';
import { Riftlight, RIFTLIGHT_OPTIONS } from './riftlight';
import { LootLab } from './riftlight/loot/lootlab';
import { LevelLab, type LevelLabOptions } from './riftlight/levels/levelLab';
import { Arena, type ArenaOptions } from './riftlight/combat/arena';
import { ARCADE_OPTIONS, ArcadeGame } from './riftlight/showcase/arcade/ArcadeGame';
import { ROOMS, WORLD_OPTIONS, worldArgsFromUrl, worldGame } from './world';

export interface GameEntry {
  /** `?game=<id>`. */
  readonly id: string;
  /** The `Game.name` of what `make` returns (Engine World's rooms: `Engine World: <title>`). */
  readonly name: string;
  /** Engine options the game is designed for (a page's URL options still win). */
  readonly options: Partial<EngineOptions>;
  /** The page's choices (`?depth=3`) as the args `make` takes; none: the game reads no URL. */
  readonly argsFromUrl?: (search: string) => unknown;
  /** A new game; `args` as the game's own `Game.args` holds them. */
  make(args?: unknown): Game;
}

export const GAMES: readonly GameEntry[] = [
  { id: 'riftlight', name: 'Riftlight', options: RIFTLIGHT_OPTIONS, make: () => new Riftlight() },
  { id: 'playground', name: 'Move Playground', options: {}, make: () => new Playground() },
  { id: 'sandbox', name: 'Sandbox', options: {}, make: () => new Sandbox() },
  { id: 'lootlab', name: 'Loot Lab', options: {}, make: () => new LootLab() },
  // Riftlight levels: ?game=levellab&depth=N
  { id: 'levellab', name: 'Riftlight Level Lab', options: {}, argsFromUrl: LevelLab.optionsFromUrl, make: (args) => new LevelLab(args as LevelLabOptions) },
  { id: 'arena', name: 'Riftlight Arena', options: {}, argsFromUrl: Arena.optionsFromUrl, make: (args) => new Arena(args as ArenaOptions) },
  // Riftlight's arcade cabinet on its own: a side-scroller template
  { id: 'arcade', name: 'Rift Runner', options: ARCADE_OPTIONS, make: () => new ArcadeGame() },
  // Engine World: the engine's tech demo, a room per technique (&room=<id>)
  { id: 'world', name: 'Engine World', options: WORLD_OPTIONS, argsFromUrl: (search) => worldArgsFromUrl(search), make: (args) => worldGame(args as { room?: string; from?: string | null }) },
];

export const DEFAULT_GAME = 'riftlight';

export function gameById(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id);
}

const ROOM_PREFIX = 'Engine World: ';

/**
 * What rebuilds a recorded game: its entry and a `make` with the recording's args. By `Game.name`;
 * a room by its title (each is unique) when the recording carries no args. Null: no such game here.
 */
export function gameForRecording(rec: { readonly game: string; readonly args?: unknown }): { entry: GameEntry; make: () => Game } | null {
  if (rec.game.startsWith(ROOM_PREFIX)) {
    const entry = gameById('world')!;
    const room = ROOMS.find((r) => r.title === rec.game.slice(ROOM_PREFIX.length));
    if (!room) return null;
    const args = (rec.args ?? { room: room.id }) as { room?: string; from?: string | null };
    return { entry, make: () => entry.make(args) };
  }
  const entry = GAMES.find((g) => g.name === rec.game);
  return entry ? { entry, make: () => entry.make(rec.args) } : null;
}
