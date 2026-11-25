# 2026-11-25 — Verify booked Studio dishes at quote and CPU handoff

Hub checks that every line with a published Studio selection has private evidence for its exact dish IDs, names, quantities and publication hash before saving a quote or sending it to CPU. Historical handoffs that predate customer dish selections retain their existing validation. The check uses records already read in each transaction.

Validation: Hub unit tests (1,132 passed, 134 skipped), typecheck, production build and all 63 Hub Firestore emulator cases passed. A final 13-case emulator rerun covered changed per-dish splits, missing version and line evidence, historical handoffs and replay.
Deployment: none.
