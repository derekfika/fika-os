# Hospitality Dashboard

A Google Apps Script application for managing hospitality bookings from emailed booking forms.

The dashboard automates the workflow from incoming booking request to quote generation, calendar creation and booking confirmation.

---

# Features

## Inbox Scanning

* Scans Gmail for XLSX booking forms
* Converts Excel files to Google Sheets
* Parses booking information automatically
* Prevents duplicate imports using Message ID + Attachment Name tracking

## Booking Management

* Dashboard view of all bookings
* Search and filtering
* Status tracking
* Inline editing
* Validation and error handling

## Quote Generation

* Generates PDF quotes
* Stores quotes in Google Drive
* Tracks quote status
* Flags stale quotes when bookings change

## Calendar Integration

* Creates CPU calendar events
* Attaches generated quote
* Attaches original booking form
* Supports configurable attendees

## Communication

* Sends booking confirmation emails
* Tracks confirmation status
* Stores confirmation metadata

## Archiving

* Automatically archives historic bookings
* Keeps complete booking history

---

# Architecture

```text
Gmail
 ↓
XLSX Booking Form
 ↓
Parser
 ↓
Booking Object
 ↓
Validation
 ↓
Dashboard Data Sheet
 ↓
Quote / Calendar / Confirmation
```

The Dashboard Data sheet is considered the primary source of truth.

All booking operations should originate from data stored in the dashboard rather than Gmail, Drive or Calendar.

---

# Project Structure

```text
00_Config.js           Configuration defaults
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

Index.html             Main application shell
Styles.html            Application styling
Script.html            Client-side application logic
Icons.html             SVG icon library
```

---

# Settings System

The dashboard uses a Settings sheet as the primary configuration source.

Examples:

* Branding
* Colours
* Fonts
* Calendar settings
* Quote settings
* Folder IDs
* Site-specific configuration

Code should use:

```javascript
getConfiguredValue_("SETTING_NAME", fallback)
```

rather than hard-coded values wherever possible.

---

# Multi-Site Strategy

The application is designed to support multiple hospitality locations.

The preferred approach is:

```text
Stable Dashboard
 ↓
Clone Apps Script Project
 ↓
Update Settings Sheet
 ↓
Deploy New Site
```

Site-specific behaviour should be driven by configuration rather than custom code wherever possible.

---

# Development Workflow

## Pull latest code

```bash
clasp pull
```

## Push changes

```bash
clasp push
```

## Git workflow

```bash
git status
git add .
git commit -m "Description of changes"
git push
```

---

# Versioning

Current version: v0.9.11

Version format:

```text
Major.Minor.Patch
```

Examples:

```text
v0.9.0
v0.9.1
v0.9.11
```

Minor versions indicate new functionality.

Patch versions indicate bug fixes, stability improvements and maintenance releases.

---

# Dependencies

Required Google Services:

* Gmail
* Google Drive
* Google Sheets
* Google Calendar

Required Advanced Services:

* Drive API
* Calendar API

---

# Testing

Run Apps Script tests using:

```javascript
runDashboardPureTests()
```

Manual testing checklist is available via:

```javascript
getDashboardLiveTestChecklist()
```

Recommended before each deployment:

* Inbox scan
* Parser validation
* Quote generation
* Calendar creation
* Confirmation email
* Booking edit workflow
* Archive workflow

---

# Known Limitations

* Parser targets the 58VE Hospitality Booking Form.
* Additional customer formats may require parser extensions.
* Dashboard is optimised for Google Workspace environments.
* Large inbox scans may require chunked processing.

---

# Future Roadmap

## v1.0

* Multi-site deployment support
* Additional booking form formats
* Enhanced reporting
* Operational audit logging

## Future

* Customer-facing booking portal
* CPU production platform
* Advanced workflow automation

---

Built for FIKA Hospitality Operations.

---

# 58VE Fork Setup

This folder is the 58 Victoria Embankment fork of the Angel Court dashboard.
Quote generation, calendar creation, confirmation emails, settings and the
dashboard workflow are unchanged. The parser is tailored to the supplied
`58VE Hospitality Booking Form (INT).xlsx`.

The parser maps:

* `Name:` to the booking host name
* `Email:` to the booking host email
* `Company Name:` to the client company
* `Date of event:` to the event date
* `Total Number of people:` to pax
* `Meeting Room number / Location:` to the dashboard Floor/Room field
* Positive values in `Number Required` to quote line items
* `Time Required`, or the first time written in `Comment`, to service time
* `GRAND NET TOTAL` to the booking total before management fee and VAT

The supplied example has no service time. It will therefore import as
`NEEDS_REVIEW` until a time is entered in the dashboard. This is intentional:
quote and calendar actions should not proceed with an unknown delivery time.

Bookings with an event date before today are archived immediately during
import, regardless of whether they would otherwise be `READY` or
`NEEDS_REVIEW`.

The inbox scanner validates workbook structure before import. It rejects
supplementary spreadsheets such as dietary lists, attendee lists, schedules,
price lists, uniform forms and blank booking templates. Accepted forms must
contain the hospitality-form identity fields, order-grid headers and grand
total structure, plus at least one selected line item.

Duplicate protection uses:

* Gmail message ID + attachment name
* SHA-256 attachment content hash, including forwarded copies
* A booking fingerprint based on event date, company, pax, service time and
  room/location

When a newer revision matches an existing booking fingerprint, the existing
dashboard row is updated instead of creating another booking. Existing quote
and calendar links are retained and marked stale.

Before deploying:

1. Create a new Google Sheet with the same `Dashboard Data` and `Settings`
   tabs/columns as the Angel Court dashboard.
2. Create the new Apps Script project and point clasp at this folder.
3. Set the site-specific Settings values, especially calendar ID, attendees,
   quote template ID, printer email and Drive folder name.
4. Run `initialiseDashboardSettings()`.
5. Run `runDashboardPureTests()`.
6. Import the supplied example form and confirm the parsed values before
   enabling the hourly inbox trigger.
