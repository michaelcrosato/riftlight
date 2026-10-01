# claude-code-cloud-usage-credits-test

**Pixel Engine**: a WebGPU-first 3D engine that renders authentic 2D pixel art, designed
for AI agents to generate classic games. Three.js r186 `WebGPURenderer` + TSL
post-processing (with its built-in WebGL 2 fallback), Rapier physics, local GLB assets.

The page at `/` is **Riftlight**, the showcase hack-and-slash ARPG ([`docs/GAME.md`](docs/GAME.md)):
a title screen, the town of Emberfall with its blacksmith, merchant, mystic and rift keeper,
levels with monsters, loot and bosses, the death recap, save slots and the difficulty sliders
(Esc → Tuning). The movement demo is `/?game=playground` (and `?game=sandbox`).

- **Riftlight controls:** WASD move · mouse aims · LMB or J attack · Space dodge roll ·
  1–4 (or Q E R T, RMB = 1) skills · F talk / pick up / portal · I inventory · P passive tree ·
  C character · K codex · Esc pause. Pads: left stick, A attack, B dodge, X Y LB RB skills,
  RT interact, Back inventory, Start pause; prompts switch to pad glyphs. Phones get A/B/1/2/F/≡.
- **For agents:** `window.__RIFTLIGHT__` drives and inspects the game frame-exactly
  (`newRun`, `enterDepth`, `step`, `state`, `bot.run`...); `npm run playtest -- 1 --film` lets
  the playtest bot play a level and reports clear time, deaths and loot.

```bash
npm ci
npm run dev          # http://localhost:5173  (?game=playground|sandbox, ?seed=7, ?backend=webgl, ?mode=raw, ?res=320, ?aspect=fixed, ?fps=30, ?quality=high, ?debug=1)
npm run build        # production build
npm run build:single # dist-single/pixel-engine.html: one self-contained offline file
npm run lint && npm run typecheck && npm test
npm run test:e2e     # after build: WebGPU + WebGL 2 fallback in Chromium (needs xvfb-run; E2E_PORT=…)
npm run test:e2e -- moves      # one suite, or a CI group: @core, @cameras, @filters
npm run anim -- check          # animation metrics for every clip
npm run anim -- sheet Run      # contact sheet PNG → .scratch/anim/Run.png
npm run anim -- curves Run     # motion curves (graph editor) PNG
npm run film -- run-stop --gif # film a move in the real game → .scratch/film/
npm run playtest -- 1 --runs 3 --film   # the Riftlight bot plays depth 1 → .scratch/playtest/
```

Engine demo (`?game=playground`): *Move Playground*, an island with a station for every move (stairs, crawl tunnel,
ledges, vine wall, ladder tower, slippery slope, wall-kick chimney, push/pull blocks).

- **Moves:** WASD move · Shift walk · Space jump (double/triple, side flip, wall kick) ·
  C crouch (backflip, long jump, ground pound) · Z prone/crawl · X lie down · F grab/pull ·
  J punch-punch-kick / dive · V wave · B sit.
- **Cameras** (one per game): `?camera=iso|topdown|side|third|first|free`. Wheel or `+`/`-`
  zoom (not in first person). In `free` mode press Enter to fix the view and get a config.
  The debug UI's picker switches presets live and leaves the player where they are.
- **Looks:** 35 TSL filters, including the console eras `8bit`, `16bit` and `ps1` (with
  vertex wobble). Use `?filters=crt,lcd` or `?look=playstation`, and `[` `]` to cycle.
- **Animation:** 57 hero clips written as data, with foot IK and a gait generator. They are
  measured and drawn as PNG contact sheets and motion curves by `npm run anim`, filmed in the
  real game by `npm run film`, and previewed in the **Animation Lab** (`/lab.html`). See
  [`docs/ANIMATION.md`](docs/ANIMATION.md).
