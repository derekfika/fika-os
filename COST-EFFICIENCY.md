# FIKA cost-efficiency rules

Keeping operating cost low is a standing product requirement, especially for
Firebase and other metered services.

## Defaults for new work

- Prefer server-side caching for stable reference data such as OPLOCs, menus,
  service definitions, and configuration.
- Query the smallest useful scope: filter by site, date, status, or ID rather
  than reading an entire collection.
- Refresh on user action, visibility changes, or a deliberate interval. Do not
  add short polling loops by default.
- For normal operational dashboards, prefer a roughly five-minute background
  refresh while the tab is visible, with immediate refresh after the user's own
  actions and a manual Refresh control. Use a shorter interval only where an
  operational requirement genuinely needs it.
- Write only on a real state change. Avoid periodic writes, read-modify-write
  loops, and duplicate submissions.
- Keep imports, scans, backups, and reconciliation jobs explicitly triggered
  or scheduled at a sensible cadence; never run them on every page load.
- Add pagination or limits to growing collections and avoid unbounded
  `collection().get()` calls in user-facing paths.

## Incremental change-feed roadmap

Move cross-app dashboard synchronisation toward a shared append-only change
feed rather than repeatedly rereading complete working datasets.

- On first load, fetch a bounded snapshot appropriate to the screen, such as
  today's Logistics work, the current production week, or relevant future
  Hospitality bookings.
- Record a durable sync cursor after the snapshot. Prefer a sortable sequence or
  a composite timestamp plus event ID so simultaneous changes cannot be lost.
- Each meaningful state change appends a small change event identifying the
  entity, action, source app, version, and timestamp.
- Background refreshes ask only for events after the last cursor and patch the
  affected entities into the current screen. A normal target is every five
  minutes while visible.
- A user's own action should update/refresh immediately; manual Refresh remains
  available at all times.
- Cancellations and removals must emit explicit events/tombstones so downstream
  apps can remove or update stale records correctly.
- Keep an occasional bounded reconciliation/full refresh as a safety net, not as
  the primary sync mechanism.
- Avoid broad real-time Firestore listeners by default. Use genuinely live,
  event-driven behaviour only for workflows where seconds materially matter.
- The change feed should align with the wider append-only audit-trail work so
  operational history, synchronisation and diagnostics share consistent event
  identities without requiring every dashboard to invent its own polling model.

## Firebase guardrails

Before release, review Firestore reads, writes, deletes, storage, and outbound
traffic for each new feature. The current target is to remain comfortably below
the applicable no-cost quota, with monitoring and alerts enabled before live
traffic is switched on. Local emulator behaviour must not be used as evidence
that production usage is cheap.

When a live read is needed repeatedly, document its expected frequency,
expected document count, and cache/refresh strategy in the pull request or
feature notes.
