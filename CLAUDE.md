@AGENTS.md

## Claude Code specifics

- Use the `verifier` subagent for an independent check of a finished change
  before you push anything non-trivial.
- Use subagents for parallel research or independent work streams so the main
  context stays small.
- Skills: `/ship` (verify → commit → push → PR), `/fix-ci` (diagnose and fix a
  failing CI run).

## Distribution: one self-contained HTML file

There is no hosted site (Vercel is gone). The game is handed out and play-tested as one file,
`riftlight.html`: `npm run build:single` writes it to `dist-single/` (the game page with every
`?game=`, Rapier's wasm, the models and the packs it uses inlined; it runs offline from `file://`).

- Once CI passes on `main`, its `riftlight-html` job replaces the file on the rolling
  `riftlight-latest` prerelease, so
  <https://github.com/michaelcrosato/riftlight/releases/download/riftlight-latest/riftlight.html>
  is always green `main`'s game. It is never the "latest" release: `releases/latest` stays the
  engine kit. `src/ci.test.ts` keeps the job and `scripts/build-single.mjs` in step.
- To hand me a build of a branch, run `npm run build:single` and send me
  `dist-single/riftlight.html`.
- Don't add hosting or deployments (Vercel or otherwise) unless I ask.
