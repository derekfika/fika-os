# 2026-11-25 — Validate grouped Studio booking allocation

Hub now applies the shared grouped quantity rules when preparing a Studio booking, closing the path where a submitted dish ID could be allocated across an incomplete or overlapping group definition. The existing multi-service quote-binding guard remains in place.

Validation: focused Hub Studio allocation tests; Hub emulator suite (65 passed, 1 skipped), including existing legacy/quantity/dropdown Studio acceptance and `STUDIO_DISH_MINIMUM` semantics. Deployment: none.
