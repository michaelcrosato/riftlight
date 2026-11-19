# Riftlight on 52in1: the package

`scripts/hub/package.mjs` (`npm run hub`; `npm run hub -- help` prints its manual). 52in1 (the
hub: AI Hub Catalogue v1, https://52in1.com/lib/hub/catalogue.md) takes a game as a **package**:
one folder laid out the way the hub is, which its importer copies onto the wall. The page's own
rules live beside it: sessions in docs/game/session.md, languages in docs/game/lang.md. Whatever a
player sees says 52in1, never AI Hub.

```bash
npm run hub -- --model "<the model, as its maker names it>" --effort <low|medium|high|xhigh|max|ultra>
```

writes `.scratch/hub-package/` (`--out <dir>` for another folder; it is emptied first, and refused
when it holds anything but a package's `games/` and `covers/`):

```
games/riftlight-v<version>.<build>.html   the hand-over build (build:single -- --translations --model ...)
covers/riftlight/0.jpg                     the title screen
covers/riftlight/1.jpg, 2.jpg              a fight in a rift; Emberfall's plaza
```

- **The file name**: the hub's slug is `riftlight`; the version at the end
  (`<package version>.<build>`, the build being the commit's UTC time `YYYYMMDDhhmm`) makes each
  hand-over a new build of the same game on the wall, whatever the clone's depth.
- **What built it** (`hub:model`, `hub:effort`) is given at hand-over and never stored in the
  repo. The model is written the way its maker names it, not as an API id; the checker compares
  the spelling with the wall's. The one page offers every online mode (`hub:multiplayer`,
  docs/game/session.md *The page*).
- **The covers** are 640×480 baseline JPEGs at quality 58 (a 960×720 window at device scale 2/3),
  from the finished file opened on its own: no session, English. Their moments are data in the
  script (`COVERS`): the page's agent API (`window.__RIFTLIGHT__`) plays to each one. Look at all
  three before handing the package in; never a loading, blank or debug frame, no two alike.
- **`--keep`** keeps the built page and takes the covers and runs the checks again; the page's own
  `hub:model` and `hub:effort` stand (a flag that differs is an error: build again).

## What the head says

`scripts/hub/riftlight.mjs` holds the words (the catalogue's *The head*); each says only what the
game does. `src/riftlight/session/head.test.ts` runs the hub's checker on them and holds them to
the game: the controls to its bindings (`KEYS`, `MOUSE`), the DualSense extras to the code that
uses them, couch co-op to one device.

| Tag | Riftlight's | Why |
| --- | --- | --- |
| `hub:tags` | `action-rpg, pixel art, co-op, gamepad, touch` | what it is; co-op (the default online mode, and the couch); `gamepad` and `touch` because it plays fully on a controller and by touch alone (52in1's input filters and the Friends view go by them). 5 is the cap: `isometric` and `loot` stay in the description |
| `hub:controls` | `WASD to move; click to attack; 1–4 or right click for skills; Space to dodge; F to interact; Tab for the map; gamepad or touch to play; gamepads for players 2–4` | keys first, in the Couch's keycap words, at most 160 characters; then a pad or touch for it all, then the couch's pads (the catalogue: on one device `hub:controls` names them) |
| `hub:dualsense` | `light bar, adaptive triggers, haptics, motion, touchpad, speaker, microphone` | the hero's life on the light bar, R2's latch while there is something to interact with (R2 interacts) and play's rumbles (`game/padFeel.ts`), motion aim (`turnAim`), the touchpad (a swipe left or right pages the character screens as L1 / R1 do; its press opens the map), the portal and loud drops on the `speaker` bus, a shout into the microphone (War Cry: docs/game/actors.md *The hero's controls*) |
| `hub:multiplayer` | `shared-world co-op 1-4, shared-world versus 2-4, ghost 1-4, parallel 1-4, moments 1-4, same-screen co-op 2-4` | the four online modes (sessions: docs/game/session.md) and couch co-op (docs/game/shell.md *Couch co-op*), the game's own menu's: never offered to a session, no card of its own |
| `hub:players` | `1-4` | the most a shared world, a ghost round or the couch seats (parallel and moments aside) |
| `hub:session-howto` | `WASD move · click attack · 1-4 skills · Space dodge · or a gamepad or touch` | the session card's controls, at most 80 characters; every online mode's card has the same |

## What a player reaches in the file

`riftlight.html` carries every `?game=` (src/games.ts), but the hub opens the page with none: a
player reaches Riftlight, and from its title and the Engine Workshop in town Engine World and its
Asset Gallery (`?game=world`). Those are player-facing and play fully on a pad (Options the menu,
Circle back, Create the room list), with a mouse and keys, and on a phone, with prompts for the
input in use (docs/WORLD.md *Playing it*). The World's own words stay English, the engine's tech
demo by decision (docs/game/lang.md); the names of keys and buttons in its prompts are the game's
lines. The other games are developer tools reached only by a typed URL: the arcade on its own
(`arcade`, the side-scroller template), `playground` and `sandbox` (the engine's demos, on the
engine's one pad scheme, `KEYMAP`), `arena`, `lootlab` and `levellab` (Riftlight's labs, on
Riftlight's pad layout where they have a hero; their status lines are dev. lines). Nothing there is
promised to a player, but each still plays on a pad.

## In 52in1's frame

52in1 never serves the page as built: the Worker on the games' address puts the hub's companion
script first in it (`<script src="/lib/hub/companion.js">` at the top of `<head>`;
`scripts/hub/companion.js`, vendored unmodified, its commit in `scripts/hub/harness/README.md`), and
the hub's page speaks to it by postMessage (`hubFrame`): to the game `pads` {want}, `hush` {on},
`settings`, `ds-input` {gyro, accel, touches}; from it `hello`, `wake`, `pads`, `hushed`, `ds-want`,
`ds-light`, `ds-trigger`. What that means for Riftlight:

- **The hush.** A game night's round (`?aihub=1`) loads under the hub's cards, and the companion
  holds the game's AudioContext until the round starts. It knows the context by a source started in
  it, and hears only `AudioScheduledSourceNode`'s `start`, which an AudioBufferSourceNode (every
  engine sound) overrides: the engine starts a silent ConstantSourceNode as it makes its context
  (docs/engine/audio.md), or the music would play on under the cards.
- **Volumes.** The hub's master is the companion's gain in front of the speakers; music and effects
  are the engine's buses (`engine.hubSettings`).
- **The wake band.** A touch, or the mouse, in the top 90 CSS px brings the hub's bar back (`wake`).
  On a touch page no tap target sits there (docs/game/ui.md), and a finger landing there is the
  hub's: it neither swings, held, nor taps anything (`Riftlight.inWake`).
- **The DualSense.** Its motion and touches come as `ds-input` once the game reads them (`ds-want`).

**Checking it**: the `hub` e2e suite, after the harness (`scripts/e2e-hub-companion.mjs`), serves
the built page as the Worker does (`withCompanion`) from 127.0.0.1, framed by a page of its own on
localhost (another origin, as on 52in1) playing the hub's side (`hubSide`, as 52in1's
`assets/js/ui/frames.js`). On a desktop and a 390×844 touch phone: hello and the pads; the settings
in `engine.hubSettings`; the volumes, and a change applied live; the mouse, or a finger held, in the
band wakes the hub each time and Riftlight does nothing with it (no panel, map, swing, move or
press), while below it a finger wakes nothing and is the game's; no console errors. On the desktop a
fake DualSense: its motion reaches `input.motion` (52in1's own Motion aim keeps off the right stick),
a touchpad swipe pages the character screens, the light bar goes out. Then a game night: the
vendored harness's parallel round for two with the hub's side in its page, hushed as it loads: a
copy clicked under the cards keeps its context held, has its sound back once the round starts, and
the harness's checks pass. `src/engine/hub/companion.test.ts` runs the real companion headless.

## The checks

The script runs the catalogue's three checks on the hand-over page itself, and exits 1 when one
fails (numbered as the catalogue numbers them; the script runs them 3, 2, 1):

1. **The hub's checker**, `scripts/hub/catalogue-check.mjs` (vendored **unmodified** from the hub;
   take a new copy when the hub changes it, and record its commit in `scripts/hub/harness/README.md`,
   which names the commit all five vendored files are from): the page's head, the file, the covers,
   and the game against the wall's (`--offline` skips the wall).
2. **The session harness** (`scripts/hub/harness/`, vendored unmodified): the runs the protocol's
   *Test it* says the hub runs for every online mode the page's `hub:multiplayer` names
   (`protocolRuns` in `scripts/e2e-hub.mjs`, reading the page as the hub does: `pageModes`):
   parallel and moments at 1 and 2 players, the others at 2, 3 and 4, each on a poor network; each
   once more with a player leaving; a shared world once more hosted by a server with no player;
   moments play every moment the page names (the hub picks three by the seed). A run that fails
   leaves what its page was doing in `<dir>-checks/harness-evidence/`; a browser that dies in one
   fails that run alone, and the next has a new one. The `hub` e2e suite runs a shorter set in
   every mode on development builds (docs/game/session.md, *Checking it*).
3. **The browser**: the picture reaches every edge at 1600×900, 2100×900 and 1200×900 (loaded at
   one, resized to the others: `engine.state().framing`). Under `?lang=en-XA`, `zh-XC` and `ar-XB`
   the page sets `<html lang>`, and every text the title and the town draw
   (`__PIXEL_TEXT_LOG__`, docs/engine/lang.md) is in the test language, proper names aside: a word
   that isn't a line fails (the same test as `npm run lang -- audit`, docs/game/lang.md). Nothing
   logs an error. Pictures in `<dir>-checks/`, beside the package (never in it).

## Handing it in

Run it on a green `main` once the translations are current (`npm run lang -- status`), look at
every picture and every `!` the checker prints, then hand the folder over (it is not committed and
not published: the hub's importer takes it from there).
