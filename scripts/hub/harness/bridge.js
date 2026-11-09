/**
 * bridge.js — the hub's end of one game frame in a session.
 *
 * A game speaks the AI Hub Session Protocol over postMessage (lib/hub/README.md).
 * The bridge checks every message, enforces the limits, and routes it: control
 * messages (hello, ready, result, finish, error) to whoever coordinates the
 * round (lib/hub/round.js), game traffic straight to the other players, and a
 * game's answers on its own card to the page that holds it. What
 * comes back from the network is checked again before it reaches the game,
 * and anything from another round is dropped, so a slow packet can never land
 * in the next game.
 *
 * The network is anything with `send(toKey, envelope, {reliable})`: the
 * simulated one below (harness, tests), a BroadcastChannel between tabs, or a
 * WebRTC mesh. Envelopes:
 *   {k:'c', r, m}       to the coordinator: a message from this game
 *   {k:'h', r, m}       from the coordinator: welcome, start, leave, time-up, end
 *   {k:'g', r, f, d}    game traffic from player id f
 *   {k:'p', r, f, d}    player id f's progress, {score, label}, for the scoreboard
 */

export const LIMITS = Object.freeze({
  maxBytes: 16_384,
  ratePerS: 20,
  burst: 40,
  queueMessages: 64,
  queueBytes: 262_144,
  /**
   * progress() reaches the hub about once a second. Two closer than this are a
   * report delivered late (a long task in the game) or a client misbehaving:
   * the later is dropped, and the next report, a second on, has the newest score.
   */
  progressMs: 250,
  label: 24,
});

const FROM_GAME = new Set(['hello', 'ready', 'send', 'result', 'finish', 'error', 'progress', 'fullscreen', 'answer']);

/** A progress report, checked: a finite score and an optional short label. Null when it is not one. */
export function cleanProgress(p) {
  if (!p || typeof p !== 'object') return null;
  // A number, or text that is one: never null, '', true or [], which Number() would make 0 or 1.
  const score = typeof p.score === 'number' || (typeof p.score === 'string' && p.score.trim() !== '') ? Number(p.score) : NaN;
  if (!Number.isFinite(score)) return null;
  const label = typeof p.label === 'string' ? p.label.trim().slice(0, LIMITS.label) : '';
  return label ? { score, label } : { score };
}

/**
 * @param {object} o
 * @param {string} o.key              this player's key in the session
 * @param {number} o.round
 * @param {string} o.coordinator      key of whoever runs round.js
 * @param {(msg:object) => void} o.post            to the game frame
 * @param {{send:Function}} o.net
 * @param {{now:()=>number}} [o.clock]             the coordinator's time, as seen here
 * @param {(issue:{key:string, problem:string}) => void} [o.onIssue]
 * @param {(id:number, progress:{score:number, label?:string}) => void} [o.onProgress]   a player's
 *        progress, this one's included, for the hub's scoreboard; it never reaches the games
 * @param {(on:boolean) => void} [o.onFullscreen]   the game asked for fullscreen (or out of it): the
 *        hub's page takes it, so the hub's own cards stay over the game
 * @param {(what:'ready'|'more') => void} [o.onAnswer]   this player answered on the game's own card
 */
