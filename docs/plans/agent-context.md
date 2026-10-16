# Plan: lean agent context

Temporary. Execute top to bottom; delete this file in the last PR. Audit of 2026-10-16 at `3f59c1e`.

Goal: an agent sees the answer in one call. Checks print only what is wrong, docs are read by
topic, searches skip generated data, scripts wait on one readiness signal, and nothing in the
repo lies about the code. Read costs below are the Read tool's own counts (≈ 0.4 tokens per byte of
markdown). The Bash tool shows ~30k characters of a passing command (beyond that: a 2 KB preview
and a file) and a ~10k head+tail excerpt of a failing one.

## Baseline

| What | Now | Target |
| --- | --- | --- |
| `scripts/check.sh`, passing | 1,362 lines, 121 KB (model table 83%) | ≤ 80 lines, ≤ 8 KB |
| A check failure | culprit printed mid-table; Bash excerpt and the Stop hook's `tail -n 60` miss it | culprit id in the last 15 lines |
| `npm run test:e2e`, all passing | 1,427 lines, 88 KB (1,298 `✔` lines), 19 min | failures + 1 line per suite |
| Read `docs/ENGINE.md` / `docs/GAME.md` | 47.7k / 59.9k tokens; first page stops at line 765 / 669 | any topic ≤ 5k tokens, one call |
| Grep `metal` | 250-line page of pack JSON, 0 of 25 `src` hits | `src` hits only |
| `__RIFTLIGHT__.step(30)` before the first start | runs 0 frames, freezes the game, no error | throws, names the promise to await |

## Rules for every phase

- One concern per PR, in order. `scripts/check.sh` green and the `verifier` subagent before each
  push. After the merge, wait for CI on `main` to pass before the next phase; a red, reverted main
  is fixed and re-landed first.
- Every new guard is shown to fail once (break it, see red, restore).
- Put before/after numbers in each PR body.
- An engine change a game can see bumps the version and adds a `CHANGELOG.md` section.
- Leave alone:
  - the structure of `docs/GUIDE.md` and `docs/GUIDE-ASSETS.md` (kit; tests pin named blocks);
  - README's download block and its *Handing the engine to another agent* section (`README.md:125`,
    cited by `ci.yml:143`, `public/handoff/index.html:4` and `e2e-bundle.mjs:155`);
  - comment density in code.

## Phase 1: noise (checks and searches)

1. `scripts/model.ts` `check` with no ids prints: models with problems, library models with
   warnings, one line per pack (`pack kenney-nature: 329 models, 0 problems, 120 warnings`) and the
   summary. Pack models' warnings are not listed (they are imported, not ours to fix). `--all` prints
   today's table. `check <id…>` stays as is. Problems print again after the summary, one per line:
   `✘ <id>: <problem>`.
2. `scripts/tex.ts` and `scripts/anim.ts` `check`: same default (rows not ok + summary + `✘` recap),
   `--all` for the table. Bug: `anim -- check Walk` ignores the clip unless `--character` is given
   (`scripts/anim.ts:176-182`); search every character for named clips.
3. `scripts/check.sh`:
   - Run the anim, model and tex checks (~5 s together) before lint, typecheck and test. The unit
     tests also assert every library model, texture and clip (`model.test.ts:526`,
     `texture.test.ts:237`, `animation.test.ts:122-131`), and `set -e` would stop at vitest before
     the data checks print their recap.
   - Quiet build: add `--logLevel warn` to the vite command inside `package.json`'s `build` script
     (warnings stay), and call it with `npm run --silent build`.
   - Its header says `--fast` skips "build and slow steps": make that true (Phase 5) or say what it
     skips.
4. `.claude/hooks/verify-on-stop.sh`: hand back the failing step's name and its recap (`tail -n 40` of
   a quiet check holds it). Replace "~15-20 s" with the measured time.
