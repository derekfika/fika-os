# 2026-11-01 — Bound deploy-marker recovery CLI startup

Replace the standalone recovery command's top-level dynamic import with a static module binding, avoiding an unsettled top-level-await cycle while retaining the governed authorization and fail-closed recovery implementation. Add a child-process regression that verifies bounded termination and strict rejection of invalid arguments before any recovery operation.

Validation: `node --test tools/workflow/deploy-marker-recovery.test.mjs` (14/14 passed, including bounded child-process termination), `node --check` for both changed JavaScript files, `fika workspace check`, `fika changelog check --base origin/main`, `git diff --check`, and exact-source GitHub validation run 477 (tooling, scope, and merge-gate all passed).
Deployment: none; no marker, lease, journal, lock, or release state was changed.
