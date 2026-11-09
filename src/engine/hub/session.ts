/**
 * AI Hub sessions (AI Hub Session Protocol v1, docs/engine/hub.md): up to four players, each on
 * their own device, play a round of a game together. The hub runs the lobby, the clock and the
 * network; a game takes part through the hub's client, `window.AIHub` (`session.js`, pasted
 * unmodified as the page's first script by the build that targets the hub).
 *
 * `HubSession.join()` connects (null outside a session: the game runs as it does on its own).
 * Everything the hub says (the start, other copies' messages, a player leaving, time-up, the
 * end) arrives in the game as input commands (`{ hub: HubEvent }`, read with `hubEvents`), so a
 * session is recorded and replays like any other input (docs/DOCTRINE.md, principle 1). What the
 * game sends goes out bundled, under the hub's limits on size and rate.
 */

/** How the copies of a game play a round together. */
export type HubMode = 'parallel' | 'ghost' | 'shared-world';

export const HUB_MODES: readonly HubMode[] = ['parallel', 'ghost', 'shared-world'];

/** The hub's seat colours: the colour follows the seat. */
export const HUB_COLORS: readonly string[] = ['#e8443a', '#3b82f6', '#22c55e', '#f5b700'];

export interface HubPlayer {
  readonly id: number;
  readonly name: string;
  readonly color: string;
}

/** The round, as the hub's welcome describes it. */
export interface HubInfo {
  /** This copy's player id (a server's id is not among `players`). */
  readonly me: number;
  readonly players: readonly HubPlayer[];
  /** The copy that runs a shared world. */
  readonly host: number;
  readonly isHost: boolean;
  /** True on a copy that hosts a shared world with no player of its own. */
  readonly server: boolean;
  readonly mode: HubMode;
  readonly round: number;
  /** The round's hard limit after the start, ms. */
  readonly limitMs: number;
  /** The same on every copy. */
  readonly seed: number;
}

/** The game's own card, while it shows (`card: true`). */
export interface HubCard {
  readonly left: number | null;
  readonly paused: boolean;
  readonly starting: boolean;
  readonly ready: readonly number[];
  readonly asking: number;
  readonly asked: boolean;
}

/** Everything the hub tells a game, as plain data (an input command's `hub`). */
export type HubEvent =
  | { readonly type: 'card'; readonly card: HubCard }
  | { readonly type: 'start'; readonly in: number }
  | { readonly type: 'message'; readonly data: unknown; readonly from: number }
  | { readonly type: 'leave'; readonly id: number; readonly reason: string }
  | { readonly type: 'time-up'; readonly graceMs: number }
  | { readonly type: 'end'; readonly reason: string; readonly standings: readonly (readonly number[])[] | null };

/** A player's own outcome, in parallel and ghost. */
export interface HubResult {
  /** Milliseconds of `time()`: lower wins. */
  readonly time?: number;
  /** Higher wins. */
  readonly score?: number;
  readonly stats?: Readonly<Record<string, string | number>>;
  readonly awards?: readonly { readonly title: string; readonly detail?: string }[];
}

/** A shared world's outcome, from the host. */
export interface HubFinish {
  /** Player ids, best first; ids in one array tie. */
  readonly standings: readonly (readonly number[])[];
  readonly scores?: Readonly<Record<number, number>>;
  /** A team result. */
  readonly won?: boolean;
  readonly stats?: Readonly<Record<number, Readonly<Record<string, string | number>>>>;
  readonly awards?: readonly { readonly id: number; readonly title: string; readonly detail?: string }[];
}

/** The hub's limits on what one copy sends (its welcome may change them). */
export interface HubLimits {
  /** Bytes of one message's JSON. */
  readonly maxBytes: number;
  /** Messages a second, on average. */
  readonly ratePerS: number;
  /** Messages at once. */
  readonly burst: number;
}

export const HUB_LIMITS: HubLimits = { maxBytes: 16_384, ratePerS: 20, burst: 40 };

