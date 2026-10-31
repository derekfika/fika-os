# 2026-10-31 — Draft spelling corrections

Add explicit, confirmed spelling replacement to the Week Planner suggestions and inline popover. Replacements update only one editable draft entry through the versioned menu command; canonical Dish Library records and published history are unchanged. Dish identity, portions and allocations are retained, and the UI warns that a spelling edit may invalidate the row's allergen review. Protect FIKA from dictionary false positives and remove duplicate/self correction candidates.

Validation: Menu Planning tests (423 passed, 1 skipped), typecheck and production build passed. No staging verification or deployment.
Deployment: none.
