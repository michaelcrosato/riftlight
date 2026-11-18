// Riftlight's moments: the tags the hub reads, the set-up, time-up, the end and a replay, played
// headless against the hub in memory (engine LocalHub); each moment cleared by a decent player and
// failed idle is its own file, moments.<id>.test.ts (session/testMoments.ts).
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { bfs } from '../game/nav';
import { Riftlight } from '../game/Riftlight';
import { type KeyValueStore, SaveStore } from '../game/save';
import { type HeadlessMoment, headlessMoment, type HeadlessRiftlight, playMoment } from '../headless';
import { t } from '../lang';
import { BANNER_WORDS, bannerOpen } from '../ui/hud';
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

/** A moment headless (its copy and the hub in memory), closed after the test. */
async function moment(m: MomentSpec, seed = 4242, store = new SaveStore(null)): Promise<HeadlessMoment> {
  const r = await headlessMoment(m, { seed, store });
  open = r;
  return r;
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
      expect(existsSync(new URL(`./moments.${m.id}.test.ts`, import.meta.url)), `${m.id} is played decent and idle: moments.${m.id}.test.ts`).toBe(true);
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

  it(
    'an escape’s way out is clear: no other pack near the hero’s start or the way to the ring, which is in sight along it',
    async () => {
      for (const m of MOMENTS.filter((x) => x.clear === 'escape')) {
        const r = await moment(m);
        const level = r.game.level!;
        const aim = r.game.momentAim!;
        const spot = aim.spot!;
        const hero = r.game.hero.actor.position;
        const L = level.layout;
        expect(L.cell(Math.floor(spot.x), Math.floor(spot.z)), `${m.id}: the ring is on the floor`).toBe(1);
        const way = bfs(L, { x: Math.floor(hero.x), z: Math.floor(hero.z) }, { x: Math.floor(spot.x), z: Math.floor(spot.z) }).map((c) => ({ x: c.x + 0.5, z: c.z + 0.5 }));
        const straight = Math.hypot(spot.x - hero.x, spot.z - hero.z);
        expect(straight, `${m.id}: a run, not a step`).toBeGreaterThan(8);
        expect(way.length, `${m.id}: the way to the ring goes where its arrow points (no wall between)`).toBeLessThanOrEqual(Math.ceil(straight * 1.25) + 1);
        const others = level.monsters().filter((x) => !aim.targets.includes(x));
        const nearest = Math.min(...[{ x: hero.x, z: hero.z }, ...way].flatMap((p) => others.map((o) => Math.hypot(o.actor.position.x - p.x, o.actor.position.z - p.z))));
        expect(nearest, `${m.id}: the nearest monster of another pack to the hero's start or the way out`).toBeGreaterThan(15);
        r.engine.dispose();
        open = null;
      }
    },
    T,
  );

  it(
    'a moment’s end: its clear sounds once, its banner shows its words though the hub ends the moment at once, the saves are untouched, and no save-state is taken',
    async () => {
      const writes: string[] = [];
      const storage: KeyValueStore = { getItem: () => null, setItem: (key) => void writes.push(key), removeItem: (key) => void writes.push(key) };
      const m = MOMENTS.find((x) => x.id === 'vorgath')!;
      const r = await moment(m, 4242, new SaveStore(storage));
      expect(() => r.game.snapshot()).toThrow(/52in1 round/); // its state is the hub's too: it replays from its recording
      const won = await playMoment(r, 'decent');
      expect(won).toMatchObject({ won: true });
      expect(r.hub.endReason).toBe('finished'); // the one result in: the hub ends the moment at once
      for (let f = 0; f < 30; f++) await r.frame();
      expect(r.engine.timeScale).toBe(0); // and the end stills the game
      const card = (r.game as unknown as { banners: { current: { title: string; age: number; duration: number } | null } }).banners.current!;
      expect(card.title).toBe(t('round.moment_cleared'));
      expect(bannerOpen(card)).toBeGreaterThanOrEqual(BANNER_WORDS); // open, its words shown, not stopped while opening
      expect(r.engine.audio.counts['rl.clear']).toBe(1); // the boss's fall clears the level and the moment: one sound
      expect(writes).toEqual([]); // the round's throwaway run never reaches the player's slots
      expect(new Riftlight({}, { session: r.session }).store.volatile).toBe(true); // a session's store is memory only
    },
    T,
  );

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
      await playMoment(r, 'idle');
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
