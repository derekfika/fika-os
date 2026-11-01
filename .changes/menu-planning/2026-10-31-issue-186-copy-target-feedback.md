# 2026-10-31 — Menu Planning: explain copy targets for #186

Clarifies why a dish has no copy destination using its canonical Dish Library category, current slot mappings, occupied cells and editable weekdays. Compatible destinations follow the planner's weekday and slot order, including normalized legacy slot aliases. Published destinations remain immutable. Copies continue to preserve canonical dish identity and target day/slot with optimistic week-version checks; portions, allocations and allergen review are not inherited.

Validation: focused copy and cell-menu tests (26/26); full Menu Planning suite (426 passed, 1 skipped); typecheck and production build passed. Governed exact-source validation started but was interrupted after the workspace lease recovery test file ran for over five minutes without a new result; no full governed validation result is available. Isolated local Playwright planner-cell-menu spec: 11/11 passed against the synthetic fixture server.
Deployment: none; staging was not accessed.
