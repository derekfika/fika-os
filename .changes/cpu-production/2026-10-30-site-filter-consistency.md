# 2026-10-30 — Shared multi-select site filter across CPU Production views (#156, first slice)

Week, Day, Queue, Run sheet, Totals and the legacy `/calendar` route now share one searchable multi-select site control keyed on canonical `destinationOplocId` (select all, clear, per-site order counts, selection summary). A single summary under the filter bar shows every active filter as a removable chip (site, status, origin), one reset, distinct loading / verified-empty / filter-no-match / error states, and selected-site versus all-site counts (Week header, Totals header and the summary line). Orders with no OPLOC are never given an invented identity: they stay under All sites and are disclosed when a site selection hides them. Status no longer hides silently: it is shown as a chip. The Totals site filter accepts several IDs while single-string callers behave as before.

Unchanged by design: order eligibility (cancelled, workflow-cancelled and superseded orders are still excluded from demand), quantity and unit aggregation, projection loading, Run Sheet and Totals printing, Week Planner ordering, and every Hub/CPU handoff. The `rejected` status is not treated as withdrawn here; that edge is reported separately for contract verification.

Validation: CPU typecheck, 17 new focused tests (site identity, search, selection, chips, view states, totals aggregation by site, withdrawn/superseded handling, date boundaries, source contracts), full CPU suite and production build; see the PR for results. Not checked in a browser or on a physical tablet.
Deployment: none.
