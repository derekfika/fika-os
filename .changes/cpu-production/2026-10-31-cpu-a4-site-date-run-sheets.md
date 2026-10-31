# 2026-10-31 — CPU A4 site and date run sheets

- Date: 2026-10-31
Task #142: print run sheets by date and dynamic site. Added an accessible date-range and destination selection dialog that refetches complete CPU projections before printing. A4 pages group by canonical destination and service date, with labelled continuation pages, paper-only handover fields, and preserved order/source references and quantities.

Validation: CPU suite passed (500 tests, 2 skipped) with `FIKA_CPU_PLAN_STORE=memory`; focused date/site/whole-day tests passed (13/13); Chromium A4 PDF pagination tests passed (7/7); CPU typecheck and production build passed. Tablet-width dialog and A4 continuation output were visually inspected in Chromium. Style Guide compliance: PASS. Operational UAT remains unperformed because no authenticated staging read path was available in this local session. Date selection performs one bounded, fresh projection request per selected service date (maximum 31); print repeats these reads to verify freshness. No new writes, collection scans, recurring polling, or audit events.

Deployment: none.
