# Changelog

All notable changes to the Hospitality Dashboard project will be documented in this file.

## v0.11.5-58VE - Booking Rescan

* Added a Rescan booking form button to the edit view.
* Rescans the original Gmail XLSX using the latest parser and updates the same
  dashboard row.
* Preserves booking ID, original form, quote, calendar and lifecycle metadata.
* Marks existing quote and calendar output stale when parsed content changes.

## v0.11.4-58VE - Time Range & Rollover Fix

* Normalised Excel elapsed-time values greater than 24 hours back to clock
  time, for example `42:00` to `18:00`.
* Rejected invalid minute values.

## v0.11.3-58VE - Service Time Range Fix

* Time ranges now use the starting time instead of the ending time.
* Supports compact, spaced, en-dash and 24-hour ranges.
* Supports shared meridians such as `6-10pm` and noon-crossing ranges such as
  `11-1pm`.

## v0.11.2-58VE - Booking ID Repair

* Corrected booking ID generation to use `LOCATION_SHORT_CODE`.
* Sanitised the configured short code and added a guaranteed `58VE` fallback.
* Added `repairUndefinedBookingIds()` and a spreadsheet menu action to repair
  existing `undefined-...` IDs.

## v0.11.1-58VE - Scanner Performance Update

* Cached Settings values for each Apps Script execution.
* Reduced Dashboard Data reads to one index build per scan chunk.
* Reused Gmail message and attachment objects instead of fetching them twice.
* Rejected exact forwarded-file duplicates by hash before Drive conversion.
* Reused in-memory source, hash and booking-fingerprint indexes throughout a chunk.

## v0.11.0-58VE - Robust Scanner & Deduplication

### Added

* Structural validation before importing XLSX attachments.
* Attachment content hashing and semantic booking fingerprints.
* Revision-aware updates for newer copies of an existing booking.
* Original booking form, quote and calendar links in the edit view.
* Visible application version in the dashboard header.

### Fixed

* Rejected unrelated spreadsheets and blank booking templates.
* Recovered event dates from attachment filenames and email subjects.
* Read room/location values placed beneath their form label.
* Corrected 58VE booking ID generation.
* Archived historic bookings immediately on import.

---

The project follows a simple versioning approach:

* Major feature releases increment the minor version (e.g. v0.9.0 → v0.10.0)
* Bug fixes and stability improvements increment the patch version (e.g. v0.9.1 → v0.9.11)

---
## v0.9.12 – Admin Settings & Stability Update

### Added

* Added PIN-protected Admin Settings tabs.
* Added dedicated About tab showing:

  * Application version
  * Release name
  * Developer information
* Added user/admin separation within Settings.
* Added session-based admin unlock (refreshing the page re-locks admin settings).
* Added visual lock indicators for protected settings tabs.

### Changed

* Refactored Settings schema into logical groups:

  * General
  * Operations
  * Calendar
  * Branding
  * Colours
  * Admin: System
  * Admin: Inbox
  * Admin: Quotes
  * Admin: Calendar
  * Admin: Advanced Branding
* Removed obsolete view-toggle logic from the dashboard.
* Calendar view is now permanently visible alongside the booking table.
* Improved calendar booking ordering so events display chronologically within each day.
* Improved duplicate booking detection using Message ID + Attachment Name keys.
* Improved dashboard write performance by writing complete rows in a single operation rather than updating cells individually.
* Added validation checks for required dashboard headers.

### Fixed

* Fixed duplicate booking detection issues caused by blank Message ID or Attachment Name values.
* Fixed scanner incorrectly skipping bookings after duplicate detection changes.
* Fixed parser error caused by undefined `lowerItem` reference.
* Fixed parser error caused by undefined `getNotesBlockUnderLabel_` reference.
* Fixed dashboard import failures caused by malformed hospitality booking forms.
* Fixed calendar event creation time parsing to use the central hospitality time parser.
* Fixed multiple Apps Script HTML template rendering issues caused by malformed `<?!= ?>` template tags.
* Fixed Admin PIN modal rendering issues.
* Fixed settings schema loading and fallback behaviour.
* Fixed deployment issues related to stale HTML templates.
* Fixed calendar event sorting within the weekly calendar view.

### Documentation

* Added project README.
* Added project changelog.
* Standardised deployment and versioning process.
* Published GitHub repository.
* Added custom FIKA redirect URL for dashboard access.

### Known Issues

* Certain evening hospitality/event booking forms may fail to correctly detect Event Date fields.
* Multi-time bookings currently use the first detected service time only.

## v0.9.11 - Code Review & Stability Update

### Fixed

* Calendar bookings now sort chronologically within each day.
* Fixed action button alignment and wrapping issues.
* Fixed calendar control visibility issues.
* Improved parser resilience around date and time handling.
* Improved booking validation behaviour.
* Prevented duplicate original booking form XLSX files from being created when calendar events are recreated.
* Fixed confirmation workflow to prevent accidental duplicate confirmation emails.

### Improved

* Calendar event creation now uses configured location settings rather than hard-coded values.
* Improved multi-site readiness through increased use of Settings sheet configuration.
* Additional code cleanup following external code review.
* Improved overall application stability and maintainability.
* Scan inbox modal now displays human readable date/time instead of ISO
* Added archived stat box to scan inbox modal

### Reviewed

* Full codebase reviewed across:

  * Configuration
  * Parser
  * Gmail scanning
  * Data layer
  * Quote generation
  * Calendar integration
  * Web application
  * Styling
  * Test harness

---

## v0.9.1 - Settings System Release

### Added

* Dynamic Settings modal.
* Settings schema system.
* Settings validation framework.
* Settings persistence to dedicated Settings sheet.
* Settings import and initialisation utilities.
* Calendar week view.
* Inbox Scan modal with progress tracking.
* Expanded test harness.

### Improved

* Dashboard branding and theming now configurable through settings.
* Application configuration moved from hard-coded values to live settings.
* Improved flexibility for future multi-site deployments.

### Fixed

* Various UI alignment and layout issues.
* Calendar rendering improvements.
* General dashboard usability improvements.

---

## v0.9.0 - Initial Dashboard Release

### Added

* Gmail inbox scanning for hospitality booking forms.
* XLSX attachment processing and conversion.
* Booking parser and validation engine.
* Dashboard Data sheet integration.
* Booking lifecycle management.
* Quote generation workflow.
* Calendar event creation workflow.
* Booking confirmation emails.
* Search, filtering and sorting.
* Inline booking editing.
* Status management system.
* Archiving workflow.
* Drive integration for generated documents.

### Notes

* First production-ready release of the Hospitality Dashboard platform.
* Built to automate hospitality booking processing and CPU workflow management.
