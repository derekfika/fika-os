# 2026-11-12 — RCoA floor and location selectors

Added dependent floor and room selections to the RCoA booking portal, All Day service rows, and canonical RCoA amendment editors. The selectors apply only to RCoA bookings at the selected canonical OPLOC; both blank fields remain valid for unassigned historical bookings.

Validation: Hospitality full suite 455/455 passed; focused RCoA selector and validation coverage passed; `npx tsc --noEmit` and production build passed. ESLint could not start because this app has no ESLint 9 flat config. Staging UAT pending.
Deployment: not deployed; staging requested.
