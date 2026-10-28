# 2026-10-28 — Shared Hospitality Rotations v1 contract

Introduces additive Hub-owned rotation configuration, strict schemas, six-week default global clock, Europe/London date conversion, effective publication lookup and frozen booking-selection reference helpers in `apps/shared/hospitality-rotations.ts`. Existing shared contracts and consumers are unchanged. Each group uses the global calendar and one unique canonical Hospitality Item; limits, units, increments, categories and dish selections are configurable data.

Validation: focused contract/AUTHMOD tests and isolated synthetic Firestore API suite passed; Hub typecheck/build passed. Shared-path policy fans out exact-source CI to all six applications. See the PR/task report for final validation outcomes and `docs/architecture/hospitality-rotations.md` for Luna's exact API and remaining integration map.
Deployment: none; no seeds, live assignments, migrations or production pipeline changes.
