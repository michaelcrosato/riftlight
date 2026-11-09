import './style.css';
import { Engine, type EngineOptions, type Game, headMeta, HUB_MODES, type HubMode, HubSession, optionsFromUrl } from './engine';
import { DEFAULT_GAME, GAMES, gameById } from './games';
import { Riftlight } from './riftlight';

const container = document.getElementById('app')!;

/** A game made with the page's choices from the URL (`?depth=3`), as each entry reads them. */
const fromPage = (id: string): Game => {
  const entry = gameById(id)!;
  return entry.make(entry.argsFromUrl?.(location.search));
};
/** `engine.loadGame(__PIXEL_GAMES__.sandbox())`: every game of the table, by id. */
const PIXEL_GAMES: Record<string, () => Game> = Object.fromEntries(GAMES.map((g) => [g.id, () => fromPage(g.id)]));

/**
 * An AI Hub session (docs/game/session.md): a page built for the hub carries its session tags,
 * and the hub opens it with `?aihub=1` in a frame. Then Riftlight opens straight into the round,
 * on the hub's seed. Null for any other page or visit: the game runs as it does on its own.
 */
async function hubSession(): Promise<HubSession | null> {
  const mode = headMeta('hub:session-mode') as HubMode | null;
  if (headMeta('hub:session') !== '1' || !mode || !HUB_MODES.includes(mode)) return null;
  const [min = 1, max = min] = (headMeta('hub:session-players') ?? '1-4').match(/\d+/g)?.map(Number) ?? [];
  return HubSession.join({ mode, seats: [min, max] });
}

const session = await hubSession();
const asked = session ? 'riftlight' : (new URLSearchParams(location.search).get('game') ?? DEFAULT_GAME);
const pick = gameById(asked) ? asked : DEFAULT_GAME;
const fromUrl = optionsFromUrl();
const own = gameById(pick)!.options;
// each game keeps its own player settings (Engine World's rooms share the world's)
const options: EngineOptions = { container, ...own, ...fromUrl, camera: { ...own.camera, ...fromUrl.camera }, settings: { ...own.settings, key: pick } };
if (session) options.seed = session.info.seed; // every copy builds the same round

Engine.start(session ? new Riftlight({}, { session }) : fromPage(pick), options)
  .then((engine) => {
    session?.attach(engine);
    // Handles for tests, tooling and agents: window.__PIXEL_ENGINE__.state()
    const w = window as unknown as { __PIXEL_ENGINE__: Engine; __PIXEL_GAMES__: typeof PIXEL_GAMES };
    w.__PIXEL_ENGINE__ = engine;
    w.__PIXEL_GAMES__ = PIXEL_GAMES;
  })
  .catch((error: unknown) => {
    console.error(error);
    session?.fail(error instanceof Error ? error.message : String(error)); // this browser can't play the round
    if (container.querySelector('.fatal')) return; // Engine.start already says so on screen
    const el = document.createElement('div');
    el.className = 'fatal';
    el.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
    container.appendChild(el);
  });
