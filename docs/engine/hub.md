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

Holding View and Menu together (Create and Options, gamepad buttons 8 and 9: `HOST_CHORD`) for a
second opens the hub's bar, so once both are held the engine presses neither until both are let go
(letting one go first presses nothing), and each presses only as it is let go, if the other never
went down while it was held (`input.ts`): a thumb that reaches Options a poll before Create opens
no pause or settings panel behind the bar. Every game's pause on `PadStart` has it for free.

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
  game again; outside 52in1: that it needs 52in1), until `micAllowed`: the engine's settings panel
  has that row for a game that passes `settings: { voice: true }` (docs/engine/game-api.md *Player
  settings*), and `engine.voiceOn` says it is on. What a voice feature hears is input: a shout is a
  recorded press (*Shouts*, below), anything else reaches gameplay through `ctx.input.send`, from
  `await hubSettings.openMicrophone()` (a stream or null). The game never asks the browser itself,
  and nothing opens headless or during a replay.

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
itself (while a game reads the gyro, every poll, the hub's own Motion aim leaves the stick alone;
half a second after the reads stop it has the stick back):
`ctx.input.touchpad = true` turns touchpad swipes and taps into presses (`TOUCHPAD_KEYS`), and
`settings: { motion: true }` gives the game motion aim with a settings row and its sensitivity
(`input.motion`, on by default while the hub's own Motion aim is), both read through `hubPadInput`
only while asked for (*Motion and the touchpad*, below); `navigator.hid` and `getUserMedia` are
never used (`npm run lint`). Tests pass a fake: `Engine.headless(game, { hubSettings })`
(`src/engine/hub/settings.test.ts`; the systems e2e suite does it in a page).

### Motion and the touchpad

The DualSense's touchpad and motion come through 52in1 (`AIHubSettings.dualsense`, which the
engine hands to `input.dualsense`; nothing outside 52in1 or headless): read only while the game
asks, and never during a replay, so what they do arrives as recorded input. `ctx.input.touchpad =
true`: a quick swipe on the touchpad presses `PadTouchpadLeft` / `Right` / `Up` / `Down` and a tap
`PadTouchpadTap` (`TOUCHPAD_KEYS`, `touchpadGesture`: one finger, a swipe within 0.5 s over 40%
of the pad's height, a tap within 0.3 s), once, recorded, a use of the pad; its click is the button
`PadTouchpad`. Give each a button that does the same; a prompt draws a gesture with `padGlyph` (the
pad with the swipe's way, a dot for a tap) beside that button, while 52in1 lets the game read the
touchpad (`hubSettings.values.dualsense.touchpad`). In couch co-op a guest's DualSense swipes and
turns for that guest alone (docs/engine/couch.md). Motion aim (`input.motion = { on, sensitivity, lean
}`; a game with `settings: { motion: true }` has the engine keep it at the player's setting,
`engine.motionOn`): while on and the pad is in use, the controller's turns add to the right stick's,
gyro × dt × sensitivity into `mouseDelta` (8 pointer pixels a degree past a 4°/s still hand,
`MOTION_AIM`) and a lean into `lookAxis` as 52in1's own Motion aim leans the stick; the turn in
degrees is `input.motionTurn` (x right, y down, as `mouseDelta`; recorded as `InputFrame.turn`). A
game that keeps an aim direction (a twin-stick's) turns it by `motionTurn` and sets
`input.motion.lean = false`, so its aim stick is the stick alone (Riftlight: docs/game/actors.md
*The hero's controls*). 52in1 leaves
the stick alone only while the game reads the gyro: a game that stops reading it has 52in1's own
Motion aim (if the player has it on) back on its right stick half a second later. So while the
game's motion aim is on, the engine reads the gyro on every poll (the pad in use or not): 52in1
leaves the stick alone and the game's sensitivity applies. While it is off the engine reads
nothing, and 52in1's own Motion aim, if the player has it on, steers the right stick again half a
second later (the engine sees it as the stick, recorded as any stick is). A game without
`settings: { motion: true }` never reads the gyro unless it turns `input.motion.on` itself, and
52in1's own Motion aim stays the player's. The touchpad's fingers never take anything from 52in1.

### Shouts

52in1's microphone is recorded input the same way: heard only while the game asks, never headless
or in a replay. `ctx.input.voice = true` while a shout does something: a shout presses `VoiceShout`
(`VOICE_KEYS.shout`) once, recorded like a key, by the loudness (the RMS of the last 43 ms) against
the room's floor, by `SHOUT` (`shoutStep`; plain data from `newShout()`; a 0.73.0 `{ loud, quiet,
fired }` is filled in):

| `SHOUT` | Value | What it does |
| --- | --- | --- |
| `loud`, `holdS` | 0.2, 0.15 s | this loud, and `floorLoud` times the floor, this long: it presses |
| `quiet`, `quietS` | 0.06, 0.25 s | then nothing until under this, or `floorQuiet` times the floor, this long |
| `floorS`, `learnS` | 1 s, 0.5 s | the floor: the level's average over about 1 s; a stream's first 0.5 s learn it (no press) |
| `floorLoud`, `floorQuiet` | 1.5, 1.1 | a shout is over the room's sound (a hum), and that sound ends it |
| `echoS` | 0.3 s | while the controller's speaker plays, and this long after, nothing heard shouts or moves the floor |

Nothing locks out a shout well over the room: it must reach about 1.6× the room's average (it
lifts the floor while it lasts; Shout sensitivity can't lower that part), the floor follows the room
within a second or two, and a quarter second under it re-arms. **Simulated rooms** (`input.test.ts`; a shout: 0.4
RMS for 0.3 s), at Shout sensitivity 50% / 100% / 200% / 300%. *Alone*: presses in 60 s with nobody
shouting. *Wait*: the longest a player shouting once a second, from any moment, waits for a press
(s). A room turned on starts after 5 s of quiet.

| Room (RMS) | Alone | Wait |
| --- | --- | --- |
| quiet, 0.005; a fan's hum, 0.25 | 0 / 0 / 0 / 0 | 0.15 everywhere |
| the hum turned on | 0 / 1 / 1 / 1 | 0.15 everywhere |
| music swelling at 0.5 Hz, 0 to 0.3 | 0 / 30 / 30 / 30 | 0.15 / 1.15 / 1.15 / 1.15 |
| a TV's words, 0.1 to 0.25 | 0 / 19 / 26 / 26 | 0.15 / 2.14 / 2.15 / 2.15 |
| the TV turned on | 0 / 17 / 24 / 24 | 0.15 / 2.15 / 2.15 / 2.15 |
| talk near the microphone, 0.15 to 0.35 | 0 / 23 / 23 / 23 | 0.15 / 3.14 / 3.14 / 3.14 |
| that talk, turned on | 0 / 22 / 22 / 22 | 0.15 / 4.14 / 4.14 / 4.14 |

The cost is *Alone*: music or talk as loud as a shout presses on its own at 100% and up (its peaks
top the average); 50% stops it in every room. A soft shout (0.12) is under `loud` at 100% and a
shout at 200%; in a silent room at 300% one needs exactly `loud / 3`. After 5 s of loud music (0.3
to 0.5) a shout counts from 0.5 s on.

**Shout sensitivity**: `input.shoutSensitivity` divides `loud` and `quiet`, the floor still in force
(`shoutLevels`); with `settings: { voice: true }` the engine keeps it at the player's
`voiceSensitivity` (`VOICE_SENSITIVITY`, 0.5 to 3 by 0.5). `input.shoutMeter` is a level meter's
reading: the level, what a shout needs now, whether one pressed (null in a replay or while nothing
is heard). **A player tunes it** by the meter (Riftlight: Settings → Controller, Voice): the bar is
what the microphone hears, the mark what a shout needs, lit once one counts. If the room lights it,
turn Shout sensitivity down until it stops; if a shout falls short, turn it up.

**Tuning status: unverified on hardware.** Tuned on the rooms above and the e2e's test tone (a hum
of 0.23, over which a shout needs 0.34), never on a DualSense in 52in1, whose `getUserMedia` gain
control, noise suppression and echo cancellation shape the levels (the last may miss the
controller's speaker: `echoS`). Watch `engine.input.shoutMeter` in silence, talking, shouting, with
a TV on and the portal on the speaker: `loud` between talk and a shout, `floorLoud` between a room
and a shout over it, `echoS` longer if a speaker sound fires. Add a room to the test first; keep
*Wait* finite.

A shout that ends in a frame that never runs (paused, loading) presses nothing, then or later. While
the game listens, its voice feature is on (`engine.voiceOn`) and the mute button is off, the engine
opens the microphone once through `hubSettings.openMicrophone()` (`Microphone`, `input.microphone`)
and measures it with an `AnalyserNode` in its AudioContext (there after the first key, click or
touch); when any of it ends (the game stops listening, the setting goes off, muted, no longer
allowed, a replay) it stops the stream's tracks. A stream whose tracks end by themselves (the
DualSense's microphone unplugged) is let go and 52in1 asked again. Listen only while a shout does
something, or a meter shows it (the browser shows the microphone in use), give the shout a button
that does the same (Riftlight: War Cry, from the bar), and name it in `hub:dualsense`
(`microphone`). Prompts name it with the line `key.voice_shout` and draw a microphone (`keyGlyph`).
Tests set `input.microphone` to a `VoiceInput` (`on`, `level()`, `echo`) and feed numbers
(`src/engine/hub/microphone.test.ts`, `input.test.ts`).
