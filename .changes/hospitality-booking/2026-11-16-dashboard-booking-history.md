# 2026-11-16 — Hospitality dashboard booking history

Added Upcoming, Previous and All bookings views to the internal Hospitality operations dashboard. Previous and All use the existing site-authorised Hub archive request; Completed and Cancelled records remain available to the existing search, service-date and status filters. Historical detail keeps the existing quote, CPU status and audit surfaces, with saved quote revisions and grouped service audit evidence surfaced for older bookings.

The Hub archive remains bounded to a rolling 365-day lookback and 200 documents. The dashboard now displays that boundary and the Hub truncation signal instead of implying the archive is complete.

Validation: Hospitality `npm test` (487 tests), `npm run typecheck`, `npm run build`, `fika affected`, workspace check, and `git diff --check` passed. Exact-source GitHub `Workflow / merge-gate` passed, including required Hospitality validation. Local repository `fika validate` did not complete after repeatedly entering a workspace fixture; the exact merge-gate workflow completed successfully. Hospitality `npm run lint` is currently blocked because ESLint 9 finds no `eslint.config.*` file in the app; no lint configuration was added for this dashboard-only change.
Deployment: none.
Style Guide compliance: PASS; the view controls and archive/evidence surfaces use shared semantic FIKA tokens and accessible native controls.