- **Game systems:** procedural retro **sound effects** and a chiptune **music** sequencer
  (both data; M mutes, volumes persist), pixel **particles** (dust, skid, sparkle, smoke,
  impact), crisp **pixel HUD** text, **trigger volumes** with enter/exit callbacks (the
  coins), **gamepads** (standard mapping), textured + vertex-colored toon materials, and
  **level switching** (`engine.loadGame`, `engine.dispose`). `?game=sandbox` opens the
  second demo level.
- **Also:** P Pixel ↔ Raw 3D · R 480×270 ↔ 320×180 (Riftlight moves these to F8 / F7) · ~ debug UI (on by default in dev, or
  `?debug=1`) · M mute. Hotkeys are configurable (`EngineOptions.debugKeys`).
- **Phones:** on-screen joystick + A/B/C/G/Z/X buttons, drag to orbit, pinch to zoom
  (automatic on touch screens). `npm run build:single` gives one HTML file to open on a phone.
- **Gamepads:** left stick moves, right stick looks, A jump · B crouch · X attack · Y grab ·
  LB prone · RB lie down · LT walk · RT crouch · d-pad moves.
- **Performance:** the scene, edges and art-pixel filters render at 480×270 and are upscaled
  once; the art width follows the screen (`aspect: 'adaptive'`, portrait phones fill the
  screen); the loop is capped at `maxFps` 60; `quality` low/medium/high sets the shadow map
  (auto: low on phones, lowered once on a slow start); a lost GPU device is recovered. Build
  (gzip): three 270 kB, Rapier 28 kB JS + 774 kB `.wasm` (streamed), game 43 kB.
  Details in [`docs/ENGINE.md`](docs/ENGINE.md).

Architecture, the camera and filter lists, the moveset and the game API are in
[`docs/ENGINE.md`](docs/ENGINE.md).

---

The repository is set up for **100% AI-driven development**: agents write, verify, open
PRs, fix CI, and merge. Humans set direction through issues.

## How work flows

```
issue labeled `claude` ─┐
@claude in a comment ───┼─▶ Claude (GitHub Action or cloud session)
cloud session / routine ┘        │ branch claude/*, scripts/check.sh until green, push
                                 ▼
                 Autopilot: open PR, squash-merge it at once, branch deleted
                                 │
                 ┌───────────────┴──────────────────┐
                 ▼                                  ▼
          CI on main (check + e2e)           Claude Review of the merged PR
                 │                           (blocking findings → issue `claude`)
       red? ─────┤
                 ▼
   auto-revert: claude/revert-<sha> PR, merged, CI on main again
                 │
                 ▼
   Claude Autofix: re-applies the change with a fix on claude/fix-ci-* (max 3 tries)
```

Merging doesn't wait for CI, and there are **no required status checks** on `main`, on
purpose: rolling back is cheap.

