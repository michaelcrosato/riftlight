// Ghost mode headless: the real game is copy 0; the test plays copy 1 by sending its hero's steps.
import { afterEach, describe, expect, it } from 'vitest';
import { HubSession, LocalHub } from '../../engine';
import { Riftlight } from '../game/Riftlight';
import { SaveStore } from '../game/save';
import { type HeadlessRiftlight, headlessRiftlight, settle } from '../headless';
import { GhostMode } from './ghosts';
import { type HeroStep, STEP } from './remote';

const T = 60_000;
let open: HeadlessRiftlight | null = null;
afterEach(() => {
  open?.engine.dispose();
  open = null;
});

async function ghostRound() {
  const hub = new LocalHub({ mode: 'ghost', players: 2, seed: 4242, latencyMs: 80 });
  const session = (await HubSession.join({ mode: 'ghost', seats: [1, 4], client: hub.client(0), autoFlush: false, clock: () => hub.now }))!;
  const game = new Riftlight({}, { store: new SaveStore(null), session });
  const h = await headlessRiftlight({ game, seed: session.info.seed });
  open = h;
  session.attach(h.engine);
  hub.client(1).ready();
  const frame = async (n = 1, each?: (f: number) => void) => {
    for (let i = 0; i < n; i++) {
      each?.(i);
      h.engine.step(1);
      hub.advance(1000 / 60);
      session.flush();
      await settle();
    }
  };
  for (let f = 0; f < 600 && !hub.allReady; f++) await frame();
  hub.start();
  for (let f = 0; f < 300 && !game.round!.playing; f++) await frame();
  return { hub, session, ...h, frame };
}

describe('ghost mode', () => {
  it(
    'sends our hero, shows theirs where they walk, and their ghost touches nothing here',
    async () => {
      const r = await ghostRound();
      expect(r.game.round!.playing).toBe(true);
      const ghosts = r.game.round!.modes.find((m) => m instanceof GhostMode) as GhostMode;
      expect(ghosts.remotes.has(1)).toBe(true);
      const start = r.game.level!.start;
      const lives = () => r.game.level!.monsters().map((m) => m.actor.life);
      const before = lives();
      // copy 1's hero walks east swinging, one step per frame of its clock
      const t0 = 10;
      const step = (f: number): HeroStep => [t0 + f / 60, 1, 0, start.x + 5, start.z, STEP.attack, f % 40 === 0 ? 0 : -1, 0, start.x + f * 0.03, start.y, start.z, Math.PI / 2];
      let sent = 0;
      await r.frame(120, (f) => {
        r.hub.client(1).send({ b: [{ h: step(f) }] });
        sent = f;
      });
      await r.frame(30);
      const remote = ghosts.remotes.get(1)!;
      expect(remote.hero).not.toBeNull();
      expect(remote.shown(r.game.ctx.time)).toBe(true);
      const at = remote.hero!.actor.position;
      expect(Math.abs(at.x - (start.x + sent * 0.03))).toBeLessThan(1); // where its player walked, a moment behind
      expect(Math.abs(at.z - start.z)).toBeLessThan(0.6);
      // a ghost fights in a world of its own: not among the level's actors, and no monster lost life to it
      expect(r.game.level!.actors().includes(remote.hero!.actor as never)).toBe(false);
      expect(lives()).toEqual(before);
      // and our own hero went to copy 1, step by step
      expect(r.hub.client(0).stats.sent).toBeGreaterThan(5);
      expect(r.hub.client(0).stats.refused).toBe(0);
      expect(r.engine.errors).toEqual([]);
      // a player who leaves takes their ghost along
      r.hub.leave(1);
      await r.frame(2);
      expect(ghosts.remotes.has(1)).toBe(false);
    },
    T,
  );
});
