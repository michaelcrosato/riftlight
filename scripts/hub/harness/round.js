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
  /** Again: an attempt is offered only with at least this long left to play it. */
  againMinMs: 20_000,
  /** Again: once every other player is done, an attempt still going gets this long before time is called. */
  againLastMs: 30_000,
  /** Moments: after time-up, a moment's games have this long to report, where a round's have graceMs. */
  momentGraceMs: 2_000,
  /** Moments: the last moment's results, then the next one's cue, stay this long at least before it starts. */
  momentCueMs: 2_500,
});

/** P1 red, P2 blue, P3 green, P4 yellow: the colour follows the seat. */
export const SLOT_COLORS = Object.freeze(['#e8443a', '#3b82f6', '#22c55e', '#f5b700']);

export const MODES = Object.freeze(['parallel', 'ghost', 'shared-world', 'moments']);

/** Each mode's name on screen. */
export const MODE_NAMES = Object.freeze({ parallel: 'Parallel', ghost: 'Ghost', 'shared-world': 'Shared world', moments: 'Moments' });

/** Older tags, still played: race as ghost, co-op and versus as a shared world. */
const MODE_ALIASES = Object.freeze({ race: 'ghost', 'co-op': 'shared-world', versus: 'shared-world' });

/** The mode a tag or a hello names, older tags included; null for anything else. */
export function modeOf(word) {
  const w = String(word ?? '').trim().toLowerCase();
  return MODES.includes(w) ? w : (MODE_ALIASES[w] ?? null);
}

/** Modes where every copy runs its own world: each reports its own result, and nothing depends on a host. */
export const SELF_REPORTED = Object.freeze(['parallel', 'ghost', 'moments']);

/**
 * Whether a game's round carries the seed in its address, so the client seeds
 * Math.random and every copy starts the same: read from the game's own tag,
 * parallel, ghost or moments. A game still tagged race was built for an
 * unseeded start (ids it makes from Math.random must differ between its
 * copies), so it keeps one.
 */
export const seedsRandom = (tag) => ['parallel', 'ghost', 'moments'].includes(String(tag ?? '').trim().toLowerCase());

/* --- moments (hub:moment) -------------------------------------------------------- */

/**
 * What the player does in a moment: the one word the hub shows, big, as the
 * moment begins, in the player's own language. Each moment names one; it is
 * how moments are classed, whatever the game.
 */
export const VERBS = Object.freeze([
  'aim', 'balance', 'block', 'build', 'catch', 'climb', 'collect', 'defeat', 'defend', 'destroy',
  'dodge', 'drift', 'escape', 'find', 'fly', 'hide', 'hit', 'jump', 'land', 'park',
  'race', 'reach', 'score', 'shoot', 'sneak', 'solve', 'steer', 'stop', 'survive', 'throw',
]);

/** Moments as the protocol bounds them: at least three a game, each 3 to 30 seconds; a round plays three. */
export const MOMENTS = Object.freeze({ least: 3, perRound: 3, shortest: 3, longest: 30, id: 24, goal: 60 });

const MOMENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * hub:moment, read: one tag a moment, "ID VERB SECONDS GOAL". The id is the
 * game's own name for it, the verb one of VERBS, the seconds how long it lasts,
 * and the goal what clears it. Takes the tags' contents (a list, or one).
 * Moments that do not read are left out, each with a problem in words;
 * lib/hub/catalogue-check.mjs holds a page to the same rules.
 */
export function parseMoments(list) {
  const moments = [];
  const problems = [];
  for (const raw of Array.isArray(list) ? list : list == null ? [] : [list]) {
    const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const [id, verb = '', secondsText = '', ...rest] = text.split(' ');
    const goal = rest.join(' ');
    const wrong = (why) => problems.push(`"${text}": ${why}`);
    if (!MOMENT_ID.test(id) || id.length > MOMENTS.id) {
      wrong(`ID, then VERB, SECONDS and GOAL: the id is lowercase letters, digits and hyphens, at most ${MOMENTS.id} characters`);
      continue;
    }
    if (!VERBS.includes(verb.toLowerCase())) {
      wrong(`${verb ? `"${verb}" is not` : 'the verb is'} one of ${VERBS.join(', ')}`);
      continue;
    }
    const seconds = Number(secondsText);
    if (!/^\d+$/.test(secondsText) || seconds < MOMENTS.shortest || seconds > MOMENTS.longest) {
      wrong(`lasts a whole number of seconds, ${MOMENTS.shortest} to ${MOMENTS.longest}`);
      continue;
    }
    if (!goal) {
      wrong('ends with its goal: what clears it');
      continue;
    }
    if (goal.length > MOMENTS.goal) {
      wrong(`its goal is ${goal.length} characters: at most ${MOMENTS.goal}`);
      continue;
    }
    if (moments.some((m) => m.id === id)) {
      wrong(`the id ${id} is given twice`);
      continue;
    }
    moments.push({ id, verb: verb.toLowerCase(), seconds, goal });
  }
  return { moments, problems };
}

/** A game's moments as they read (`moments`, the hub:moment tags' contents). */
export const momentsOf = (game) => parseMoments(game?.moments).moments;

