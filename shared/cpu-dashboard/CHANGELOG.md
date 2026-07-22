# CPU Dashboard Changelog

## 2026.06.21.9

- Tablet view now defaults to a single-day focus instead of the whole week when no user preference exists.
- The selected tablet day now expands to a full-width prep lane.
- Tablet calendar view hides product/search controls unless the Production view is active, reducing visual clutter.

## 2026.06.21.8

- Added a simplified tablet layout for landscape kitchen/tablet use.
- Tablet view now uses larger touch targets, swipeable day columns and a cleaner editor/prep-photo workflow.
- Reduced tablet header/stat clutter while leaving the desktop layout unchanged.

## 2026.06.21.7

- Prep proof and allergen sheet uploads now support multiple photos per booking.
- Added `PrepPhotosJSON` and `AllergenPhotosJSON` list storage while retaining latest-photo shortcut columns.
- Photo uploads now run as a queue with progress text for multi-page allergen sheets.

## 2026.06.21.6

- Removed the blocked live-camera button and standardised on the native tablet photo picker.
- Renamed prep capture to `Upload prep photo`.
- Added separate allergen sheet photo upload and storage.

## 2026.06.21.5

- Added proof-of-prep camera capture in the booking editor for tablet/mobile use.
- Prep photos are compressed in-browser, uploaded to Drive, and linked back to the order.
- Added `PrepPhotoFileId`, `PrepPhotoUrl` and `PrepPhotoAt` storage columns.
- Bookings with proof photos now show a camera badge and an open-photo link.
- Added a native upload/photo-picker fallback for tablets that block live camera preview.

## 2026.06.21.4

- Added chef attribution to prep tracking with a stored `PreppedBy` field.
- Booking cards, run sheet rows and production drill-downs can now show `Prepped by <chef>`.
- Quick prep remembers the last chef name on the current device to speed up tablet use.

## 2026.06.21.3

- The booking editor now also hides update notes when `SHOW_UPDATED_FLAGS` is `FALSE`.
- Stored change history remains intact and reappears if the setting is enabled.

## 2026.06.21.2

- Added `SHOW_UPDATED_FLAGS` to CPU Settings.
- Updated badges are hidden by default to keep booking cards tidy.
- Change history and the Updated Only filter remain available.

## 2026.06.21.1

- Added `DEEP_SCAN_MODE` to the CPU Settings sheet.
- Fast mode continues to skip unchanged bookings.
- Deep mode reopens and reparses every quote in the selected scan range.
- The scan modal now identifies whether a fast or deep scan is running.

## 2026.06.20.14

### Changed

- Reworked the top header: Fika wordmark left, CPU title centred and build/load
  status right.
- Moved Reload Sheet, Scan Calendars and Kitchen Mode into week controls.
- Moved Today between previous/next-week arrows.
- Hid the Print button while retaining print code and styles.
- Replaced external logo loading with inline SVG stored in configuration.
- Removed persistent wait-cursor behaviour.

## 2026.06.20.3 – 2026.06.20.13

### Added

- Prep progress bar and quick-prep controls.
- Updated-only, hide-completed and weekday focus filters.
- Dietary production summary.
- Urgent-order highlighting.
- Persistent user preferences and keyboard shortcuts.
- Full-screen Kitchen mode with automatic refresh.
- Dedicated Deliveries view and calendar delivery badges.
- Prepped/Done state with Fika-purple styling.
- Changed-booking tracking and detailed change alerts.
- Chef-focused categorised production board.
- Inline Fika SVG branding.

### Improved

- Static filter/search toolbar.
- Faster incremental calendar scans with larger chunks and batched writes.
- Immediate editor refresh after quote re-reading.
- Product categories configurable through `CPU Settings`.
- Site identity and delivery destination made more prominent.

## 2026.06.19.1 – 2026.06.20.7

### Added

- Initial CPU production dashboard.
- Calendar, run-sheet and production views.
- Site, service and product filtering.
- Calendar scan feedback modal.
- Quote and booking-form attachment parsing.
- Needs Attention workflow and manual quote re-reading.
- Built-in site email directory.

### Parser coverage

Added support for numerous legacy site quote formats, including:

- DOCX text boxes and split XML runs
- Priced packages and per-person calculations
- Quantity-first and `X10` quantity formats
- Product headings followed by price calculations
- Delegate packages and working lunches
- BBQ packages inheriting booking pax
- Vegan/soy/sesame products without misclassifying them as dietary notes
- Short dietary splits such as `3x vege`
- Date/month lines excluded from production products

The parser test suite currently contains 27 regression tests.
