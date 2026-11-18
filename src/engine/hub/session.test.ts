import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Engine, type Game, type GameContext } from '../Engine';
import { LocalHub } from './local';
import { headSession, type HubClient, HubSession, hubEvents, type HubEvent, type HubHost, type HubInfo, type HubMode, type HubResult, onlineModes, parseMultiplayer } from './session';

/** A stand-in engine: commands land in a list, as `input.send` would queue them for the next frame. */
function fakeEngine(): HubHost & { commands: unknown[]; muted: boolean; timeScale: number; letGo: boolean } {
  const host = {
    commands: [] as unknown[],
    muted: false,
    timeScale: 1,
    letGo: false,
    input: { send: (c: unknown) => void host.commands.push(c) },
    audio: { persist: true, setMuted: (m: boolean) => void (host.muted = m) },
    dualsense: { close: () => void (host.letGo = true) },
  };
  return host;
}

async function round(mode: HubMode, players: number, options: { server?: boolean; latencyMs?: number } = {}) {
  const hub = new LocalHub({ mode, players, ...options });
  const ids = [...hub.players.map((p) => p.id), ...(hub.serverId === null ? [] : [hub.serverId])];
  const copies = await Promise.all(
    ids.map(async (id) => {
      const session = (await HubSession.join({ mode, seats: [1, 4], client: hub.client(id), autoFlush: false, clock: () => hub.now }))!;
      const engine = fakeEngine();
      session.attach(engine);
      return { id, session, engine };
    }),
  );
  return { hub, copies };
}

const events = (commands: unknown[]): HubEvent[] => hubEvents(commands);

