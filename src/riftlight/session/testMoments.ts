// Tests' side of Riftlight's moments: one moment played headless against the hub in memory (engine
// LocalHub) on a few of the hub's seeds, a decent player (the playtest bot; a run for the spot) and
// an idle one. Each moment has a test file of its own (`moments.<id>.test.ts`), so they run side by
// side. The numbers in session/moments.ts were measured the same way over seeds 1-6. Node only.
import { afterEach, describe, expect, it } from 'vitest';
import { headlessMoment, type HeadlessRiftlight, playMoment } from '../headless';
import { momentById } from './moments';

/** The hub's seeds each moment is played on, decent and idle. */
export const MOMENT_SEEDS = [1, 2, 3];

/** Moment `id`'s test: on each seed, a decent player clears it and an idle one fails it; one result each, nothing sent. */
export function playEachSeed(id: string): void {
  const m = momentById(id);
  if (!m) throw new Error(`playEachSeed: no moment ${id}`);
  let open: HeadlessRiftlight | null = null;
  afterEach(() => {
    open?.engine.dispose();
    open = null;
  });
  describe(`moment ${m.id}`, () => {
    it(
      `${m.verb} ${m.seconds} s: a decent player clears it; idle, it is failed; one result each, nothing sent (seeds ${MOMENT_SEEDS.join(', ')})`,
      async () => {
        for (const seed of MOMENT_SEEDS) {
          const decent = (open = await headlessMoment(m, { seed }));
          const won = await playMoment(decent, 'decent');
          expect(won, `${m.id}, seed ${seed}: the decent player's result`).toMatchObject({ won: true });
          expect(won!.time).toBeGreaterThan(0);
          expect(won!.time).toBeLessThanOrEqual(m.seconds * 1000);
          expect(decent.game.round!.outcome).toBe('cleared');
          expect(decent.hub.client(0).stats.sent).toBe(0); // moments send nothing
          expect(decent.hub.progress.size).toBe(0); // and show no progress
          expect(decent.hub.problems).toEqual([]);
          expect(decent.engine.errors).toEqual([]);
          decent.engine.dispose();

          const idle = (open = await headlessMoment(m, { seed }));
          const lost = await playMoment(idle, 'idle');
          expect(lost, `${m.id}, seed ${seed}: the idle player's result`).toMatchObject({ won: false });
          expect(idle.game.round!.outcome).toBe('failed');
          expect(idle.hub.problems).toEqual([]);
          idle.engine.dispose();
          open = null;
        }
      },
      180_000 * MOMENT_SEEDS.length,
    );
  });
}