5. `scripts/e2e.mjs`: print each `✘` with its detail and one `✔ <suite>: <n> checks, <t> s` per suite;
   `E2E_VERBOSE=1` prints every check. `--help` prints suites and groups from the `SUITES` and
   `GROUPS` objects; delete the header list at lines 5-9 (stale: no `fullscreen`, `settings`).
6. Two `.ignore` files (ripgrep and the Grep tool honour them; git, Glob and Read don't). A root
   pattern leaks when a search starts in a subfolder, so the pack rule sits next to the packs.
   - `public/packs/.ignore`: `*.json`, `!index.json`, plus a comment: find pack assets with
     `npm run model -- find` / `npm run tex -- find`; name a file to search it.
   - Root `.ignore`: `/package-lock.json`.

Accept:
- the numbers in the table;
- break one library model, one texture and one clip in turn; each id shows in the last 15 lines of
  `scripts/check.sh` and in the hook's hand-back. Feed the hook `{"session_id":"<new id>"}` on stdin
  with a dirty tree, and use a fresh id each run: it stops blocking after 3 runs per id;
- a forced failing e2e check prints its `✘` and exits 1;
- `npm run anim -- check Walk` prints only Walk;
- Grep `metal`, searched from the root and from `public/`, returns no pack lines.

## Phase 2: docs by topic

1. Split `docs/ENGINE.md` into `docs/engine/<topic>.md` and `docs/GAME.md` into `docs/game/<topic>.md`.
   Mirror the code folders where one exists (`docs/engine/physics.md` for `src/engine/physics/`,
   `docs/game/monsters.md` for `src/riftlight/monsters/`), so an agent finds a folder's doc by its path.
   ENGINE.md's *Game systems* (lines 438-1449, 57% of it) goes by folder. `docs/ENGINE.md` and
   `docs/GAME.md` stay as indexes: one line per topic, naming the file and what it answers.
   Move ASSETS.md's *Importing* (with *Pixel-art sheets*), *Tracing*, *Textures* and *Texel density*
   into `docs/assets/`; the rest alone is 31 KB.
2. While moving, cut what isn't needed to act:
   - text that repeats AGENTS.md, GUIDE.md, ANIMATION.md or a script's own `help` (ENGINE 7-20,
     364-437, 1450-1462, 1525-1617; GAME 947-958, 1148-1153 vs 1647-1655, 491-502 vs 1358-1365);
   - measurements and history (ENGINE 35-37, 101-102, 581-586, 1645-1659; GAME 711-714, 1006-1013,
     and the "Measured:" sentences after them, but keep GAME 1015-1027: `balance -- endless` and
     the difficulty target);
   - test-suite inventories (GAME 223-240, ENGINE 1232-1234; 1234-1237 is the only doc of
     `__PIXEL_GAMES__` and the `?game=` map, so keep it) and the undefined R1-R5 codenames.
   Keep a one-line reason wherever it stops a regression.
3. Fix the stale claims:
   - ENGINE 264-266 (hero.mjs has no clips; `HERO_CLIPS` has 78);
   - ENGINE 1540 (`riftlight-levels` is in `@cameras`);
   - GAME 128-140 (the game's keys are `game/controls.ts`, not the arena's);
   - the GAME 1385 fragment;
   - GAME's system map at 46-60 (missing `game/`, `wire/`, `showcase/`, `balance/`; labs).
   Drop counts that drift (clips, filters, item bases, gems), including README's, rather than
   maintain them.
4. `README.md`: keep the pinned top block, the handoff section and the owner's one-time setup; drop
   what AGENTS.md says.
5. Path-scoped rules, `.claude/rules/<area>.md` with `paths:` globs, for engine, render, assets,
   animation, riftlight and world. Claude Code loads one when an agent first reads or edits a
   matching file. Each is ≤ 30 lines: the rules that must not break, plus which doc covers which
   folder. If a rule doesn't load, use a nested `CLAUDE.md` in that folder instead. Check each loads:
   a fresh subagent reads a matching file and quotes the rule.
