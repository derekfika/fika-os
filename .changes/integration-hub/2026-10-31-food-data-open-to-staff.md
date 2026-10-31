# 2026-10-31 — Food Data: open to all signed-in staff, no dedicated grant

Follow-up to the Kafoodle Food Data libraries. Removes the `integration-hub / food-data.catalogue / View` AUTHMOD authority requirement: any authenticated, active person (staff) account can read both libraries, via the normal session. Shared operational/site accounts, inactive identities and signed-out callers are still refused before any bucket read. Both endpoints drop the per-request grant lookup; the launcher shows the Food Data tile to every signed-in person; the access-denied copy no longer mentions grants. Identity-scoped IndexedDB caching, logout clearing, private GCS access, staging-only enablement and zero catalogue Firestore reads are unchanged, and no broader Hub or AUTHMOD access is conferred.

Validation: 33 Food Data tests pass (grant tests replaced by session-only and non-staff refusal tests, plus a guard that no grant lookup remains), Hub typecheck.
Deployment: pending (Hub staging, coordinated with the staging release owner).