- **CI on `main` after every merge.** A merge made with the default `GITHUB_TOKEN` fires no
  push event, so Autopilot dispatches `ci.yml` on `main` itself (with `AUTOMATION_TOKEN` the
  merge's own push starts it). It also cancels the PR branch's run, which tests the same
  change: CI runs once per PR. A PR held open with `hold` keeps its branch run.
- **Auto-revert.** When CI fails on `main` and that commit turned it red (its parent passed,
  or never ran), CI's last job (`revert-red-main`, `scripts/ci/revert-red-main.sh`) reverts
  it on `claude/revert-<sha>`, merges that PR, comments on the original PR, opens an issue
  labeled `claude` to re-land it with a fix, and runs CI on `main` again. No LLM or secret
  needed. It never reverts a revert, or a commit that landed on an already red `main`. (It
  lives in CI itself because GitHub doesn't fire `workflow_run` for runs dispatched with
  `GITHUB_TOKEN`.)
- **Fix forward.** The `claude` issue is the ticket. With `AUTOMATION_TOKEN` and a Claude
  secret set, `claude-ci-autofix.yml` also fires and re-applies the reverted change with a
  fix on `claude/fix-ci-*` (or fixes `main` forward when nothing was reverted), and
  Autopilot merges that.

The one brake: add the **`hold`** label to a PR (or mark it draft) to stop the merge.

| Piece | File |
| --- | --- |
| Agent contract (all tools) | `AGENTS.md` |
| Claude Code entry point | `CLAUDE.md` |
| Single quality gate (stack auto-detect) | `scripts/check.sh` |
| CI: check + e2e groups in parallel (push, dispatch) | `.github/workflows/ci.yml` |
| `@claude` / `claude` label → implementation | `.github/workflows/claude.yml` |
| Review (merged PR → issue; held PR → comments) | `.github/workflows/claude-review.yml` |
| Red `main` → revert (`ci.yml` › `revert-red-main`), then Claude fix; red PR branch → Claude fix | `.github/workflows/ci.yml`, `.github/workflows/claude-ci-autofix.yml` |
| Open PR + merge, then CI on `main` + review | `.github/workflows/autopilot.yml` |
| Weekly unattended improvement | `.github/workflows/claude-maintenance.yml` |
| Skills / subagents | `.claude/skills/{ship,fix-ci}`, `.claude/agents/verifier.md` |
| Hooks (`.claude/settings.json`) | SessionStart `scripts/session-start.sh` (cloud-session install, again when the lockfile changes), PostToolUse `.claude/hooks/format-file.sh` (`eslint --fix` on the edited file), Stop `.claude/hooks/verify-on-stop.sh` (`scripts/check.sh --fast` before ending a turn with unshipped work) |

## One-time setup

1. **Install the Claude GitHub App** on this repo: <https://github.com/apps/claude>.
   Required for the Action, cloud-session auto-fix, and routine GitHub triggers.
2. **Add a secret** (Settings → Secrets and variables → Actions). CI, Autopilot and
   auto-revert work without any; Claude Review and Claude Autofix skip themselves, and
   `@claude` needs one of the first two:
   - `CLAUDE_CODE_OAUTH_TOKEN` — bills your Claude subscription. Create with `claude setup-token`.
   - *or* `ANTHROPIC_API_KEY` — bills the Claude API.
   - `AUTOMATION_TOKEN` *(optional)* — fine-grained PAT (contents + pull requests + issues:
     write). Events made with the default `GITHUB_TOKEN` trigger no workflows; with this
     token the PRs, merges and review issues it creates do (e.g. a review issue starts
     Claude right away instead of waiting for the weekly maintenance sweep).
   - Variable `CLAUDE_MODEL` *(optional)* — overrides the model (default `claude-opus-5-5`).
3. **Configure the repo** (auto-merge, squash-only, PRs required on `main` but no required
   status checks, labels, `main` as default):
   ```bash
   scripts/configure-github.sh michaelcrosatoDM/claude-code-cloud-usage-credits-test
   ```
4. **Hooks** are in `.claude/settings.json` (see the table above); nothing to do.
5. **Cloud sessions** (claude.ai/code):
   - Pick **Auto** in the permission-mode dropdown. Repo settings can't set `auto` or
     `bypassPermissions`; cloud sessions don't offer bypass at all.
   - Environment network access: **Trusted** covers npm/PyPI/crates/Go. Use **Full** or
     **Custom** if the app calls other services.
   - Put slow toolchain installs in the environment **setup script** (cached ~7 days);
     per-project installs stay in `scripts/session-start.sh`.
   - Turn on **Auto-fix** for PRs created in a session so CI failures and review comments
     get handled without you.
6. **Local terminal** (optional): set `"permissions": {"defaultMode": "auto"}` in
   `~/.claude/settings.json`, and use `claude --cloud "<task>"` to fan tasks out to parallel
   cloud sessions.
7. **Routines** (optional, claude.ai/code/routines): e.g. a nightly routine that picks the
   oldest open `claude` issue without a PR and ships it, or a GitHub trigger on
   `pull_request.opened` for a custom review checklist.

## Giving Claude work

- Open an issue from the **Task for Claude** template (auto-labels `claude`), or label any
  issue `claude`.
- Comment `@claude <request>` on any issue or PR.
- Start a cloud session at claude.ai/code or `claude --cloud "<task>"`.
- Run **Claude Maintenance** from the Actions tab with an optional focus.

Write outcomes and acceptance criteria, not steps.
