# 2026-11-11 — RCoA client dashboard UX polish

RCoA dashboard projections use governed service labels, identify grouped All Day Hospitality bookings and their included-service count, and show guest-count variation without summing child values. Included services now use distinct labelled detail cards, and the RCoA table wraps service names at word boundaries. The mobile hero fills the viewport without extending past its gutters. Gallagher rendering and booking lifecycle data remain unchanged.

Validation: Hospitality suite (449 tests), RCoA/Gallagher dashboard and All Day focused tests (59 tests), typecheck and production build passed. Desktop/mobile browser UAT pending staging deployment.
Deployment: pending governed staging deployment; no production rollout.

Style Guide compliance: PASS — new detail and table styles use shared semantic tokens and stay scoped to the RCoA surface.
