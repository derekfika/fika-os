# 2026-10-29 — Govern CFC and Munich RE provider Item links

Add the missing explicit provider-row linking command to the existing Hospitality catalogue admin API. Require a known source row, active canonical Item, current version and unique active ownership. Preserve prices, product rules, routing, Dish Library identity and recipe associations. Use existing atomic revision and governance audit writes; current identical links are no-ops.

Validation: three focused planning tests and a fresh isolated Firestore-emulator test passed, including permission rejection, stale/no-op commands and concurrent competing claims. Hub strict typecheck and production build passed; full Hub suite passed (837 passed, 104 skipped). Exact-source CI pending.
Deployment: none. No staging or production mapping data applied yet; effective catalogue read/booking integration must precede staging population.
