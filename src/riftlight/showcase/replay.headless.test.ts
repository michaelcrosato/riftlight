// The Hall of Beasts replays from its recording: Esc and Options pause it from recorded input
// alone, never from the page's pointer lock, which no recording holds. A run on a page whose mouse
// was locked when its Esc reached the game (stood in for here by a document with a locked pointer,
// for those frames only) replays without a page to the same state: the pause opened, Leave chosen,
// back in town. The left click that inspects is held to the same rule (showcase/headless.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentRiftlightApi, headlessRiftlight, makeRiftlight, stepUntil } from '../headless';
import type { Riftlight } from '../game/Riftlight';

const T = 90_000;
afterEach(() => void vi.unstubAllGlobals());

/** What the end of the run shows: the run's fingerprint, the showcase on screen, its pause's rows. */
const where = (game: Riftlight) => ({ fingerprint: game.fingerprint(), showcase: game.showcase.active, mode: game.showcase.mode?.id ?? null, pause: game.showcase.pause?.items ?? null });

describe('the Hall of Beasts replays', () => {
  it(
    'Esc pauses it from recorded input alone: a run whose mouse was locked replays without a page to the same pause, the same Leave and the same town',
    async () => {
      const { engine, game, rl } = await headlessRiftlight({ seed: 4242 });
      try {
        rl.newRun({ seed: 3 });
        await rl.enterDepth(1);
        engine.step(5);
        rl.killAll();
        engine.step(5);
        rl.toTown();
        engine.step(30);
        await engine.restore(await engine.snapshot()); // the recording starts at this moment, in town
        // in through the Hall's door: walk there and use it (recorded: the agent's intents)
        const door = game.town.interactables.find((i) => i.id === 'bestiary')!;
        rl.moveTo(door.position.x, door.position.z, { radius: Math.min(1.2, door.radius - 0.4) });
        rl.step(1, { interact: true });
        await stepUntil(engine, () => game.showcase.mode?.id === 'bestiary' && !game.showcase.iris, { max: 400, what: 'the Hall open' });
        engine.step(20);
        // the page's mouse locked for a first-person look (no recording holds it), and Esc
        vi.stubGlobal('document', { pointerLockElement: {}, exitPointerLock: () => {} });
        engine.step(3);
        rl.press('Escape');
        vi.unstubAllGlobals();
        expect(game.showcase.pause?.items, 'Esc paused the Hall, the mouse locked or not').toEqual(['resume', 'photo', 'leave']);
        rl.press('ArrowUp'); // Leave, the last row
        rl.press('Enter');
        await stepUntil(engine, () => !game.showcase.active, { max: 400, what: 'back in town' });
        engine.step(30);
        const live = where(game);
        expect(live.mode).toBeNull();
        const rec = JSON.parse(JSON.stringify(engine.recording())) as Parameters<typeof engine.replay>[0];
        await engine.replay(rec, () => engine.loadGame(makeRiftlight(game.store, engine.seed)));
        const replayed = currentRiftlightApi()!.game;
        expect(replayed).not.toBe(game);
        expect(where(replayed)).toEqual(live);
        expect(engine.errors).toEqual([]);
      } finally {
        engine.dispose();
      }
    },
    T,
  );
});
