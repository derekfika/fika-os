# 2026-10-31 — Hub service-layout editor (slice 2a of #175)

Add an admin editor in the Hospitality Catalogue for the booking-service category layout: a category-by-service matrix for
the company default, a per-site override view (Inherits company / Overrides, Clear override), an ordered effective preview
with up/down reorder and a hidden-service toggle, and a mandatory reason (at least 8 characters) before each save. It uses
only the existing `set-service-categories` / `clear-service-override` commands with the per-document `expectedVersion`; a
stale version shows the existing message, discards the unsaved edits and reloads. Users without catalogue-manage see it
read-only. The admin catalogue payload gains an additive `serviceLayout` (stored company/site versions, 0 = nothing stored,
and the category vocabulary); the GET is a bounded read of the stored layout documents and does not publish or rebuild the
catalogue package. Rows are only seed + live catalogue + already-stored categories; categories in a layout with no live item
("Not in any item") and live categories in no company service ("Not offered by any service") are flagged but never added or
removed automatically. No categories, Items, prices, minimums, site permissions, amendments, bookings or portals change, and
no portal consumes the layout yet.

Validation: Hub focused tests (service-layout editor and provider, 15 pass), the layout emulator test on a local Firestore
emulator (4 pass), Hub typecheck, eslint on touched files, full Hub `npm test` and `next build`; see the PR for results.
Deployment: none.
