# 2026-11-10 — Hot Fork Buffet menu preview and demand

Added an audited Hospitality-availability flag for saved rolling menu weeks and a read-only client-safe menu projection. Added bounded, OPLOC-scoped Hot Fork Buffet booking demand to Week and Portion Planner views. After portions are saved, Brian can confirm the live guest-count set considered for a date/site; the audit snapshot detects later guest-count or portion changes without editing quantities.

Validation: Menu Planning typecheck/build passed; rolling-menu suite passed (545 tests, 541 passed, 4 skipped), including availability and demand-snapshot tests. CPU allergen/publication regression tests passed (67 tests). Staging verification pending.
Deployment: none.
