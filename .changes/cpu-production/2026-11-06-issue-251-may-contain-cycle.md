# 2026-11-06 — Restore named allergen May Contain cycle

Named cells in the Hospitality order-detail checker now cycle white/unrecorded → black/Contains → hatched/May Contain → white. No Key remains a deliberate binary declaration, existing review reopening and signed-authority locks are unchanged, and blank rows remain unverified.

Validation: focused allergen review and cell-state tests (35/35), CPU typecheck, and production build passed. Authenticated staging UAT and deployment not performed; this issue does not authorize staging or production writes.
Deployment: none.
