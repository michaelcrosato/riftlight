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
   `roundDepth(info.round)` walking `ROUND_DEPTHS` (1, 2, 3: the levels a round's minutes fit).
2. Once the level is built the round calls `ready()`, with no key press: the hub's card is up.
3. The world stays still (`frozen`: `worldPaused`) until the hub's `start`; the countdown runs in
   game time from its `in`, with the banners 3, 2, 1, GO! (lines `round.*`).
4. Play: no menus or panels (the hub starts and ends rounds); a fallen hero rises at the level's
   start after `RESPAWN_SECONDS` instead of the recap and town.
5. The boss's death clears it (`cleared()`); at `end` the engine stands still and goes quiet.

## Modes

| Mode | Each copy | Reports |
| --- | --- | --- |
| `parallel` | its own copy of the round, from the same seed | `progress(score, "N kills")`; `result({ time })` when the boss falls, `result({ score })` at time-up |

The score is kills, half a hundred for the boss's lost life and a hundred for the clear
(`SessionRound.score`); stats carry kills, deaths and the depth.

## Checking it

- Headless: `src/riftlight/session/round.test.ts` plays rounds against the hub in memory
  (`LocalHub`): ready once built, frozen until the start, the countdown, a bot's clear time, a
  death and respawn, time-up, the end.
- The hub's own harness (`harness.html`, `bridge.js`, `round.js` from the ai-hub repository): serve
  them next to the built page and open
  `harness.html?game=riftlight.html&players=4&latency=150&jitter=50&loss=5&auto=1`; it passes when
  `window.__hubCheck.pass` is true.
