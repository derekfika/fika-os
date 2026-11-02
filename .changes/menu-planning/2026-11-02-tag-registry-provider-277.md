# 2026-11-02 — Share the versioned tag registry between editing surfaces

Add a memory-only, identity-scoped 60-second tag registry client with in-flight
deduplication, minimum-version checks and explicit invalidation after tag creation
or conflict. Dish Editor adopts it; the #277 planner consumer follows separately.
Reuse the Firestore client per project without caching authoritative registry data.
Expose Server-Timing and opt-in setup/document-read timings without audit writes.

Validation: four focused client regression tests and Menu typecheck passed.
Full suite/build and exact-source CI are recorded on the PR.
Deployment: none. No production data, permissions or publication changes.