describe('HubSession', () => {
  it('is null outside a session: the game plays as it does on its own', async () => {
    expect(await HubSession.join({ mode: 'ghost', seats: [1, 4], client: null })).toBeNull();
    expect(await HubSession.join({ mode: 'ghost', seats: [1, 4] })).toBeNull(); // no window.AIHub here
  });

  it('takes the round from the welcome: who, the host, the seed', async () => {
    const { hub, copies } = await round('shared-world', 3);
    expect(copies.map((c) => c.session.me)).toEqual([0, 1, 2]);
    expect(copies.map((c) => c.session.isHost)).toEqual([true, false, false]);
    expect(copies[1]!.session.info.seed).toBe(hub.seed);
    expect(copies[0]!.session.players.map((p) => p.color)).toEqual(['#e8443a', '#3b82f6', '#22c55e']);
  });

  it('a server hosts the shared world with no player of its own', async () => {
    const { copies } = await round('shared-world', 2, { server: true });
    const server = copies.find((c) => c.session.server)!;
    expect(server.session.isHost).toBe(true);
    expect(server.session.self).toBeNull();
    expect(copies.filter((c) => !c.session.server).every((c) => !c.session.isHost)).toBe(true);
  });

  it('hub events arrive as input commands, in order, the ones before attach() too', async () => {
    const hub = new LocalHub({ mode: 'ghost', players: 2 });
    const a = (await HubSession.join({ mode: 'ghost', seats: [1, 4], client: hub.client(0), autoFlush: false }))!;
    hub.start(); // before the engine is attached
    const engine = fakeEngine();
    a.attach(engine);
    hub.leave(1);
    hub.timeUp(4000);
    expect(events(engine.commands).map((e) => e.type)).toEqual(['start', 'leave', 'time-up']);
    expect(a.players.map((p) => p.id)).toEqual([0]);
  });

  it('bundles what the game sends: one message per flush, however often it sends', async () => {
    const { hub, copies } = await round('ghost', 2, { latencyMs: 100 });
    const [a, b] = copies;
    for (let i = 0; i < 30; i++) a!.session.send({ i });
    a!.session.flush();
    a!.session.flush(); // nothing new: nothing sent
    expect(hub.client(0).stats.sent).toBe(1);
    hub.advance(50);
    expect(events(b!.engine.commands)).toEqual([]); // still on the wire
    hub.advance(50);
    const got = events(b!.engine.commands).filter((e) => e.type === 'message');
    expect(got.map((e) => (e as { data: { i: number } }).data.i)).toEqual([...Array(30).keys()]);
    expect(got.every((e) => (e as { from: number }).from === 0)).toBe(true);
  });

  it('splits a bundle over the hub’s 16 KB limit, and drops a single item that could never fit', async () => {
    const { hub, copies } = await round('shared-world', 2);
    const big = 'x'.repeat(6000);
    for (let i = 0; i < 5; i++) copies[0]!.session.send({ big });
    copies[0]!.session.send({ huge: 'y'.repeat(20_000) });
    copies[0]!.session.flush();
    expect(hub.client(0).stats.sent).toBe(3); // 5 × 6 KB in bundles under the limit
    expect(hub.client(0).stats.refused).toBe(0);
    expect(copies[0]!.session.sent.dropped).toBe(1);
  });

  it('never goes over the hub’s rate: what the rate holds back waits its turn, in order, none lost', async () => {
    const { hub, copies } = await round('shared-world', 4);
    const host = copies[0]!.session;
    let next = 0;
    // a broadcast and a message to each of three players every flush at 60 a second: far over 20/s
    for (let f = 0; f < 120; f++) {
      host.send({ n: next++ });
      for (const to of [1, 2, 3]) host.send({ to }, to);
      host.flush();
      hub.advance(1000 / 60);
    }
    expect(hub.client(0).stats.refused).toBe(0); // the client never had to drop one
    expect(host.backlog).toBeGreaterThan(0);
    // once the game sends less, the backlog drains, and every broadcast arrived in order
    for (let f = 0; f < 600 && host.backlog; f++) {
      host.flush();
      hub.advance(1000 / 60);
    }
    hub.advance(100);
    expect(host.backlog).toBe(0);
    const got = events(copies[1]!.engine.commands)
      .filter((e) => e.type === 'message' && typeof (e.data as { n?: number }).n === 'number')
      .map((e) => (e as { data: { n: number } }).data.n);
    expect(got).toEqual([...Array(next).keys()]);
    expect(host.sent.dropped).toBe(0);
  });

  it('data that isn’t JSON is refused, not thrown into the game', async () => {
    const { copies } = await round('ghost', 2);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(copies[0]!.session.send(cyclic)).toBe(false);
    expect(copies[0]!.session.send({ ok: 1 })).toBe(true);
  });

  it('a message to one player reaches only that player', async () => {
    const { hub, copies } = await round('shared-world', 3);
    copies[0]!.session.send({ only: 2 }, 2);
    copies[0]!.session.flush();
    hub.advance(0);
    expect(events(copies[1]!.engine.commands).length).toBe(0);
    expect(events(copies[2]!.engine.commands).length).toBe(1);
  });

  it('parallel copies send nothing', async () => {
    const { hub, copies } = await round('parallel', 2);
    copies[0]!.session.send({ x: 1 });
    copies[0]!.session.flush();
    expect(hub.client(0).stats.sent).toBe(0);
  });

  it('reports once: result in parallel and ghost, finish from the host only', async () => {
    const ghost = await round('ghost', 2);
    ghost.hub.start(); // the hub takes no result before the start
    expect(ghost.copies[0]!.session.finish({ standings: [[0]] })).toBe(false); // player 0 hosts, but this isn't a shared world
    expect(ghost.copies[0]!.session.result({ time: Number.NaN })).toBe(false); // the hub couldn't rank it: not reported
    expect(ghost.copies[0]!.session.hasReported).toBe(false);
    expect(ghost.copies[0]!.session.result({ time: 1000 })).toBe(true);
    ghost.copies[0]!.session.result({ time: 500 });
    expect(ghost.hub.results.get(0)).toEqual({ time: 1000 });
    expect(ghost.hub.finished).toBeNull();
    expect(ghost.hub.problems).toEqual([]);

    const shared = await round('shared-world', 2);
    shared.hub.start();
    shared.copies[1]!.session.finish({ standings: [[1], [0]] }); // not the host
    shared.copies[0]!.session.result({ score: 3 }); // not in a shared world
    expect(shared.hub.finished).toBeNull();
    expect(shared.copies[0]!.session.finish({ standings: 'first' as never })).toBe(false);
    shared.copies[0]!.session.finish({ standings: [[0, 1]], won: true });
    expect(shared.hub.finished).toEqual({ standings: [[0, 1]], won: true });
    expect(shared.hub.problems).toEqual([]);
  });

  it('at the end the engine goes quiet: still, muted without saving it, the DualSense the hub’s, nothing more sent', async () => {
    const { hub, copies } = await round('ghost', 2);
    const [a] = copies;
    let ended = '';
    a!.session.onEnd((r) => (ended = r));
    a!.session.send({ late: true });
    hub.end('finished');
    a!.session.flush();
    expect(hub.client(0).stats.sent).toBe(0);
    expect(a!.engine.timeScale).toBe(0);
    expect(a!.engine.muted).toBe(true);
    expect(a!.engine.audio!.persist).toBe(false);
    expect(a!.engine.letGo).toBe(true);
    expect(ended).toBe('finished');
    expect(a!.session.phase).toBe('ended');
    expect(events(a!.engine.commands).at(-1)).toMatchObject({ type: 'end', reason: 'finished' });
  });

  it('a real engine’s game reads the end, then stands still', async () => {
    const hub = new LocalHub({ mode: 'ghost', players: 2 });
    const session = (await HubSession.join({ mode: 'ghost', seats: [1, 4], client: hub.client(0), autoFlush: false }))!;
    const seen: string[] = [];
    let moved = 0;
    const game: Game = {
      name: 'Listener',
      setup() {},
      fixedUpdate: (_ctx: GameContext, dt: number) => void (moved += dt),
      update: (ctx: GameContext) => void seen.push(...hubEvents(ctx.input.commands).map((e) => e.type)),
      cameraTarget: () => new Vector3(),
    };
    const engine = await Engine.headless(game);
    try {
      session.attach(engine);
      hub.start();
      engine.step(2);
      hub.end('finished');
      engine.step(3);
      expect(seen).toEqual(['start', 'end']);
      const before = moved;
      engine.step(10);
      expect(moved).toBe(before); // nothing moves after the end
    } finally {
      engine.dispose();
    }
  });

  it('a shared world whose host leaves is void', async () => {
    const { hub, copies } = await round('shared-world', 3);
    hub.leave(0);
    expect(copies[1]!.session.endReason).toBe('host-left');
  });

  it('a shared world a server hosts is void once every player has left', async () => {
    const { hub, copies } = await round('shared-world', 2, { server: true });
    hub.start();
    hub.leave(0);
    expect(hub.endReason).toBeNull(); // a player is still in it
    hub.leave(1);
    expect(hub.endReason).toBe('void');
    expect(copies.find((c) => c.session.server)!.session.endReason).toBe('void');
  });

  it('one long step does what falls due in time order: a message, time-up, a later message, the end', async () => {
    const hub = new LocalHub({ mode: 'ghost', players: 2, latencyMs: 100, limitMs: 10_000 });
    const [a, b] = await Promise.all(hub.players.map((p) => HubSession.join({ mode: 'ghost', seats: [1, 4], client: hub.client(p.id), autoFlush: false, clock: () => hub.now })));
    const engine = fakeEngine();
    b!.attach(engine);
    hub.start();
    hub.advance(3000 + 9850);
    a!.send({ n: 1 }); // arrives at 12 950, before time is called at 13 000
    a!.flush();
    hub.advance(100);
    a!.send({ n: 2 }); // arrives at 13 050, after it
    a!.flush();
    hub.advance(30_000);
    expect(events(engine.commands).map((e) => e.type)).toEqual(['start', 'message', 'time-up', 'message', 'end']);
    expect(hub.timeUpAt).toBe(13_000);
    expect(hub.endReason).toBe('finished'); // after the grace, ranked as it stands
  });

  it('ranks parallel by time, then score, then those with nothing, then those who left; equal values share a place', async () => {
    const { hub, copies } = await round('parallel', 6);
    hub.start();
    hub.advance(3000);
    copies[4]!.session.progress(9);
    hub.leave(5); // left with nothing: last
    copies[0]!.session.result({ time: 2000 });
    copies[1]!.session.result({ time: 2000 });
    copies[2]!.session.result({ score: 30 });
    copies[3]!.session.result({ score: 30 });
    expect(hub.endReason).toBeNull(); // 4 is still playing
    hub.timeUp();
    hub.advance(5000);
    expect(hub.endReason).toBe('finished');
    expect(hub.standings()).toEqual([[0, 1], [2, 3], [4], [5]]); // 4 by its last progress
  });

  it('a player who leaves with no result is ranked last, not dropped', async () => {
    const { hub, copies } = await round('parallel', 3);
    hub.start();
    hub.advance(4000);
    copies[0]!.session.result({ time: 1000 });
    hub.leave(2);
    copies[1]!.session.result({ time: 2000 });
    expect(hub.endReason).toBe('finished');
    expect(events(copies[0]!.engine.commands).at(-1)).toEqual({ type: 'end', reason: 'finished', standings: [[0], [1], [2]] });
  });

  it('time() is the hub’s timeline: -Infinity before the start, negative in the countdown', async () => {
    const { hub, copies } = await round('ghost', 1);
    const s = copies[0]!.session;
    expect(s.time()).toBe(-Infinity);
    hub.start();
    expect(s.time()).toBe(-3000);
    expect(s.playing).toBe(false);
    hub.advance(3500);
    expect(s.time()).toBe(500);
    expect(s.playing).toBe(true);
  });

  it('offline: a round with no hub behind it (a replay): the same info, nothing sent, a clock that never starts', async () => {
    const { copies } = await round('ghost', 2);
    const s = HubSession.offline(copies[1]!.session.info);
    expect(s.info).toEqual(copies[1]!.session.info);
    expect(s.time()).toBe(-Infinity);
    expect(s.send({ x: 1 })).toBe(true);
    s.flush();
    expect(s.result({ score: 3 })).toBe(true); // goes nowhere
  });

  it('progress is for parallel and ghost; a shared world is reported by its host', async () => {
    const { hub, copies } = await round('shared-world', 2);
    copies[1]!.session.progress(10, 'x');
    expect(hub.progress.size).toBe(0);
  });
});

