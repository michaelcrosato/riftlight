// A session round played headless: the real game against the AI Hub in memory (engine LocalHub).
import { afterEach, describe, expect, it } from 'vitest';
import { HubSession, type HubMode, LocalHub } from '../../engine';
import { Riftlight } from '../game/Riftlight';
import { SaveStore } from '../game/save';
import { type HeadlessRiftlight, headlessRiftlight, settle } from '../headless';
import { RESPAWN_SECONDS, roundDepth, roundHeroLevel } from './round';

const T = 60_000;
let open: HeadlessRiftlight | null = null;
afterEach(() => {
  open?.engine.dispose();
  open = null;
});

/** Copy 0 is the real game; the other seats are clients the test answers for. */
async function round(mode: HubMode, players = 2) {
  const hub = new LocalHub({ mode, players, seed: 4242, latencyMs: 50 });
  const session = (await HubSession.join({ mode, seats: [1, 4], client: hub.client(0), autoFlush: false }))!;
  const game = new Riftlight({}, { store: new SaveStore(null), session });
  const h = await headlessRiftlight({ game, seed: session.info.seed });
  open = h;
  session.attach(h.engine);
  for (const p of hub.players.slice(1)) hub.client(p.id).ready();
  /** One frame of the game and of the hub's clock. */
  const frame = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      h.engine.step(1);
      hub.advance(1000 / 60);
      session.flush();
      await settle();
    }
  };
  const until = async (done: () => boolean, max: number, what: string) => {
    for (let f = 0; f < max; f++) {
      if (done()) return;
      await frame();
    }
    throw new Error(`${what} did not happen within ${max} frames`);
  };
  return { hub, session, ...h, frame, until };
}

describe('a session round', () => {
  it(
    'opens straight into the level (no title, no town), readies once it is built, and waits for the start',
    async () => {
      const r = await round('parallel');
      await r.until(() => r.hub.allReady, 600, 'ready');
      const round1 = roundDepth(1);
      expect(r.game.screen).toBe('level');
      expect(r.game.level?.spec.depth).toBe(round1);
      expect(r.game.save.hero.level).toBe(roundHeroLevel(round1));
      expect(r.game.save.seed).toBe(r.session.info.seed);
      expect(r.game.layer.top).toBeFalsy(); // no menus
      // frozen before the start: the hero can't move and the level's clock stands still
      const at = r.game.hero.actor.position.clone();
      const east = { move: { x: 1, z: 0 }, aim: [at.x + 5, at.y, at.z] } as never;
      r.rl.step(30, east);
      expect(r.game.hero.actor.position.distanceTo(at)).toBeLessThan(1e-6);
      expect(r.game.levelTime).toBe(0);
      // the hub's start: three seconds of countdown in game time, then play
      r.hub.start();
      await r.frame(60);
      expect(r.game.round!.phase).toBe('countdown');
      await r.until(() => r.game.round!.phase === 'playing', 200, 'play');
      expect(r.game.round!.playTime).toBeLessThan(0.1);
      r.rl.step(30, east); // the same input moves the hero once play is on
      expect(r.game.hero.actor.position.distanceTo(at)).toBeGreaterThan(1);
      expect(r.engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'parallel: progress while playing, then a clear time when the boss falls',
    async () => {
      const r = await round('parallel');
      await r.until(() => r.hub.allReady, 600, 'ready');
      r.hub.start();
      await r.until(() => r.game.round!.playing, 300, 'play');
      r.rl.bot.start();
      for (let f = 0; f < 10_800 && r.game.round!.clearedAt === null; f++) {
        r.rl.bot.advance(1);
        r.hub.advance(1000 / 60);
        await settle();
      }
      expect(r.game.round!.clearedAt).not.toBeNull();
      const result = r.hub.results.get(0)!;
      expect(result.time).toBeGreaterThan(5000);
      expect(result.stats).toMatchObject({ kills: r.game.session.kills, depth: 1 });
      expect(r.hub.progress.get(0)!.score).toBeGreaterThan(0);
      expect(r.hub.client(0).stats.sent).toBe(0); // parallel copies send nothing
      expect(r.engine.errors).toEqual([]);
    },
    T * 2,
  );

  it(
    'time-up reports the score; a death brings the hero back instead of ending the round; the end quiets the game',
    async () => {
      const r = await round('parallel');
      await r.until(() => r.hub.allReady, 600, 'ready');
      r.hub.start();
      await r.until(() => r.game.round!.playing, 300, 'play');
      // a fall: no recap, no town; up again at the start after a moment
      r.game.hero.actor.takeHit({ source: r.game.hero.actor, tags: ['test'], damage: { chaos: 1e9 }, crit: false });
      await r.frame(5);
      expect(r.game.dead).toBe(true);
      await r.frame(Math.ceil(RESPAWN_SECONDS * 60) + 30);
      expect(r.game.dead).toBe(false);
      expect(r.game.screen).toBe('level');
      expect(r.game.layer.has('death')).toBe(false);
      expect(r.game.hero.vitals().life).toBe(r.game.hero.vitals().maxLife);
      // the hub calls time: a score (not a time) goes back at once
      r.hub.timeUp();
      await r.frame(2);
      expect(r.hub.results.get(0)).toMatchObject({ score: expect.any(Number), stats: { deaths: 1 } });
      expect(r.hub.results.get(0)!.time).toBeUndefined();
      r.hub.end();
      await r.frame(2);
      expect(r.game.round!.phase).toBe('ended');
      expect(r.engine.timeScale).toBe(0); // still, and quiet
      expect(r.engine.errors).toEqual([]);
    },
    T,
  );
});