/** The part of `window.AIHub` (session.js 1.x) a game uses. */
export interface HubClient {
  readonly active: boolean;
  readonly seeded?: boolean;
  connect(opts: { mode: HubMode; seats: readonly [number, number]; card?: boolean }): Promise<(Partial<HubInfo> & { limits?: Partial<HubLimits> }) | null>;
  ready(): void;
  answer(what: 'ready' | 'more'): void;
  time(): number;
  on(type: string, fn: (...args: never[]) => void): () => void;
  progress(p: { score: number; label?: string }): void;
  result(outcome: HubResult): void;
  finish(outcome: HubFinish): void;
  send(data: unknown, opts?: { to?: number; reliable?: boolean }): boolean;
  fail(message: string): void;
}

/** The hub's client on this page, when the hub opened it for a session. */
export function hubClient(): HubClient | null {
  const hub = (globalThis as { AIHub?: HubClient }).AIHub;
  return hub && hub.active ? hub : null;
}

/** A `<meta name>`'s content in this page's head (the hub's tags: `hub:session-mode`), or null. */
export function headMeta(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? null;
}

/** The hub events among a frame's input commands (`ctx.input.commands`), oldest first. */
export function hubEvents(commands: readonly unknown[]): HubEvent[] {
  const out: HubEvent[] = [];
  for (const c of commands) {
    const e = (c as { hub?: HubEvent } | null)?.hub;
    if (e && typeof e === 'object' && typeof e.type === 'string') out.push(e);
  }
  return out;
}

/** A number the hub can rank: finite, and a number (as the client checks it). */
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Would the hub take this as a result: a finite time or score. */
export function validResult(o: HubResult | null | undefined): boolean {
  return !!o && typeof o === 'object' && (finite(o.time) || finite(o.score));
}

/** Would the hub take this as a finish: standings, an array of arrays of player ids. */
export function validFinish(o: HubFinish | null | undefined): boolean {
  return !!o && Array.isArray(o.standings) && o.standings.every((s) => Array.isArray(s) && s.every((id) => Number.isInteger(id)));
}

/** What a session hands the engine: commands in, and a way to go still and quiet at the end. */
export interface HubHost {
  readonly input: { send(command: unknown): void };
  readonly audio?: { persist: boolean; setMuted(muted: boolean): void };
  /** Game speed: 0 at the end (frames still run, so the game reads the end; nothing moves, presses are dropped). */
  timeScale?: number;
}

export interface JoinOptions {
  readonly mode: HubMode;
  /** The fewest and most players the game takes. */
  readonly seats: readonly [number, number];
  /** The game shows its own card (answer it with `answer()`). */
  readonly card?: boolean;
  /** The hub's client: default `window.AIHub`. Tests pass a `LocalHub` copy. */
  readonly client?: HubClient | null;
  /** Flushes a second, at most (default 10; each flush is one message per destination, when the rate allows). */
  readonly sendHz?: number;
  /** Flush on a real-time timer (default: in a page). Tests call `flush()` themselves. */
  readonly autoFlush?: boolean;
  /** Milliseconds now, for the send rate (default real time; tests give the hub's clock). */
  readonly clock?: () => number;
}

/** One bundled message: what the game sent since the last flush, in order. */
interface Bundle {
  readonly b: unknown[];
}

/** A bundle waiting for the rate to allow it (it takes more items while it has room). */
interface Pending {
  readonly items: unknown[];
  bytes: number;
}

/** The longest queue of bundles kept per destination while the rate holds them back (then the oldest go). */
const MAX_PENDING = 64;

/** The key of a destination's queue: everyone, or one player. */
const ALL = -1;

/** Our share of the hub's limits: under the client's, so its own check never drops a message. */
const SHARE = 0.9;

/** The session's phases: `card` until the hub's start, `countdown` (time() < 0), then play, `time-up`, `ended`. */
export type HubPhase = 'card' | 'countdown' | 'time-up' | 'ended';

