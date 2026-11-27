# 2026-11-27 — Menu Designer and Week Planner UX refinement

Added a dedicated Menu Designer for reusable category and row layouts using the existing versioned Menu Structure Library. Added drag ordering with accessible arrow controls, unsaved-change handling and explicit copy-on-use behavior. Simplified supplementary menu setup to select a saved layout and configure operational service details; removed per-day menu selectors while retaining the global weekly selector and recurring-menu identity when navigating weeks. Feature responsibilities and source locations are documented in `apps/menu-planning/docs/menu-designer.md`.

Validation: focused Menu Designer and planning selector regression tests passed; full Menu Planning suite passed (607 passed, 5 skipped emulator tests); Menu Planning typecheck and production build passed. Hosted staging acceptance pending.
Deployment: staging not yet deployed.
