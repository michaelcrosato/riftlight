/**
 * An AI Hub in memory, on a manual clock: what the hub and its network do for a round, for tests
 * and headless tools (docs/engine/hub.md). Each copy of the game gets a `LocalHub` client with the
 * shape of `window.AIHub`; `advance(ms)` moves the clock and delivers what is due.
 *
 *   const hub = new LocalHub({ mode: 'shared-world', players: 2, latencyMs: 100 });
 *   const a = await HubSession.join({ mode: 'shared-world', seats: [1, 4], client: hub.client(0), autoFlush: false });
 *   hub.advance(50);
 */
import { HUB_COLORS, type HubClient, type HubFinish, type HubInfo, type HubMode, type HubPlayer, type HubResult } from './session';

export interface LocalHubOptions {
  readonly mode: HubMode;
  readonly players: number;
  /** A copy with no player of its own runs the shared world (the hub's server scenario). */
  readonly server?: boolean;
  readonly seed?: number;
  readonly limitMs?: number;
  /** One-way delay of every message, ms. */
  readonly latencyMs?: number;
  /** Countdown between `start` and play, ms (the hub's is 3000). */
  readonly countdownMs?: number;
}

const NAMES = ['Red Fox', 'Blue Otter', 'Green Heron', 'Gold Lynx'];

type Handler = (...args: never[]) => void;

interface Copy {
  readonly id: number;
  readonly client: LocalClient;
  hello: boolean;
  ready: boolean;
  out: string | null;
}

/** One copy's client: the shape of `window.AIHub`. */
export class LocalClient implements HubClient {
  readonly active = true;
  readonly seeded: boolean;
  private handlers = new Map<string, Handler[]>();
  private pending = new Map<string, unknown[][]>();
  ended = false;
  /** Messages this copy sent and received (the harness counts these). */
  readonly stats = { sent: 0, received: 0 };

  constructor(
    private readonly hub: LocalHub,
    readonly id: number,
  ) {
    this.seeded = hub.mode !== 'shared-world';
  }

  connect(opts: { mode: HubMode; seats: readonly [number, number] }): Promise<Partial<HubInfo>> {
    return Promise.resolve(this.hub.hello(this.id, opts));
  }

  ready(): void {
    this.hub.readyFrom(this.id);
  }

  answer(): void {}

  time(): number {
    return this.hub.goAt === null ? -Infinity : this.hub.now - this.hub.goAt;
  }

  on(type: string, fn: Handler): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
    const queued = this.pending.get(type);
    if (queued) {
      this.pending.delete(type);
      for (const args of queued) (fn as (...a: unknown[]) => void)(...args);
    }
    return () => {
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    };
  }

  progress(p: { score: number; label?: string }): void {
    if (!this.ended) this.hub.progress.set(this.id, p);
  }

  result(outcome: HubResult): void {
    if (!this.ended && !this.hub.results.has(this.id)) this.hub.results.set(this.id, outcome);
  }

  finish(outcome: HubFinish): void {
    if (this.ended || this.id !== this.hub.host) return;
    this.hub.finished ??= outcome;
  }

  send(data: unknown, opts?: { to?: number; reliable?: boolean }): boolean {
    if (this.ended) return false;
    this.stats.sent++;
    this.hub.route(this.id, JSON.parse(JSON.stringify(data)), opts?.to);
    return true;
  }

  fail(message: string): void {
    this.hub.failures.push({ id: this.id, message });
  }

  /** The hub delivers an event to this copy (queued until a handler is attached, as session.js does). */
  emit(type: string, ...args: unknown[]): void {
    if (this.ended) return;
    if (type === 'message') this.stats.received++;
    if (type === 'end') this.ended = true;
    const list = this.handlers.get(type);
    if (!list?.length) {
      const queued = this.pending.get(type) ?? [];
      queued.push(args);
      this.pending.set(type, queued);
      return;
    }
    for (const fn of [...list]) (fn as (...a: unknown[]) => void)(...args);
  }
}

/** The hub's side of one round, in memory. */
export class LocalHub {
  readonly mode: HubMode;
  readonly seed: number;
  readonly limitMs: number;
  readonly latencyMs: number;
  readonly countdownMs: number;
  readonly players: readonly HubPlayer[];
  /** The copy that runs a shared world: the server when there is one, else player 0. */
  readonly host: number;
  readonly serverId: number | null;
  now = 0;
  goAt: number | null = null;
  readonly results = new Map<number, HubResult>();
  readonly progress = new Map<number, { score: number; label?: string }>();
  finished: HubFinish | null = null;
  readonly failures: { id: number; message: string }[] = [];
  endReason: string | null = null;
  private readonly copies: Copy[];
  private queue: { at: number; to: number; type: string; args: unknown[] }[] = [];

