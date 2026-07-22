# Fika at MNK Hospitality Booking Platform

MNK version of the client-facing hospitality booking experience. It keeps the same Google Apps Script booking flow as the CFC platform, with MNK-specific branding, notice rules and menu items transcribed from `Fika at MNK_Hospitality Brochure_2026.pdf`.

## Architecture

- `00_Config.js` contains the MNK site identity, sheet names, notice rules, recipients and branding copy.
- `01_MenuData.js` contains the MNK brochure menu and pricing schema.
- `02_BookingService.js` validates submissions and rebuilds every price and total from the server-side schema.
- `03_SheetsService.js` adapts the client payload into the existing dashboard booking schema, writes a `READY` row to `Dashboard Data`, and stores structured line-item rows.
- `04_Webapp.js`, `Index.html`, `Styles.html` and `Script.html` provide the client experience.
- `05_TestHarness.js` contains pure service tests.

## Setup

1. Create or connect an Apps Script project to the MNK booking platform data spreadsheet: `1eR9J1x7VDOYtLT572burlr_GPIi4JPFoqopRpuyFJkQ`.
2. Copy this folder's files into that project.
3. Confirm `SITE_CONFIG.integration.bookingSpreadsheetId` is the booking platform data sheet: `1eR9J1x7VDOYtLT572burlr_GPIi4JPFoqopRpuyFJkQ`.
4. Confirm `SITE_CONFIG.integration.dashboardSpreadsheetId` is the dashboard data sheet: `1GIGIh_oAY0yLrrlXPaSvHte2oMPT8S_dKFAYdZN6nuc`.
5. Run `testBookingPlatformConnection()` and confirm it reports both spreadsheet names and finds `Dashboard Data` in the dashboard spreadsheet.
6. Run `setupBookingPlatformSheets()` once. It creates only the client line-item/settings sheets in the booking platform data spreadsheet, and initialises the dashboard headers if `Dashboard Data` is an empty tab.
7. Run `runBookingPlatformTests()` and confirm `ok: true`.
8. Deploy as a web app.

After both MNK Apps Script projects are linked and deployment IDs are filled in, `mnkpush.bat` can push, deploy, commit and Git push the MNK platform release.

## Branding settings

`setupBookingPlatformSheets()` creates a `Platform Settings` sheet in the booking platform data spreadsheet. Branding can then be changed without editing the app:

- `FIKA_LOGO_URL`
- `FIKA_LOGO_SVG`
- `FIKA_LOGO_ALT`
- `FIKA_FALLBACK_TEXT`
- `SITE_LOGO_URL`
- `SITE_LOGO_SVG`
- `SITE_LOGO_ALT`
- `SITE_FALLBACK_TEXT`
- hero copy and primary colours

Logo values should be direct, publicly readable HTTPS image URLs. When a URL is blank, inaccessible or fails to load, the header automatically shows the configured text wordmark instead.

## Booking rules

The brochure states:

- Minimum 72 hours notice, or 3 working days, for hospitality bookings.
- Up to 7 working days for larger or highly bespoke events.
- Allergies and dietary requirements should be provided at the time of booking.
- Indicative prices exclude VAT and may change if labour or hire equipment is required.

## Dashboard compatibility

Successful submissions are written to the dashboard spreadsheet's `Dashboard Data` tab with:

- `Status = READY`
- the dashboard's existing `ParsedJSON` booking shape
- quote-compatible line items using `section`, `name`, `qty`, `time`, `info`, `detail` and `comment`
- the existing 8% management fee and 20% VAT calculations
- `sourceType = CLIENT_PLATFORM`
- the complete client booking payload nested at `clientBooking`

Prices and menu wording were transcribed from the Fika at MNK Hospitality Brochure 2026 PDF. Items marked as menu-on-request remain selectable so clients can request them, but the team should confirm final details before accepting the booking.
