# AI Hub sessions: playing a round together

`src/engine/hub/`. 52in1 (the hub: [AI Hub Session Protocol v1](https://52in1.com/lib/hub/README.md))
runs rounds of games for up to four players, each on their own device: the lobby, seats and names,
the network, the clock and the scoreboard are the hub's. Players know it as **52in1**: whatever a
player sees says 52in1, never AI Hub (that is the protocol's and the client's name). A game takes
part through the hub's client, `window.AIHub` (`session.js`), which a page built for the hub
carries unmodified as its first script, right after `<meta charset>`.

## Modes

| Mode | Each copy runs | The copies send each other |
| --- | --- | --- |
| `parallel` | its own copy of the round, from the same start | nothing |
| `ghost` | its own copy, showing the others' characters where they are | each copy's own player |
| `shared-world` | one world, run by the host's copy | what each player does, to the host; the world, from the host |
| `moments` | its own copy of one short moment of the game, a fresh load each (*Moments*) | nothing |

In parallel, ghost and moments the client seeds `Math.random` (the engine never uses it) and every
copy gets `info.seed`: give it to the engine as its seed and every copy builds the same round.

### Several modes on one page

A page names every way it plays together in `<meta name="hub:multiplayer">`
(`WHERE HOW MIN-MAX, ...`: `shared-world co-op 1-4, ghost 1-4, moments 1-4`); `hub:session-mode` is
the one it plays when nothing says which, `hub:session-players` the players of them all. The game
joins with all of its online modes and the hub picks one each round (`info.mode`; in a shared world
also `info.play`: `co-op`, `versus` or `other`). The game starts that one straight away.

- `headSession()` reads the page's tags: `{ modes, seats }` to join with (the session mode first),
  or null for a page without `hub:session` 1. `onlineModes(multiplayer, sessionMode)` and
  `parseMultiplayer(text)` (every entry that reads, as `HubWay`s: `where`, `play`, `seats`,
  `online`) are its parts; `headMeta(name)` reads one tag.
- The modes a game plays on one device (`same-screen`, `split-screen`, `hot-seat`) are its own menu's,
  never a session's.

## Joining

```ts
const offer = headSession();                                  // { modes: ['shared-world', 'ghost'], seats: [1, 4] }
const session = offer && (await HubSession.join({ mode: offer.modes, seats: offer.seats })); // null: no hub, play as usual
const engine = await Engine.start(game, { seed: session?.info.seed });
session?.attach(engine);   // the hub's events arrive as input commands from now on (and the earlier ones)
session?.ready();          // once everything is loaded, with no key press: the hub's card asks the players
```

- `mode` is one mode or a list (one alone goes to the hub as itself; the older names `race`,
  `co-op` and `versus` go as `ghost` and `shared-world`, as the hub reads them). The session plays
  the mode the welcome names when the game offered it, else the game's first.
- `info`: `me`, `players` (`{ id, name, color }`, ids in seat order; `session.players` drops those
  who leave), `host`, `isHost`, `server` (a copy that hosts a shared world with no player of its
  own: `session.self` is null), `mode`, `play` (a shared world's, else null), `moment` (in moments,
  the moment's id, else null), `round`, `limitMs`, `seed`. A recording from before `play` and
  `moment` replays with both null.
- `session.rng(label)` is an `Rng` with the numbers the client's `AIHub.rng(label)` gives (no label is ''), from
  `info.seed`: the same on every copy, and in a replay (the seed is recorded with the round's info).
  Draw a set-up from it (a moment's start); each call starts the label's stream afresh.
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
ready and who asked for more time; answer with `session.answer('ready' | 'more')` (the hub takes
answers from the first `card` until `start`).

## Moments

A round of moments plays three short moments of the game, one after another; the hub loads the game
afresh for each, with its own seed, and the welcome names it (`info.moment`; `info.limitMs` is its
length). The page names each moment in a `hub:moment` tag (`ID VERB SECONDS GOAL`, at least three).
The game opens straight in that moment's set-up, drawn from `session.rng(info.moment)` (or anything
else that is the same on every copy), readies up, and waits, set up and still, until play begins.
When the player clears or fails it, the game reports once, `session.result({ won, time })` with
`time` the hub's `time()` then; a moment still going at `time-up` is reported then: cleared when its
goal is to last, failed otherwise. Nothing is sent and no progress shown (`send` and `progress`
refuse in moments).

## Reporting

- Parallel and ghost: `session.progress(score, label?)` as often as you like (the hub takes about
  one a second; label at most 24 characters, in the player's language), then once
  `session.result({ time })` (ms of `session.time()`, lower wins) or `result({ score })` (higher
  wins), with optional `stats` and `awards`.
- Moments: once, `session.result({ won, time })` (`won` true or false, a finite `time`).
- Shared world: the host only, once, `session.finish({ standings, scores?, won? })`: standings are
  arrays of player ids, best first, ids in one array tied; `won` makes it a team result (co-op);
  without it (versus) the standings say who won.
- On `time-up` report within `graceMs`. A shared world with no `finish()` by then is void.
- `session.fail(message)`: the game cannot run in this browser.

Calls the protocol doesn't allow are ignored and return false: a second report, `finish` outside
a shared world or from a copy that isn't the host, `result` in a shared world, `progress` in a
shared world or moments, and an outcome the hub couldn't take (`validResult(outcome, mode)`: a
result without a finite `time` or `score`, a moment's without `won` and a finite `time`;
`validFinish`: a finish without `standings`): that one does not count as reported, so the game can
send a good one.

## Sending

`session.send(data, to?)` queues JSON for every other copy (or the one player `to`); the session
flushes at `sendHz` (default 10 a second, on a real-time timer in a page; tests call `flush()` and
give the hub's clock as `clock`). Items are bundled per destination and every bundle goes through
a token bucket at 90% of the hub's limits (20 messages a second, bursts of 40, 16 KB each, or what
its welcome says: `session.limits`), so the client never drops one: what the rate holds back waits
(`session.backlog`) and takes more items while it waits. Each item arrives as its own `message`
event; one destination's items arrive in order (bundles travel reliably), broadcast and direct ones
may interleave. Data that isn't JSON is refused (`send` returns false). Parallel and moments copies
send nothing; nothing leaves after `end`. Send ids and numbers, not sentences: each player sees
their own language.

## The end

`end` is the last message of a round: the session delivers it, sets the engine's game speed to 0
(frames still run, so the game reads the `end` command; nothing moves and presses are dropped),
mutes it (without saving the mute: `audio.persist` off), closes the DualSense
(`engine.dualsense.close()`: the light bar given back to the hub, the triggers let go, the game's
later `ctx.dualsense` calls ignored) and stops sending; `onEnd(fn)` runs after.
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
`HubSession.offline(info)` is a session over the round's recorded `info` (its mode, play and moment
too) that sends and reports nothing and whose clock never starts. A game makes one when it replays a
round's start (Riftlight: its `{ rl: 'round' }` command).

## Testing without a hub: `LocalHub`

`LocalHub` is the hub and its network in memory, on a manual clock: each copy gets a client with the
shape of `window.AIHub`, held to the real client's and hub's rules (16 KB, 20 messages a second with
bursts of 40 on the hub's clock; a result needs a finite time or score, after the start, and in
moments `won`; a finish its standings and a shared world's host; a hello must offer the round's
mode, read as the hub reads it: the older names too, empty entries dropped; no traffic in parallel or moments, no progress in a shared world or moments; what it refuses
is in `stats.refused` and `hub.problems`). It runs the round as the hub's coordinator does
(`round.js`): time is called at `limitMs` after play begins (`timeUp()` calls it now, once the
round has started), the round ends `finished` once every
player still in has reported (a shared world: at the host's finish), and after time-up's grace (5 s,
a moment's 2 s) it ends either way (a shared world with no finish: `void`); a round no player is
left in is `void` in any mode. `advance(ms)` does what falls due in time order, each at its own time,
so one long step can deliver messages, call time and end the round (a reply sent with no delay as
a message lands waits for the next step, so a step always ends). `standings()` ranks as the hub
does: in moments the cleared quickest first, then the failed (the last to fail first); otherwise by
time, then score (a player's last progress when they gave no result); then those still in with
nothing, tied; then those who left with nothing, tied last. Equal values share a place.

```ts
const hub = new LocalHub({ mode: 'shared-world', play: 'co-op', players: 2, latencyMs: 100 }); // server: true adds a host with no player
const a = await HubSession.join({ mode: ['shared-world', 'ghost'], seats: [1, 4], client: hub.client(0), autoFlush: false });
hub.card(10_000); hub.answers;          // a game's own card (card: true), and the answers it took
hub.start(); hub.advance(3000);         // the countdown; advance(ms) delivers what is due
hub.leave(1); hub.timeUp(); hub.end();  // the hub's cases
hub.results; hub.finished; hub.standings();
new LocalHub({ mode: 'moments', moment: { id: 'forge-brute', seconds: 20 }, players: 2 }); // one moment, one load
```

`src/engine/hub/session.test.ts` walks a round through every case. The hub's own harness
(`harness.html`, which loads the game 1–4 times on a simulated network; `&mode=`, `&how=` and
`&moment=` pick the mode and moments) is the final check, run against the built page.

## The controller's hub chord

Holding View and Menu together (Create and Options, gamepad buttons 8 and 9: `HOST_CHORD`) opens
the hub's bar, so once both are held the engine presses neither until both are let go (letting one
go first presses nothing) (`input.ts`).

## The player's settings and the DualSense

In 52in1 the page has the player's settings from its first script on, `window.AIHubSettings`
(the hub's companion script; [Catalogue v1](https://raw.githubusercontent.com/michaelcrosato/ai-hub/main/lib/hub/catalogue.md),
*Settings and the DualSense*). The engine reads them as `engine.hubSettings` (`HubSettings`,
`src/engine/hub/settings.ts`): typed, every value its default outside 52in1 and headless
(`NO_HUB_SETTINGS`: volumes 1, vibration 1, no microphone, no DualSense extras), read again on
the hub's `change`. They are the player's, not the game's: never stored, never recorded.

- **Volumes**: the engine multiplies the music bus by `music` and every other sound by `effects`
  itself (docs/engine/audio.md *Buses and the player's 52in1 volumes*); never a master volume.
- **Vibration**: the hub scales every rumble by it itself; `hubSettings.values.vibration` reads it.
- **The microphone**: `hubSettings.micAllowed` (the player allowed games the microphone),
  `micLater` (allowed after this game was opened: it reaches the game once it is opened again),
  `micMuted` (the DualSense's mute button). A voice feature's settings row is off, with a line
  saying 52in1 allows the microphone in its Settings, under Sound (while `micLater`: to open the
  game again), until `micAllowed`: the engine's settings panel has that row for a game that passes
  `settings: { voice: true }` (docs/engine/game-api.md *Player settings*), and `engine.voiceOn`
  says it is on; then `await hubSettings.openMicrophone()` gives a stream or null. The game never asks the browser itself, and nothing opens during a replay. What a voice
  feature hears is input: it reaches gameplay through `ctx.input.send`, so it replays.

`ctx.dualsense` (`DualSense`, `src/engine/hub/dualsense.ts`) is the controller's outputs, each
only while its flag (`dualsense.flags`) is true, so the game plays the same without them:

```ts
ctx.dualsense.light(hurt ? PALETTE.red : PALETTE.green);   // '#RRGGBB' too; null: the hub's colour
ctx.dualsense.trigger('right', { kind: 'weapon', from: 0.3, to: 0.6, strength: 0.8 }); // resist | weapon | vibrate
ctx.dualsense.trigger('right', null);                      // let it go when its use ends
ctx.audio.play('radio', { bus: 'speaker' });               // the controller's speaker, else with the rest
```

Call them as often as you like: the controller is sent only what changed, and what the game
wants is sent again, a let-go too, when the player turns an extra back on (or plugs the controller
in again). Letting go (`null`) is sent even while an extra is off, so nothing given back then stays
on the controller. They are outputs: nothing is sent
outside 52in1, headless or during a replay. The engine lets the triggers go while it is paused,
lets both go and gives the light back (`light(null)`) when a level unloads, and for good at a
round's `end` and at `dispose` (`release()`, `close()`). The light should say something (health,
the team, danger): give it back on a title screen. Motion and the touchpad are input: they reach
a game through `ctx.input` (recorded), never by reading `dualsense.gyro`, `accel` or `touches`
(reading them turns the hub's own Motion aim off); `navigator.hid` and `getUserMedia` are never
used (`npm run lint`). Tests pass a fake: `Engine.headless(game, { hubSettings })`
(`src/engine/hub/settings.test.ts`; the systems e2e suite does it in a page).
