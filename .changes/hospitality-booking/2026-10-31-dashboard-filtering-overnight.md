# 2026-10-31 — Consistent dashboard filtering and mixed booking ordering

Dashboard summary cards now count the same filtered standalone bookings and groups used by the list and calendar. The queue preserves the combined selected sort instead of placing every group before standalone bookings. Existing accessible status/date chips, reset, cancelled history and site-locked visibility remain available. Search also matches already-loaded canonical site/OPLOC fields, including loaded group children; status and recorded creation-time sorting are available, with missing timestamps last.

No shared contract, authorization, API query, booking mutation, rotation behavior or downstream handoff changed. Rotation/category/fulfilment-stage filters and cross-site switching are not introduced: they need a separately scoped common loaded contract. No additional recurring reads, writes or audit events.

Validation: focused dashboard/group/surface tests (30 passed), full Hospitality tests (392 passed), typecheck and production build passed. Scope, affected-app, changelog and whitespace checks passed. The broad local governed run was stopped in duplicate workspace fixtures at owner direction; exact-source hosted CI supplies the full gate. Style Guide compliance: PASS; existing semantic controls, focus and responsive styles are reused.
Deployment: none; no staging or production writes.
