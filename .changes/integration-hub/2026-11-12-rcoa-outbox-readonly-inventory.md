# 2026-11-12 — RCoA Calendar outbox inventory

Added a bounded, read-only AUTHMOD administrator endpoint that inventories every Hospitality Calendar outbox record, joins records to canonical bookings and Production Orders, resolves OPLOC identities, and reports the Scheduler's current query/claim eligibility. Malformed and orphaned records remain visible; the endpoint has no delivery, retry, or mutation capability.

Validation: focused inventory tests (4/4), changed-file ESLint, Hub typecheck, Hub production build, changelog check, and diff check pass. Full Hub suite: 1,047 passed, 122 skipped, 1 pre-existing failure because `address-workflow.test.ts` expects an absent `fika-platform-specs` sibling document. The same failure holds `fika validate` after its 163 workflow tests pass. Staging validation pending merge-gate CI.
Deployment: none. Production outbox was not read or changed by this source change.
