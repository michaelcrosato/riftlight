---
name: ship
description: Take finished work from the working tree to a merged PR - verify, commit, push; Autopilot opens and merges the PR. Use when a change is done and should go out.
---

# Ship

1. **Branch.** If on the default branch, `git switch -c claude/<short-topic>`.
2. **Verify.** Run `scripts/check.sh`. Fix until it passes. For non-trivial
   changes, have the `verifier` subagent review the diff and act on what it finds.
3. **Commit.** Stage only files belonging to this change. Conventional Commit
   subject (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`),
   imperative, ≤72 chars; body explains *why* when it isn't obvious.
4. **Push.** `git push -u origin HEAD`. Retry on network errors (2s, 4s, 8s, 16s).
5. **PR.** Pushing a `claude/*` branch makes Autopilot open the PR and merge it
   right away (no required checks: step 2 is the gate). If you have a GitHub tool
   and want a richer description, edit the PR afterwards using
   `.github/pull_request_template.md`. Label a PR `hold` to keep it open.
6. **Drive it.** CI then runs on `main`. If it goes red, the merge is reverted
   automatically: re-land the change with a fix (`/fix-ci`). Address review
   issues filed against your PR.
