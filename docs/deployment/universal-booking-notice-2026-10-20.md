# Universal minimum Hospitality booking notice — 20 October 2026

Status: implemented and locally validated; NOT DEPLOYED. No production mutations, catalogue publication, booking migration, email or operational actions in this task. A read-only pre-push check confirmed Hub and Hospitality automatic production rollout remains disabled.

## Ownership and baseline
Started from fetched origin/main `5e4b10de68fb852bb5c9bb462b4414a6d1bedd99`, fast-forwarded the clean main checkout to include Claude's two booking-form UI commits. Derek confirmed exclusive ownership here of shared policy, backend enforcement and associated tests; Claude owns BookingDatePicker, BookingPortal, RcoaBookingPortal, styles and lib/booking-notice.ts. None of those UI/wording files were edited here. Derek will coordinate the separate visible wording change from Sandwich orders to Orders and BOOKING_NOTICE handling. No new branch or worktree.

## Provider contract and consumers
The provider is packages/server-shared/src/hospitality-booking-cutoffs.ts, exported through hospitality-effective-offering. Direct consumers are Integration Hub and Hospitality Booking. All five generic/site Node portals, RCoA single/All Day, and active standalone/group staff amendment calendars already call this shared policy; no second policy or UI implementation is added.

`earliestBookingDelivery` supplies the minimum for every basket, including empty/non-sandwich baskets. Before UK noon count two subsequent preparation days; from noon count three. Saturday does not count, Sunday does; deliveries remain weekdays subject to site restrictions. This is calendar-day counting, not 48/72 elapsed hours. Generic failure code is BOOKING_NOTICE with Too soon for this booking and earliestDate. The old earliestSandwichDelivery and SANDWICH_NOTICE export names remain compatibility aliases. Item-specific sandwich classification remains only for established short-hour compatibility and does not control whether the universal minimum applies.

All existing stricter product-hour/day, event, site and Friday Summer Roll restrictions remain. Product notice errors retain PRODUCT_NOTICE. No catalogue/price/minimum/availability/schema or package metadata mutation is required.

Hub already calls the policy inside new-booking and material-amendment transactions before writes. Amendment detection now includes guest counts, end times and operational destination fields as material, as well as date/start time/event type/items/quantities/choices. Contact/notes-only edits and exact persisted retries remain exempt from revalidation. Missing and empty optional service fields compare consistently to avoid false material changes. Both group and standalone amendments share the same boundary; no AUTHMOD, audit, outbox or concurrency protection weakened.

## Validation
- Hospitality focused regression: 86/86 PASS, including all date vectors across empty/non-sandwich/sandwich baskets at all five sites, before/exact/after noon, the specified Tuesday 18:30 case, weekends, Sunday preparation, UK DST, stricter requirements and actual shared-calendar empty-basket rendering. RCoA All Day test strengthened to use only non-sandwich drinks and a frozen 20 October afternoon clock with a 22 October future service: zero writes for new/missing children; stored children retry without duplicate notifications. That final strengthened test was rerun separately and passed.
- Hub focused unit suites: 45/45 PASS.
- Actual POST-route isolated Firestore emulator regression: PASS. Non-sandwich and sandwich new bookings reject before any persistence; empty-basket helper rejects; valid future non-sandwich booking works; standalone/group material edits reject atomically; exact historical retries leave the full store unchanged; historical notes-only edit remains allowed; guest/window/destination edits revalidate; strict products and merged Friday identities retain safeguards.
- Six existing Hub amendment/concurrency emulator regressions: 6/6 PASS (no-op save, standalone CPU amendment, concurrent/atomic group changes, stale/auth/membership failures, after-CPU retirement/retry).
- Hub and Hospitality typechecks PASS. Both production builds PASS. Hospitality typecheck rerun after the final test-clock refinement PASS. No full repository suite or unrelated app builds.
- Local tests used demo-fika-os, 127.0.0.1:8292 only; owned emulator stopped. Hub uses an installed file dependency copy, which was stale on the first run; refreshed the ignored local shared-policy file from repository source and verified equal SHA-256 before successful rerun. No dependency/lockfile change. A pre-existing merged-Item fixture needed its future date restored after the historical fixture was strengthened; no runtime safeguard weakened.
- Build-generated next-env and brand-asset changes were restored to their pre-build tracked state; no UI/assets included in this change.
- Style Guide compliance: PASS for unchanged shared calendar/error rendering; no layout/style changes. No fresh browser journey claimed.

## Release impact
Requires explicit approval for a coordinated Integration Hub then Hospitality release at the final reviewed SHA, together with Claude's separately reviewed wording change. No deployment performed. Existing catalogue packages/cache versions remain compatible; no package rebuild, canonical catalogue migration or CPU/Logistics deployment is required for this code-only universal minimum. Production behaviour is unchanged until approved rollout.

Firestore read shape and recurring cost are unchanged: existing bounded transaction catalogue reads, no new queries/listeners/polling, no extra audit writes. The extra amendment comparison is in memory. Rejected requests still write nothing; existing successful-mutation audit/outbox evidence remains atomic.
