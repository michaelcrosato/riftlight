import { describe, expect, it } from 'vitest';
import { LocalHub } from './local';
import { HubSession, hubEvents, type HubEvent, type HubHost, type HubMode } from './session';

/** A stand-in engine: commands land in a list, as `input.send` would queue them for the next frame. */
function fakeEngine(): HubHost & { commands: unknown[]; muted: boolean } {
  const host = {
    commands: [] as unknown[],
    muted: false,
    paused: false,
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
      const session = (await HubSession.join({ mode, seats: [1, 4], client: hub.client(id), autoFlush: false }))!;
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
    expect(hub.client(0).stats.sent).toBe(3); // 5 × 6 KB in bundles under 15 KB
    expect(copies[0]!.session.sent.dropped).toBe(1);
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
    ghost.copies[0]!.session.result({ time: 1000 });
    ghost.copies[0]!.session.result({ time: 500 });
    ghost.copies[0]!.session.finish({ standings: [[0]] });
    expect(ghost.hub.results.get(0)).toEqual({ time: 1000 });
    expect(ghost.hub.finished).toBeNull();

    const shared = await round('shared-world', 2);
    shared.copies[1]!.session.finish({ standings: [[1], [0]] }); // not the host
    shared.copies[0]!.session.result({ score: 3 }); // not in a shared world
    expect(shared.hub.finished).toBeNull();
    shared.copies[0]!.session.finish({ standings: [[0, 1]], won: true });
    expect(shared.hub.finished).toEqual({ standings: [[0, 1]], won: true });
  });

  it('at the end the engine goes quiet: paused, muted without saving it, nothing more sent', async () => {
    const { hub, copies } = await round('ghost', 2);
    const [a] = copies;
    let ended = '';
    a!.session.onEnd((r) => (ended = r));
    a!.session.send({ late: true });
    hub.end('finished');
    a!.session.flush();
    expect(hub.client(0).stats.sent).toBe(0);
    expect(a!.engine.paused).toBe(true);
    expect(a!.engine.muted).toBe(true);
    expect(a!.engine.audio!.persist).toBe(false);
    expect(ended).toBe('finished');
    expect(a!.session.phase).toBe('ended');
    expect(events(a!.engine.commands).at(-1)).toMatchObject({ type: 'end', reason: 'finished' });
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
});
