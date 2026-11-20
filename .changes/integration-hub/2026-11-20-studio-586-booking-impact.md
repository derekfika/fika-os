# 2026-11-20 — Read canonical future booking impact for Menu Studio

Read a bounded event-date window of confirmed canonical bookings for separately authorised Studio managers and company booking administrators. Return only governed booking, site and selection references. Missing dish evidence remains partial. The report makes no booking or downstream writes.

Validation: 12 focused tests, one isolated Firestore test, Hub typecheck and production build passed.
Deployment: none.
