# 2026-11-05 — Resizable Portion Planner dish column (#379)

Long dish names remain fully readable in a bounded Portion Planner column. Operators can resize it with pointer or keyboard input; the local browser preference does not affect menu data, portions, totals, or publications.

Style Guide compliance: PASS — uses existing table surfaces, semantic focus treatment, and the shared focus/action tokens; no unrelated visual restyling.
Validation: focused resize regression (4/4 passed); full Menu tests (521 passed, 4 skipped); Menu typecheck and production build passed. Test-generated local catalogue changes were restored.
Deployment: none.
