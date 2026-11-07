# 2026-11-07 — Governed Beverage staging-only target

Adds a staging-only Beverage App Hosting mapping with an explicit absence of any production target. Exact-source release, first-empty-backend verification, recovery and anonymous health checks are scoped to this single preview backend. Beverage enters the affected-app CI matrix; workspace, branch, exact-source and merge gates remain unchanged.

Validation: affected-app detection and workspace overlap checks passed; focused policy/hosting/release/recovery tests passed (62); full exact-source workflow suite passed (159); `git diff --check` and changelog validation passed. PR #456 exact-source tooling, source-workspace and aggregate merge-gate checks passed.
Deployment: none.
