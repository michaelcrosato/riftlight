# Riftlight

**Pixel Engine**: a WebGPU 3D engine that renders authentic 2D pixel art, designed
for AI agents to generate classic games. Three.js r186 `WebGPURenderer` + TSL
post-processing, WebGPU only, Rapier physics, local GLB assets.

**Making a game with Pixel Engine?** You don't need this repository, only the engine kit: one
zip with the engine as a single ES module, its guide, a starter game and a browser check.
Download the newest release
(`curl -fLO https://github.com/michaelcrosato/riftlight/releases/latest/download/pixel-engine.zip && unzip pixel-engine.zip && cd pixel-engine`)
or build it here in about a minute
(`git clone --depth 1 https://github.com/michaelcrosato/riftlight && cd riftlight && npm ci && npm run bundle`)
and copy `bundle/pixel-engine/` to where the game will live. Then read the kit's `README.md` and
`GUIDE.md`. Work in this repository only to change the engine itself
([*Handing the engine to another agent*](#handing-the-engine-to-another-agent)).

What runs here: **Riftlight**, the showcase ARPG, at `/` (docs/GAME.md); **Engine World**, the
engine's tech demo, a room per technique, at `/?game=world` (docs/WORLD.md); the **Asset Gallery**
and **Asset Workshop** at `/?game=world&room=gallery` and `room=workshop` (docs/ASSETS.md); the
engine demos at `/?game=playground` and `?game=sandbox`. The engine's docs are indexed in
docs/ENGINE.md. How agents work in this repository (commands, checks, the merge flow) is
[`AGENTS.md`](AGENTS.md); the principles, [`docs/DOCTRINE.md`](docs/DOCTRINE.md).

## Handing the engine to another agent

`npm run bundle` builds the **engine kit**, everything an agent needs to make a game outside
this repo: `pixel-engine.js` (one self-contained ES module, about 4.8 MB: the engine,
three.js, Rapier, the hero and the built-in models), [`docs/GUIDE.md`](docs/GUIDE.md) (the
manual: host it, the mental model, a complete game, recipes, rules, common mistakes, checks),
[`docs/GUIDE-ASSETS.md`](docs/GUIDE-ASSETS.md) as `ASSETS.md` (models and textures as data, with
a generated `LIBRARY.md` and `CREDITS.md`), a generated `API.md`, TypeScript types, a starter
`game.js`, the guides' recipes as pages and `check.mjs`, which plays a page in a browser and
fails on any error (`--sheets` draws a game's own models). The receiving agent reads `README.md`
then `GUIDE.md` (about 15k tokens together; `API.md` and `LIBRARY.md` are searched, not read),
edits `game.js` and runs `node check.mjs` before handing back. Engine changes that a game can see
bump `package.json`'s version and get a `CHANGELOG.md` section.

What to give an agent:

| Give it | When | What it does |
| --- | --- | --- |
| This repository's URL, `https://github.com/michaelcrosato/riftlight` | An agent with a shell. It needs only GitHub (and npm to build), both on Claude Code cloud's default (*Trusted*) network allowlist | Reads the top of this README, then downloads the newest release or builds the kit from a clone |
| A release, `https://github.com/michaelcrosato/riftlight/releases/latest/download/pixel-engine.zip` | An agent with a shell that reaches github.com and release-assets.githubusercontent.com (both on the *Trusted* allowlist) | Unzips one file, no build. A version's own link (`…/releases/download/engine-v0.39.0/pixel-engine.zip`) never changes |
| The handoff page, <https://riftlight.vercel.app/handoff/> | An agent whose sandbox reaches the open web | Downloads the build of the site's last deployment, made from `main` when a merge changes the site. Claude Code cloud environments reach it at the *Full* network level or with its host allowed under *Custom*, not at the default *Trusted* one |
| `bundle/pixel-engine.zip` (`npm run bundle`) | A chat that runs code but can't download | Unzips the attachment. A chat that can't run code gets `docs/GUIDE.md` alone |

A prompt to start from: *Use this game engine to make our next game:
https://github.com/michaelcrosato/riftlight. Get its engine kit and test the game with the kit's
`check.mjs`. The game: …* Name both steps: an agent that guards against running code from the
internet, such as Claude Code in auto mode, may refuse to unpack the kit or run `check.mjs` unless
the prompt asks for it. Once the kit is in the game's repository, later sessions run it as the
game's own code. `check.mjs` also needs Playwright and a Chromium with WebGPU: Claude Code cloud
sessions come with both (a global Playwright, which `check.mjs` finds, and `CHROMIUM_PATH`);
elsewhere `npx playwright install chromium` downloads the browser from Playwright's servers, not
from GitHub or npm.

From 0.39.0 on, the engine kit is a
[GitHub Release](https://github.com/michaelcrosato/riftlight/releases) per version
(`engine-v<version>`): once check and e2e pass, CI's `release` job publishes the version of
`main`'s newest commit if it has none yet (a version superseded on `main` before its CI passed is
skipped), with `pixel-engine.zip` (`npm run bundle`) and the version's `CHANGELOG.md` section as
notes (`scripts/release/notes.mjs`). The site deploys `main` when a merge changes what it is built from, never a branch
(`vercel.json`; CLAUDE.md, "Deploying to Vercel"), and `npm run build` rebuilds the kit with it
(`/engine/`, `/engine.zip`): the site deploys before CI, so the handoff page can be ahead of the
newest release (by fixes, or a version CI hasn't passed yet). The handoff page ([`public/handoff/index.html`](public/handoff/index.html)) tells an
agent what to download, what to read and how to check its game. The kit's `README.md` and
`manifest.json` (`latest`, `releases`, `source`) say where newer versions are, so a game finds
its upgrades.
`src/engine/` alone doesn't stand on its own: it builds only inside this repository (Vite, the
pinned three.js and Rapier, the hero in `src/game/hero/`, the models in `public/assets/`); the
kit is that folder made standalone. A game started from a copy of this repository carries
Riftlight along, and its copy of the engine drifts from this one.

## Automation

Agents write, verify, merge and fix CI here (the loop is in `AGENTS.md`). The pieces:

| Piece | File |
| --- | --- |
| Agent contract (all tools) | `AGENTS.md` |
| Claude Code entry point | `CLAUDE.md`; area rules in `.claude/rules/` |
| Single quality gate (stack auto-detect) | `scripts/check.sh` |
| CI: check + e2e groups in parallel; a red `main` reverted (`revert-red-main`), then re-landed with a fix | `.github/workflows/ci.yml`, `scripts/ci/revert-red-main.sh` |
| `@claude` / `claude` label → implementation | `.github/workflows/claude.yml` |
| Review (merged PR → issue; held PR → comments) | `.github/workflows/claude-review.yml` |
| Red `main` or PR branch → Claude fix (needs `AUTOMATION_TOKEN` and a Claude secret) | `.github/workflows/claude-ci-autofix.yml` |
| Open PR + merge, then CI on `main` + review | `.github/workflows/autopilot.yml` |
| Weekly unattended improvement | `.github/workflows/claude-maintenance.yml` |
| Skills / subagents | `.claude/skills/{ship,fix-ci}`, `.claude/agents/verifier.md` |
| Hooks (`.claude/settings.json`) | SessionStart `scripts/session-start.sh` (cloud-session install, again when the lockfile changes), PostToolUse `.claude/hooks/format-file.sh` (`eslint --fix` on the edited file), Stop `.claude/hooks/verify-on-stop.sh` (`scripts/check.sh --fast` before ending a turn with unshipped work) |

A merge made with the default `GITHUB_TOKEN` fires no push event, so Autopilot dispatches `ci.yml`
on `main` itself (with `AUTOMATION_TOKEN` the merge's own push starts it) and cancels the PR
branch's run. The one brake: the **`hold`** label on a PR (or draft) stops the merge.

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
   scripts/configure-github.sh michaelcrosato/riftlight
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

## Licence

MIT ([LICENSE](LICENSE)). The engine kit (`npm run bundle`) ships the same `LICENSE`; its
`CREDITS.md` lists the third-party code it carries (three.js, Rapier) with their licences.
