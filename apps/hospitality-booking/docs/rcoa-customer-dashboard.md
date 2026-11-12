# RCoA customer booking dashboard

The read-only customer dashboard is `/rcoa/bookings` in the existing Hospitality app. The public booking workflow remains `/rcoa`; the dashboard's **New booking** link opens that route. Both RCoA and Gallagher use the shared `CustomerBookingsDashboard` ledger presentation, while their routes, providers, PINs, signing keys, cookies, and Hub bridge tokens remain independent.

## Access and secret configuration

The RCoA route is noindex and returns booking data only after a valid six-hour session. RCoA sessions use a 4–12 digit scrypt PIN verifier, a 32-byte-or-longer signing secret, an `HttpOnly; Secure; SameSite=Lax` host-only cookie scoped to `/rcoa/bookings`, and a separate Hub bridge token. The owner can set a custom PIN through `scripts/rcoa-dashboard-pin-setup.mjs`; terminal input is hidden, the PIN must be confirmed, and only its salted scrypt hash is written to Secret Manager. Configure `RCOA_DASHBOARD_PIN_HASH`, `RCOA_DASHBOARD_SESSION_SECRET`, and `RCOA_DASHBOARD_BRIDGE_TOKEN` as runtime Secret Manager values for Hospitality. Configure the same per-environment bridge token for Integration Hub. Staging and production values must be different; none belong in source control or browser bundles.

The included App Hosting manifests declare secret references only. The local setup command writes only the salted PIN verifier to the selected environment; session and bridge secrets are provisioned separately. This does not grant client access or enable customer invitations. Production deployment and customer access remain separate owner decisions.

Failed login attempts are limited to five per rightmost forwarded address per 15-minute window, with an instance-wide ceiling of 60 failures per window and a bounded in-memory key map. App Hosting instance replacement resets these local counters; this follows the existing Gallagher session model and is not a globally shared rate-limit service.

## Data boundary

Integration Hub owns the canonical read and returns only service reference, event type/date/time, room/location, guest count, persisted lifecycle status, an amended marker, All Day group metadata, and item names/quantities. It never forwards customer identities, prices, PO/invoice values, customer notes, internal notes, allergen data, audit history, attachments, or cross-site records. The Hospitality endpoint validates the narrow response shape and strips internal group identifiers before returning grouped rows to the browser.

The Hub requires exactly one confirmed `provider-location` source mapping for `sourceIdentifier: "rcoa"`. It queries `fikaBookings` by `service.portalSiteId == "rcoa"`, verifies every returned row's `service.oplocId` against that mapping, and reads in pages of 400 with an 8,000-record total bound. A mapping mismatch, incomplete All Day group, pagination failure, or result beyond the bound fails visibly; the endpoint does not silently omit records. It performs bounded server reads per dashboard request without caching or client-side Firestore access.

All Day child services are grouped into one table row and shown individually in details. Guest counts are not summed across services. A group must contain all expected sequences on one service date; duplicate references and incomplete groups fail visibly. Completed and cancelled counts use persisted lifecycle values. Amendment display is derived to a boolean from canonical amendment evidence; the underlying audit history is never returned.

## Visibility awaiting approval

Until RCoA site-wide visibility is approved, the projection and UI omit booker names, contact information, companies, prices/spend, PO or invoice references, and customer-entered notes. The search and table therefore cover permitted references, services, items, locations, dates, and statuses; there is no booker filter. The UI config can enable additional safe fields in a later approved revision without changing its ledger interactions.

The dashboard remains view-only. Amendments, cancellations, quotes, production handoffs, and other booking lifecycle actions stay in existing Hospitality workflows.
