# Riftlight with friends: 52in1 sessions

`src/riftlight/session/`, `src/main.ts`, `scripts/hub/`. 52in1 (the hub) deals rounds of games to
up to four players, each on their own device (AI Hub Session Protocol v1,
https://52in1.com/lib/hub/README.md; the engine's side is docs/engine/hub.md). A page built for the
hub opens straight into a round when the hub loads it. Players see 52in1, never AI Hub.

## The page

`npm run build:single` writes `dist-single/riftlight.html` ready for the hub, one page for every
online mode:

- the hub's client, `scripts/hub/session.js` (vendored **unmodified**: the hub replaces an
  unmodified copy with each new version), first in `<head>` after `<meta charset>`;
- the catalogue and session tags from `scripts/hub/riftlight.mjs` (the one place for the name,
  description, controls, tags, the ways it plays together and each mode's card text), written by
  `scripts/hub/head.mjs`: `hub:multiplayer` names every online mode (`MULTIPLAYER`: a shared world
  co-op 1-4 and versus 2-4, ghost 1-4, parallel 1-4, moments 1-4) and couch co-op on one device
  (`same-screen co-op 2-4`: the game's own menu's, never a session's: `headSession`, the harness
  runs and the package's checks read the online four alone), `hub:session-mode` the one it
  plays when nothing says which (`DEFAULT_MODE`, the shared world), `hub:session-players` 1-4,
  `hub:players` 1-4, the default's card as `hub:session-goal`/`-howto` and each online mode's own as
  `hub:session-goal-WORD`/`-howto-WORD` (`CARD`, by the hub's word: `co-op`, `versus`, `ghost`,
  `parallel`, `moments`); the rest of the head's words: docs/game/hub.md *What the head says*;
- one `hub:moment` per moment (`ID VERB SECONDS GOAL`, from `MOMENTS`: *Moments*);
- the `game-lines` block (every line a player reads: docs/game/lang.md).

The hand-over build adds the translations and what built it (docs/game/lang.md, *The hand-over
build*). Outside a session (the page opened on its own, or by the hub's catalogue without
`?aihub=1`) the client does nothing and the game runs as always.

## Joining

`src/main.ts`: when the page carries `hub:session` 1 and the hub opened it (`AIHub.active`),
`HubSession.join({ mode, seats })` connects before the engine starts, offering every online mode
the page names (`headSession()`); the hub picks the round's (`info.mode`, and `info.play` for a
shared world). Riftlight starts on the hub's seed (`info.seed`: every copy builds the same round)
with `new Riftlight({}, { session })`, the session is attached to the engine, and a browser that
can't run the game says so (`session.fail`). A round's run is thrown away after it: a session's
saves stay in memory, and nothing a round does is written to the player's slots (whatever store the
game was given); a save-state (`snapshot()`) is refused while a round is on (its state is the hub's
as much as the game's: a round replays from its recording).

## A round

`SessionRound` (`session/round.ts`) is the game's side of a round; the shell (`Riftlight`) is its
`RoundHost`.

1. Setup sends the round's command, `{ rl: 'round', info }` (recorded, so a session replays): no
   title, menus or town. The command starts a run on the hub's seed with a fresh hero levelled for
   the depth (`roundHeroLevel`: the playtest's), then enters the round's level: a designed depth,
   `roundDepth(info.round)` walking `ROUND_DEPTHS` (1, 2, 3: the levels a round's minutes fit). In
   moments it sets the moment up instead (*Moments*). A build that fails tells the hub (`fail`).
2. Once the level is built the round calls `ready()`, with no key press: the hub's card is up.
3. The world stays still (`frozen`: `worldPaused`) until play begins: when the hub's clock
   (`AIHub.time()`, the same on every device) reaches 0 after its `start`, with the banners 3, 2, 1,
   GO! (lines `round.*`; a moment's goal under them). That moment is real time, so it enters the
   game as a recorded command, `{ rl: 'round-go' }`: a session still replays.
4. Play: no menus or panels (the hub starts and ends rounds); a fallen hero rises at the level's
   start after `RESPAWN_SECONDS` instead of the recap and town (in a moment, a fall fails it).
5. The boss's death clears it (`cleared()`: the banner `round.cleared`; no portal, no town); at
   `end` the engine stands still and goes quiet.

## Modes

One page offers them all (`hub:multiplayer`); the hub picks one each round, and each plays the same
round (a moment is a stretch of one).

| Mode | Each copy | Sends | Reports |
| --- | --- | --- | --- |
| `parallel` | its own copy of the round, from the same seed | nothing | `progress(score, "N kills")`; `result({ time })` when the boss falls, `result({ score })` at time-up |
| `ghost` | its own copy, showing the other players' heroes | its hero, every fixed step | as parallel |
| `shared-world` co-op | one level, run by the host's copy | its hero, every fixed step; the host also the world | the host: `finish({ standings, scores, won })`: a team win when the boss falls, a loss at time-up; standings by kills |
| `shared-world` versus | the same one level, every player for themselves (no damage between heroes: a race for the score) | as co-op | the host: `finish({ standings, scores })` by score (`versusScores`), no team result |
| `moments` | its own copy of one moment, a fresh load each | nothing | `result({ won, time })`, once |

The score is kills, half a hundred for the boss's lost life and a hundred for the clear
(`SessionRound.score`); in versus each player's kills, their share of the boss's life (up to 50)
and a hundred for whoever fells it. Stats carry kills, deaths and the depth, named through lines
(`round.stat.*`: the hub shows them as written, in the reporting copy's language). Each seat starts
at its own spot by the level's start (`seatSpot`), the same on every copy.

## Moments

`session/moments.ts`: short stretches of the first three levels, each opened straight into, with a
goal cleared or failed in seconds. `MOMENTS` is the table (one `hub:moment` tag each, its goal a
line `moment.*` whose English is the tag's GOAL, the boss's name filled in):

| Moment | Verb, seconds | Set-up | Clears it | A decent player / idle (seeds 1-6) |
| --- | --- | --- | --- | --- |
| `vorgath` | defeat, 20 | level 1, hero level 2, 7 m short of the boss | the boss falls | the bot fells him in 8 to 10 s / time runs out, or the hero falls |
| `crypt-hall` | defeat, 12 | level 2, hero level 2, 6 m short of the first hall's two packs | every monster of them falls | the bot in 4.6 to 8.6 s / falls in 5.5 to 10 s |
| `skraal` | survive, 20 | level 3, hero level 5, 6 m short of the boss | still standing when time runs out | the bot stands with 127 to 171 life / falls in 6 to 8.5 s |
| `gale-escape` | escape, 8 | level 3, hero level 2, 6 m short of Gale's first pack (a leader and five) at the corridor's mouth | at the ring up the corridor, past the level's start (`spot`; no other pack within 15 m of the way) | a run (0.4 s to react) in 2.2 s, untouched / falls in 5.8 to 7.7 s, or time runs out |

- **The set-up** (`Riftlight.startMoment`): a fresh run on a seed from `session.rng(moment id)`
  (the hub's seed for this moment, recorded with the round's info), the hero at the moment's level,
  straight into its designed level, placed `back` metres short of its targets on the grid route
  from the level's start (`momentSpot`), facing them. The level's design places the targets: the
  same on every copy. An escape names its ring's spot, on a way out no other pack watches and in
  sight along it (the ring's arrow never points across a wall). Tune a moment with its set-up only
  (hero level, placement, which packs), never the game's balance, and measure it again
  (`session/moments.<id>.test.ts` plays seeds 1-3; headless `headlessMoment` and `playMoment`).
- **Play**: frozen until the hub's start like any round; the countdown shows the goal
  (`momentGoal`, wrapped onto more rows on a narrow screen), the seconds left show at the top
  from the countdown on (`round.moment_left`, `SessionRound.timeLeft` → `HudModel.timeLeft`,
  placed clear of the HUD: docs/game/ui.md *HUD layout*), an escape's spot is a cyan ring on the
  ground with a chevron over it, or an arrow pointing the way when it is off screen or under the
  HUD (`beacon`, clear of the HUD's zones).
- **The end of it**: the goal met (`momentMet`: its targets fallen, or the ring reached) clears it;
  the hero falling fails it (no respawn); at `time-up` one still going is cleared when its goal is to
  last (`survive`), failed otherwise. Each reports once, `result({ won, time })` at the hub's time
  (`round.moment_cleared` or `round.moment_failed` on screen); nothing is sent, no progress shown.
  The hub loads the page afresh for the next moment.

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
  reports the round, at time-up too: in co-op a team win (`won: true`) or loss, standings by kills
  (`killStandings`); in versus (`info.play`) no team result, standings by score (`versusScores`:
  kills, the share of the boss's damage it tracks per player, the boss's feller).
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
  them and touches nothing); `session/shared.test.ts` (the real game as host, then as a client;
  versus standings); `session/moments.test.ts` (the tags as the hub reads them, the set-up the same
  on every copy, an escape's clear way out, the end's banner and sound, no saves, time-up, a
  replay); `session/moments.<id>.test.ts`, one per moment (`testMoments.ts`: cleared by a decent
  player and failed idle, on three of the hub's seeds); `session/moments.hud.test.ts` (the seconds
  left, the goal and the way-out mark clear of the HUD on phones both ways, a laptop and the hub's
  frame; `headlessMoment` takes a `viewport` and `touch`).
- The hub's own harness (`harness.html`, `bridge.js`, `round.js` from 52in1.com/lib/hub): serve
  them next to the built page and open
  `harness.html?game=riftlight.html&mode=shared-world&how=co-op&players=4&latency=150&jitter=50&loss=5&auto=1`
  (`&mode=`/`&how=` pick the online mode, `&moment=a,b,c` the moments); it passes when
  `window.__hubCheck.pass` is true. The `hub` e2e suite (`scripts/e2e-hub.mjs`) runs every mode the
  page names, with a host leaving and a server host; `npm run hub` runs the protocol's whole set on
  the hand-over page (`protocolRuns`). Each run is `harness()`: a run that fails, or never
  finishes, leaves what its page was doing (the harness's log of every hub message, each copy's
  phase and frame, every frame's console, a stuck thread's stack, a picture) in
  `.scratch/hub/evidence/` (the suite) or `<dir>-checks/harness-evidence/` (`npm run hub`). A
  page whose renderer dies ends its run at once, as a crash (`CRASHED`): Playwright's waits never
  notice a dead page and would sit out the whole timeout. A four-copy harness page is the biggest
  browser process on a machine (about 0.8 GB, and 0.5 GB more in its GPU process), the one an
  out-of-memory killer takes first: on a WSL machine with earlyoom, `journalctl --user -u earlyoom`
  says whether it did.
