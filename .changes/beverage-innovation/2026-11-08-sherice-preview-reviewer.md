# 2026-11-08 — Add Sherice to staging Beverage preview reviewers

Add Sherice's exact Gmail identity to the no-write staging preview reviewer allowlist alongside the existing reviewer. Beverage site access remains governed by the bound Firebase identity and exact OPLOC entitlement procedure.

Validation: included in successful staging-configured Hub build and `fika validate`; all 1,153 Hub tests passed or were explicitly skipped (1,031 passed, 122 skipped, 0 failed). Emulator-dependent tests were skipped by default. Beverage app-specific tests were not run because its app code is unchanged.
Deployment: not deployed; waiting for Hub OAuth callback registration and rollout readiness.
