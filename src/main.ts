import './style.css';
import { Engine, type EngineOptions, type Game, optionsFromUrl } from './engine';
import { DEFAULT_GAME, GAMES, gameById } from './games';

const container = document.getElementById('app')!;

/** A game made with the page's choices from the URL (`?depth=3`), as each entry reads them. */
const fromPage = (id: string): Game => {
  const entry = gameById(id)!;
  return entry.make(entry.argsFromUrl?.(location.search));
};
/** `engine.loadGame(__PIXEL_GAMES__.sandbox())`: every game of the table, by id. */
const PIXEL_GAMES: Record<string, () => Game> = Object.fromEntries(GAMES.map((g) => [g.id, () => fromPage(g.id)]));

const asked = new URLSearchParams(location.search).get('game') ?? DEFAULT_GAME;
const pick = gameById(asked) ? asked : DEFAULT_GAME;
const fromUrl = optionsFromUrl();
const own = gameById(pick)!.options;
// each game keeps its own player settings (Engine World's rooms share the world's)
const options: EngineOptions = { container, ...own, ...fromUrl, camera: { ...own.camera, ...fromUrl.camera }, settings: { ...own.settings, key: pick } };

Engine.start(fromPage(pick), options)
  .then((engine) => {
    // Handles for tests, tooling and agents: window.__PIXEL_ENGINE__.state()
    const w = window as unknown as { __PIXEL_ENGINE__: Engine; __PIXEL_GAMES__: typeof PIXEL_GAMES };
    w.__PIXEL_ENGINE__ = engine;
    w.__PIXEL_GAMES__ = PIXEL_GAMES;
  })
  .catch((error: unknown) => {
    console.error(error);
    if (container.querySelector('.fatal')) return; // Engine.start already says so on screen
    const el = document.createElement('div');
    el.className = 'fatal';
    el.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
    container.appendChild(el);
  });
