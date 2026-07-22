# One Angel Court Hospitality Booking Platform

Angel Court v1 of the client-facing booking experience. This is a separate Google Apps Script project that writes dashboard-compatible bookings directly into the Angel Court Hospitality Dashboard spreadsheet.

## Architecture

- `00_Config.js` contains the site identity, sheet names, notice rules, recipients and branding copy.
- `01_MenuData.js` contains the complete menu and pricing schema.
- `02_BookingService.js` validates submissions and rebuilds every price and total from the server-side schema.
- `03_SheetsService.js` adapts the richer client payload into the existing dashboard booking schema, writes a `READY` row to `Dashboard Data`, and stores structured line-item rows.
- `04_Webapp.js`, `Index.html`, `Styles.html` and `Script.html` provide the client experience.
- `05_TestHarness.js` contains pure service tests.

To fork for another site, change `SITE_CONFIG`, `MENU_SCHEMA`, branding assets/copy, sheet mapping, notice rules and notification recipients. Core booking and UI logic should not require changes.

## Setup

1. Create or connect an Apps Script project to the Angel Court dashboard spreadsheet.
2. Copy this folder's files into that project.
3. Run `setDashboardSpreadsheetId("FULL_GOOGLE_SHEETS_URL_OR_ID")` once. This stores the connection in Script Properties and avoids requiring a new deployment when the ID changes.
4. Run `testBookingPlatformConnection()` and confirm it reports the correct spreadsheet and finds `Dashboard Data`.
5. Confirm `SITE_CONFIG.integration.dashboardSheetName` matches the existing dashboard data tab.
6. Run `setupBookingPlatformSheets()` once. It validates the dashboard headers and creates only the client line-item/settings sheets.
7. Run `runBookingPlatformTests()` and confirm `ok: true`.
8. Deploy as a web app.

Use the spreadsheet ID between `/d/` and `/edit` in the Google Sheets URL. Do not use the numeric `gid` after `#gid=`, which identifies only an individual tab.

## Branding settings

`setupBookingPlatformSheets()` creates a `Platform Settings` sheet. Branding can then be changed without editing the app:

- `SITE_LOGO_URL`
- `SITE_LOGO_SVG`
- `SITE_LOGO_ALT`
- `SITE_FALLBACK_TEXT`
- `SITE_LOGO_URL`
- `SITE_LOGO_SVG`
- `SITE_LOGO_ALT`
- `SITE_FALLBACK_TEXT`
- hero copy and primary colours

Logo values should be direct, publicly readable HTTPS image URLs. When a URL is blank, inaccessible or fails to load, the header automatically shows the configured text wordmark instead.

## New booking notifications

Set these values in `Platform Settings`:

- `SITE_EMAIL_ADDRESS`: the primary site-manager inbox. This is the main value to change when forking the platform for another site.
- `NOTIFICATION_RECIPIENTS`: optional additional recipients.
- `DASHBOARD_URL`: optional deployed hospitality dashboard URL. If blank, the spreadsheet URL is used.

Once a booking has been written successfully to `Dashboard Data`, the platform sends a concise manager notification containing the booking reference, company, date, time, guest count, estimated total and dashboard link. Email failure is logged but never rolls back or hides a successfully saved booking.

## Invoice references

Clients can optionally enter an invoice, purchase-order, cost-centre or internal reference. It is stored in the canonical booking JSON as `client.invoiceReference`, mapped to `invoiceReference` in the dashboard booking, included in dashboard notes and notification emails, and exposed to quote templates as either `<INVOICEREFERENCE>` or `<INVOICE_REFERENCE>`.

## Dashboard compatibility

Successful submissions are written to `Dashboard Data` with:

- `Status = READY`
- the dashboard's existing `ParsedJSON` booking shape
- quote-compatible line items using `section`, `name`, `qty`, `time`, `info`, `detail` and `comment`
- the existing 8% management fee and 20% VAT calculations
- `sourceType = CLIENT_PLATFORM`, allowing the dashboard calendar workflow to skip the Gmail/XLSX attachment lookup
- the complete client booking payload nested at `clientBooking`

The root dashboard's `10_Calendar.js` must include the accompanying client-platform source handling so calendar creation attaches the quote without trying to retrieve an email attachment.

Calendar events include a canonical `Booking Object - <booking-id>.json` Drive file alongside the quote. The file is updated after calendar creation so its status and calendar IDs remain current. The CPU dashboard reads this JSON first and uses quote or original-form parsing only as a fallback.

Prices and menu wording were transcribed from `Angel Court_Booking Form (2).xlsx`. Summer Rolls remain unavailable because the source workbook provides no orderable price.