6. `AGENTS.md`: replace "Read docs/X.md before…" with: the area rule loads itself; read the topic file
   it names, never a whole index or `CHANGELOG.md` (top section only). AGENTS.md must not grow (it
   is loaded every session).
7. Update every `docs/<file>.md *Heading*` reference (54, 28 of them in code). Add `src/docs.test.ts`:
   - every `docs/….md` path and `*Heading*` cited in tracked `.ts`/`.mjs`/`.md` files exists,
     except in `docs/plans/` and `CHANGELOG.md` (history);
   - every `docs/**/*.md` except `GUIDE*.md` and `docs/plans/` is ≤ 24,576 bytes (aim for ≤ 12 KB;
     ANIMATION.md is 23,928);
   - `AGENTS.md` is ≤ 11,264 bytes (it is 10,763).

Accept:
- no Read of a `docs/` file, except `GUIDE.md` and `docs/plans/`, returns a PARTIAL view;
- the rendering contract and "add a monster" each cost ≤ 5k tokens to read;
- the docs test fails on a broken reference, an oversized doc and an oversized AGENTS.md, then
  passes;
- the GUIDE tests pass.

## Phase 3: one readiness signal, one page helper

1. Engine readiness:
   - `__PIXEL_READY__` on `globalThis`: a `Promise<Engine>` that exists before start (vitest runs
     the engine in node, where there is no `window`). It resolves where `__PIXEL_ENGINE__` is set
     (`Engine.ts:637`) and rejects with the start error.
   - Give it a no-op `.catch(() => {})`. The no-webgpu suite asserts exactly one logged line
     (`e2e.mjs:653`), and an unhandled rejection adds a second.
   - `step()` throws `engine not ready: await window.__PIXEL_READY__` only until the first start
     completes (a `started` flag). It doesn't set `manual` when it throws.
   - During `loadGame()` (`Engine.ts:918`), `step()` keeps today's 0-frame behaviour.
     `e2e-world.mjs:128` calls `step(2)` in a polling wait while a room loads, and the kit's
     `check.mjs` steps a game between levels.
   - Install `__RIFTLIGHT__` (`Riftlight.ts:238`, `api.ts:475`) and `__WORLD__` (`world/index.ts:30`)
     after ready. A Riftlight swapped in by `loadGame` (replay and snapshot suites) still installs
     its API, and `dispose` cancels a pending install.
2. `scripts/page.mjs`, plus `scripts/page.d.mts` for the TS scripts:
   - It starts the dev server for film and playtest (they show source after an edit) or `vite
     preview` for e2e, gate-b and look.
   - It refuses a port someone else serves, keeping the guard at `e2e.mjs:171-174`.
   - It opens a page, awaits `__PIXEL_READY__` (failing fast on rejection) on pages that have an
     engine (`tree.html` has none), and collects console errors.
   - It replaces the copies in `e2e.mjs:171,205`, `e2e-world.mjs:89`, `film.ts:397,785`,
     `playtest.ts:109,535` and `gate-b.ts:191,363`.
3. `npm run look -- "<query>" [--keys …]`: `scripts/page.mjs` serves the build, then
   `scripts/bundle/check.mjs` runs on `http://localhost:<port>/<query>` with `--out .scratch/look`.
   check.mjs gives a PNG and `report.json` with `engine.state()`, and exits 1 on errors. Its own
   static server can't run the repo's `index.html`, which loads `/src/main.ts`.
4. Every CLI answers `help`, `--help` and `-h` with its manual and does nothing else. Today:
   - `balance -- help` runs a 36 s simulation;
   - `playtest --help` launches a playtest;
   - `build:single` and `bundle` run full builds;
   - `film` has no manual.

   The e2e `tools` suite runs each `--help` (exit 0, under 5 s). AGENTS.md gets one row for
   `npm run look` and one row naming the CLIs it lacks (inspect, balance, loot, tree, level, combat,
   monster, gate-b, build:single), each with `-- help`.
