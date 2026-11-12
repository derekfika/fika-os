# 2026-11-12 — RCoA Calendar outbox inventory

Added a bounded, read-only AUTHMOD administrator endpoint that inventories every Hospitality Calendar outbox record, joins records to canonical bookings and Production Orders, resolves OPLOC identities, and reports the Scheduler's current query/claim eligibility. Malformed and orphaned records remain visible; the endpoint has no delivery, retry, or mutation capability.

Validation: focused inventory tests and Hub typecheck pass. Full Hub test/build and staging validation pending.
Deployment: none. Production outbox was not read or changed by this source change.