  constructor(options: LocalHubOptions) {
    this.mode = options.mode;
    this.seed = (options.seed ?? 12345) >>> 0;
    this.limitMs = options.limitMs ?? 300_000;
    this.latencyMs = options.latencyMs ?? 0;
    this.countdownMs = options.countdownMs ?? 3000;
    this.players = Array.from({ length: options.players }, (_, id) => ({ id, name: NAMES[id % 4]!, color: HUB_COLORS[id % 4]! }));
    this.serverId = options.server ? options.players : null;
    this.host = this.serverId ?? 0;
    const ids = [...this.players.map((p) => p.id), ...(this.serverId === null ? [] : [this.serverId])];
    this.copies = ids.map((id) => ({ id, client: new LocalClient(this, id), hello: false, ready: false, out: null }));
  }

  /** Copy `id`'s client (a player's id, or `serverId`). */
  client(id: number): LocalClient {
    const copy = this.copies.find((c) => c.id === id);
    if (!copy) throw new Error(`LocalHub: no copy ${id}`);
    return copy.client;
  }

  /** Every copy has called `ready()`. */
  get allReady(): boolean {
    return this.copies.every((c) => c.ready || c.out);
  }

  hello(id: number, opts: { mode: HubMode }): Partial<HubInfo> {
    const copy = this.copies.find((c) => c.id === id)!;
    copy.hello = true;
    void opts;
    return {
      me: id,
      players: this.players.filter((p) => !this.copies.find((c) => c.id === p.id)?.out),
      host: this.host,
      isHost: id === this.host,
      server: id === this.serverId,
      mode: this.mode,
      round: 1,
      limitMs: this.limitMs,
      seed: this.seed,
    };
  }

  readyFrom(id: number): void {
    const copy = this.copies.find((c) => c.id === id);
    if (copy) copy.ready = true;
  }

  /** The round starts (the card is over and every copy is ready): play begins after the countdown. */
  start(): void {
    if (this.goAt !== null) return;
    this.goAt = this.now + this.countdownMs;
    for (const c of this.live()) c.client.emit('start', { in: this.countdownMs });
  }

  /** Move the clock and deliver every message that is due. */
  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((m) => m.at <= this.now);
    this.queue = this.queue.filter((m) => m.at > this.now);
    for (const m of due) {
      const copy = this.copies.find((c) => c.id === m.to);
      if (copy && !copy.out) copy.client.emit(m.type, ...m.args);
    }
  }

  route(from: number, data: unknown, to: number | undefined): void {
    for (const c of this.live()) {
      if (c.id === from || (to !== undefined && c.id !== to)) continue;
      this.queue.push({ at: this.now + this.latencyMs, to: c.id, type: 'message', args: [data, from] });
    }
  }

  /** A player leaves the round; a shared world whose host leaves is void. */
  leave(id: number, reason = 'left'): void {
    const copy = this.copies.find((c) => c.id === id);
    if (!copy || copy.out) return;
    copy.out = reason;
    copy.client.ended = true;
    for (const c of this.live()) c.client.emit('leave', { id, reason });
    if (this.mode === 'shared-world' && id === this.host) this.end('host-left');
  }

  /** The hub calls time: the game reports within the grace period. */
  timeUp(graceMs = 5000): void {
    for (const c of this.live()) c.client.emit('time-up', { graceMs });
  }

  /** The last message of the round. */
  end(reason = 'finished'): void {
    if (this.endReason) return;
    this.endReason = reason;
    const standings = this.standings();
    for (const c of this.live()) c.client.emit('end', { reason, standings });
  }

  /** The round's order: a shared world's from its host, else by time, then score (the hub's rule). */
  standings(): number[][] {
    if (this.mode === 'shared-world') return (this.finished?.standings ?? []).map((s) => [...s]);
    const ids = this.players.map((p) => p.id);
    const timed = ids.filter((id) => Number.isFinite(this.results.get(id)?.time)).sort((a, b) => this.results.get(a)!.time! - this.results.get(b)!.time!);
    const scored = ids.filter((id) => !timed.includes(id)).sort((a, b) => (this.results.get(b)?.score ?? this.progress.get(b)?.score ?? -Infinity) - (this.results.get(a)?.score ?? this.progress.get(a)?.score ?? -Infinity));
    return [...timed, ...scored].map((id) => [id]);
  }

  private live(): Copy[] {
    return this.copies.filter((c) => !c.out);
  }
}
