# 2026-11-11 — RCoA dashboard session API cookie scope

Move the RCoA dashboard data and session endpoints under `/rcoa/bookings` so the host-only session cookie scoped to that dashboard is sent to both endpoints. This fixes authentication succeeding while the dashboard data request was rejected as unauthenticated.

Validation: focused RCoA dashboard session tests (5 passed), full Hospitality suite (447 passed), workflow checks (163 passed), typecheck, production build, changelog check and diff check passed; governed PR CI and authenticated staging UAT pending.
Deployment: staging redeployment pending; production unchanged.
