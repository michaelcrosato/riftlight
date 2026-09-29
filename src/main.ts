import './style.css';
import { Engine, optionsFromUrl } from './engine';
import { CoinGarden } from './game/coinGarden';

const container = document.getElementById('app')!;

Engine.start(new CoinGarden(), { container, ...optionsFromUrl() })
  .then((engine) => {
    // Handle for tests, tooling and agents: window.__PIXEL_ENGINE__.state()
    (window as unknown as { __PIXEL_ENGINE__: Engine }).__PIXEL_ENGINE__ = engine;
  })
  .catch((error: unknown) => {
    console.error(error);
    const el = document.createElement('div');
    el.className = 'fatal';
    el.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
    container.appendChild(el);
  });
