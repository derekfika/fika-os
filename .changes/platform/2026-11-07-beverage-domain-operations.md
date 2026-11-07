# 2026-11-07 — Preserve domain operations in staging release evidence

Classify active App Hosting custom-domain ownership and certificate operations separately from Beverage traffic-changing release operations. Domain state remains visible in recovery evidence while first-release quiescence continues to fail closed on builds, rollouts, traffic and unknown operations.

Validation: recovery, policy and release test suites pass (59 tests); `git diff --check` passes. Exact-source CI and final integration remain pending.
Deployment: no code deployment. Staging release-tooling deployment path remains pending exact-source integration.
