# 2026-11-05 — Preserve changelog fragments during workspace recovery

Governed workspace reconciliation now treats unique changelog fragments as scope-exempt during both preflight and successor validation, matching the repository's normal workspace policy. Recovery still transfers only captured source workspace data and retains the original checkout.

Validation: `workspace check` passed; focused regression passed; `node --test tools/workflow/reconcile-workspace.test.mjs` passed 14/14; `git diff --check` passed; exact-source `scope`, `tooling` and `Workflow / merge-gate` passed for implementation SHA `dcd2ddb56b0422e3c5bb0b4d45fcc48304614564` (run `42005260659`).
Deployment: none.
