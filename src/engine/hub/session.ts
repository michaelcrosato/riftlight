/**
 * AI Hub sessions (AI Hub Session Protocol v1, https://52in1.com/lib/hub/README.md;
 * docs/engine/hub.md): up to four players, each on their own device, play a round of a game
 * together on 52in1 (players know the hub by that name). The hub runs the lobby, the clock and the
 * network; a game takes part through the hub's client, `window.AIHub` (`session.js`, pasted
 * unmodified as the page's first script by the build that targets the hub).
 *
 * `HubSession.join()` connects (null outside a session: the game runs as it does on its own).
 * Everything the hub says (the start, other copies' messages, a player leaving, time-up, the
 * end) arrives in the game as input commands (`{ hub: HubEvent }`, read with `hubEvents`), so a
 * session is recorded and replays like any other input (docs/DOCTRINE.md, principle 1). What the
 * game sends goes out bundled, under the hub's limits on size and rate.
 */

import { Rng } from '../random';

/** How the copies of a game play a round together (`moments`: short moments of the game, one a load). */
export type HubMode = 'parallel' | 'ghost' | 'shared-world' | 'moments';

export const HUB_MODES: readonly HubMode[] = ['parallel', 'ghost', 'shared-world', 'moments'];

/** How a shared world plays this round, when the page's `hub:multiplayer` names it. */
export type HubPlay = 'co-op' | 'versus' | 'other';

export const HUB_PLAYS: readonly HubPlay[] = ['co-op', 'versus', 'other'];

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
  /** The mode the hub picked for this round: one of those the game joined with. */
  readonly mode: HubMode;
  /** In a shared world, how this round plays (co-op, versus, other) when `hub:multiplayer` names it; else null. */
  readonly play: HubPlay | null;
  /** In moments, the id of the moment this load plays (a `hub:moment` tag's); else null. */
  readonly moment: string | null;
  readonly round: number;
  /** The round's hard limit after the start, ms (in moments, the moment's length). */
  readonly limitMs: number;
  /** The same on every copy (behind `session.rng(label)`). */
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

/** A player's own outcome, in parallel and ghost; in moments, whether they cleared it (`won`) and when. */
export interface HubResult {
  /** Milliseconds of `time()`: lower wins (in moments, `time()` when it was cleared or failed). */
  readonly time?: number;
  /** Higher wins. */
  readonly score?: number;
  /** Moments: true when the player cleared the moment, false when they failed it. */
  readonly won?: boolean;
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
  /** `mode`: one, or every online mode the game offers (the hub picks one: the welcome's). */
  connect(opts: { mode: HubMode | readonly HubMode[]; seats: readonly [number, number]; card?: boolean }): Promise<(Partial<HubInfo> & { limits?: Partial<HubLimits> }) | null>;
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

/** Older session tags the hub still plays: race as ghost, co-op and versus as a shared world. */
const MODE_ALIASES: Readonly<Record<string, HubMode>> = { race: 'ghost', 'co-op': 'shared-world', versus: 'shared-world' };

/** The mode a session tag names (older tags included), or null. */
function hubModeOf(word: string | null | undefined): HubMode | null {
  const w = String(word ?? '').trim().toLowerCase();
  return (HUB_MODES as readonly string[]).includes(w) ? (w as HubMode) : (MODE_ALIASES[w] ?? null);
}

/** Where the players are on one device, in `hub:multiplayer` (the online four are `HUB_MODES`). */
const ONE_DEVICE = ['same-screen', 'split-screen', 'hot-seat'];

/** One way to play together that `hub:multiplayer` names: where, how (a shared world's or one device's), and how many. */
export interface HubWay {
  /** An online mode (`HubMode`) or one on one device (`same-screen`, `split-screen`, `hot-seat`). */
  readonly where: string;
  readonly play: HubPlay | null;
  /** The fewest and most players. */
  readonly seats: readonly [number, number];
  readonly online: boolean;
}

/**
 * `hub:multiplayer` read (AI Hub Catalogue v1, *Playing together*): `WHERE HOW MIN-MAX, ...`, how
 * only for a shared world or one device. Entries that don't read are left out, as the hub leaves them.
 */
export function parseMultiplayer(text: string | null | undefined): HubWay[] {
  const ways: HubWay[] = [];
  for (const raw of String(text ?? '').split(',')) {
    const words = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 3) continue;
    const where = words[0]!;
    const online = (HUB_MODES as readonly string[]).includes(where);
    if (!online && !ONE_DEVICE.includes(where)) continue;
    const play = words.length === 3 ? (words[1] as HubPlay) : null;
    const race = where === 'parallel' || where === 'ghost' || where === 'moments';
    if (race ? play !== null : !HUB_PLAYS.includes(play!)) continue;
    const m = /^(\d+)(?:[-\u2013](\d+))?$/.exec(words.at(-1)!);
    if (!m) continue;
    const low = Number(m[1]);
    const high = Number(m[2] ?? m[1]);
    if (low < 1 || high < low || high > (online ? 4 : 8)) continue;
    if (!online && high < 2) continue; // on one device it seats 2 or more
    if (ways.some((w) => w.where === where && w.play === play)) continue;
    ways.push({ where, play, seats: [low, high], online });
  }
  return ways;
}

