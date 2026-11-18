/**
 * An AI Hub in memory, on a manual clock: what the hub and its network do for a round, for tests
 * and headless tools (docs/engine/hub.md). Each copy of the game gets a `LocalHub` client with the
 * shape of `window.AIHub`; `advance(ms)` moves the clock and delivers what is due. It runs the
 * round as the hub's own coordinator does (52in1.com/lib/hub/round.js): time is called at the
 * limit, the round ends once every player has reported, a shared world's finish ends it, and after
 * time-up's grace the round ends either way.
 *
 *   const hub = new LocalHub({ mode: 'shared-world', players: 2, latencyMs: 100 });
 *   const a = await HubSession.join({ mode: 'shared-world', seats: [1, 4], client: hub.client(0), autoFlush: false });
 *   hub.advance(50);
 *
 * A round of moments plays one moment (each moment is a fresh load, with a hub of its own):
 * `new LocalHub({ mode: 'moments', moment: { id: 'forge-brute', seconds: 20 }, players: 2 })`.
 */
import { HUB_COLORS, HUB_LIMITS, type HubCard, type HubClient, type HubFinish, type HubInfo, type HubMode, type HubPlay, type HubPlayer, type HubResult, validFinish, validResult } from './session';

export interface LocalHubOptions {
  /** The mode the hub picked for this round (a copy's hello must offer it). */
  readonly mode: HubMode;
  /** A shared world's play this round, as the welcome says it (`hub:multiplayer`'s HOW); else null. */
  readonly play?: HubPlay | null;
  /** Moments: the moment this load plays (its id, and its length: the round's limit). */
  readonly moment?: { readonly id: string; readonly seconds: number } | null;
  readonly players: number;
  /** A copy with no player of its own runs the shared world (the hub's server scenario). */
  readonly server?: boolean;
  readonly seed?: number;
  /** The round's hard limit after play begins, ms (default 300 000; in moments the moment's seconds). */
  readonly limitMs?: number;
  /** One-way delay of every message, ms. */
  readonly latencyMs?: number;
  /** Countdown between `start` and play, ms (the hub's is 3000). */
  readonly countdownMs?: number;
}

/** The hub's timings that a round in memory keeps (round.js TIMINGS): the grace after time-up. */
export const LOCAL_HUB_GRACE = { graceMs: 5000, momentGraceMs: 2000 } as const;

const NAMES = ['Red Fox', 'Blue Otter', 'Green Heron', 'Gold Lynx'];

type Handler = (...args: never[]) => void;

interface Copy {
  readonly id: number;
  readonly client: LocalClient;
  hello: boolean;
  ready: boolean;
  out: string | null;
  /** It shows its own card (`connect({ card: true })`), and has had a `card` event. */
  card: boolean;
  cardShown: boolean;
}

/** One copy's client: the shape of `window.AIHub`. */
export class LocalClient implements HubClient {
  readonly active = true;
  readonly seeded: boolean;
  private handlers = new Map<string, Handler[]>();
  private pending = new Map<string, unknown[][]>();
  ended = false;
  /** Messages this copy sent and received (the harness counts these), and what its limits refused. */
  readonly stats = { sent: 0, received: 0, refused: 0 };
  private tokens = HUB_LIMITS.burst;
  private refilled = 0;

  constructor(
    private readonly hub: LocalHub,
    readonly id: number,
  ) {
    this.seeded = hub.mode !== 'shared-world';
  }

  connect(opts: { mode: HubMode | readonly HubMode[]; seats: readonly [number, number]; card?: boolean }): Promise<Partial<HubInfo>> {
    return Promise.resolve(this.hub.hello(this.id, opts));
  }

  ready(): void {
    this.hub.readyFrom(this.id);
  }

