# 2026-11-17 — RCoA historical commercial corrections

Added a historical RCoA commercial amendment path for standalone and grouped bookings. It preserves event/service and safety evidence, ordered source data, existing prices and quote revisions; prices newly added lines from the event-date catalogue; records reason, actor and before/after commercial evidence; and skips production, fulfilment, Calendar and notification handoffs. New-booking date cutoffs remain active. Retrospective additional charges now require a reason.

Validation: Hub and Hospitality typechecks; focused Hub workflow, group amendment and booking authorization tests; Firestore emulator test covering standalone/grouped historical corrections, the reproduced PAST_DELIVERY_DATE cutoff, preserved production/fulfilment evidence, quote history, price behavior and charge audit. Authenticated staging UI verification is blocked because no authenticated in-app browser session was available.
Deployment: none.
