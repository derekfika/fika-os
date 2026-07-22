# Fika at MNK Hospitality Dashboard

Site-manager dashboard for MNK hospitality bookings.

This is a clone of the CFC hospitality dashboard with the same workflow and functionality: booking review, quote generation, calendar creation, confirmation email handling, printing, archiving, and settings-driven configuration.

## Project Structure

```text
00_config.js           MNK configuration defaults and Settings schema
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

1. Create a new Google Sheet for the MNK hospitality dashboard.
2. Create or connect a new Apps Script project for this folder.
3. Push this folder to that new Apps Script project.
4. Run the setup/test functions from Apps Script:
   - `ensureSettingsDefaults_()`
   - `runDashboardPureTests()`
   - `getDashboardLiveTestChecklist()`
   - Opening the dashboard, or calling `getDashboardSheet_()`, will initialise headers in an empty `Dashboard Data` tab.
5. Fill the generated `Settings` sheet with MNK values, especially:
   - `QUOTE_TEMPLATE_DOC_ID`
   - `QUOTE_ROOT_FOLDER_NAME`
   - `CALENDAR_ID`
   - `CALENDAR_ATTENDEES`
   - `PRINTER_EMAIL`
   - branding/logo URLs if required
6. Deploy as a web app for the site manager.

After both MNK Apps Script projects are linked and deployment IDs are filled in, `mnkpush.bat` can push, deploy, commit and Git push the MNK platform release.

## MNK Defaults

- App name: `Fika at MNK Hospitality Dashboard`
- Location name/code: `110 Bishopsgate, EC2N 4AY` / `MNK`
- Dashboard spreadsheet ID: `1GIGIh_oAY0yLrrlXPaSvHte2oMPT8S_dKFAYdZN6nuc`
- Quote/root folder fallback: `MNK Hospitality`
- Processed Gmail label fallback: `MNK_HOSPITALITY_PROCESSED`
- Default colours use the MNK blue palette.

`QUOTE_TEMPLATE_DOC_ID` is intentionally set to `REPLACE_WITH_MNK_QUOTE_TEMPLATE_DOC_ID` so the MNK dashboard cannot accidentally use the Angel Court quote template before settings are completed.

## Dashboard Compatibility

The MNK client booking platform can write into this dashboard's `Dashboard Data` tab using the existing `CLIENT_PLATFORM` source handling. The site manager dashboard can then process those requests through the same quote, calendar and confirmation workflow.

Required Google services:

- Gmail
- Google Drive
- Google Sheets
- Google Calendar

Required advanced services:

- Drive API
- Calendar API