/** Whether a game has the moments a round of moments needs. */
export const hasMoments = (game) => momentsOf(game).length >= MOMENTS.least;

/** mulberry32, as the client's: numbers in [0, 1), the same sequence everywhere for the same 32-bit start. */
function generator(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed of a round's moment `index`: each moment its own start, the same on every copy. */
export function momentSeed(seed, index) {
  let h = ((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The moments a round plays: `count` of the game's, picked and ordered by the seed, so every seat agrees. */
export function pickMoments(moments, seed, count = MOMENTS.perRound) {
  const random = generator(seed >>> 0);
  const deck = [...moments];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, count);
}

/* --- every way a game plays together (hub:multiplayer) ------------------------- */

/**
 * Where the players are. Online, each on their own device, in a 52in1 game
 * night: the session's three modes. Or together on one device: one view they
 * all share, a view each, or taking turns.
 */
export const ONLINE = MODES;
const LOCAL = Object.freeze(['same-screen', 'split-screen', 'hot-seat']);
/**
 * A game with players on one screen that says no more than its seats and a
 * co-op or versus tag, as every game did before hub:multiplayer. Never
 * written in hub:multiplayer: it names the three above.
 */
const ONE_SCREEN = 'couch';
/** How they play, in a shared world or on one device. Parallel, ghost and moments are always a race. */
const PLAYS = Object.freeze(['co-op', 'versus', 'other']);
/** The most players a mode on one device may seat; online, a session seats four. */
const LOCAL_MOST = 8;
const ONLINE_MOST = 4;

/** Whether a mode plays online, in a session. */
export const isOnline = (mode) => ONLINE.includes(mode?.where);

/** A mode's one word for the session's per-mode tags (hub:session-goal-WORD): its play in a shared world, else its own. */
export const modeWord = (mode) => (mode?.where === 'shared-world' && mode.play ? mode.play : mode?.where ?? null);

/** "shared-world co-op", "parallel": a mode as a filter, the deal and the record name it. */
export const modeKey = (mode) => (mode?.play ? `${mode.where} ${mode.play}` : mode?.where ?? '');

function makeMode(where, play, seats, extra = {}) {
  const mode = { where, play: play ?? null, seats, ...extra };
  return { ...mode, key: modeKey(mode) };
}

/**
 * hub:multiplayer, read: "shared-world co-op 2, split-screen versus 2-4" names
 * each way to play together, where, then how (not for parallel, ghost or
 * moments), then MIN-MAX players. Entries that do not read are left out, each
 * with a problem in words; lib/hub/catalogue-check.mjs holds a page to the
 * same rules.
 */
export function parseMultiplayer(text) {
  const modes = [];
  const problems = [];
  for (const raw of String(text ?? '').split(',')) {
    const entry = raw.trim().replace(/\s+/g, ' ');
    if (!entry) continue;
    const words = entry.toLowerCase().split(' ');
    const where = words[0];
    const play = words.length === 3 ? words[1] : null;
    const seats = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(words.at(-1) ?? '');
    const wrong = (why) => problems.push(`"${entry}": ${why}`);
    if (words.length < 2 || words.length > 3) {
      wrong('WHERE, then HOW (not for parallel, ghost or moments), then MIN-MAX players');
      continue;
    }
    if (!ONLINE.includes(where) && !LOCAL.includes(where)) {
      wrong(`${where} is not one of ${[...ONLINE, ...LOCAL].join(', ')}`);
      continue;
    }
    const race = where === 'parallel' || where === 'ghost' || where === 'moments';
    if (race && play !== null) {
      wrong(`${where} is always a race: leave out ${play}`);
      continue;
    }
    if (!race && !PLAYS.includes(play)) {
      wrong(`${where} needs how they play: ${PLAYS.join(', ')}`);
      continue;
    }
    if (!seats) {
      wrong('ends with the players, MIN-MAX');
      continue;
    }
    const low = Number(seats[1]);
    const high = Number(seats[2] ?? seats[1]);
    const most = ONLINE.includes(where) ? ONLINE_MOST : LOCAL_MOST;
    if (low < 1 || high < low || high > most) {
      wrong(`players from 1 to ${most}, MIN-MAX`);
      continue;
    }
    if (LOCAL.includes(where) && high < 2) {
      wrong('on one device it seats 2 or more');
      continue;
    }
    const mode = makeMode(where, play, [low, high], ONLINE.includes(where) ? { seeded: race } : {});
    if (modes.some((m) => m.key === mode.key)) {
      wrong(`${mode.key} is given twice`);
      continue;
    }
    modes.push(mode);
  }
  return { modes, problems };
}

/** "1–4", "2", "2-4": the range, or null. */
const rangeOf = (text) => {
  const [low, high = low] = (String(text ?? '').match(/\d+/g) || []).map(Number);
  return low ? [low, Math.max(low, high)] : null;
};

/**
 * Every way a game plays together, from its catalogue fields (a game in
 * data/games.json, or a head's hub:* tags read the same way): what
 * hub:multiplayer names, and what the older tags say where it is silent. A
 * game that names its online modes in no hub:multiplayer has the one its
 * hub:session-mode tag names; one that names no local modes has one screen's,
 * from hub:players and its co-op or versus tag. Online modes are listed
 * whatever hub:session says: whether a session can deal one is the hub's call.
 * Moments are listed only for a game with the moments a round needs, and they
 * add to a game's modes: one whose hub:multiplayer names moments and no other
 * online mode still plays the mode its session tag names, as it did before
 * (an older race game keeps its unseeded start).
 */
export function modesOf(game) {
  // Moments are a mode only for a game that has the moments a round needs (hub:moment).
  const declared = (game?.multiplayer ? parseMultiplayer(game.multiplayer).modes : []).filter((m) => m.where !== 'moments' || hasMoments(game));
  const online = declared.filter(isOnline);
  const local = declared.filter((m) => !isOnline(m));
  const tags = Array.isArray(game?.tags) ? game.tags : [];
  const tag = String(game?.sessionMode ?? '').trim().toLowerCase();
  const sessionMode = modeOf(tag);
  // hub:multiplayer naming moments alone adds them to what the older tags say, which still count.
  const onlyMoments = declared.length > 0 && declared.every((m) => m.where === 'moments');
  if ((!online.length || (onlyMoments && sessionMode !== 'moments')) && sessionMode && Number(game?.session) >= 1 && (sessionMode !== 'moments' || hasMoments(game))) {
    let play = null;
    if (sessionMode === 'shared-world') {
      const coop = tags.includes('co-op');
      const versus = tags.includes('versus');
      play = tag === 'co-op' || tag === 'versus' ? tag : coop !== versus ? (coop ? 'co-op' : 'versus') : null;
    }
    // The session tag's mode first: it is the one the game plays when nothing says which.
    online.unshift(makeMode(sessionMode, play, rangeOf(game.sessionPlayers) ?? [2, 4], { seeded: seedsRandom(tag) }));
  }
  if (!declared.length || onlyMoments) {
    // hub:players counts a ghost or shared world's seats; otherwise several seats are one screen's.
    const players = rangeOf(game?.players);
    if (players && players[1] >= 2 && (!sessionMode || sessionMode === 'parallel')) {
      const plays = ['co-op', 'versus'].filter((p) => tags.includes(p));
      for (const play of plays.length ? plays : [null]) local.push(makeMode(ONE_SCREEN, play, players));
    }
  }
  return [...online, ...local];
}


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
  return [...grouped(timed, 1), ...grouped(scored, -1), ...(silent.length ? [silent] : [])];
}

/** Groups of ids, best first, from [id, value] pairs: `order` 1 puts the lowest first, -1 the highest; equal values share a group. */
function grouped(list, order) {
  list.sort((a, b) => order * (a[1] - b[1]) || a[0] - b[0]);
  const out = [];
  for (const [id, value] of list) {
    const last = out[out.length - 1];
    if (last && last.value === value) last.ids.push(id);
    else out.push({ value, ids: [id] });
  }
  return out.map((g) => g.ids);
}

/**
 * One moment's order: the players who cleared it, the quickest first; then
 * those who failed it, the last to fail first; then anyone who reported
 * nothing, tied last. Equal times share a place.
 */
export function rankMoment(results, ids) {
  const cleared = [];
  const failed = [];
  const silent = [];
  for (const id of ids) {
    const r = results.get(id);
    if (r && r.won === true && Number.isFinite(r.time)) cleared.push([id, r.time]);
    else if (r && r.won === false && Number.isFinite(r.time)) failed.push([id, r.time]);
    else silent.push(id);
  }
  return [...grouped(cleared, 1), ...grouped(failed, -1), ...(silent.length ? [silent] : [])];
}

/** How many players each player beat in one set of standings: everyone in the groups below theirs. */
function beatenIn(standings) {
  const beaten = new Map();
  let below = standings.reduce((n, group) => n + group.length, 0);
  for (const group of standings) {
    below -= group.length;
    for (const id of group) beaten.set(id, below);
  }
  return beaten;
}

/**
 * A round of moments, ranked: more moments cleared first, then more players
 * beaten across the moments (each moment's own order, rankMoment), then a
 * player still here before one who left. Returns the standings and, for each
 * player, `{ cleared, beaten, of }`: moments cleared, players beaten, moments played.
 */
export function rankMoments(played, ids, gone = []) {
  const away = new Set(gone);
  const tally = new Map(ids.map((id) => [id, { cleared: 0, beaten: 0, of: played.length }]));
  for (const moment of played) {
    for (const [id, n] of beatenIn(moment.standings ?? [])) if (tally.has(id)) tally.get(id).beaten += n;
    for (const id of ids) if (moment.results?.[id]?.won === true) tally.get(id).cleared += 1;
  }
  const order = [...ids].sort((a, b) => {
    const x = tally.get(a);
    const y = tally.get(b);
    return y.cleared - x.cleared || y.beaten - x.beaten || Number(away.has(a)) - Number(away.has(b)) || a - b;
  });
  const standings = [];
  let previous = null;
  for (const id of order) {
    const key = `${tally.get(id).cleared}:${tally.get(id).beaten}:${away.has(id)}`;
    if (key === previous) standings.at(-1).push(id);
    else standings.push([id]);
    previous = key;
  }
  return { standings, tally: Object.fromEntries(tally) };
}

/** Whether result `a` beats `b`: a finish beats a score, a lower time or a higher score wins; anything beats nothing. */
export function betterResult(a, b) {
  if (!b) return Boolean(a);
  if (!a) return false;
  const at = Number.isFinite(a.time);
  if (at !== Number.isFinite(b.time)) return at;
  return at ? a.time < b.time : a.score > b.score;
}

/** A time or score as a number: finite, given as a number or as text; NaN for null, '' or true, which Number() would make 0. */
const asNumber = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

/** A player's result as a status carries it: { time } or { score }, finite, or a moment's { won, time }; else null. */
const reported = (r) =>
  r && typeof r.won === 'boolean' && Number.isFinite(r.time)
    ? { won: r.won, time: r.time }
    : r && Number.isFinite(r.time) ? { time: r.time } : r && Number.isFinite(r.score) ? { score: r.score } : null;

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
 * @param {string|null} o.mode        parallel | ghost | shared-world | moments, or an older tag (modeOf); null takes the first hello's
 * @param {string|null} [o.moment]    moments: the id of the moment this round plays (hub:moment), in the welcome
 * @param {string|null} [o.play]      in a shared world: co-op, versus or other, when the game names how it plays
 *                                    (hub:multiplayer); the welcome tells the game, so one with several plays starts this one
 * @param {number} o.seed
 * @param {number} o.limitMs
 * @param {{now:()=>number, setTimeout:Function, clearTimeout:Function}} [o.clock]
 * @param {(key:string, msg:object) => void} o.deliver
 * @param {(status:object) => void} [o.onStatus]
 * @param {(record:object) => void} [o.onEnd]
 * @param {boolean} [o.gate]          the hub shows a splash and collects the players' ready itself:
 *                                    games ready up once loaded, and the round starts on release()
 * @param {object} [o.resume]         carry on a round another coordinator left, from the last status of
 *                                    it (onStatus's), with `gone`: the keys that left with it (resumeRound)
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
  play = null,
  resume = null,
  moment = null,
}) {
  mode = modeOf(mode);
  play = PLAYS.includes(play) ? play : null;
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
      /** Again (parallel): the attempts this player has started, whether one is going now, and which was best. */
      attempts: 1,
      retrying: false,
      best: 1,
      retryTimer: null,
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
  /** Again: time is called this long after every other player is done (againLastMs), and when. */
  let lastCall = null;
  let lastCallAt = null;

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
      play,
      host: host.id,
      goAt,
      gate,
      released,
      lastCallAt,
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
        attempts: s.attempts,
        best: s.best,
        retrying: s.retrying,
        // With the result, what a round carried on from this status keeps of it (resume).
        stats: s.stats,
        awards: s.awards,
      })),
      server: server && { id: server.id, key: server.key, hello: server.hello, ready: server.ready, out: server.out, client: server.caps?.client ?? null },
      issues: issues.slice(),
    });
  }

  function welcome(seat) {
    // Another attempt (Again) plays in what is left of the round, on the same seed.
    const again = seat.retrying && goAt !== null;
    send(seat, {
      type: 'welcome',
      me: seat.id,
      host: host.id,
      players: seats.map((s) => ({ id: s.id, name: s.name, color: s.color })),
      keys: copies.map((s) => s.key),
      mode,
      play,
      seed: seed >>> 0,
      limitMs: again ? Math.max(0, goAt + limitMs - clock.now() - t.countdownMs) : limitMs,
      ...(again ? { attempt: seat.attempts } : {}),
      ...(mode === 'moments' && moment ? { moment } : {}),
      ...(gate && !again ? { splash: true } : {}),
      ...(seat === server ? { server: true } : {}),
    });
    for (const s of seats) if (s.out) send(seat, { type: 'leave', id: s.id, reason: s.out });
  }

  function markOut(seat, reason) {
    if (seat.out || phase === 'ended') return;
    seat.out = reason;
    cancel(seat.hidden);
    seat.hidden = null;
    // Gone mid-attempt: the best run they had stands.
    seat.retrying = false;
    cancel(seat.retryTimer);
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
    if (selfReported() && left.every((s) => s.result && !s.retrying)) return finishResults();
    // Everyone else is done and someone is on another attempt: they get againLastMs to finish it.
    if (phase === 'playing' && lastCall === null && left.every((s) => s.result) && left.some((s) => s.retrying)) {
      lastCall = later(t.againLastMs, timeUp);
      lastCallAt = clock.now() + t.againLastMs;
      status();
    }
  }

  /**
   * Whether a player may start another attempt now (Again, parallel only):
   * their run is over, someone else is still playing, time is not being
   * called yet, and there is time left to play one.
   */
  function mayAgain(seat) {
    if (mode !== 'parallel' || phase !== 'playing' || lastCall !== null || goAt === null) return false;
    if (!seat || seat.out || !seat.result || seat.retrying) return false;
    if (goAt + limitMs - clock.now() < t.againMinMs) return false;
    return present().some((s) => s !== seat && (!s.result || s.retrying));
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
    if (mode === 'moments') return finishMoment();
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

  /** A moment: cleared, then failed, then silent (rankMoment); a player who left with nothing comes last. */
  function finishMoment() {
    const results = new Map(seats.filter((s) => s.result).map((s) => [s.id, s.result]));
    const ranked = rankMoment(results, seats.filter((s) => !s.out || s.result).map((s) => s.id));
    const gone = seats.filter((s) => s.out && !s.result).map((s) => s.id);
    const stats = Object.fromEntries(seats.filter((s) => s.stats).map((s) => [s.id, s.stats]));
    const awards = seats.flatMap((s) => s.awards);
    finishPlayed(gone.length ? [...ranked, gone] : ranked, { results: Object.fromEntries(results), stats, awards });
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
      play,
      hostId: host.id,
      ...outcome,
      players: seats.map((s) => ({ id: s.id, key: s.key, slot: s.slot, name: s.name, color: s.color, out: s.out, ...(s.attempts > 1 ? { attempts: s.attempts, best: s.best } : {}) })),
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
        // A game with several online modes names them all; the round is one of them.
        const named = (Array.isArray(msg.mode) ? msg.mode : [msg.mode]).filter((m) => m != null && m !== '');
        const said = named.map(modeOf);
        if (!mode && said[0]) mode = said[0];
        else if (named.length && !said.includes(mode)) issue(seat, `hello says mode ${named.join(', ')}, the round is ${mode}`);
        welcome(seat);
        status();
        return;
      }
      case 'ready':
        if (!seat.hello || seat.ready) return;
        if (seat.retrying) {
          // Another attempt has loaded: its own 3-2-1, on its own, while the round plays on; during
          // the round's own countdown (a page that came back then: rejoin), the round's start.
          seat.ready = true;
          cancel(seat.retryTimer);
          seat.retryTimer = null;
          if (phase === 'playing') send(seat, { type: 'start', at: clock.now() + t.countdownMs });
          else if (phase === 'countdown') send(seat, { type: 'start', at: goAt });
          status();
          return;
        }
        if (phase !== 'loading') return;
        seat.ready = true;
        status();
        return settle();
      case 'again': {
        // The page asked for another attempt; it reloads the game once it sees this in the status.
        if (!mayAgain(seat)) return;
        seat.attempts += 1;
        seat.retrying = true;
        seat.hello = false;
        seat.ready = false;
        cancel(seat.retryTimer);
        seat.retryTimer = later(t.readyMs, () => giveUpAttempt(seat));
        status();
        return;
      }
      case 'result': {
        if (!selfReported()) return issue(seat, `result is for parallel and ghost; this round is ${mode}`);
        if (phase === 'loading') return issue(seat, 'result before start');
        if (seat.result && !seat.retrying) return;
        if (mode === 'moments') return momentResult(seat, msg);
        const time = asNumber(msg.time);
        const score = asNumber(msg.score);
        const result = Number.isFinite(time) ? { time } : Number.isFinite(score) ? { score } : null;
        if (!result) return issue(seat, 'result needs a finite time or score');
        if (seat.retrying) {
          seat.retrying = false;
          cancel(seat.retryTimer);
          seat.retryTimer = null;
        }
        // Again: only a better run replaces the best one, with its stats and awards.
        if (betterResult(result, seat.result)) {
          seat.result = result;
          seat.best = seat.attempts;
          seat.stats = cleanStats(msg.stats);
          seat.awards = cleanAwards(msg.awards, ids, seat.id);
        }
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

  /**
   * A moment cleared or failed (won), at its time on the round's timeline,
   * kept within the moment, so everyone still going at time-up ties. A game
   * that gives no time is timed by the hub. A moment is played once: a page
   * that came back after its result (rejoin) does not play it again.
   */
  function momentResult(seat, msg) {
    if (seat.result) return;
    const won = typeof msg.won === 'boolean' ? msg.won : null;
    if (won === null) issue(seat, 'a moment\'s result says won: true or false');
    const given = asNumber(msg.time);
    const time = Number.isFinite(given) ? given : goAt === null ? 0 : clock.now() - goAt;
    seat.result = { won: won === true, time: Math.round(Math.min(Math.max(0, time), limitMs)) };
    seat.retrying = false;
    cancel(seat.retryTimer);
    seat.retryTimer = null;
    seat.stats = cleanStats(msg.stats);
    seat.awards = cleanAwards(msg.awards, ids, seat.id);
    status();
    return settle();
  }

  /** An attempt whose game never got going is given up, and the best run stands. */
  function giveUpAttempt(seat) {
    seat.retryTimer = null;
    if (!seat.retrying || seat.ready) return;
    seat.retrying = false;
    status();
    settle();
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

  /**
   * Carry on a round its first coordinator left behind (the session's host
   * closed its tab), from the last status everyone saw of it (`resume`: that
   * status, with `gone`, the keys that left with it): its phase and start,
   * the results, stats and attempts already in, who had left. The games hear
   * only who left. Each game already welcomed is welcomed and started again,
   * which its bridge ignores unless the first went missing as the round
   * changed hands. Only a round whose copies each report their own result
   * (parallel, ghost) can go on: a shared world died with its host's copy.
   */
  function resumeRound(r) {
    for (const row of Array.isArray(r.players) ? r.players : []) {
      const seat = byKey.get(row?.key);
      if (!seat || seat === server) continue;
      seat.hello = row.hello === true;
      seat.ready = row.ready === true;
      seat.out = typeof row.out === 'string' ? row.out : null;
      seat.result = reported(row.result);
      seat.progress = Number.isFinite(row.progress) ? row.progress : null;
      seat.stats = cleanStats(row.stats);
      seat.awards = cleanAwards(row.awards, ids, seat.id);
      seat.attempts = Number.isInteger(row.attempts) && row.attempts > 1 ? row.attempts : 1;
      seat.best = Number.isInteger(row.best) && row.best >= 1 && row.best <= seat.attempts ? row.best : 1;
      seat.retrying = row.retrying === true && !seat.out;
    }
    const now = clock.now();
    phase = ['countdown', 'playing', 'grace'].includes(r.phase) && Number.isFinite(r.goAt) ? r.phase : 'loading';
    goAt = phase === 'loading' ? null : r.goAt;
    released = phase !== 'loading' || r.released === true || !gate;
    if (phase === 'countdown' && goAt <= now) phase = 'playing';
    // Who left with the old coordinator is out first, so nothing more goes to them; each game still here
    // hears it once, with its welcome said again (welcome tells of every seat that is out).
    for (const k of Array.isArray(r.gone) ? r.gone : []) {
      const seat = byKey.get(k);
      if (seat && !seat.out) {
        seat.out = 'left';
        seat.retrying = false;
      }
    }
    for (const seat of copies) if (seat.hello && !seat.out) welcome(seat);
    if (phase === 'countdown' || phase === 'playing') {
      for (const seat of present()) if (seat.hello && seat.ready) send(seat, { type: 'start', at: goAt });
      if (phase === 'countdown') {
        later(goAt - now, () => {
          if (phase === 'countdown') {
            phase = 'playing';
            status();
          }
        });
      }
      later(goAt + limitMs - now, timeUp);
      if (Number.isFinite(r.lastCallAt)) {
        lastCallAt = r.lastCallAt;
        lastCall = later(lastCallAt - now, timeUp);
      }
    } else if (phase === 'grace') {
      later(t.graceMs, () => {
        if (phase === 'ended') return;
        if (selfReported()) finishResults();
        else finishVoid('no-result');
      });
    } else if (released) {
      later(t.loadGraceMs, sitOut((s) => !s.ready));
    }
    for (const seat of seats) if (seat.retrying && !seat.ready) seat.retryTimer = later(t.readyMs, () => giveUpAttempt(seat));
    status();
    settle();
  }

  if (resume) resumeRound(resume);
  else startRound();

  return {
    receive,
    leave,
    release,
    /** Call time now, as the cap would: the host pressed "End round". */
    timeUp() {
      if (phase === 'countdown' || phase === 'playing') timeUp();
    },
    /**
     * A player's page loaded its game afresh in the middle of the round (it
     * reloaded, or a newer tab took over): the game's next hello is welcomed
     * into what is left of the round, on the same seed. Before the start that
     * is the same welcome again; once the round has begun, in parallel and
     * ghost, another attempt, which counts only if it beats the run it already
     * has (as Again does). False when the round cannot take the game back: a
     * shared world, a player already out, time being called, a round over.
     */
    rejoin(key) {
      const seat = byKey.get(key);
      if (!seat || seat === server || seat.out || phase === 'ended' || phase === 'grace') return false;
      if (!seat.hello) return true;
      if (goAt === null) {
        seat.hello = false;
        seat.ready = false;
        status();
        return true;
      }
      if (!selfReported()) return false;
      // A moment is played once: one already cleared or failed is not played again.
      if (mode === 'moments' && seat.result) return false;
      seat.attempts += 1;
      seat.retrying = true;
      seat.hello = false;
      seat.ready = false;
      cancel(seat.retryTimer);
      seat.retryTimer = later(t.readyMs, () => giveUpAttempt(seat));
      status();
      return true;
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
    /** Stop without a word to the games and with no record: another tab coordinates the round now (resume). */
    stop() {
      if (phase === 'ended') return;
      phase = 'ended';
      for (const handle of timers) clock.clearTimeout(handle);
      timers.clear();
      for (const s of copies) s.retryTimer = null;
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
    get play() {
      return play;
    },
    seats: () => seats.map((s) => ({ ...s, hidden: undefined, retryTimer: undefined })),
    /** Whether the player `key` may start another attempt now (Again). */
    mayAgain: (key) => mayAgain(byKey.get(key)),
  };
}

/* --- a round of moments ------------------------------------------------------------ */

/** A moment's record as it travels in a status: its results, each { won, time }, checked. */
function cleanMomentResults(results, ids) {
  const out = {};
  for (const id of ids) {
    const r = results?.[id];
    if (r && typeof r.won === 'boolean' && Number.isFinite(r.time)) out[id] = { won: r.won, time: r.time };
  }
  return out;
}

/** Standings as they travel in a status: groups of known ids, each id once; null when they are not that. */
function cleanGroups(standings, ids) {
  if (!Array.isArray(standings)) return null;
  const seen = new Set();
  const out = [];
  for (const group of standings) {
    if (!Array.isArray(group)) return null;
    const kept = group.filter((id) => ids.includes(id) && !seen.has(id));
    for (const id of kept) seen.add(id);
    if (kept.length) out.push(kept);
  }
  return out;
}

/**
 * A round of moments (mode `moments`, lib/hub/README.md): moments of one
 * game, one after another, each a round of its own (createRound) for which
 * every copy loads the game afresh, with the moment's id in its welcome, a
 * seed of its own (momentSeed), the moment's length as its limit and a short
 * grace after time-up (momentGraceMs). The first moment waits on the hub's
 * card (`gate`, release()); each one after it loads as soon as the last one
 * ends, and starts once that one's results and its own cue have had
 * momentCueMs on screen and every game has loaded. A player who leaves is out
 * of the moments after; one who sat a moment out (their game was not ready in
 * time) plays the next. Every message to a game carries `step`, the moment's
 * place in the round, and a message from a game naming another step is
 * dropped, so a slow result never lands in the next moment.
 *
 * The round ranks its players by moments cleared, then by the players they
 * beat across them (rankMoments); its record keeps every moment's results.
 * The interface is createRound's.
 *
 * @param {object} o          as createRound's, without mode, play, limitMs and serverKey, and:
 * @param {{id:string, verb:string, seconds:number, goal:string}[]} o.moments   the moments, in the order they play
 * @param {object} [o.resume] carry on a round of moments another coordinator left, from the last status
 *                            of it (onStatus's), with `gone`: the keys that left with it
 */
export function createMoments({
  round,
  players,
  hostKey,
  seed,
  moments,
  clock = REAL_CLOCK,
  deliver,
  onStatus = () => {},
  onEnd = () => {},
  timings = TIMINGS,
  gate = true,
  resume = null,
}) {
  const t = { ...TIMINGS, ...timings };
  const stepTimings = { ...t, graceMs: t.momentGraceMs };
  const order = [...players].sort((a, b) => a.slot - b.slot);
  const ids = order.map((_, id) => id);
  const hostId = Math.max(0, order.findIndex((p) => p.key === hostKey));
  const list = moments.map(({ id, verb, seconds, goal }) => ({ id, verb, seconds, goal }));
  /** Out for good, by key, and why: left, disconnected or removed. */
  const gone = new Map();
  /** The moments played so far: { id, verb, seconds, goal, status, reason, standings, results, awards }. */
  const done = [];
  /** The problems of the moments played so far; the one playing has its own. */
  const pastIssues = [];
  let step = 0;
  let current = null;
  let currentStatus = null;
  let ended = false;
  let record = null;
  let releaseAt = null;
  let releaseTimer = null;
  /** Time was called on the round: the moment playing now is its last. */
  let last = false;
  /** The round was skipped, or the session ended: it is void, whatever was played. */
  let aborted = null;

  function clearRelease() {
    if (releaseTimer != null) clock.clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  function status() {
    const s = currentStatus;
    if (!s) return;
    onStatus({
      ...s,
      mode: 'moments',
      phase: ended ? 'ended' : s.phase,
      host: hostId,
      step,
      steps: list.length,
      moments: list,
      played: done.map(({ id, status: st, reason, standings, results }) => ({ id, status: st, reason, standings, results })),
      releaseAt: step > 0 ? releaseAt : null,
      last,
      issues: ended ? pastIssues.slice() : [...pastIssues, ...s.issues],
    });
  }

  function start(index, from = null) {
    step = index;
    currentStatus = null;
    clearRelease();
    releaseAt = index > 0 ? (from && Number.isFinite(from.releaseAt) ? from.releaseAt : clock.now() + t.momentCueMs) : null;
    const m = list[index];
    const handle = createRound({
      round,
      players: order,
      hostKey,
      mode: 'moments',
      moment: m.id,
      seed: momentSeed(seed, index),
      limitMs: m.seconds * 1000,
      clock,
      timings: stepTimings,
      gate: true,
      resume: from,
      deliver: (key, msg) => deliver(key, { ...msg, step: index }),
      onStatus: (s) => {
        if (index !== step || ended) return;
        currentStatus = s;
        status();
      },
      onEnd: (r) => {
        if (index === step && !ended) momentEnded(r);
      },
    });
    // The handle may already be done with (a round carried on that ends at once): only the moment playing now is current.
    if (index !== step || ended) return;
    current = handle;
    if (!from) for (const [key, reason] of gone) if (index === step && !ended) handle.leave(key, reason);
    if (index !== step || ended) return;
    if (index > 0 || !gate) {
      releaseTimer = clock.setTimeout(() => {
        releaseTimer = null;
        if (current === handle && !ended) handle.release();
      }, Math.max(0, (releaseAt ?? clock.now()) - clock.now()));
    }
    status();
  }

  function momentEnded(r) {
    const m = list[step];
    for (const p of r.players ?? []) if (p.out && p.out !== 'not-ready' && !gone.has(p.key)) gone.set(p.key, p.out);
    done.push({ ...m, status: r.status, reason: r.reason, standings: r.standings ?? null, results: r.results ?? {}, awards: r.awards ?? [] });
    pastIssues.push(...(r.issues ?? []).map((i) => ({ ...i, step })));
    if (aborted) return finish();
    const here = order.some((p) => !gone.has(p.key));
    if (last || !here || step + 1 >= list.length) return finish();
    start(step + 1);
  }

  function finish() {
    if (ended) return;
    ended = true;
    clearRelease();
    const played = done.filter((d) => d.status === 'played' && d.standings);
    const goneIds = order.flatMap((p, id) => (gone.has(p.key) ? [id] : []));
    let outcome;
    if (aborted || !played.length) {
      outcome = { status: 'void', reason: aborted ?? done.at(-1)?.reason ?? 'no-result', endReason: aborted === 'session-ended' ? 'session-ended' : 'void', standings: null };
    } else {
      const { standings, tally } = rankMoments(played, ids, goneIds);
      // Each moment's awards, three a player at most across the round.
      const awards = [];
      const given = new Map();
      for (const a of played.flatMap((d) => d.awards ?? [])) {
        if ((given.get(a.id) || 0) >= HIGHLIGHTS.awards) continue;
        given.set(a.id, (given.get(a.id) || 0) + 1);
        awards.push(a);
      }
      outcome = {
        status: 'played',
        reason: 'finished',
        endReason: 'finished',
        standings,
        results: tally,
        scores: Object.fromEntries(ids.map((id) => [id, tally[id].cleared])),
        awards,
      };
    }
    record = {
      round,
      mode: 'moments',
      play: null,
      hostId,
      ...outcome,
      moments: done.map(({ id, verb, seconds, goal, status: st, results }) => ({ id, verb, seconds, goal, status: st, results })),
      players: order.map((p, id) => ({ id, key: p.key, slot: p.slot, name: p.name, color: SLOT_COLORS[p.slot % SLOT_COLORS.length], out: gone.get(p.key) ?? null })),
      issues: pastIssues.slice(),
    };
    status();
    onEnd(record);
  }

  /** The moment that was loading when the round ended between moments: its problems join the round's. */
  function dropLoading() {
    pastIssues.push(...(currentStatus?.issues ?? []).map((i) => ({ ...i, step })));
    current?.stop();
  }

  /** Carry on from the last status of the round (resume): the moments played, the one playing now, who left. */
  function resumeMoments(r) {
    for (const p of Array.isArray(r.players) ? r.players : []) if (typeof p?.out === 'string' && p.out !== 'not-ready') gone.set(p.key, p.out);
    for (const k of Array.isArray(r.gone) ? r.gone : []) gone.set(k, 'left');
    for (const d of Array.isArray(r.played) ? r.played : []) {
      const m = list.find((x) => x.id === d?.id);
      if (!m || done.length >= list.length) continue;
      const standings = cleanGroups(d.standings, ids);
      done.push({ ...m, status: d.status === 'played' && standings ? 'played' : 'void', reason: String(d.reason ?? ''), standings, results: cleanMomentResults(d.results, ids), awards: [] });
    }
    last = r.last === true;
    const at = Number.isInteger(r.step) && r.step >= done.length && r.step < list.length ? r.step : done.length;
    if (at >= list.length) return finish();
    start(at, { ...r, gone: Array.isArray(r.gone) ? r.gone : [] });
  }

  if (!list.length) {
    aborted = 'no-moments';
    finish();
  } else if (resume) resumeMoments(resume);
  else start(0);

  return {
    receive(key, msg) {
      if (ended || !current) return;
      // A message from the game of another moment (a slow result, a page still on the last one) is dropped.
      if (msg && msg.step !== undefined && msg.step !== step) return;
      current.receive(key, msg);
    },
    leave(key, reason = 'left') {
      if (ended) return;
      if (reason !== 'not-ready') gone.set(key, reason);
      current?.leave(key, reason);
    },
    /** The card is over: the first moment starts as soon as every game has loaded. Each one after releases itself. */
    release() {
      if (!ended && step === 0) current?.release();
    },
    /** Call time on the moment playing now, and go on to the next one: the harness's Time up. */
    timeUpMoment() {
      if (!ended && current && (current.phase === 'countdown' || current.phase === 'playing')) current.timeUp();
    },
    /** Call time on the moment playing now, and make it the last; between moments, end the round now. */
    timeUp() {
      if (ended || !current) return;
      const p = current.phase;
      if (p === 'countdown' || p === 'playing') {
        last = true;
        status();
        current.timeUp();
      } else if (p === 'loading' && step > 0) {
        dropLoading();
        finish();
      }
    },
    rejoin(key) {
      return !ended && current ? current.rejoin(key) : false;
    },
    progress(id, score) {
      if (!ended) current?.progress(id, score);
    },
    abort(reason = 'skipped') {
      if (ended) return;
      aborted = reason;
      // The moment playing now ends void, and with it the round (momentEnded).
      if (current && current.phase !== 'ended') current.abort(reason);
      if (!ended) finish();
    },
    stop() {
      if (ended) return;
      ended = true;
      clearRelease();
      current?.stop();
    },
    get phase() {
      return ended ? 'ended' : (current?.phase ?? 'loading');
    },
    get released() {
      return step > 0 || Boolean(current?.released);
    },
    get record() {
      return record;
    },
    get mode() {
      return 'moments';
    },
    get play() {
      return null;
    },
    /** The moment playing now: its place in the round, from 0. */
    get step() {
      return step;
    },
    seats: () => current?.seats() ?? [],
    mayAgain: () => false,
  };
}
