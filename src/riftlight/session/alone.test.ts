// The online modes Riftlight names with a 1 (`hub:multiplayer`: shared-world co-op 1-4, ghost 1-4,
// parallel 1-4, moments 1-4) can be played by one person alone, as the catalogue's *Playing
// together* says MIN 1 means. 52in1's own check (hub-check) plays a shared world and a ghost round
// at 2 to 4 players only, so these play each alone here: the round starts with nobody else, the
// lone hero fells the boss, and the round finishes with that player first, nothing wrong.
import { describe, expect, it } from 'vitest';
import { HubSession, LocalHub } from '../../engine';
import type { Actor } from '../actors/Actor';
import { Riftlight } from '../game/Riftlight';
import { SaveStore } from '../game/save';
import { headlessRiftlight, settle } from '../headless';
import { HostWorld } from './shared';

const T = 60_000;

describe('one player alone in each online mode that names 1', () => {
  for (const [mode, play] of [
    ['shared-world', 'co-op'],
    ['ghost', undefined],
    ['parallel', undefined],
  ] as const) {
    it(
      `${mode}${play ? ` ${play}` : ''}: the round starts with nobody else, the lone hero fells the boss, the round finishes with them first`,
      async () => {
        const hub = new LocalHub({ mode, ...(play ? { play } : {}), players: 1, seed: 5151, latencyMs: 60 });
        const session = (await HubSession.join({ mode: ['shared-world', 'ghost', 'parallel', 'moments'], seats: [1, 4], client: hub.client(0), autoFlush: false, clock: () => hub.now }))!;
        expect([session.info.mode, session.info.players.length]).toEqual([mode, 1]);
        const game = new Riftlight({}, { store: new SaveStore(null), session });
        const h = await headlessRiftlight({ game, seed: session.info.seed });
        try {
          session.attach(h.engine);
          const frame = async (n = 1) => {
            for (let i = 0; i < n; i++) {
              h.engine.step(1);
              hub.advance(1000 / 60);
              session.flush();
              await settle();
            }
          };
          for (let f = 0; f < 600 && !hub.allReady; f++) await frame();
          expect(hub.allReady, 'ready with no key press').toBe(true);
          hub.start();
          for (let f = 0; f < 300 && !game.round!.playing; f++) await frame();
          expect(game.round!.playing, 'playing alone').toBe(true);
          if (mode === 'shared-world') expect(game.round!.modes.some((m) => m instanceof HostWorld), 'the lone player hosts the world').toBe(true);
          await frame(30);
          const boss = game.level!.monsters().find((m) => m.rank === 'boss');
          expect(boss, 'the boss stands').toBeDefined();
          (boss!.actor as Actor).takeHit({ source: game.hero.actor, tags: ['test'], damage: { chaos: 1e9 }, crit: false });
          for (let f = 0; f < 120 && !hub.endReason; f++) await frame();
          expect(hub.endReason, 'finished').toBe('finished');
          expect(hub.standings(), 'the lone player first').toEqual([[0]]);
          if (mode === 'shared-world') expect(hub.finished, 'co-op alone: a team win').toMatchObject({ won: true });
          else expect(hub.results.get(0)?.time, 'the boss felled: a time, the race’s result').toEqual(expect.any(Number));
          expect(hub.problems).toEqual([]);
          expect(h.engine.errors).toEqual([]);
        } finally {
          h.engine.dispose();
        }
      },
      T,
    );
  }
});
