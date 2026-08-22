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
- If polling is genuinely required, start at 30–60 seconds, pause while the
  tab is hidden, and use event-driven updates where practical.
- Write only on a real state change. Avoid periodic writes, read-modify-write
  loops, and duplicate submissions.
- Keep imports, scans, backups, and reconciliation jobs explicitly triggered
  or scheduled at a sensible cadence; never run them on every page load.
- Add pagination or limits to growing collections and avoid unbounded
  `collection().get()` calls in user-facing paths.

## Firebase guardrails

Before release, review Firestore reads, writes, deletes, storage, and outbound
traffic for each new feature. The current target is to remain comfortably below
the applicable no-cost quota, with monitoring and alerts enabled before live
traffic is switched on. Local emulator behaviour must not be used as evidence
that production usage is cheap.

When a live read is needed repeatedly, document its expected frequency,
expected document count, and cache/refresh strategy in the pull request or
feature notes.
