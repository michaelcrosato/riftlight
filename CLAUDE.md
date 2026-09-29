@AGENTS.md

## Claude Code specifics

- Use the `verifier` subagent for an independent check of a finished change
  before you push anything non-trivial.
- Use subagents for parallel research or independent work streams so the main
  context stays small.
- Skills: `/ship` (verify → commit → push → PR), `/fix-ci` (diagnose and fix a
  failing CI run).
