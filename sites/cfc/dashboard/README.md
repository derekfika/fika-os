# CFC Hospitality Dashboard

Site-manager dashboard for CFC hospitality bookings.

This is a clone of the Angel Court hospitality dashboard with the same workflow and functionality: booking review, quote generation, calendar creation, confirmation email handling, printing, archiving, and settings-driven configuration.

## Project Structure

```text
00_config.js           CFC configuration defaults and Settings schema
02_Schema.js           Booking schema and validation
03_Utils.js            Utility helpers
04_Parser.js           Booking form parser
05_GmailScanner.js     Inbox scanning and import
06_DataLayer.js        Sheet read/write operations
07_Webapp.js           Server-side web app functions
08_DriveHelper.js      XLSX conversion helpers
09_QuoteEngine.js      Quote generation
10_Calendar.js         Calendar integration
11_Triggers.js         Scheduled tasks
12_TestHarness.js      Automated tests
13_Feedback.js         Feedback support

Index.html             Main application shell
Styles.html            Application styling
Script.html            Client-side application logic
Icons.html             SVG icon library
```

## Setup

1. Create a new Google Sheet for the CFC hospitality dashboard.
2. Create or connect a new Apps Script project for this folder.
3. Push this folder to that new Apps Script project.
4. Run the setup/test functions from Apps Script:
   - `ensureSettingsDefaults_()`
   - `runDashboardPureTests()`
   - `getDashboardLiveTestChecklist()`
5. Fill the generated `Settings` sheet with CFC values, especially:
   - `QUOTE_TEMPLATE_DOC_ID`
   - `QUOTE_ROOT_FOLDER_NAME`
   - `CALENDAR_ID`
   - `CALENDAR_ATTENDEES`
   - `PRINTER_EMAIL`
   - branding/logo URLs if required
6. Deploy as a web app for the site manager.

## CFC Defaults

- App name: `CFC Hospitality Dashboard`
- Location name/code: `CFC`
- Quote/root folder fallback: `CFC Hospitality`
- Processed Gmail label fallback: `CFC_HOSPITALITY_PROCESSED`
- Default colours use the CFC blue palette.

`QUOTE_TEMPLATE_DOC_ID` is intentionally set to `REPLACE_WITH_CFC_QUOTE_TEMPLATE_DOC_ID` so the CFC dashboard cannot accidentally use the Angel Court quote template before settings are completed.

## Dashboard Compatibility

The CFC client booking platform can write into this dashboard's `Dashboard Data` tab using the existing `CLIENT_PLATFORM` source handling. The site manager dashboard can then process those requests through the same quote, calendar and confirmation workflow.

Required Google services:

- Gmail
- Google Drive
- Google Sheets
- Google Calendar

Required advanced services:

- Drive API
- Calendar API
