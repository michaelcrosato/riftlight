// A shared world headless: the real game is one copy (the host, or a client); the test plays the other.
import { Vector3 } from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { HubSession, LocalHub } from '../../engine';
import type { Actor } from '../actors/Actor';
import { Riftlight } from '../game/Riftlight';
import { SaveStore } from '../game/save';
import { type HeadlessRiftlight, headlessRiftlight, settle } from '../headless';
import { type HeroStep, STEP } from './remote';
import { ClientWorld, HostWorld, killStandings } from './shared';

const T = 90_000;
let open: HeadlessRiftlight | null = null;
afterEach(() => {
  open?.engine.dispose();
  open = null;
});

/** The real game as copy `me` of a two-player shared world; the other copy is the test's. */
async function sharedRound(me: 0 | 1) {
  const hub = new LocalHub({ mode: 'shared-world', players: 2, seed: 4242, latencyMs: 60 });
  const session = (await HubSession.join({ mode: 'shared-world', seats: [1, 4], client: hub.client(me), autoFlush: false, clock: () => hub.now }))!;
  const game = new Riftlight({}, { store: new SaveStore(null), session });
  const h = await headlessRiftlight({ game, seed: session.info.seed });
  open = h;
  session.attach(h.engine);
  const other = hub.client(me === 0 ? 1 : 0);
  other.ready();
  const got: unknown[] = [];
  other.on('message', ((data: { b?: unknown[] }) => got.push(...(data?.b ?? []))) as never);
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
  return { hub, session, other, got, ...h, frame };
}

/** A step of the test's own hero, standing at (x, z). */
const stand = (t: number, x: number, z: number, bits = 0): HeroStep => [t, 0, 0, x, z, bits, -1, 0, x, 0, z, 0];

describe('a shared world', () => {
  it('standings go by kills, ties together', () => {
    expect(killStandings([0, 1, 2, 3], new Map([[0, 5], [1, 9], [3, 5]]))).toEqual([[1], [0, 3], [2]]);
  });

  it(
    'the host: the other player’s hero fights in its world, frames of the world go out, the boss’s fall is a team win',
    async () => {
      const r = await sharedRound(0);
      const world = r.game.round!.modes.find((m) => m instanceof HostWorld) as HostWorld;
      expect(world).toBeTruthy();
      const start = r.game.level!.start;
      await r.frame(30, (f) => r.other.send({ b: [{ h: stand(1 + f / 60, start.x + 1, start.z) }] }));
      const mate = world.remotes.get(1)!.hero!;
      expect(mate).toBeTruthy();
      const stage = r.game.stageNow()!;
      expect(stage.world.heroActors).toContain(mate.actor); // a fighter here, beside our own hero
      expect(stage.world.heroActors[0]).toBe(r.game.hero.actor); // ours stays the primary
      expect(stage.noDrops).toBe(true);
      // frames of the world reach the other copy: every monster, both heroes
      const frames = r.got.filter((m) => (m as { w?: unknown }).w) as { w: [number, number[][], number[][]] }[];
      expect(frames.length).toBeGreaterThan(2);
      const last = frames.at(-1)!.w;
      expect(last[1].length).toBe(r.game.level!.monsters().filter((m) => m.actor.alive).length);
      expect(last[2].map((h) => h[0]).sort()).toEqual([0, 1]);
      // the boss falls (to our hero): the host reports a team win, standings by kills
      const boss = r.game.level!.monsters().find((m) => m.rank === 'boss')!;
      (boss.actor as Actor).takeHit({ source: r.game.hero.actor, tags: ['test'], damage: { chaos: 1e9 }, crit: false });
      await r.frame(10);
      expect(r.hub.finished).toMatchObject({ won: true });
      expect(r.hub.finished!.standings).toEqual([[0], [1]]);
      expect(r.hub.finished!.scores).toEqual({ 0: 1, 1: 0 });
      expect(r.hub.problems).toEqual([]);
      expect(r.engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a client: the host’s monsters are puppets that go where it says and die when it says; our hero’s life is the host’s',
    async () => {
      const r = await sharedRound(1);
      const world = r.game.round!.modes.find((m) => m instanceof ClientWorld) as ClientWorld;
      expect(world).toBeTruthy();
      const units = r.game.stageNow()!.units();
      expect(units.length).toBeGreaterThan(0);
      expect(units.every((u) => u.puppet && u.actor.puppet)).toBe(true);
      const unit = units.find((u) => u.rank !== 'boss')!;
      const from = unit.actor.position.clone();
      const to = new Vector3(from.x + 1.5, 0, from.z);
      const life = unit.actor.life;
      // the host walks it 1.5 m east and takes half its life; our hero is hit to 40%
      let t = 5;
      const frameOf = (k: number) => {
        const x = from.x + 1.5 * Math.min(1, k / 30);
        return { w: [t, [[unit.actor.id, x, from.z, 0, 500]], [[1, 400, 0]], [[0, 0]], []] };
      };
      await r.frame(90, (f) => {
        if (f % 6 === 0) r.other.send({ b: [frameOf(f)] });
        t += 1 / 60;
      });
      expect(unit.actor.position.distanceTo(to)).toBeLessThan(0.5);
      expect(unit.actor.life).toBeCloseTo(life * 0.5, 0);
      expect(r.game.hero.vitals().life).toBeCloseTo(r.game.hero.vitals().maxLife * 0.4, 0);
      // a puppet's hits show but take no life: our own blows don't kill it here
      (unit.actor as Actor).takeHit({ source: r.game.hero.actor, tags: ['test'], damage: { chaos: 1e9 }, crit: false });
      expect(unit.actor.alive).toBe(true);
      // the host says it died: so it does
      r.other.send({ b: [{ d: unit.actor.id }] });
      await r.frame(5);
      expect(unit.actor.alive).toBe(false);
      // the host says our hero fell: it does, and rises again here after the wait
      r.other.send({ b: [{ w: [t + 1, [], [[1, 0, 1]], [], []] }] });
      await r.frame(5);
      expect(r.game.dead).toBe(true);
      await r.frame(4 * 60);
      expect(r.game.dead).toBe(false);
      // every step went to the host, the latest standing again
      const steps = r.got.filter((m) => (m as { h?: unknown }).h) as { h: HeroStep }[];
      expect(steps.length).toBeGreaterThan(100);
      expect(steps.some((s) => (s.h[5] & STEP.dead) !== 0)).toBe(true);
      expect((steps.at(-1)!.h[5] & STEP.dead) === 0).toBe(true);
      expect(r.engine.errors).toEqual([]);
    },
    T,
  );
});