/**
 * A game's side of one round. Join with `HubSession.join()`, `attach()` the engine (or a
 * `HubHost`) so the hub's events arrive as input commands, call `ready()` once the round can
 * start, then report: `progress()` and `result()` in parallel and ghost, `finish()` from a
 * shared world's host. `send()` reaches the other copies.
 */
export class HubSession {
  /** The round, as welcomed (players: who is still in, `leave` removes them). */
  readonly info: HubInfo;
  readonly mode: HubMode;
  /** The hub's limits on what this copy sends. */
  readonly limits: HubLimits;
  /** Players still in the round, in seat order. */
  players: HubPlayer[];
  phase: HubPhase = 'card';
  /** Why the round ended (`end`), once it has. */
  endReason: string | null = null;
  /** Messages and bytes sent, and items dropped (too big to send, or too far behind), for tests and the debug view. */
  readonly sent = { messages: 0, bytes: 0, dropped: 0 };

  private readonly client: HubClient;
  private readonly sendHz: number;
  private readonly clock: () => number;
  private host: HubHost | null = null;
  private early: HubEvent[] = [];
  private outbox: unknown[] = [];
  private direct = new Map<number, unknown[]>();
  /** Bundles waiting, per destination (`ALL`, or a player's id); sent round-robin as the rate allows. */
  private pending = new Map<number, Pending[]>();
  private turn = 0;
  private tokens: number;
  private refilled: number;
  private readied = false;
  private reported = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private offs: (() => void)[] = [];
  private endHooks: ((reason: string) => void)[] = [];

  /** Connect to the hub. Null when there is none (outside a session): play as usual. */
  static async join(options: JoinOptions): Promise<HubSession | null> {
    const client = options.client === undefined ? hubClient() : options.client;
    if (!client || !client.active) return null;
    const welcome = await client.connect({ mode: options.mode, seats: options.seats, card: options.card === true });
    if (!welcome) return null;
    return new HubSession(client, welcome, options);
  }

