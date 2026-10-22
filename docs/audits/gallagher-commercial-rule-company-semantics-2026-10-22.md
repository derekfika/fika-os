# Gallagher commercial rule — booking company vs end client (separate issue)

Status: **open, intentionally not changed.** Raised during the Gallagher dashboard release; the dashboard visibility rule is unaffected.

## Observation

The Gallagher commercial/minimum-order rules (capped product minimums, 5-guest minimum, mandatory PO reference) are decided by:

- Apps Script (`sites/angel-court/booking-platform/02_BookingService.js`, `isGallagherBooking_`): `client.clientCompanyName` equals Gallagher (alphanumerics only) **or** `client.email` domain is `redington.co.uk`.
- Hub / Hospitality (`apps/integration-hub/lib/gallagher-rules.ts`, `apps/hospitality-booking/app/ui/BookingPortal.tsx`): company name equals Gallagher or email domain is `redington.co.uk`.

In the Apps Script form, `client.companyName` is "Your company" (the **booking** company) and `client.clientCompanyName` is "Client company" (the **end client**). The rule therefore keys on the **end client** field, not the booking company. In the FIKA OS portal the equivalent split is `requester.companyName` (booking company) versus `clientCompany` (end client); the portal must be checked to confirm which value feeds the rule.

## Consequences to confirm with the business

- A non-Redington booker making a booking *for* Gallagher as end client receives Gallagher minimums.
- A Gallagher-company booker from a non-Redington address making a booking for an external client does not receive Gallagher minimums.
- Redington-domain bookers always receive them (matches the dashboard rule for that condition).

## Decision needed

Whether the commercial rule should follow the customer-confirmed visibility rule (requester domain `redington.co.uk` OR **booking** company Gallagher). If so, change the Apps Script rule and the portal/Hub inputs together, with tests, as its own task. The dashboard release does not depend on this.
