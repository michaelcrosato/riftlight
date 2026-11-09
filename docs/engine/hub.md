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
const engine = await Engine.start(game, { seed: session?.info.seed });
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
  if (e.type === 'start') countdown = e.in / 1000;          // play begins after this many seconds of game time
  else if (e.type === 'message') onMessage(e.data, e.from); // another copy's data
  else if (e.type === 'leave') dropPlayer(e.id);            // final for the round
  else if (e.type === 'time-up') reportNow();               // within e.graceMs
  else if (e.type === 'end') { /* the last word: the engine stands still (speed 0) and is silent */ }
}
```

`session.time()` (the hub's timeline: negative in the countdown, `-Infinity` before the start) and
`session.playing` are real time: report with them (`result({ time })`), never gate gameplay on
them, or a replay plays differently. Count the countdown in game time from `start`'s `in`.

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

Calls the protocol doesn't allow are ignored and return false: a second report, `finish` outside
a shared world or from a copy that isn't the host, `result` in a shared world, `progress` in a
shared world, and an outcome the hub couldn't take (a result without a finite `time` or `score`, a
finish without `standings`): that one does not count as reported, so the game can send a good one.

## Sending

`session.send(data, to?)` queues JSON for every other copy (or the one player `to`); the session
flushes at `sendHz` (default 10 a second, on a real-time timer in a page; tests call `flush()` and
give the hub's clock as `clock`). Items are bundled per destination and every bundle goes through
a token bucket at 90% of the hub's limits (20 messages a second, bursts of 40, 16 KB each, or what
its welcome says: `session.limits`), so the client never drops one: what the rate holds back waits
(`session.backlog`) and takes more items while it waits. Each item arrives as its own `message`
event; one destination's items arrive in order (bundles travel reliably), broadcast and direct ones
may interleave. Data that isn't JSON is refused (`send` returns false). Parallel copies send
nothing; nothing leaves after `end`. Send ids and numbers, not sentences: each player sees their
own language.

## The end

`end` is the last message of a round: the session delivers it, sets the engine's game speed to 0
(frames still run, so the game reads the `end` command; nothing moves and presses are dropped),
mutes it (without saving the mute: `audio.persist` off) and stops sending; `onEnd(fn)` runs after.
A game must not set its speed again after the end. A shared world whose host leaves ends
`host-left`, void.

## Drawing other copies: `RemoteTrack`

What arrives from another copy comes a few times a second, late and unevenly. A `RemoteTrack` keeps
the last snapshots stamped with the sender's game time and samples them `delay` seconds (default
0.12) behind the newest, extrapolating a little past it, so ghosts and a shared world's monsters
move evenly. The two clocks are matched by the fastest of the last 16 arrivals, so the track
recovers within a couple of seconds when the sender's clock stood still (a pause, a hidden tab):

```ts
track.push(msg.t, ctx.time, msg.pos);                        // as a message arrives (sender's time, ours)
const pos = track.sample(ctx.time, (a, b, k) => lerpXZ(a, b, k)); // every frame
const facing = lerpAngle(a.facing, b.facing, k);             // angles the short way round
```

## Replaying a session: `HubSession.offline`

A recording of a round holds the hub's events (they are input), so it replays without the hub:
`HubSession.offline(info)` is a session over the round's recorded `info` that sends and reports
nothing and whose clock never starts. A game makes one when it replays a round's start (Riftlight:
its `{ rl: 'round' }` command).

## Testing without a hub: `LocalHub`

`LocalHub` is the hub and its network in memory, on a manual clock: each copy gets a client with the
shape of `window.AIHub`, held to the real client's rules (16 KB, 20 messages a second with bursts of
40 on the hub's clock, a result needs a finite time or score, a finish its standings and a shared
world's host; what it refuses is in `stats.refused` and `hub.problems`).

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
the hub's bar, so once both are held the engine presses neither until both are let go (letting one
go first presses nothing) (`input.ts`).
