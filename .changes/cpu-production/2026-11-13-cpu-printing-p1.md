# 2026-11-13 — CPU signed allergen PDF access and totals print verification

Added a scoped CPU card action that serves only the existing PDF for the current, dual-signed, lineage-matched allergen release. The server enforces CPU session and OPLOC scope, uses the governed Drive owner, checks the file hash and fails closed for unavailable or invalid evidence. Production Totals remains the merged PR #521 implementation.

Validation: signed-document/route tests (8/8), A4 print tests (16/16), responsive selection-dialog browser test (1/1), typecheck and production build passed. The full CPU suite did not complete: its `cpu-consumer-invalidation.test.ts` and `cpu-durable-outbox.test.ts` child processes stalled without output and the run was stopped. Authenticated staging and production verification remain pending governed release and Drive-isolation UAT.
Deployment: none.
