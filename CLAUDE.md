@AGENTS.md

## Claude Code specifics

- Use the `verifier` subagent for an independent check of a finished change
  before you push anything non-trivial.
- Use subagents for parallel research or independent work streams so the main
  context stays small.
- Skills: `/ship` (verify → commit → push → PR), `/fix-ci` (diagnose and fix a
  failing CI run).

## Deploying to Vercel

Vercel does NOT auto-deploy from GitHub, on purpose. Pushing to GitHub never deploys.

Why: every Vercel build costs build minutes, and every deployment is stored and billed
daily. I only look at a tiny fraction of builds, so building on every push wasted money
on deployments nobody saw. The last deployment stays live until I ask for a new one.

Rules:

- Never deploy unless I explicitly ask in this session.
- Never re-enable automatic deployments or change `"deploymentEnabled"` in `vercel.json`.
- Never use the pause button, deploy hooks, or the Vercel CLI to deploy.

How to deploy (the only method): call the Vercel connector's `create_deployment` with:

- team: michaelcrosato-1122's projects
- project: `riftlight`
- gitSource: type `"github"`, org `"michaelcrosato"`, repo `"riftlight"`, ref `"main"`
- target: `"production"`

Then wait for the build to finish and report the result and the live URL.
