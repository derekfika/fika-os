# 2026-11-13 — Parallelise Hospitality CI validation

Skip the unnecessary root dependency install for Hospitality application tests and key that job's npm cache only to the app lockfile. Run app-only typecheck and exact-source production build in a separate required lane alongside the unchanged test suite. The merge gate now requires both Hospitality lanes. Other application jobs retain their existing paths.

Validation: app-only Hospitality tests passed with 476/476 cases; CI routing checks, typecheck and production build passed locally. Exact-source GitHub Actions validation remains required before integration. Deployment: none.
