# Riftlight on the AI Hub: the package

`scripts/hub/package.mjs` (`npm run hub`; `npm run hub -- help` prints its manual). The AI Hub
takes a game as a **package** (AI Hub Catalogue v1): one folder laid out the way the hub is, which
its importer copies onto the wall. The page's own rules live beside it: sessions in
docs/game/session.md, languages in docs/game/lang.md.

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
  the spelling with the wall's. `--mode` picks the session mode the page declares (default
  `DEFAULT_MODE`, scripts/hub/riftlight.mjs).
- **The covers** are 640×480 baseline JPEGs at quality 58 (a 960×720 window at device scale 2/3),
  from the finished file opened on its own: no session, English. Their moments are data in the
  script (`COVERS`): the page's agent API (`window.__RIFTLIGHT__`) plays to each one. Look at all
  three before handing the package in; never a loading, blank or debug frame, no two alike.
- **`--keep`** keeps the built page and takes the covers and runs the checks again; the page's own
  `hub:model`, `hub:effort` and mode stand (a flag that differs is an error: build again).

## The checks

The script runs the catalogue's three checks on the hand-over page itself, and exits 1 when one
fails (numbered as the catalogue numbers them; the script runs them 3, 2, 1):

1. **The hub's checker**, `scripts/hub/catalogue-check.mjs` (vendored **unmodified** from the hub;
   take a new copy when the hub changes it): the page's head, the file, the covers, and the game
   against the wall's (`--offline` skips the wall).
2. **The session harness** (`scripts/hub/harness/`, vendored unmodified): the runs the protocol's
   *Test it* names for the mode the page declares (`protocolRuns` in `scripts/e2e-hub.mjs`: two
   players; ghost and shared world also four on a lossy network, and the host leaving; a shared
   world also a server with no player). The `hub` e2e suite runs a shorter set in every mode on
   development builds (docs/game/session.md, *Checking it*).
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