export function createBridge({ key, round, coordinator, post, net, clock = Date, onIssue = () => {}, onProgress = () => {}, onFullscreen = () => {}, onAnswer = () => {} }) {
  let welcomed = false;
  let ended = false;
  let started = false;
  let helloSent = false;
  let ownsCard = false;
  let readySent = false;
  let me = null;
  let keys = [];
  const gone = new Set();
  const queue = [];
  let queuedBytes = 0;
  let tokens = LIMITS.burst;
  let refilled = clock.now();
  let progressAt = -Infinity;
  const issues = [];
  const stats = { sent: 0, received: 0, bytesSent: 0, dropped: 0 };

  const toGame = (msg) => post({ aihub: 1, ...msg });
  const toHub = (m) => net.send(coordinator, { k: 'c', r: round, m }, { reliable: true });
  const issue = (problem) => {
    const entry = { key, problem };
    issues.push(entry);
    onIssue(entry);
  };

  function fromGame(msg) {
    if (!msg || msg.aihub !== 1) return;
    if (!FROM_GAME.has(msg.type)) return issue(`unknown message type ${JSON.stringify(msg.type)}`);
    if (msg.type === 'fullscreen') return onFullscreen(msg.on === true);
    if (ended && msg.type !== 'error') return;
    switch (msg.type) {
      case 'hello':
        if (helloSent) return;
        helloSent = true;
        ownsCard = msg.card === true;
        return toHub({ type: 'hello', v: msg.v, client: String(msg.client || ''), mode: msg.mode ?? null, seats: msg.seats ?? null, card: ownsCard });
      case 'ready':
        if (!welcomed) return issue('ready before welcome');
        readySent = true;
        return toHub({ type: 'ready' });
      case 'answer':
        if (!ownsCard) return issue('answer without its own card: connect({ card: true })');
        if (!welcomed || started) return;
        if (msg.answer !== 'ready' && msg.answer !== 'more') return issue(`answer ${JSON.stringify(msg.answer)} is not ready or more`);
        return onAnswer(msg.answer);
      case 'result':
        if (!welcomed) return issue('result before welcome');
        return toHub({ type: 'result', time: msg.time, score: msg.score, stats: msg.stats, awards: msg.awards });
      case 'finish':
        if (!welcomed) return issue('finish before welcome');
        return toHub({ type: 'finish', standings: msg.standings, scores: msg.scores, won: msg.won, stats: msg.stats, awards: msg.awards });
      case 'error':
        return toHub({ type: 'error', message: String(msg.message || '').slice(0, 500), fatal: msg.fatal === true });
      case 'send':
        return sendGame(msg);
      case 'progress':
        return sendProgress(msg);
    }
  }

  /** Progress goes to this hub's scoreboard and to every other player's, never to a game. */
  function sendProgress(msg) {
    if (!welcomed) return issue('progress before welcome');
    const p = cleanProgress(msg);
    if (!p) return issue('progress needs a finite score');
    const now = clock.now();
    if (now - progressAt < LIMITS.progressMs) {
      stats.dropped++;
      return;
    }
    progressAt = now;
    onProgress(me, p);
    const envelope = { k: 'p', r: round, f: me, d: p };
    for (const target of keys.filter((k, id) => id !== me && !gone.has(id))) net.send(target, envelope, { reliable: false });
  }

  function sendGame(msg) {
    if (!welcomed) return issue('send before welcome');
    let text;
    try {
      text = JSON.stringify(msg.data);
    } catch {
      return issue('send: data is not JSON');
    }
    if (text === undefined) return issue('send: no data');
    if (text.length > LIMITS.maxBytes) {
      stats.dropped++;
      return issue(`send: ${text.length} bytes is over the ${LIMITS.maxBytes}-byte limit`);
    }
    const now = clock.now();
    tokens = Math.min(LIMITS.burst, tokens + ((now - refilled) / 1000) * LIMITS.ratePerS);
    refilled = now;
    if (tokens < 1) {
      stats.dropped++;
      return issue(`send: over ${LIMITS.ratePerS} messages a second`);
    }
    tokens -= 1;
    let targets;
    if (msg.to === undefined || msg.to === null) {
      targets = keys.filter((k, id) => id !== me && !gone.has(id));
    } else {
      if (!Number.isInteger(msg.to) || msg.to < 0 || msg.to >= keys.length || msg.to === me) {
        return issue(`send: no player ${JSON.stringify(msg.to)} to send to`);
      }
      if (gone.has(msg.to)) return;
      targets = [keys[msg.to]];
    }
    const reliable = msg.reliable !== false;
    const envelope = { k: 'g', r: round, f: me, d: JSON.parse(text) };
    for (const target of targets) net.send(target, envelope, { reliable });
    stats.sent++;
    stats.bytesSent += text.length;
  }

  function deliverGame(fromKey, env) {
    if (ended || gone.has(env.f)) return;
    if (keys[env.f] !== fromKey) return issue(`traffic from ${fromKey} claims to be player ${env.f}`);
    stats.received++;
    toGame({ type: 'message', from: env.f, data: env.d });
  }

  function fromNet(fromKey, env) {
    if (!env || env.r !== round) return;
    if (env.k === 'p') {
      const p = cleanProgress(env.d);
      if (welcomed && !ended && p && keys[env.f] === fromKey && !gone.has(env.f)) onProgress(env.f, p);
      return;
    }
    if (env.k === 'g') {
      if (welcomed) return deliverGame(fromKey, env);
      const size = JSON.stringify(env.d ?? null).length;
      if (queue.length >= LIMITS.queueMessages || queuedBytes + size > LIMITS.queueBytes) {
        stats.dropped++;
        return;
      }
      queue.push([fromKey, env]);
      queuedBytes += size;
      return;
    }
    if (env.k !== 'h' || fromKey !== coordinator || !env.m) return;
    const m = env.m;
    switch (m.type) {
      case 'welcome': {
        if (welcomed) return;
        welcomed = true;
        me = m.me;
        keys = Array.isArray(m.keys) ? m.keys : [];
        const { keys: _keys, round: _round, ...rest } = m;
        // The limits ride in the welcome, so a client of 1.3.0 or later follows whatever this hub enforces.
        toGame({ ...rest, round, limits: { maxBytes: LIMITS.maxBytes, ratePerS: LIMITS.ratePerS, burst: LIMITS.burst } });
        for (const [k, e] of queue.splice(0)) deliverGame(k, e);
        queuedBytes = 0;
        return;
      }
      case 'start':
        started = true;
        return toGame({ type: 'start', in: Math.round(m.at - clock.now()) });
      case 'leave':
        gone.add(m.id);
        return toGame({ type: 'leave', id: m.id, reason: m.reason });
      case 'time-up':
        return toGame({ type: 'time-up', graceMs: m.graceMs });
      case 'end':
        ended = true;
        return toGame({ type: 'end', reason: m.reason, ...(m.standings ? { standings: m.standings } : {}) });
    }
  }

  return {
    key,
    round,
    fromGame,
    fromNet,
    /** The game's own card, while it is on: { left, paused, starting, ready, asking, asked } (lib/hub/README.md, "The card"). */
    card(state) {
      if (ownsCard && welcomed && !started && !ended) toGame({ type: 'card', ...state });
    },
    /** The page holding this frame was hidden or shown: the coordinator watches the host's. */
    visibility(hidden) {
      if (helloSent && !ended) toHub({ type: 'vis', hidden: !!hidden });
    },
    issues,
    stats,
    get me() {
      return me;
    },
    get ended() {
      return ended;
    },
    /** The game shows its own card, and has loaded: the hub's card steps aside for it. */
    get showsCard() {
      return ownsCard && readySent && !ended;
    },
  };
}

