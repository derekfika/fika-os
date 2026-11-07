# 2026-11-07 — Governed Beverage staging-only target

Adds a staging-only Beverage App Hosting mapping with an explicit absence of any production target. Exact-source release, first-empty-backend verification, recovery and anonymous health checks are scoped to this single preview backend. Beverage enters the affected-app CI matrix; workspace, branch, exact-source and merge gates remain unchanged.

Validation: affected-app detection and workspace overlap checks passed; policy, hosting, release and recovery workflow tests passed (62); `git diff --check` and changelog validation passed. Exact-source governed CI is pending.
Deployment: none.
