# 2026-10-28 — Hospitality Rotations foundation and authorised API

Adds revisioned company rotation configuration, one shared London calendar, dated immutable seasonal publications, bounded canonical Dish Library/Item verification and frozen recipe evidence. Separate explicit AUTHMOD View, Manage and Publish grants protect reads, edits and activation. Transactions preserve optimistic concurrency, actor-bound retry receipts and audit lineage. No booking, catalogue, dish or production authority is replaced.

The implementation contract and Luna handoff are in `docs/architecture/hospitality-rotations.md`. Booking confirmation/amendment integration, customer exposure and canonical dish-level CPU handoff remain explicit dependencies. No identities are hard-coded or live assignments changed.

Validation: focused calendar/rule/reference/AUTHMOD tests and dedicated synthetic Firestore HTTP/transaction suite passed; Hub typecheck and production build passed. Initial full Hub suite: 824 passed, 102 skipped, one missing pinned-specification fixture; pinned source dependency subsequently fetched for verification. Final regression and exact-source CI evidence is recorded in the PR/task report. Dedicated persistence suite requires its documented explicit isolated-emulator command; the existing emulator script does not enumerate it.
Deployment: none. No live data changes, migrations, merge, emails or operational demand.
