# 2026-11-27 — Task 04A Menu Library

Added a reusable category and row structure library to Menu Planning. Menu instances store an independent structure snapshot; later template edits, duplication, or archiving do not rewrite existing weeks or publication evidence. The Week Planner can create menus from saved structures and edit the layout of an unpublished supplementary occurrence. Removed the Hospitality Rotations sidebar entry and the obsolete Hospitality availability toolbar control while retaining their route, metadata, and stored history.

Responsibilities and source locations: `lib/menu-structure-library.ts` validates/copies layouts; `app/api/menu-structure-library/route.ts` owns authenticated library actions; `lib/rolling-menu.ts` and `app/api/rolling-menu/route.ts` persist per-week snapshots; `app/menu-structure-editor.tsx` and `app/week-planner.tsx` render editing; `lib/week-planner-layout.ts` projects the selected menu's category/row order.

Validation: governed `fika validate --base origin/main` passed (workflow suite 231/231, Menu Planning suite 604 passed/5 skipped, typecheck and production build); focused structure/layout/UI regressions also passed. Protected CI, staging deployment, and hosted acceptance pending.
Deployment: not deployed.
