import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Engine, type Game, type GameContext } from '../Engine';
import { LocalHub } from './local';
import { HubSession, hubEvents, type HubEvent, type HubHost, type HubMode } from './session';

/** A stand-in engine: commands land in a list, as `input.send` would queue them for the next frame. */
function fakeEngine(): HubHost & { commands: unknown[]; muted: boolean; timeScale: number } {
  const host = {
    commands: [] as unknown[],
    muted: false,
    timeScale: 1,
    input: { send: (c: unknown) => void host.commands.push(c) },
    audio: { persist: true, setMuted: (m: boolean) => void (host.muted = m) },
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
    expect(ghost.copies[0]!.session.finish({ standings: [[0]] })).toBe(false); // player 0 hosts, but this isn't a shared world
    expect(ghost.copies[0]!.session.result({ time: Number.NaN })).toBe(false); // the hub couldn't rank it: not reported
    expect(ghost.copies[0]!.session.hasReported).toBe(false);
    expect(ghost.copies[0]!.session.result({ time: 1000 })).toBe(true);
    ghost.copies[0]!.session.result({ time: 500 });
    expect(ghost.hub.results.get(0)).toEqual({ time: 1000 });
    expect(ghost.hub.finished).toBeNull();
    expect(ghost.hub.problems).toEqual([]);

    const shared = await round('shared-world', 2);
    shared.copies[1]!.session.finish({ standings: [[1], [0]] }); // not the host
    shared.copies[0]!.session.result({ score: 3 }); // not in a shared world
    expect(shared.hub.finished).toBeNull();
    expect(shared.copies[0]!.session.finish({ standings: 'first' as never })).toBe(false);
    shared.copies[0]!.session.finish({ standings: [[0, 1]], won: true });
    expect(shared.hub.finished).toEqual({ standings: [[0, 1]], won: true });
    expect(shared.hub.problems).toEqual([]);
  });

  it('at the end the engine goes quiet: still, muted without saving it, nothing more sent', async () => {
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
