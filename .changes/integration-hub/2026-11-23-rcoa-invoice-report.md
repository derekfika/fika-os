# 2026-11-23 — RCoA invoice summary authority and data

Adds a bounded, audited RCoA booking read for invoice reporting, checks current saved quote totals, and requires explicit site-scoped Hospitality Invoice Report authority or existing Hospitality Admin authority. Unsupported financial rows are surfaced for review and excluded from the subtotal.

Validation: focused invoice report tests 10/10 passed; Hub typecheck and production build passed. Full Hub tests passed 1,126 with 131 emulator tests skipped and one unrelated address workflow failure because the sibling `fika-platform-specs` checkout is unavailable. Full-app ESLint reports existing errors; changed report/authority files pass targeted lint, while `AccountDetail.tsx` has pre-existing hook warnings.
Deployment: none.
