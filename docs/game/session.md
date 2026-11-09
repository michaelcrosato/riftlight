# Riftlight with friends: AI Hub sessions

`src/riftlight/session/`, `src/main.ts`, `scripts/hub/`. The AI Hub deals rounds of games to up to
four players, each on their own device (AI Hub Session Protocol v1; the engine's side is
docs/engine/hub.md). A page built for the hub opens straight into a round when the hub loads it.

## The page

`npm run build:single` writes `dist-single/riftlight.html` ready for the hub:

- the hub's client, `scripts/hub/session.js` (vendored **unmodified**: the hub replaces an
  unmodified copy with each new version), first in `<head>` after `<meta charset>`;
- the catalogue and session tags from `scripts/hub/riftlight.mjs` (the one place for the name,
  description, controls, tags, and each mode's card text), written by `scripts/hub/head.mjs`;
- the `game-lines` block (every line a player reads: docs/game/lang.md).

`--mode <shared-world|ghost|parallel>` picks the mode the page declares (default
`DEFAULT_MODE` in `scripts/hub/riftlight.mjs`); the hand-over build adds the translations and what
built it (docs/game/lang.md, *The hand-over build*).

Outside a session (the page opened on its own, or by the hub's catalogue without `?aihub=1`) the
client does nothing and the game runs as always.

## Joining

`src/main.ts`: when the page declares `hub:session` 1 and the hub opened it (`AIHub.active`),
`HubSession.join({ mode, seats })` connects before the engine starts; Riftlight starts on the hub's
seed (`info.seed`: every copy builds the same round) with `new Riftlight({}, { session })`, the
session is attached to the engine, and a browser that can't run the game says so (`session.fail`).

## A round

`SessionRound` (`session/round.ts`) is the game's side of a round; the shell (`Riftlight`) is its
`RoundHost`.

1. Setup sends the round's command, `{ rl: 'round', info }` (recorded, so a session replays): no
   title, menus or town. The command starts a run on the hub's seed with a fresh hero levelled for
   the depth (`roundHeroLevel`: the playtest's), then enters the round's level: a designed depth,
   `roundDepth(info.round)` walking `ROUND_DEPTHS` (1, 2, 3: the levels a round's minutes fit). A
   build that fails tells the hub (`fail`).
2. Once the level is built the round calls `ready()`, with no key press: the hub's card is up.
3. The world stays still (`frozen`: `worldPaused`) until play begins: when the hub's clock
   (`AIHub.time()`, the same on every device) reaches 0 after its `start`, with the banners 3, 2, 1,
   GO! (lines `round.*`). That moment is real time, so it enters the game as a recorded command,
   `{ rl: 'round-go' }`: a session still replays.
4. Play: no menus or panels (the hub starts and ends rounds); a fallen hero rises at the level's
   start after `RESPAWN_SECONDS` instead of the recap and town.
5. The boss's death clears it (`cleared()`: the banner `round.cleared`; no portal, no town); at
   `end` the engine stands still and goes quiet.

## Modes

The page declares one (`--mode`; `DEFAULT_MODE` is `shared-world`): each plays the same round.

| Mode | Each copy | Sends | Reports |
| --- | --- | --- | --- |
| `parallel` | its own copy of the round, from the same seed | nothing | `progress(score, "N kills")`; `result({ time })` when the boss falls, `result({ score })` at time-up |
| `ghost` | its own copy, showing the other players' heroes | its hero, every fixed step | as parallel |
| `shared-world` | one level, run by the host's copy | its hero, every fixed step; the host also the world | the host: `finish({ standings, scores, won })` |

The score is kills, half a hundred for the boss's lost life and a hundred for the clear
(`SessionRound.score`); stats carry kills, deaths and the depth. Each seat starts at its own
spot by the level's start (`seatSpot`), the same on every copy.

### A hero between copies

Every copy sends its own hero as a `HeroStep` each fixed step (`session/remote.ts`: the step's
game time, the intent's move, aim, attack, dodge, skill and held skills, a dead bit, and where the
hero stands), bundled by the session under the hub's rate. A `RemoteHero` plays another player's
steps into a hero of its own a little behind time (`RemoteTrack`), the presses between two of its
steps never lost, and pulls it toward where its player stands (a jump when more than 2.5 m off):
the same hero, clips and skills, so it runs, swings and dodges as its player did. When its
player's steps show them rising again, it rises there too; when they stop coming for half a second
it stands still. Before play (the card, the countdown) every copy sends where its hero stands ten
times a second (the host a frame of the world too), so traffic flows and the clocks are matched
from the start.

### Ghosts (`session/ghosts.ts`)

`GhostMode` shows each other player's hero as a **phantom** (`RealHero` with `phantom`): it fights
in a combat world of its own, on an event bus of its own, so nothing it does touches this copy's
level (its skills still light up; its own glow stays off); it is drawn see-through, a ring in its player's colour at its feet and the name over
its head (names come from the hub: drawn as text). A ghost hides while its player is down, and
after three seconds without a step; a player who leaves takes their ghost along.

### One shared world (`session/shared.ts`)

- **The host** (`HostWorld`) runs the level for real, every other player's hero a fighter in the
  level's combat world (`CombatWorld` holds several heroes, the player's own first), driven by their
  steps. Monsters chase the nearest hero (the level's flow field leads to every hero:
  `LevelNav.setTargets`), and each hero wakes what it walks into (`LevelContext.heroes`). Ten times a
  second it sends a frame of the world (`{ w }`: every living monster's place, facing and life, each
  hero's life and whether it is down, the kills by player, the damage numbers); as they happen, what
  its monsters start (`{ a }`: a skill and its aim; `{ g }`: a telegraph; `{ s }`: an add and its
  genome), watched through `LevelStage.observer`, and their deaths (`{ d }`). A frame counts each
  hero's deaths, so a client plays each death once (a frame still saying "down" after it rose is old
  news). A player who leaves takes their hero along, down first, so nothing goes on chasing it. When the boss falls it
  reports a team win (`won: true`), at time-up a loss; standings go by kills (`killStandings`).
- **A client** (`ClientWorld`) builds the same level from the same seed (the same monsters with the
  same ids), then makes every monster a **puppet** (`MonsterUnit.makePuppet`: no brain; it walks to
  the host's pose and starts what the host starts, `replaySkill`, so wind-ups, telegraphs and
  projectiles show where the host's land) and its own hero's life the host's: `Actor.puppet` takes
  no life from hits (they still flash) and dies only when told. An add the host makes joins by its
  genome (`LevelStage.spawnPuppet`); a puppet never makes adds itself (`spawnAdds` refuses: summons,
  splits, clones are the host's). Its hero moves at once under its player; the host's copy
  follows. Damage numbers and hurts are the host's.
- **A server** (the hub's copy with no player of its own) is a host whose own hero sits the round
  out (hidden, out of the fight); its camera follows the first player.
- In a shared world nobody gains experience (the host's hero would outgrow the others'), and
  nothing drops (`LevelStage.noDrops`: the score is kills; a drop is no one's).
- Known gaps: hazards and level mechanics run on every copy, so a hazard's timing can differ
  between the host's world (where its damage counts) and a client's (where it shows); kills count
  for the hero that landed them, so a minion's, a totem's or a trap's kill counts for no one, and a
  monster that falls into a void counts for the host's hero.

## Replays

A session records like any other run: the round's start is a command, the hub's events are input,
and the moment play began (the hub's clock reaching 0, real time) is a command too,
`{ rl: 'round-go' }`. A replay (`npm run replay`) has no hub: the round's command makes a round on
`HubSession.offline(info)` and the recorded commands play it the same, to the same fingerprint (which
holds the round's phase).

## Checking it

- Headless, against the hub in memory (`LocalHub`): `session/round.test.ts` (ready once built,
  frozen until the start, no menus, the countdown, a bot's clear time, no portal, a death and
  respawn, time-up, the end, a replay); `session/ghosts.test.ts` (a scripted player's ghost follows
  them and touches nothing); `session/shared.test.ts` (the real game as host, then as a client).
- The hub's own harness (`harness.html`, `bridge.js`, `round.js` from the ai-hub repository): serve
  them next to the built page and open
  `harness.html?game=riftlight.html&players=4&latency=150&jitter=50&loss=5&auto=1`; it passes when
  `window.__hubCheck.pass` is true. The hub also runs `&scenario=host-leave`, and a shared world
  with `&players=2&scenario=server`.