/** The hub's own client (scripts/hub/session.js, vendored unmodified), loaded outside a session. */
function realClient(): { seed: number; rng(label: string): () => number } {
  const context: Record<string, unknown> = { location: { search: '' }, setTimeout, console };
  runInNewContext(readFileSync(new URL('../../../scripts/hub/session.js', import.meta.url), 'utf8'), context);
  return context.AIHub as never;
}

/** A client that answers `connect` with `welcome` and keeps what the game asked for. */
function stubClient(welcome: Partial<HubInfo>): HubClient & { asked: unknown[] } {
  const quiet = (): void => {};
  const asked: unknown[] = [];
  return {
    asked,
    active: true,
    connect: (opts) => (asked.push(opts), Promise.resolve(welcome)),
    ready: quiet,
    answer: quiet,
    time: () => -Infinity,
    on: () => quiet,
    progress: quiet,
    result: quiet,
    finish: quiet,
    send: () => true,
    fail: quiet,
  };
}

const welcome = (o: Partial<HubInfo>): Partial<HubInfo> => ({ me: 0, host: 0, players: [{ id: 0, name: 'Red Fox', color: '#e8443a' }], round: 1, limitMs: 60_000, seed: 7, ...o });

describe('several modes', () => {
  it('joins with every mode it offers; the round plays the one the hub picked', async () => {
    const client = stubClient(welcome({ mode: 'ghost' }));
    const s = (await HubSession.join({ mode: ['shared-world', 'ghost', 'parallel', 'moments'], seats: [1, 4], client, autoFlush: false }))!;
    expect(client.asked[0]).toMatchObject({ mode: ['shared-world', 'ghost', 'parallel', 'moments'], seats: [1, 4] });
    expect(s.mode).toBe('ghost');
    expect(s.info).toMatchObject({ mode: 'ghost', play: null, moment: null });
  });

  it('one mode alone goes as itself; a welcome naming a mode not offered plays the first offered', async () => {
    const client = stubClient(welcome({ mode: 'moments' }));
    const s = (await HubSession.join({ mode: ['parallel'], seats: [1, 4], client, autoFlush: false }))!;
    expect(client.asked[0]).toMatchObject({ mode: 'parallel' });
    expect(s.mode).toBe('parallel');
    await expect(HubSession.join({ mode: [], seats: [1, 4], client, autoFlush: false })).rejects.toThrow(/mode/);
  });

  it('keeps how a shared world plays, and which moment a load plays; each only in its own mode', async () => {
    const versus = (await HubSession.join({ mode: ['shared-world', 'ghost'], seats: [1, 4], client: stubClient(welcome({ mode: 'shared-world', play: 'versus' })), autoFlush: false }))!;
    expect(versus.info).toMatchObject({ mode: 'shared-world', play: 'versus', moment: null });
    const odd = (await HubSession.join({ mode: 'shared-world', seats: [1, 4], client: stubClient(welcome({ mode: 'shared-world', play: 'deathmatch' as never })), autoFlush: false }))!;
    expect(odd.info.play).toBeNull();
    const moment = (await HubSession.join({ mode: ['ghost', 'moments'], seats: [1, 4], client: stubClient(welcome({ mode: 'moments', moment: 'forge-brute', play: 'co-op' })), autoFlush: false }))!;
    expect(moment.info).toMatchObject({ mode: 'moments', moment: 'forge-brute', play: null });
    // the round's info, recorded, makes the same session again (a replay)
    expect(HubSession.offline(versus.info).info).toEqual(versus.info);
    expect(HubSession.offline(moment.info).info).toEqual(moment.info);
    // a recording from before several modes has neither: both null
    const old: Record<string, unknown> = { ...versus.info };
    delete old.play;
    delete old.moment;
    expect(HubSession.offline(old as unknown as HubInfo).info).toMatchObject({ play: null, moment: null });
  });

  it('reads the older mode names as the hub does; a recording in a mode that is none of today’s still replays', async () => {
    const client = stubClient(welcome({ mode: 'shared-world' }));
    const s = (await HubSession.join({ mode: ['co-op', 'versus', 'race'] as unknown as HubMode[], seats: [1, 4], client, autoFlush: false }))!;
    expect(client.asked[0]).toMatchObject({ mode: ['shared-world', 'ghost'] });
    expect(s.mode).toBe('shared-world');
    const race = (await HubSession.join({ mode: 'race' as HubMode, seats: [1, 4], client: stubClient(welcome({ mode: 'race' as HubMode })), autoFlush: false }))!;
    expect(race.mode).toBe('ghost');
    const old = HubSession.offline({ ...s.info, mode: 'race' as HubMode });
    expect(old.mode).toBe('ghost');
    expect(() => HubSession.offline({ ...s.info, mode: 'tag-team' as HubMode })).not.toThrow();
  });

  it('LocalHub flags a hello that does not offer the round’s mode', async () => {
    const hub = new LocalHub({ mode: 'ghost', players: 1 });
    await HubSession.join({ mode: 'parallel', seats: [1, 4], client: hub.client(0), autoFlush: false });
    expect(hub.problems).toEqual(['0: hello says mode parallel, the round is ghost']);
    const ok = new LocalHub({ mode: 'shared-world', play: 'co-op', players: 1 });
    const s = (await HubSession.join({ mode: ['parallel', 'shared-world'], seats: [1, 4], client: ok.client(0), autoFlush: false }))!;
    expect(s.info).toMatchObject({ mode: 'shared-world', play: 'co-op' });
    expect(ok.problems).toEqual([]);
  });
});

