# 2026-11-20 — Gallagher dashboard status multi-select (#157)

- Replaced the customer dashboard's single-select booking status filter with accessible native checkboxes. Multiple selections match as a union; clearing all statuses means show all.
- Preserved existing display statuses, search/date constraints, read-only data access and booking lifecycle state.
- Validation: focused status/UI tests passed (11/11); full Hospitality suite passed (493/493); typecheck and production build passed; `fika validate` passed (201 workflow tests plus Hospitality tests/typecheck/build).
- Deployment: not deployed; staging browser acceptance remains pending.
