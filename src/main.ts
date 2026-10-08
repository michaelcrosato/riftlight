import './style.css';
import { Engine, type EngineOptions, type Game, optionsFromUrl } from './engine';
import { Playground } from './game/playground';
import { Sandbox } from './game/sandbox';
import { Riftlight, RIFTLIGHT_OPTIONS } from './riftlight';
import { LootLab } from './riftlight/loot/lootlab';
import { LevelLab } from './riftlight/levels/levelLab';
import { Arena } from './riftlight/combat/arena';
import { ARCADE_OPTIONS, ArcadeGame } from './riftlight/showcase/arcade/ArcadeGame';

const container = document.getElementById('app')!;

/**
 * Games this page can run: `/` is Riftlight, `?game=playground`, `?game=sandbox`, or
 * `engine.loadGame(__PIXEL_GAMES__.sandbox())`. One line per game (keep it a plain map).
 */
const GAMES: Record<string, () => Game> = {
  riftlight: () => new Riftlight(),
  playground: () => new Playground(),
  sandbox: () => new Sandbox(),
  lootlab: () => new LootLab(),
  levellab: () => new LevelLab(), // Riftlight levels: ?game=levellab&depth=N
  arena: () => new Arena(),
  arcade: () => new ArcadeGame(), // Riftlight's arcade cabinet on its own: a side-scroller template
};
/** Engine options a game is designed for (URL options still win). */
const OPTIONS: Record<string, Partial<EngineOptions>> = {
  riftlight: RIFTLIGHT_OPTIONS,
  arcade: ARCADE_OPTIONS,
};
const DEFAULT_GAME = 'riftlight';

const asked = new URLSearchParams(location.search).get('game') ?? DEFAULT_GAME;
const pick = GAMES[asked] ? asked : DEFAULT_GAME;
const fromUrl = optionsFromUrl();
const own = OPTIONS[pick] ?? {};
const options: EngineOptions = { container, ...own, ...fromUrl, camera: { ...own.camera, ...fromUrl.camera } };

Engine.start(GAMES[pick]!(), options)
  .then((engine) => {
    // Handles for tests, tooling and agents: window.__PIXEL_ENGINE__.state()
    const w = window as unknown as { __PIXEL_ENGINE__: Engine; __PIXEL_GAMES__: typeof GAMES };
    w.__PIXEL_ENGINE__ = engine;
    w.__PIXEL_GAMES__ = GAMES;
  })
  .catch((error: unknown) => {
    console.error(error);
    if (container.querySelector('.fatal')) return; // Engine.start already says so on screen
    const el = document.createElement('div');
    el.className = 'fatal';
    el.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
    container.appendChild(el);
  });
