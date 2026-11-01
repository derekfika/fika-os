# 2026-11-01 — Bound deploy-marker recovery CLI startup

Replace the standalone recovery command's top-level dynamic import with a static module binding, avoiding an unsettled top-level-await cycle while retaining the governed authorization and fail-closed recovery implementation. Add a child-process regression that verifies bounded termination and strict rejection of invalid arguments before any recovery operation.

Validation: pending focused workflow test and applicable tooling checks.
Deployment: none; no marker, lease, journal, lock, or release state was changed.
