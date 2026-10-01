---
name: fix-ci
description: Diagnose and fix a failing CI run, then push the fix. Use when a CI run failed on a branch or PR, or when invoked by the CI autofix workflow with a run URL.
---

# Fix CI

Input: a failed run (URL or ID), the branch, the failed commit, whether it was
reverted on the default branch, and the PR number if any.

1. **Get the failure.** `gh run view <run-id> --log-failed` (fall back to
   `gh run view <run-id> --log`). Find the first real error, not the cascade.
   e2e failures upload their frames as the `e2e-frames-*` artifacts.
2. **Reproduce locally.** Run the failing step, or `scripts/check.sh`. For e2e,
   `npm run build && npm run test:e2e -- <suite or @group from the job name>`.
   Confirm you see the same failure before changing anything.
3. **Root-cause it.** "Flaky" is not a root cause. If a test is timing- or
   order-dependent, make it deterministic.
4. **Fix minimally.** Change only what the failure needs. Never skip, disable,
   or loosen a test or lint rule to get green.
5. **Verify.** `scripts/check.sh` passes, plus the failing e2e suite.
6. **Ship.** Commit subjects start `fix(ci): ` and end ` [ci-autofix]`.
   - On a PR branch: commit to that same branch, then `git push`.
   - On the default branch, failed commit **reverted** (CI on main reverts the
     merge that turned it red): create `claude/fix-ci-<short-topic>` from the
     current default branch, `git cherry-pick <failed commit>` to re-apply the
     change, then commit the fix on top and push. Autopilot opens the PR and
     merges it, so the change lands again, fixed.
   - On the default branch, **not reverted** (it was already red, or the revert
     conflicted): create `claude/fix-ci-<short-topic>` from the current default
     branch, fix forward, and push.
7. **Can't fix it?** (missing secret, external outage, needs a human decision)
   Comment on the PR (`gh pr comment`), or open an issue when there is no PR,
   with the failing step, the root cause, and exactly what is needed. Don't
   push a speculative change.
