// Riftlight's moments: the tags the hub reads, and each moment played headless against the hub in
// memory (engine LocalHub) by a decent player (the playtest bot; a run for the spot) and idle.
import { afterEach, describe, expect, it } from 'vitest';
import { HubSession, LocalHub } from '../../engine';
import { Riftlight } from '../game/Riftlight';
import { SaveStore } from '../game/save';
import { type HeadlessRiftlight, headlessRiftlight, settle } from '../headless';
import { MOMENTS, type MomentSpec, momentGoal, momentTags } from './moments';

const T = 90_000;
let open: HeadlessRiftlight | null = null;
afterEach(() => {
  open?.engine.dispose();
  open = null;
});

/** The hub's own reader of hub:moment tags (scripts/hub/harness/round.js, vendored unmodified from 52in1.com/lib/hub). */
type HubRound = { MOMENTS: { least: number }; parseMoments(tags: string[]): { moments: { id: string }[]; problems: string[] } };
const hubRound = (): Promise<HubRound> => import(/* @vite-ignore */ new URL('../../../scripts/hub/harness/round.js', import.meta.url).href) as Promise<HubRound>;

/** Frames a player takes to react to Go (0.4 s). */
const REACT = 24;

/** Every online mode the hand-over page offers: the hub picks moments. */
const OFFERED = ['shared-world', 'ghost', 'parallel', 'moments'] as const;

/** The real game as the one copy of a moment, ready and counted down: play begins on the hub's clock. */
async function moment(m: MomentSpec, seed = 4242) {
  const hub = new LocalHub({ mode: 'moments', moment: { id: m.id, seconds: m.seconds }, players: 1, seed });
  const session = (await HubSession.join({ mode: OFFERED, seats: [1, 4], client: hub.client(0), autoFlush: false, clock: () => hub.now }))!;
  const game = new Riftlight({}, { store: new SaveStore(null), session });
  const h = await headlessRiftlight({ game, seed: session.info.seed });
  open = h;
  session.attach(h.engine);
  /** One frame of the game (`step`: how it moves) and of the hub's clock. */
  const frame = async (step = () => h.engine.step(1)) => {
    step();
    hub.advance(1000 / 60);
    session.flush();
    await settle();
  };
  for (let f = 0; f < 600 && !hub.allReady; f++) await frame();
  expect(hub.allReady).toBe(true);
  return { hub, session, ...h, frame };
}

/** Play until the hub has this player's result (or the round ended), a frame at a time. */
async function play(r: Awaited<ReturnType<typeof moment>>, how: 'decent' | 'idle', m: MomentSpec) {
  r.hub.start();
  for (let f = 0; f < 400 && !r.game.round!.playing; f++) await r.frame();
  r.rl.bot.start();
  const spot = r.game.momentAim?.spot;
  let frames = 0;
  const step =
    how === 'idle'
      ? undefined
      : m.clear === 'escape'
        ? () => void (frames++ < REACT ? r.engine.step(1) : r.rl.moveTo(spot!.x, spot!.z, { radius: 1, maxFrames: 1 })) // run for it, a beat after Go
        : () => void r.rl.bot.advance(1); // fight it out
  for (let f = 0; f < (m.seconds + 4) * 60 && !r.hub.results.has(0) && !r.hub.endReason; f++) await r.frame(step);
  return r.hub.results.get(0);
}

