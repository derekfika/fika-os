# 2026-11-04 — Preserve one-off identity in portion drafts

Portion draft reconciliation distinguishes recorded one-off identities from governed OPLOCs even when their display names are equal. Historical allocations without identities retain compatible display matching. No data migration or operational writes.

Validation: six focused identity/rename/collision/historical/zero/blank regressions passed, Menu typecheck and production build passed; governed scope and changelog checks passed. Exact-source CI is required before integration.
Deployment: not deployed; support for recovery sprint #344.
