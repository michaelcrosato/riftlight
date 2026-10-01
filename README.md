# claude-code-cloud-usage-credits-test

**Pixel Engine**: a WebGPU-first 3D engine that renders authentic 2D pixel art, designed
for AI agents to generate classic games. Three.js r186 `WebGPURenderer` + TSL
post-processing (with its built-in WebGL 2 fallback), Rapier physics, local GLB assets.
Demo: *Coin Garden*.

```bash
npm ci
npm run dev          # http://localhost:5173  (?backend=webgl, ?mode=raw, ?res=320, ?aspect=fixed, ?fps=30, ?quality=high)
npm run build        # production build
npm run build:single # dist-single/pixel-engine.html: one self-contained offline file
npm run lint && npm run typecheck && npm test
npm run test:e2e     # after build: WebGPU + WebGL 2 fallback in Chromium (needs xvfb-run)
npm run anim -- check          # animation metrics for every clip
npm run anim -- sheet Run      # contact sheet PNG → .scratch/anim/Run.png
npm run anim -- curves Run     # motion curves (graph editor) PNG
npm run film -- run-stop --gif # film a move in the real game → .scratch/film/
```

Demo: *Move Playground*, an island with a station for every move (stairs, crawl tunnel,
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
- **Also:** P Pixel ↔ Raw 3D · R 480×270 ↔ 320×180 · ~ debug UI.
- **Phones:** on-screen joystick + A/B/C/G/Z/X buttons, drag to orbit, pinch to zoom
  (automatic on touch screens). `npm run build:single` gives one HTML file to open on a phone.
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
                        Autopilot: open PR + enable auto-merge
                                 │
               ┌─────────────────┼──────────────────┐
               ▼                 ▼                  ▼
            CI `check`      Claude Review     CI red? Claude Autofix
               │            (inline comments)  pushes a fix (max 3 tries)
               ▼
        squash-merge to main, branch deleted
```

The one brake: add the **`hold`** label to a PR (or mark it draft) to stop auto-merge.

| Piece | File |
| --- | --- |
| Agent contract (all tools) | `AGENTS.md` |
| Claude Code entry point | `CLAUDE.md` |
| Single quality gate (stack auto-detect) | `scripts/check.sh` |
| Cloud-session dependency install | `scripts/session-start.sh` |
| CI (`check` = required status) | `.github/workflows/ci.yml` |
| `@claude` / `claude` label → implementation | `.github/workflows/claude.yml` |
| Automated PR review | `.github/workflows/claude-review.yml` |
| CI failure → Claude fix | `.github/workflows/claude-ci-autofix.yml` |
| Auto-open PR + auto-merge | `.github/workflows/autopilot.yml` |
| Weekly unattended improvement | `.github/workflows/claude-maintenance.yml` |
| Skills / subagents | `.claude/skills/{ship,fix-ci}`, `.claude/agents/verifier.md` |
| Hook scripts (wire up in `.claude/settings.json`) | `.claude/hooks/` |

## One-time setup

1. **Install the Claude GitHub App** on this repo: <https://github.com/apps/claude>.
   Required for the Action, cloud-session auto-fix, and routine GitHub triggers.
2. **Add a secret** (Settings → Secrets and variables → Actions):
   - `CLAUDE_CODE_OAUTH_TOKEN` — bills your Claude subscription. Create with `claude setup-token`.
   - *or* `ANTHROPIC_API_KEY` — bills the Claude API.
   - `AUTOMATION_TOKEN` *(recommended)* — fine-grained PAT (contents + pull requests: write).
     PRs opened with the default `GITHUB_TOKEN` don't trigger other workflows, so without it
     Claude Review won't run on Autopilot-opened PRs.
   - Variable `CLAUDE_MODEL` *(optional)* — overrides the model (default `claude-opus-5-5`).
3. **Configure the repo** (auto-merge, squash-only, required `check`, labels, `main` as default):
   ```bash
   scripts/configure-github.sh michaelcrosatoDM/claude-code-cloud-usage-credits-test
   ```
4. **Add `.claude/settings.json`** with the permission allowlist and hooks (SessionStart
   dependency install, format-on-edit, verify-before-stop). See the setup PR/session for the
   proposed file.
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
