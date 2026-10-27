#!/bin/sh
# Vercel's Ignored Build Step (vercel.json "ignoreCommand"): exit 0 skips the deployment, exit 1
# builds it. Every deployment is stored and billed daily, so Vercel deploys main only, and only
# when a commit changed something `npm run build` reads (CLAUDE.md, "Deploying to Vercel").
# Anything unsure builds: a skipped change that mattered would leave the site stale.
#   sh scripts/vercel-ignore.sh            what Vercel runs (it sets the VERCEL_GIT_* variables)
#   VERCEL_GIT_COMMIT_REF=main VERCEL_GIT_PREVIOUS_SHA=<sha> sh scripts/vercel-ignore.sh; echo $?

# Backs up vercel.json's "deploymentEnabled": no other branch deploys. No branch at all (a
# deployment made without git) builds.
if [ -n "$VERCEL_GIT_COMMIT_REF" ] && [ "$VERCEL_GIT_COMMIT_REF" != main ]; then
  echo "vercel-ignore: skip, branch '$VERCEL_GIT_COMMIT_REF' is not main"
  exit 0
fi

# The last successful deployment of main; empty on the first one.
prev=$VERCEL_GIT_PREVIOUS_SHA
if [ -z "$prev" ]; then
  echo "vercel-ignore: build, no previous deployment"
  exit 1
fi
# Vercel's clone is shallow: fetch more history if the previous deployment isn't in it.
git cat-file -e "$prev^{commit}" 2>/dev/null || git fetch --quiet --depth=200 origin main 2>/dev/null
if ! git cat-file -e "$prev^{commit}" 2>/dev/null; then
  echo "vercel-ignore: build, $prev is not in the clone"
  exit 1
fi

# What the build never reads: CI and agent config, the agent docs, tests, the checks and CI
# scripts. docs/ is checked apart: the kit is built from docs/GUIDE.md and docs/GUIDE-ASSETS.md.
if git diff --quiet "$prev" HEAD -- . \
  ':(exclude).github' ':(exclude).claude' ':(exclude).vscode' \
  ':(exclude)AGENTS.md' ':(exclude)CLAUDE.md' ':(exclude)README.md' ':(exclude)docs' \
  ':(exclude,glob)**/*.test.ts' ':(exclude,glob)scripts/e2e*.mjs' \
  ':(exclude)scripts/ci' ':(exclude)scripts/release' ':(exclude)scripts/check.sh' \
  ':(exclude)scripts/session-start.sh' ':(exclude)scripts/configure-github.sh' \
  ':(exclude)scripts/forbidden-apis.mjs' ':(exclude)eslint.config.js' \
  && git diff --quiet "$prev" HEAD -- docs/GUIDE.md docs/GUIDE-ASSETS.md; then
  echo "vercel-ignore: skip, nothing the site is built from changed since $prev"
  exit 0
fi
echo "vercel-ignore: build, the site's sources changed since $prev"
exit 1
