# 2026-10-31 Issue #221: Six-week rotations UI foundation

Date: 2026-10-31

- Reshape the rotation week planner as six horizontally scrollable week columns so every cycle week is visible together, including at tablet and smaller desktop widths.
- Allow a new rotation row to map to an available canonical Hospitality catalogue item before dishes are selected. New rows start with six empty week sets; existing dish bank, filtering, multi-select and keyboard reorder behavior remain in use.
- Preserve Hub-backed Manage authorization, canonical IDs, revisioned draft saving, concurrency and publish gating. No booking behavior or publication was changed.
- Validation: Menu Planning tests (423 passed, 1 skipped), typecheck and production build passed after installing app-local locked dependencies with `npm ci` in `apps/menu-planning`.
- Deployment: none. Local browser acceptance remains outstanding.
