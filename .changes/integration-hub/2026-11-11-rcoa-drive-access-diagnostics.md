# 2026-11-11 — RCoA quote access diagnostics

The read-only Hospitality Calendar preview reports the current quote revision and per-principal delegated Drive/PDF access with organiser and attendee Calendar evidence. The existing verified-PDF publication gate remains fail-closed.

Validation: Hub Calendar tests (17/17), Hub typecheck and Hub production build passed. The full governed validation stopped because Ad-Hoc's `tsx` dependency is absent from this preserved workspace. Full Hub lint reports 157 diagnostics in files outside this change; focused lint of changed Hub files passed. Production preview/release verification pending.
Deployment: none.