describe('the page’s modes (hub:multiplayer)', () => {
  it('reads every way to play together; what does not read is left out', () => {
    expect(parseMultiplayer('shared-world co-op 1-4, ghost 1-4, parallel 1-4, moments 1-4, split-screen versus 2-8')).toEqual([
      { where: 'shared-world', play: 'co-op', seats: [1, 4], online: true },
      { where: 'ghost', play: null, seats: [1, 4], online: true },
      { where: 'parallel', play: null, seats: [1, 4], online: true },
      { where: 'moments', play: null, seats: [1, 4], online: true },
      { where: 'split-screen', play: 'versus', seats: [2, 8], online: false },
    ]);
    // a race with a play, a shared world without one, too many players, a place that isn't one, a repeat
    expect(parseMultiplayer('ghost versus 2, shared-world 2-4, parallel 1-6, couch co-op 2, ghost 2, ghost 1-4')).toEqual([{ where: 'ghost', play: null, seats: [2, 2], online: true }]);
    expect(parseMultiplayer(null)).toEqual([]);
    // on one device it seats 2 or more (as round.js and the catalogue check read it)
    expect(parseMultiplayer('same-screen co-op 1, hot-seat versus 1-1, split-screen co-op 1-2')).toEqual([{ where: 'split-screen', play: 'co-op', seats: [1, 2], online: false }]);
  });

  it('the online modes to join with: the session mode first, then each one named once', () => {
    expect(onlineModes('ghost 1-4, shared-world co-op 1-4, shared-world versus 2-4, moments 1-4, same-screen co-op 2-4', 'shared-world')).toEqual(['shared-world', 'ghost', 'moments']);
    expect(onlineModes(null, 'parallel')).toEqual(['parallel']);
    expect(onlineModes('moments 1-4', 'race')).toEqual(['ghost', 'moments']); // an older tag still plays as before
    expect(onlineModes('same-screen co-op 2', null)).toEqual([]);
  });

  it('a head’s session tags: the modes and the seats, or null without hub:session 1', () => {
    const head = (tags: Record<string, string>) => (name: string) => tags[name] ?? null;
    expect(headSession(head({ 'hub:session': '1', 'hub:session-mode': 'shared-world', 'hub:multiplayer': 'shared-world co-op 1-4, ghost 1-4, moments 1-4', 'hub:session-players': '1-4' }))).toEqual({
      modes: ['shared-world', 'ghost', 'moments'],
      seats: [1, 4],
    });
    expect(headSession(head({ 'hub:session': '1', 'hub:session-mode': 'ghost' }))).toEqual({ modes: ['ghost'], seats: [1, 4] });
    expect(headSession(head({ 'hub:session': '1', 'hub:multiplayer': 'shared-world versus 2-4, ghost 2-3' }))).toEqual({ modes: ['shared-world', 'ghost'], seats: [2, 4] });
    expect(headSession(head({ 'hub:session': '0', 'hub:session-mode': 'ghost' }))).toBeNull();
    expect(headSession(head({ 'hub:session': '1' }))).toBeNull();
    expect(headSession()).toBeNull(); // no page here
  });
});

