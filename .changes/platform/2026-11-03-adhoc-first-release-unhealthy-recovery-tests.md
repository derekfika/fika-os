# 2026-11-03 — Cover Ad-Hoc unhealthy first-release recovery

Add regression coverage for a first-production rollout that reaches successful serving traffic but fails the exact-source health probe. The workflow must refuse completion, permit only explicit abandonment after stable exact-source evidence, and preserve the original journal, rollout, source, traffic and first-release baseline. Unknown or changing outcomes remain blocked.

Validation: `node --test tools/workflow/recovery.test.mjs` passed (15/15).
Deployment: none.
