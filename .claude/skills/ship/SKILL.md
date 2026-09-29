---
name: ship
description: Take finished work from the working tree to a merging PR - verify, commit, push, open PR, enable auto-merge. Use when a change is done and should go out.
---

# Ship

1. **Branch.** If on the default branch, `git switch -c claude/<short-topic>`.
2. **Verify.** Run `scripts/check.sh`. Fix until it passes. For non-trivial
   changes, have the `verifier` subagent review the diff and act on what it finds.
3. **Commit.** Stage only files belonging to this change. Conventional Commit
   subject (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`),
   imperative, ≤72 chars; body explains *why* when it isn't obvious.
4. **Push.** `git push -u origin HEAD`. Retry on network errors (2s, 4s, 8s, 16s).
5. **PR.** Pushing a `claude/*` branch makes Autopilot open the PR and enable
   auto-merge. If you have a GitHub tool and want a richer description, open or
   edit the PR yourself using `.github/pull_request_template.md`.
6. **Drive it.** Fix CI failures (`/fix-ci`) and address review comments until it merges.