5. Version bump, CHANGELOG, and a GUIDE.md line telling kit agents to await `__PIXEL_READY__`.

Accept:
- a test shows an early `step()` throws;
- a probe that awaits `__PIXEL_READY__` on `/?game=riftlight` and then calls `step(30)` advances
  frames;
- all e2e suites pass, including `no-webgpu` and `@world`.

## Phase 4: remove what misleads

1. `src/riftlight/game/stubs/` (2,124 lines) never runs: `Riftlight.ts:166` overrides every stub
   port, and no test uses `stubPorts`.
   - Delete it, keeping `generateLayout`: move it next to its user (`town/town.test.ts:8`) and
     rename it, since `levels/layout/generate.ts:187` has a real `generateLayout`.
   - Remove the `stubPorts` export.
   - Fix every comment that says stubs run: `riftlight/index.ts:2-8`, `Riftlight.ts:9` and
     `:164-165`, `game/ports.ts:3-5`, `wire/index.ts:10-13` (whose GAME.md section doesn't exist),
     `bot.ts:2`, `scripts/e2e-riftlight-items.mjs:2-3`, and the game docs (GAME.md 1397 and 1544
     before the split).
2. Retire `docs/plans/asset-system.md` (~39k tokens; every phase is done) and `docs/plans/gate-a.md`.
   - Move the rules that still bind into `docs/assets/`, and repoint every `asset-system.md`
     reference (26 in `src/` and `scripts/` cite §4, §5, §7.x and §12).
   - Move `docs/plans/trace/` and `docs/plans/gate-a/` (test inputs) to
     `src/engine/model/fixtures/{trace,gate-a}/`.
   - Their `../../../src/…` imports change depth.
   - Exclude `fixtures/gate-a/` from `tsconfig.json`: those are Gate A's judged inputs; their parts
     must not change, and `archway-b2.ts:17` fails typecheck.
   - Update `trace.test.ts` (imports, the directory read at :264, provenance asserts at :296 and
     :305), `scripts/trace/sources.ts:142-145` (`gate-a:`) and `scripts/e2e.mjs:1300`.

Accept:
- `git grep -nE 'stubPorts|game/stubs'` prints nothing;
- `git grep -n 'docs/plans' -- ':!CHANGELOG.md' ':!src/docs.test.ts'` prints only this file;
- `scripts/check.sh` and the e2e `tools` suite pass.

## Phase 5: a fast Stop hook

The Stop hook takes ~90-110 s: lint 19 s, two `tsc` passes 27 s, vitest 59 s. Make
`scripts/check.sh --fast` run:
- the three data checks;
- eslint on changed files;
- `tsc --incremental`, with its build info under `node_modules/.cache`;
- `vitest related` on changed files.

The full run stays the gate (`/ship`, verifier, CI). Accept: ≤ 30 s on a one-file change (record
before and after); a type error and a failing related test each still block the stop. Delete this
plan in this PR.

## Not in this plan

- **Comment trimming:** 90-95% of comments are intent or contract; trimming saves < 0.5%.
- **Splitting Riftlight.ts, Engine.ts and ItemsUi.ts:** they change rarely. Split along their seams
  when a task next reworks one.
- **Changelog fragments, auto-discovered e2e suites:** they pay off only once agents work in parallel.
- **A committed API.md:** `src/engine/index.ts` (~2.6k tokens) already maps names to files.
- **Follow-up issues:** file these without the `claude` label, since that label starts an agent:
  - damage-type colours are defined five times, and the copies disagree (`combat/numbers.ts:8`,
    `Riftlight.ts:283`, `ui/panels.ts:15`, `telegraph.ts:58`, `hazards.ts:39`);
  - adding a damage type touches ≥ 7 files, though GAME.md says 3;
  - `hazards.ts:36` treats an unknown damage type as physical, silently;
  - the library's item sprites go unused (inventory icons are drawn in `ui/items/icons.ts`).
