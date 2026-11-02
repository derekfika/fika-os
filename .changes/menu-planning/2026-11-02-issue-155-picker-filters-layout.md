# 2026-11-02 — Keep Week Planner dish filters centered

Constrained the filter dialog to the picker width so long tag labels cannot widen and shift it. Removed the nested filter-panel scroll area so the picker is the single scroll container. No domain or data changes.

Validation: `tests/dish-picker-filters.test.ts` (13 passed); isolated Playwright filter layout regression at 820, 1024, 1280, and 1536px; Menu Planning typecheck and production build passed.
Deployment: none.
