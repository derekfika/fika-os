# 2026-11-23 — RCoA invoice summary report

Adds an RCoA-only invoice report page with date-range preview and PDF export. Export rechecks the report data and access at the Integration Hub before rendering, so changed booking or quote data requires a refreshed preview.

Validation: Hospitality tests 496/496 passed; focused PDF tests 3/3 passed; typecheck and production build passed. Full-app ESLint could not run because this package has no ESLint flat config.
Deployment: none.
