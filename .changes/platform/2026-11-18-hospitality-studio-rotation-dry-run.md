# 2026-11-18 — Hospitality Menu Studio legacy Rotations dry run

Add an offline inventory planner for explicit legacy Rotations snapshots. It checks source hashes and lineage, verifies catalogue identity and both link directions, and reports historical references, inactive draft candidates and unresolved activation evidence. It creates no operational state.

Validation: Nine offline planner and CLI tests passed on synthetic exports under Node.js 22.18 and 24.21. Governed changelog and diff checks passed. Dedicated CI runs the planner suite against the exact PR head when its inputs change.
Deployment: None.
