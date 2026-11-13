# 2026-11-13 — Remove buffet demand from Menu Planning

Removed the Hot Fork Buffet demand proxy, Week and Portion Planner demand panels, and the allocation-confirmation command. Buffet bookings use the existing Hospitality-to-CPU Production Order handoff directly. Historical stored week evidence remains available for audit but is no longer projected into active Menu Planning responses.

Validation: 54 rolling-menu regression tests, full Menu Planning suite (556 passed, four skipped), typecheck and production build passed. No migration, deletion of stored weeks, or allocation write.

Deployment: none.