/**
 * Wire a bridge to an iframe: only messages from that frame's window count.
 * Returns a function that unhooks it.
 */
export function attachFrame(frame, onMessage) {
  const listener = (event) => {
    if (event.source !== frame.contentWindow) return;
    if (!event.data || event.data.aihub !== 1) return;
    onMessage(event.data);
  };
  addEventListener('message', listener);
  return () => removeEventListener('message', listener);
}

/** Post to a frame. The games may be served from anywhere, and nothing here is secret. */
export const postTo = (frame) => (msg) => frame.contentWindow?.postMessage(msg, '*');

/**
 * A simulated network for the harness and tests: one-way latency with jitter,
 * and loss for unreliable messages. Reliable messages stay in order per pair,
 * as a WebRTC ordered channel would keep them.
 */
export function createLocalNetwork({ latency = 0, jitter = 0, loss = 0, random = Math.random, clock = globalThis } = {}) {
  const endpoints = new Map();
  const pairs = new Map(); // "from\0to" -> reliable messages waiting, in send order
  const now = () => (clock.performance?.now ? clock.performance.now() : Date.now());
  const settings = { latency, jitter, loss };

  const deliver = (from, to, target, copy) => {
    if (endpoints.get(to) === target) for (const fn of target.listeners) fn(from, copy);
  };

  /** Reliable traffic leaves each pair's queue strictly in order, never before its time. */
  function drain(pair) {
    const q = pairs.get(pair);
    q.timer = null;
    while (q.items.length && q.items[0].at <= now() + 0.5) {
      const { from, to, target, copy } = q.items.shift();
      deliver(from, to, target, copy);
    }
    if (q.items.length) q.timer = clock.setTimeout(() => drain(pair), Math.max(1, Math.ceil(q.items[0].at - now())));
  }

  function endpoint(key) {
    const listeners = new Set();
    const self = {
      key,
      send(to, env, { reliable = true } = {}) {
        const target = endpoints.get(to);
        if (!target || !endpoints.has(key)) return;
        if (!reliable && random() < settings.loss) return;
        const copy = JSON.parse(JSON.stringify(env));
        const delay = to === key ? 0 : Math.max(0, settings.latency + (random() * 2 - 1) * settings.jitter);
        if (!reliable) {
          clock.setTimeout(() => deliver(key, to, target, copy), delay);
          return;
        }
        const pair = `${key}\u0000${to}`;
        if (!pairs.has(pair)) pairs.set(pair, { items: [], timer: null });
        const q = pairs.get(pair);
        const last = q.items.at(-1)?.at ?? 0;
        q.items.push({ at: Math.max(now() + delay, last), from: key, to, target, copy });
        if (!q.timer) q.timer = clock.setTimeout(() => drain(pair), Math.ceil(delay));
      },
      onMessage(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      close() {
        endpoints.delete(key);
      },
      listeners,
    };
    endpoints.set(key, self);
    return self;
  }

  return { endpoint, settings };
}
