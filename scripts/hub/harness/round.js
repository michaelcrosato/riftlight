/**
 * round.js — one round of an AI Hub session, run by the hub that coordinates
 * it (the harness page, or the session host's tab).
 *
 * It never touches the network or a frame itself: every message for a game
 * goes out through `deliver(key, msg)`, and everything the games report comes
 * in through `receive(key, msg)` and `leave(key, reason)`. The clock is
 * injected, so `scripts/hub.test.mjs` can walk a round through every timeout
 * without waiting for one.
 *
 * Players are known by `key` (whatever the session calls them); games see
 * contiguous ids 0..N-1 in slot order.
 */

export const TIMINGS = Object.freeze({
  helloMs: 10_000,
  readyMs: 45_000,
  /** Gated rounds: a game still loading when the hub releases the round gets this long more. */
  loadGraceMs: 20_000,
  countdownMs: 3_000,
  graceMs: 5_000,
  hiddenMs: 20_000,
  maxRoundMs: 15 * 60_000,
});

/** P1 red, P2 blue, P3 green, P4 yellow: the colour follows the seat. */
export const SLOT_COLORS = Object.freeze(['#e8443a', '#3b82f6', '#22c55e', '#f5b700']);

export const MODES = Object.freeze(['parallel', 'ghost', 'shared-world']);

/** Each mode's name on screen. */
export const MODE_NAMES = Object.freeze({ parallel: 'Parallel', ghost: 'Ghost', 'shared-world': 'Shared world' });

/** Older tags, still played: race as ghost, co-op and versus as a shared world. */
const MODE_ALIASES = Object.freeze({ race: 'ghost', 'co-op': 'shared-world', versus: 'shared-world' });

/** The mode a tag or a hello names, older tags included; null for anything else. */
export function modeOf(word) {
  const w = String(word ?? '').trim().toLowerCase();
  return MODES.includes(w) ? w : (MODE_ALIASES[w] ?? null);
}

/** Modes where every copy runs its own world: each reports its own result, and nothing depends on a host. */
export const SELF_REPORTED = Object.freeze(['parallel', 'ghost']);

/**
 * Whether a game's round carries the seed in its address, so the client seeds
 * Math.random and every copy starts the same: read from the game's own tag,
 * parallel or ghost. A game still tagged race was built for an unseeded start
 * (ids it makes from Math.random must differ between its copies), so it keeps one.
 */
export const seedsRandom = (tag) => ['parallel', 'ghost'].includes(String(tag ?? '').trim().toLowerCase());

const REAL_CLOCK = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

/** A round's hard cap: half again its declared length, never past 15 minutes; the longest when it declares none. */
export function limitFor(minutes, { maxRoundMs = TIMINGS.maxRoundMs } = {}) {
  const typical = Number(minutes);
  if (!(typical > 0)) return maxRoundMs;
  return Math.min(maxRoundMs, Math.round(typical * 1.5 * 60_000));
}

/**
 * Parallel and ghost order: finishers by time, then the rest by score,
 * then anyone who reported nothing, tied last. Equal times or scores share a
 * place.
 */
export function rankResults(results, ids) {
  const timed = [];
  const scored = [];
  const silent = [];
  for (const id of ids) {
    const r = results.get(id);
    if (r && Number.isFinite(r.time)) timed.push([id, r.time]);
    else if (r && Number.isFinite(r.score)) scored.push([id, r.score]);
    else silent.push(id);
  }
  const groups = (list, order) => {
    list.sort((a, b) => order * (a[1] - b[1]) || a[0] - b[0]);
    const out = [];
    for (const [id, value] of list) {
      const last = out[out.length - 1];
      if (last && last.value === value) last.ids.push(id);
      else out.push({ value, ids: [id] });
    }
    return out.map((g) => g.ids);
  };
  return [...groups(timed, 1), ...groups(scored, -1), ...(silent.length ? [silent] : [])];
}

/** A time or score as a number: finite, given as a number or as text; NaN for null, '' or true, which Number() would make 0. */
const asNumber = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

