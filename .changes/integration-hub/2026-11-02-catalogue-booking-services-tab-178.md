# 2026-11-02 — Hospitality Catalogue: Items | Booking Services tabs and guided RCoA category control (#178)

Replaces the hidden "Booking service categories (show)" disclosure with obvious Items | Booking Services tabs. Booking Services opens a guided site -> service -> category editor (e.g. RCoA -> Dining -> Wine) with a readable impact preview derived from the live rows and the effective published layout, an exact scope statement ("Only RCoA Dining"), inherited-company versus site-override explanation, required save reason, explicit scope confirmation and friendly success/conflict messages. It saves only through the existing governed `set-service-categories` command; the full company/all-services matrix remains under "advanced". The Item inspector gains "Where customers can order this" (effective booking services per permitted site) with a "Manage booking services" action that jumps into the tab with the site and category context.

No backend, auth, contract or per-Item service flag changes. Bulk editor reorganisation is not part of this slice.

Validation: new `hospitality-catalogue-ux.test.ts` (8 tests) and Hub `tsc --noEmit` passed. No browser verification yet.
Deployment: none. No live data changes.
