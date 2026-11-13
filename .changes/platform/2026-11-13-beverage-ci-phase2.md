# 2026-11-13 — Use Beverage app-only npm cache in CI

The affected-application validation job now skips the redundant root npm install for Beverage and keys npm cache to the Beverage app lockfile. Tests, typecheck and exact-source build remain in the same required job because the short test step does not justify a second runner and install.

Validation: app-only install, Beverage tests/typecheck/build and workflow routing guard passed locally. Exact-source GitHub Actions measurement pending.

Deployment: none.
