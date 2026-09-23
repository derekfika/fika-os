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
* Detects cancellations inside the configured 72-hour policy window
* Requires a manager charge decision for inside-window cancellations
* Sends neutral no-charge, partial-charge or full-charge cancellation wording
* Stores cancellation timing, actor, charge and email-variant audit facts in `ParsedJSON`

Cancellation detection uses the booking service date and first canonical service time in the dashboard timezone. The boundary is strict: `hours until service < window hours` is inside the window, so exactly 72 hours is outside. Past service starts are inside the late-cancellation state. Historical rows without the new fields remain readable; invalid or missing service timing fails cancellation safely rather than guessing.

Booking confirmation emails include a `Changes & cancellations` section using the same configured policy copy and retain the confirmed/scheduled lifecycle wording.

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

* Parser currently targets Angel Court booking forms.
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
