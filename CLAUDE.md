@AGENTS.md

## Claude Code specifics

- Use the `verifier` subagent for an independent check of a finished change
  before you push anything non-trivial.
- Use subagents for parallel research or independent work streams so the main
  context stays small.
- Skills: `/ship` (verify → commit → push → PR), `/fix-ci` (diagnose and fix a
  failing CI run).

## Deploying to Vercel

Vercel deploys `main` to production when a merge changes what the site is built from, and
nothing else. Branches never deploy, so a PR gets no preview.

Why: every Vercel build costs build minutes, and every deployment is stored and billed daily.
Previews of `claude/*` branches (merged within minutes) and builds of commits that change only
tests, docs or CI paid for deployments nobody saw.

How (`vercel.json`, `scripts/vercel-ignore.sh`, `src/vercel.test.ts` keeps both true):

- `"git": { "deploymentEnabled": { "**": false, "main": true } }`: only `main` deploys.
- `"ignoreCommand"`: Vercel skips a `main` build when nothing `npm run build` reads changed since
  the last deployment (`.github/`, `.claude/`, the agent docs, `docs/` but the two guides the kit
  is built from, `*.test.ts`, the e2e, CI and check scripts). When unsure, it builds. A new
  build input outside `src/`, `public/` and the root config is built by default; a new path the
  build never reads can join the skip list (and the test).

Rules:

- Never turn on deployments for other branches or drop the ignore step.
- Never deploy by hand (CLI, deploy hooks, the connector's `create_deployment`) unless I ask
  in this session; then deploy `main` to production with the Vercel connector's
  `create_deployment` (team michaelcrosato-1122's projects, project `riftlight`, gitSource type
  `"github"`, org `"michaelcrosato"`, repo `"riftlight"`, ref `"main"`, target `"production"`),
  wait for the build and report the result and the live URL. The ignore step runs on it too: it
  comes back CANCELED when nothing the site is built from changed since the last successful
  deployment, which means the live site already is that build.
- A merge deploys before CI runs on `main`; a red merge stays live until `revert-red-main`'s
  revert deploys.