describe('moments', () => {
  it('the page’s hub:moment tags read as the hub reads them: at least three, each ID VERB SECONDS GOAL', async () => {
    const tags = momentTags();
    const hub = await hubRound();
    const { moments, problems } = hub.parseMoments(tags);
    expect(problems).toEqual([]);
    expect(moments.length).toBeGreaterThanOrEqual(hub.MOMENTS.least);
    expect(moments.map((m) => m.id)).toEqual(MOMENTS.map((m) => m.id));
    expect(tags[0]).toBe('vorgath defeat 20 Defeat Vorgath, the Emberhide'); // the boss's English name in the tag
    for (const m of MOMENTS) {
      expect(momentGoal(m)).not.toMatch(/[{}]/); // its goal shown in the game, the name filled in
      expect(m.depth).toBeGreaterThanOrEqual(1);
    }
  });

  it(
    'opens straight into the moment’s set-up (no title, menus or town), still until play begins',
    async () => {
      const m = MOMENTS.find((x) => x.id === 'vorgath')!;
      const r = await moment(m);
      expect(r.session.info).toMatchObject({ mode: 'moments', moment: 'vorgath', limitMs: 20_000 });
      expect(r.game.screen).toBe('level');
      expect(r.game.level?.spec.depth).toBe(m.depth);
      expect(r.game.save.hero.level).toBe(m.heroLevel);
      expect(r.game.layer.top).toBeFalsy();
      const boss = r.game.level!.monsters().find((x) => x.rank === 'boss')!;
      const d = r.game.hero.actor.position.distanceTo(boss.actor.position);
      expect(d).toBeGreaterThan(m.back - 1.5);
      expect(d).toBeLessThan(m.back + 1.5);
      const at = r.game.hero.actor.position.clone();
      r.rl.step(30, { move: { x: 1, z: 0 } } as never);
      expect(r.game.hero.actor.position.distanceTo(at)).toBeLessThan(1e-6); // set up and still
      expect(r.game.round!.phase).toBe('waiting');
      expect(r.engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the same set-up on every copy: the hub’s seed for the moment makes it, and nothing else',
    async () => {
      const m = MOMENTS.find((x) => x.id === 'crypt-hall')!;
      const setUp = async (seed: number) => {
        const r = await moment(m, seed);
        const print = [r.game.save.seed, r.game.hero.actor.position.toArray().join(','), ...r.game.level!.monsters().map((x) => `${x.name} ${x.actor.position.toArray().join(',')}`)].join('|');
        open?.engine.dispose();
        open = null;
        return print;
      };
      const a = await setUp(777);
      expect(await setUp(777)).toBe(a);
      expect(await setUp(778)).not.toBe(a); // another round's moment: another run seed, other monsters
    },
    T,
  );

  for (const m of MOMENTS) {
    it(
      `${m.id} (${m.verb} ${m.seconds} s): a decent player clears it; idle, it is failed; one result each, nothing sent`,
      async () => {
        const decent = await moment(m);
        const won = await play(decent, 'decent', m);
        expect(won, `${m.id}: the decent player's result`).toMatchObject({ won: true });
        expect(won!.time).toBeGreaterThan(0);
        expect(won!.time).toBeLessThanOrEqual(m.seconds * 1000);
        expect(decent.game.round!.outcome).toBe('cleared');
        expect(decent.hub.client(0).stats.sent).toBe(0); // moments send nothing
        expect(decent.hub.progress.size).toBe(0); // and show no progress
        expect(decent.hub.problems).toEqual([]);
        expect(decent.engine.errors).toEqual([]);
        decent.engine.dispose();
        open = null;

        const idle = await moment(m);
        const lost = await play(idle, 'idle', m);
        expect(lost, `${m.id}: the idle player's result`).toMatchObject({ won: false });
        expect(idle.game.round!.outcome).toBe('failed');
        expect(idle.hub.problems).toEqual([]);
      },
      T * 2,
    );
  }

  it(
    'time-up: a moment to defeat is failed, one to survive is cleared; reported at once, within the grace',
    async () => {
      const defeat = await moment(MOMENTS.find((x) => x.clear === 'defeat')!);
      defeat.hub.start();
      for (let f = 0; f < 400 && !defeat.game.round!.playing; f++) await defeat.frame();
      defeat.hub.timeUp();
      await defeat.frame();
      await defeat.frame();
      expect(defeat.hub.results.get(0)).toMatchObject({ won: false });
      defeat.engine.dispose();
      open = null;

      const survive = await moment(MOMENTS.find((x) => x.clear === 'survive')!);
      survive.hub.start();
      for (let f = 0; f < 400 && !survive.game.round!.playing; f++) await survive.frame();
      for (let f = 0; f < 60; f++) await survive.frame();
      survive.hub.timeUp();
      await survive.frame();
      await survive.frame();
      expect(survive.hub.results.get(0)).toMatchObject({ won: true });
      expect(survive.game.round!.outcome).toBe('cleared');
    },
    T,
  );

  it(
    'a recorded moment replays with no hub behind it: the same set-up, the same outcome, the same fingerprint',
    async () => {
      const m = MOMENTS.find((x) => x.id === 'gale-escape')!;
      const r = await moment(m);
      await play(r, 'idle', m);
      expect(r.game.round!.outcome).toBe('failed');
      const live = r.engine.fingerprint();
      const rec = r.engine.recording()!;
      await r.engine.replay(rec, () => r.engine.loadGame(new Riftlight({}, { store: new SaveStore(null) })));
      const replayed = r.engine.game as Riftlight;
      expect(replayed.round?.moment?.id).toBe('gale-escape');
      expect(replayed.round?.outcome).toBe('failed');
      expect(r.engine.fingerprint()).toBe(live);
    },
    T,
  );
});
