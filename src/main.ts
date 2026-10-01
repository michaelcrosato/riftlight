import './style.css';
import { Engine, type Game, optionsFromUrl } from './engine';
import { Playground } from './game/playground';
import { Sandbox } from './game/sandbox';

const container = document.getElementById('app')!;

/** Levels this page can run: `?game=sandbox`, or `engine.loadGame(__PIXEL_GAMES__.sandbox())`. */
const GAMES: Record<string, () => Game> = {
  playground: () => new Playground(),
  sandbox: () => new Sandbox(),
};
const pick = new URLSearchParams(location.search).get('game') ?? 'playground';

Engine.start((GAMES[pick] ?? GAMES.playground!)(), { container, ...optionsFromUrl() })
  .then((engine) => {
    // Handles for tests, tooling and agents: window.__PIXEL_ENGINE__.state()
    const w = window as unknown as { __PIXEL_ENGINE__: Engine; __PIXEL_GAMES__: typeof GAMES };
    w.__PIXEL_ENGINE__ = engine;
    w.__PIXEL_GAMES__ = GAMES;
  })
  .catch((error: unknown) => {
    console.error(error);
    const el = document.createElement('div');
    el.className = 'fatal';
    el.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
    container.appendChild(el);
  });
