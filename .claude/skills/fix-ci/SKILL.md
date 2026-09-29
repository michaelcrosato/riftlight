---
name: fix-ci
description: Diagnose and fix a failing CI run, then push the fix. Use when a CI run failed on a branch or PR, or when invoked by the CI autofix workflow with a run URL.
---

# Fix CI

Input: a failed run (URL or ID), the branch, and the PR number if any.

1. **Get the failure.** `gh run view <run-id> --log-failed` (fall back to
   `gh run view <run-id> --log`). Find the first real error, not the cascade.
2. **Reproduce locally.** Run the failing step, or `scripts/check.sh`. Confirm
   you see the same failure before changing anything.
3. **Root-cause it.** "Flaky" is not a root cause. If a test is timing- or
   order-dependent, make it deterministic.
4. **Fix minimally.** Change only what the failure needs. Never skip, disable,
   or loosen a test or lint rule to get green.
5. **Verify.** `scripts/check.sh` passes.
6. **Ship.**
   - On a PR branch: commit to that same branch with a subject starting
     `fix(ci): ` and ending ` [ci-autofix]`, then `git push`.
   - On the default branch: create `claude/fix-ci-<short-topic>`, commit the
     same way, and push. Autopilot opens the PR and auto-merges it.
7. **Can't fix it?** (missing secret, external outage, needs a human decision)
   Comment on the PR (`gh pr comment`) with the failing step, the root cause,
   and exactly what is needed. Don't push a speculative change.
