# 2026-11-20 — Read-only Menu Planning for assigned sites

View-only accounts can browse and export their assigned menus. Menu Planning checks Manage and the separate Menu Publish authority against the affected sites before writing. Scoped reads exclude other sites’ quantities and full publication artifacts, and cached weeks require a fresh match for the current account and site scope.

Validation: 582 Menu unit and route tests, ten isolated Playwright recovery journeys including View only, Menu typecheck and Menu build passed.
Deployment: none.
