# 2026-11-27 — Menu Library and reusable daily menus

Added a Menu Library for versioned, reusable daily menu content built from canonical Dish Library IDs and saved Menu Designer layouts. Week Planner can save a day or preview and load a compatible library menu; changing dishes clears their prior portions and allocations, while PAX and service details stay with the target day. Loading remains a local planner draft and does not publish or create downstream demand. Feature responsibilities live in `apps/menu-planning/lib/menu-library.ts`, the `/api/menu-library` route, `apps/menu-planning/app/menu-library-workspace.tsx`, and `apps/menu-planning/app/menu-library-day-actions.tsx`.

Validation: Menu Planning suite (620 tests: 615 passed, 5 skipped), focused library and Week Planner regressions (70 passed), typecheck and production build passed. Playwright rendered screenshots at 1920, 1440, 1280, 1024 and 768 CSS px; computed FIKA fonts and styled inputs were confirmed, with no horizontal overflow.
Deployment: staging only; no production deployment.
