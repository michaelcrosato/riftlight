# AI Hub sessions: playing a round together

`src/engine/hub/`. The [AI Hub](https://raw.githubusercontent.com/michaelcrosato/ai-hub/main/lib/hub/README.md)
(AI Hub Session Protocol v1) runs rounds of games for up to four players, each on their own device:
the lobby, seats and names, the network, the clock and the scoreboard are the hub's. A game takes
part through the hub's client, `window.AIHub` (`session.js`), which a page built for the hub carries
unmodified as its first script, right after `<meta charset>`.

## Modes

| Mode | Each copy runs | The copies send each other |
| --- | --- | --- |
| `parallel` | its own copy of the round, from the same start | nothing |
| `ghost` | its own copy, showing the others' characters where they are | each copy's own player |
| `shared-world` | one world, run by the host's copy | what each player does, to the host; the world, from the host |

A page declares one mode in its head (`<meta name="hub:session-mode">`); `headMeta(name)` reads a
tag. In parallel and ghost the client seeds `Math.random` (the engine never uses it) and every copy
gets `info.seed`: give it to the engine as its seed and every copy builds the same round.

## Joining

```ts
const session = await HubSession.join({ mode: 'ghost', seats: [1, 4] }); // null: no hub, play as usual
await Engine.start(game, { seed: session?.info.seed });
session?.attach(engine);   // the hub's events arrive as input commands from now on (and the earlier ones)
session?.ready();          // once everything is loaded, with no key press: the hub's card asks the players
```

- `info`: `me`, `players` (`{ id, name, color }`, ids in seat order; `session.players` drops those
  who leave), `host`, `isHost`, `server` (a copy that hosts a shared world with no player of its
  own: `session.self` is null), `mode`, `round`, `limitMs`, `seed`.
- Names come from the hub: draw them as text, never as HTML. Colours follow the seat (`HUB_COLORS`).
- In a session the game opens straight into the round: no title, menus or prompts.

## The hub's events are input

Everything the hub says reaches the game as an input command, `{ hub: HubEvent }`
(`ctx.input.send`, docs/engine/determinism.md), so a session is recorded and replays like any other
input. Read them in `update`:

```ts
for (const e of hubEvents(ctx.input.commands)) {
  if (e.type === 'start') countdown = e.in / 1000;          // play begins when session.time() reaches 0
  else if (e.type === 'message') onMessage(e.data, e.from); // another copy's data
  else if (e.type === 'leave') dropPlayer(e.id);            // final for the round
  else if (e.type === 'time-up') reportNow();               // within e.graceMs
  else if (e.type === 'end') { /* the last word: the engine is already paused and silent */ }
}
```

`card` (only with `card: true`, a game that shows its own card) carries the countdown, who is
ready and who asked for more time; answer with `session.answer('ready' | 'more')`.

## Reporting

- Parallel and ghost: `session.progress(score, label?)` as often as you like (the hub takes about
  one a second; label at most 24 characters, in the player's language), then once
  `session.result({ time })` (ms of `session.time()`, lower wins) or `result({ score })` (higher
  wins), with optional `stats` and `awards`.
- Shared world: the host only, once, `session.finish({ standings, scores?, won? })`: standings are
  arrays of player ids, best first, ids in one array tied; `won` makes it a team result.
- On `time-up` report within `graceMs`. A shared world with no `finish()` by then is void.
- `session.fail(message)`: the game cannot run in this browser.

Calls that the protocol doesn't allow are ignored (a second `result`, `finish` from a copy that
isn't the host, `result` in a shared world), so a game can call them without bookkeeping.

## Sending

`session.send(data, to?)` queues JSON for every other copy (or the one player `to`); the session
flushes bundles at `sendHz` (default 10 a second, on a real-time timer in a page; tests call
`flush()`). However often a game sends, at most `sendHz` messages leave each copy: the hub allows
20 a second (bursts of 40) and 16 KB each, and a bundle over 15 KB goes out in pieces. Each item
arrives as its own `message` event, in order (bundles travel reliably). Parallel copies send
nothing; nothing leaves after `end`. Send ids and numbers, not sentences: each player sees their
own language.

## The end

`end` is the last message of a round: the session delivers it, then pauses the engine and mutes it
(without saving the mute: `audio.persist` off) and stops sending; `onEnd(fn)` runs after. A shared
world whose host leaves ends `host-left`, void.

## Drawing other copies: `RemoteTrack`

What arrives from another copy comes a few times a second, late and unevenly. A `RemoteTrack` keeps
the last snapshots stamped with the sender's game time and samples them `delay` seconds (default
0.12) behind the newest, extrapolating a little past it, so ghosts and a shared world's monsters
move evenly:

```ts
track.push(msg.t, ctx.time, msg.pos);                        // as a message arrives (sender's time, ours)
const pos = track.sample(ctx.time, (a, b, k) => lerpXZ(a, b, k)); // every frame
const facing = lerpAngle(a.facing, b.facing, k);             // angles the short way round
```

## Testing without a hub: `LocalHub`

`LocalHub` is the hub and its network in memory, on a manual clock: each copy gets a client with the
shape of `window.AIHub`.

```ts
const hub = new LocalHub({ mode: 'shared-world', players: 2, latencyMs: 100 }); // server: true adds a host with no player
const a = await HubSession.join({ mode: 'shared-world', seats: [1, 4], client: hub.client(0), autoFlush: false });
hub.start(); hub.advance(3000);         // the countdown; advance(ms) delivers what is due
hub.leave(1); hub.timeUp(); hub.end();  // the hub's cases
hub.results; hub.finished; hub.standings();
```

`src/engine/hub/session.test.ts` walks a round through every case. The hub's own harness
(`harness.html`, which loads the game 1–4 times on a simulated network) is the final check, run against the
built page.

## The controller's hub chord

Holding View and Menu together (Create and Options, gamepad buttons 8 and 9: `HOST_CHORD`) opens
the hub's bar, so while both are held the engine presses neither (`input.ts`).
