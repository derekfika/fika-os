# 2026-11-04 — Enforce CPU destination scope in production and review routes

CPU production reads and writes now use trusted Hub destination scope. Historical governed aliases are resolved in bounded batches through Hub authority before filtering; one-off keys never enter that lookup. Site-scoped staff receive only permitted governed rows and cannot fetch or mutate another site's order or a one-off destination; globally scoped staff retain one-off access. Diagnostic/change feeds require global scope. Projection summaries are recalculated for filtered rows, and the filtered response omits the full projection content hash while retaining the source package manifest for freshness checks. The local cache key changes when access scope changes.

Validation: route regression with site/global Hub access, historical alias, direct/queue/projection/review/mutation checks and actual cold/warm allergen projection loader; isolated cancellation emulator regression; CPU focused tests, typecheck and Next.js build passed.

Deployment: none.
