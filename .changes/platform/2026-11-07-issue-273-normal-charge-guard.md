# 2026-11-07 — Governed Hospitality labour-rate calculation

The shared calculation contract now always applies the approved 1.5× Agency/overtime rate while persisting its canonical base rate and multiplier. Historical Normal classification requires an approved role and exact base-rate signature.

Validation: Shared rate contract covered by Hospitality 435/435 and focused Hub tests; both app typechecks and builds passed. The full Hub suite has one unrelated missing address-spec fixture failure; 990 passed and 120 skipped.
Deployment: none.
