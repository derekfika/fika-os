# Gallagher Booking Dashboard

`/angel-court/gallagher` is a customer-facing, read-only view in the existing Hospitality app. Booking changes remain with the on-site manager.

## Data sources and mapping

- Legacy source: the Apps Script-bound Google spreadsheet titled **Dashboard Data**, tab **Dashboard Data**. The Hospitality runtime reads it through the Google Sheets API; the browser never receives the spreadsheet ID, OAuth token, source rows, or credentials.
- FIKA OS source: Integration Hub's canonical `fikaBookings` collection, queried by the exact `service.portalSiteId == "angel-court"` key. A narrow read-only Hub API returns only matching Gallagher/Redington records to Hospitality over the server-to-server bridge.
- Legacy reference: `BookingID`. Company/contact: `ClientCompany`, `HostName`, `HostEmail`. Service: `EventDate`, `ServiceTimes`, `Pax`, `ItemsJSON`/`ParsedJSON`, `Location`, `Floor`. Invoice reference: `InvoiceReference`. State and cancellation: `Status` plus cancellation evidence inside `ParsedJSON`. Created/updated: `CreatedAt`, `UpdatedAt`.
- Legacy amount: `GrossPrice` is the stored quote total to pay (management fee plus VAT). `TotalPrice` is the item subtotal before the management fee and VAT. The dashboard displays the stored gross amount and never re-prices historical bookings.
- FIKA OS amount: use the stored gross total in the current quote revision snapshot when available, otherwise the stored canonical `order.grossTotal`. No current catalogue values are read or applied.
- Include rule: normalized company exactly `Gallagher`, or the exact requester email domain `redington.co.uk`, case-insensitively. Both checks are whitespace-normalized; email subdomains do not match.
- Dedupe: an exact legacy `BookingID` match to canonical `sourceBookingId`, or an explicit migration provenance reference, collapses to the FIKA OS row. No fuzzy matching is used. The current schema contains no general legacy-to-canonical link, so historical records without one remain separate until explicit provenance is recorded.

## Server-only configuration

The staging App Hosting manifests list secret references only. Provision staging values in the `fika-os-dev` Secret Manager project before deploying:

| Secret | Value |
| --- | --- |
| `GALLAGHER_DASHBOARD_PIN_HASH` | Scrypt verifier produced by `npm --prefix apps/hospitality-booking run gallagher:pin-hash`; store only this verifier, never the PIN. |
| `GALLAGHER_DASHBOARD_SESSION_SECRET` | At least 32 random bytes encoded as a string. |
| `GALLAGHER_DASHBOARD_BRIDGE_TOKEN` | One random staging-only token shared by Hospitality and Integration Hub. |
| `GALLAGHER_LEGACY_SHEET_ID` | The bound source spreadsheet ID. Keep it server-side. |
| `GALLAGHER_SHEETS_IMPERSONATED_USER` | Workspace user with read access to the bound spreadsheet. |

The existing `GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON` remains server-side. Domain-wide delegation must approve `https://www.googleapis.com/auth/spreadsheets.readonly` in addition to the currently used Drive scope. No Sheets write scope is requested.

Production must provision separate values for the same five secret names and approve the Sheets read-only DWD scope before a future production rollout. This document is a configuration placeholder only; no production secrets have been created and this feature must not be deployed to production.

## Session and read behaviour

- PIN verification uses a salted scrypt verifier. The six-hour HMAC-signed session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, host-only, and scoped to `/angel-court/gallagher`.
- Failed attempts are limited to five per client address per 15-minute in-process window. Each instance also bounds its failure-key map. This is an in-memory guard, so App Hosting instance replacement resets its counter; a future global limiter would require a shared rate-limit store.
- Only `GET /angel-court/gallagher/data` returns dashboard records, and it verifies the signed session before either upstream read. Login and sign-out are the only write-method routes beneath this customer surface.
- The legacy Sheet response is limited to 5,000 data rows and cached for up to 60 seconds after a successful read. Concurrent cold reads are coalesced; a failed refresh is not served from stale cache.
- The Hub query reads at most 501 Angel Court documents and fails explicitly if more than 500 are present. No whole Firestore collection scan or client-side Sheet scan is used.

## Secret setup example

Generate a PIN verifier interactively (the PIN is not echoed):

```powershell
npm --prefix apps/hospitality-booking run gallagher:pin-hash
```

Store the printed verifier in `GALLAGHER_DASHBOARD_PIN_HASH`. Generate the session secret and bridge token independently with a cryptographically secure random generator. Configure the same staging bridge token for Hospitality and Integration Hub; use different values for production.
