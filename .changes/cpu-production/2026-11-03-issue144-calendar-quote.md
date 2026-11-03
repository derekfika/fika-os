# 2026-11-03 — Stable CPUX Calendar quote link and amendment identity (#144)

Eligible Hospitality Sandwiches events link to an authenticated FIKA resolver for the existing current quote PDF. Amendments preserve that link and the original handoff's Calendar event identity while retaining immutable quote revisions. Shared lineage claims and generation/version checks prevent old cancellation retries from overwriting replacement orders. Immediate delivery now receives the actual durable outbox ID; unfinished attempts retry that same record without creating duplicates.

Boundaries: one-way outbound Calendar publication only; no reverse importer, Drive mutation, production-order rewrite or change to default-off/production-only guards. Existing Google Drive permissions still apply. No new scheduler or audit writes; existing per-version outbox/state writes remain, with bounded Hub reads for quote verification.

Validation: 20 focused CPU publisher/quote-route tests; CPU typecheck and production build using the demo project and closed loopback emulator endpoint. Google calls are mocked; HTTP tests assert zero upstream/Firestore operations in staging, development and test. No live Calendar/Drive UAT, full suite, migration or backfill executed.

Deployment: none; publishing/backfill flags remain disabled.