  private constructor(client: HubClient, welcome: Partial<HubInfo> & { limits?: Partial<HubLimits> }, options: JoinOptions) {
    this.client = client;
    const players = (welcome.players ?? []).map((p, i) => ({ id: Number(p.id), name: String(p.name ?? `Player ${i + 1}`), color: String(p.color ?? HUB_COLORS[i % 4]) }));
    const mode = HUB_MODES.includes(welcome.mode as HubMode) ? (welcome.mode as HubMode) : options.mode;
    this.info = {
      me: Number(welcome.me ?? 0),
      players,
      host: Number(welcome.host ?? 0),
      isHost: welcome.isHost === true || welcome.me === welcome.host,
      server: welcome.server === true,
      mode,
      round: Number(welcome.round ?? 1),
      limitMs: Number(welcome.limitMs ?? 0),
      seed: Number(welcome.seed ?? 0) >>> 0,
    };
    const given = welcome.limits ?? {};
    const limit = (k: keyof HubLimits) => (Number(given[k]) > 0 ? Number(given[k]) : HUB_LIMITS[k]);
    this.limits = { maxBytes: limit('maxBytes'), ratePerS: limit('ratePerS'), burst: limit('burst') };
    this.mode = mode;
    this.players = [...players];
    this.sendHz = Math.max(1, Math.min(18, options.sendHz ?? 10));
    this.clock = options.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now())); // real time: the hub's send rate (never gameplay)
    this.tokens = Math.floor(this.limits.burst * SHARE);
    this.refilled = this.clock();
    const on = (type: string, fn: (...args: never[]) => void) => this.offs.push(client.on(type, fn));
    on('card', (card: HubCard) => this.deliver({ type: 'card', card }));
    on('start', (s: { in: number }) => {
      this.phase = 'countdown';
      this.deliver({ type: 'start', in: Number(s?.in ?? 0) });
    });
    on('message', (data: unknown, from: number) => {
      const items = (data as Bundle | null)?.b;
      for (const item of Array.isArray(items) ? items : [data]) this.deliver({ type: 'message', data: item, from: Number(from) });
    });
    on('leave', (l: { id: number; reason: string }) => {
      this.players = this.players.filter((p) => p.id !== l.id);
      this.deliver({ type: 'leave', id: Number(l.id), reason: String(l.reason ?? 'left') });
    });
    on('time-up', (t: { graceMs: number }) => {
      if (this.phase !== 'ended') this.phase = 'time-up';
      this.deliver({ type: 'time-up', graceMs: Number(t?.graceMs ?? 0) });
    });
    on('end', (e: { reason: string; standings: number[][] | null }) => this.end(String(e?.reason ?? 'finished'), e?.standings ?? null));
    const auto = options.autoFlush ?? typeof window !== 'undefined';
    if (auto) this.timer = setInterval(() => this.flush(), 1000 / this.sendHz);
  }

  get me(): number {
    return this.info.me;
  }

  get isHost(): boolean {
    return this.info.isHost;
  }

  /** This copy runs a shared world with no player of its own. */
  get server(): boolean {
    return this.info.server;
  }

  /** This copy's own player, or null on a server. */
  get self(): HubPlayer | null {
    return this.info.players.find((p) => p.id === this.info.me) ?? null;
  }

  get ended(): boolean {
    return this.phase === 'ended';
  }

  /** Has `result()` or `finish()` gone out. */
  get hasReported(): boolean {
    return this.reported;
  }

  /** Bundles waiting for the rate to allow them. */
  get backlog(): number {
    let n = 0;
    for (const q of this.pending.values()) n += q.length;
    return n;
  }

  /**
   * Route the hub's events into the engine as input commands (`{ hub }`), from now on and every
   * one that came before; at `end` the engine stands still (speed 0) and its sound stops.
   */
  attach(host: HubHost): this {
    this.host = host;
    const early = this.early;
    this.early = [];
    for (const e of early) host.input.send({ hub: e });
    if (this.ended) this.quiet();
    return this;
  }

  /** Call `fn` when the round ends (after the engine went still and quiet). */
  onEnd(fn: (reason: string) => void): void {
    this.endHooks.push(fn);
  }

  /** The round can start: everything is loaded. Once, with no key press. */
  ready(): void {
    if (this.readied || this.ended) return;
    this.readied = true;
    this.client.ready();
  }

  /** On the game's own card: this player is ready, or asks for more time. */
  answer(what: 'ready' | 'more'): void {
    if (!this.ended) this.client.answer(what);
  }

  /**
   * The hub's timeline, ms since play began: negative in the countdown, -Infinity before the
   * start. Real time: report with it (`result({ time })`), never gate gameplay on it (count the
   * countdown in game time from the `start` event's `in`, so a replay plays the same).
   */
  time(): number {
    return this.client.time();
  }

  /** Play has begun on the hub's clock (real time: see `time()`). */
  get playing(): boolean {
    return this.phase !== 'card' && this.phase !== 'ended' && this.time() >= 0;
  }

  /** Parallel and ghost: this player's standing, for the hub's scoreboard (it takes about one a second). */
  progress(score: number, label?: string): void {
    if (this.ended || this.reported || this.mode === 'shared-world' || !finite(score)) return;
    this.client.progress(label === undefined ? { score } : { score, label: String(label).slice(0, 24) });
  }

  /** Parallel and ghost: this player's round is over (a finite `time` or `score`). Once: false when not taken. */
  result(outcome: HubResult): boolean {
    if (this.ended || this.reported || this.mode === 'shared-world' || !validResult(outcome)) return false;
    this.reported = true;
    this.client.result(outcome);
    return true;
  }

  /** A shared world's host: the round is over (`standings` of player ids). Once: false when not taken. */
  finish(outcome: HubFinish): boolean {
    if (this.ended || this.reported || this.mode !== 'shared-world' || !this.isHost || !validFinish(outcome)) return false;
    this.reported = true;
    this.client.finish(outcome);
    return true;
  }

  /** The game cannot run in this browser. */
  fail(message: string): void {
    this.client.fail(message);
  }

  /**
   * Send JSON to every other copy (or to the one player `to`) with the next flush. Data is
   * bundled, so a game can send as often as it likes: bundles leave as the hub's rate allows, and
   * while they wait they take more items (one destination's items stay in order; different
   * destinations' may interleave). Ignored in parallel (copies send nothing), after the end, and
   * for data that isn't JSON (false).
   */
  send(data: unknown, to?: number): boolean {
    if (this.ended || this.mode === 'parallel') return false;
    let copy: unknown;
    try {
      copy = JSON.parse(JSON.stringify(data ?? null)) as unknown;
    } catch {
      this.sent.dropped++;
      return false;
    }
    if (to === undefined) this.outbox.push(copy);
    else {
      const list = this.direct.get(to) ?? [];
      list.push(copy);
      this.direct.set(to, list);
    }
    return true;
  }

  /** Bundle what was sent since the last flush, and post what the rate allows (the timer does it in a page). */
  flush(): void {
    if (this.ended) return;
    if (this.outbox.length) this.bundle(this.outbox, ALL);
    this.outbox = [];
    for (const [to, items] of this.direct) if (items.length) this.bundle(items, to);
    this.direct.clear();
    const now = this.clock();
    const rate = this.limits.ratePerS * SHARE;
    this.tokens = Math.min(Math.floor(this.limits.burst * SHARE), this.tokens + ((now - this.refilled) / 1000) * rate);
    this.refilled = now;
    // one bundle per destination in turn, while the rate allows
    while (this.tokens >= 1) {
      const keys = [...this.pending.keys()].filter((k) => this.pending.get(k)!.length);
      if (!keys.length) break;
      const key = keys[this.turn++ % keys.length]!;
      const p = this.pending.get(key)!.shift()!;
      this.tokens -= 1;
      if (!this.client.send({ b: p.items } satisfies Bundle, key === ALL ? undefined : { to: key })) {
        this.sent.dropped += p.items.length;
        continue;
      }
      this.sent.messages++;
      this.sent.bytes += p.bytes;
    }
    for (const [k, q] of this.pending) if (!q.length) this.pending.delete(k);
  }

  /** Stop: no timer, no handlers. The round may still be on (a test, a page closing). */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const off of this.offs) off();
    this.offs = [];
  }

  /** Items onto a destination's queue: into its last waiting bundle while it has room, else a new one. */
  private bundle(items: unknown[], to: number): void {
    const max = Math.floor(this.limits.maxBytes * SHARE);
    let queue = this.pending.get(to);
    if (!queue) this.pending.set(to, (queue = []));
    for (const item of items) {
      const size = JSON.stringify(item).length + 1;
      if (size > max - 8) {
        this.sent.dropped++;
        continue;
      }
      let last = queue.at(-1);
      if (!last || last.bytes + size > max) queue.push((last = { items: [], bytes: 8 }));
      last.items.push(item);
      last.bytes += size;
    }
    while (queue.length > MAX_PENDING) this.sent.dropped += queue.shift()!.items.length;
  }

  private deliver(e: HubEvent): void {
    if (this.host) this.host.input.send({ hub: e });
    else this.early.push(e);
  }

  private end(reason: string, standings: readonly (readonly number[])[] | null): void {
    if (this.phase === 'ended') return;
    this.deliver({ type: 'end', reason, standings });
    this.phase = 'ended';
    this.endReason = reason;
    this.outbox = [];
    this.direct.clear();
    this.pending.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.quiet();
    for (const fn of this.endHooks) fn(reason);
  }

  /**
   * After the end the game takes no input and its sound stops: the hub shows its results over it.
   * Speed 0, not a pause, so frames still run and the game reads the `end` command.
   */
  private quiet(): void {
    const host = this.host;
    if (!host) return;
    if (host.audio) {
      host.audio.persist = false;
      host.audio.setMuted(true);
    }
    if ('timeScale' in host) host.timeScale = 0;
  }
}
