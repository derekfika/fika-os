# 2026-10-29 — Munich RE portal: room/collection-point selector and site-aware minimums

The booking portal now resolves product minimums from the booking context (customer and site), so Munich RE shows, limits and validates the standard minimum of 5 while other sites keep 8. Munich RE replaces the free-text location with a selector of the seven form rooms and three collection points; rooms persist to roomOrArea and collection points to deliveryPoint, never both. Stacked on the Munich RE catalogue and minimum-override change.

Validation: full Hospitality Booking test suite (368) and typecheck pass; mnk-contract assertions updated. Not run: browser/UI walkthrough, Hospitality to CPU to Logistics end-to-end, staging UAT.
Deployment: none.
