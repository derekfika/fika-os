# 2026-11-26 — Delivered-In staging slide generation safety

Delivered-In shared menu generation now requires a site-specific approved template, preventing MNK from silently inheriting the generic menu template. The staging manifest uses the isolated keyless Shared Drive configuration, points output at its approved staging Menus folder, and does not mount Workspace DWD credentials. Staging slide generation remains unavailable until compatible reviewed templates are provisioned under the isolated root; food-display label generation still has no implemented artifact path or approved data/template contract.

Validation: `npm test` (232 passed), `npm run typecheck`, and `npm run build` in `apps/delivered-in` passed; `git diff --check` passed. No staging Drive writes or deployment performed.
Deployment: none.