  /** On the game's own card: as the hub takes it, from the copy's first `card` until the start. */
  answer(what: 'ready' | 'more'): void {
    if (!this.ended) this.hub.answerFrom(this.id, what);
  }

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
    if (this.ended) return;
    if (this.hub.mode === 'shared-world' || this.hub.mode === 'moments') return void this.hub.problems.push(`${this.id}: progress is for parallel and ghost, not ${this.hub.mode}`);
    this.hub.progress.set(this.id, p);
  }

  /**
   * As session.js and the hub take it: a result needs a finite time or score; in moments it says
   * `won` too, and its time is kept within the moment (the hub's own when the game gives none).
   */
  result(outcome: HubResult): void {
    if (this.ended || this.hub.results.has(this.id)) return;
    if (!validResult(outcome)) return void this.hub.problems.push(`${this.id}: result needs a finite time or score`);
    this.hub.resultFrom(this.id, outcome);
  }

  finish(outcome: HubFinish): void {
    if (this.ended) return;
    if (this.id !== this.hub.host || this.hub.mode !== 'shared-world') return void this.hub.problems.push(`${this.id}: finish is for a shared world's host`);
    if (!validFinish(outcome)) return void this.hub.problems.push(`${this.id}: finish needs standings`);
    this.hub.finishFrom(outcome);
  }

  /** As session.js: at most 16 KB, 20 messages a second with bursts of 40 (on the hub's clock); the rest are dropped. */
  send(data: unknown, opts?: { to?: number; reliable?: boolean }): boolean {
    if (this.ended) return false;
    if (this.hub.mode === 'parallel' || this.hub.mode === 'moments') {
      this.hub.problems.push(`${this.id}: send in ${this.hub.mode}, where the copies send nothing`);
      return false;
    }
    const text = JSON.stringify(data);
    if (text === undefined || text.length > HUB_LIMITS.maxBytes) {
      this.stats.refused++;
      return false;
    }
    const now = this.hub.now;
    this.tokens = Math.min(HUB_LIMITS.burst, this.tokens + ((now - this.refilled) / 1000) * HUB_LIMITS.ratePerS);
    this.refilled = now;
    if (this.tokens < 1) {
      this.stats.refused++;
      return false;
    }
    this.tokens -= 1;
    this.stats.sent++;
    this.hub.route(this.id, JSON.parse(text), opts?.to);
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
  readonly play: HubPlay | null;
  /** Moments: the id of the moment this load plays. */
  readonly moment: string | null;
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
  /** When time was called (the limit, or `timeUp()`), and the grace the games have to report in. */
  timeUpAt: number | null = null;
  private graceMs = 0;
  readonly results = new Map<number, HubResult>();
  readonly progress = new Map<number, { score: number; label?: string }>();
  /** Answers on the games' own cards: `ready`, or `more` (answering `more` again takes it back). */
  readonly answers = new Map<number, 'ready' | 'more'>();
  finished: HubFinish | null = null;
  readonly failures: { id: number; message: string }[] = [];
  /** What breaks the protocol, as the hub flags it (a result it can't rank, a finish not from the host, a mode not offered). */
  readonly problems: string[] = [];
  endReason: string | null = null;
  private readonly copies: Copy[];
  private queue: { at: number; to: number; type: string; args: unknown[] }[] = [];

  constructor(options: LocalHubOptions) {
    this.mode = options.mode;
    if (this.mode === 'moments' && !options.moment) throw new Error('LocalHub: a round of moments plays one moment (`moment: { id, seconds }`)');
    this.play = this.mode === 'shared-world' ? (options.play ?? null) : null;
    this.moment = this.mode === 'moments' ? options.moment!.id : null;
    this.seed = (options.seed ?? 12345) >>> 0;
    this.limitMs = this.mode === 'moments' ? options.moment!.seconds * 1000 : (options.limitMs ?? 300_000);
    this.latencyMs = options.latencyMs ?? 0;
    this.countdownMs = options.countdownMs ?? 3000;
    this.players = Array.from({ length: options.players }, (_, id) => ({ id, name: NAMES[id % 4]!, color: HUB_COLORS[id % 4]! }));
    this.serverId = options.server ? options.players : null;
    this.host = this.serverId ?? 0;
    const ids = [...this.players.map((p) => p.id), ...(this.serverId === null ? [] : [this.serverId])];
    this.copies = ids.map((id) => ({ id, client: new LocalClient(this, id), hello: false, ready: false, out: null, card: false, cardShown: false }));
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

  /** Each copy reports its own result (parallel, ghost, moments); a shared world's host finishes it. */
  get selfReported(): boolean {
    return this.mode !== 'shared-world';
  }

  hello(id: number, opts: { mode: HubMode | readonly HubMode[]; card?: boolean }): Partial<HubInfo> {
    const copy = this.copies.find((c) => c.id === id)!;
    copy.hello = true;
    copy.card = opts.card === true;
    const named = typeof opts.mode === 'string' ? [opts.mode] : [...(opts.mode ?? [])];
    if (named.length && !named.includes(this.mode)) this.problems.push(`${id}: hello says mode ${named.join(', ')}, the round is ${this.mode}`);
    return {
      me: id,
      players: this.players.filter((p) => !this.copies.find((c) => c.id === p.id)?.out),
      host: this.host,
      isHost: id === this.host,
      server: id === this.serverId,
      mode: this.mode,
      play: this.play,
      ...(this.moment ? { moment: this.moment } : {}),
      round: 1,
      limitMs: this.limitMs,
      seed: this.seed,
    };
  }

  readyFrom(id: number): void {
    const copy = this.copies.find((c) => c.id === id);
    if (copy) copy.ready = true;
  }

  /**
   * The card's state, to every copy that shows its own (`connect({ card: true })`): the countdown
   * (`left` ms, null while held), who is ready, how many ask for more time. As the hub, once a second.
   */
  card(left: number | null = 10_000): void {
    if (this.goAt !== null) return;
    const ready = [...this.answers].filter(([, a]) => a === 'ready').map(([id]) => id);
    const asking = [...this.answers.values()].filter((a) => a === 'more').length;
    for (const c of this.live()) {
      if (!c.card || !c.hello) continue;
      c.cardShown = true;
      c.client.emit('card', { left, paused: false, starting: left === null, ready, asking, asked: this.answers.get(c.id) === 'more' } satisfies HubCard);
    }
  }

  /** An answer on a game's own card: taken from its first `card` until the start (before it, dropped). */
  answerFrom(id: number, what: 'ready' | 'more'): void {
    const copy = this.copies.find((c) => c.id === id);
    if (!copy || copy.out || this.goAt !== null) return;
    if (!copy.card) return void this.problems.push(`${id}: answer without its own card: connect({ card: true })`);
    if (what !== 'ready' && what !== 'more') return void this.problems.push(`${id}: answer ${JSON.stringify(what)} is not ready or more`);
    if (!copy.cardShown) return;
    if (what === 'more' && this.answers.get(id) === 'more') this.answers.delete(id);
    else this.answers.set(id, what);
  }

  /** The round starts (the card is over and every copy is ready): play begins after the countdown. */
  start(): void {
    if (this.goAt !== null || this.endReason) return;
    this.goAt = this.now + this.countdownMs;
    for (const c of this.live()) c.client.emit('start', { in: this.countdownMs });
  }

  /** Move the clock and deliver every message that is due; call time at the limit, and end the round after its grace. */
  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter((m) => m.at <= this.now);
    this.queue = this.queue.filter((m) => m.at > this.now);
    for (const m of due) {
      const copy = this.copies.find((c) => c.id === m.to);
      if (copy && !copy.out) copy.client.emit(m.type, ...m.args);
    }
    if (this.endReason) return;
    if (this.goAt !== null && this.timeUpAt === null && this.now >= this.goAt + this.limitMs) this.timeUp();
    if (this.timeUpAt !== null && this.now >= this.timeUpAt + this.graceMs) this.end(this.selfReported || this.finished ? 'finished' : 'void');
  }

  route(from: number, data: unknown, to: number | undefined): void {
    for (const c of this.live()) {
      if (c.id === from || (to !== undefined && c.id !== to)) continue;
      this.queue.push({ at: this.now + this.latencyMs, to: c.id, type: 'message', args: [data, from] });
    }
  }

  /** A player's result, as the hub takes it (the client has checked it is finite). */
  resultFrom(id: number, outcome: HubResult): void {
    if (this.mode === 'shared-world') return void this.problems.push(`${id}: result is for parallel, ghost and moments; this round is a shared world`);
    if (this.goAt === null) return void this.problems.push(`${id}: result before start`);
    if (this.mode === 'moments') {
      if (typeof outcome.won !== 'boolean') this.problems.push(`${id}: a moment's result says won: true or false`);
      const time = Number.isFinite(outcome.time) ? outcome.time! : this.now - this.goAt;
      this.results.set(id, { ...outcome, won: outcome.won === true, time: Math.round(Math.min(Math.max(0, time), this.limitMs)) });
    } else this.results.set(id, outcome);
    this.settle();
  }

  /** A shared world's host finished the round: it ends with the host's standings. */
  finishFrom(outcome: HubFinish): void {
    if (this.goAt === null) return void this.problems.push(`${this.host}: finish before start`);
    this.finished ??= outcome;
    this.end('finished');
  }

  /** A player leaves the round; a shared world whose host leaves is void. */
  leave(id: number, reason = 'left'): void {
    const copy = this.copies.find((c) => c.id === id);
    if (!copy || copy.out || this.endReason) return;
    copy.out = reason;
    copy.client.ended = true;
    for (const c of this.live()) c.client.emit('leave', { id, reason });
    if (this.mode === 'shared-world' && id === this.host) this.end('host-left');
    else this.settle();
  }

  /** The hub calls time: the game reports within the grace period (a moment's is shorter). */
  timeUp(graceMs: number = this.mode === 'moments' ? LOCAL_HUB_GRACE.momentGraceMs : LOCAL_HUB_GRACE.graceMs): void {
    if (this.timeUpAt !== null || this.endReason) return;
    this.timeUpAt = this.now;
    this.graceMs = graceMs;
    for (const c of this.live()) c.client.emit('time-up', { graceMs });
  }

  /** The last message of the round. */
  end(reason = 'finished'): void {
    if (this.endReason) return;
    this.endReason = reason;
    const standings = reason === 'finished' ? this.standings() : null;
    for (const c of this.live()) c.client.emit('end', { reason, standings });
  }

  /**
   * The round's order: a shared world's from its host; in moments the cleared first (quickest
   * first), then the failed (the last to fail first); else by time, then score (the last progress
   * for a player with no result). Players with nothing come last, tied; equal values tie.
   */
  standings(): number[][] {
    if (this.mode === 'shared-world') return (this.finished?.standings ?? []).map((s) => [...s]);
    const ids = this.players.map((p) => p.id).filter((id) => this.results.has(id) || !this.copies.find((c) => c.id === id)?.out);
    const groups: [number, number][][] = [[], [], []];
    const silent: number[] = [];
    for (const id of ids) {
      const r = this.results.get(id);
      const score = r?.score ?? this.progress.get(id)?.score;
      if (this.mode === 'moments') {
        if (r) groups[r.won ? 0 : 1]!.push([id, r.time!]);
        else silent.push(id);
      } else if (Number.isFinite(r?.time)) groups[0]!.push([id, r!.time!]);
      else if (Number.isFinite(score)) groups[2]!.push([id, score!]);
      else silent.push(id);
    }
    return [...grouped(groups[0]!, 1), ...grouped(groups[1]!, -1), ...grouped(groups[2]!, -1), ...(silent.length ? [silent] : [])];
  }

  /** Every player still in the round has reported (parallel, ghost, moments): the round is over. */
  private settle(): void {
    if (this.endReason || !this.selfReported) return;
    const left = this.players.filter((p) => !this.copies.find((c) => c.id === p.id)?.out);
    if (!left.length) this.end('void');
    else if (left.every((p) => this.results.has(p.id))) this.end('finished');
  }

  private live(): Copy[] {
    return this.copies.filter((c) => !c.out);
  }
}

/** Ids grouped by value, best first (`order` 1: lowest first; -1: highest); equal values share a place. */
function grouped(list: [number, number][], order: 1 | -1): number[][] {
  list.sort((a, b) => order * (a[1] - b[1]) || a[0] - b[0]);
  const out: { value: number; ids: number[] }[] = [];
  for (const [id, value] of list) {
    const last = out.at(-1);
    if (last && last.value === value) last.ids.push(id);
    else out.push({ value, ids: [id] });
  }
  return out.map((g) => g.ids);
}
