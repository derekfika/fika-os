# 2026-10-30 — Hospitality dashboard search, filters and sorting (#157, first slice)

The operations dashboard queue and the weekly calendar now share one filter bar: search by booker, company or booking reference (canonical ID, source reference, group reference and child service references); multi-select status (only statuses present, with `Approved` shown as Ready for CPU as before); inclusive service-date range; sort by service date/time or most recently updated; active-filter chips, a reset, a live "Showing X of Y" count and a filtered empty state. The old single status dropdown is replaced. Filtering is client-side over the bookings the server already authorised for the site/OPLOC, performs no writes and keeps cancelled history visible unless filtered out. There is deliberately no site filter: the dashboard is site-locked. Groups still list before standalone bookings, each sorted within its own kind.

Validation: Hospitality typecheck, full suite (382 pass, including 18 new tests covering search, status, date boundaries, sorting, missing data and source contracts), and production build. Not visually verified at mobile widths or in a browser.
Deployment: none.