/**
 * The online modes a page offers, to join with: every one `hub:multiplayer` names, each once, with
 * `hub:session-mode` (the one it plays when nothing says which) first; a page that names none in
 * `hub:multiplayer` offers its session mode alone. Empty when neither names a mode.
 */
export function onlineModes(multiplayer: string | null | undefined, sessionMode: string | null | undefined): HubMode[] {
  const modes: HubMode[] = [];
  const main = hubModeOf(sessionMode);
  if (main) modes.push(main);
  for (const way of parseMultiplayer(multiplayer)) if (way.online && !modes.includes(way.where as HubMode)) modes.push(way.where as HubMode);
  return modes;
}

/** What a page built for the hub joins a session with, from its head's tags. */
export interface HeadSession {
  /** Every online mode the page offers, the default first (`onlineModes`). */
  readonly modes: readonly HubMode[];
  /** The fewest and most players: `hub:session-players`, else every online mode's together. */
  readonly seats: readonly [number, number];
}

/**
 * This page's session tags read (`hub:session` 1, `hub:session-mode`, `hub:multiplayer`,
 * `hub:session-players`): what to pass `HubSession.join`. Null for a page without them.
 */
export function headSession(meta: (name: string) => string | null = headMeta): HeadSession | null {
  if (meta('hub:session') !== '1') return null;
  const multiplayer = meta('hub:multiplayer');
  const modes = onlineModes(multiplayer, meta('hub:session-mode'));
  if (!modes.length) return null;
  const given = meta('hub:session-players')?.match(/\d+/g)?.map(Number);
  if (given?.length) return { modes, seats: [given[0]!, Math.max(given[0]!, given[1] ?? given[0]!)] };
  const ways = parseMultiplayer(multiplayer).filter((w) => w.online);
  return { modes, seats: ways.length ? [Math.min(...ways.map((w) => w.seats[0])), Math.max(...ways.map((w) => w.seats[1]))] : [1, 4] };
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

/** Would the hub take this as a result: a finite time or score; in moments, `won` (true or false) and a finite time. */
export function validResult(o: HubResult | null | undefined, mode?: HubMode): boolean {
  if (!o || typeof o !== 'object') return false;
  if (mode === 'moments') return typeof o.won === 'boolean' && finite(o.time);
  return finite(o.time) || finite(o.score);
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
  /** A DualSense's outputs (`engine.dualsense`): at the end the triggers go and the light bar is the hub's again. */
  readonly dualsense?: { close(): void };
}

export interface JoinOptions {
  /** The mode the game plays, or every online mode it offers, its default first (the hub picks one each round: `info.mode`). */
  readonly mode: HubMode | readonly HubMode[];
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

/**
 * The modes a game joins with, each once, in its order (its first is its default), the older names
 * read as the hub reads them (race as ghost, co-op and versus as a shared world). Empty when none
 * is a mode.
 */
function offeredModes(mode: HubMode | readonly HubMode[]): HubMode[] {
  const list: HubMode[] = [];
  for (const m of typeof mode === 'string' ? [mode] : [...mode]) {
    const known = hubModeOf(m);
    if (known && !list.includes(known)) list.push(known);
  }
  return list;
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
 * start, then report: `progress()` and `result()` in parallel and ghost, `result({ won, time })`
 * in moments, `finish()` from a shared world's host. `send()` reaches the other copies (ghost and
 * a shared world). `rng(label)` draws what a set-up needs, the same on every copy.
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

  /**
   * A round with no hub behind it: what a replay of a recorded session runs on (the round's info
   * from the recording; the hub's events are recorded input). It sends and reports nothing, and its
   * clock never starts (`time()` is -Infinity).
   */
  static offline(info: HubInfo): HubSession {
    const quiet = (): void => {};
    const client: HubClient = {
      active: true,
      connect: () => Promise.resolve(info),
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
    return new HubSession(client, info, { mode: info.mode, seats: [1, 4], autoFlush: false });
  }

  /**
   * Connect to the hub. Null when there is none (outside a session): play as usual. Several modes
   * go to the hub as a list, one alone as itself (as hubs from before several modes read it).
   */
  static async join(options: JoinOptions): Promise<HubSession | null> {
    const client = options.client === undefined ? hubClient() : options.client;
    if (!client || !client.active) return null;
    const offered = offeredModes(options.mode);
    if (!offered.length) throw new Error(`HubSession: mode is one or more of ${HUB_MODES.join(', ')}`);
    const welcome = await client.connect({ mode: offered.length === 1 ? offered[0]! : offered, seats: options.seats, card: options.card === true });
    if (!welcome) return null;
    return new HubSession(client, welcome, options);
  }

  private constructor(client: HubClient, welcome: Partial<HubInfo> & { limits?: Partial<HubLimits> }, options: JoinOptions) {
    this.client = client;
    const players = (welcome.players ?? []).map((p, i) => ({ id: Number(p.id), name: String(p.name ?? `Player ${i + 1}`), color: String(p.color ?? HUB_COLORS[i % 4]) }));
    // the hub's pick, when it is one the game offered; else the game's first (its default); a
    // recording whose mode is none of today's replays in it as recorded
    const offered = offeredModes(options.mode);
    const picked = hubModeOf(welcome.mode);
    const mode = picked && offered.includes(picked) ? picked : (offered[0] ?? (welcome.mode as HubMode));
    const play = mode === 'shared-world' && HUB_PLAYS.includes(welcome.play as HubPlay) ? (welcome.play as HubPlay) : null;
    const moment = mode === 'moments' && typeof welcome.moment === 'string' && welcome.moment ? welcome.moment : null;
    this.info = {
      me: Number(welcome.me ?? 0),
      players,
      host: Number(welcome.host ?? 0),
      isHost: welcome.isHost === true || welcome.me === welcome.host,
      server: welcome.server === true,
      mode,
      play,
      moment,
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
   * one that came before; at `end` the engine stands still (speed 0), its sound stops and the
   * DualSense's light bar and triggers go back to the hub.
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

  /**
   * A generator of numbers in [0, 1), the same on every copy for the same label: the numbers the
   * hub's `AIHub.rng(label)` gives, from `info.seed`. A set-up draws from it (a moment's start, a
   * shared world's first spawn); the seed is recorded with the round's info, so a replay draws the
   * same. Each call starts the label's stream afresh.
   */
  rng(label?: string): Rng {
    const text = String(label === undefined ? '' : label); // as the client reads it: no label is ''
    let h = 0x811c9dc5; // FNV-1a, as the client hashes the label
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    const rng = new Rng(1);
    rng.state = (this.info.seed ^ h) >>> 0; // mulberry32 from the client's start (zero too)
    return rng;
  }

  /** Parallel and ghost: this player's standing, for the hub's scoreboard (it takes about one a second). */
  progress(score: number, label?: string): void {
    if (this.ended || this.reported || this.mode === 'shared-world' || this.mode === 'moments' || !finite(score)) return;
    this.client.progress(label === undefined ? { score } : { score, label: String(label).slice(0, 24) });
  }

  /**
   * This player's round is over: in parallel and ghost a finite `time` or `score`; in moments,
   * whether they cleared it (`won`) and the hub's `time()` then. Once: false when not taken.
   */
  result(outcome: HubResult): boolean {
    if (this.ended || this.reported || this.mode === 'shared-world' || !validResult(outcome, this.mode)) return false;
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
   * destinations' may interleave). Ignored in parallel and moments (copies send nothing), after the
   * end, and for data that isn't JSON (false).
   */
  send(data: unknown, to?: number): boolean {
    if (this.ended || this.mode === 'parallel' || this.mode === 'moments') return false;
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
   * After the end the game takes no input, its sound stops and a DualSense's light bar and
   * triggers are the hub's again: the hub shows its results over it.
   * Speed 0, not a pause, so frames still run and the game reads the `end` command.
   */
  private quiet(): void {
    const host = this.host;
    if (!host) return;
    if (host.audio) {
      host.audio.persist = false;
      host.audio.setMuted(true);
    }
    host.dualsense?.close();
    if ('timeScale' in host) host.timeScale = 0;
  }
}