describe('moments', () => {
  const MOMENT = { id: 'forge-brute', seconds: 20 };
  async function moment(players = 2) {
    const hub = new LocalHub({ mode: 'moments', moment: MOMENT, players, seed: 99 });
    const copies = await Promise.all(
      hub.players.map(async (p) => {
        const session = (await HubSession.join({ mode: ['parallel', 'moments'], seats: [1, 4], client: hub.client(p.id), autoFlush: false, clock: () => hub.now }))!;
        const engine = fakeEngine();
        session.attach(engine);
        return { session, engine };
      }),
    );
    return { hub, copies };
  }

  it('welcomes the moment with its id and its length as the limit', async () => {
    const { copies } = await moment();
    expect(copies[0]!.session.info).toMatchObject({ mode: 'moments', moment: 'forge-brute', limitMs: 20_000, play: null });
    expect(() => new LocalHub({ mode: 'moments', players: 1 })).toThrow(/one moment/);
  });

  it('reports once whether it was cleared, with a finite time; sends nothing and shows no progress', async () => {
    const { hub, copies } = await moment();
    const [a, b] = copies;
    hub.start();
    hub.advance(3000 + 4200);
    expect(a!.session.result({ time: 4200 })).toBe(false); // a moment says won
    expect(a!.session.result({ won: true, score: 3 })).toBe(false); // and a time
    expect(a!.session.result({ won: true, time: Number.NaN })).toBe(false);
    expect(a!.session.hasReported).toBe(false);
    a!.session.progress(5, 'x');
    expect(hub.progress.size).toBe(0);
    expect(a!.session.send({ x: 1 })).toBe(false);
    a!.session.flush();
    expect(hub.client(0).stats.sent).toBe(0);
    expect(a!.session.result({ won: true, time: 4200, stats: { kills: 3 } })).toBe(true);
    expect(a!.session.result({ won: false, time: 5000 })).toBe(false); // once
    expect(hub.results.get(0)).toEqual({ won: true, time: 4200, stats: { kills: 3 } });
    expect(hub.endReason).toBeNull(); // the other player is still in it
    hub.advance(2000);
    b!.session.result({ won: false, time: b!.session.time() });
    expect(hub.endReason).toBe('finished'); // everyone reported: the moment is over
    expect(hub.standings()).toEqual([[0], [1]]);
    expect(hub.problems).toEqual([]);
  });

  it('time is called at the moment’s length; the hub waits its short grace, then ends it', async () => {
    const { hub, copies } = await moment(3);
    hub.start();
    hub.advance(3000 + 19_990);
    expect(events(copies[0]!.engine.commands).map((e) => e.type)).toEqual(['start']);
    hub.advance(20);
    expect(events(copies[0]!.engine.commands).at(-1)).toEqual({ type: 'time-up', graceMs: 2000 });
    // the goal was to last: cleared at time-up; one failed earlier; one says nothing
    copies[0]!.session.result({ won: true, time: 20_010 });
    hub.results.set(1, { won: false, time: 8000 });
    expect(hub.timeUpAt).toBe(3000 + 20_000); // when time was due, not when the clock was next moved
    hub.advance(1980);
    expect(hub.endReason).toBeNull();
    hub.advance(20);
    expect(hub.endReason).toBe('finished');
    expect(hub.results.get(0)!.time).toBe(20_000); // kept within the moment
    expect(hub.standings()).toEqual([[0], [1], [2]]); // cleared, failed, silent
  });

  it('LocalHub holds a game that skips HubSession to the hub’s rules: won, the start, no traffic', async () => {
    const hub = new LocalHub({ mode: 'moments', moment: MOMENT, players: 2 });
    const raw = hub.client(0);
    await raw.connect({ mode: 'moments', seats: [1, 4] });
    raw.result({ won: true, time: 10 });
    hub.start();
    hub.advance(3500);
    raw.progress({ score: 1 });
    raw.send({ x: 1 });
    hub.client(1).result({ time: 400 } as HubResult);
    expect(hub.problems).toEqual(['0: result before start', '0: progress is for parallel and ghost, not moments', '0: send in moments, where the copies send nothing', "1: a moment's result says won: true or false"]);
    expect(hub.results.get(1)).toEqual({ won: false, time: 400 });
  });

  it('one long step past the limit and the grace calls time, then ends the moment', async () => {
    const { hub, copies } = await moment();
    hub.start();
    hub.advance(60_000);
    expect(events(copies[0]!.engine.commands).map((e) => e.type)).toEqual(['start', 'time-up', 'end']);
    expect(hub.timeUpAt).toBe(3000 + 20_000);
    expect(hub.endReason).toBe('finished');
    expect(hub.standings()).toEqual([[0, 1]]); // neither reported: tied
  });

  it('ranks the cleared quickest first, then the failed, the last to fail first; equal times share a place', async () => {
    const { hub } = await moment(4);
    hub.start();
    hub.advance(3000);
    hub.client(0).result({ won: false, time: 5000 });
    hub.client(1).result({ won: false, time: 9000 });
    hub.client(2).result({ won: true, time: 12_000 });
    hub.client(3).result({ won: true, time: 12_000 });
    expect(hub.endReason).toBe('finished');
    expect(hub.standings()).toEqual([[2, 3], [1], [0]]);
  });

  it('a player who left with no result comes last; one who reported and then left keeps their place', async () => {
    const { hub, copies } = await moment(4);
    hub.start();
    hub.advance(3000 + 2000);
    hub.client(3).result({ won: false, time: 2000 });
    hub.leave(3); // reported, then left
    hub.leave(2); // left with nothing
    hub.client(0).result({ won: true, time: 4000 });
    hub.client(1).result({ won: false, time: 6000 });
    expect(hub.endReason).toBe('finished');
    expect(hub.standings()).toEqual([[0], [1], [3], [2]]);
    expect(events(copies[0]!.engine.commands).at(-1)).toEqual({ type: 'end', reason: 'finished', standings: [[0], [1], [3], [2]] });
  });
});

