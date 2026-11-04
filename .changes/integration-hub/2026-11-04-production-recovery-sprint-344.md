# 2026-11-04 — Materialise scoped Menu destinations with allergen evidence

The canonical Production Order and atomic fulfilment handoff retain the explicit governed/one-off destination union, day-scoped identity, name, address, optional contact/instructions and exact quantities. Allergen declarations, server review evidence and notes survive unchanged. Replays and source amendments retain existing concurrency and withdrawal guards. No fake OPLOC records or data migration.

Validation: Weekly isolated Firestore publication/outbox/materialisation regression passed; broad Hub suite had only a missing pinned external-spec fixture, then the exact pinned address tests passed 15/15. Typecheck/build passed. Final integrated exact-source CI and staging UAT pending.

Deployment: not deployed; staging UAT and governed production readiness remain pending.