/** How much of a round's highlights the results card shows: a game cannot flood it. */
export const HIGHLIGHTS = Object.freeze({ stats: 6, statName: 16, statText: 16, awards: 3, title: 24, detail: 40 });

/** One player's stats, trimmed: up to six names, each a finite number or a short text. Null when none survive. */
export function cleanStats(stats) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  const out = {};
  for (const [name, value] of Object.entries(stats).slice(0, HIGHLIGHTS.stats)) {
    const label = String(name).trim().slice(0, HIGHLIGHTS.statName);
    if (!label) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[label] = value;
    else if (typeof value === 'string' && value.trim()) out[label] = value.trim().slice(0, HIGHLIGHTS.statText);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Awards, trimmed: `{ id, title, detail? }`, at most three a player, for
 * players of this round. A result's awards are about its own player: `self` is its id.
 */
export function cleanAwards(awards, ids, self = null) {
  if (!Array.isArray(awards)) return [];
  const given = new Map();
  const out = [];
  for (const a of awards) {
    const id = self ?? a?.id;
    const title = String(a?.title ?? '').trim().slice(0, HIGHLIGHTS.title);
    if (!title || !ids.includes(id) || (given.get(id) || 0) >= HIGHLIGHTS.awards) continue;
    given.set(id, (given.get(id) || 0) + 1);
    const detail = String(a.detail ?? '').trim().slice(0, HIGHLIGHTS.detail);
    out.push(detail ? { id, title, detail } : { id, title });
  }
  return out;
}

/**
 * Check a host's standings: groups of ids, best first, every present player
 * exactly once. Players already gone may be placed or left out; whoever is
 * left out lands in a last group of their own.
 */
export function checkStandings(standings, presentIds, allIds) {
  if (!Array.isArray(standings)) return { ok: false, problem: 'standings is not an array' };
  const all = new Set(allIds);
  const seen = new Set();
  const groups = [];
  for (const group of standings) {
    const ids = Array.isArray(group) ? group : [group];
    const kept = [];
    for (const id of ids) {
      if (!Number.isInteger(id) || !all.has(id)) return { ok: false, problem: `unknown player id ${JSON.stringify(id)}` };
      if (seen.has(id)) return { ok: false, problem: `player ${id} is placed twice` };
      seen.add(id);
      kept.push(id);
    }
    if (kept.length) groups.push(kept);
  }
  const missing = presentIds.filter((id) => !seen.has(id));
  if (missing.length) return { ok: false, problem: `standings leave out player${missing.length > 1 ? 's' : ''} ${missing.join(', ')}` };
  const absent = allIds.filter((id) => !seen.has(id));
  if (absent.length) groups.push(absent);
  return { ok: true, standings: groups };
}

/**
 * @param {object} o
 * @param {number} o.round            round number, carried on every message
 * @param {{key:string, slot:number, name:string}[]} o.players
 * @param {string} o.hostKey          whose game runs a shared world
 * @param {string} [o.serverKey]      a copy with no player of its own that runs the shared world
 *                                    instead (a server): one more copy after the players, welcomed
 *                                    with server: true, never ranked; the round is void if it goes
 * @param {string|null} o.mode        parallel | ghost | shared-world, or an older tag (modeOf); null takes the first hello's
 * @param {number} o.seed
 * @param {number} o.limitMs
 * @param {{now:()=>number, setTimeout:Function, clearTimeout:Function}} [o.clock]
 * @param {(key:string, msg:object) => void} o.deliver
 * @param {(status:object) => void} [o.onStatus]
 * @param {(record:object) => void} [o.onEnd]
 * @param {boolean} [o.gate]          the hub shows a splash and collects the players' ready itself:
 *                                    games ready up once loaded, and the round starts on release()
 */
export function createRound({
  round,
  players,
  hostKey,
  mode = null,
  seed,
  limitMs,
  clock = REAL_CLOCK,
  deliver,
  onStatus = () => {},
  onEnd = () => {},
  timings = TIMINGS,
  gate = false,
  serverKey = null,
}) {
  mode = modeOf(mode);
  const t = { ...TIMINGS, ...timings };
  const seats = [...players]
    .sort((a, b) => a.slot - b.slot)
    .map((p, id) => ({
      id,
      key: p.key,
      slot: p.slot,
      name: p.name,
      color: SLOT_COLORS[p.slot % SLOT_COLORS.length],
      hello: false,
      ready: false,
      out: null,
      result: null,
      /** The last progress score the hub saw: the result of a player who never reports one. */
      progress: null,
      stats: null,
      awards: [],
      caps: null,
      hidden: null,
    }));
  const server = serverKey
    ? { id: seats.length, key: serverKey, slot: null, name: 'Server', color: null, hello: false, ready: false, out: null, result: null, progress: null, stats: null, awards: [], caps: null, hidden: null }
    : null;
  /** Every copy in the round: the players, then the server when there is one. */
  const copies = server ? [...seats, server] : seats;
  const byKey = new Map(copies.map((s) => [s.key, s]));
  const ids = seats.map((s) => s.id);
  const host = server ?? byKey.get(hostKey) ?? seats[0];
  const timers = new Set();
  const issues = [];
  let phase = 'loading';
  let goAt = null;
  let record = null;
  let released = !gate;

  const later = (ms, fn) => {
    const handle = clock.setTimeout(() => {
      timers.delete(handle);
      fn();
    }, Math.max(0, ms));
    timers.add(handle);
    return handle;
  };
  const cancel = (handle) => {
    if (handle == null) return;
    clock.clearTimeout(handle);
    timers.delete(handle);
  };

  /** The players still in the round. */
  const present = () => seats.filter((s) => !s.out);
  /** The copies still in the round: the players, and the server. */
  const presentCopies = () => copies.filter((s) => !s.out);
  const selfReported = () => SELF_REPORTED.includes(mode);
  const needsHost = () => !selfReported();
  const send = (seat, msg) => deliver(seat.key, { round, ...msg });
  const toPresent = (msg, except = null) => {
    for (const s of presentCopies()) if (s !== except && s.hello) send(s, msg);
  };
  const issue = (seat, problem) => {
    issues.push({ key: seat?.key ?? null, id: seat?.id ?? null, problem });
    status();
  };

  function status() {
    onStatus({
      round,
      phase,
      mode,
      host: host.id,
      goAt,
      gate,
      released,
      players: seats.map((s) => ({
        id: s.id,
        key: s.key,
        slot: s.slot,
        name: s.name,
        color: s.color,
        hello: s.hello,
        ready: s.ready,
        out: s.out,
        result: s.result,
        client: s.caps?.client ?? null,
      })),
      server: server && { id: server.id, key: server.key, hello: server.hello, ready: server.ready, out: server.out, client: server.caps?.client ?? null },
      issues: issues.slice(),
    });
  }

  function welcome(seat) {
    send(seat, {
      type: 'welcome',
      me: seat.id,
      host: host.id,
      players: seats.map((s) => ({ id: s.id, name: s.name, color: s.color })),
      keys: copies.map((s) => s.key),
      mode,
      seed: seed >>> 0,
      limitMs,
      ...(gate ? { splash: true } : {}),
      ...(seat === server ? { server: true } : {}),
    });
    for (const s of seats) if (s.out) send(seat, { type: 'leave', id: s.id, reason: s.out });
  }

  function markOut(seat, reason) {
    if (seat.out || phase === 'ended') return;
    seat.out = reason;
    cancel(seat.hidden);
    seat.hidden = null;
    toPresent({ type: 'leave', id: seat.id, reason });
    // A player who sat out is still at the hub: tell their game it is over for them.
    if (reason === 'not-ready' && seat.hello) send(seat, { type: 'end', reason: 'sat-out' });
  }

  function settle() {
    if (phase === 'ended') return;
    const left = present();
    if (!left.length) return finishVoid('no-players');
    if (needsHost() && host.out) {
      return finishVoid(host.out === 'not-ready' ? 'host-not-ready' : 'host-left', phase === 'loading' ? 'void' : 'host-left');
    }
    if (phase === 'loading') {
      if (released && presentCopies().every((s) => s.ready)) begin();
      return;
    }
    if (selfReported() && left.every((s) => s.result)) finishResults();
  }

  function begin() {
    phase = 'countdown';
    goAt = clock.now() + t.countdownMs;
    toPresent({ type: 'start', at: goAt });
    later(t.countdownMs, () => {
      if (phase === 'countdown') {
        phase = 'playing';
        status();
      }
    });
    later(t.countdownMs + limitMs, timeUp);
    status();
  }

  function timeUp() {
    if (phase === 'ended' || phase === 'grace') return;
    phase = 'grace';
    toPresent({ type: 'time-up', graceMs: t.graceMs });
    later(t.graceMs, () => {
      if (phase === 'ended') return;
      if (selfReported()) finishResults();
      else finishVoid('no-result');
    });
    status();
  }

  function finishResults() {
    // A player still here who never reported is ranked by the last progress the hub saw from them.
    const results = new Map(
      seats.filter((s) => s.result || (!s.out && Number.isFinite(s.progress))).map((s) => [s.id, s.result ?? { score: s.progress, fallback: true }])
    );
    // Whoever reported and then left keeps their place: only those who left with nothing count as beaten.
    const ranked = rankResults(results, seats.filter((s) => !s.out || s.result).map((s) => s.id));
    const gone = seats.filter((s) => s.out && !s.result).map((s) => s.id);
    const scores = {};
    for (const [id, r] of results) scores[id] = Number.isFinite(r.time) ? r.time : r.score;
    const stats = Object.fromEntries(seats.filter((s) => s.stats).map((s) => [s.id, s.stats]));
    const awards = seats.flatMap((s) => s.awards);
    finishPlayed(gone.length ? [...ranked, gone] : ranked, { scores, results: Object.fromEntries(results), stats, awards });
  }

  function finishPlayed(standings, extra = {}) {
    end({ status: 'played', reason: 'finished', endReason: 'finished', standings, ...extra });
  }

  function finishVoid(reason, endReason = 'void') {
    end({ status: 'void', reason, endReason, standings: null });
  }

  function end(outcome) {
    if (phase === 'ended') return;
    phase = 'ended';
    for (const handle of timers) clock.clearTimeout(handle);
    timers.clear();
    const msg = { type: 'end', reason: outcome.endReason };
    if (outcome.standings) msg.standings = outcome.standings;
    toPresent(msg);
    record = {
      round,
      mode,
      hostId: host.id,
      ...outcome,
      players: seats.map((s) => ({ id: s.id, key: s.key, slot: s.slot, name: s.name, color: s.color, out: s.out })),
      issues: issues.slice(),
    };
    status();
    onEnd(record);
  }

  function receive(key, msg) {
    const seat = byKey.get(key);
    if (!seat || !msg || typeof msg.type !== 'string' || phase === 'ended' || seat.out) return;
    switch (msg.type) {
      case 'hello': {
        if (seat.hello) return;
        seat.hello = true;
        seat.caps = { v: msg.v, client: msg.client, mode: msg.mode ?? null, seats: msg.seats ?? null, card: msg.card === true };
        if (msg.v !== 1) issue(seat, `hello speaks protocol ${JSON.stringify(msg.v)}, not 1`);
        const said = modeOf(msg.mode);
        if (!mode && said) mode = said;
        else if (msg.mode && said !== mode) issue(seat, `hello says mode ${msg.mode}, the round is ${mode}`);
        welcome(seat);
        status();
        return;
      }
      case 'ready':
        if (!seat.hello || seat.ready || phase !== 'loading') return;
        seat.ready = true;
        status();
        return settle();
      case 'result': {
        if (!selfReported()) return issue(seat, `result is for parallel and ghost; this round is ${mode}`);
        if (phase === 'loading') return issue(seat, 'result before start');
        if (seat.result) return;
        const time = asNumber(msg.time);
        const score = asNumber(msg.score);
        if (Number.isFinite(time)) seat.result = { time };
        else if (Number.isFinite(score)) seat.result = { score };
        else return issue(seat, 'result needs a finite time or score');
        seat.stats = cleanStats(msg.stats);
        seat.awards = cleanAwards(msg.awards, ids, seat.id);
        status();
        return settle();
      }
      case 'finish': {
        if (selfReported()) return issue(seat, `finish is for a shared world; ${mode} games report result`);
        if (seat !== host) return issue(seat, 'finish from a player who is not the host');
        if (phase === 'loading') return issue(seat, 'finish before start');
        const checked = checkStandings(msg.standings, present().map((s) => s.id), ids);
        if (!checked.ok) return issue(seat, `finish ignored: ${checked.problem}`);
        const scores = msg.scores && typeof msg.scores === 'object' ? msg.scores : undefined;
        const given = msg.stats && typeof msg.stats === 'object' ? msg.stats : {};
        const stats = Object.fromEntries(ids.map((id) => [id, cleanStats(given[id])]).filter(([, v]) => v));
        const awards = cleanAwards(msg.awards, ids);
        // won makes it a team result; a game tagged co-op that leaves it out lost, as co-op always read it.
        const won = typeof msg.won === 'boolean' ? msg.won : seat.caps?.mode === 'co-op' ? false : undefined;
        return finishPlayed(checked.standings, { scores, won, stats, awards });
      }
      case 'error':
        issue(seat, `game error: ${String(msg.message || '').slice(0, 200)}`);
        if (msg.fatal) {
          if (needsHost() && seat === host) return finishVoid('host-error');
          markOut(seat, 'disconnected');
          status();
          settle();
        }
        return;
      case 'vis':
        if (seat !== host || !needsHost()) return;
        if (msg.hidden && seat.hidden == null && phase !== 'loading') {
          seat.hidden = later(t.hiddenMs, () => finishVoid('host-hidden'));
        } else if (!msg.hidden) {
          cancel(seat.hidden);
          seat.hidden = null;
        }
        return;
      default:
        return issue(seat, `unknown message type ${JSON.stringify(msg.type)}`);
    }
  }

  function leave(key, reason = 'left') {
    const seat = byKey.get(key);
    if (!seat || seat.out || phase === 'ended') return;
    markOut(seat, reason);
    status();
    settle();
  }

  const sitOut = (test) => () => {
    if (phase !== 'loading') return;
    for (const s of copies) if (test(s) && !s.out) markOut(s, 'not-ready');
    status();
    settle();
  };

  function startRound() {
    // A gated round waits on the hub's splash, however long it holds: only
    // release() starts the clock on the games that are still loading.
    if (!gate) {
      later(t.helloMs, sitOut((s) => !s.hello));
      later(t.readyMs, sitOut((s) => !s.ready));
    }
    status();
  }

  /** The splash is over: start as soon as every game has loaded, and wait loadGraceMs at most for the slow ones. */
  function release() {
    if (released || phase !== 'loading') return;
    released = true;
    later(t.loadGraceMs, sitOut((s) => !s.ready));
    status();
    settle();
  }

  startRound();

  return {
    receive,
    leave,
    release,
    /** Call time now, as the cap would: the host pressed "End round". */
    timeUp() {
      if (phase === 'countdown' || phase === 'playing') timeUp();
    },
    /** A player's progress score, as the hub's scoreboard saw it (parallel and ghost). */
    progress(id, score) {
      const seat = seats[id];
      if (seat && !seat.out && !seat.result && Number.isFinite(score) && phase !== 'ended') seat.progress = score;
    },
    /** End the round now: the session ended, or the host skipped this game. */
    abort(reason = 'skipped') {
      finishVoid(reason, reason === 'session-ended' ? 'session-ended' : 'void');
    },
    get phase() {
      return phase;
    },
    get released() {
      return released;
    },
    get record() {
      return record;
    },
    get mode() {
      return mode;
    },
    seats: () => seats.map((s) => ({ ...s, hidden: undefined })),
  };
}