describe('session.rng', () => {
  it('draws the numbers the hub’s client draws for the same label, from the round’s seed', async () => {
    const client = realClient();
    for (const seed of [0, 1, 99, 4242, 0xffffffff]) {
      const hub = new LocalHub({ mode: 'moments', moment: { id: 'm', seconds: 5 }, players: 1, seed });
      const s = (await HubSession.join({ mode: 'moments', seats: [1, 4], client: hub.client(0), autoFlush: false }))!;
      client.seed = seed >>> 0;
      for (const label of ['', 'forge-brute', 'card', 'ü']) {
        const theirs = client.rng(label);
        const ours = s.rng(label);
        for (let i = 0; i < 8; i++) expect(ours.next()).toBe(theirs());
      }
      // no label is the empty one, as the client reads it (a JS game may call rng() bare)
      const bare = client.rng(undefined as never);
      const none = s.rng();
      for (let i = 0; i < 4; i++) expect(none.next()).toBe(bare());
      // each call starts the label's stream afresh; a replay's session (the recorded info) draws the same
      expect(s.rng('forge-brute').next()).toBe(HubSession.offline(s.info).rng('forge-brute').next());
      expect(s.rng('a').next()).not.toBe(s.rng('b').next());
    }
  });
});

describe('the game’s own card', () => {
  it('card events arrive as input; answers count from the first card until the start', async () => {
    const hub = new LocalHub({ mode: 'parallel', players: 2 });
    const own = (await HubSession.join({ mode: 'parallel', seats: [1, 4], card: true, client: hub.client(0), autoFlush: false }))!;
    const other = (await HubSession.join({ mode: 'parallel', seats: [1, 4], client: hub.client(1), autoFlush: false }))!;
    const engine = fakeEngine();
    own.attach(engine);
    own.answer('ready'); // before its first card: the hub drops it
    expect(hub.answers.size).toBe(0);
    hub.card(9000);
    expect(events(engine.commands)).toEqual([{ type: 'card', card: { left: 9000, paused: false, starting: false, ready: [], asking: 0, asked: false } }]);
    own.answer('more');
    own.answer('more'); // again takes it back
    expect(hub.answers.size).toBe(0);
    own.answer('more');
    hub.card(8000);
    expect(events(engine.commands).at(-1)).toMatchObject({ type: 'card', card: { asking: 1, asked: true } });
    own.answer('ready');
    hub.card(7000);
    expect(events(engine.commands).at(-1)).toMatchObject({ type: 'card', card: { ready: [0], asking: 0, asked: false } });
    other.answer('ready'); // its game shows the hub's card, not its own
    expect(hub.problems).toEqual(['1: answer without its own card: connect({ card: true })']);
    hub.start();
    own.answer('more'); // after the start: dropped
    expect(hub.answers.get(0)).toBe('ready');
  });
});
