# 2026-11-16 — Reconcile App Hosting configuration operations safely

Resolves the App Hosting backend PATCH long-running Operation before treating the override update as complete. Adds a hash-bound resume path for an exact pending configuration-only release when the approved override applied but the PATCH response was lost; it verifies the pending release intent, current ETag-backed setting, unchanged serving source/effective value, and operation quiescence, then submits the already approved same-source rollout once without reapplying configuration.

Validation: App Hosting operation-response and lost-response resume regression tests; full workflow validation and merge gate pending.
Deployment: no new backend patch in this implementation. Production currently has the previously approved override pending its same-source rollout; no Calendar writes.
