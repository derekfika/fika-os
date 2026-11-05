# 2026-11-05 — Preserve changelog fragments during workspace recovery

Governed workspace reconciliation now treats unique changelog fragments as scope-exempt during both preflight and successor validation, matching the repository's normal workspace policy. Recovery still transfers only captured source workspace data and retains the original checkout.

Validation: pending focused regression and exact-source CI.
Deployment: none.
