# 2026-11-08 — Add Sherice to staging Beverage preview reviewers

Add Sherice's exact Gmail identity to the no-write staging preview reviewer allowlist alongside the existing reviewer. Beverage site access remains governed by the bound Firebase identity and exact OPLOC entitlement procedure.

Validation: included in successful staging-configured Hub build and `fika validate`; all 1,153 Hub tests passed or were explicitly skipped (1,031 passed, 122 skipped, 0 failed). Emulator-dependent tests were skipped by default. Beverage app-specific tests were not run because its app code is unchanged.
Deployment: verified on staging SHA `45bc309e27d6ca1948f4afbba0d5377e0ba18a28`, rollout `build-2026-11-08-001`, 100% traffic; smoke verified the exact build and preview auth gate. Beverage staging loaded on its operator-facing custom domain in the in-app browser.
