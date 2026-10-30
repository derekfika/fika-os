# 2026-10-29 — Rotation dish mapping and hospitality-scoped picker

The Rotations picker no longer reads the whole Menu Planning Dish Library package, which was the source of the "options are unavailable" failure. `mode=resources` now returns real Hospitality catalogue Items (unchanged package source) plus only dishes whose scope is `HOSPITALITY_ROTATIONS` or `SHARED`, read by an indexed query, with each Item's linked dish. Failures name the failing dependency and are never turned into empty successes.

New Manage-only `link-dish` command persists one stable Item-to-dish mapping per Item (and per dish) under the rotation root, with transactional exclusivity, idempotent replay, archived/retired and scope checks. Publication also refuses dishes outside the allowed scopes. Access mode additionally reports the caller. Existing rotation IDs, revisions and the published/frozen contract are unchanged.

Validation: Hub typecheck, unit suite (one existing unrelated ADDR-001 doc test fails in this workspace because `fika-platform-specs` is absent) and the isolated Firestore emulator rotation suite including new mapping, race and scope cases.
Deployment: none.
